/**
 * Construction Quebec Template — sections fixes (0.0 a 8.0) + sections/lignes personnalisees (BD).
 * 3 sous-onglets: Travaux | Recap | Configuration
 *
 * Lignes persos: ajoutables/modifiables/supprimables dans chaque section (fixe ou perso).
 * Sections persos: ajoutables apres les sections fixes, renommables, supprimables (cascade lignes).
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ChevronRight, ChevronDown, FolderOpen, CheckSquare, Square,
  Settings, FileText, ClipboardList, Plus, Trash2, Pencil, Check, X, FolderPlus,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/utils/format';
import {
  CATEGORIES_CONSTRUCTION,
  DEFAULT_CONFIG,
  type SelectedItem,
  type ConstructionConfig,
} from '@/data/constructionItems';
import { useManuelTemplateStore } from '@/store/useManuelTemplateStore';

interface ConstructionTemplateProps {
  onSave: (items: SelectedItem[], config: ConstructionConfig, totals: TemplateTotals) => void;
  onCancel: () => void;
  initialItems?: SelectedItem[];
  initialConfig?: ConstructionConfig;
  /** When true, hides action buttons and calls onSave on every change */
  inline?: boolean;
}

export interface TemplateTotals {
  totalTravaux: number;
  administration: number;
  contingences: number;
  profit: number;
  totalAvantTaxes: number;
  tps: number;
  tvq: number;
  totalTtc: number;
}

type SubTab = 'travaux' | 'recapitulatif' | 'configuration';

interface MergedItem {
  id: string; // 'fix-X-Y' for fixed, 'custom-{ligneId}' for custom
  title: string;
  description: string;
  isCustom: boolean;
  ligneId?: number;
  defaultUnite?: string;
  defaultPrix?: number;
  defaultQte?: number;
}

interface MergedCategory {
  id: string;
  name: string;
  items: MergedItem[];
  isCustomSection: boolean;
  sectionCode?: string; // "0.0".."8.0" for fixed
  sectionId?: number; // BD id for custom
}

const UNITES_OPTIONS = ['forfait', 'pi2', 'pi.lin', 'unite', 'heure', 'jour', 'm2', 'm.lin', 'verge cube'];

/**
 * Parse a number from an input value, accepting both fr-CA (`,`) and en (`.`) decimal separators.
 * Quebec users routinely type "0,5" instead of "0.5" — without the replace, parseFloat returns NaN
 * and the field silently rounds to 0, losing the user's input.
 */
