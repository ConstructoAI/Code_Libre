/**
 * MaisonLevelSelector - Selecteur de niveau pour projet maison multi-niveaux.
 *
 * Compose un selecteur horizontal scrollable de pills, chacune representant
 * un niveau du projet courant (Sous-sol, Niveau 1, Niveau 2, etc.). Permet
 * l'ajout, le renommage, la duplication et la suppression depuis l'UI.
 *
 * Mobile-first: hauteur de tap >= 44px, scroll horizontal, modales centrees.
 * S'integre avec useMaisonProjectStore (Phase 15). Aucun appel reseau.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Building2, Check, ChevronDown, Copy, MoreVertical, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import {
  useMaisonProjectStore,
  levelHasData,
  levelIsComplete,
  formatLevelHeight,
  MAISON_LIMITS,
  type LevelId,
  type MaisonLevel,
} from '@/store/useMaisonProjectStore';

// ============================================
// PROPS
// ============================================

export interface MaisonLevelSelectorProps {
  className?: string;
  showHeight?: boolean;
  onLevelChange?: (levelId: LevelId) => void;
}

// ============================================
// MODALES INTERNES
// ============================================

interface AddLevelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (name: string, heightFt: number) => void;
}

function AddLevelModal({ isOpen, onClose, onConfirm }: AddLevelModalProps) {
  const [name, setName] = useState('');
  const [heightFt, setHeightFt] = useState<number>(MAISON_LIMITS.DEFAULT_HEIGHT_FT);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setHeightFt(MAISON_LIMITS.DEFAULT_HEIGHT_FT);
      setError(null);
      // Focus champ nom apres ouverture
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed.length < MAISON_LIMITS.MIN_NAME_LENGTH) {
      setError(`Nom requis (1-${MAISON_LIMITS.MAX_NAME_LENGTH} car.)`);
      return;
    }
    if (heightFt < 6 || heightFt > 14) {
      setError('Hauteur: 6 a 14 pieds');
      return;
    }
    onConfirm(trimmed, heightFt);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Ajouter un niveau"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Ajouter un niveau
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Nom du niveau
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Niveau 2"
              maxLength={MAISON_LIMITS.MAX_NAME_LENGTH}
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Hauteur (pieds) : 6 a 14
            </label>
            <input
              type="number"
              value={heightFt}
              min={6}
              max={14}
              step={1}
              onChange={(e) => setHeightFt(parseInt(e.target.value, 10) || 8)}
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium text-white bg-seaop-primary-600 hover:bg-seaop-primary-700"
          >
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

interface RenameLevelModalProps {
  isOpen: boolean;
  initialName: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

function RenameLevelModal({ isOpen, initialName, onClose, onConfirm }: RenameLevelModalProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setError(null);
    }
  }, [isOpen, initialName]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed.length < MAISON_LIMITS.MIN_NAME_LENGTH) {
      setError(`Nom requis (1-${MAISON_LIMITS.MAX_NAME_LENGTH} car.)`);
      return;
    }
    onConfirm(trimmed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Renommer le niveau"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Renommer le niveau
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAISON_LIMITS.MAX_NAME_LENGTH}
          className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
          autoFocus
        />
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium text-white bg-seaop-primary-600 hover:bg-seaop-primary-700"
          >
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  levelName: string;
  onClose: () => void;
  onConfirm: () => void;
}

function ConfirmDeleteModal({ isOpen, levelName, onClose, onConfirm }: ConfirmDeleteModalProps) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Supprimer le niveau"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl p-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Supprimer le niveau ?
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Toutes les donnees du niveau <strong>{levelName}</strong> (plancher,
          murs, toiture, revetement, plan) seront perdues. Cette action est
          irreversible.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(); onClose(); }}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700"
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MENU CONTEXTUEL D'UN NIVEAU
// ============================================

interface LevelContextMenuProps {
  open: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
  canDuplicate: boolean;
}

function LevelContextMenu({
  open, onClose, onRename, onDuplicate, onDelete, canDelete, canDuplicate,
}: LevelContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setFlipped(false);
      return;
    }
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      setFlipped(true);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className={clsx(
        'absolute top-full mt-1 z-20 min-w-[160px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1',
        flipped ? 'left-0' : 'right-0',
      )}
      role="menu"
    >
      <button
        type="button"
        onClick={() => { onRename(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
        role="menuitem"
      >
        <Pencil size={14} /> Renommer
      </button>
      <button
        type="button"
        onClick={() => { onDuplicate(); onClose(); }}
        disabled={!canDuplicate}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        role="menuitem"
      >
        <Copy size={14} /> Dupliquer
      </button>
      <button
        type="button"
        onClick={() => { onDelete(); onClose(); }}
        disabled={!canDelete}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
        role="menuitem"
      >
        <Trash2 size={14} /> Supprimer
      </button>
    </div>
  );
}

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

export default function MaisonLevelSelector({
  className,
  showHeight = true,
  onLevelChange,
}: MaisonLevelSelectorProps) {
  const currentProject = useMaisonProjectStore((s) => s.currentProject);
  const currentLevelId = useMaisonProjectStore((s) => s.currentLevelId);
  const setCurrentLevel = useMaisonProjectStore((s) => s.setCurrentLevel);
  const addLevel = useMaisonProjectStore((s) => s.addLevel);
  const removeLevel = useMaisonProjectStore((s) => s.removeLevel);
  const renameLevel = useMaisonProjectStore((s) => s.renameLevel);
  const duplicateLevel = useMaisonProjectStore((s) => s.duplicateLevel);

  const [openMenuLevelId, setOpenMenuLevelId] = useState<LevelId | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<MaisonLevel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaisonLevel | null>(null);

  const levels = useMemo<MaisonLevel[]>(() => {
    if (!currentProject) return [];
    return [...currentProject.levels].sort((a, b) => a.order - b.order);
  }, [currentProject]);

  const atMaxLevels = levels.length >= MAISON_LIMITS.MAX_LEVELS;
  const atMinLevels = levels.length <= MAISON_LIMITS.MIN_LEVELS;

  // Etat "no project": on affiche un placeholder discret
  if (!currentProject) {
    return (
      <div className={clsx('w-full text-sm text-gray-500 dark:text-gray-400 italic', className)}>
        Aucun projet maison actif. Creez ou chargez un projet pour commencer.
      </div>
    );
  }

  const handleLevelClick = (levelId: LevelId) => {
    if (levelId === currentLevelId) return;
    setCurrentLevel(levelId);
    onLevelChange?.(levelId);
  };

  const handleAddConfirm = (name: string, heightFt: number) => {
    const newId = addLevel(name, heightFt);
    if (newId > 0) {
      setCurrentLevel(newId);
      onLevelChange?.(newId);
    }
  };

  const handleRenameConfirm = (newName: string) => {
    if (renameTarget) {
      renameLevel(renameTarget.id, newName);
    }
  };

  const handleDuplicateConfirm = (src: MaisonLevel) => {
    if (!window.confirm(`Dupliquer "${src.name}" ?`)) return;
    const newId = duplicateLevel(src.id, `${src.name} (copie)`);
    if (newId > 0) {
      setCurrentLevel(newId);
      onLevelChange?.(newId);
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      removeLevel(deleteTarget.id);
    }
  };

  const renderCompletenessDot = (level: MaisonLevel): ReactNode => {
    if (levelIsComplete(level)) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-green-500"
          aria-label="Niveau complet"
        />
      );
    }
    if (levelHasData(level)) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-amber-400"
          aria-label="Niveau partiellement rempli"
        />
      );
    }
    return null;
  };

  return (
    <div className={clsx('w-full', className)}>
      {/* En-tete: titre projet + bouton + */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={16} className="text-seaop-primary-600 shrink-0" />
          <span
            className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate"
            title={currentProject.name}
          >
            {currentProject.name}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          disabled={atMaxLevels}
          className={clsx(
            'min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-sm font-medium',
            'text-seaop-primary-700 dark:text-seaop-primary-300',
            'bg-seaop-primary-50 dark:bg-seaop-primary-900/30',
            'hover:bg-seaop-primary-100 dark:hover:bg-seaop-primary-900/50',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
          aria-label="Ajouter un niveau"
          title={atMaxLevels ? `Maximum ${MAISON_LIMITS.MAX_LEVELS} niveaux` : 'Ajouter un niveau'}
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Pills horizontales scrollables */}
      <div
        className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
        style={{ scrollbarWidth: 'thin' }}
        role="tablist"
        aria-label="Niveaux du projet"
      >
        {levels.map((level) => {
          const isActive = level.id === currentLevelId;
          return (
            <div
              key={level.id}
              className="relative shrink-0"
            >
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => handleLevelClick(level.id)}
                  className={clsx(
                    'min-h-[44px] px-3 rounded-l-lg text-sm font-medium inline-flex items-center gap-2',
                    'transition-colors duration-150',
                    isActive
                      ? 'bg-gradient-to-r from-seaop-primary-600 to-seaop-primary-500 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
                  )}
                  role="tab"
                  aria-selected={isActive}
                >
                  <Building2 size={14} aria-hidden="true" />
                  <span className="whitespace-nowrap">{level.name}</span>
                  {renderCompletenessDot(level)}
                  {isActive && <Check size={14} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOpenMenuLevelId(openMenuLevelId === level.id ? null : level.id)
                  }
                  className={clsx(
                    'min-h-[44px] px-2 rounded-r-lg text-sm inline-flex items-center justify-center',
                    'transition-colors duration-150',
                    isActive
                      ? 'bg-seaop-primary-700 text-white hover:bg-seaop-primary-800'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600',
                  )}
                  aria-label={`Options ${level.name}`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuLevelId === level.id}
                >
                  <MoreVertical size={14} />
                </button>
              </div>
              {showHeight && (
                <div className="mt-1 text-[10px] text-center text-gray-500 dark:text-gray-400 leading-tight">
                  {formatLevelHeight(level)}
                </div>
              )}
              <LevelContextMenu
                open={openMenuLevelId === level.id}
                onClose={() => setOpenMenuLevelId(null)}
                onRename={() => setRenameTarget(level)}
                onDuplicate={() => handleDuplicateConfirm(level)}
                onDelete={() => setDeleteTarget(level)}
                canDelete={!atMinLevels}
                canDuplicate={!atMaxLevels}
              />
            </div>
          );
        })}

        {/* Hint quand max atteint */}
        {atMaxLevels && (
          <div className="shrink-0 min-h-[44px] px-3 inline-flex items-center text-[11px] text-gray-400 dark:text-gray-500 italic">
            Max {MAISON_LIMITS.MAX_LEVELS} niveaux
          </div>
        )}
      </div>

      {/* TODO Phase 16+: drag&drop pour reordonner (long-press tactile + HTML5 DnD desktop).
          Pour l'instant, l'API store.reorderLevels existe deja mais l'UI utilise
          uniquement l'ordre d'ajout. */}

      {/* Modales */}
      <AddLevelModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onConfirm={handleAddConfirm}
      />
      <RenameLevelModal
        isOpen={renameTarget !== null}
        initialName={renameTarget?.name ?? ''}
        onClose={() => setRenameTarget(null)}
        onConfirm={handleRenameConfirm}
      />
      <ConfirmDeleteModal
        isOpen={deleteTarget !== null}
        levelName={deleteTarget?.name ?? ''}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}

// Re-export du type pour la convenance des consommateurs
export type { LevelId } from '@/store/useMaisonProjectStore';
