/**
 * Mobile React Frontend - Dossiers List Page
 * Searchable, filterable list of project dossiers.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Search, ChevronRight, Calendar } from 'lucide-react';
import { useDossiersStore } from '@/store/useDossiersStore';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Input } from '@/components/ui/Input';
import { STATUTS_DOSSIER, PRIORITES } from '@/utils/constants';
import { formatDate } from '@/utils/format';

export default function DossiersPage() {
  const navigate = useNavigate();
  // Selecteurs individuels (Zustand v5 best practice — destructuring sans
  // useShallow peut declencher des re-renders inutiles voire des boucles).
  const dossiers = useDossiersStore((s) => s.dossiers);
  const isLoading = useDossiersStore((s) => s.isLoading);
  const error = useDossiersStore((s) => s.error);
  const fetchDossiers = useDossiersStore((s) => s.fetchDossiers);
  const clearError = useDossiersStore((s) => s.clearError);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatut, setFilterStatut] = useState<string>('');

  useEffect(() => {
    fetchDossiers();
  }, [fetchDossiers]);

  const filtered = dossiers.filter((d) => {
    // Null-safety: backend peut renvoyer titre/numero null sur dossiers legacy.
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery.trim() ||
      (d.titre ?? '').toLowerCase().includes(q) ||
      (d.numeroDossier ?? '').toLowerCase().includes(q) ||
      (d.projectNom ?? '').toLowerCase().includes(q);

    const matchesStatut = !filterStatut || d.statut === filterStatut;

    return matchesSearch && matchesStatut;
  });

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-[#1b1a19]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
          Dossiers
        </h1>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Rechercher par titre, numéro, projet..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          <button
            onClick={() => setFilterStatut('')}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filterStatut === ''
                ? 'bg-seaop-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            Tous
          </button>
          {Object.entries(STATUTS_DOSSIER).map(([key, { label }]) => (
            <button
              key={key}
              onClick={() => setFilterStatut(key === filterStatut ? '' : key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterStatut === key
                  ? 'bg-seaop-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Error */}
      {error && (
        <Alert type="error" onDismiss={clearError} className="mx-4 mt-3">
          {error}
        </Alert>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 pb-safe">
        {isLoading && (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12">
            <FolderOpen className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Aucun dossier trouvé
            </p>
          </div>
        )}

        {filtered.map((dossier) => {
          const statutInfo = STATUTS_DOSSIER[dossier.statut];
          const prioriteInfo = dossier.priorite
            ? PRIORITES[dossier.priorite]
            : null;
          const progressPct =
            dossier.etapesTotal > 0
              ? Math.round((dossier.etapesDone / dossier.etapesTotal) * 100)
              : 0;

          return (
            <button
              key={dossier.id}
              onClick={() => navigate(`/dossiers/${dossier.id}`)}
              className="w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:border-seaop-primary-300 dark:hover:border-seaop-primary-600 transition-colors active:bg-gray-50 dark:active:bg-gray-750"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mb-0.5">
                    {dossier.numeroDossier}
                  </p>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {dossier.titre}
                  </h3>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 shrink-0 mt-1" />
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                {statutInfo && (
                  <Badge className={statutInfo.bgClass}>{statutInfo.label}</Badge>
                )}
                {prioriteInfo && (
                  <Badge className={prioriteInfo.bgClass}>{prioriteInfo.label}</Badge>
                )}
              </div>

              {/* Project & date */}
              {dossier.projectNom && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1.5 truncate">
                  {dossier.projectNom}
                </p>
              )}
              {dossier.dateEcheance && (
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-2.5">
                  <Calendar className="h-3 w-3" />
                  <span>Échéance: {formatDate(dossier.dateEcheance)}</span>
                </div>
              )}

              {/* Progress bar */}
              {dossier.etapesTotal > 0 && (
                <div>
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span>Progression</span>
                    <span>
                      {dossier.etapesDone}/{dossier.etapesTotal} étapes ({progressPct}%)
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-seaop-primary-500 rounded-full transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
