import { useState, useMemo, useCallback, useRef } from 'react';
import { useMetreStore } from '../store';
import type { SymbolBlockDef, SymbolView } from '../types';
import { X, Search, Download, Upload, Trash2, Pencil, Check, XCircle } from 'lucide-react';
import { DEFAULT_SYMBOL_BLOCKS } from '../data/defaultSymbolBlocks';

type Tab = 'list' | 'add' | 'import';

const CATEGORIES = [
  'Portes', 'Fenêtres', 'Sanitaire', 'Cuisine',
  'Électrique', 'Escaliers', 'Mobilier',
];

const VIEW_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Toutes vues' },
  { value: 'plan', label: 'Plan' },
  { value: 'elevation', label: 'Élévation' },
  { value: 'droite', label: 'Droite' },
];

const COLORS = [
  '#06b6d4', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#10b981', '#6b7280', '#ec4899', '#f97316', '#14b8a6',
];

/** Render a symbol's paths into an SVG preview */
function SymbolPreview({ block, size = 40 }: { block: SymbolBlockDef; size?: number }) {
  const pad = 2;
  const s = size - pad * 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`translate(${pad},${pad})`}>
        {block.paths.map((p, i) => {
          if (p.type === 'line') {
            const [x1, y1, x2, y2] = p.data;
            return <line key={i} x1={x1 * s} y1={y1 * s} x2={x2 * s} y2={y2 * s} stroke={block.color} strokeWidth={1.5} fill="none" />;
          }
          if (p.type === 'rect') {
            const [x, y, w, h] = p.data;
            return <rect key={i} x={x * s} y={y * s} width={w * s} height={h * s} stroke={block.color} strokeWidth={1.5} fill="none" />;
          }
          if (p.type === 'arc') {
            const [cx, cy, r, startDeg, endDeg] = p.data;
            if (Math.abs(endDeg - startDeg) >= 360) {
              return <circle key={i} cx={cx * s} cy={cy * s} r={r * s} stroke={block.color} strokeWidth={1.5} fill="none" />;
            }
            const startRad = (startDeg * Math.PI) / 180;
            const endRad = (endDeg * Math.PI) / 180;
            const x1 = cx * s + r * s * Math.cos(startRad);
            const y1 = cy * s + r * s * Math.sin(startRad);
            const x2 = cx * s + r * s * Math.cos(endRad);
            const y2 = cy * s + r * s * Math.sin(endRad);
            const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
            const sweep = endDeg > startDeg ? 1 : 0;
            return <path key={i} d={`M ${x1} ${y1} A ${r * s} ${r * s} 0 ${largeArc} ${sweep} ${x2} ${y2}`} stroke={block.color} strokeWidth={1.5} fill="none" />;
          }
          return null;
        })}
      </g>
    </svg>
  );
}

