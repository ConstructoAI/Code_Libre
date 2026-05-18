import { useEffect, useMemo, useState } from 'react';
import { FileText, Layers, Ruler, Search, Trash2, Calendar, User as UserIcon } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import * as metreApi from '../api';
import type { MetreLibraryEntry } from '../api';

interface MetreLibraryModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user picks a métré to open. The parent loads it. */
  onOpen: (entry: MetreLibraryEntry) => Promise<void> | void;
}

/** Modal showing every saved métré in the tenant with key stats so the user
 *  can pick one to resume. Search filters by name/description/PDF filename. */
export default function MetreLibraryModal({ open, onClose, onOpen }: MetreLibraryModalProps) {
  const [entries, setEntries] = useState<MetreLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Refresh list every time the modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    metreApi
      .listMetresLibrary()
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Erreur de chargement';
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const haystack = [
        e.name,
        e.description ?? '',
        e.primaryDocumentOriginalFilename ?? '',
        e.createdByName ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, search]);

  const handleOpen = async (entry: MetreLibraryEntry) => {
    if (openingId !== null) return;
    setOpeningId(entry.id);
    try {
      await onOpen(entry);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de l’ouverture';
      setError(msg);
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = async (entry: MetreLibraryEntry, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (deletingId !== null) return;
    const msg =
      `Supprimer DEFINITIVEMENT le métré "${entry.name}" ?\n\n` +
      `Cette action est irréversible. Toutes les mesures (${entry.measurementCount}), ` +
      `calques (${entry.layerCount}) et le PDF source seront perdus.`;
    if (!window.confirm(msg)) return;
    setDeletingId(entry.id);
    try {
      await metreApi.deleteProject(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      setError(errMsg);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Bibliothèque des métrés" maxWidth="max-w-3xl">
      <div className="flex flex-col gap-3">
        {/* Search bar */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, description, fichier PDF…"
            className="pl-9"
          />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* List */}
        <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-neutral-400">
              Chargement des métrés…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-neutral-400">
              {entries.length === 0
                ? 'Aucun métré sauvegardé. Créez-en un avec « Nouveau métré ».'
                : 'Aucun résultat pour cette recherche.'}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((entry) => {
                const updated = entry.updatedAt ? new Date(entry.updatedAt) : null;
                const updatedLabel = updated
                  ? formatRelative(updated)
                  : '—';
                const isOpening = openingId === entry.id;
                const isDeleting = deletingId === entry.id;
                return (
                  <li
                    key={entry.id}
                    onClick={() => !isOpening && !isDeleting && handleOpen(entry)}
                    className={`group flex items-start gap-3 rounded-lg border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 px-4 py-3 cursor-pointer transition-colors ${
                      isOpening ? 'opacity-60' : ''
                    } ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}
                  >
                    {/* Icon column */}
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="w-10 h-10 rounded bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 flex items-center justify-center">
                        <FileText size={18} className="text-slate-500 dark:text-neutral-400" />
                      </div>
                    </div>

                    {/* Main column */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {entry.name}
                        </h3>
                        {entry.devisId != null && (
                          <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex-shrink-0">
                            lié à devis
                          </span>
                        )}
                      </div>
                      {entry.description && (
                        <p className="text-xs text-slate-600 dark:text-neutral-400 mt-0.5 line-clamp-2">
                          {entry.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[11px] text-slate-500 dark:text-neutral-400">
                        {entry.primaryDocumentOriginalFilename && (
                          <span className="flex items-center gap-1 max-w-[280px] truncate">
                            <FileText size={11} className="flex-shrink-0" />
                            <span className="truncate">{entry.primaryDocumentOriginalFilename}</span>
                            {entry.primaryDocumentPageCount ? (
                              <span className="flex-shrink-0">
                                ({entry.primaryDocumentPageCount} p.)
                              </span>
                            ) : null}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Ruler size={11} />
                          {entry.measurementCount} {entry.measurementCount > 1 ? 'mesures' : 'mesure'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Layers size={11} />
                          {entry.layerCount} {entry.layerCount > 1 ? 'calques' : 'calque'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar size={11} />
                          {updatedLabel}
                        </span>
                        {entry.createdByName && (
                          <span className="flex items-center gap-1">
                            <UserIcon size={11} />
                            {entry.createdByName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions column */}
                    <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => handleDelete(entry, e)}
                        disabled={isDeleting}
                        title="Supprimer ce métré"
                        className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-neutral-700">
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return date.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
