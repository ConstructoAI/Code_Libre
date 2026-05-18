/**
 * ERP React Frontend - Projects Page
 * Project list with search, filters, inline detail with phases.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Search, Calendar, MapPin, Pencil, Bot, Download, Copy, CheckSquare, FolderOpen, ChevronLeft, Trash2, DollarSign, TrendingUp, TrendingDown, Package, Users } from 'lucide-react';
import * as projectsApi from '@/api/projects';
import * as companiesApi from '@/api/companies';
import * as devisApi from '@/api/devis';
import type { Devis } from '@/api/devis';
import type { Company, Contact } from '@/api/companies';
import type { Project, ProjectNote, ProjectFinancials } from '@/api/projects';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { formatDate, formatCurrency } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useColumnResize } from '@/hooks/useColumnResize';
import { CommandBar } from '@/components/ui/CommandBar';

const STATUT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'En attente', label: 'En attente' },
  { value: 'En cours', label: 'En cours' },
  { value: 'Termine', label: 'Terminé' },
  { value: 'Annule', label: 'Annulé' },
];

const PRIORITE_OPTIONS = [
  { value: 'Basse', label: 'Basse' }, { value: 'Moyenne', label: 'Moyenne' },
  { value: 'Haute', label: 'Haute' }, { value: 'Urgente', label: 'Urgente' },
];

const STATUT_COLORS: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'amber'> = {
  'En attente': 'yellow', 'En cours': 'blue', 'Termine': 'green', 'Annule': 'red', 'Suspendu': 'amber',
};

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statutFilter, setStatutFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [form, setForm] = useState({
    nomProjet: '', statut: 'En attente', priorite: 'Moyenne',
    poClient: '', clientCompanyId: '', clientContactId: '', clientNomDirect: '',
    dateDebut: '', dateFin: '', budget: '', description: '',
    adresseChantier: '', villeChantier: '',
  });
  const [createCompanies, setCreateCompanies] = useState<Company[]>([]);
  const [createContacts, setCreateContacts] = useState<Contact[]>([]);
  const [linkedDossierId, setLinkedDossierId] = useState<number | null>(null);
  const [linkedDevis, setLinkedDevis] = useState<Devis | null>(null);
  const perPage = 20;

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Project>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Notes state (+ IA categorization)
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteForm, setNoteForm] = useState({ titre: '', contenu: '', categorie: '' });
  const [categorizingNoteId, setCategorizingNoteId] = useState<number | null>(null);

  // Project financials
  const [financials, setFinancials] = useState<ProjectFinancials | null>(null);
  const [financialsLoading, setFinancialsLoading] = useState(false);
  const [showFinancials, setShowFinancials] = useState(false);

  // New feature state
  const [viewMode, setViewMode] = useState<'list' | 'table' | 'cards'>('list');
  const [statistics, setStatistics] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  // Inline date editing in list
  const [editingDateCell, setEditingDateCell] = useState<{ id: number; field: 'dateDebutReel' | 'dateFinReel' } | null>(null);
  const saveInlineDate = async (projectId: number, field: 'dateDebutReel' | 'dateFinReel', value: string) => {
    try {
      await projectsApi.updateProject(String(projectId), { [field]: value || undefined } as any);
      setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, [field]: value || undefined } : p));
    } catch { setError('Erreur lors de la sauvegarde de la date'); }
    setEditingDateCell(null);
  };

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await projectsApi.listProjects({
        page, perPage, search: search || undefined, statut: statutFilter || undefined,
      });
      setProjects(res.items);
      setTotal(res.total);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [page, search, statutFilter]);

  useEffect(() => { fetchProjects(); fetchStatistics(); }, [fetchProjects]);

  // Auto-open item from ?open= query param (e.g. from calendar double-click)
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenHandled = useRef(false);
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && !autoOpenHandled.current) {
      autoOpenHandled.current = true;
      handleSelect(openId);
      searchParams.delete('open');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  const fetchStatistics = async () => {
    try {
      const stats = await projectsApi.getProjectStatistics();
      setStatistics(stats);
    } catch {}
  };

  const fetchFinancials = async (projectId: number | string) => {
    setFinancialsLoading(true);
    try {
      const res = await projectsApi.getProjectFinancials(projectId);
      setFinancials(res);
    } catch { setFinancials(null); }
    finally { setFinancialsLoading(false); }
  };

  const handleDuplicate = async () => {
    if (!selected) return;
    try {
      const res = await projectsApi.duplicateProject(selected.id);
      setSuccess('Projet dupliqué avec succès (ID: ' + res.id + ')');
      fetchProjects();
    } catch { setError('Erreur lors de la duplication'); }
  };

  const handleDeleteProject = async (id: string | number) => {
    if (!confirm('Supprimer ce projet?')) return;
    try {
      await projectsApi.deleteProject(String(id));
      setSelected(null);
      setLinkedDevis(null);
      setLinkedDossierId(null);
      setNotes([]);
      fetchProjects();
      fetchStatistics();
      setSuccess('Projet supprimé');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Erreur lors de la suppression');
    }
  };

  const handleExportCsv = async () => {
    try {
      const blob = await projectsApi.exportProjectsCsv();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'projets_export.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { setError('Erreur lors de l\'export CSV'); }
  };

  const handleBatchUpdate = async (statut: string) => {
    if (selectedIds.length === 0) return;
    try {
      const res = await projectsApi.batchUpdateProjects({ projectIds: selectedIds, statut });
      setSuccess(res.message);
      setSelectedIds([]);
      fetchProjects();
      fetchStatistics();
    } catch { setError('Erreur lors de la mise à jour en lot'); }
  };

  const toggleSelectId = (id: string | number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };


  const openCreateProject = () => {
    setForm({ nomProjet: '', statut: 'En attente', priorite: 'Moyenne', poClient: '', clientCompanyId: '', clientContactId: '', clientNomDirect: '', dateDebut: '', dateFin: '', budget: '', description: '', adresseChantier: '', villeChantier: '' });
    companiesApi.listCompanies({ perPage: 100 }).then(r => setCreateCompanies(r.items)).catch(() => {});
    companiesApi.listContacts({ perPage: 100 }).then(r => setCreateContacts(r.items)).catch(() => {});
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!form.nomProjet.trim()) return;
    try {
      await projectsApi.createProject({
        nomProjet: form.nomProjet,
        statut: form.statut,
        priorite: form.priorite,
        poClient: form.poClient || undefined,
        clientCompanyId: form.clientCompanyId ? Number(form.clientCompanyId) : undefined,
        clientContactId: form.clientContactId ? Number(form.clientContactId) : undefined,
        clientNomDirect: form.clientNomDirect || undefined,
        dateDebutReel: form.dateDebut || undefined,
        dateFinReel: form.dateFin || undefined,
        budget: form.budget ? parseFloat(form.budget) : undefined,
        description: form.description || undefined,
        adresseChantier: form.adresseChantier || undefined,
        villeChantier: form.villeChantier || undefined,
      });
      setShowCreate(false);
      fetchProjects();
      fetchStatistics();
    } catch { setError('Erreur de création'); }
  };

  const selectIdRef = useRef<string | number | null>(null);

  const handleSelect = async (id: string | number) => {
    selectIdRef.current = id;
    // Clear stale data immediately
    setLinkedDevis(null);
    setLinkedDossierId(null);
    setNotes([]);
    setFinancials(null);
    setShowFinancials(false);
    try {
      const p = await projectsApi.getProject(id);
      if (selectIdRef.current !== id) return; // stale
      setSelected(p);

      // Fetch secondary data in parallel
      const [notesResult, dossierResult, devisResult] = await Promise.allSettled([
        projectsApi.listProjectNotes(String(id)),
        projectsApi.getProjectDossier(String(id)),
        p.devisId ? devisApi.getDevis(p.devisId) : Promise.resolve(null),
      ]);
      if (selectIdRef.current !== id) return; // stale

      setNotes(notesResult.status === 'fulfilled' ? (notesResult.value?.items || []) : []);
      setLinkedDossierId(dossierResult.status === 'fulfilled' ? (dossierResult.value?.dossier?.id ?? null) : null);
      setLinkedDevis(devisResult.status === 'fulfilled' ? devisResult.value : null);
    } catch { setError('Erreur'); }
  };

  const openEdit = (project: Project) => {
    setEditForm({
      nomProjet: project.nomProjet,
      description: project.description || '',
      statut: project.statut,
      priorite: project.priorite,
      dateDebut: project.dateDebutReel || project.dateDebut || '',
      dateFin: project.dateFinReel || project.dateFin || '',
      budget: project.budget || undefined,
      adresseChantier: project.adresseChantier || '',
      villeChantier: project.villeChantier || '',
      gestionnaire: project.gestionnaire || '',
      notes: project.notes || '',
    });
    setEditError(null);
    setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!selected || !editForm.nomProjet?.trim()) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const { dateDebut, dateFin, ...rest } = editForm;
      await projectsApi.updateProject(selected.id, {
        ...rest,
        dateDebutReel: dateDebut,
        dateFinReel: dateFin,
      });
      setShowEdit(false);
      const updated = await projectsApi.getProject(selected.id);
      setSelected(updated);
      fetchProjects();
    } catch {
      setEditError('Erreur lors de la mise à jour');
    } finally {
      setEditLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!selected || !noteForm.titre.trim() || !noteForm.contenu.trim()) return;
    try {
      await projectsApi.createProjectNote(String(selected.id), {
        titre: noteForm.titre,
        contenu: noteForm.contenu,
        categorie: noteForm.categorie || undefined,
      });
      setShowAddNote(false);
      setNoteForm({ titre: '', contenu: '', categorie: '' });
      const notesRes = await projectsApi.listProjectNotes(String(selected.id));
      setNotes(notesRes.items || []);
    } catch { setError('Erreur lors de la création de la note'); }
  };

  const handleCategorize = async (noteId: number) => {
    if (!selected) return;
    setCategorizingNoteId(noteId);
    try {
      await projectsApi.categorizeNote(String(selected.id), noteId);
      const notesRes = await projectsApi.listProjectNotes(String(selected.id));
      setNotes(notesRes.items || []);
    } catch { setError('Erreur lors de la categorisation IA'); }
    finally { setCategorizingNoteId(null); }
  };

  const totalPages = Math.ceil(total / perPage);
  const { sortedItems: sortedProjects, sortConfig, requestSort } = useSortable(projects);
  const { colWidths: listColWidths, startResize: listStartResize, autoFit: listAutoFit } = useColumnResize({ numeroProjet: 130, nomProjet: 200, clientNom: 150, budget: 100, statut: 100, priorite: 100, dateDebut: 110, dateFin: 110, actions: 80 });
  const { colWidths: tableColWidths, startResize: tableStartResize, autoFit: tableAutoFit } = useColumnResize({ id: 60, nomProjet: 180, clientNom: 130, typeProjet: 100, budget: 100, statut: 100, priorite: 100, dateDebut: 100, dateFin: 100, ville: 110 });

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Projets</h2>
      </div>

      {/* KPI Stats Cards — always visible */}
      {statistics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
          <Card padding="sm">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-semibold mb-0.5 sm:mb-1">Total projets</div>
            <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{statistics.total || 0}</div>
          </Card>
          <Card padding="sm">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-semibold mb-0.5 sm:mb-1">En cours</div>
            <div className="text-lg sm:text-2xl font-bold text-blue-600">{(statistics as any).enCours ?? statistics.en_cours ?? 0}</div>
          </Card>
          <Card padding="sm">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-semibold mb-0.5 sm:mb-1">Terminés</div>
            <div className="text-lg sm:text-2xl font-bold text-green-600">{(statistics as any).termines ?? statistics.termines ?? 0}</div>
          </Card>
          <Card padding="sm">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase font-semibold mb-0.5 sm:mb-1">Budget total</div>
            <div className="text-lg sm:text-2xl font-bold text-seaop-primary-600 dark:text-seaop-primary-400 truncate">{formatCurrency((statistics as any).budgetTotal ?? statistics.budget_total ?? 0)}</div>
          </Card>
        </div>
      )}

      {/* View Mode Selector */}
      <div className="flex gap-2 mb-3">
        {(['list', 'table', 'cards'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-3 py-1 text-xs rounded ${viewMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
          >
            {mode === 'list' ? 'Liste' : mode === 'table' ? 'Tableau' : 'Cartes'}
          </button>
        ))}
      </div>

      {/* Batch Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-3">
          <CheckSquare size={16} className="text-blue-600" />
          <span className="text-sm text-blue-700 dark:text-blue-300">{selectedIds.length} projet(s) selectionne(s)</span>
          <select
            onChange={(e) => { if (e.target.value) handleBatchUpdate(e.target.value); e.target.value = ''; }}
            className="text-xs border rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600"
            defaultValue=""
          >
            <option value="" disabled>Changer le statut...</option>
            <option value="En attente">En attente</option>
            <option value="En cours">En cours</option>
            <option value="Termine">Terminé</option>
            <option value="Annule">Annulé</option>
            <option value="Suspendu">Suspendu</option>
          </select>
          <button onClick={() => setSelectedIds([])} className="text-xs text-gray-500 hover:text-gray-700">Désélectionner</button>
        </div>
      )}

      <CommandBar
        actions={[
          { label: 'Nouveau projet', icon: <Plus size={16} />, onClick: openCreateProject, variant: 'primary' },
          { label: 'Exporter CSV', icon: <Download size={16} />, onClick: handleExportCsv },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-28 sm:w-36 shrink-0">
              <Select options={STATUT_OPTIONS} value={statutFilter}
                onChange={(e) => { setStatutFilter(e.target.value); setPage(1); }} />
            </div>
          </div>
        }
      />

      <div className="flex flex-col md:flex-row gap-6">
        <div className={`flex-1 ${selected ? 'hidden md:block md:max-w-[55%]' : ''}`}>
          {isLoading ? <SkeletonPage /> : (
            <>
              {/* List View */}
              {viewMode === 'list' && (
              <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-2 py-3 text-left" style={{ width: 36 }}>
                          <input type="checkbox"
                            checked={selectedIds.length === projects.length && projects.length > 0}
                            onChange={() => setSelectedIds(selectedIds.length === projects.length ? [] : projects.map(p => p.id))}
                            className="rounded"
                          />
                        </th>
                        <SortableHeader sortKey="numeroProjet" sortConfig={sortConfig} onSort={requestSort} width={listColWidths.numeroProjet} onResizeStart={(e) => listStartResize(e, 'numeroProjet')} onAutoFit={(e) => listAutoFit(e, 'numeroProjet')} className="px-4 py-3 uppercase">Numéro</SortableHeader>
                        <SortableHeader sortKey="nomProjet" sortConfig={sortConfig} onSort={requestSort} width={listColWidths.nomProjet} onResizeStart={(e) => listStartResize(e, 'nomProjet')} onAutoFit={(e) => listAutoFit(e, 'nomProjet')} className="px-4 py-3 uppercase">Nom</SortableHeader>
                        <SortableHeader sortKey="clientNom" sortConfig={sortConfig} onSort={requestSort} width={listColWidths.clientNom} onResizeStart={(e) => listStartResize(e, 'clientNom')} onAutoFit={(e) => listAutoFit(e, 'clientNom')} className="px-4 py-3 uppercase">Client</SortableHeader>
                        <SortableHeader sortKey="budget" sortConfig={sortConfig} onSort={requestSort} align="right" width={listColWidths.budget} onResizeStart={(e) => listStartResize(e, 'budget')} onAutoFit={(e) => listAutoFit(e, 'budget')} className="px-4 py-3 uppercase">Budget</SortableHeader>
                        <SortableHeader sortKey="statut" sortConfig={sortConfig} onSort={requestSort} align="center" width={listColWidths.statut} onResizeStart={(e) => listStartResize(e, 'statut')} onAutoFit={(e) => listAutoFit(e, 'statut')} className="px-4 py-3 uppercase">Statut</SortableHeader>
                        <SortableHeader sortKey="priorite" sortConfig={sortConfig} onSort={requestSort} align="center" width={listColWidths.priorite} onResizeStart={(e) => listStartResize(e, 'priorite')} onAutoFit={(e) => listAutoFit(e, 'priorite')} className="px-4 py-3 uppercase">Priorité</SortableHeader>
                        <SortableHeader sortKey="dateDebutReel" sortConfig={sortConfig} onSort={requestSort} width={listColWidths.dateDebut} onResizeStart={(e) => listStartResize(e, 'dateDebut')} onAutoFit={(e) => listAutoFit(e, 'dateDebut')} className="px-4 py-3 uppercase">Début prévu</SortableHeader>
                        <SortableHeader sortKey="dateFinReel" sortConfig={sortConfig} onSort={requestSort} width={listColWidths.dateFin} onResizeStart={(e) => listStartResize(e, 'dateFin')} onAutoFit={(e) => listAutoFit(e, 'dateFin')} className="px-4 py-3 uppercase">Date Fin</SortableHeader>
                        <th className="px-4 py-3" style={{ width: listColWidths.actions }}></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedProjects.map((p) => (
                        <tr key={p.id}
                          className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selected?.id === p.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                          <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selectedIds.includes(p.id)}
                              onChange={() => toggleSelectId(p.id)} className="rounded" />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-blue-600 dark:text-blue-400" onClick={() => handleSelect(p.id)}>{p.numeroProjet || '--'}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white" onClick={() => handleSelect(p.id)}>{p.nomProjet}</td>
                          <td className="px-4 py-3 text-gray-500" onClick={() => handleSelect(p.id)}>{p.clientNom || '--'}</td>
                          <td className="px-4 py-3 text-right font-medium" onClick={() => handleSelect(p.id)}>{p.budget ? formatCurrency(p.budget) : '--'}</td>
                          <td className="px-4 py-3 text-center" onClick={() => handleSelect(p.id)}><Badge color={STATUT_COLORS[p.statut] || 'gray'} size="sm">{p.statut}</Badge></td>
                          <td className="px-4 py-3 text-center" onClick={() => handleSelect(p.id)}><Badge color="gray" size="sm">{p.priorite}</Badge></td>
                          <td className="px-4 py-3 text-xs text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: p.id, field: 'dateDebutReel' }); }}>
                            {editingDateCell?.id === p.id && editingDateCell.field === 'dateDebutReel' ? (
                              <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={p.dateDebutReel || p.dateDebut || ''} onChange={(e) => saveInlineDate(p.id, 'dateDebutReel', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                            ) : (formatDate(p.dateDebutReel || p.dateDebut) || '--')}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: p.id, field: 'dateFinReel' }); }}>
                            {editingDateCell?.id === p.id && editingDateCell.field === 'dateFinReel' ? (
                              <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={p.dateFinReel || p.dateFin || ''} onChange={(e) => saveInlineDate(p.id, 'dateFinReel', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                            ) : (formatDate(p.dateFinReel || p.dateFin) || '--')}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id); }} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-600 transition-colors" title="Supprimer"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                      {projects.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Aucun projet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {sortedProjects.map((p) => (
                  <Card key={p.id} padding="sm" className={`cursor-pointer ${selected?.id === p.id ? 'ring-2 ring-blue-500' : ''}`}>
                    <div onClick={() => handleSelect(p.id)}>
                      <div className="flex items-start justify-between mb-1">
                        <h4 className="font-medium text-sm text-gray-900 dark:text-white truncate">{p.nomProjet}</h4>
                        <Badge color={STATUT_COLORS[p.statut] || 'gray'} size="sm">{p.statut}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{p.clientNom || 'Sans client'}</p>
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span className="font-medium">{p.budget ? formatCurrency(p.budget) : '--'}</span>
                        <span>{formatDate(p.createdAt)}</span>
                      </div>
                    </div>
                  </Card>
                ))}
                {projects.length === 0 && (
                  <p className="text-gray-400 text-center py-8">Aucun projet</p>
                )}
              </div>
              </>
              )}

              {/* Table View (compact with more columns) */}
              {viewMode === 'table' && (
              <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-1 py-2" style={{ width: 28 }}>
                          <input type="checkbox"
                            checked={selectedIds.length === projects.length && projects.length > 0}
                            onChange={() => setSelectedIds(selectedIds.length === projects.length ? [] : projects.map(p => p.id))}
                            className="rounded"
                          />
                        </th>
                        <SortableHeader sortKey="id" sortConfig={sortConfig} onSort={requestSort} width={tableColWidths.id} onResizeStart={(e) => tableStartResize(e, 'id')} onAutoFit={(e) => tableAutoFit(e, 'id')} className="px-2 py-2">ID</SortableHeader>
                        <SortableHeader sortKey="nomProjet" sortConfig={sortConfig} onSort={requestSort} width={tableColWidths.nomProjet} onResizeStart={(e) => tableStartResize(e, 'nomProjet')} onAutoFit={(e) => tableAutoFit(e, 'nomProjet')} className="px-2 py-2">Nom</SortableHeader>
                        <SortableHeader sortKey="clientNom" sortConfig={sortConfig} onSort={requestSort} width={tableColWidths.clientNom} onResizeStart={(e) => tableStartResize(e, 'clientNom')} onAutoFit={(e) => tableAutoFit(e, 'clientNom')} className="px-2 py-2">Client</SortableHeader>
                        <SortableHeader sortKey="typeProjet" sortConfig={sortConfig} onSort={requestSort} width={tableColWidths.typeProjet} onResizeStart={(e) => tableStartResize(e, 'typeProjet')} onAutoFit={(e) => tableAutoFit(e, 'typeProjet')} className="px-2 py-2">Type</SortableHeader>
                        <SortableHeader sortKey="budget" sortConfig={sortConfig} onSort={requestSort} align="right" width={tableColWidths.budget} onResizeStart={(e) => tableStartResize(e, 'budget')} onAutoFit={(e) => tableAutoFit(e, 'budget')} className="px-2 py-2">Budget</SortableHeader>
                        <SortableHeader sortKey="statut" sortConfig={sortConfig} onSort={requestSort} align="center" width={tableColWidths.statut} onResizeStart={(e) => tableStartResize(e, 'statut')} onAutoFit={(e) => tableAutoFit(e, 'statut')} className="px-2 py-2">Statut</SortableHeader>
                        <SortableHeader sortKey="priorite" sortConfig={sortConfig} onSort={requestSort} align="center" width={tableColWidths.priorite} onResizeStart={(e) => tableStartResize(e, 'priorite')} onAutoFit={(e) => tableAutoFit(e, 'priorite')} className="px-2 py-2">Priorité</SortableHeader>
                        <SortableHeader sortKey="dateDebutReel" sortConfig={sortConfig} onSort={requestSort} width={tableColWidths.dateDebut} onResizeStart={(e) => tableStartResize(e, 'dateDebut')} onAutoFit={(e) => tableAutoFit(e, 'dateDebut')} className="px-2 py-2">Début</SortableHeader>
                        <SortableHeader sortKey="dateFinReel" sortConfig={sortConfig} onSort={requestSort} width={tableColWidths.dateFin} onResizeStart={(e) => tableStartResize(e, 'dateFin')} onAutoFit={(e) => tableAutoFit(e, 'dateFin')} className="px-2 py-2">Fin</SortableHeader>
                        <SortableHeader sortKey="villeChantier" sortConfig={sortConfig} onSort={requestSort} width={tableColWidths.ville} onResizeStart={(e) => tableStartResize(e, 'ville')} onAutoFit={(e) => tableAutoFit(e, 'ville')} className="px-2 py-2">Ville</SortableHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedProjects.map((p) => (
                        <tr key={p.id}
                          className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selected?.id === p.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                          <td className="px-1 py-1.5" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selectedIds.includes(p.id)}
                              onChange={() => toggleSelectId(p.id)} className="rounded" />
                          </td>
                          <td className="px-2 py-1.5 font-mono text-gray-500" onClick={() => handleSelect(p.id)}>{p.id}</td>
                          <td className="px-2 py-1.5 font-medium text-gray-900 dark:text-white truncate max-w-[150px]" onClick={() => handleSelect(p.id)}>{p.nomProjet}</td>
                          <td className="px-2 py-1.5 text-gray-500 truncate max-w-[120px]" onClick={() => handleSelect(p.id)}>{p.clientNom || '--'}</td>
                          <td className="px-2 py-1.5 text-gray-500" onClick={() => handleSelect(p.id)}>{p.typeProjet || '--'}</td>
                          <td className="px-2 py-1.5 text-right" onClick={() => handleSelect(p.id)}>{p.budget ? formatCurrency(p.budget) : '--'}</td>
                          <td className="px-2 py-1.5 text-center" onClick={() => handleSelect(p.id)}><Badge color={STATUT_COLORS[p.statut] || 'gray'} size="sm">{p.statut}</Badge></td>
                          <td className="px-2 py-1.5 text-center" onClick={() => handleSelect(p.id)}><Badge color="gray" size="sm">{p.priorite}</Badge></td>
                          <td className="px-2 py-1.5 text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: p.id, field: 'dateDebutReel' }); }}>
                            {editingDateCell?.id === p.id && editingDateCell.field === 'dateDebutReel' ? (
                              <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={p.dateDebutReel || p.dateDebut || ''} onChange={(e) => saveInlineDate(p.id, 'dateDebutReel', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                            ) : (formatDate(p.dateDebutReel || p.dateDebut) || '--')}
                          </td>
                          <td className="px-2 py-1.5 text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: p.id, field: 'dateFinReel' }); }}>
                            {editingDateCell?.id === p.id && editingDateCell.field === 'dateFinReel' ? (
                              <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={p.dateFinReel || p.dateFin || ''} onChange={(e) => saveInlineDate(p.id, 'dateFinReel', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                            ) : (formatDate(p.dateFinReel || p.dateFin) || '--')}
                          </td>
                          <td className="px-2 py-1.5 text-gray-400" onClick={() => handleSelect(p.id)}>{p.villeChantier || '--'}</td>
                        </tr>
                      ))}
                      {projects.length === 0 && (
                        <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Aucun projet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards for table view */}
              <div className="md:hidden space-y-3">
                {sortedProjects.map((p) => (
                  <Card key={p.id} padding="sm" className={`cursor-pointer ${selected?.id === p.id ? 'ring-2 ring-blue-500' : ''}`}>
                    <div onClick={() => handleSelect(p.id)}>
                      <div className="flex items-start justify-between mb-1">
                        <h4 className="font-medium text-sm text-gray-900 dark:text-white truncate">{p.nomProjet}</h4>
                        <Badge color={STATUT_COLORS[p.statut] || 'gray'} size="sm">{p.statut}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mb-1">{p.clientNom || 'Sans client'}</p>
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span className="font-medium">{p.budget ? formatCurrency(p.budget) : '--'}</span>
                        <Badge color="gray" size="sm">{p.priorite}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>{(p.dateDebutReel || p.dateDebut) ? formatDate(p.dateDebutReel || p.dateDebut) : '--'} - {(p.dateFinReel || p.dateFin) ? formatDate(p.dateFinReel || p.dateFin) : '--'}</span>
                        {p.villeChantier && <span className="flex items-center gap-1"><MapPin size={10} />{p.villeChantier}</span>}
                      </div>
                    </div>
                  </Card>
                ))}
                {projects.length === 0 && (
                  <p className="text-gray-400 text-center py-8">Aucun projet</p>
                )}
              </div>
              </>
              )}

              {/* Cards View */}
              {viewMode === 'cards' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedProjects.map(p => (
                  <div
                    key={p.id}
                    onClick={() => handleSelect(p.id)}
                    className={`bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 cursor-pointer hover:shadow-md transition-shadow ${selected?.id === p.id ? 'ring-2 ring-seaop-primary-500' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={selectedIds.includes(p.id)}
                          onChange={(e) => { e.stopPropagation(); toggleSelectId(p.id); }}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded" />
                        <Badge color={STATUT_COLORS[p.statut] || 'gray'} size="sm">{p.statut}</Badge>
                      </div>
                      <Badge color="gray" size="sm">{p.priorite}</Badge>
                    </div>
                    <h3 className="font-medium text-sm mb-1 truncate">{p.nomProjet}</h3>
                    <p className="text-xs text-gray-500 mb-2">{p.clientNom || 'Sans client'}</p>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{p.budget ? formatCurrency(p.budget) : '--'}</span>
                      {(p.dateFinReel || p.dateFin) && <span className="flex items-center gap-1"><Calendar size={10} />{formatDate(p.dateFinReel || p.dateFin)}</span>}
                    </div>
                    {p.villeChantier && (
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <MapPin size={10} />{p.villeChantier}
                      </p>
                    )}
                  </div>
                ))}
                {projects.length === 0 && (
                  <p className="text-gray-400 col-span-full text-center py-8">Aucun projet</p>
                )}
              </div>
              )}

              {totalPages > 1 && <div className="mt-4"><Pagination page={page} totalPages={totalPages} onPageChange={setPage} /></div>}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-full md:w-[45%] md:min-w-[320px]">
            {/* Mobile back button */}
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 mb-3 md:hidden"
            >
              <ChevronLeft size={16} />
              Retour a la liste
            </button>
            <Card>
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{selected.nomProjet}</h3>
                <div className="flex gap-1">
                  <button
                    onClick={handleDuplicate}
                    className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                    title="Dupliquer"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => openEdit(selected)}
                    className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                    title="Modifier"
                  >
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setSelected(null)} className="hidden md:block p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
                    <span className="text-lg leading-none">&times;</span>
                  </button>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <Badge color={STATUT_COLORS[selected.statut] || 'gray'}>{selected.statut}</Badge>
                  <Badge color="gray">{selected.priorite}</Badge>
                </div>
                {linkedDossierId && (
                  <button
                    onClick={() => navigate(`/dossier/${linkedDossierId}`)}
                    className="flex items-center gap-2 w-full px-3 py-2 mt-1 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                  >
                    <FolderOpen size={16} />
                    Voir le Dossier 360
                  </button>
                )}
                {selected.clientNom && <p className="text-gray-600 dark:text-gray-400">Client: {selected.clientNom}</p>}
                {(selected.budgetTotal != null || selected.budget != null) ? <p className="text-gray-600 dark:text-gray-400">Budget: {formatCurrency(selected.budgetTotal ?? selected.budget ?? 0)}</p> : null}
                {selected.description && <p className="text-gray-500 text-xs mt-2">{selected.description}</p>}
                {selected.villeChantier && <p className="text-gray-500 text-xs"><MapPin size={12} className="inline" /> {selected.adresseChantier}, {selected.villeChantier}</p>}
                {(selected.dateDebutReel || selected.dateDebut) && <p className="text-gray-500 text-xs">Début: {formatDate(selected.dateDebutReel || selected.dateDebut)}</p>}
                {(selected.dateFinReel || selected.dateFin) && <p className="text-gray-500 text-xs">Fin: {formatDate(selected.dateFinReel || selected.dateFin)}</p>}

                {/* Phases */}
                {selected.phases && selected.phases.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Phases ({selected.phases.length})</h4>
                    {selected.phases.map((ph) => (
                      <div key={ph.id} className="flex items-center justify-between py-1">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{ph.nom}</span>
                        <span className="text-xs text-gray-400">{ph.progression}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Devis / Soumission items (read-only) */}
                {linkedDevis && linkedDevis.lignes && linkedDevis.lignes.length > 0 && (() => {
                  const mf = 1 + ((linkedDevis.administrationPct ?? 3) + (linkedDevis.contingencesPct ?? 12) + (linkedDevis.profitPct ?? 15)) / 100;
                  return (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Soumission {linkedDevis.numeroDevis} ({linkedDevis.lignes.length} lignes)
                    </h4>
                    <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                      {linkedDevis.lignes.map((l) => {
                        const adjPrix = Math.round(l.prixUnitaire * mf * 100) / 100;
                        const adjMontant = Math.round(l.montantLigne * mf * 100) / 100;
                        return (
                        <div key={l.id} className="flex items-center justify-between py-1 text-xs">
                          <div className="flex-1 min-w-0 mr-2">
                            <p className="text-gray-700 dark:text-gray-300 truncate">{l.description}</p>
                            <p className="text-[10px] text-gray-400">{l.quantite} {l.unite} x {formatCurrency(adjPrix)}</p>
                          </div>
                          <span className="font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatCurrency(adjMontant)}</span>
                        </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-0.5 text-xs">
                      <div className="flex justify-between"><span className="text-gray-500">Sous-total</span><span>{formatCurrency(linkedDevis.totalAvantTaxes ?? 0)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">TPS (5%)</span><span>{formatCurrency(linkedDevis.tps ?? 0)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">TVQ (9.975%)</span><span>{formatCurrency(linkedDevis.tvq ?? 0)}</span></div>
                      <div className="flex justify-between font-bold"><span>Total TTC</span><span>{formatCurrency(linkedDevis.investissementTotal ?? 0)}</span></div>
                    </div>
                  </div>
                  );
                })()}

                <p className="text-xs text-gray-400 pt-2">Créé le {formatDate(selected.createdAt)}</p>

                {/* Finances Section */}
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase">Finances</h4>
                    <button
                      onClick={() => { if (!financials && !financialsLoading) fetchFinancials(selected.id); setShowFinancials(!showFinancials); }}
                      className="flex items-center gap-1 text-xs text-seaop-primary-600 hover:text-seaop-primary-800"
                    >
                      <DollarSign size={12} /> {showFinancials ? 'Masquer' : 'Afficher'}
                    </button>
                  </div>
                  {showFinancials && (
                    <>
                      {financialsLoading ? (
                        <p className="text-xs text-gray-400 text-center py-3">Chargement...</p>
                      ) : financials ? (
                        <div className="space-y-3">
                          {/* KPI cards */}
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                              <div className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 font-medium uppercase"><TrendingUp size={10} /> Revenus</div>
                              <p className="text-sm font-bold text-green-700 dark:text-green-300 mt-0.5">{formatCurrency(financials.revenus.total)}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                              <div className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 font-medium uppercase"><TrendingDown size={10} /> Depenses</div>
                              <p className="text-sm font-bold text-red-700 dark:text-red-300 mt-0.5">{formatCurrency(financials.depenses.total)}</p>
                            </div>
                            <div className={`p-2 rounded-lg border ${financials.marge >= 0 ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'}`}>
                              <div className="text-[10px] font-medium uppercase text-gray-500">Marge</div>
                              <p className={`text-sm font-bold mt-0.5 ${financials.marge >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-orange-700 dark:text-orange-300'}`}>{formatCurrency(financials.marge)} ({financials.margePct}%)</p>
                            </div>
                            {financials.budget > 0 && (
                              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                                <div className="text-[10px] font-medium uppercase text-gray-500">Budget</div>
                                <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mt-0.5">{formatCurrency(financials.budget)}</p>
                              </div>
                            )}
                          </div>

                          {/* Revenus detail */}
                          {financials.revenus.devis.items.length > 0 && (
                            <div>
                              <h5 className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Devis acceptes</h5>
                              {financials.revenus.devis.items.map((d) => (
                                <div key={d.id} className="flex justify-between py-0.5 text-xs">
                                  <span className="text-gray-600 dark:text-gray-400 truncate mr-2">{d.numero || d.description}</span>
                                  <span className="font-medium text-green-600 whitespace-nowrap">{formatCurrency(d.montant)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {financials.revenus.factures.items.length > 0 && (
                            <div>
                              <h5 className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Factures ({formatCurrency(financials.revenus.factures.paye)} encaisse)</h5>
                              {financials.revenus.factures.items.map((f) => (
                                <div key={f.id} className="flex justify-between py-0.5 text-xs">
                                  <span className="text-gray-600 dark:text-gray-400 truncate mr-2">{f.numero} <Badge color={f.statut === 'PAYEE' ? 'green' : 'gray'} size="sm">{f.statut}</Badge></span>
                                  <span className="font-medium whitespace-nowrap">{formatCurrency(f.montant)}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Depenses detail */}
                          {financials.depenses.materiaux.items.length > 0 && (
                            <div>
                              <h5 className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 uppercase mb-1"><Package size={10} /> Materiaux ({formatCurrency(financials.depenses.materiaux.total)})</h5>
                              {financials.depenses.materiaux.items.map((bc) => (
                                <div key={bc.id} className="flex justify-between py-0.5 text-xs">
                                  <span className="text-gray-600 dark:text-gray-400 truncate mr-2">{bc.numero} - {bc.fournisseur}</span>
                                  <span className="font-medium text-red-600 whitespace-nowrap">{formatCurrency(bc.montant)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {financials.depenses.mainOeuvre.items.length > 0 && (
                            <div>
                              <h5 className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 uppercase mb-1"><Users size={10} /> Main-d'oeuvre ({financials.depenses.mainOeuvre.heures}h — {formatCurrency(financials.depenses.mainOeuvre.total)})</h5>
                              {financials.depenses.mainOeuvre.items.map((mo) => (
                                <div key={mo.employeId} className="flex justify-between py-0.5 text-xs">
                                  <span className="text-gray-600 dark:text-gray-400 truncate mr-2">{mo.employe} <span className="text-gray-400">({mo.heures}h)</span></span>
                                  <span className="font-medium text-red-600 whitespace-nowrap">{formatCurrency(mo.cout)}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {financials.revenus.total === 0 && financials.depenses.total === 0 && (
                            <p className="text-xs text-gray-400 text-center py-2">Aucune donnée financière pour ce projet</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 text-center py-2">Erreur de chargement</p>
                      )}
                    </>
                  )}
                </div>

                {/* Notes Section (with IA categorization) */}
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase">Notes ({notes.length})</h4>
                    <button
                      onClick={() => setShowAddNote(true)}
                      className="flex items-center gap-1 text-xs text-seaop-primary-600 hover:text-seaop-primary-800"
                    >
                      <Plus size={12} /> Ajouter
                    </button>
                  </div>
                  {notes.length > 0 ? (
                    <div className="space-y-2 max-h-[250px] overflow-y-auto">
                      {notes.map((note) => (
                        <div key={note.id} className="p-2 rounded border border-gray-100 dark:border-gray-800">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium text-gray-900 dark:text-white">{note.titre}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              {note.categorie && (
                                <Badge color="blue" size="sm">{note.categorie}</Badge>
                              )}
                              {note.confidence != null && (
                                <span className="text-[10px] text-gray-400">{Math.round(note.confidence * 100)}%</span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{note.contenu}</p>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[10px] text-gray-400">{formatDate(note.createdAt)}</span>
                            <button
                              onClick={() => handleCategorize(note.id)}
                              disabled={categorizingNoteId === note.id}
                              className="flex items-center gap-1 text-[10px] text-purple-600 hover:text-purple-800 disabled:opacity-50"
                            >
                              <Bot size={10} />
                              {categorizingNoteId === note.id ? 'Analyse...' : 'Categoriser IA'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 text-center py-2">Aucune note</p>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouveau projet" size="xl">
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <Input label="Nom du projet *" value={form.nomProjet} onChange={(e) => setForm({ ...form, nomProjet: e.target.value })} placeholder="Ex: Rénovation cuisine résidentielle" required />
              <Input label="No. PO Client" value={form.poClient} onChange={(e) => setForm({ ...form, poClient: e.target.value })} placeholder="Ex: PO-12345" />
              <Select label="Client (Entreprise)" options={[
                { value: '', label: 'Sélectionner ou laisser vide' },
                ...createCompanies.map(c => ({ value: String(c.id), label: c.nom })),
              ]} value={form.clientCompanyId} onChange={(e) => setForm({ ...form, clientCompanyId: e.target.value })} />
              <Select label="Client (Personne)" options={[
                { value: '', label: 'Aucun contact' },
                ...createContacts.map(c => ({ value: String(c.id), label: `${c.prenom} ${c.nomFamille || ''}` })),
              ]} value={form.clientContactId} onChange={(e) => setForm({ ...form, clientContactId: e.target.value })} />
              <Input label="Saisie manuelle (si client non dans le CRM)" value={form.clientNomDirect} onChange={(e) => setForm({ ...form, clientNomDirect: e.target.value })} placeholder="Ex: Jean Tremblay Construction" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select label="Statut" options={STATUT_OPTIONS.slice(1)} value={form.statut} onChange={(e) => setForm({ ...form, statut: e.target.value })} />
                <Select label="Priorité" options={PRIORITE_OPTIONS} value={form.priorite} onChange={(e) => setForm({ ...form, priorite: e.target.value })} />
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Début prévu des travaux" type="date" value={form.dateDebut} onChange={(e) => setForm({ ...form, dateDebut: e.target.value })} />
                <Input label="Fin prévue des travaux" type="date" value={form.dateFin} onChange={(e) => setForm({ ...form, dateFin: e.target.value })} />
              </div>
              <Input label="Budget ($)" type="number" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Adresse chantier" value={form.adresseChantier} onChange={(e) => setForm({ ...form, adresseChantier: e.target.value })} />
                <Input label="Ville chantier" value={form.villeChantier} onChange={(e) => setForm({ ...form, villeChantier: e.target.value })} />
              </div>
              <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} />
            </div>
          </div>
          <p className="text-xs text-gray-400">* Obligatoire</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.nomProjet.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Add Note Modal */}
      <Modal isOpen={showAddNote} onClose={() => setShowAddNote(false)} title="Ajouter une note">
        <div className="space-y-4">
          <Input label="Titre *" value={noteForm.titre} onChange={(e) => setNoteForm({ ...noteForm, titre: e.target.value })} required />
          <Textarea label="Contenu *" value={noteForm.contenu} onChange={(e) => setNoteForm({ ...noteForm, contenu: e.target.value })} rows={4} />
          <Input label="Catégorie (optionnel)" value={noteForm.categorie} onChange={(e) => setNoteForm({ ...noteForm, categorie: e.target.value })}
            placeholder="Ex: Technique, Sécurité, Budget..." />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowAddNote(false)}>Annuler</Button>
            <Button onClick={handleAddNote} disabled={!noteForm.titre.trim() || !noteForm.contenu.trim()}>Ajouter</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Modifier le projet" size="lg">
        <div className="space-y-4">
          {editError && <Alert type="error" onClose={() => setEditError(null)}>{editError}</Alert>}
          <Input label="Nom du projet *" value={editForm.nomProjet || ''} onChange={(e) => setEditForm({ ...editForm, nomProjet: e.target.value })} required />
          <Textarea label="Description" value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Statut" options={STATUT_OPTIONS.slice(1)} value={editForm.statut || 'En attente'} onChange={(e) => setEditForm({ ...editForm, statut: e.target.value })} />
            <Select label="Priorité" options={PRIORITE_OPTIONS} value={editForm.priorite || 'Moyenne'} onChange={(e) => setEditForm({ ...editForm, priorite: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Date début" type="date" value={editForm.dateDebut || ''} onChange={(e) => setEditForm({ ...editForm, dateDebut: e.target.value })} />
            <Input label="Date fin" type="date" value={editForm.dateFin || ''} onChange={(e) => setEditForm({ ...editForm, dateFin: e.target.value })} />
          </div>
          <Input label="Budget" type="number" value={editForm.budget ?? ''} onChange={(e) => setEditForm({ ...editForm, budget: e.target.value ? parseFloat(e.target.value) : undefined })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Adresse chantier" value={editForm.adresseChantier || ''} onChange={(e) => setEditForm({ ...editForm, adresseChantier: e.target.value })} />
            <Input label="Ville chantier" value={editForm.villeChantier || ''} onChange={(e) => setEditForm({ ...editForm, villeChantier: e.target.value })} />
          </div>
          <Input label="Gestionnaire" value={editForm.gestionnaire || ''} onChange={(e) => setEditForm({ ...editForm, gestionnaire: e.target.value })} />
          <Textarea label="Notes" value={editForm.notes || ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowEdit(false)}>Annuler</Button>
            <Button onClick={handleEdit} isLoading={editLoading} disabled={!editForm.nomProjet?.trim()}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