export default function SymbolCatalogPanel() {
  const symbolBlocks = useMetreStore((s) => s.symbolBlocks);
  const addSymbolBlock = useMetreStore((s) => s.addSymbolBlock);
  const updateSymbolBlock = useMetreStore((s) => s.updateSymbolBlock);
  const removeSymbolBlock = useMetreStore((s) => s.removeSymbolBlock);
  const importSymbolBlocks = useMetreStore((s) => s.importSymbolBlocks);
  const toggleSymbolCatalog = useMetreStore((s) => s.toggleSymbolCatalog);
  const setActiveSymbolBlock = useMetreStore((s) => s.setActiveSymbolBlock);
  const setActiveTool = useMetreStore((s) => s.setActiveTool);

  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterView, setFilterView] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Portes');
  const [newWidthIn, setNewWidthIn] = useState(36);
  const [newHeightIn, setNewHeightIn] = useState(36);
  const [newColor, setNewColor] = useState('#06b6d4');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editWidthIn, setEditWidthIn] = useState(0);
  const [editHeightIn, setEditHeightIn] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter
  const filtered = useMemo(() => {
    let result = symbolBlocks;
    if (filterCategory) {
      result = result.filter((b) => b.category === filterCategory);
    }
    if (filterView) {
      result = result.filter((b) => b.view === filterView);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((b) =>
        b.name.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q)
      );
    }
    return result;
  }, [symbolBlocks, searchQuery, filterCategory, filterView]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, SymbolBlockDef[]> = {};
    for (const b of filtered) {
      if (!groups[b.category]) groups[b.category] = [];
      groups[b.category].push(b);
    }
    return groups;
  }, [filtered]);

  const startEdit = useCallback((b: SymbolBlockDef) => {
    setEditingId(b.id);
    setEditName(b.name);
    setEditCategory(b.category);
    setEditWidthIn(Math.round(b.widthReal / 0.0254));
    setEditHeightIn(Math.round(b.heightReal / 0.0254));
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    updateSymbolBlock(editingId, {
      name: editName,
      category: editCategory,
      widthReal: editWidthIn * 0.0254,
      heightReal: editHeightIn * 0.0254,
    });
    setEditingId(null);
  }, [editingId, editName, editCategory, editWidthIn, editHeightIn, updateSymbolBlock]);

  const handleAdd = useCallback(() => {
    if (!newName.trim()) return;
    const block: SymbolBlockDef = {
      id: `sym-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newName.trim(),
      category: newCategory,
      view: 'plan' as SymbolView,
      widthReal: newWidthIn * 0.0254,
      heightReal: newHeightIn * 0.0254,
      color: newColor,
      paths: [{ type: 'rect', data: [0, 0, 1, 1] }],
    };
    addSymbolBlock(block);
    setNewName('');
    setActiveTab('list');
  }, [newName, newCategory, newWidthIn, newHeightIn, newColor, addSymbolBlock]);

  const handleSelectSymbol = useCallback((block: SymbolBlockDef) => {
    setActiveSymbolBlock(block.id);
    setActiveTool('stamp');
    toggleSymbolCatalog();
  }, [setActiveSymbolBlock, setActiveTool, toggleSymbolCatalog]);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(symbolBlocks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalogue-symboles.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [symbolBlocks]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (Array.isArray(data) && data.length > 0 && data[0].paths) {
          importSymbolBlocks(data as SymbolBlockDef[]);
        }
      } catch { /* ignore bad json */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [importSymbolBlocks]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/60">
      <div className="bg-metre-surface border border-metre-border rounded-xl shadow-xl w-[640px] max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-metre-border">
          <h2 className="text-sm font-semibold text-metre-text flex items-center gap-2">
            Symboles Architecturaux
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-metre-muted">{symbolBlocks.length} symboles</span>
            <button
              onClick={toggleSymbolCatalog}
              className="p-1 rounded hover:bg-metre-panel text-metre-muted hover:text-metre-text transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-metre-border">
          {(['list', 'add', 'import'] as Tab[]).map((tab) => (
            <button
              key={tab}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? 'text-metre-accent border-b-2 border-metre-accent'
                  : 'text-metre-muted hover:text-metre-text'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'list' ? 'Symboles' : tab === 'add' ? 'Ajouter' : 'Import/Export'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'list' && (
            <div className="p-3 space-y-3">
              {/* Search + category filter */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-metre-muted" />
                  <input
                    type="text"
                    placeholder="Rechercher..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input-field pl-8 w-full"
                  />
                </div>
                <select
                  className="input-field text-xs"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                >
                  <option value="">Toutes</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  className="input-field text-xs"
                  value={filterView}
                  onChange={(e) => setFilterView(e.target.value)}
                >
                  {VIEW_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </div>

              {/* Grouped list */}
              {Object.entries(grouped).map(([category, blocks]) => (
                <div key={category}>
                  <div className="text-[10px] uppercase tracking-wider text-metre-muted font-semibold mb-1.5 px-1">
                    {category} ({blocks.length})
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {blocks.map((b) => (
                      editingId === b.id ? (
                        <div key={b.id} className="col-span-2 bg-metre-panel rounded-lg p-2 space-y-2 border border-metre-accent/50">
                          <div className="grid grid-cols-2 gap-2">
                            <input className="input-field text-xs" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nom" />
                            <select className="input-field text-xs" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[9px] text-metre-muted">Largeur (po)</label>
                              <input type="number" className="input-field text-xs w-full" value={editWidthIn} onChange={(e) => setEditWidthIn(parseInt(e.target.value) || 0)} />
                            </div>
                            <div>
                              <label className="text-[9px] text-metre-muted">Hauteur (po)</label>
                              <input type="number" className="input-field text-xs w-full" value={editHeightIn} onChange={(e) => setEditHeightIn(parseInt(e.target.value) || 0)} />
                            </div>
                          </div>
                          <div className="flex gap-1 justify-end">
                            <button onClick={saveEdit} className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors flex items-center gap-1">
                              <Check size={12} /> OK
                            </button>
                            <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs bg-metre-bg hover:bg-metre-border text-metre-muted rounded transition-colors flex items-center gap-1">
                              <XCircle size={12} /> Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          key={b.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-metre-panel group transition-colors cursor-pointer"
                          onClick={() => handleSelectSymbol(b)}
                        >
                          <SymbolPreview block={b} size={36} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-metre-text font-medium truncate">{b.name}</div>
                            <div className="text-[10px] text-metre-muted flex items-center gap-1">
                              {Math.round(b.widthReal / 0.0254)}&quot; × {Math.round(b.heightReal / 0.0254)}&quot;
                              {b.view && <span className="px-1 py-0.5 rounded bg-metre-bg text-[8px] uppercase">{b.view === 'elevation' ? 'élév.' : b.view}</span>}
                            </div>
                          </div>
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => startEdit(b)}
                              className="p-1 rounded hover:bg-metre-border text-metre-muted hover:text-metre-text transition-colors"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => removeSymbolBlock(b.id)}
                              className="p-1 rounded hover:bg-red-600/10 text-metre-muted hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              ))}

              {filtered.length === 0 && (
                <p className="text-sm text-metre-muted py-8 text-center">
                  Aucun symbole trouve
                </p>
              )}
            </div>
          )}

          {activeTab === 'add' && (
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Nom *</label>
                <input className="input-field w-full mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ex: Porte battante 42po" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Catégorie</label>
                  <select className="input-field w-full mt-1" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Couleur</label>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        className={`w-5 h-5 rounded-md border-2 transition-colors ${newColor === c ? 'border-slate-900 dark:border-white' : 'border-transparent hover:border-slate-400 dark:hover:border-neutral-500'}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setNewColor(c)}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Largeur (pouces)</label>
                  <input type="number" className="input-field w-full mt-1" value={newWidthIn} onChange={(e) => setNewWidthIn(parseInt(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Hauteur (pouces)</label>
                  <input type="number" className="input-field w-full mt-1" value={newHeightIn} onChange={(e) => setNewHeightIn(parseInt(e.target.value) || 0)} />
                </div>
              </div>
              <p className="text-[10px] text-metre-muted">
                Le symbole personnalise sera un rectangle simple. Pour des formes complexes, exportez et editez le JSON.
              </p>
              <button
                onClick={handleAdd}
                disabled={!newName.trim()}
                className="w-full px-4 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:bg-metre-panel disabled:text-metre-muted text-white font-medium rounded-lg transition-colors"
              >
                Ajouter le symbole
              </button>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="p-4 space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-metre-text mb-2">Exporter</h3>
                <button
                  onClick={handleExport}
                  className="w-full px-4 py-2 text-xs bg-metre-bg hover:bg-metre-border text-metre-text rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Download size={14} />
                  Télécharger JSON ({symbolBlocks.length} symboles)
                </button>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-metre-text mb-2">Importer</h3>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-2 text-xs bg-metre-bg hover:bg-metre-border text-metre-text rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Upload size={14} />
                  Importer un fichier JSON
                </button>
              </div>

              <div className="pt-2 border-t border-metre-border">
                <h3 className="text-xs font-semibold text-metre-text mb-2">Réinitialiser</h3>
                <button
                  onClick={() => {
                    if (confirm('Réinitialiser le catalogue de symboles par défaut ?')) {
                      importSymbolBlocks(DEFAULT_SYMBOL_BLOCKS);
                    }
                  }}
                  className="w-full px-4 py-2 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                >
                  Restaurer les symboles par défaut
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
