/**
 * ERP React Frontend - CRM / Ventes Page
 * Pipeline kanban, opportunities table, interactions timeline, and statistics.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  TrendingUp, Plus, Search, X, Trash2, Phone, Mail, Users, Calendar,
  FileText, DollarSign, Target, ArrowRight, Clock, Pencil,
  MessageSquare, Eye, ChevronLeft, ChevronRight, Activity, Flame,
  List, FolderOpen, Award,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as crmApi from '@/api/crm';
import BATQualificationForm from '@/components/crm/BATQualificationForm';
import type {
  Opportunity, OpportunityCreate,
  PipelineStage, CrmStats,
  CrmCalendarEvent, TimelineItem, QualificationItem,
} from '@/api/crm';
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
import { CommandBar } from '@/components/ui/CommandBar';
import { formatDate, formatCurrency } from '@/utils/format';

// ============ Constants ============

const STATUSES = ['PROSPECTION', 'QUALIFICATION', 'PROPOSITION', 'NEGOCIATION', 'GAGNE', 'PERDU'] as const;

const STATUS_LABELS: Record<string, string> = {
  PROSPECTION: 'Prospection',
  QUALIFICATION: 'Qualification',
  PROPOSITION: 'Proposition',
  NEGOCIATION: 'Negociation',
  GAGNE: 'Gagne',
  PERDU: 'Perdu',
};

const STATUS_COLORS: Record<string, BadgeColor> = {
  PROSPECTION: 'blue',
  QUALIFICATION: 'yellow',
  PROPOSITION: 'purple',
  NEGOCIATION: 'orange',
  GAGNE: 'green',
  PERDU: 'red',
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
];

const INTERACTION_LABELS: Record<string, string> = {
  APPEL: 'Appel',
  EMAIL: 'Email',
  REUNION: 'Reunion',
  VISITE: 'Visite',
  NOTE: 'Note',
};

const INTERACTION_COLORS: Record<string, BadgeColor> = {
  APPEL: 'blue',
  EMAIL: 'teal',
  REUNION: 'purple',
  VISITE: 'green',
  NOTE: 'gray',
};

const INTERACTION_ICONS: Record<string, typeof Phone> = {
  APPEL: Phone,
  EMAIL: Mail,
  REUNION: Users,
  VISITE: Eye,
  NOTE: FileText,
};

const TABS = ['pipeline', 'opportunites', 'historique', 'qualification'] as const;
type TabKey = typeof TABS[number];

const TAB_LABELS: Record<string, string> = {
  pipeline: 'Pipeline',
  opportunites: 'Opportunités',
  historique: 'Historique',
  qualification: 'Qualification',
};

const TAB_ICONS: Record<string, typeof TrendingUp> = {
  pipeline: Target,
  opportunites: FolderOpen,
  historique: List,
  qualification: Flame,
};

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const DAY_NAMES_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

const QUALIFICATION_COLORS: Record<string, BadgeColor> = {
  HOT: 'red',
  WARM: 'orange',
  COLD: 'blue',
};

const QUALIFICATION_LABELS: Record<string, string> = {
  HOT: 'Chaud',
  WARM: 'Tiède',
  COLD: 'Froid',
};

// ============ Main Page Component ============

export default function VentesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('pipeline');
  const [error, setError] = useState<string | null>(null);
  const [topStats, setTopStats] = useState<CrmStats | null>(null);

  // Support de ?open=ID (deeplink depuis calendrier ou autres modules).
  // Utilise la valeur (pas un boolean) pour autoriser plusieurs deeplinks
  // consécutifs avec des IDs différents sans démontage.
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoOpenOppId, setAutoOpenOppId] = useState<number | null>(null);
  const lastHandledOpenIdRef = useRef<string | null>(null);
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && lastHandledOpenIdRef.current !== openId) {
      lastHandledOpenIdRef.current = openId;
      const parsed = Number(openId);
      if (Number.isFinite(parsed) && parsed > 0) {
        setActiveTab('opportunites');
        setAutoOpenOppId(parsed);
      }
      searchParams.delete('open');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    crmApi.getStats().then(setTopStats).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Ventes</h2>
      </div>

      {/* KPI Stats Cards — always visible */}
      {topStats?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
          <Card padding="sm" className="md:p-4">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-semibold mb-0.5 sm:mb-1">Opportunités</div>
            <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{topStats.summary.total}</div>
            <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">{topStats.summary.enCours} en cours</div>
          </Card>
          <Card padding="sm" className="md:p-4">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-semibold mb-0.5 sm:mb-1">Taux conversion</div>
            <div className="text-lg sm:text-2xl font-bold text-green-600">{topStats.summary.tauxConversion}%</div>
            <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1 truncate">{topStats.summary.gagnes} gagnées / {topStats.summary.gagnes + topStats.summary.perdus} fermées</div>
          </Card>
          <Card padding="sm" className="md:p-4">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-semibold mb-0.5 sm:mb-1">Montant gagné</div>
            <div className="text-lg sm:text-2xl font-bold text-seaop-primary-600 dark:text-seaop-primary-400 truncate">{formatCurrency(topStats.summary.montantGagne)}</div>
            <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1 truncate">Pipeline: {formatCurrency(topStats.summary.montantEnCours)}</div>
          </Card>
          <Card padding="sm" className="md:p-4">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-semibold mb-0.5 sm:mb-1">Délai moyen</div>
            <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{topStats.summary.delaiMoyenJours} j</div>
            <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">{topStats.activity?.interactions30j || 0} interactions (30j)</div>
          </Card>
        </div>
      )}

      {/* Tabs — horizontal scroll on mobile */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 min-w-max md:min-w-0">
          {TABS.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 md:px-4 py-3 md:py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'border-seaop-primary-600 text-seaop-primary-600 dark:text-seaop-primary-400 dark:border-seaop-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                <Icon size={16} />
                <span className="hidden md:inline">{TAB_LABELS[tab]}</span>
                <span className="md:hidden text-xs">{TAB_LABELS[tab]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'pipeline' && <PipelineTab onError={setError} />}
      {activeTab === 'opportunites' && <OpportunitesTab onError={setError} autoOpenId={autoOpenOppId} onAutoOpenHandled={() => setAutoOpenOppId(null)} />}

      {activeTab === 'historique' && <TimelineTab onError={setError} />}
      {activeTab === 'qualification' && <QualificationTab onError={setError} />}
    </div>
  );
}


// ============ Pipeline Tab (Kanban with Drag-and-Drop) ============

