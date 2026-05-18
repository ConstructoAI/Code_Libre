import { useState, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useMetreStore } from '../store';
import { PRICE_UNITS } from '../types';
import type { Product } from '../types';
import { getERPContext } from '../api';
import { ColorPicker } from './ui/ColorPicker';

const CompositeEditor = lazy(() => import('./CompositeEditor'));

/** Composites require backend persistence (numeric product IDs); disabled in standalone mode. */
function isCompositeSupported(): boolean {
  const ctx = getERPContext();
  return !!(ctx && ctx.tenant_schema && ctx.user_id);
}

type Tab = 'products' | 'add' | 'import';

export default function ProductCatalog() {
  const products = useMetreStore((s) => s.products);
  const addProduct = useMetreStore((s) => s.addProduct);
  const updateProduct = useMetreStore((s) => s.updateProduct);
  const removeProduct = useMetreStore((s) => s.removeProduct);
  const importCatalog = useMetreStore((s) => s.importCatalog);
  const toggleCatalog = useMetreStore((s) => s.toggleCatalog);

  const [activeTab, setActiveTab] = useState<Tab>('products');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  // ID of the composite product whose components are being edited (null = no editor open)
  const [compositeEditorId, setCompositeEditorId] = useState<string | null>(null);

  // --- Add form state ---
  const [newCategory, setNewCategory] = useState('');
  const [newName, setNewName] = useState('');
  const [newDimensions, setNewDimensions] = useState('');
  const [newPrice, setNewPrice] = useState(0);
  const [newUnit, setNewUnit] = useState('pi2');
  const [newColor, setNewColor] = useState('#CCCCCC');
  const [newWastePct, setNewWastePct] = useState(0);
  const [newIsComposite, setNewIsComposite] = useState(false);
  const [newDisplayMode, setNewDisplayMode] = useState<'detailed' | 'summary'>('detailed');

  // --- Edit form state ---
  const [editName, setEditName] = useState('');
  const [editDimensions, setEditDimensions] = useState('');
  const [editPrice, setEditPrice] = useState(0);
  const [editUnit, setEditUnit] = useState('pi2');
  const [editWastePct, setEditWastePct] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived data
  const categories = useMemo(() => {
    const cats = new Set(products.map((p) => p.category));
    return Array.from(cats).sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.dimensions.toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  const groupedProducts = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    for (const p of filteredProducts) {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    }
    return groups;
  }, [filteredProducts]);

  // --- Handlers ---
  const handleAdd = useCallback(() => {
    if (!newName.trim() || !newCategory.trim()) return;

    addProduct({
      id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newName.trim(),
      category: newCategory.trim(),
      dimensions: newDimensions.trim(),
      price: newPrice,
      priceUnit: newUnit,
      color: newColor,
      wastePct: newWastePct,
      isComposite: newIsComposite,
      displayMode: newIsComposite ? newDisplayMode : undefined,
    });

    setNewName('');
    setNewDimensions('');
    setNewPrice(0);
    setNewWastePct(0);
    setNewIsComposite(false);
    setNewDisplayMode('detailed');
    setActiveTab('products');
  }, [newName, newCategory, newDimensions, newPrice, newUnit, newColor, newWastePct, newIsComposite, newDisplayMode, addProduct]);

  const startEdit = useCallback((p: Product) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditDimensions(p.dimensions);
    setEditPrice(p.price);
    setEditUnit(p.priceUnit);
    setEditWastePct(p.wastePct ?? 0);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    updateProduct(editingId, {
      name: editName.trim(),
      dimensions: editDimensions.trim(),
      price: editPrice,
      priceUnit: editUnit,
      wastePct: editWastePct,
    });
    setEditingId(null);
  }, [editingId, editName, editDimensions, editPrice, editUnit, editWastePct, updateProduct]);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(products, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalogue-produits.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [products]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (Array.isArray(data)) {
            // Native format: preserve composite fields as-is.
            importCatalog(data as Product[]);
          } else if (typeof data === 'object' && data !== null) {
            // Streamlit format { category: { name: {...} } } — flat conversion.
            // Warn explicitly: this legacy format does NOT carry composites.
            const hasComposites = Object.values(data).some((prods) =>
              Object.values(prods as Record<string, any>).some((info: any) => info?.isComposite || info?.is_composite),
            );
            if (hasComposites) {
              alert('Format Streamlit détecté: les produits composites ne seront pas préservés. Utilisez un export JSON natif pour conserver les assemblages.');
            }
            const flat: Product[] = [];
            for (const [cat, prods] of Object.entries(data)) {
              for (const [name, info] of Object.entries(prods as Record<string, any>)) {
                flat.push({
                  id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  name,
                  category: cat,
                  dimensions: info.dimensions ?? '',
                  price: info.price ?? 0,
                  priceUnit: info.price_unit ?? info.priceUnit ?? 'pi2',
                  color: info.color ?? '#CCCCCC',
                  wastePct: info.wastePct ?? info.waste_pct ?? 0,
                  isComposite: !!(info.isComposite ?? info.is_composite),
                  displayMode: (info.displayMode ?? info.display_mode) as 'detailed' | 'summary' | undefined,
                  priceOverride: info.priceOverride ?? info.price_override ?? null,
                  description: info.description ?? undefined,
                });
              }
            }
            importCatalog(flat);
          }
        } catch {
          alert('Format de fichier invalide');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [importCatalog]
  );

  const unitLabel = (val: string) =>
    PRICE_UNITS.find((u) => u.value === val)?.label ?? val;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/60">
      <div className="bg-metre-surface border border-metre-border rounded-xl shadow-xl w-[680px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-metre-border">
          <h2 className="text-base font-semibold text-metre-text">
            Gestion du catalogue de produits
          </h2>
          <button
            onClick={toggleCatalog}
            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
          >
            Fermer
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-metre-border px-5">
          {([
            ['products', 'Produits'],
            ['add', '+ Ajouter'],
            ['import', 'Import/Export'],
          ] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                  : 'text-metre-muted border-transparent hover:text-metre-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ─── Produits tab ─── */}
          {activeTab === 'products' && (
            <div className="space-y-4">
              {/* Search */}
              <input
                className="input-field"
                placeholder="Rechercher un produit..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              {products.length === 0 ? (
                <p className="text-metre-muted text-sm text-center py-8">
                  Catalogue vide - Cliquez sur &laquo; + Ajouter &raquo; pour ajouter des produits
                </p>
              ) : Object.keys(groupedProducts).length === 0 ? (
                <p className="text-metre-muted text-sm text-center py-4">
                  Aucun produit ne correspond à la recherche
                </p>
              ) : (
                Object.entries(groupedProducts).map(([cat, prods]) => (
                  <div key={cat}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted mb-2">
                      {cat} ({prods.length})
                    </h3>
                    <div className="space-y-1">
                      {prods.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-metre-bg hover:bg-metre-panel transition-colors group"
                        >
                          <ColorPicker
                            value={p.color || '#94a3b8'}
                            onChange={(color) => updateProduct(p.id, { color })}
                            compact
                          />
                          {editingId === p.id ? (
                            /* Inline edit */
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                className="input-field flex-1"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                              />
                              <input
                                className="input-field w-24"
                                value={editDimensions}
                                onChange={(e) => setEditDimensions(e.target.value)}
                                placeholder="Dim."
                              />
                              <input
                                type="number"
                                className="input-field w-20"
                                value={editPrice}
                                onChange={(e) => setEditPrice(Number(e.target.value))}
                                step="0.01"
                              />
                              <select
                                className="input-field w-20"
                                value={editUnit}
                                onChange={(e) => setEditUnit(e.target.value)}
                              >
                                {PRICE_UNITS.map((u) => (
                                  <option key={u.value} value={u.value}>
                                    {u.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                className="input-field w-16"
                                value={editWastePct}
                                onChange={(e) => setEditWastePct(Number(e.target.value))}
                                step="0.5"
                                min="0"
                                max="100"
                                title="Perte %"
                                placeholder="%"
                              />
                              <button
                                onClick={saveEdit}
                                className="text-green-600 dark:text-green-400 hover:text-green-700 text-xs font-medium"
                              >
                                OK
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-metre-muted hover:text-metre-text text-xs"
                              >
                                Ann.
                              </button>
                            </div>
                          ) : (
                            /* Display */
                            <>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm text-metre-text truncate">
                                    {p.name}
                                  </span>
                                  {p.isComposite && (
                                    <span
                                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium uppercase tracking-wide"
                                      title={`Produit composite (${p.components?.length ?? 0} sous-produits, mode ${p.displayMode ?? 'detailed'})`}
                                    >
                                      Composite
                                    </span>
                                  )}
                                </div>
                                {p.dimensions && (
                                  <span className="text-[11px] text-metre-muted">
                                    {p.dimensions}
                                  </span>
                                )}
                              </div>
                              <span className="text-sm font-mono text-metre-accent whitespace-nowrap">
                                {(p.price ?? 0).toFixed(2)} $/{unitLabel(p.priceUnit)}
                              </span>
                              {(p.wastePct ?? 0) > 0 && (
                                <span className="text-[10px] text-amber-600 dark:text-amber-400 whitespace-nowrap" title="Facteur de perte">
                                  +{p.wastePct}%
                                </span>
                              )}
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {p.isComposite && (
                                  <button
                                    onClick={() => setCompositeEditorId(p.id)}
                                    className="text-[11px] text-purple-600 dark:text-purple-400 hover:text-purple-700"
                                    title="Gérer les sous-produits"
                                  >
                                    Comp.
                                  </button>
                                )}
                                <button
                                  onClick={() => startEdit(p)}
                                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700"
                                >
                                  Mod.
                                </button>
                                <button
                                  onClick={() => removeProduct(p.id)}
                                  className="text-[11px] text-red-600 dark:text-red-400 hover:text-red-700"
                                >
                                  Sup.
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ─── Ajouter tab ─── */}
          {activeTab === 'add' && (
            <div className="space-y-4 max-w-lg">
              <p className="text-sm text-metre-muted">Ajouter un nouveau produit</p>

              <div>
                <label className="text-sm text-metre-muted block mb-1">
                  Catégorie (nouvelle ou existante)
                </label>
                <input
                  className="input-field"
                  list="category-list"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Ex: Plancher, Toiture, Murs..."
                />
                <datalist id="category-list">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="text-sm text-metre-muted block mb-1">
                  Nom du produit
                </label>
                <input
                  className="input-field"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Céramique 12x24..."
                />
              </div>

              <div>
                <label className="text-sm text-metre-muted block mb-1">
                  Dimensions/Description
                </label>
                <input
                  className="input-field"
                  value={newDimensions}
                  onChange={(e) => setNewDimensions(e.target.value)}
                  placeholder='Ex: 12" x 24", Gris...'
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-sm text-metre-muted block mb-1">
                    Prix unitaire
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setNewPrice(Math.max(0, newPrice - 1))}
                      className="w-8 h-8 flex items-center justify-center rounded bg-blue-600 hover:bg-blue-700 text-white font-bold"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      className="input-field flex-1 text-center"
                      value={newPrice}
                      onChange={(e) => setNewPrice(Number(e.target.value))}
                      step="0.01"
                      min="0"
                    />
                    <button
                      type="button"
                      onClick={() => setNewPrice(newPrice + 1)}
                      className="w-8 h-8 flex items-center justify-center rounded bg-blue-600 hover:bg-blue-700 text-white font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="w-36">
                  <label className="text-sm text-metre-muted block mb-1">
                    Unité
                  </label>
                  <select
                    className="input-field h-8"
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                  >
                    {PRICE_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-4">
                <div>
                  <label className="text-sm text-metre-muted block mb-1">
                    Couleur
                  </label>
                  <ColorPicker value={newColor} onChange={setNewColor} />
                </div>

                <div className="flex-1">
                  <label className="text-sm text-metre-muted block mb-1">
                    Perte % (facteur de perte)
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="input-field flex-1"
                      value={newWastePct}
                      onChange={(e) => setNewWastePct(Number(e.target.value))}
                      step="0.5"
                      min="0"
                      max="100"
                      placeholder="0"
                    />
                    <span className="text-sm text-metre-muted">%</span>
                  </div>
                </div>
              </div>

              {/* Composite toggle — ERP mode only (requires numeric backend IDs) */}
              {isCompositeSupported() ? (
                <div className="rounded-lg border border-metre-border bg-metre-panel p-3 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newIsComposite}
                      onChange={(e) => setNewIsComposite(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm font-medium text-metre-text">
                      Produit composite (assemblage BOM)
                    </span>
                  </label>
                  <p className="text-[11px] text-metre-muted leading-relaxed">
                    Un produit composite regroupe plusieurs sous-produits avec une quantite par unite.
                    Exemple: &laquo; Mur 2x6 complet &raquo; contient montants, isolant, OSB, membrane, etc.
                    Apres la creation, utilisez le bouton &laquo; Comp. &raquo; dans la liste pour ajouter les sous-produits.
                  </p>
                  {newIsComposite && (
                    <div>
                      <label className="text-[10px] text-metre-muted block mb-1">
                        Mode d'affichage dans la soumission
                      </label>
                      <select
                        className="input-field"
                        value={newDisplayMode}
                        onChange={(e) => setNewDisplayMode(e.target.value as 'detailed' | 'summary')}
                      >
                        <option value="detailed">Détaillé — 1 ligne par sous-produit</option>
                        <option value="summary">Résumé — 1 seule ligne agrégée</option>
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-metre-border bg-metre-panel p-3 text-[11px] text-metre-muted">
                  Les produits composites (assemblages BOM) sont disponibles uniquement en mode ERP connecte.
                </div>
              )}

              <button
                onClick={handleAdd}
                disabled={!newName.trim() || !newCategory.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {newIsComposite ? 'Créer le produit composite' : 'Ajouter le produit'}
              </button>
            </div>
          )}

          {/* ─── Import/Export tab ─── */}
          {activeTab === 'import' && (
            <div className="space-y-6 max-w-lg">
              {/* Export */}
              <div>
                <h3 className="text-sm font-medium text-metre-text mb-2">
                  Exporter le catalogue
                </h3>
                <p className="text-xs text-metre-muted mb-3">
                  Télécharger le catalogue au format JSON ({products.length} produit
                  {products.length !== 1 ? 's' : ''})
                </p>
                <button
                  onClick={handleExport}
                  disabled={products.length === 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
                >
                  Exporter JSON
                </button>
              </div>

              <hr className="border-metre-border" />

              {/* Import */}
              <div>
                <h3 className="text-sm font-medium text-metre-text mb-2">
                  Importer un catalogue
                </h3>
                <p className="text-xs text-metre-muted mb-3">
                  Remplace le catalogue actuel. Supporte le format Métré PDF et le
                  format Streamlit (catégories imbriquées).
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded-lg transition-colors"
                >
                  Importer JSON
                </button>
              </div>

              <hr className="border-metre-border" />

              {/* Clear */}
              <div>
                <h3 className="text-sm font-medium text-metre-text mb-2">
                  Vider le catalogue
                </h3>
                <button
                  onClick={() => {
                    if (confirm('Supprimer tous les produits du catalogue ?')) {
                      importCatalog([]);
                    }
                  }}
                  disabled={products.length === 0}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
                >
                  Tout supprimer
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-metre-border text-xs text-metre-muted">
          {products.length} produit{products.length !== 1 ? 's' : ''} dans{' '}
          {categories.length} catégorie{categories.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Composite component editor (modal over this modal) */}
      {compositeEditorId && (
        <Suspense fallback={null}>
          <CompositeEditor
            productId={compositeEditorId}
            onClose={() => setCompositeEditorId(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
