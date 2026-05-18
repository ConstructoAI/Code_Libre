/**
 * ERP React Frontend - Dossiers Page
 * Document management with status tracking, etapes, notes, linked items, sharing, and statistics.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FolderOpen, Plus, Search,
  RefreshCw, Trash2,
} from 'lucide-react';
import {
  getDocuments, createDocument, deleteDocument,
  getDossierStatistics,
} from '@/api/documents';
import type {
  Document, DossierStatistics,
} from '@/api/documents';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { formatDate } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { useColumnResize } from '@/hooks/useColumnResize';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { CommandBar } from '@/components/ui/CommandBar';

const STATUT_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'OUVERT', label: 'Ouvert' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'EN_ATTENTE', label: 'En attente' },
  { value: 'TERMINE', label: 'Terminé' },
  { value: 'ARCHIVE', label: 'Archivé' },
];

const STATUT_COLORS: Record<string, 'blue' | 'green' | 'yellow' | 'gray' | 'red' | 'teal'> = {
  OUVERT: 'blue',
  EN_COURS: 'green',
  EN_ATTENTE: 'yellow',
  TERMINE: 'teal',
  ARCHIVE: 'gray',
};

const PRIORITE_COLORS: Record<string, 'red' | 'orange' | 'blue' | 'gray'> = {
  URGENT: 'red',
  HAUTE: 'orange',
  NORMAL: 'blue',
  BASSE: 'gray',
};

type PageTab = 'dossiers' | 'statistiques';

export default function DossiersPage() {
  const navigate = useNavigate();
  // Page-level tab
  const [_pageTab, _setPageTab] = useState<PageTab>('dossiers');

  // Dossiers list state
  const [dossiers, setDossiers] = useState<Document[]>([]);
  const { sortedItems: sortedDossiers, sortConfig, requestSort } = useSortable(dossiers);
  const { colWidths, startResize, autoFit } = useColumnResize({ nom: 250, typeDossier: 120, statut: 120, priorite: 120, updatedAt: 140 });
  const [searchQuery, setSearchQuery] = useState('');
  const filteredDossiers = useMemo(() => {
    if (!searchQuery.trim()) return sortedDossiers;
    const q = searchQuery.toLowerCase();
    return sortedDossiers.filter((d) =>
      (d.titre || '').toLowerCase().includes(q) ||
      (d.typeDossier || '').toLowerCase().includes(q) ||
      (d.statut || '').toLowerCase().includes(q) ||
      (d.priorite || '').toLowerCase().includes(q)
    );
  }, [sortedDossiers, searchQuery]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statutFilter, setStatutFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ titre: '', typeDossier: 'PROJET', priorite: 'NORMAL' });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // Statistics state
  const [stats, setStats] = useState<DossierStatistics | null>(null);
  const [, setLoadingStats] = useState(false);

  const perPage = 20;

  const fetchDossiers = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: { page: number; perPage: number; statut?: string } = { page, perPage };
      if (statutFilter) params.statut = statutFilter;
      const result = await getDocuments(params);
      setDossiers(result.items || []);
      setTotal(result.total || 0);
    } catch {
      setError('Erreur lors du chargement');
    } finally {
      setIsLoading(false);
    }
  }, [page, statutFilter]);

  useEffect(() => { fetchDossiers(); }, [fetchDossiers]);

  // Auto-open dossier from ?open= query param
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenHandled = React.useRef(false);
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && dossiers.length > 0 && !autoOpenHandled.current) {
      autoOpenHandled.current = true;
      searchParams.delete('open');
      setSearchParams(searchParams, { replace: true });
      navigate(`/dossier/${openId}`);
    }
  }, [searchParams, dossiers]);

  const fetchStatistics = useCallback(async () => {
    setLoadingStats(true);
    try {
      const data = await getDossierStatistics();
      setStats(data);
    } catch {
      setError('Erreur lors du chargement des statistiques');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    fetchStatistics();
  }, [fetchStatistics]);

  const handleCreate = async () => {
    if (!form.titre.trim()) return;
    try {
      await createDocument(form);
      setShowCreate(false);
      setForm({ titre: '', typeDossier: 'PROJET', priorite: 'NORMAL' });
      fetchDossiers();
    } catch {
      setError('Erreur de création');
    }
  };

  const handleDelete = async (dossier: Document, event: React.MouseEvent) => {
    event.stopPropagation();
    const titre = dossier.titre || `#${dossier.id}`;
    const statut = dossier.statut || '';
    const msg = `Supprimer le dossier "${titre}"${statut ? ` (statut: ${statut})` : ''} ?\n\nAttention :\n• Toutes les pièces jointes, notes et étapes du dossier seront supprimées\n• Les opportunités/projets liés seront détachés (non supprimés)\n• Les dépenses liées seront aussi supprimées (cascade comptable)\n\nCette action est irréversible.`;
    if (!window.confirm(msg)) return;
    setDeletingId(dossier.id);
    try {
      await deleteDocument(dossier.id);
      setSuccessMessage(`Dossier "${titre}" supprimé`);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 4000);
      // Edge case: if we just deleted the last item on a non-first page, step back
      if (dossiers.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        fetchDossiers();
      }
      fetchStatistics();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {successMessage && <Alert type="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert>}

      {/* Header */}
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Dossiers</h2>

      {/* D365-style CommandBar */}
      <CommandBar
        actions={[
          {
            label: 'Nouveau dossier',
            icon: <Plus size={16} />,
            onClick: () => setShowCreate(true),
            variant: 'primary',
          },
          {
            label: 'Actualiser',
            icon: <RefreshCw size={16} />,
            onClick: () => { fetchDossiers(); fetchStatistics(); },
          },
        ]}
        right={
          <>
            <div className="relative w-full sm:w-52">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-[13px] border border-[#edebe9] dark:border-[#3b3a39] rounded-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#c8c6c4] placeholder-gray-400 focus:outline-none focus:border-[#0078D4]"
              />
            </div>
            <div className="w-full sm:w-48">
              <Select options={STATUT_OPTIONS} value={statutFilter}
                onChange={(e) => { setStatutFilter(e.target.value); setPage(1); }} />
            </div>
          </>
        }
      />

      {/* KPI Stats Cards — always visible */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Total</div>
            <div className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Ouverts</div>
            <div className="text-xl md:text-2xl font-bold text-blue-600">{stats.ouverts}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Terminés</div>
            <div className="text-xl md:text-2xl font-bold text-green-600">{stats.termines}</div>
          </Card>
        </div>
      )}

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
                        <SortableHeader label="Nom" sortKey="nom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.nom} onResizeStart={(e) => startResize(e, 'nom')} onAutoFit={(e) => autoFit(e, 'nom')} />
                        <SortableHeader label="Type" sortKey="typeDossier" sortConfig={sortConfig} onSort={requestSort} width={colWidths.typeDossier} onResizeStart={(e) => startResize(e, 'typeDossier')} onAutoFit={(e) => autoFit(e, 'typeDossier')} />
                        <SortableHeader label="Statut" sortKey="statut" sortConfig={sortConfig} onSort={requestSort} width={colWidths.statut} onResizeStart={(e) => startResize(e, 'statut')} onAutoFit={(e) => autoFit(e, 'statut')} />
                        <SortableHeader label="Priorité" sortKey="priorite" sortConfig={sortConfig} onSort={requestSort} width={colWidths.priorite} onResizeStart={(e) => startResize(e, 'priorite')} onAutoFit={(e) => autoFit(e, 'priorite')} />
                        <SortableHeader label="Mis à jour" sortKey="updatedAt" sortConfig={sortConfig} onSort={requestSort} width={colWidths.updatedAt} onResizeStart={(e) => startResize(e, 'updatedAt')} onAutoFit={(e) => autoFit(e, 'updatedAt')} />
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {filteredDossiers.map((d) => (
                          <tr
                            key={d.id}
                            className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30"
                            onClick={() => navigate(`/dossier/${d.id}`)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <FolderOpen size={16} className="text-seaop-primary-500 shrink-0" />
                                <span className="font-medium text-gray-900 dark:text-white">{d.titre}</span>
                                <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">Fiche 360</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{d.typeDossier}</td>
                            <td className="px-4 py-3 text-center">
                              <Badge color={STATUT_COLORS[d.statut] || 'gray'} size="sm">{d.statut}</Badge>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge color={PRIORITE_COLORS[d.priorite] || 'gray'} size="sm">{d.priorite}</Badge>
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(d.updatedAt || d.createdAt)}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={(e) => handleDelete(d, e)}
                                disabled={deletingId === d.id}
                                title="Supprimer le dossier"
                                className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                      ))}
                      {dossiers.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucun dossier</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {filteredDossiers.map((d) => (
                    <div
                      key={d.id}
                      onClick={() => navigate(`/dossier/${d.id}`)}
                      className="border rounded-lg p-3 cursor-pointer transition-colors active:bg-gray-50 dark:active:bg-gray-800/30 border-gray-200 dark:border-gray-700"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <FolderOpen size={15} className="text-seaop-primary-500 shrink-0" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate flex-1">{d.titre}</span>
                        <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">Fiche 360</span>
                        <button
                          onClick={(e) => handleDelete(d, e)}
                          disabled={deletingId === d.id}
                          title="Supprimer le dossier"
                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs pl-6">
                        <Badge color={STATUT_COLORS[d.statut] || 'gray'} size="sm">{d.statut}</Badge>
                        <Badge color={PRIORITE_COLORS[d.priorite] || 'gray'} size="sm">{d.priorite}</Badge>
                        <span className="text-gray-400">{d.typeDossier}</span>
                        <span className="text-gray-400">{formatDate(d.updatedAt || d.createdAt)}</span>
                      </div>
                    </div>
                ))}
                {dossiers.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-8">Aucun dossier</p>
                )}
              </div>

              {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
            </>
          )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouveau dossier">
        <div className="space-y-4">
          <Input label="Nom *" value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} required />
          <Select label="Priorité" options={[
            { value: 'BASSE', label: 'Basse' },
            { value: 'NORMAL', label: 'Normal' },
            { value: 'HAUTE', label: 'Haute' },
            { value: 'URGENT', label: 'Urgent' },
          ]} value={form.priorite} onChange={(e) => setForm({ ...form, priorite: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.titre.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