function PipelineTab({ onError }: { onError: (msg: string) => void }) {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const [opportunitiesByStatus, setOpportunitiesByStatus] = useState<Record<string, Opportunity[]>>({});
  const [batScores, setBatScores] = useState<Record<number, { scoreTotal: number; categorie: string }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detailOpp, setDetailOpp] = useState<Opportunity | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingDetail, setEditingDetail] = useState(false);
  const [editDetailForm, setEditDetailForm] = useState<Record<string, any>>({});
  const [editDetailSaving, setEditDetailSaving] = useState(false);
  const [creatingDevisFromPipeline, setCreatingDevisFromPipeline] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const dragItemRef = useRef<{ id: number; fromStatus: string } | null>(null);
  const [editCompanies, setEditCompanies] = useState<{ id: number; nom: string }[]>([]);
  const [editContacts, setEditContacts] = useState<{ id: number; prenom: string; nomFamille?: string; nom?: string; companyNom?: string }[]>([]);
  const [deletingDetail, setDeletingDetail] = useState(false);
  const [pipelineSuccess, setPipelineSuccess] = useState<string | null>(null);
  const pipelineSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pipelineSuccessTimerRef.current) clearTimeout(pipelineSuccessTimerRef.current);
    };
  }, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [pipelineRes, oppsRes] = await Promise.all([
        crmApi.getPipeline(),
        crmApi.listOpportunities({ perPage: 100 }),
      ]);
      setPipeline(pipelineRes.stages);

      const grouped: Record<string, Opportunity[]> = {};
      for (const s of STATUSES) {
        grouped[s] = [];
      }
      for (const opp of oppsRes.items) {
        if (grouped[opp.statut]) {
          grouped[opp.statut].push(opp);
        }
      }
      setOpportunitiesByStatus(grouped);

      // Load B.A.T. scores
      try {
        const batRes = await crmApi.getAllBATScores();
        setBatScores(batRes.scores || {});
      } catch { /* ignore */ }
    } catch {
      onError('Erreur lors du chargement du pipeline');
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = async (oppId: number, newStatus: string) => {
    try {
      await crmApi.updateOpportunity(oppId, { statut: newStatus });
      fetchData();
    } catch {
      onError('Erreur lors du changement de statut');
    }
  };

  const handleCardDoubleClick = async (oppId: number) => {
    setDetailLoading(true);
    try {
      const full = await crmApi.getOpportunity(oppId);
      setDetailOpp(full);
    } catch {
      onError('Erreur lors du chargement des details');
    } finally {
      setDetailLoading(false);
    }
  };

  const startEditDetail = async () => {
    if (!detailOpp) return;
    setEditDetailForm({
      nom: detailOpp.nom || '',
      statut: detailOpp.statut || 'PROSPECTION',
      montantEstime: detailOpp.montantEstime ?? '',
      probabilite: detailOpp.probabilite ?? 50,
      dateCloturePrevue: detailOpp.dateCloturePrevue || '',
      source: detailOpp.source || '',
      notes: detailOpp.notes || '',
      poClient: (detailOpp as any).poClient || '',
      companyId: detailOpp.companyId || '',
      contactId: detailOpp.contactId || '',
      clientNomDirect: (detailOpp as any).clientNomDirect || '',
      priorite: (detailOpp as any).priorite || 'NORMAL',
      description: (detailOpp as any).description || '',
      dateSoumission: (detailOpp as any).dateSoumission || '',
      dateDebutPrevu: (detailOpp as any).dateDebutPrevu || '',
      dateFinPrevue: (detailOpp as any).dateFinPrevue || '',
    });
    setEditingDetail(true);
    // Load companies & contacts for dropdowns
    try {
      const [compRes, contRes] = await Promise.all([
        import('@/api/companies').then((m) => m.listCompanies({ perPage: 100 })),
        import('@/api/companies').then((m) => m.listContacts({ perPage: 100 })),
      ]);
      setEditCompanies(compRes.items);
      setEditContacts(contRes.items);
    } catch { /* dropdowns will be empty */ }
  };

  const saveEditDetail = async () => {
    if (!detailOpp) return;
    setEditDetailSaving(true);
    try {
      await crmApi.updateOpportunity(detailOpp.id, {
        nom: editDetailForm.nom,
        statut: editDetailForm.statut,
        montantEstime: editDetailForm.montantEstime ? Number(editDetailForm.montantEstime) : undefined,
        probabilite: editDetailForm.probabilite != null ? Number(editDetailForm.probabilite) : undefined,
        dateCloturePrevue: editDetailForm.dateCloturePrevue || undefined,
        source: editDetailForm.source || undefined,
        notes: editDetailForm.notes || undefined,
        poClient: editDetailForm.poClient || undefined,
        companyId: editDetailForm.companyId ? Number(editDetailForm.companyId) : undefined,
        contactId: editDetailForm.contactId ? Number(editDetailForm.contactId) : undefined,
        clientNomDirect: editDetailForm.clientNomDirect || undefined,
        priorite: editDetailForm.priorite || undefined,
        description: editDetailForm.description || undefined,
        dateSoumission: editDetailForm.dateSoumission || undefined,
        dateDebutPrevu: editDetailForm.dateDebutPrevu || undefined,
        dateFinPrevue: editDetailForm.dateFinPrevue || undefined,
      });
      const updated = await crmApi.getOpportunity(detailOpp.id);
      setDetailOpp(updated);
      setEditingDetail(false);
      fetchData();
    } catch {
      onError('Erreur lors de la mise à jour');
    } finally {
      setEditDetailSaving(false);
    }
  };

  const handleDeleteFromPipeline = async (opp: Opportunity) => {
    const nom = opp.nom || `#${opp.id}`;
    const statut = STATUS_LABELS[opp.statut] || opp.statut;
    const montant = opp.montantEstime ? ` — ${formatCurrency(opp.montantEstime)}` : '';
    const warnings: string[] = [];
    if (opp.devisId) warnings.push(`• Une soumission est liée (elle sera détachée, pas supprimée)`);
    if (opp.projetId) warnings.push(`• Un projet est lié (il sera détaché, pas supprimé)`);
    const warningText = warnings.length > 0 ? `\n\nAttention :\n${warnings.join('\n')}` : '';
    const msg = `Supprimer l'opportunité "${nom}" (${statut}${montant}) ?${warningText}\n\nCette action est irréversible.`;
    if (!window.confirm(msg)) return;
    setDeletingDetail(true);
    try {
      await crmApi.deleteOpportunity(opp.id);
      setDetailOpp(null);
      setEditingDetail(false);
      setPipelineSuccess(`Opportunité "${nom}" supprimée`);
      if (pipelineSuccessTimerRef.current) clearTimeout(pipelineSuccessTimerRef.current);
      pipelineSuccessTimerRef.current = setTimeout(() => setPipelineSuccess(null), 4000);
      fetchData();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      onError(detail || 'Erreur lors de la suppression');
    } finally {
      setDeletingDetail(false);
    }
  };

  const handleCreateDevisFromPipeline = async (opportunityId: number) => {
    setCreatingDevisFromPipeline(true);
    try {
      await crmApi.createDevisFromOpportunity(opportunityId);
      setDetailOpp(null);
      navigate('/devis');
    } catch {
      onError('Erreur lors de la création de la soumission');
    } finally {
      setCreatingDevisFromPipeline(false);
    }
  };

  // --- Drag-and-drop handlers ---

  const handleDragStart = (e: React.DragEvent, oppId: number, fromStatus: string) => {
    dragItemRef.current = { id: oppId, fromStatus };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(oppId));
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';
    setDragOverColumn(null);
    dragItemRef.current = null;
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverColumn(null);
    }
  };

  const handleDropOnCard = async (e: React.DragEvent, targetId: number, status: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverColumn(null);

    const dragItem = dragItemRef.current;
    if (!dragItem) return;
    dragItemRef.current = null;

    const { id, fromStatus } = dragItem;
    if (id === targetId) return;

    // Same column = reorder
    if (fromStatus === status) {
      const list = [...(opportunitiesByStatus[status] || [])];
      const fromIdx = list.findIndex((o) => o.id === id);
      const toIdx = list.findIndex((o) => o.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return;

      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);

      setOpportunitiesByStatus({ ...opportunitiesByStatus, [status]: list });

      // Save order for this column
      try {
        await crmApi.reorderOpportunities(list.map((o) => o.id));
      } catch { /* non-critical */ }
      return;
    }

    // Different column = change status (handled by handleDrop)
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    const dragItem = dragItemRef.current;
    if (!dragItem) return;

    const { id, fromStatus } = dragItem;
    dragItemRef.current = null;

    // Same column drop on empty area = ignore (reorder handled by handleDropOnCard)
    if (fromStatus === newStatus) return;

    // Optimistic update
    const prevGrouped = { ...opportunitiesByStatus };
    const fromList = [...(prevGrouped[fromStatus] || [])];
    const toList = [...(prevGrouped[newStatus] || [])];
    const itemIndex = fromList.findIndex((o) => o.id === id);
    if (itemIndex === -1) return;

    const [movedItem] = fromList.splice(itemIndex, 1);
    const updated = { ...movedItem, statut: newStatus };
    toList.push(updated);

    setOpportunitiesByStatus({
      ...prevGrouped,
      [fromStatus]: fromList,
      [newStatus]: toList,
    });

    try {
      await crmApi.updateOpportunity(id, { statut: newStatus });
      try {
        const pipelineRes = await crmApi.getPipeline();
        setPipeline(pipelineRes.stages);
      } catch { /* stats refresh is non-critical */ }
    } catch {
      // Revert on failure
      setOpportunitiesByStatus(prevGrouped);
      onError('Erreur lors du changement de statut. Le deplacement a ete annule.');
    }
  };

  if (isLoading) {
    return <SkeletonPage />;
  }

  // Pipeline columns (active statuses, not GAGNE/PERDU at top)
  const activeStatuses = STATUSES.filter((s) => s !== 'GAGNE' && s !== 'PERDU');

  const getPipelineStage = (statut: string) =>
    pipeline.find((s) => s.statut === statut) || { statut, count: 0, totalMontant: 0, avgProbabilite: 0 };

  return (
    <div className="space-y-4">
      {pipelineSuccess && (
        <Alert type="success" onClose={() => setPipelineSuccess(null)}>{pipelineSuccess}</Alert>
      )}
      {/* Summary row: GAGNE + PERDU (also drop targets) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(['GAGNE', 'PERDU'] as const).map((s) => {
          const stage = getPipelineStage(s);
          const isOver = dragOverColumn === s;
          return (
            <Card
              key={s}
              padding="sm"
              className={`transition-colors duration-150 ${isOver ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''}`}
              onDragOver={(e: React.DragEvent) => handleDragOver(e, s)}
              onDragLeave={handleDragLeave}
              onDrop={(e: React.DragEvent) => handleDrop(e, s)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge color={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</Badge>
                  <span className="text-sm text-gray-500">{stage.count} opportunité{stage.count !== 1 ? 's' : ''}</span>
                </div>
                <span className={`text-lg font-bold ${s === 'GAGNE' ? 'text-green-600' : 'text-red-500'}`}>
                  {formatCurrency(stage.totalMontant)}
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Create button */}
      <div className="flex justify-start">
        <Button leftIcon={<Plus size={16} />} onClick={() => setShowCreate(true)}>
          Nouvelle opportunité
        </Button>
      </div>

      {/* Kanban columns — fill remaining viewport height */}
      <div className="flex md:grid md:grid-cols-4 gap-4 overflow-x-auto pb-2 snap-x snap-mandatory" style={{ minHeight: 'calc(100vh - 420px)' }}>
        {activeStatuses.map((status) => {
          const stage = getPipelineStage(status);
          const opps = opportunitiesByStatus[status] || [];
          const isOver = dragOverColumn === status;
          return (
            <div key={status} className="flex flex-col min-w-[260px] md:min-w-0 snap-center">
              {/* Column header */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Badge>
                  <span className="text-xs text-gray-400">{stage.count}</span>
                </div>
                <span className="text-xs font-medium text-gray-500">
                  {formatCurrency(stage.totalMontant)}
                </span>
              </div>

              {/* Cards (drop target) — scrollable, fills column height */}
              <div
                className={`flex-1 space-y-2 overflow-y-auto p-2 rounded-lg bg-gray-50 dark:bg-gray-800/30 border border-dashed transition-colors duration-150 ${
                  isOver
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
                onDragOver={(e) => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, status)}
              >
                {opps.map((opp) => (
                  <PipelineCard
                    key={opp.id}
                    opportunity={opp}
                    currentStatus={status}
                    batScore={batScores[opp.id]}
                    onStatusChange={handleStatusChange}
                    onDoubleClick={handleCardDoubleClick}
                    onDropOnCard={handleDropOnCard}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                ))}
                {opps.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">
                    {isOver ? 'Déposer ici' : 'Aucune opportunité'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail modal (double-click) */}
      <Modal isOpen={!!detailOpp} onClose={() => setDetailOpp(null)} title="Détail de l'opportunité" size="xl">
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spinner size="lg" /></div>
        ) : detailOpp && (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {/* Header + Edit button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {detailOpp.numeroOpportunite && (
                  <span className="text-xs font-mono text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">
                    {detailOpp.numeroOpportunite}
                  </span>
                )}
                <Badge color={STATUS_COLORS[detailOpp.statut] || 'gray'}>
                  {STATUS_LABELS[detailOpp.statut] || detailOpp.statut}
                </Badge>
              </div>
              {!editingDetail && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" leftIcon={<Pencil size={14} />} onClick={startEditDetail}>
                    Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<Trash2 size={14} />}
                    onClick={() => detailOpp && handleDeleteFromPipeline(detailOpp)}
                    disabled={deletingDetail}
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-300"
                  >
                    Supprimer
                  </Button>
                </div>
              )}
            </div>

            {editingDetail ? (
              /* ---- EDIT MODE (same fields as create form) ---- */
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Column 1 */}
                  <div className="space-y-4">
                    <Input
                      label="Nom de l'opportunité *"
                      value={editDetailForm.nom}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, nom: e.target.value })}
                      placeholder="Ex: Rénovation cuisine Dupont"
                    />
                    <Input
                      label="No. PO Client"
                      value={editDetailForm.poClient || ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, poClient: e.target.value })}
                      placeholder="Ex: PO-12345"
                    />
                    <Select
                      label="Client (Entreprise)"
                      options={[
                        { value: '', label: 'Sélectionner ou laisser vide' },
                        ...editCompanies.map((c) => ({ value: String(c.id), label: c.nom })),
                      ]}
                      value={editDetailForm.companyId ? String(editDetailForm.companyId) : ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, companyId: e.target.value ? Number(e.target.value) : '' })}
                    />
                    <Select
                      label="Client (Personne)"
                      options={[
                        { value: '', label: 'Aucun contact' },
                        ...editContacts.map((c) => ({
                          value: String(c.id),
                          label: `${c.prenom} ${c.nomFamille || c.nom || ''}${c.companyNom ? ` (${c.companyNom})` : ''}`,
                        })),
                      ]}
                      value={editDetailForm.contactId ? String(editDetailForm.contactId) : ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, contactId: e.target.value ? Number(e.target.value) : '' })}
                    />
                    <Input
                      label="Saisie manuelle (si client non dans le CRM)"
                      value={editDetailForm.clientNomDirect || ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, clientNomDirect: e.target.value })}
                      placeholder="Ex: Jean Tremblay Construction"
                    />
                    <Select
                      label="Statut"
                      options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
                      value={editDetailForm.statut || 'PROSPECTION'}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, statut: e.target.value })}
                    />
                    <Select
                      label="Priorité"
                      options={[
                        { value: 'BASSE', label: 'Basse' },
                        { value: 'NORMAL', label: 'Normal' },
                        { value: 'HAUTE', label: 'Haute' },
                        { value: 'URGENTE', label: 'Urgente' },
                      ]}
                      value={editDetailForm.priorite || 'NORMAL'}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, priorite: e.target.value })}
                    />
                  </div>

                  {/* Column 2 */}
                  <div className="space-y-4">
                    <Input
                      label="Source"
                      value={editDetailForm.source || ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, source: e.target.value })}
                      placeholder="Ex: Site web, Recommandation, Salon..."
                    />
                    <Input
                      label="Date limite de soumission"
                      type="date"
                      value={editDetailForm.dateSoumission || ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, dateSoumission: e.target.value })}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Début prévu des travaux"
                        type="date"
                        value={editDetailForm.dateDebutPrevu || ''}
                        onChange={(e) => setEditDetailForm({ ...editDetailForm, dateDebutPrevu: e.target.value })}
                      />
                      <Input
                        label="Fin prévue des travaux"
                        type="date"
                        value={editDetailForm.dateFinPrevue || ''}
                        onChange={(e) => setEditDetailForm({ ...editDetailForm, dateFinPrevue: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        label="Montant estimé ($)"
                        type="number"
                        value={editDetailForm.montantEstime ?? ''}
                        onChange={(e) => setEditDetailForm({ ...editDetailForm, montantEstime: e.target.value })}
                      />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Probabilité: {editDetailForm.probabilite ?? 50}%
                        </label>
                        <input
                          type="range" min={0} max={100} step={5}
                          value={editDetailForm.probabilite ?? 50}
                          onChange={(e) => setEditDetailForm({ ...editDetailForm, probabilite: Number(e.target.value) })}
                          className="w-full accent-seaop-primary-600"
                        />
                      </div>
                    </div>
                    <Input
                      label="Date de clôture prévue"
                      type="date"
                      value={editDetailForm.dateCloturePrevue || ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, dateCloturePrevue: e.target.value })}
                    />
                    <Textarea
                      label="Description"
                      value={editDetailForm.description || ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, description: e.target.value })}
                      rows={3}
                    />
                    <Textarea
                      label="Notes"
                      value={editDetailForm.notes || ''}
                      onChange={(e) => setEditDetailForm({ ...editDetailForm, notes: e.target.value })}
                      rows={2}
                    />
                  </div>
                </div>

                <p className="text-xs text-gray-400">* Champs obligatoires</p>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="ghost" onClick={() => setEditingDetail(false)}>Annuler</Button>
                  <Button onClick={saveEditDetail} disabled={!editDetailForm.nom?.trim()} isLoading={editDetailSaving}>Sauvegarder</Button>
                </div>
              </div>
            ) : (
              /* ---- VIEW MODE ---- */
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{detailOpp.nom}</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Entreprise</label>
                    <p className="text-gray-900 dark:text-white">{detailOpp.companyNom || '--'}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Contact</label>
                    <p className="text-gray-900 dark:text-white">
                      {detailOpp.contactPrenom || detailOpp.contactNom
                        ? `${detailOpp.contactPrenom || ''} ${detailOpp.contactNom || ''}`.trim()
                        : '--'}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Montant estimé</label>
                    <p className="text-lg font-semibold text-seaop-primary-600">
                      {detailOpp.montantEstime != null ? formatCurrency(detailOpp.montantEstime) : '--'}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Probabilité</label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-seaop-primary-500 rounded-full" style={{ width: `${detailOpp.probabilite || 0}%` }} />
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{detailOpp.probabilite ?? 0}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Date de clôture prévue</label>
                    <p className="text-gray-900 dark:text-white flex items-center gap-1">
                      <Calendar size={14} className="text-gray-400" />
                      {detailOpp.dateCloturePrevue ? formatDate(detailOpp.dateCloturePrevue) : '--'}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Source</label>
                    <p className="text-gray-900 dark:text-white">{detailOpp.source || '--'}</p>
                  </div>
                </div>

                {detailOpp.notes && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase">Notes</label>
                    <p className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {detailOpp.notes}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="pt-2 flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    leftIcon={<FileText size={14} />}
                    onClick={() => handleCreateDevisFromPipeline(detailOpp.id)}
                    isLoading={creatingDevisFromPipeline}
                    disabled={creatingDevisFromPipeline}
                  >
                    Créer une soumission
                  </Button>
                  {detailOpp.dossierId && (
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<FolderOpen size={14} />}
                      onClick={() => { setDetailOpp(null); navigate(`/dossiers?open=${detailOpp.dossierId}`); }}
                    >
                      Voir le dossier
                    </Button>
                  )}
                </div>
              </>
            )}

            {/* Timeline — interactions + activites merged chronologically */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-500 uppercase">
                  Timeline ({(detailOpp.interactions?.length || 0) + (detailOpp.activities?.length || 0)})
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const resume = prompt('Résumé de l\'interaction:');
                      if (!resume) return;
                      crmApi.createInteraction({
                        opportunityId: detailOpp.id,
                        companyId: detailOpp.companyId,
                        typeInteraction: 'NOTE',
                        resume,
                        dateInteraction: new Date().toISOString().split('T')[0],
                      }).then(async () => {
                        const full = await crmApi.getOpportunity(detailOpp.id);
                        setDetailOpp(full);
                      }).catch(() => {});
                    }}
                    className="text-xs text-seaop-primary-600 hover:text-seaop-primary-700 font-medium flex items-center gap-1"
                  >
                    <Plus size={12} /> Interaction
                  </button>
                  <button
                    onClick={() => {
                      const sujet = prompt('Sujet de l\'activité:');
                      if (!sujet) return;
                      crmApi.createActivity({
                        opportunityId: detailOpp.id,
                        companyId: detailOpp.companyId,
                        sujet,
                        typeActivite: 'TACHE',
                        dateActivite: new Date().toISOString().split('T')[0],
                      }).then(async () => {
                        const full = await crmApi.getOpportunity(detailOpp.id);
                        setDetailOpp(full);
                      }).catch(() => {});
                    }}
                    className="text-xs text-seaop-primary-600 hover:text-seaop-primary-700 font-medium flex items-center gap-1"
                  >
                    <Plus size={12} /> Activité
                  </button>
                </div>
              </div>
              {(() => {
                const timelineItems = [
                  ...(detailOpp.interactions || []).map((i: any) => ({ ...i, _type: 'interaction', _date: i.dateInteraction || i.createdAt, _title: i.resume, _sub: i.details, _badge: i.typeInteraction })),
                  ...(detailOpp.activities || []).map((a: any) => ({ ...a, _type: 'activite', _date: a.dateActivite || a.createdAt, _title: a.sujet, _sub: a.description, _badge: a.typeActivite, _statut: a.statut })),
                ].sort((a, b) => (b._date || '').localeCompare(a._date || ''));
                if (timelineItems.length === 0) return <p className="text-xs text-gray-400 italic">Aucun événement</p>;
                return (
                  <div className="space-y-2 max-h-[280px] overflow-y-auto">
                    {timelineItems.map((item: any, idx: number) => (
                      <div key={`${item._type}-${item.id}-${idx}`} className="flex items-start gap-2 p-2 rounded border border-gray-100 dark:border-gray-800">
                        <div className="flex flex-col items-center gap-1 shrink-0">
                          <Badge color={item._type === 'interaction' ? (INTERACTION_COLORS[item._badge] || 'blue') : (INTERACTION_COLORS[item._badge] || 'purple')} size="sm">
                            {INTERACTION_LABELS[item._badge] || item._badge}
                          </Badge>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 dark:text-white">{item._title}</p>
                          {item._sub && <p className="text-xs text-gray-500 mt-0.5">{item._sub}</p>}
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-gray-400">{formatDate(item._date)}</p>
                            <Badge color={item._type === 'interaction' ? 'blue' : 'purple'} size="sm">
                              {item._type === 'interaction' ? 'Inter.' : 'Act.'}
                            </Badge>
                            {item._statut && <Badge color={item._statut === 'TERMINE' ? 'green' : 'gray'} size="sm">{item._statut}</Badge>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* B.A.T. Qualification Grid */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <BATQualificationForm opportunityId={detailOpp.id} onSaved={() => { fetchData(); setDetailOpp(null); }} />
            </div>

            <div className="text-xs text-gray-400">
              Créé le {formatDate(detailOpp.createdAt)}
            </div>
          </div>
        )}
      </Modal>

      {/* Create modal */}
      {showCreate && (
        <OpportunityCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchData(); }}
          onError={onError}
        />
      )}
    </div>
  );
}


function PipelineCard({
  opportunity: opp,
  currentStatus,
  batScore,
  onStatusChange,
  onDoubleClick,
  onDropOnCard,
  onDragStart,
  onDragEnd,
}: {
  opportunity: Opportunity;
  currentStatus: string;
  batScore?: { scoreTotal: number; categorie: string };
  onStatusChange: (id: number, status: string) => void;
  onDoubleClick: (id: number) => void;
  onDropOnCard: (e: React.DragEvent, targetId: number, status: string) => void;
  onDragStart: (e: React.DragEvent, id: number, fromStatus: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  const statusIdx = STATUSES.indexOf(currentStatus as typeof STATUSES[number]);
  const nextStatus = statusIdx < 3 ? STATUSES[statusIdx + 1] : null;
  const [dragOver, setDragOver] = useState(false);

  return (
    <Card
      padding="sm"
      className={`!p-3 cursor-grab active:cursor-grabbing select-none hover:shadow-md transition-all ${
        dragOver ? 'ring-2 ring-seaop-primary-400 -translate-y-1' : ''
      }`}
      draggable
      onDoubleClick={() => onDoubleClick(opp.id)}
      onDragStart={(e: React.DragEvent) => onDragStart(e, opp.id, currentStatus)}
      onDragEnd={onDragEnd}
      onDragOver={(e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e: React.DragEvent) => { setDragOver(false); onDropOnCard(e, opp.id, currentStatus); }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">{opp.nom}</p>
          {opp.numeroOpportunite && (
            <span className="text-[10px] font-mono text-blue-500 dark:text-blue-400">{opp.numeroOpportunite}</span>
          )}
        </div>
        {opp.companyNom && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{opp.companyNom}</p>
        )}
        <div className="flex items-center justify-between">
          {opp.montantEstime != null && (
            <span className="text-sm font-semibold text-seaop-primary-600 dark:text-seaop-primary-400">
              {formatCurrency(opp.montantEstime)}
            </span>
          )}
          {opp.probabilite != null && (
            <span className="text-xs text-gray-400">{opp.probabilite}%</span>
          )}
        </div>
        {opp.dateCloturePrevue && (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Calendar size={10} />
            {formatDate(opp.dateCloturePrevue)}
          </div>
        )}
        {/* B.A.T. Score */}
        {batScore && (
          <div className="flex items-center gap-1.5 pt-0.5">
            <Award size={12} className={
              batScore.scoreTotal >= 75 ? 'text-green-500' :
              batScore.scoreTotal >= 50 ? 'text-yellow-500' : 'text-red-400'
            } />
            <span className={`text-xs font-semibold ${
              batScore.scoreTotal >= 75 ? 'text-green-600' :
              batScore.scoreTotal >= 50 ? 'text-yellow-600' : 'text-red-500'
            }`}>
              B.A.T. {batScore.scoreTotal}/100
            </span>
            <span className={`text-[10px] px-1 rounded ${
              batScore.categorie === 'A+' || batScore.categorie === 'A' ? 'bg-green-100 text-green-700' :
              batScore.categorie === 'B' ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              {batScore.categorie}
            </span>
          </div>
        )}
        {/* Quick advance buttons */}
        <div className="flex gap-1 pt-1">
          {nextStatus && (
            <button
              onClick={() => onStatusChange(opp.id, nextStatus)}
              className="flex items-center gap-1 text-xs text-seaop-primary-600 hover:text-seaop-primary-800 dark:text-seaop-primary-400"
              title={`Avancer vers ${STATUS_LABELS[nextStatus]}`}
            >
              <ArrowRight size={12} /> {STATUS_LABELS[nextStatus]}
            </button>
          )}
          <button
            onClick={() => onStatusChange(opp.id, 'GAGNE')}
            className="ml-auto text-xs text-green-600 hover:text-green-800"
            title="Marquer comme Gagne"
          >
            Gagne
          </button>
          <button
            onClick={() => onStatusChange(opp.id, 'PERDU')}
            className="text-xs text-red-500 hover:text-red-700"
            title="Marquer comme Perdu"
          >
            Perdu
          </button>
        </div>
      </div>
    </Card>
  );
}


// ============ Opportunités Tab (Table) ============

function OpportunitesTab({ onError, autoOpenId, onAutoOpenHandled }: {
  onError: (msg: string) => void;
  autoOpenId?: number | null;
  onAutoOpenHandled?: () => void;
}) {
  const navigate = useNavigate();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Opportunity | null>(null);
  // Mémorise le dernier ID auto-ouvert pour autoriser plusieurs deeplinks consécutifs
  const lastAutoOpenedIdRef = useRef<number | null>(null);
  const [creatingDevis, setCreatingDevis] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editCompanies, setEditCompanies] = useState<{ id: number; nom: string }[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const perPage = 20;

  const fetchOpportunities = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await crmApi.listOpportunities({
        page,
        perPage,
        search: search || undefined,
        statut: statusFilter || undefined,
      });
      setOpportunities(res.items);
      setTotal(res.total);
    } catch {
      onError('Erreur lors du chargement des opportunités');
    } finally {
      setIsLoading(false);
    }
  }, [page, search, statusFilter, onError]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  const handleSelect = async (id: number) => {
    setEditing(false);
    try {
      const opp = await crmApi.getOpportunity(id);
      setSelected(opp);
    } catch {
      onError('Erreur lors du chargement');
    }
  };

  // Auto-ouverture si autoOpenId fourni (deeplink ?open=ID).
  // Permet plusieurs deeplinks consécutifs en comparant l'ID (pas un boolean).
  useEffect(() => {
    if (autoOpenId && lastAutoOpenedIdRef.current !== autoOpenId) {
      lastAutoOpenedIdRef.current = autoOpenId;
      handleSelect(autoOpenId);
      onAutoOpenHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenId]);

  const handleDelete = async (opp: Opportunity) => {
    const nom = opp.nom || `#${opp.id}`;
    const statut = STATUS_LABELS[opp.statut] || opp.statut;
    const montant = opp.montantEstime ? ` — ${formatCurrency(opp.montantEstime)}` : '';
    const warnings: string[] = [];
    if (opp.devisId) warnings.push(`• Une soumission est liée (elle sera détachée, pas supprimée)`);
    if (opp.projetId) warnings.push(`• Un projet est lié (il sera détaché, pas supprimé)`);
    const warningText = warnings.length > 0 ? `\n\nAttention :\n${warnings.join('\n')}` : '';
    const msg = `Supprimer l'opportunité "${nom}" (${statut}${montant}) ?${warningText}\n\nCette action est irréversible.`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    try {
      await crmApi.deleteOpportunity(opp.id);
      setSelected(null);
      setSuccessMessage(`Opportunité "${nom}" supprimée`);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 4000);
      // Edge case: if we just deleted the last item on a non-first page,
      // step back a page so the user doesn't see an empty list.
      if (opportunities.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        fetchOpportunities();
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      onError(detail || 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateDevis = async (opportunityId: number) => {
    setCreatingDevis(true);
    try {
      await crmApi.createDevisFromOpportunity(opportunityId);
      navigate('/devis');
    } catch {
      onError('Erreur lors de la création de la soumission');
    } finally {
      setCreatingDevis(false);
    }
  };

  const startEditing = () => {
    if (!selected) return;
    setEditForm({
      nom: selected.nom || '',
      statut: selected.statut || 'PROSPECTION',
      montantEstime: selected.montantEstime ?? '',
      probabilite: selected.probabilite ?? '',
      dateCloturePrevue: selected.dateCloturePrevue || '',
      source: selected.source || '',
      notes: selected.notes || '',
      companyId: selected.companyId ?? '',
    });
    setEditing(true);
    // Load companies in background for dropdown
    // Backend /companies cape per_page a 100 -- demander plus retourne 422.
    import('@/api/companies').then(m => m.listCompanies({ perPage: 100 }))
      .then(res => setEditCompanies(res.items.map((c: any) => ({ id: c.id, nom: c.nom }))))
      .catch(() => { /* ignore */ });
  };

  const saveEdit = async () => {
    if (!selected) return;
    setEditSaving(true);
    try {
      await crmApi.updateOpportunity(selected.id, {
        nom: editForm.nom || undefined,
        statut: editForm.statut || undefined,
        montantEstime: editForm.montantEstime !== '' ? Number(editForm.montantEstime) : undefined,
        probabilite: editForm.probabilite !== '' ? Number(editForm.probabilite) : undefined,
        dateCloturePrevue: editForm.dateCloturePrevue || undefined,
        source: editForm.source || undefined,
        notes: editForm.notes || undefined,
        companyId: editForm.companyId ? Number(editForm.companyId) : undefined,
      });
      const updated = await crmApi.getOpportunity(selected.id);
      setSelected(updated);
      setEditing(false);
      fetchOpportunities();
    } catch {
      onError('Erreur lors de la sauvegarde');
    } finally {
      setEditSaving(false);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-4">
      <CommandBar
        actions={[
          { label: 'Nouvelle opportunité', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-36 sm:w-44 shrink-0">
              <Select options={STATUS_FILTER_OPTIONS} value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} />
            </div>
          </div>
        }
      />

      {successMessage && (
        <Alert type="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert>
      )}

      {/* Content */}
      <div className="flex gap-6">
        {/* Table — hidden on mobile when detail open */}
        <div className={`flex-1 min-w-0 ${selected ? 'hidden md:block md:max-w-[60%]' : ''}`}>
          {isLoading ? (
            <SkeletonPage />
          ) : (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">No.</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Entreprise</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Montant</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Prob.</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fermeture</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {opportunities.map((opp) => (
                        <tr
                          key={opp.id}
                          onClick={() => handleSelect(opp.id)}
                          className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
                            selected?.id === opp.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                          }`}
                        >
                          <td className="px-4 py-3 text-xs font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap">
                            {opp.numeroOpportunite || '--'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-white">{opp.nom}</div>
                            {opp.source && <div className="text-xs text-gray-400">{opp.source}</div>}
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                            {opp.companyNom || '--'}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                            {opp.montantEstime != null ? formatCurrency(opp.montantEstime) : '--'}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {opp.probabilite != null ? `${opp.probabilite}%` : '--'}
                          </td>
                          <td className="px-4 py-3">
                            <Badge color={STATUS_COLORS[opp.statut] || 'gray'}>
                              {STATUS_LABELS[opp.statut] || opp.statut}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {formatDate(opp.dateCloturePrevue)}
                          </td>
                        </tr>
                      ))}
                      {opportunities.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                          Aucune opportunité trouvée
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {opportunities.map((opp) => (
                  <div
                    key={opp.id}
                    onClick={() => handleSelect(opp.id)}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors active:bg-gray-50 dark:active:bg-gray-800/30 ${
                      selected?.id === opp.id
                        ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">{opp.nom}</span>
                      <Badge color={STATUS_COLORS[opp.statut] || 'gray'} size="sm">
                        {STATUS_LABELS[opp.statut] || opp.statut}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      {opp.companyNom && <span>{opp.companyNom}</span>}
                      {opp.montantEstime != null && (
                        <span className="font-semibold text-seaop-primary-600">{formatCurrency(opp.montantEstime)}</span>
                      )}
                      {opp.probabilite != null && <span>{opp.probabilite}%</span>}
                      {opp.dateCloturePrevue && (
                        <span className="flex items-center gap-1"><Calendar size={10} /> {formatDate(opp.dateCloturePrevue)}</span>
                      )}
                    </div>
                  </div>
                ))}
                {opportunities.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-8">Aucune opportunité trouvée</p>
                )}
              </div>

              {totalPages > 1 && (
                <div className="mt-4">
                  <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
              )}
              <p className="mt-2 text-xs text-gray-400 text-center">{total} opportunité{total !== 1 ? 's' : ''}</p>
            </>
          )}
        </div>

        {/* Detail Panel — mobile: full-width with back; desktop: sidebar */}
        {selected && (
          <>
          {/* Mobile back button + panel */}
          <div className="md:hidden flex-1">
            <button
              onClick={() => { setSelected(null); setEditing(false); }}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3"
            >
              <ChevronLeft size={16} /> Retour
            </button>
            <Card>
          <div className="flex items-start justify-between mb-4">
                <div className="min-w-0 flex-1 mr-2">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{selected.nom}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge color={STATUS_COLORS[selected.statut] || 'gray'}>
                      {STATUS_LABELS[selected.statut] || selected.statut}
                    </Badge>
                    {selected.numeroOpportunite && (
                      <span className="text-xs font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">
                        {selected.numeroOpportunite}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={startEditing} className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Modifier"><Pencil size={16} /></button>
                  <button onClick={() => handleDelete(selected)} disabled={deleting} title="Supprimer l'opportunité" className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"><Trash2 size={16} /></button>
                  <button onClick={() => { setSelected(null); setEditing(false); }} className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
                </div>
              </div>

              {editing ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Nom</label>
                    <input className="erp-input text-sm w-full" value={editForm.nom} onChange={(e) => setEditForm(f => ({ ...f, nom: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Statut</label>
                      <select className="erp-input text-sm w-full" value={editForm.statut} onChange={(e) => setEditForm(f => ({ ...f, statut: e.target.value }))}>
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Montant estimé</label>
                      <input type="number" className="erp-input text-sm w-full" value={editForm.montantEstime} onChange={(e) => setEditForm(f => ({ ...f, montantEstime: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Probabilité (%)</label>
                      <input type="number" min="0" max="100" className="erp-input text-sm w-full" value={editForm.probabilite} onChange={(e) => setEditForm(f => ({ ...f, probabilite: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Date fermeture</label>
                      <input type="date" className="erp-input text-sm w-full" value={editForm.dateCloturePrevue} onChange={(e) => setEditForm(f => ({ ...f, dateCloturePrevue: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Entreprise</label>
                    <select className="erp-input text-sm w-full" value={editForm.companyId} onChange={(e) => setEditForm(f => ({ ...f, companyId: e.target.value }))}>
                      <option value="">-- Aucune --</option>
                      {editCompanies.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
                    <input className="erp-input text-sm w-full" value={editForm.source} onChange={(e) => setEditForm(f => ({ ...f, source: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                    <textarea className="erp-input text-sm w-full" rows={3} value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={saveEdit} isLoading={editSaving} disabled={editSaving}>Enregistrer</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={editSaving}>Annuler</Button>
                  </div>
                </div>
              ) : (
              <div className="space-y-3 text-sm">
                {selected.companyNom && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Users size={14} /> {selected.companyNom}
                  </div>
                )}
                {(selected.contactPrenom || selected.contactNom) && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Mail size={14} /> {selected.contactPrenom} {selected.contactNom}
                  </div>
                )}
                {selected.montantEstime != null && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <DollarSign size={14} /> {formatCurrency(selected.montantEstime)}
                  </div>
                )}
                {selected.probabilite != null && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Target size={14} /> Probabilité: {selected.probabilite}%
                  </div>
                )}
                {selected.dateCloturePrevue && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Calendar size={14} /> Fermeture: {formatDate(selected.dateCloturePrevue)}
                  </div>
                )}
                {selected.source && (
                  <div className="text-gray-500">Source: {selected.source}</div>
                )}
                {selected.notes && (
                  <div className="text-gray-500 mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                    {selected.notes}
                  </div>
                )}
                <div className="text-xs text-gray-400">
                  Créé le {formatDate(selected.createdAt)}
                </div>
                <div className="pt-2 flex gap-2">
                  <Button size="sm" leftIcon={<FileText size={14} />} onClick={() => handleCreateDevis(selected.id)} isLoading={creatingDevis} disabled={creatingDevis}>Créer une soumission</Button>
                  {selected.dossierId && (
                    <Button size="sm" variant="outline" leftIcon={<FolderOpen size={14} />} onClick={() => navigate(`/dossiers?open=${selected.dossierId}`)}>Voir le dossier</Button>
                  )}
                </div>
              </div>
              )}

              {selected.interactions && selected.interactions.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Interactions ({selected.interactions.length})
                  </h4>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {selected.interactions.map((inter) => (
                      <div key={inter.id} className="flex items-start gap-2 p-2 rounded border border-gray-100 dark:border-gray-800">
                        <Badge color={INTERACTION_COLORS[inter.typeInteraction] || 'gray'} size="sm">
                          {INTERACTION_LABELS[inter.typeInteraction] || inter.typeInteraction}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{inter.resume}</p>
                          <p className="text-xs text-gray-400">{formatDate(inter.dateInteraction)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Desktop sidebar */}
          <div className="hidden md:block w-[40%] min-w-[300px]">
            <Card>
              <div className="flex items-start justify-between mb-4">
                <div className="min-w-0 flex-1 mr-2">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{selected.nom}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge color={STATUS_COLORS[selected.statut] || 'gray'}>
                      {STATUS_LABELS[selected.statut] || selected.statut}
                    </Badge>
                    {selected.numeroOpportunite && (
                      <span className="text-xs font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">
                        {selected.numeroOpportunite}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={startEditing} className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Modifier"><Pencil size={16} /></button>
                  <button onClick={() => handleDelete(selected)} disabled={deleting} title="Supprimer l'opportunité" className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"><Trash2 size={16} /></button>
                  <button onClick={() => { setSelected(null); setEditing(false); }} className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
                </div>
              </div>

              {editing ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Nom</label>
                    <input className="erp-input text-sm w-full" value={editForm.nom} onChange={(e) => setEditForm(f => ({ ...f, nom: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Statut</label>
                      <select className="erp-input text-sm w-full" value={editForm.statut} onChange={(e) => setEditForm(f => ({ ...f, statut: e.target.value }))}>
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Montant estimé</label>
                      <input type="number" className="erp-input text-sm w-full" value={editForm.montantEstime} onChange={(e) => setEditForm(f => ({ ...f, montantEstime: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Probabilité (%)</label>
                      <input type="number" min="0" max="100" className="erp-input text-sm w-full" value={editForm.probabilite} onChange={(e) => setEditForm(f => ({ ...f, probabilite: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Date fermeture</label>
                      <input type="date" className="erp-input text-sm w-full" value={editForm.dateCloturePrevue} onChange={(e) => setEditForm(f => ({ ...f, dateCloturePrevue: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Entreprise</label>
                    <select className="erp-input text-sm w-full" value={editForm.companyId} onChange={(e) => setEditForm(f => ({ ...f, companyId: e.target.value }))}>
                      <option value="">-- Aucune --</option>
                      {editCompanies.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
                    <input className="erp-input text-sm w-full" value={editForm.source} onChange={(e) => setEditForm(f => ({ ...f, source: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                    <textarea className="erp-input text-sm w-full" rows={3} value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={saveEdit} isLoading={editSaving} disabled={editSaving}>Enregistrer</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={editSaving}>Annuler</Button>
                  </div>
                </div>
              ) : (
              <div className="space-y-3 text-sm">
                {selected.companyNom && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Users size={14} /> {selected.companyNom}
                  </div>
                )}
                {(selected.contactPrenom || selected.contactNom) && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Mail size={14} /> {selected.contactPrenom} {selected.contactNom}
                  </div>
                )}
                {selected.montantEstime != null && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <DollarSign size={14} /> {formatCurrency(selected.montantEstime)}
                  </div>
                )}
                {selected.probabilite != null && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Target size={14} /> Probabilité: {selected.probabilite}%
                  </div>
                )}
                {selected.dateCloturePrevue && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Calendar size={14} /> Fermeture: {formatDate(selected.dateCloturePrevue)}
                  </div>
                )}
                {selected.source && (
                  <div className="text-gray-500">Source: {selected.source}</div>
                )}
                {selected.notes && (
                  <div className="text-gray-500 mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                    {selected.notes}
                  </div>
                )}
                <div className="text-xs text-gray-400">
                  Créé le {formatDate(selected.createdAt)}
                </div>
                <div className="pt-2 flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    leftIcon={<FileText size={14} />}
                    onClick={() => handleCreateDevis(selected.id)}
                    isLoading={creatingDevis}
                    disabled={creatingDevis}
                  >
                    Créer une soumission
                  </Button>
                  {selected.dossierId && (
                    <Button size="sm" variant="outline" leftIcon={<FolderOpen size={14} />}
                      onClick={() => navigate(`/dossiers?open=${selected.dossierId}`)}>
                      Voir le dossier
                    </Button>
                  )}
                </div>
              </div>
              )}
              {selected.interactions && selected.interactions.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Interactions ({selected.interactions.length})
                  </h4>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {selected.interactions.map((inter) => (
                      <div key={inter.id} className="flex items-start gap-2 p-2 rounded border border-gray-100 dark:border-gray-800">
                        <Badge color={INTERACTION_COLORS[inter.typeInteraction] || 'gray'} size="sm">
                          {INTERACTION_LABELS[inter.typeInteraction] || inter.typeInteraction}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{inter.resume}</p>
                          <p className="text-xs text-gray-400">{formatDate(inter.dateInteraction)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
          </>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <OpportunityCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchOpportunities(); }}
          onError={onError}
        />
      )}
    </div>
  );
}


// ============ Opportunity Create Modal ============

function OpportunityCreateModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<OpportunityCreate>({ nom: '', statut: 'PROSPECTION' });
  const [isSaving, setIsSaving] = useState(false);
  const [companies, setCompanies] = useState<{ id: number; nom: string }[]>([]);
  const [contacts, setContacts] = useState<{ id: number; prenom: string; nomFamille?: string; nom?: string; companyNom?: string }[]>([]);

  useEffect(() => {
    const fetchDropdowns = async () => {
      try {
        const [compRes, contRes] = await Promise.all([
          import('@/api/companies').then((m) => m.listCompanies({ perPage: 100 })),
          import('@/api/companies').then((m) => m.listContacts({ perPage: 100 })),
        ]);
        setCompanies(compRes.items);
        setContacts(contRes.items);
      } catch { /* ignore */ }
    };
    fetchDropdowns();
  }, []);

  const handleCreate = async () => {
    if (!form.nom.trim()) return;
    setIsSaving(true);
    try {
      await crmApi.createOpportunity(form);
      onCreated();
    } catch {
      onError('Erreur lors de la création');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Nouvelle opportunité" size="xl">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Column 1 */}
          <div className="space-y-4">
            <Input
              label="Nom de l'opportunité *"
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              placeholder="Ex: Rénovation cuisine Dupont"
              required
            />
            <Input
              label="No. PO Client"
              value={form.poClient || ''}
              onChange={(e) => setForm({ ...form, poClient: e.target.value })}
              placeholder="Ex: PO-12345"
            />
            <Select
              label="Client (Entreprise)"
              options={[
                { value: '', label: 'Sélectionner ou laisser vide' },
                ...companies.map((c) => ({ value: String(c.id), label: c.nom })),
              ]}
              value={form.companyId ? String(form.companyId) : ''}
              onChange={(e) => setForm({ ...form, companyId: e.target.value ? Number(e.target.value) : undefined })}
            />
            <Select
              label="Client (Personne)"
              options={[
                { value: '', label: 'Aucun contact' },
                ...contacts.map((c) => ({
                  value: String(c.id),
                  label: `${c.prenom} ${c.nomFamille || c.nom || ''}${c.companyNom ? ` (${c.companyNom})` : ''}`,
                })),
              ]}
              value={form.contactId ? String(form.contactId) : ''}
              onChange={(e) => setForm({ ...form, contactId: e.target.value ? Number(e.target.value) : undefined })}
            />
            <Input
              label="Saisie manuelle (si client non dans le CRM)"
              value={form.clientNomDirect || ''}
              onChange={(e) => setForm({ ...form, clientNomDirect: e.target.value })}
              placeholder="Ex: Jean Tremblay Construction"
            />
            <Select
              label="Statut"
              options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
              value={form.statut || 'PROSPECTION'}
              onChange={(e) => setForm({ ...form, statut: e.target.value })}
            />
            <Select
              label="Priorité"
              options={[
                { value: 'BASSE', label: 'Basse' },
                { value: 'NORMAL', label: 'Normal' },
                { value: 'HAUTE', label: 'Haute' },
                { value: 'URGENTE', label: 'Urgente' },
              ]}
              value={form.priorite || 'NORMAL'}
              onChange={(e) => setForm({ ...form, priorite: e.target.value })}
            />
          </div>

          {/* Column 2 */}
          <div className="space-y-4">
            <Input
              label="Source"
              value={form.source || ''}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="Ex: Site web, Recommandation, Salon..."
            />
            <Input
              label="Date limite de soumission"
              type="date"
              value={form.dateSoumission || ''}
              onChange={(e) => setForm({ ...form, dateSoumission: e.target.value || undefined })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Début prévu des travaux"
                type="date"
                value={form.dateDebutPrevu || ''}
                onChange={(e) => setForm({ ...form, dateDebutPrevu: e.target.value || undefined })}
              />
              <Input
                label="Fin prévue des travaux"
                type="date"
                value={form.dateFinPrevue || ''}
                onChange={(e) => setForm({ ...form, dateFinPrevue: e.target.value || undefined })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Montant estimé ($)"
                type="number"
                value={form.montantEstime ?? ''}
                onChange={(e) => setForm({ ...form, montantEstime: e.target.value ? Number(e.target.value) : undefined })}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Probabilité: {form.probabilite ?? 50}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={form.probabilite ?? 50}
                  onChange={(e) => setForm({ ...form, probabilite: Number(e.target.value) })}
                  className="w-full accent-seaop-primary-600"
                />
              </div>
            </div>
            <Input
              label="Date de clôture prévue"
              type="date"
              value={form.dateCloturePrevue || ''}
              onChange={(e) => setForm({ ...form, dateCloturePrevue: e.target.value || undefined })}
            />
            <Textarea
              label="Description"
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
            <Textarea
              label="Notes"
              value={form.notes || ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>
        </div>

        <p className="text-xs text-gray-400">* Champs obligatoires</p>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleCreate} disabled={!form.nom.trim()} isLoading={isSaving}>Enregistrer</Button>
        </div>
      </div>
    </Modal>
  );
}



// ============ Calendrier Tab ============

function CalendrierTab({ onError }: { onError: (msg: string) => void }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [events, setEvents] = useState<CrmCalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const fetchEvents = useCallback(async (y: number, m: number) => {
    setIsLoading(true);
    try {
      const res = await crmApi.getCrmCalendar({ year: y, month: m + 1 }); // API uses 1-indexed months
      setEvents(res.events);
    } catch {
      onError('Erreur lors du chargement du calendrier');
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    fetchEvents(year, month);
  }, [year, month, fetchEvents]);

  function goToPrevMonth() {
    setSelectedDay(null);
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  }

  function goToNextMonth() {
    setSelectedDay(null);
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  }

  function goToToday() {
    setSelectedDay(null);
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }

  // Build calendar grid
  const grid = useMemo(() => {
    const totalDaysCount = daysInMonth(year, month);
    const firstDayOfMonth = new Date(year, month, 1);
    let startDow = firstDayOfMonth.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const cells: { day: number | null; isToday: boolean; events: CrmCalendarEvent[] }[] = [];

    for (let i = 0; i < startDow; i++) {
      cells.push({ day: null, isToday: false, events: [] });
    }

    for (let d = 1; d <= totalDaysCount; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
      const dayEvents = events.filter((ev) => {
        const evDate = ev.date?.substring(0, 10);
        return evDate === dateStr;
      });
      cells.push({ day: d, isToday, events: dayEvents });
    }

    while (cells.length % 7 !== 0) {
      cells.push({ day: null, isToday: false, events: [] });
    }

    return cells;
  }, [year, month, events]);

  const selectedDayEvents = useMemo(() => {
    if (selectedDay === null) return [];
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    return events.filter((ev) => ev.date?.substring(0, 10) === dateStr);
  }, [selectedDay, year, month, events]);

  const CRM_EVENT_COLORS: Record<string, { dot: string; bg: string; text: string; label: string }> = {
    interaction: { dot: 'bg-[#7BAFD4]', bg: 'bg-[#7BAFD4]/10', text: 'text-[#4A7FA8] dark:text-[#9BC8E4]', label: 'Interaction' },
    activite: { dot: 'bg-[#B09BD8]', bg: 'bg-[#B09BD8]/10', text: 'text-[#7A6BA8] dark:text-[#C0ABE8]', label: 'Activité' },
    opportunite: { dot: 'bg-[#F0B07A]', bg: 'bg-[#F0B07A]/10', text: 'text-[#A06A2A] dark:text-[#F0C09A]', label: 'Clôture opp.' },
  };

  return (
    <div className="space-y-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={goToPrevMonth}>
            <ChevronLeft size={16} />
          </Button>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white min-w-[180px] text-center">
            {MONTH_NAMES_FR[month]} {year}
          </h3>
          <Button size="sm" variant="ghost" onClick={goToNextMonth}>
            <ChevronRight size={16} />
          </Button>
          <Button size="sm" variant="ghost" onClick={goToToday}>
            Aujourd&apos;hui
          </Button>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" /> Interaction</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500" /> Activité</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500" /> Clôture opp.</span>
        </div>
      </div>

      {isLoading ? (
        <SkeletonPage />
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          {/* Calendar grid */}
          <div className="flex-1 min-w-0">
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
              {/* Day headers */}
              <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-800/50">
                {DAY_NAMES_FR.map((d) => (
                  <div key={d} className="py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {grid.map((cell, i) => (
                  <div
                    key={i}
                    className={`min-h-[60px] md:min-h-[90px] border-b border-r border-gray-100 dark:border-gray-800 p-1 transition-colors ${
                      cell.day === null
                        ? 'bg-gray-50/50 dark:bg-gray-900/50'
                        : cell.day === selectedDay
                          ? 'bg-seaop-primary-50 dark:bg-seaop-primary-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer'
                    }`}
                    onClick={() => cell.day !== null && setSelectedDay(cell.day === selectedDay ? null : cell.day)}
                  >
                    {cell.day !== null && (
                      <>
                        <div className={`text-sm font-medium mb-0.5 ${
                          cell.isToday
                            ? 'bg-seaop-primary-600 text-white w-6 h-6 rounded-full flex items-center justify-center'
                            : 'text-gray-700 dark:text-gray-300 px-0.5'
                        }`}>
                          {cell.day}
                        </div>
                        <div className="space-y-0.5">
                          {cell.events.slice(0, 3).map((ev, idx) => {
                            const evStyle = CRM_EVENT_COLORS[ev.type] || CRM_EVENT_COLORS.interaction;
                            return (
                              <div key={idx} className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight ${evStyle.bg} ${evStyle.text} truncate`}>
                                <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${evStyle.dot}`} />
                                <span className="truncate">{ev.title}</span>
                              </div>
                            );
                          })}
                          {cell.events.length > 3 && (
                            <span className="text-[10px] text-gray-400 px-1">+{cell.events.length - 3} autres</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Side panel: selected day details */}
          {selectedDay !== null && (
            <div className="w-full md:w-72 flex-shrink-0">
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {selectedDay} {MONTH_NAMES_FR[month]} {year}
                  </h4>
                  <button onClick={() => setSelectedDay(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <X size={14} />
                  </button>
                </div>
                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Aucun événement</p>
                ) : (
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {selectedDayEvents.map((ev, idx) => {
                      const evStyle = CRM_EVENT_COLORS[ev.type] || CRM_EVENT_COLORS.interaction;
                      return (
                        <div key={idx} className={`rounded-lg p-3 ${evStyle.bg} border border-gray-100 dark:border-gray-800`}>
                          <div className="flex items-start gap-2">
                            <span className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${evStyle.dot}`} />
                            <div className="min-w-0">
                              <p className={`text-xs font-medium ${evStyle.text}`}>{evStyle.label}</p>
                              <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">{ev.title}</p>
                              {ev.sousType && (
                                <Badge color={INTERACTION_COLORS[ev.sousType] || 'gray'} size="sm">
                                  {INTERACTION_LABELS[ev.sousType] || ev.sousType}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ============ Timeline Tab ============

function TimelineTab({ onError }: { onError: (msg: string) => void }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string>('');
  const [companies, setCompanies] = useState<Array<{ id: number; nom: string }>>([]);

  const fetchTimeline = useCallback(async (companyId?: number) => {
    setIsLoading(true);
    try {
      const res = await crmApi.getCrmTimeline({
        companyId: companyId || undefined,
        limit: 50,
      });
      setItems(res.items);
    } catch {
      onError('Erreur lors du chargement de la timeline');
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  // Load companies for filter dropdown
  useEffect(() => {
    const loadCompanies = async () => {
      try {
        const res = await crmApi.getCrmTimeline({ limit: 200 });
        const uniqueCompanies = new Map<number, string>();
        for (const item of res.items) {
          if (item.companyId && item.companyNom) {
            uniqueCompanies.set(item.companyId, item.companyNom);
          }
        }
        setCompanies(Array.from(uniqueCompanies.entries()).map(([id, nom]) => ({ id, nom })));
        setItems(res.items);
        setIsLoading(false);
      } catch {
        onError('Erreur lors du chargement de la timeline');
        setIsLoading(false);
      }
    };
    loadCompanies();
  }, [onError]);

  useEffect(() => {
    if (companyFilter) {
      fetchTimeline(Number(companyFilter));
    } else {
      fetchTimeline();
    }
  }, [companyFilter, fetchTimeline]);

  const getTypeIcon = (type: string, sousType?: string) => {
    if (sousType) {
      const IconComp = INTERACTION_ICONS[sousType];
      if (IconComp) return IconComp;
    }
    if (type === 'interaction') return MessageSquare;
    if (type === 'activite') return Activity;
    return FileText;
  };

  const getTypeBg = (type: string, sousType?: string) => {
    if (sousType) {
      if (sousType === 'APPEL') return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
      if (sousType === 'EMAIL') return 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400';
      if (sousType === 'REUNION') return 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400';
      if (sousType === 'VISITE') return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400';
    }
    if (type === 'activite') return 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  };

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex gap-3 flex-wrap">
        <div className="w-full sm:w-64">
          <Select
            options={[
              { value: '', label: 'Toutes les entreprises' },
              ...companies.map((c) => ({ value: String(c.id), label: c.nom })),
            ]}
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Timeline feed */}
      {isLoading ? (
        <SkeletonPage />
      ) : (
        <div className="space-y-3">
          {items.map((item, idx) => {
            const Icon = getTypeIcon(item.type, item.sousType);
            const bgClass = getTypeBg(item.type, item.sousType);
            return (
              <Card key={`${item.type}-${item.id}-${idx}`} padding="sm">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 p-2 rounded-lg ${bgClass}`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge color={item.type === 'interaction' ? 'blue' : 'purple'} size="sm">
                        {item.type === 'interaction' ? 'Interaction' : 'Activité'}
                      </Badge>
                      {item.sousType && (
                        <Badge color={INTERACTION_COLORS[item.sousType] || 'gray'} size="sm">
                          {INTERACTION_LABELS[item.sousType] || item.sousType}
                        </Badge>
                      )}
                      {item.companyNom && (
                        <span className="text-xs text-gray-400">{item.companyNom}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{item.titre}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <Clock size={10} /> {formatDate(item.date)}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          {items.length === 0 && (
            <Card padding="lg">
              <p className="text-center text-gray-400">Aucun événement dans la timeline</p>
            </Card>
          )}
          <p className="mt-2 text-xs text-gray-400 text-center">{items.length} événement{items.length !== 1 ? 's' : ''}</p>
        </div>
      )}
    </div>
  );
}


// ============ Qualification Tab ============

function QualificationTab({ onError }: { onError: (msg: string) => void }) {
  const [items, setItems] = useState<QualificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const res = await crmApi.getQualifications();
        setItems(res.items);
      } catch {
        onError('Erreur lors du chargement des qualifications');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [onError]);

  if (isLoading) {
    return <SkeletonPage />;
  }

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="flex gap-4">
        {(['HOT', 'WARM', 'COLD'] as const).map((cat) => {
          const count = items.filter((i) => i.categorie === cat).length;
          return (
            <Card key={cat} padding="sm" className="flex-1">
              <div className="flex items-center justify-between">
                <Badge color={QUALIFICATION_COLORS[cat]} size="sm">
                  {QUALIFICATION_LABELS[cat]}
                </Badge>
                <span className="text-lg font-bold text-gray-900 dark:text-white">{count}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Desktop table */}
      <Card padding="sm" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Opportunité</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Score</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Catégorie</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Montant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Probabilité</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.map((item) => (
                <tr key={item.opportunityId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{item.nom}</div>
                    {item.companyNom && (
                      <div className="text-xs text-gray-400">{item.companyNom}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 max-w-[100px]">
                        <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              item.score >= 70 ? 'bg-red-500' :
                              item.score >= 40 ? 'bg-yellow-500' :
                              'bg-blue-400'
                            }`}
                            style={{ width: `${item.score}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white w-8 text-right">
                        {item.score}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={QUALIFICATION_COLORS[item.categorie] || 'gray'}>
                      {QUALIFICATION_LABELS[item.categorie] || item.categorie}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {item.montantEstime != null ? formatCurrency(item.montantEstime) : '--'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {item.probabilite != null ? `${item.probabilite}%` : '--'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.details.map((detail, idx) => (
                        <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                          {detail}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Aucune opportunité ouverte à qualifier
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {items.map((item) => (
          <div key={item.opportunityId} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="min-w-0 mr-2">
                <span className="text-sm font-medium text-gray-900 dark:text-white">{item.nom}</span>
                {item.companyNom && <span className="text-xs text-gray-400 ml-1.5">{item.companyNom}</span>}
              </div>
              <Badge color={QUALIFICATION_COLORS[item.categorie] || 'gray'} size="sm">
                {QUALIFICATION_LABELS[item.categorie] || item.categorie}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    item.score >= 70 ? 'bg-red-500' : item.score >= 40 ? 'bg-yellow-500' : 'bg-blue-400'
                  }`}
                  style={{ width: `${item.score}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-gray-900 dark:text-white">{item.score}/100</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              {item.montantEstime != null && (
                <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(item.montantEstime)}</span>
              )}
              {item.probabilite != null && <span>{item.probabilite}%</span>}
            </div>
            {item.details.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {item.details.map((detail, idx) => (
                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {detail}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">Aucune opportunité ouverte à qualifier</p>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-400 text-center">{items.length} opportunité{items.length !== 1 ? 's' : ''} qualifiée{items.length !== 1 ? 's' : ''}</p>
    </div>
  );
}