function parseFrNumber(value: string): number {
  if (!value) return 0;
  const normalized = value.replace(',', '.');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

export default function ConstructionTemplate({ onSave, onCancel, initialItems, initialConfig, inline }: ConstructionTemplateProps) {
  const [subTab, setSubTab] = useState<SubTab>('travaux');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(() => {
    const map = new Map<string, SelectedItem>();
    if (initialItems) {
      for (const item of initialItems) map.set(item.itemId, item);
    }
    return map;
  });
  const [config, setConfig] = useState<ConstructionConfig>(initialConfig || { ...DEFAULT_CONFIG });

  // Custom template store
  const customSections = useManuelTemplateStore((s) => s.sections);
  const customLignes = useManuelTemplateStore((s) => s.lignes);
  const templateLoaded = useManuelTemplateStore((s) => s.loaded);
  const loadTemplate = useManuelTemplateStore((s) => s.load);
  const createSection = useManuelTemplateStore((s) => s.createSection);
  const renameSection = useManuelTemplateStore((s) => s.renameSection);
  const deleteSection = useManuelTemplateStore((s) => s.deleteSection);
  const createLigne = useManuelTemplateStore((s) => s.createLigne);
  const updateLigne = useManuelTemplateStore((s) => s.updateLigne);
  const deleteLigne = useManuelTemplateStore((s) => s.deleteLigne);
  const templateError = useManuelTemplateStore((s) => s.error);
  const clearTemplateError = useManuelTemplateStore((s) => s.clearError);

  // Force-reload on every mount so cross-tab changes (another tab created/renamed/deleted a section)
  // are picked up when the user navigates back to the Manuel tab. The store guards against
  // concurrent calls (isLoading check), so this is safe.
  useEffect(() => {
    loadTemplate(true);
  }, [loadTemplate]);

  // Track last onSave key (replaces former module-level static hack to be StrictMode-safe)
  const lastSaveKeyRef = useRef<string>('');
  // Stable ref for onSave: parent may re-create the lambda each render, but the effect
  // should not fire just because the function identity changed.
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  // Same regex as DevisPage.tsx:551 — kept in sync to warn the user when their custom
  // section name will be silently filtered from the batch sent to the backend.
  const RESERVED_SECTION_REGEX = /^(administration|contingences?|profit|gestion de projet|frais g[eé]n[eé]raux)$/i;

  // UI state for inline editing of custom template
  const [newSectionName, setNewSectionName] = useState<string | null>(null);
  const [renamingSection, setRenamingSection] = useState<{ id: number; nom: string } | null>(null);
  const [newLigneFor, setNewLigneFor] = useState<{ sectionCode?: string; sectionId?: number } | null>(null);
  const [newLigneDraft, setNewLigneDraft] = useState({
    titre: '', description: '', unite: 'forfait', prixUnitaire: 0, quantiteDefault: 1,
  });
  const [editingLigne, setEditingLigne] = useState<{
    id: number; titre: string; description: string; unite: string; prixUnitaire: number;
  } | null>(null);

  const newSectionInputRef = useRef<HTMLInputElement>(null);
  const newLigneInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newSectionName !== null) newSectionInputRef.current?.focus();
  }, [newSectionName]);
  useEffect(() => {
    if (newLigneFor) newLigneInputRef.current?.focus();
  }, [newLigneFor]);

  const toggleCategory = (catId: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(catId) ? next.delete(catId) : next.add(catId);
      return next;
    });
  };

  const toggleItem = (cat: MergedCategory, item: MergedItem) => {
    setSelectedItems(prev => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, {
          itemId: item.id,
          categoryId: cat.id,
          categoryName: cat.name,
          title: item.title,
          description: item.description,
          quantite: item.defaultQte ?? 1,
          unite: item.defaultUnite ?? 'forfait',
          prixUnitaire: item.defaultPrix ?? 0,
          montant: Math.round((item.defaultQte ?? 1) * (item.defaultPrix ?? 0) * 100) / 100,
        });
      }
      return next;
    });
  };

  const updateItem = (itemId: string, field: 'quantite' | 'prixUnitaire' | 'unite', value: number | string) => {
    setSelectedItems(prev => {
      const next = new Map(prev);
      const item = next.get(itemId);
      if (!item) return prev;
      const updated = { ...item, [field]: value };
      updated.montant = Math.round(updated.quantite * updated.prixUnitaire * 100) / 100;
      next.set(itemId, updated);
      return next;
    });
  };

  // Merge fixed CATEGORIES_CONSTRUCTION + custom sections/lignes from store
  const mergedCategories = useMemo<MergedCategory[]>(() => {
    const merged: MergedCategory[] = CATEGORIES_CONSTRUCTION.map(cat => {
      const sectionCode = `${cat.id}.0`;
      const fixedItems: MergedItem[] = cat.items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        isCustom: false,
      }));
      // Custom lignes attached to this fixed section
      const customForThis = customLignes
        .filter(l => l.sectionCode === sectionCode)
        .sort((a, b) => a.sequence - b.sequence || a.id - b.id);
      const customItems: MergedItem[] = customForThis.map(l => ({
        id: `custom-${l.id}`,
        title: l.titre,
        description: l.description,
        isCustom: true,
        ligneId: l.id,
        defaultUnite: l.unite,
        defaultPrix: l.prixUnitaire,
        defaultQte: l.quantiteDefault,
      }));
      return {
        id: cat.id,
        name: cat.name,
        sectionCode,
        isCustomSection: false,
        items: [...fixedItems, ...customItems],
      };
    });
    // Append custom sections, numbered continuously after fixed sections (9.0, 10.0, 11.0, ...).
    // Fixed sections occupy 0.0 through 8.0. We use `sec.sequence + 8` rather than the array index
    // for STABILITY: if the user deletes section #1 (sequence=1, displayed 9.0), the remaining
    // sections keep their original numbers (e.g. sec sequence=2 stays "10.0", doesn't shift back to 9.0).
    // This avoids visual confusion when refreshing or sharing screenshots.
    const sortedSections = [...customSections].sort((a, b) => a.sequence - b.sequence || a.id - b.id);
    sortedSections.forEach((sec) => {
      const numero = (sec.sequence ?? 0) + 8;
      const items: MergedItem[] = customLignes
        .filter(l => l.sectionId === sec.id)
        .sort((a, b) => a.sequence - b.sequence || a.id - b.id)
        .map(l => ({
          id: `custom-${l.id}`,
          title: l.titre,
          description: l.description,
          isCustom: true,
          ligneId: l.id,
          defaultUnite: l.unite,
          defaultPrix: l.prixUnitaire,
          defaultQte: l.quantiteDefault,
        }));
      merged.push({
        id: `custom-section-${sec.id}`,
        name: `${numero}.0 - ${sec.nom}`,
        sectionId: sec.id,
        isCustomSection: true,
        items,
      });
    });
    return merged;
  }, [customSections, customLignes]);

  // Totals calculation
  const totals = useMemo((): TemplateTotals => {
    const totalTravaux = Array.from(selectedItems.values()).reduce((sum, i) => sum + i.montant, 0);
    const administration = Math.round(totalTravaux * config.adminPct / 100 * 100) / 100;
    const contingences = Math.round(totalTravaux * config.contingencesPct / 100 * 100) / 100;
    const profit = Math.round(totalTravaux * config.profitPct / 100 * 100) / 100;
    const totalAvantTaxes = Math.round((totalTravaux + administration + contingences + profit) * 100) / 100;
    const tps = Math.round(totalAvantTaxes * 0.05 * 100) / 100;
    const tvq = Math.round(totalAvantTaxes * 0.09975 * 100) / 100;
    const totalTtc = Math.round((totalAvantTaxes + tps + tvq) * 100) / 100;
    return { totalTravaux, administration, contingences, profit, totalAvantTaxes, tps, tvq, totalTtc };
  }, [selectedItems, config]);

  const selectedCount = selectedItems.size;
  const filledCount = Array.from(selectedItems.values()).filter(i => i.montant > 0).length;

  // Auto-save when inline mode (notify parent on every change).
  // onSave is invoked via ref so parent re-renders that recreate the lambda don't re-fire.
  const allSelected = useMemo(() => Array.from(selectedItems.values()), [selectedItems]);
  useEffect(() => {
    if (!inline) return;
    const key = JSON.stringify(allSelected.map(i => ({ id: i.itemId, t: i.title, d: i.description, q: i.quantite, p: i.prixUnitaire, u: i.unite })));
    const configKey = JSON.stringify(config);
    const fullKey = key + configKey;
    if (lastSaveKeyRef.current === fullKey) return;
    lastSaveKeyRef.current = fullKey;
    onSaveRef.current(allSelected, config, totals);
  }, [inline, allSelected, config, totals]);

  // Reconcile selectedItems with custom template after refresh:
  //  - drop entries whose backing custom ligne was deleted from BD (e.g. another tab/user)
  //  - sync the categoryName of selected items when their parent section was renamed or renumbered
  //    (otherwise the recap tab shows stale "9.0 - OldName" while the header shows "9.0 - NewName")
  useEffect(() => {
    if (!templateLoaded) return;
    const validIds = new Set(mergedCategories.flatMap(c => c.items.map(i => i.id)));
    const nameByCategoryId = new Map(mergedCategories.map(c => [c.id, c.name]));
    setSelectedItems(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const k of Array.from(prev.keys())) {
        if (k.startsWith('custom-') && !validIds.has(k)) {
          next.delete(k);
          changed = true;
          continue;
        }
        const existing = next.get(k);
        if (existing) {
          const freshName = nameByCategoryId.get(existing.categoryId);
          if (freshName && freshName !== existing.categoryName) {
            next.set(k, { ...existing, categoryName: freshName });
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [mergedCategories, templateLoaded]);

  // Group selected items by category for recap
  const groupedSelected = useMemo(() => {
    const groups: Record<string, { name: string; items: SelectedItem[]; total: number }> = {};
    for (const item of selectedItems.values()) {
      if (!groups[item.categoryId]) {
        groups[item.categoryId] = { name: item.categoryName, items: [], total: 0 };
      }
      groups[item.categoryId].items.push(item);
      groups[item.categoryId].total += item.montant;
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [selectedItems]);

  // ============== Custom template handlers ==============

  const handleCreateSection = async () => {
    const nom = (newSectionName || '').trim();
    if (!nom) {
      setNewSectionName(null);
      return;
    }
    if (RESERVED_SECTION_REGEX.test(nom)) {
      const ok = confirm(
        `« ${nom} » est un nom reserve aux marges du devis (administration / contingences / profit). ` +
        `Les lignes ajoutees a cette section seront automatiquement exclues du devis final. Continuer ?`
      );
      if (!ok) return;
    }
    try {
      await createSection({ nom });
      setNewSectionName(null);
    } catch {
      // error displayed via templateError
    }
  };

  const handleRenameSection = async () => {
    if (!renamingSection) return;
    const nom = renamingSection.nom.trim();
    if (!nom) return setRenamingSection(null);
    if (RESERVED_SECTION_REGEX.test(nom)) {
      const ok = confirm(
        `« ${nom} » est un nom reserve aux marges du devis (administration / contingences / profit). ` +
        `Les lignes de cette section seront automatiquement exclues du devis final. Continuer ?`
      );
      if (!ok) return;
    }
    try {
      await renameSection(renamingSection.id, nom);
      setRenamingSection(null);
    } catch {
      // ignore
    }
  };

  const handleDeleteSection = async (sectionId: number, hasItems: boolean) => {
    const msg = hasItems
      ? 'Cette section contient des lignes. Supprimer la section et toutes ses lignes ?'
      : 'Supprimer cette section ?';
    if (!confirm(msg)) return;
    try {
      await deleteSection(sectionId);
      // Also unselect any selected items from this section
      setSelectedItems(prev => {
        const next = new Map(prev);
        for (const [k, v] of prev) {
          if (v.categoryId === `custom-section-${sectionId}`) next.delete(k);
        }
        return next;
      });
    } catch {
      // ignore
    }
  };

  const handleCreateLigne = async () => {
    if (!newLigneFor) return;
    const titre = newLigneDraft.titre.trim();
    if (!titre) {
      setNewLigneFor(null);
      setNewLigneDraft({ titre: '', description: '', unite: 'forfait', prixUnitaire: 0, quantiteDefault: 1 });
      return;
    }
    try {
      // Defensive coercion: ensure numbers are real numbers (avoid empty-string coming through
      // controlled inputs in edge cases) and trim string fields to prevent backend Pydantic 422.
      const prix = Number(newLigneDraft.prixUnitaire);
      const qte = Number(newLigneDraft.quantiteDefault);
      await createLigne({
        sectionCode: newLigneFor.sectionCode || null,
        sectionId: newLigneFor.sectionId ?? null,
        titre,
        description: (newLigneDraft.description || '').trim(),
        unite: (newLigneDraft.unite || 'forfait').trim() || 'forfait',
        prixUnitaire: Number.isFinite(prix) && prix >= 0 ? prix : 0,
        quantiteDefault: Number.isFinite(qte) && qte >= 0 ? qte : 0,
      });
      setNewLigneFor(null);
      setNewLigneDraft({ titre: '', description: '', unite: 'forfait', prixUnitaire: 0, quantiteDefault: 1 });
    } catch {
      // error displayed via templateError
    }
  };

  const handleUpdateLigne = async () => {
    if (!editingLigne) return;
    const ligneId = editingLigne.id;
    const newTitre = editingLigne.titre;
    const newDesc = editingLigne.description;
    try {
      await updateLigne(ligneId, {
        titre: newTitre,
        description: newDesc,
        unite: editingLigne.unite,
        prixUnitaire: editingLigne.prixUnitaire,
      });
      // If this template line is currently selected, propagate title/description changes
      // to the selected snapshot so the user sees the updated text immediately.
      // We don't propagate unite/prixUnitaire because those are per-quote overrides.
      setSelectedItems(prev => {
        const key = `custom-${ligneId}`;
        const existing = prev.get(key);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(key, { ...existing, title: newTitre, description: newDesc });
        return next;
      });
      setEditingLigne(null);
    } catch {
      // error displayed via templateError
    }
  };

  const handleDeleteLigne = async (ligneId: number) => {
    if (!confirm('Supprimer cette ligne personnalisee ?')) return;
    try {
      await deleteLigne(ligneId);
      // Unselect if currently selected
      setSelectedItems(prev => {
        const next = new Map(prev);
        next.delete(`custom-${ligneId}`);
        return next;
      });
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">Template Construction Quebec</h3>
          <p className="text-xs sm:text-sm text-gray-500">{selectedCount} items sélectionnés ({filledCount} avec montant)</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xl sm:text-2xl font-bold text-seaop-primary-600">{formatCurrency(totals.totalTtc)}</p>
          <p className="text-xs text-gray-400">Total TTC</p>
        </div>
      </div>

      {templateError && (
        <div role="alert" aria-live="assertive" className="flex items-start gap-2 px-3 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
          <span className="flex-1">{templateError}</span>
          <button
            type="button"
            onClick={clearTemplateError}
            aria-label="Fermer le message d'erreur"
            className="shrink-0 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        {([
          ['travaux', 'Travaux', ClipboardList],
          ['recapitulatif', 'Recap', FileText],
          ['configuration', 'Config', Settings],
        ] as [SubTab, string, typeof Settings][]).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap min-h-[44px] ${
              subTab === key ? 'border-seaop-primary-600 text-seaop-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ====== TRAVAUX TAB ====== */}
      {subTab === 'travaux' && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <CheckSquare size={14} className="text-green-500" />
            Sélectionnez les travaux et entrez les montants
          </p>
          {mergedCategories.map(cat => {
            const isExpanded = expandedCats.has(cat.id);
            const catSelected = cat.items.filter(i => selectedItems.has(i.id));
            const catTotal = catSelected.reduce((sum, i) => sum + (selectedItems.get(i.id)?.montant || 0), 0);
            const isRenaming = Boolean(cat.isCustomSection && cat.sectionId !== undefined && renamingSection?.id === cat.sectionId);
            const isAddingLigne = Boolean(
              (cat.sectionCode !== undefined && newLigneFor?.sectionCode === cat.sectionCode) ||
              (cat.sectionId !== undefined && newLigneFor?.sectionId === cat.sectionId)
            );
            return (
              <div key={cat.id} className="border rounded-lg overflow-hidden border-gray-200 dark:border-gray-700">
                {/* Category header — same color for all sections (fixed and custom). Custom sections
                    distinguished by "Personnalisée" badge + edit/delete icons (see below). */}
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800/50">
                  <div
                    role="button"
                    tabIndex={isRenaming ? -1 : 0}
                    onClick={() => { if (!isRenaming) toggleCategory(cat.id); }}
                    onKeyDown={(e) => { if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleCategory(cat.id); } }}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 rounded"
                  >
                    {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    <FolderOpen size={16} className="text-yellow-500" />
                    {isRenaming && renamingSection ? (
                      <input
                        value={renamingSection.nom}
                        autoFocus
                        onChange={(e) => setRenamingSection((prev) => prev ? { ...prev, nom: e.target.value } : prev)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSection();
                          if (e.key === 'Escape') setRenamingSection(null);
                        }}
                        className="flex-1 text-sm font-semibold bg-white dark:bg-gray-900 border border-seaop-primary-400 rounded px-2 py-1 outline-none"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1 truncate">{cat.name}</span>
                    )}
                  </div>
                  {!isRenaming && cat.isCustomSection && (
                    <Badge color="gray" size="sm">Personnalisée</Badge>
                  )}
                  {!isRenaming && catSelected.length > 0 && (
                    <Badge color="blue" size="sm">{catSelected.length}/{cat.items.length}</Badge>
                  )}
                  {!isRenaming && catTotal > 0 && (
                    <span className="text-sm font-medium text-green-600 whitespace-nowrap">{formatCurrency(catTotal)}</span>
                  )}
                  {/* Custom section actions */}
                  {cat.isCustomSection && cat.sectionId !== undefined && (
                    <>
                      {isRenaming ? (
                        <>
                          <button
                            type="button"
                            onClick={handleRenameSection}
                            aria-label="Confirmer le renommage"
                            className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600"
                            title="Confirmer"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingSection(null)}
                            aria-label="Annuler le renommage"
                            className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                            title="Annuler"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setNewLigneFor(null);
                              setEditingLigne(null);
                              setRenamingSection({ id: cat.sectionId!, nom: cat.name });
                            }}
                            aria-label={`Renommer la section ${cat.name}`}
                            className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600"
                            title="Renommer"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSection(cat.sectionId!, cat.items.length > 0)}
                            aria-label={`Supprimer la section ${cat.name}`}
                            className="inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600"
                            title="Supprimer la section"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Items */}
                {isExpanded && (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {cat.items.length === 0 && cat.isCustomSection && (
                      <div className="px-4 py-6 text-center text-sm text-gray-400">
                        Aucune ligne dans cette section. Cliquez sur « Ajouter une ligne » ci-dessous.
                      </div>
                    )}
                    {cat.items.map(item => {
                      const sel = selectedItems.get(item.id);
                      const isSelected = !!sel;
                      const isEditingThisLigne = Boolean(item.isCustom && item.ligneId !== undefined && editingLigne?.id === item.ligneId);
                      return (
                        <div key={item.id} className={`px-4 py-3 ${isSelected && sel.montant > 0 ? 'bg-green-50 dark:bg-green-900/10' : ''}`}>
                          <div className="flex items-start gap-3">
                            {/* Checkbox */}
                            <button onClick={() => toggleItem(cat, item)} className="mt-0.5 shrink-0">
                              {isSelected
                                ? <CheckSquare size={18} className="text-seaop-primary-600" />
                                : <Square size={18} className="text-gray-300 dark:text-gray-600" />
                              }
                            </button>
                            <div className="flex-1 min-w-0">
                              {isEditingThisLigne && editingLigne ? (
                                /* Edit custom template line */
                                <div className="space-y-2 bg-yellow-50/50 dark:bg-yellow-900/10 p-2 rounded">
                                  <input
                                    value={editingLigne.titre}
                                    onChange={(e) => setEditingLigne((prev) => prev ? { ...prev, titre: e.target.value } : prev)}
                                    placeholder="Titre"
                                    className="w-full text-sm font-medium bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 outline-none"
                                  />
                                  <textarea
                                    value={editingLigne.description}
                                    onChange={(e) => setEditingLigne((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                                    placeholder="Description"
                                    rows={2}
                                    className="w-full text-xs text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 outline-none resize-none"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <select
                                      value={editingLigne.unite}
                                      onChange={(e) => setEditingLigne((prev) => prev ? { ...prev, unite: e.target.value } : prev)}
                                      className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
                                    >
                                      {UNITES_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                    <input
                                      type="number" min="0" step="0.01"
                                      value={editingLigne.prixUnitaire || ''}
                                      onChange={(e) => setEditingLigne((prev) => prev ? { ...prev, prixUnitaire: parseFrNumber(e.target.value) } : prev)}
                                      placeholder="Prix unit. par défaut"
                                      className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
                                    />
                                  </div>
                                  <div className="flex justify-end gap-2 pt-1">
                                    <Button size="sm" variant="ghost" onClick={() => setEditingLigne(null)}>Annuler</Button>
                                    <Button size="sm" onClick={handleUpdateLigne}>Enregistrer</Button>
                                  </div>
                                </div>
                              ) : isSelected && sel ? (
                                <>
                                  <div className="flex items-start gap-2">
                                    <input
                                      type="text"
                                      value={sel.title}
                                      onChange={e => {
                                        setSelectedItems(prev => {
                                          const next = new Map(prev);
                                          const it = next.get(item.id);
                                          if (it) next.set(item.id, { ...it, title: e.target.value });
                                          return next;
                                        });
                                      }}
                                      className="flex-1 text-sm font-medium text-gray-900 dark:text-white bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-seaop-primary-500 outline-none py-0.5"
                                    />
                                    {item.isCustom && <Badge color="gray" size="sm">Perso</Badge>}
                                  </div>
                                  <textarea
                                    value={sel.description}
                                    onChange={e => {
                                      setSelectedItems(prev => {
                                        const next = new Map(prev);
                                        const it = next.get(item.id);
                                        if (it) next.set(item.id, { ...it, description: e.target.value });
                                        return next;
                                      });
                                    }}
                                    rows={2}
                                    className="w-full text-xs text-gray-500 bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-seaop-primary-500 outline-none mt-1 resize-none"
                                  />
                                </>
                              ) : (
                                <>
                                  <div className="flex items-start gap-2">
                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1">{item.title}</p>
                                    {item.isCustom && <Badge color="gray" size="sm">Perso</Badge>}
                                  </div>
                                  <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                                </>
                              )}
                              {/* Inputs when selected */}
                              {isSelected && !isEditingThisLigne && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                                  <div>
                                    <label className="text-[10px] text-gray-500 uppercase">Qte</label>
                                    <input type="number" min="0" step="0.01"
                                      value={sel.quantite}
                                      onChange={e => updateItem(item.id, 'quantite', parseFrNumber(e.target.value))}
                                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-gray-500 uppercase">Unité</label>
                                    <select
                                      value={sel.unite}
                                      onChange={e => updateItem(item.id, 'unite', e.target.value)}
                                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                                    >
                                      {UNITES_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-gray-500 uppercase">Prix unit. ($)</label>
                                    <input type="number" min="0" step="0.01"
                                      value={sel.prixUnitaire || ''}
                                      onChange={e => updateItem(item.id, 'prixUnitaire', parseFrNumber(e.target.value))}
                                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-gray-500 uppercase">Montant</label>
                                    <div className="px-2 py-1.5 text-sm font-semibold text-green-600 bg-green-50 dark:bg-green-900/20 rounded">
                                      {formatCurrency(sel.montant)}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Custom line actions (edit + delete) */}
                            {item.isCustom && item.ligneId !== undefined && !isEditingThisLigne && (
                              <div className="flex flex-col gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewLigneFor(null);
                                    setRenamingSection(null);
                                    setEditingLigne({
                                      id: item.ligneId!,
                                      titre: item.title,
                                      description: item.description,
                                      unite: item.defaultUnite || 'forfait',
                                      prixUnitaire: item.defaultPrix || 0,
                                    });
                                  }}
                                  aria-label={`Modifier le modèle « ${item.title} »`}
                                  className="inline-flex items-center justify-center min-w-[32px] min-h-[32px] rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600"
                                  title="Modifier le modèle"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLigne(item.ligneId!)}
                                  aria-label={`Supprimer la ligne « ${item.title} »`}
                                  className="inline-flex items-center justify-center min-w-[32px] min-h-[32px] rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600"
                                  title="Supprimer la ligne"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {/* Add custom line in this section */}
                    {isAddingLigne ? (
                      <div className="px-4 py-3 bg-yellow-50/50 dark:bg-yellow-900/10 space-y-2">
                        <input
                          ref={newLigneInputRef}
                          value={newLigneDraft.titre}
                          onChange={(e) => setNewLigneDraft({ ...newLigneDraft, titre: e.target.value })}
                          placeholder="Titre de la ligne"
                          className="w-full text-sm font-medium bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 outline-none focus:border-seaop-primary-500"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newLigneDraft.titre.trim()) handleCreateLigne();
                            if (e.key === 'Escape') setNewLigneFor(null);
                          }}
                        />
                        <textarea
                          value={newLigneDraft.description}
                          onChange={(e) => setNewLigneDraft({ ...newLigneDraft, description: e.target.value })}
                          placeholder="Description (optionnel)"
                          rows={2}
                          className="w-full text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 outline-none focus:border-seaop-primary-500 resize-none"
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase">Unité</label>
                            <select
                              value={newLigneDraft.unite}
                              onChange={(e) => setNewLigneDraft({ ...newLigneDraft, unite: e.target.value })}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
                            >
                              {UNITES_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase">Qté défaut</label>
                            <input
                              type="number" min="0" step="0.01"
                              value={newLigneDraft.quantiteDefault || ''}
                              onChange={(e) => setNewLigneDraft({ ...newLigneDraft, quantiteDefault: parseFrNumber(e.target.value) })}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase">Prix défaut ($)</label>
                            <input
                              type="number" min="0" step="0.01"
                              value={newLigneDraft.prixUnitaire || ''}
                              onChange={(e) => setNewLigneDraft({ ...newLigneDraft, prixUnitaire: parseFrNumber(e.target.value) })}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button size="sm" variant="ghost" onClick={() => {
                            setNewLigneFor(null);
                            setNewLigneDraft({ titre: '', description: '', unite: 'forfait', prixUnitaire: 0, quantiteDefault: 1 });
                          }}>Annuler</Button>
                          <Button size="sm" onClick={handleCreateLigne} disabled={!newLigneDraft.titre.trim()}>Ajouter</Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingLigne(null);
                          setRenamingSection(null);
                          setNewLigneFor({
                            sectionCode: cat.sectionCode,
                            sectionId: cat.sectionId,
                          });
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 transition-colors border-t border-dashed border-gray-200 dark:border-gray-700"
                      >
                        <Plus size={14} /> Ajouter une ligne
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add custom section */}
          {newSectionName !== null ? (
            <div className="border border-dashed border-seaop-primary-400 rounded-lg p-3 bg-seaop-primary-50/40 dark:bg-seaop-primary-900/10">
              <div className="flex gap-2">
                <input
                  ref={newSectionInputRef}
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  placeholder="Nom de la nouvelle section (ex: Honoraires professionnels)"
                  className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded outline-none focus:border-seaop-primary-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateSection();
                    if (e.key === 'Escape') setNewSectionName(null);
                  }}
                />
                <Button size="sm" onClick={handleCreateSection} disabled={!(newSectionName || '').trim()}>Créer</Button>
                <Button size="sm" variant="ghost" onClick={() => setNewSectionName(null)}>Annuler</Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setNewSectionName('')}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 transition-colors border border-dashed border-gray-300 dark:border-gray-700 rounded-lg"
            >
              <FolderPlus size={16} /> Nouvelle section personnalisée
            </button>
          )}
        </div>
      )}

      {/* ====== RECAPITULATIF TAB ====== */}
      {subTab === 'recapitulatif' && (
        <div className="space-y-4">
          {groupedSelected.length === 0 ? (
            <Card padding="lg"><p className="text-center text-gray-400">Aucun item selectionne. Allez dans l'onglet Travaux.</p></Card>
          ) : (
            <>
              {/* Items by category */}
              {groupedSelected.map(([catId, group]) => (
                <Card key={catId} padding="sm">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{group.name}</h4>
                  <div className="overflow-x-auto -mx-2 px-2">
                  <table className="w-full text-sm min-w-[400px]">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500">
                        <th className="py-1 text-left">Description</th>
                        <th className="py-1 text-right w-16">Qte</th>
                        <th className="py-1 text-center w-16">Unité</th>
                        <th className="py-1 text-right w-24">Prix unit.</th>
                        <th className="py-1 text-right w-24">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(item => (
                        <tr key={item.itemId} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1.5 text-gray-900 dark:text-white">{item.title}</td>
                          <td className="py-1.5 text-right text-gray-500">{item.quantite}</td>
                          <td className="py-1.5 text-center text-gray-500">{item.unite}</td>
                          <td className="py-1.5 text-right text-gray-500">{formatCurrency(item.prixUnitaire)}</td>
                          <td className="py-1.5 text-right font-medium">{formatCurrency(item.montant)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-300 dark:border-gray-600">
                        <td colSpan={4} className="py-1.5 text-right text-xs font-semibold text-gray-500">Sous-total</td>
                        <td className="py-1.5 text-right font-bold text-gray-900 dark:text-white">{formatCurrency(group.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                </Card>
              ))}

              {/* Financial summary */}
              <Card padding="md">
                <div className="space-y-2 text-sm max-w-sm ml-auto">
                  <div className="flex justify-between"><span>Total travaux</span><span className="font-medium">{formatCurrency(totals.totalTravaux)}</span></div>
                  <div className="flex justify-between text-gray-500"><span>Administration ({config.adminPct}%)</span><span>{formatCurrency(totals.administration)}</span></div>
                  <div className="flex justify-between text-gray-500"><span>Contingences ({config.contingencesPct}%)</span><span>{formatCurrency(totals.contingences)}</span></div>
                  <div className="flex justify-between text-gray-500"><span>Profit ({config.profitPct}%)</span><span>{formatCurrency(totals.profit)}</span></div>
                  <div className="flex justify-between font-semibold border-t border-gray-200 dark:border-gray-700 pt-2"><span>Sous-total avant taxes</span><span>{formatCurrency(totals.totalAvantTaxes)}</span></div>
                  <div className="flex justify-between text-gray-500"><span>TPS (5%)</span><span>{formatCurrency(totals.tps)}</span></div>
                  <div className="flex justify-between text-gray-500"><span>TVQ (9,975%)</span><span>{formatCurrency(totals.tvq)}</span></div>
                  <div className="flex justify-between text-xl font-bold text-seaop-primary-600 border-t-2 border-seaop-primary-600 pt-2 mt-2">
                    <span>TOTAL TTC</span><span>{formatCurrency(totals.totalTtc)}</span>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ====== CONFIGURATION TAB ====== */}
      {subTab === 'configuration' && (
        <Card padding="md">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Taux de majoration</h4>
          <div className="space-y-6">
            {([
              ['adminPct', 'Administration', 15] as const,
              ['contingencesPct', 'Contingences', 30] as const,
              ['profitPct', 'Profit', 50] as const,
            ]).map(([key, label, max]) => (
              <div key={key}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700 dark:text-gray-300">{label}</span>
                  <span className="font-semibold text-seaop-primary-600">{config[key]}%</span>
                </div>
                <input
                  type="range" min="0" max={max} step="0.5"
                  value={config[key]}
                  onChange={e => setConfig(prev => ({ ...prev, [key]: parseFrNumber(e.target.value) }))}
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-seaop-primary-600"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>0%</span><span>{max}%</span>
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex justify-between text-sm font-semibold">
                <span>Majoration totale</span>
                <span className="text-seaop-primary-600">{config.adminPct + config.contingencesPct + config.profitPct}%</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Action buttons (hidden when inline) */}
      {!inline && (
        <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="ghost" onClick={onCancel} className="w-full sm:w-auto">Annuler</Button>
          <Button
            onClick={() => onSave(Array.from(selectedItems.values()).filter(i => i.montant > 0), config, totals)}
            disabled={filledCount === 0}
            className="w-full sm:w-auto"
          >
            Sauvegarder ({filledCount} items — {formatCurrency(totals.totalTtc)})
          </Button>
        </div>
      )}
    </div>
  );
}
