import { useState, useMemo, useCallback, useRef } from 'react';
import { useMetreStore } from '../store';
import type { LaborTrade, LaborSector } from '../types';
import { X, Search, Download, Upload, Trash2, Pencil, Check, XCircle, HardHat } from 'lucide-react';
import { DEFAULT_LABOR_CATALOG } from '../data/defaultLaborCatalog';
import { ColorPicker } from './ui/ColorPicker';

type Tab = 'list' | 'add' | 'import';

const SECTORS: LaborSector[] = ['ICI', 'Residentiel', 'Genie civil', 'Industriel'];

const COLORS = [
  '#d97706', '#eab308', '#3b82f6', '#6366f1', '#06b6d4', '#ef4444',
  '#b45309', '#0d9488', '#78716c', '#a855f7', '#ec4899', '#f97316',
  '#14b8a6', '#8b5cf6', '#f59e0b', '#dc2626', '#22c55e', '#64748b',
];

export default function LaborCatalogPanel() {
  const laborTrades = useMetreStore((s) => s.laborTrades);
  const addLaborTrade = useMetreStore((s) => s.addLaborTrade);
  const updateLaborTrade = useMetreStore((s) => s.updateLaborTrade);
  const removeLaborTrade = useMetreStore((s) => s.removeLaborTrade);
  const importLaborCatalog = useMetreStore((s) => s.importLaborCatalog);
  const toggleLaborCatalog = useMetreStore((s) => s.toggleLaborCatalog);

  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add form state
  const [newTrade, setNewTrade] = useState('');
  const [newSpecialty, setNewSpecialty] = useState('');
  const [newSector, setNewSector] = useState<LaborSector>('ICI');
  const [newRate, setNewRate] = useState(45);
  const [newPersons, setNewPersons] = useState(1);
  const [newProdRate, setNewProdRate] = useState<number | undefined>();
  const [newProdUnit, setNewProdUnit] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');

  // Edit form state
  const [editTrade, setEditTrade] = useState('');
  const [editSpecialty, setEditSpecialty] = useState('');
  const [editRate, setEditRate] = useState(0);
  const [editPersons, setEditPersons] = useState(1);
  const [editProdRate, setEditProdRate] = useState<number | undefined>();
  const [editProdUnit, setEditProdUnit] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return laborTrades;
    const q = searchQuery.toLowerCase();
    return laborTrades.filter((t) =>
      t.trade.toLowerCase().includes(q) ||
      (t.specialty?.toLowerCase().includes(q)) ||
      t.sector.toLowerCase().includes(q)
    );
  }, [laborTrades, searchQuery]);

  // Group by sector
  const grouped = useMemo(() => {
    const groups: Record<string, LaborTrade[]> = {};
    for (const t of filtered) {
      if (!groups[t.sector]) groups[t.sector] = [];
      groups[t.sector].push(t);
    }
    return groups;
  }, [filtered]);

  const startEdit = useCallback((t: LaborTrade) => {
    setEditingId(t.id);
    setEditTrade(t.trade);
    setEditSpecialty(t.specialty ?? '');
    setEditRate(t.hourlyRate);
    setEditPersons(t.nbPersons);
    setEditProdRate(t.productivityRate);
    setEditProdUnit(t.productivityUnit ?? '');
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    updateLaborTrade(editingId, {
      trade: editTrade,
      specialty: editSpecialty || undefined,
      hourlyRate: editRate,
      nbPersons: editPersons,
      productivityRate: editProdRate || undefined,
      productivityUnit: editProdUnit || undefined,
    });
    setEditingId(null);
  }, [editingId, editTrade, editSpecialty, editRate, editPersons, editProdRate, editProdUnit, updateLaborTrade]);

  const handleAdd = useCallback(() => {
    if (!newTrade.trim()) return;
    const trade: LaborTrade = {
      id: `labor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      trade: newTrade.trim(),
      specialty: newSpecialty.trim() || undefined,
      sector: newSector,
      hourlyRate: newRate,
      nbPersons: newPersons,
      productivityRate: newProdRate || undefined,
      productivityUnit: newProdUnit || undefined,
      color: newColor,
    };
    addLaborTrade(trade);
    setNewTrade('');
    setNewSpecialty('');
    setNewRate(45);
    setNewPersons(1);
    setNewProdRate(undefined);
    setNewProdUnit('');
    setActiveTab('list');
  }, [newTrade, newSpecialty, newSector, newRate, newPersons, newProdRate, newProdUnit, newColor, addLaborTrade]);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(laborTrades, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalogue-main-oeuvre-ccq.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [laborTrades]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (Array.isArray(data) && data.length > 0 && data[0].trade) {
          importLaborCatalog(data as LaborTrade[]);
        }
      } catch { /* ignore bad json */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [importLaborCatalog]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/60">
      <div className="bg-metre-surface border border-metre-border rounded-xl shadow-xl w-[640px] max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-metre-border">
          <h2 className="text-sm font-semibold text-metre-text flex items-center gap-2">
            <HardHat className="w-4 h-4" /> Corps de Métier CCQ 2026
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-metre-muted">{laborTrades.length} métiers</span>
            <button
              onClick={toggleLaborCatalog}
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
              {tab === 'list' ? 'Métiers' : tab === 'add' ? 'Ajouter' : 'Import/Export'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'list' && (
            <div className="p-3 space-y-3">
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-metre-muted" />
                <input
                  type="text"
                  placeholder="Rechercher un métier..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input-field pl-8 w-full"
                />
              </div>

              {/* Grouped list */}
              {Object.entries(grouped).map(([sector, trades]) => (
                <div key={sector}>
                  <div className="text-[10px] uppercase tracking-wider text-metre-muted font-semibold mb-1.5 px-1">
                    {sector} ({trades.length})
                  </div>
                  <div className="space-y-1">
                    {trades.map((t) => (
                      editingId === t.id ? (
                        /* Edit mode */
                        <div key={t.id} className="bg-metre-panel rounded-lg p-2 space-y-2 border border-metre-accent/50">
                          <div className="grid grid-cols-2 gap-2">
                            <input className="input-field text-xs" value={editTrade} onChange={(e) => setEditTrade(e.target.value)} placeholder="Métier" />
                            <input className="input-field text-xs" value={editSpecialty} onChange={(e) => setEditSpecialty(e.target.value)} placeholder="Spécialité (opt.)" />
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <div>
                              <label className="text-[9px] text-metre-muted">Taux/h</label>
                              <input type="number" step="0.01" className="input-field text-xs w-full" value={editRate} onChange={(e) => setEditRate(parseFloat(e.target.value) || 0)} />
                            </div>
                            <div>
                              <label className="text-[9px] text-metre-muted">Pers.</label>
                              <input type="number" min="1" className="input-field text-xs w-full" value={editPersons} onChange={(e) => setEditPersons(parseInt(e.target.value) || 1)} />
                            </div>
                            <div>
                              <label className="text-[9px] text-metre-muted">Prod.</label>
                              <input type="number" step="0.001" className="input-field text-xs w-full" value={editProdRate ?? ''} onChange={(e) => setEditProdRate(e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="-" />
                            </div>
                            <div>
                              <label className="text-[9px] text-metre-muted">Unité</label>
                              <input className="input-field text-xs w-full" value={editProdUnit} onChange={(e) => setEditProdUnit(e.target.value)} placeholder="h/pi2" />
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
                        /* Display mode */
                        <div
                          key={t.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-metre-panel group transition-colors"
                        >
                          <ColorPicker
                            value={t.color || '#94a3b8'}
                            onChange={(color) => updateLaborTrade(t.id, { color })}
                            compact
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-metre-text font-medium truncate">
                              {t.trade}
                              {t.specialty && <span className="text-metre-muted font-normal ml-1">— {t.specialty}</span>}
                            </div>
                            <div className="text-[10px] text-metre-muted">
                              {(t.hourlyRate ?? 0).toFixed(2)} $/h
                              {t.nbPersons > 1 && ` · ${t.nbPersons} pers.`}
                              {t.productivityRate && ` · ${t.productivityRate} ${t.productivityUnit || ''}`}
                            </div>
                          </div>
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEdit(t)}
                              className="p-1 rounded hover:bg-metre-border text-metre-muted hover:text-metre-text transition-colors"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => removeLaborTrade(t.id)}
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
                <p className="text-centre text-sm text-metre-muted py-8 text-center">
                  Aucun metier trouve
                </p>
              )}
            </div>
          )}

          {activeTab === 'add' && (
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Corps de métier *</label>
                <input className="input-field w-full mt-1" value={newTrade} onChange={(e) => setNewTrade(e.target.value)} placeholder="ex: Charpentier-menuisier" />
              </div>
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Spécialité (optionnel)</label>
                <input className="input-field w-full mt-1" value={newSpecialty} onChange={(e) => setNewSpecialty(e.target.value)} placeholder="ex: Coffrage, Finition" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Secteur</label>
                  <select className="input-field w-full mt-1" value={newSector} onChange={(e) => setNewSector(e.target.value as LaborSector)}>
                    {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Taux horaire ($)</label>
                  <input type="number" step="0.01" className="input-field w-full mt-1" value={newRate} onChange={(e) => setNewRate(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Nb personnes</label>
                  <input type="number" min="1" className="input-field w-full mt-1" value={newPersons} onChange={(e) => setNewPersons(parseInt(e.target.value) || 1)} />
                </div>
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Productivite</label>
                  <input type="number" step="0.001" className="input-field w-full mt-1" value={newProdRate ?? ''} onChange={(e) => setNewProdRate(e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="0.12" />
                </div>
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Unité prod.</label>
                  <input className="input-field w-full mt-1" value={newProdUnit} onChange={(e) => setNewProdUnit(e.target.value)} placeholder="h/pi2" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider font-semibold">Couleur</label>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      className={`w-6 h-6 rounded-md border-2 transition-colors ${newColor === c ? 'border-slate-900 dark:border-white' : 'border-transparent hover:border-slate-400 dark:hover:border-neutral-500'}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setNewColor(c)}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={handleAdd}
                disabled={!newTrade.trim()}
                className="w-full px-4 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:bg-metre-panel disabled:text-metre-muted text-white font-medium rounded-lg transition-colors"
              >
                Ajouter le metier
              </button>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="p-4 space-y-4">
              {/* Export */}
              <div>
                <h3 className="text-xs font-semibold text-metre-text mb-2">Exporter</h3>
                <button
                  onClick={handleExport}
                  className="w-full px-4 py-2 text-xs bg-metre-bg hover:bg-metre-border text-metre-text rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Download size={14} />
                  Télécharger JSON ({laborTrades.length} métiers)
                </button>
              </div>

              {/* Import */}
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

              {/* Reset to defaults */}
              <div className="pt-2 border-t border-metre-border">
                <h3 className="text-xs font-semibold text-metre-text mb-2">Réinitialiser</h3>
                <button
                  onClick={() => {
                    if (confirm('Réinitialiser le catalogue aux valeurs CCQ 2026 par défaut ?')) {
                      importLaborCatalog(DEFAULT_LABOR_CATALOG);
                    }
                  }}
                  className="w-full px-4 py-2 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                >
                  Restaurer les taux CCQ 2026 par défaut
                </button>
              </div>

              <p className="text-[10px] text-metre-muted leading-relaxed">
                Taux horaires chargés (salaire + avantages sociaux) basés sur la convention collective CCQ 2025-2029 (secteur ICI), mise à jour mai 2026. Inclut compagnons et apprentis (P1 à P5 selon le métier) + occupations.
                Consultez <strong>ccq.org</strong> pour les taux officiels à jour.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
