import { useRightPanelState } from '../hooks/useRightPanelState';
import { useCallback, useMemo, useState } from 'react';
import { PRICE_UNITS } from '../types';
import type { Measurement } from '../types';
import { openEstimationInNewTab, downloadEstimationHtml } from '../utils/estimationHtml';
import { downloadEstimationPdf } from '../utils/estimationPdf';
import { downloadDxf } from '../utils/exportDxf';
import { computeSegments, hasSegmentDimensions, isClosedShape, formatMeasurement } from '../utils/format';
import { ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, Copy, ClipboardPaste } from 'lucide-react';
import MeasurementLabelCombobox from './MeasurementLabelCombobox';
import { buildBomLabelSuggestions } from '../utils/bomInputSuggestions';
import { AISuggestionsPanel } from './ai/AISuggestionsPanel';
import { useMetreStore } from '../store';

const COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#a855f7', '#06b6d4', '#ec4899', '#f97316',
];

export default function RightPanel() {
  const {
    rightPanelWidth, measurements,
    selectedMeasurementIds, selectedMeasurementId,
    updateMeasurement, updateSelectedMeasurements, removeSelectedMeasurements,
    calibration, pdfDocument,
    products, toggleCatalog,
    duplicateMeasurement, duplicateSelectedMeasurements,
    bringMeasurementToFront, sendMeasurementToBack,
    moveMeasurementUp, moveMeasurementDown,
    measurementGroups, addMeasurementGroup,
    propertyClipboard, copyMeasurementProperties, pasteMeasurementProperties,
    laborTrades, toggleLaborCatalog,
    symbolBlocks, toggleSymbolCatalog,
    currentPage, setSelectedMeasurementId,
  } = useRightPanelState();

  // PHASE 1: AI suggestions section is shown only when there are pending
  // detections for the current page. Round 15 fix: ERP_REACT historical
  // convention is 1-based pageNumber (matches CalibrationModal). All pageNumber
  // values are 1-based: calibrations, measurements, AI detections.
  const aiPendingForPage = useMetreStore((s) =>
    s.aiDetections.some(
      (d) => d.status === 'pending' && d.pageNumber === currentPage,
    ),
  );

  const [newGroupName, setNewGroupName] = useState('');

  const selected = measurements.find((m) => m.id === selectedMeasurementId) ?? null;

  // Suggestions for the Etiquette combobox: dedupe + group by sheet from
  // every composite product's bomInputs. Memoized on `products` -- only
  // recomputed when the catalog changes (rare).
  const labelSuggestions = useMemo(
    () => buildBomLabelSuggestions(products),
    [products],
  );

  const selectedProduct = useMemo(
    () => (selected?.productId ? products.find((p) => p.id === selected.productId) ?? null : null),
    [selected?.productId, products]
  );

  const selectedLaborTrade = useMemo(
    () => (selected?.laborTradeId ? laborTrades.find((t) => t.id === selected.laborTradeId) ?? null : null),
    [selected?.laborTradeId, laborTrades]
  );

  const laborCost = useMemo(() => {
    if (!selected || !selectedLaborTrade) return 0;
    const hours = selected.laborHours ?? 0;
    const persons = selected.laborPersons ?? selectedLaborTrade.nbPersons;
    return selectedLaborTrade.hourlyRate * hours * persons;
  }, [selected, selectedLaborTrade]);

  // Group products by category for the dropdown
  const groupedProducts = useMemo(() => {
    const groups: Record<string, typeof products> = {};
    for (const p of products) {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    }
    return groups;
  }, [products]);

  const handleLabelChange = useCallback(
    (label: string) => {
      if (selected) updateMeasurement(selected.id, { label });
    },
    [selected, updateMeasurement]
  );

  const handleColorChange = useCallback(
    (color: string) => {
      if (selected) updateMeasurement(selected.id, { color });
    },
    [selected, updateMeasurement]
  );

  // Default type labels used in LeftPanel — if the label matches one of these or is empty,
  // it is considered "default" and can be auto-replaced by the product name.
  const DEFAULT_LABELS = useMemo(() => new Set([
    '', 'Distance', 'Surface', 'Périmètre', 'Perimetre', 'Polyligne', 'Angle', 'Comptage',
    'Cercle', 'Texte', 'Flèche', 'Fleche', 'Nuage révision', 'Nuage revision',
    'Main levée', 'Main levee', 'Surligner', 'Note', 'Bulle texte',
  ]), []);

  const handleProductChange = useCallback(
    (productId: string) => {
      if (!selected) return;
      if (productId === '') {
        updateMeasurement(selected.id, { productId: undefined, quantity: undefined });
      } else {
        const product = products.find((p) => p.id === productId);
        // Auto-fill label with product name if label is empty/default or matches previous product
        const prevProduct = selected.productId ? products.find((p) => p.id === selected.productId) : null;
        const isDefaultLabel = DEFAULT_LABELS.has(selected.label) || selected.label === prevProduct?.name;
        updateMeasurement(selected.id, {
          productId,
          ...(product ? { color: product.color } : {}),
          ...(product && isDefaultLabel ? { label: product.name } : {}),
        });
      }
    },
    [selected, updateMeasurement, products, DEFAULT_LABELS]
  );

  const handleQuantityChange = useCallback(
    (qty: string) => {
      if (!selected) return;
      const val = parseFloat(qty);
      updateMeasurement(selected.id, { quantity: isNaN(val) ? undefined : val });
    },
    [selected, updateMeasurement]
  );

  const handleLaborTradeChange = useCallback(
    (tradeId: string) => {
      if (!selected) return;
      if (tradeId === '') {
        updateMeasurement(selected.id, { laborTradeId: undefined, laborHours: undefined, laborPersons: undefined });
      } else {
        const trade = laborTrades.find((t) => t.id === tradeId);
        updateMeasurement(selected.id, {
          laborTradeId: tradeId,
          laborPersons: trade?.nbPersons ?? 1,
        });
      }
    },
    [selected, updateMeasurement, laborTrades]
  );

  const handleSlopeFactorChange = useCallback(
    (factor: number | undefined) => {
      if (!selected) return;
      updateMeasurement(selected.id, { slopeFactor: factor });
    },
    [selected, updateMeasurement]
  );

  const SLOPE_PRESETS = [
    { label: 'Plat', value: 1.0 },
    { label: '2/12', value: 1.014 },
    { label: '4/12', value: 1.054 },
    { label: '6/12', value: 1.118 },
    { label: '8/12', value: 1.202 },
    { label: '10/12', value: 1.302 },
    { label: '12/12', value: 1.414 },
  ];

  const handleDeductionToggle = useCallback(
    (checked: boolean) => {
      if (!selected) return;
      updateMeasurement(selected.id, {
        isDeduction: checked,
        parentMeasurementId: checked ? selected.parentMeasurementId : undefined,
      });
    },
    [selected, updateMeasurement]
  );

  const handleParentChange = useCallback(
    (parentId: string) => {
      if (!selected) return;
      updateMeasurement(selected.id, {
        parentMeasurementId: parentId || undefined,
      });
    },
    [selected, updateMeasurement]
  );

  // currentPage comes from useRightPanelState

  // Candidate parents: same type, same page, not a deduction themselves, not this measurement
  const parentCandidates = useMemo(() => {
    if (!selected) return [];
    return measurements.filter(
      (m) =>
        m.id !== selected.id &&
        m.type === selected.type &&
        m.pageNumber === (selected.pageNumber ?? currentPage) &&
        !m.isDeduction
    );
  }, [selected, measurements, currentPage]);

  // Deductions linked to a given measurement
  const getDeductions = useCallback(
    (parentId: string): Measurement[] =>
      measurements.filter((m) => m.isDeduction && m.parentMeasurementId === parentId),
    [measurements]
  );

  // Net value (gross - deductions) for a measurement
  const getNetValue = useCallback(
    (m: Measurement): number => {
      const deductions = getDeductions(m.id);
      const totalDeducted = deductions.reduce((sum, d) => sum + (d.quantity ?? d.value), 0);
      return Math.max(0, (m.quantity ?? m.value) - totalDeducted);
    },
    [getDeductions]
  );

  // Deductions for the currently selected measurement (if it is a parent)
  const selectedDeductions = useMemo(
    () => (selected && !selected.isDeduction ? getDeductions(selected.id) : []),
    [selected, getDeductions]
  );

  // Calculate cost based on measurement value, deductions, slope factor, waste, and product price
  const costInfo = useMemo(() => {
    if (!selected || !selectedProduct) return null;

    const grossQty = (selected.quantity ?? selected.value) * (selected.slopeFactor ?? 1);
    // If this measurement is a deduction, it doesn't have its own cost
    if (selected.isDeduction) {
      const unitLabel = PRICE_UNITS.find((u) => u.value === selectedProduct.priceUnit)?.label ?? selectedProduct.priceUnit;
      return { grossQty, netQty: grossQty, wasteFactor: 1, qtyWithWaste: grossQty, total: 0, unitLabel, isDeduction: true };
    }
    const netQty = getNetValue(selected) * (selected.slopeFactor ?? 1);
    const wasteFactor = 1 + (selectedProduct.wastePct || 0) / 100;
    const qtyWithWaste = netQty * wasteFactor;
    const total = qtyWithWaste * selectedProduct.price;
    const unitLabel = PRICE_UNITS.find((u) => u.value === selectedProduct.priceUnit)?.label ?? selectedProduct.priceUnit;

    return { grossQty, netQty, wasteFactor, qtyWithWaste, total, unitLabel, isDeduction: false };
  }, [selected, selectedProduct, getNetValue]);

  // Summary: total material cost across all measurements with products (skip deductions)
  const totalMaterialCost = useMemo(() => {
    let sum = 0;
    for (const m of measurements) {
      if (!m.productId || m.isDeduction) continue;
      const prod = products.find((p) => p.id === m.productId);
      if (!prod) continue;
      const netQty = getNetValue(m) * (m.slopeFactor ?? 1);
      const wasteFactor = 1 + (prod.wastePct || 0) / 100;
      sum += netQty * wasteFactor * prod.price;
    }
    return sum;
  }, [measurements, products, getNetValue]);

  // Summary: total labor cost across all measurements with trades assigned
  const totalLaborCost = useMemo(() => {
    let sum = 0;
    for (const m of measurements) {
      if (!m.laborTradeId || m.isDeduction) continue;
      const trade = laborTrades.find((t) => t.id === m.laborTradeId);
      if (!trade) continue;
      const hours = m.laborHours ?? 0;
      if (hours <= 0) continue;
      const persons = m.laborPersons ?? trade.nbPersons;
      sum += trade.hourlyRate * hours * persons;
    }
    return sum;
  }, [measurements, laborTrades]);

  const totalCost = totalMaterialCost + totalLaborCost;

  const measurementsWithProducts = useMemo(
    () => measurements.filter((m) => m.productId && products.some((p) => p.id === m.productId)),
    [measurements, products]
  );

  const handleExportEstimation = useCallback(() => {
    const rows: string[][] = [
      ['Produit', 'Catégorie', 'Mesure', 'Type', 'Déduction', 'Qté brute', 'Qté nette', 'Perte %', 'Qté avec perte', 'Unité prix', 'Prix unitaire ($)', 'Coût total ($)'],
    ];

    let grandTotal = 0;

    for (const m of measurements) {
      if (!m.productId) continue;
      const prod = products.find((p) => p.id === m.productId);
      if (!prod) continue;

      const slopeFactor = m.slopeFactor ?? 1;
      const grossQty = (m.quantity ?? m.value) * slopeFactor;
      const isDeduction = m.isDeduction ?? false;
      const netQty = isDeduction ? grossQty : getNetValue(m) * slopeFactor;
      const wasteFactor = 1 + (prod.wastePct || 0) / 100;
      const qtyWithWaste = isDeduction ? 0 : netQty * wasteFactor;
      const cost = isDeduction ? 0 : qtyWithWaste * prod.price;
      grandTotal += cost;
      const unitLabel = PRICE_UNITS.find((u) => u.value === prod.priceUnit)?.label ?? prod.priceUnit;
      rows.push([
        prod.name,
        prod.category,
        m.label || `${m.type} #${m.id.slice(-4)}`,
        m.type,
        isDeduction ? 'Oui' : 'Non',
        (grossQty ?? 0).toFixed(3),
        (netQty ?? 0).toFixed(3),
        (prod.wastePct || 0).toFixed(1),
        (qtyWithWaste ?? 0).toFixed(3),
        unitLabel,
        (prod.price ?? 0).toFixed(2),
        (cost ?? 0).toFixed(2),
      ]);
    }

    rows.push([]);
    rows.push(['', '', '', '', '', '', '', '', '', '', 'TOTAL', (grandTotal ?? 0).toFixed(2)]);

    const csv = rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estimation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [measurements, products, getNetValue]);

  return (
    <div
      className="bg-metre-surface border-l border-metre-border overflow-y-auto flex-shrink-0"
      style={{ width: rightPanelWidth }}
    >
      {/* Properties panel */}
      <div className="panel-section">
        <span className="panel-title">Propriétés</span>

        {selectedMeasurementIds.length > 1 ? (
          /* ── Multi-selection bulk edit panel ── */
          <div className="space-y-3">
            <p className="text-xs text-metre-accent font-medium">
              {selectedMeasurementIds.length} mesures selectionnees
            </p>

            {/* Bulk color */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Couleur
              </label>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className="w-5 h-5 rounded-sm border-2 border-transparent hover:border-slate-400 dark:hover:border-neutral-500"
                    style={{ backgroundColor: c }}
                    onClick={() => updateSelectedMeasurements({ color: c })}
                  />
                ))}
              </div>
            </div>

            {/* Bulk group */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Groupe
              </label>
              <select
                className="input-field mt-1 w-full"
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  updateSelectedMeasurements({ group: val || undefined });
                }}
              >
                <option value="">— Choisir un groupe —</option>
                {measurementGroups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {/* Bulk opacity */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Transparence
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  defaultValue={100}
                  onChange={(e) => updateSelectedMeasurements({ opacity: parseInt(e.target.value, 10) / 100 })}
                  className="flex-1 accent-metre-accent"
                />
                <span className="text-xs text-metre-muted font-mono w-10 text-center">%</span>
              </div>
            </div>

            {/* Bulk deduction toggle */}
            <div className="flex gap-2">
              <button
                className="flex-1 px-2 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/40 text-red-600 dark:text-red-400 rounded transition-colors"
                onClick={() => updateSelectedMeasurements({ isDeduction: true })}
              >
                Marquer deductions
              </button>
              <button
                className="flex-1 px-2 py-1.5 text-xs bg-metre-bg hover:bg-metre-border text-metre-muted rounded transition-colors"
                onClick={() => updateSelectedMeasurements({ isDeduction: false, parentMeasurementId: undefined })}
              >
                Retirer deductions
              </button>
            </div>

            {/* Bulk product association */}
            {products.length > 0 && (
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                  Produit associe
                </label>
                <select
                  className="input-field mt-1 w-full"
                  value=""
                  onChange={(e) => {
                    const productId = e.target.value;
                    if (productId === '') {
                      updateSelectedMeasurements({ productId: undefined, quantity: undefined });
                    } else {
                      const product = products.find((p) => p.id === productId);
                      updateSelectedMeasurements({
                        productId,
                        ...(product ? { color: product.color } : {}),
                      });
                    }
                  }}
                >
                  <option value="">— Choisir un produit —</option>
                  <option value="">Retirer le produit</option>
                  {Object.entries(groupedProducts).map(([cat, prods]) => (
                    <optgroup key={cat} label={cat}>
                      {prods.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({(p.price ?? 0).toFixed(2)} $)
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}

            {/* Bulk paste properties */}
            {propertyClipboard && (
              <button
                className="w-full px-3 py-2 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-600 dark:text-emerald-400 font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
                onClick={pasteMeasurementProperties}
                title="Coller les propriétés sur les mesures sélectionnées (Ctrl+Shift+V)"
              >
                <ClipboardPaste size={14} />
                Coller proprietes sur {selectedMeasurementIds.length} mesures
              </button>
            )}

            {/* Bulk duplicate */}
            <button
              className="w-full px-3 py-2 text-xs bg-metre-bg hover:bg-metre-border text-metre-text font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
              onClick={duplicateSelectedMeasurements}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              Dupliquer {selectedMeasurementIds.length} mesures
            </button>

            {/* Bulk delete */}
            <button
              className="w-full px-3 py-2 text-xs bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
              onClick={removeSelectedMeasurements}
            >
              Supprimer {selectedMeasurementIds.length} mesures
            </button>
          </div>
        ) : selected ? (
          <div className="space-y-3">
            {/* Duplicate action */}
            <button
              onClick={() => duplicateMeasurement(selected.id)}
              className="w-full px-3 py-1.5 text-xs bg-metre-bg hover:bg-metre-border text-metre-text font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
              title="Dupliquer cette mesure (Ctrl+D)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              Dupliquer (Ctrl+D)
            </button>

            {/* Copy / Paste properties */}
            <div className="flex gap-2">
              <button
                onClick={() => copyMeasurementProperties(selected.id)}
                className="flex-1 px-3 py-1.5 text-xs bg-metre-bg hover:bg-metre-border text-metre-text font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
                title="Copier les propriétés (Ctrl+Shift+C)"
              >
                <Copy size={14} />
                Copier prop.
              </button>
              <button
                onClick={pasteMeasurementProperties}
                disabled={!propertyClipboard}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  propertyClipboard
                    ? 'bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-600 dark:text-emerald-400'
                    : 'bg-metre-bg text-metre-muted/40 cursor-not-allowed'
                }`}
                title="Coller les propriétés (Ctrl+Shift+V)"
              >
                <ClipboardPaste size={14} />
                Coller prop.
              </button>
            </div>

            {/* Draw order */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Ordre d&apos;affichage
              </label>
              <div className="flex gap-1 mt-1">
                <button
                  className="flex-1 px-1.5 py-1 text-[10px] bg-metre-bg hover:bg-metre-border text-metre-muted rounded transition-colors flex items-center justify-center gap-1"
                  onClick={() => sendMeasurementToBack(selected.id)}
                  title="Arriere-plan"
                >
                  <ArrowDownToLine size={12} />
                  Fond
                </button>
                <button
                  className="flex-1 px-1.5 py-1 text-[10px] bg-metre-bg hover:bg-metre-border text-metre-muted rounded transition-colors flex items-center justify-center gap-1"
                  onClick={() => moveMeasurementDown(selected.id)}
                  title="Reculer d'un niveau"
                >
                  <ChevronDown size={12} />
                  Reculer
                </button>
                <button
                  className="flex-1 px-1.5 py-1 text-[10px] bg-metre-bg hover:bg-metre-border text-metre-muted rounded transition-colors flex items-center justify-center gap-1"
                  onClick={() => moveMeasurementUp(selected.id)}
                  title="Avancer d'un niveau"
                >
                  <ChevronUp size={12} />
                  Avancer
                </button>
                <button
                  className="flex-1 px-1.5 py-1 text-[10px] bg-metre-bg hover:bg-metre-border text-metre-muted rounded transition-colors flex items-center justify-center gap-1"
                  onClick={() => bringMeasurementToFront(selected.id)}
                  title="Premier plan"
                >
                  <ArrowUpToLine size={12} />
                  Dessus
                </button>
              </div>
            </div>

            {/* Label -- combobox with grouped BOM input suggestions.
                User can pick a canonical name from the dropdown OR type
                any free-form label. Suggestions are grouped by Excel
                sheet (Sous-Sol, Rez-de-chaussee, Etage, Finition, Patio). */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Etiquette
              </label>
              <MeasurementLabelCombobox
                value={selected.label}
                onChange={handleLabelChange}
                groups={labelSuggestions}
                placeholder="Nom de la mesure ou variable BOM..."
              />
            </div>

            {/* ─── Text Content (note, callout, text) ─── */}
            {(selected.type === 'note' || selected.type === 'callout' || selected.type === 'text') && (
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                  Contenu texte
                </label>
                <textarea
                  className="input-field mt-1 w-full resize-y"
                  rows={3}
                  value={selected.textContent ?? ''}
                  onChange={(e) => updateMeasurement(selected.id, { textContent: e.target.value })}
                  placeholder="Entrez le texte de la note..."
                />
              </div>
            )}

            {/* ─── Groupe ─── */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Groupe
              </label>
              <select
                className="input-field mt-1 w-full"
                value={selected.group ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  updateMeasurement(selected.id, { group: val || undefined });
                }}
              >
                <option value="">{'\u2014'} Aucun groupe {'\u2014'}</option>
                {measurementGroups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <div className="flex gap-1 mt-1">
                <input
                  className="input-field flex-1 text-xs"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newGroupName.trim()) {
                      addMeasurementGroup(newGroupName.trim());
                      updateMeasurement(selected.id, { group: newGroupName.trim() });
                      setNewGroupName('');
                    }
                  }}
                  placeholder="Nouveau groupe + Entrée"
                />
                {newGroupName.trim() && (
                  <button
                    className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    onClick={() => {
                      addMeasurementGroup(newGroupName.trim());
                      updateMeasurement(selected.id, { group: newGroupName.trim() });
                      setNewGroupName('');
                    }}
                  >
                    +
                  </button>
                )}
              </div>
            </div>

            {/* Type */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Type
              </label>
              <p className="text-sm text-metre-text mt-0.5 capitalize">{selected.type}</p>
            </div>

            {/* Value */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Valeur
              </label>
              <p className="text-lg font-mono text-metre-accent mt-0.5 tabular-nums">
                {selected.type === 'angle'
                  ? `${(selected.value ?? 0).toFixed(1)}°`
                  : selected.type === 'count'
                  ? selected.value
                  : (selected.type === 'area' || selected.type === 'circle')
                  ? `${(selected.value ?? 0).toFixed(3)} ${selected.unit}²`
                  : (selected.unit === 'ft' || selected.unit === 'in')
                  ? formatMeasurement(selected.value ?? 0, selected.unit, selected.type)
                  : `${(selected.value ?? 0).toFixed(3)} ${selected.unit}`}
              </p>
            </div>

            {/* Points */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Points ({selected.points.length})
              </label>
              <div className="mt-1 max-h-24 overflow-y-auto">
                {selected.points.map((pt, i) => (
                  <div key={i} className="text-[11px] text-metre-muted font-mono">
                    P{i + 1}: ({(pt.x ?? 0).toFixed(1)}, {(pt.y ?? 0).toFixed(1)})
                  </div>
                ))}
              </div>
            </div>

            {/* Segments — per-edge dimensions for multi-point measurements.
                The closing edge is included for area / perimeter (closed shapes).
                For closed shapes the cumulative total is the perimeter (linear),
                not the area value of the measurement — labelled accordingly so
                the user is not misled by a "Total" tag in surface unit. */}
            {hasSegmentDimensions(selected.type) && selected.points.length >= 2 && (() => {
              const closed = isClosedShape(selected.type);
              const segments = computeSegments(
                selected.points,
                closed,
                calibration,
                selected.unit,
              );
              if (segments.length === 0) return null;
              const totalDisplay = segments.reduce((s, seg) => s + seg.displayLength, 0);
              // Match per-segment formatting: imperial in ft/in (1/16" precision),
              // decimal in metric. Without this, the total below the segments
              // list shows "16.21 ft" while every segment above shows
              // imperial — visually inconsistent.
              const totalValue = calibration
                ? formatMeasurement(totalDisplay, selected.unit, closed ? 'perimeter' : 'distance')
                : `${totalDisplay.toFixed(0)} px`;
              const totalLabel = closed ? 'Périmètre' : 'Longueur totale';
              return (
                <div role="region" aria-label="Dimensions par segment">
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                    Segments ({segments.length})
                  </label>
                  <div
                    className="mt-1 max-h-40 overflow-y-auto rounded border border-metre-border bg-metre-bg/40"
                    role="list"
                    aria-label={`${segments.length} segment${segments.length > 1 ? 's' : ''}`}
                  >
                    {segments.map((s) => {
                      const isClosingEdge = closed && s.index === segments.length - 1;
                      return (
                        <div
                          key={s.index}
                          role="listitem"
                          aria-label={`Segment ${s.index + 1}${isClosingEdge ? ' (fermeture)' : ''} : ${s.formatted}`}
                          className="flex justify-between items-center px-2 py-0.5 text-[11px] font-mono hover:bg-metre-bg"
                        >
                          <span className="text-metre-muted">
                            S{s.index + 1}
                            {isClosingEdge && (
                              <span
                                className="ml-1 text-[9px] uppercase tracking-wider text-metre-muted/70"
                                aria-hidden
                              >
                                fermeture
                              </span>
                            )}
                          </span>
                          <span className="text-metre-text tabular-nums">{s.formatted}</span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between items-center px-2 py-1 border-t border-metre-border/60 bg-metre-bg/60">
                      <span className="text-[10px] uppercase tracking-wider text-metre-muted font-medium">
                        {totalLabel}
                      </span>
                      <span className="text-[11px] font-mono text-metre-accent tabular-nums">
                        {totalValue}
                      </span>
                    </div>
                  </div>
                  {!calibration && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="mt-1 text-[10px] text-amber-600 dark:text-amber-400"
                    >
                      Plan non calibré — longueurs en pixels.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Stroke width (all line-based types) */}
            {selected.type !== 'text' && selected.type !== 'count' && (
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                  Epaisseur du trait
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={selected.strokeWidth ?? 2}
                    onChange={(e) => updateMeasurement(selected.id, { strokeWidth: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-metre-accent"
                  />
                  <span className="text-xs text-metre-text font-mono w-8 text-center">
                    {selected.strokeWidth ?? 2}px
                  </span>
                </div>
              </div>
            )}

            {/* Font size (text, arrow, cloud) */}
            {(selected.type === 'text' || selected.type === 'arrow' || selected.type === 'cloud' || selected.type === 'note' || selected.type === 'callout') && (
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                  Taille de police
                </label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range"
                    min="8"
                    max="72"
                    step="1"
                    value={selected.fontSize ?? 14}
                    onChange={(e) => updateMeasurement(selected.id, { fontSize: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-metre-accent"
                  />
                  <input
                    type="number"
                    min="8"
                    max="72"
                    className="input-field w-14 text-center text-xs"
                    value={selected.fontSize ?? 14}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 8 && val <= 72) {
                        updateMeasurement(selected.id, { fontSize: val });
                      }
                    }}
                  />
                  <span className="text-[10px] text-metre-muted">px</span>
                </div>
              </div>
            )}

            {/* Symbol rotation & scale */}
            {selected.type === 'symbol' && (
              <>
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                    Rotation
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range"
                      min="0"
                      max="360"
                      step="15"
                      value={selected.symbolRotation ?? 0}
                      onChange={(e) => updateMeasurement(selected.id, { symbolRotation: parseInt(e.target.value, 10) })}
                      className="flex-1 accent-metre-accent"
                    />
                    <input
                      type="number"
                      min="0"
                      max="360"
                      className="input-field w-14 text-center text-xs"
                      value={selected.symbolRotation ?? 0}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) updateMeasurement(selected.id, { symbolRotation: ((val % 360) + 360) % 360 });
                      }}
                    />
                    <span className="text-[10px] text-metre-muted">°</span>
                  </div>
                  <div className="flex gap-1 mt-1">
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                      <button
                        key={deg}
                        className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                          (selected.symbolRotation ?? 0) === deg
                            ? 'border-cyan-500 bg-cyan-600/30 text-cyan-700 dark:text-cyan-300'
                            : 'border-metre-border text-metre-muted hover:bg-metre-bg'
                        }`}
                        onClick={() => updateMeasurement(selected.id, { symbolRotation: deg })}
                      >
                        {deg}°
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                    Echelle
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range"
                      min="0.25"
                      max="3"
                      step="0.25"
                      value={selected.symbolScale ?? 1}
                      onChange={(e) => updateMeasurement(selected.id, { symbolScale: parseFloat(e.target.value) })}
                      className="flex-1 accent-metre-accent"
                    />
                    <span className="text-xs text-metre-text font-mono w-10 text-center">
                      {(selected.symbolScale ?? 1).toFixed(2)}x
                    </span>
                  </div>
                </div>
                {(() => {
                  const block = symbolBlocks.find((b) => b.id === selected.symbolBlockId);
                  if (!block) return null;
                  const scale = selected.symbolScale ?? 1;
                  const wIn = Math.round(block.widthReal / 0.0254 * scale);
                  const hIn = Math.round(block.heightReal / 0.0254 * scale);
                  return (
                    <div className="text-[10px] text-metre-muted">
                      {block.name} — {wIn}&quot; × {hIn}&quot; ({block.category})
                    </div>
                  );
                })()}
              </>
            )}

            {/* Color */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Couleur
              </label>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`w-5 h-5 rounded-sm border-2 ${
                      selected.color === c ? 'border-slate-900 dark:border-white' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => handleColorChange(c)}
                  />
                ))}
              </div>
            </div>

            {/* ─── Opacity ─── */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Transparence
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={Math.round((selected.opacity ?? 1) * 100)}
                  onChange={(e) => updateMeasurement(selected.id, { opacity: parseInt(e.target.value, 10) / 100 })}
                  className="flex-1 accent-metre-accent"
                />
                <span className="text-xs text-metre-text font-mono w-10 text-center">
                  {Math.round((selected.opacity ?? 1) * 100)}%
                </span>
              </div>
            </div>

            {/* ─── Slope Factor (Facteur de pente) ─── */}
            {(selected.type === 'area' || selected.type === 'circle') && (
              <div>
                <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                  Facteur de pente (toiture)
                </label>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {SLOPE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                        selected.slopeFactor !== undefined && Math.abs(selected.slopeFactor - preset.value) < 0.0005
                          ? 'border-blue-500 bg-blue-600/30 text-blue-700 dark:text-blue-300'
                          : 'border-metre-border text-metre-muted hover:bg-metre-bg'
                      }`}
                      onClick={() =>
                        handleSlopeFactorChange(
                          preset.value === 1.0 ? undefined : preset.value
                        )
                      }
                      title={`Facteur: ${(preset.value ?? 0).toFixed(3)}`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <label className="text-[10px] text-metre-muted whitespace-nowrap">
                    Personnalise:
                  </label>
                  <input
                    type="number"
                    className="input-field flex-1 text-right text-xs"
                    value={selected.slopeFactor ?? ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      handleSlopeFactorChange(isNaN(val) || val <= 0 ? undefined : val);
                    }}
                    step="0.001"
                    min="1"
                    placeholder="1.000"
                  />
                </div>
                {selected.slopeFactor && selected.slopeFactor !== 1 && (
                  <div className="bg-metre-bg rounded-lg p-2 mt-1.5 space-y-0.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-metre-muted">Surface horizontale</span>
                      <span className="font-mono text-metre-text">
                        {(selected.value ?? 0).toFixed(3)} {selected.unit}{'\u00b2'}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-metre-muted">Facteur</span>
                      <span className="font-mono text-amber-600 dark:text-amber-400">
                        {(selected.slopeFactor ?? 0).toFixed(3)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] pt-0.5 border-t border-metre-border">
                      <span className="text-metre-text font-medium">Surface reelle</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                        {(selected.value * selected.slopeFactor).toFixed(3)} {selected.unit}{'\u00b2'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── Deduction ─── */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.isDeduction ?? false}
                  onChange={(e) => handleDeductionToggle(e.target.checked)}
                  className="accent-red-500"
                />
                <span className={`text-xs font-medium ${selected.isDeduction ? 'text-red-600 dark:text-red-400' : 'text-metre-muted'}`}>
                  {selected.isDeduction ? '− Soustraction (deduction)' : 'Marquer comme soustraction'}
                </span>
              </label>

              {selected.isDeduction && (
                <div className="mt-2">
                  <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                    Mesure parente
                  </label>
                  <select
                    className="input-field mt-1 w-full"
                    value={selected.parentMeasurementId ?? ''}
                    onChange={(e) => handleParentChange(e.target.value)}
                  >
                    <option value="">— Aucune (generale) —</option>
                    {parentCandidates.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label || `${m.type} #${m.id.slice(-4)}`} ({formatMeasurement(m.value ?? 0, m.unit, m.type)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* ─── Value with deductions ─── */}
            {!selected.isDeduction && selectedDeductions.length > 0 && (
              <div className="bg-metre-bg rounded-lg p-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-metre-muted">Brut</span>
                  <span className="font-mono text-metre-text">
                    {formatMeasurement(selected.quantity ?? selected.value, selected.unit, selected.type)}
                  </span>
                </div>
                {selectedDeductions.map((d) => (
                  <div key={d.id} className="flex justify-between text-xs">
                    <span className="text-red-600 dark:text-red-400 truncate mr-2">
                      − {d.label || `${d.type} #${d.id.slice(-4)}`}
                    </span>
                    <span className="font-mono text-red-600 dark:text-red-400 whitespace-nowrap">
                      −{formatMeasurement(d.quantity ?? d.value, d.unit, d.type)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between text-xs pt-1 border-t border-metre-border">
                  <span className="text-metre-text font-medium">Net</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                    {formatMeasurement(getNetValue(selected), selected.unit, selected.type)}
                  </span>
                </div>
              </div>
            )}

            {/* ─── Product Association ─── */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Produit associe
              </label>
              {products.length === 0 ? (
                <p className="text-xs text-metre-muted mt-1">
                  Aucun produit dans le catalogue.{' '}
                  <button
                    onClick={toggleCatalog}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline"
                  >
                    Ajouter des produits
                  </button>
                </p>
              ) : (
                <select
                  className="input-field mt-1 w-full"
                  value={selected.productId ?? ''}
                  onChange={(e) => handleProductChange(e.target.value)}
                >
                  <option value="">— Aucun produit —</option>
                  {Object.entries(groupedProducts).map(([cat, prods]) => (
                    <optgroup key={cat} label={cat}>
                      {prods.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({(p.price ?? 0).toFixed(2)} $/{PRICE_UNITS.find((u) => u.value === p.priceUnit)?.label ?? p.priceUnit})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>

            {/* Cost calculation when product is linked */}
            {selectedProduct && costInfo && (
              <div className="bg-metre-bg rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: selectedProduct.color }}
                  />
                  <span className="text-xs text-metre-text font-medium truncate">
                    {selectedProduct.name}
                  </span>
                </div>

                {selectedProduct.dimensions && (
                  <p className="text-[11px] text-metre-muted">{selectedProduct.dimensions}</p>
                )}

                {costInfo.isDeduction ? (
                  <p className="text-xs text-red-600 dark:text-red-400 italic">
                    Soustraction — le cout est calcule sur la mesure parente.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-metre-muted uppercase tracking-wider whitespace-nowrap">
                        Quantite brute
                      </label>
                      <input
                        type="number"
                        className="input-field flex-1 text-right"
                        value={selected.quantity ?? (selected.value ?? 0).toFixed(3)}
                        onChange={(e) => handleQuantityChange(e.target.value)}
                        step="0.001"
                        min="0"
                      />
                    </div>

                    {selectedDeductions.length > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-metre-muted">Qte nette (apres deductions)</span>
                        <span className="font-mono text-metre-text">{(costInfo.netQty ?? 0).toFixed(3)}</span>
                      </div>
                    )}

                    {(selectedProduct.wastePct || 0) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-amber-600 dark:text-amber-400">
                          Perte: +{selectedProduct.wastePct}%
                        </span>
                        <span className="font-mono text-amber-600 dark:text-amber-400">{(costInfo.qtyWithWaste ?? 0).toFixed(3)}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-xs">
                      <span className="text-metre-muted">
                        Prix: {(selectedProduct.price ?? 0).toFixed(2)} $/{costInfo.unitLabel}
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-1 border-t border-metre-border">
                      <span className="text-xs text-metre-muted font-medium">Coût total</span>
                      <span className="text-base font-mono text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
                        {(costInfo.total ?? 0).toFixed(2)} $
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ─── Labor Trade Association ─── */}
            <div>
              <label className="text-[10px] text-metre-muted uppercase tracking-wider">
                Main-d&apos;oeuvre
              </label>
              {laborTrades.length === 0 ? (
                <p className="text-xs text-metre-muted mt-1">
                  Aucun corps de metier.{' '}
                  <button
                    onClick={toggleLaborCatalog}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline"
                  >
                    Ouvrir le catalogue
                  </button>
                </p>
              ) : (
                <select
                  className="input-field mt-1 w-full"
                  value={selected.laborTradeId ?? ''}
                  onChange={(e) => handleLaborTradeChange(e.target.value)}
                >
                  <option value="">— Aucun metier —</option>
                  {laborTrades.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.trade}{t.specialty ? ` — ${t.specialty}` : ''} ({(t.hourlyRate ?? 0).toFixed(2)} $/h)
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Labor cost calculation */}
            {selectedLaborTrade && (
              <div className="bg-metre-bg rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: selectedLaborTrade.color }} />
                  <span className="text-xs text-metre-text font-medium truncate">
                    {selectedLaborTrade.trade}
                    {selectedLaborTrade.specialty && <span className="text-metre-muted font-normal"> — {selectedLaborTrade.specialty}</span>}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-metre-muted uppercase tracking-wider">Heures</label>
                    <input
                      type="number"
                      className="input-field w-full text-right mt-0.5"
                      value={selected.laborHours ?? ''}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        updateMeasurement(selected.id, { laborHours: isNaN(val) ? undefined : val });
                      }}
                      step="0.5"
                      min="0"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-metre-muted uppercase tracking-wider">Personnes</label>
                    <input
                      type="number"
                      className="input-field w-full text-right mt-0.5"
                      value={selected.laborPersons ?? selectedLaborTrade.nbPersons}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        updateMeasurement(selected.id, { laborPersons: isNaN(val) || val < 1 ? undefined : val });
                      }}
                      min="1"
                    />
                  </div>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-metre-muted">
                    {(selectedLaborTrade.hourlyRate ?? 0).toFixed(2)} $/h × {selected.laborHours ?? 0}h × {selected.laborPersons ?? selectedLaborTrade.nbPersons} pers.
                  </span>
                </div>

                <div className="flex justify-between items-center pt-1 border-t border-metre-border">
                  <span className="text-xs text-metre-muted font-medium">Coût main-d&apos;oeuvre</span>
                  <span className="text-base font-mono text-cyan-600 dark:text-cyan-400 font-semibold tabular-nums">
                    {(laborCost ?? 0).toFixed(2)} $
                  </span>
                </div>
              </div>
            )}

            {/* Combined total (material + labor) */}
            {((costInfo && !costInfo.isDeduction && costInfo.total > 0) || laborCost > 0) && (costInfo?.total ?? 0) + laborCost > (costInfo?.total ?? 0) && laborCost > 0 && (costInfo?.total ?? 0) > 0 && (
              <div className="bg-emerald-600/10 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">TOTAL (materiaux + main-d&apos;oeuvre)</span>
                  <span className="text-lg font-mono text-emerald-600 dark:text-emerald-400 font-bold tabular-nums">
                    {((costInfo?.total ?? 0) + laborCost).toFixed(2)} $
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-metre-muted text-xs text-center py-4">
            Sélectionner une mesure pour voir ses propriétés
          </p>
        )}
      </div>

      {/* PHASE 1: AI Suggestions (only when there are pending detections for the page) */}
      {aiPendingForPage && (
        <div className="panel-section" style={{ maxHeight: 360, display: 'flex', flexDirection: 'column' }}>
          <AISuggestionsPanel pageNumber={currentPage} />
        </div>
      )}

      {/* Calibration info */}
      <div className="panel-section">
        <span className="panel-title">Calibration</span>

        {calibration ? (
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-metre-muted">Echelle:</span>
              <span className="text-metre-text font-mono">
                1px = {(calibration.scaleFactor ?? 0).toFixed(4)} {calibration.unit}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-metre-muted">Référence:</span>
              <span className="text-metre-text font-mono">
                {calibration.referenceLength} {calibration.unit}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-metre-muted">Pixels:</span>
              <span className="text-metre-text font-mono">
                {(calibration.pixelLength ?? 0).toFixed(1)} px
              </span>
            </div>
          </div>
        ) : (
          <p className="text-metre-muted text-xs text-center py-2">
            Non calibré - utilisez l'outil Calibrer
          </p>
        )}
      </div>

      {/* Product Catalog */}
      <div className="panel-section">
        <span className="panel-title">Catalogue de Produits</span>

        {products.length === 0 ? (
          <p className="text-metre-muted text-xs py-2">
            Catalogue vide
          </p>
        ) : (
          <p className="text-metre-muted text-xs py-1">
            {products.length} produit{products.length !== 1 ? 's' : ''} dans{' '}
            {new Set(products.map((p) => p.category)).size} cat.
          </p>
        )}
        <button
          onClick={toggleCatalog}
          className="w-full mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Gerer Catalogue
        </button>
      </div>

      {/* Labor Catalog */}
      <div className="panel-section">
        <span className="panel-title">Corps de Métier CCQ</span>
        <p className="text-metre-muted text-xs py-1">
          {laborTrades.length} métier{laborTrades.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={toggleLaborCatalog}
          className="w-full mt-2 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Gerer Main-d&apos;oeuvre
        </button>
      </div>

      {/* Symbol Catalog */}
      <div className="panel-section">
        <span className="panel-title">Symboles Architecturaux</span>
        <p className="text-metre-muted text-xs py-1">
          {symbolBlocks.length} symbole{symbolBlocks.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={toggleSymbolCatalog}
          className="w-full mt-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Gerer Symboles
        </button>
      </div>

      {/* Cost Summary */}
      {measurementsWithProducts.length > 0 && (
        <div className="panel-section">
          <span className="panel-title">Résumé des coûts</span>
          <div className="space-y-1.5">
            {measurementsWithProducts.map((m) => {
              const prod = products.find((p) => p.id === m.productId);
              if (!prod) return null;
              const isDeduction = m.isDeduction ?? false;
              const netQty = isDeduction ? 0 : getNetValue(m) * (m.slopeFactor ?? 1);
              const wasteFactor = 1 + (prod.wastePct || 0) / 100;
              const cost = isDeduction ? 0 : netQty * wasteFactor * prod.price;
              return (
                <div
                  key={m.id}
                  className={`flex justify-between items-center text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                    selectedMeasurementIds.includes(m.id)
                      ? 'bg-blue-600/20 text-metre-text'
                      : 'text-metre-muted hover:bg-metre-bg'
                  }`}
                  onClick={() => setSelectedMeasurementId(m.id)}
                >
                  <span className={`truncate flex-1 mr-2 ${isDeduction ? 'text-red-600 dark:text-red-400' : ''}`}>
                    {isDeduction ? '− ' : ''}{m.label || m.type}
                    {!isDeduction && (prod.wastePct || 0) > 0 ? ` (+${prod.wastePct}%)` : ''}
                  </span>
                  <span className={`font-mono whitespace-nowrap ${isDeduction ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {isDeduction ? '—' : `${(cost ?? 0).toFixed(2)} $`}
                  </span>
                </div>
              );
            })}
            {totalLaborCost > 0 && (
              <div className="flex justify-between items-center pt-2 mt-1 border-t border-metre-border/50">
                <span className="text-[10px] text-metre-muted">Matériaux</span>
                <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {(totalMaterialCost ?? 0).toFixed(2)} $
                </span>
              </div>
            )}
            {totalLaborCost > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-violet-600 dark:text-violet-400">Main-d&apos;oeuvre</span>
                <span className="text-xs font-mono text-violet-600 dark:text-violet-400 tabular-nums">
                  {(totalLaborCost ?? 0).toFixed(2)} $
                </span>
              </div>
            )}
            <div className={`flex justify-between items-center ${totalLaborCost > 0 ? 'pt-1 mt-1 border-t border-metre-border' : 'pt-2 mt-1 border-t border-metre-border'}`}>
              <span className="text-xs text-metre-text font-semibold">Total</span>
              <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400 font-bold tabular-nums">
                {(totalCost ?? 0).toFixed(2)} $
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => downloadEstimationPdf({
                  measurements,
                  products,
                  laborTrades,
                  getNetValue,
                })}
                className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Soumission PDF
              </button>
              <button
                onClick={handleExportEstimation}
                className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                CSV
              </button>
            </div>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => openEstimationInNewTab({
                  measurements,
                  products,
                  laborTrades,
                  groups: measurementGroups,
                  getNetValue,
                })}
                className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Estimation HTML
              </button>
              <button
                onClick={() => downloadEstimationHtml({
                  measurements,
                  products,
                  laborTrades,
                  groups: measurementGroups,
                  getNetValue,
                })}
                className="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Télécharger HTML
              </button>
              <button
                onClick={() => downloadDxf(measurements, calibration, undefined, symbolBlocks)}
                className="flex-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                DXF (AutoCAD)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document info */}
      <div className="panel-section border-b-0">
        <span className="panel-title">Document</span>

        {pdfDocument ? (
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-metre-muted">Fichier:</span>
              <span className="text-metre-text truncate ml-2 max-w-[140px]">
                {pdfDocument.filename}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-metre-muted">Pages:</span>
              <span className="text-metre-text">{pdfDocument.pageCount}</span>
            </div>
          </div>
        ) : (
          <p className="text-metre-muted text-xs text-center py-2">
            Aucun document charge
          </p>
        )}
      </div>
    </div>
  );
}
