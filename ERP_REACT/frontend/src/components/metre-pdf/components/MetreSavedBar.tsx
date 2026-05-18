import { useEffect, useState } from 'react';
import { FilePlus2, FolderOpen, Pencil, X, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';
import { useMetreStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

interface MetreSavedBarProps {
  onNew: () => void;
  onOpen: () => void;
  onRename: () => void;
  onClose: () => void;
}

/** Top bar shown above TopToolbar in the Métré tab.
 *
 *  Two states:
 *   - **Empty** (no current métré): big CTAs "Nouveau métré" + "Ouvrir un métré".
 *   - **Active**: shows the current métré name + sync indicator + actions.
 *
 *  The sync indicator updates every 30 s and reflects the last successful
 *  backend mutation (lastSyncAt in the store, set inside _push helpers).
 */
export default function MetreSavedBar({ onNew, onOpen, onRename, onClose }: MetreSavedBarProps) {
  const { currentMetreProject, lastSyncAt, hasDocument, measurementCount, uploadError, setUploadError } = useMetreStore(
    useShallow((s) => ({
      currentMetreProject: s.currentMetreProject,
      lastSyncAt: s.lastSyncAt,
      hasDocument: !!s.document,
      measurementCount: s.measurements.length,
      uploadError: s.uploadError,
      setUploadError: s.setUploadError,
    })),
  );

  // Re-render every 30 s so the relative timestamp stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Empty state: no métré selected ──
  if (!currentMetreProject) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-neutral-900 border-b border-slate-200 dark:border-neutral-700">
        <div className="flex-1 flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-300">
          <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
          <span>
            <strong>Aucun métré ouvert.</strong> Créez ou ouvrez un métré pour sauvegarder votre travail
            et pouvoir le reprendre plus tard.
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button size="sm" variant="secondary" onClick={onOpen}>
            <FolderOpen size={14} />
            Ouvrir
          </Button>
          <Button size="sm" variant="primary" onClick={onNew}>
            <FilePlus2 size={14} />
            Nouveau métré
          </Button>
        </div>
      </div>
    );
  }

  // ── Active state: a métré is selected ──
  const synced = lastSyncAt ? new Date(lastSyncAt) : null;
  const syncLabel = synced ? formatSyncedLabel(synced) : null;
  const showSyncOk = !!syncLabel;
  const isPersisted = hasDocument && currentMetreProject;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-900">
      {/* Left: pulse + name */}
      <div className="flex items-center gap-2 flex-shrink min-w-0">
        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
        <div className="flex flex-col min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300 font-medium flex-shrink-0">
              Métré
            </span>
            <strong className="text-sm text-blue-900 dark:text-blue-100 truncate">
              {currentMetreProject.name}
            </strong>
          </div>
          {currentMetreProject.description && (
            <span className="text-[11px] text-blue-700/80 dark:text-blue-300/80 truncate">
              {currentMetreProject.description}
            </span>
          )}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: stats + sync status + actions */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-blue-700/80 dark:text-blue-300/80 hidden md:inline">
          {measurementCount} {measurementCount > 1 ? 'mesures' : 'mesure'}
        </span>

        {uploadError ? (
          <button
            type="button"
            onClick={() => setUploadError(null)}
            title={`Échec de sauvegarde : ${uploadError}. Cliquer pour ignorer (les nouvelles mesures ne seront PAS persistées tant que le PDF n'est pas réuploadé).`}
            className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400 font-medium hover:underline"
          >
            <AlertTriangle size={12} />
            <span className="hidden sm:inline">Sauvegarde échouée</span>
          </button>
        ) : showSyncOk ? (
          <span
            className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400"
            title="Sauvegarde automatique active"
          >
            <CheckCircle2 size={12} />
            <span className="hidden sm:inline">{syncLabel}</span>
          </span>
        ) : isPersisted ? (
          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-neutral-400">
            <CheckCircle2 size={12} />
            <span className="hidden sm:inline">Sauvegarde auto</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle size={12} />
            <span className="hidden sm:inline">PDF non chargé</span>
          </span>
        )}

        <div className="h-4 w-px bg-blue-200 dark:bg-blue-800" />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRename}
            title="Renommer ce métré"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
          >
            <Pencil size={14} />
          </button>
          <Button size="sm" variant="ghost" onClick={onOpen} title="Ouvrir un autre métré">
            <FolderOpen size={14} />
            <span className="hidden sm:inline">Ouvrir</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={onNew} title="Créer un nouveau métré">
            <FilePlus2 size={14} />
            <span className="hidden sm:inline">Nouveau</span>
          </Button>
          <button
            type="button"
            onClick={onClose}
            title="Fermer le métré (patientez quelques secondes après la dernière modification pour laisser les sauvegardes se terminer)"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-900 dark:hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSyncedLabel(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'Sauvegardé';
  if (sec < 60) return `Sauvegardé il y a ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Sauvegardé il y a ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Sauvegardé il y a ${h}h`;
  return `Sauvegardé le ${d.toLocaleDateString('fr-CA')}`;
}
