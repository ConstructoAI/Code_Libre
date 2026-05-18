import { useMemo, useCallback, useState } from 'react';
import { useMetreStore } from '../store';
import { PRICE_UNITS } from '../types';
import type { Measurement } from '../types';
import { openEstimationInNewTab, downloadEstimationHtml } from '../utils/estimationHtml';
import { downloadEstimationPdf } from '../utils/estimationPdf';
import { downloadDxf } from '../utils/exportDxf';
import { formatMeasurement } from '../utils/format';
import { getERPContext } from '../api';

function FieldRow({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-metre-text font-medium w-[70px] flex-shrink-0">{label}:</span>
      <input
        className="flex-1 bg-metre-surface border border-metre-border rounded px-2 py-0.5 text-metre-text placeholder:text-metre-muted/50 focus:border-metre-accent focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export default function SummaryPanel() {
  const measurements = useMetreStore((s) => s.measurements);
  const products = useMetreStore((s) => s.products);
  const laborTrades = useMetreStore((s) => s.laborTrades);
  const toggleSummary = useMetreStore((s) => s.toggleSummary);
  const measurementGroups = useMetreStore((s) => s.measurementGroups);
  const calibration = useMetreStore((s) => s.calibration);

  // Client / Project info – pre-filled from Fiche Client, editable by user
  const erpCtx = getERPContext();
  const [clientName, setClientName] = useState(erpCtx?.client_name ?? '');
  const [clientAddress, setClientAddress] = useState(erpCtx?.client_address ?? '');
  const [clientCity, setClientCity] = useState(erpCtx?.client_city ?? '');
  const [clientPhone, setClientPhone] = useState(erpCtx?.client_phone ?? '');
  const [clientEmail, setClientEmail] = useState(erpCtx?.client_email ?? '');
  const [projectName, setProjectName] = useState(erpCtx?.project_name ?? '');
  const [projectAddress, setProjectAddress] = useState('');
  const [projectType, setProjectType] = useState(erpCtx?.project_type ?? '');
  const [projectArea, setProjectArea] = useState('');

  // ── Helpers ──

  const getDeductions = useCallback(
    (parentId: string): Measurement[] =>
      measurements.filter((m) => m.isDeduction && m.parentMeasurementId === parentId),
    [measurements]
  );

  const getNetValue = useCallback(
    (m: Measurement): number => {
      const deductions = getDeductions(m.id);
      const totalDeducted = deductions.reduce((sum, d) => sum + (d.quantity ?? d.value), 0);
      return Math.max(0, (m.quantity ?? m.value) - totalDeducted);
    },
    [getDeductions]
  );

  const unitLabel = (val: string) =>
    PRICE_UNITS.find((u) => u.value === val)?.label ?? val;

  // ── By Group ──

  const groupedMeasurements = useMemo(() => {
    const groups: Record<string, Measurement[]> = {};
    for (const g of measurementGroups) {
      groups[g] = measurements.filter((m) => m.group === g);
    }
    // Also gather ungrouped
    const ungrouped = measurements.filter((m) => !m.group);
    return { groups, ungrouped };
  }, [measurements, measurementGroups]);

  const groupCosts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const [groupName, ms] of Object.entries(groupedMeasurements.groups)) {
      let sum = 0;
      for (const m of ms) {
        if (!m.productId || m.isDeduction) continue;
        const prod = products.find((p) => p.id === m.productId);
        if (!prod) continue;
        const netQty = getNetValue(m) * (m.slopeFactor ?? 1);
        const wasteFactor = 1 + (prod.wastePct || 0) / 100;
        sum += netQty * wasteFactor * prod.price;
      }
      result[groupName] = sum;
    }
    return result;
  }, [groupedMeasurements.groups, products, getNetValue]);

  // ── By Type ──

  const byType = useMemo(() => {
    const types: Record<string, { count: number; totalValue: number; unit: string }> = {};
    for (const m of measurements) {
      if (m.isDeduction) continue;
      const key = m.type;
      if (!types[key]) {
        types[key] = { count: 0, totalValue: 0, unit: m.unit };
      }
      types[key].count += 1;
      types[key].totalValue += m.value;
    }
    return types;
  }, [measurements]);

  const typeDisplayName = (type: string, unit: string): string => {
    switch (type) {
      case 'distance':
      case 'polyline':
        return `${type === 'distance' ? 'Distances' : 'Polylignes'} (${unit === 'ft' ? 'pi lin.' : unit + ' lin.'})`;
      case 'area':
      case 'circle':
        return `${type === 'area' ? 'Surfaces' : 'Cercles'} (${unit === 'ft' ? 'pi' : unit}\u00b2)`;
      case 'perimeter':
        return `Périmètres (${unit === 'ft' ? 'pi lin.' : unit + ' lin.'})`;
      case 'count':
        return 'Comptages';
      case 'angle':
        return 'Angles';
      case 'dimension':
        return `Cotations (${unit === 'ft' ? 'pi lin.' : unit + ' lin.'})`;
      default:
        return type;
    }
  };

  // ── By Product ──

  const byProduct = useMemo(() => {
    const result: Record<string, {
      productName: string;
      category: string;
      totalQty: number;
      totalQtyWaste: number;
      unitPrice: number;
      priceUnit: string;
      totalCost: number;
    }> = {};

    for (const m of measurements) {
      if (!m.productId || m.isDeduction) continue;
      const prod = products.find((p) => p.id === m.productId);
      if (!prod) continue;

      const netQty = getNetValue(m) * (m.slopeFactor ?? 1);
      const wasteFactor = 1 + (prod.wastePct || 0) / 100;
      const qtyWithWaste = netQty * wasteFactor;
      const cost = qtyWithWaste * prod.price;

      if (!result[prod.id]) {
        result[prod.id] = {
          productName: prod.name,
          category: prod.category,
          totalQty: 0,
          totalQtyWaste: 0,
          unitPrice: prod.price,
          priceUnit: prod.priceUnit,
          totalCost: 0,
        };
      }
      result[prod.id].totalQty += netQty;
      result[prod.id].totalQtyWaste += qtyWithWaste;
      result[prod.id].totalCost += cost;
    }
    return result;
  }, [measurements, products, getNetValue]);

  const grandTotal = useMemo(() => {
    return Object.values(byProduct).reduce((sum, p) => sum + p.totalCost, 0);
  }, [byProduct]);

  // ── By Page ──

  const byPage = useMemo(() => {
    const pages: Record<number, { count: number; totalArea: number; totalDistance: number; areaUnit: string; distUnit: string }> = {};
    for (const m of measurements) {
      if (m.isDeduction) continue;
      const pg = m.pageNumber ?? 1;
      if (!pages[pg]) {
        pages[pg] = { count: 0, totalArea: 0, totalDistance: 0, areaUnit: m.unit, distUnit: m.unit };
      }
      pages[pg].count += 1;
      if (m.type === 'area' || m.type === 'circle') {
        pages[pg].totalArea += m.value;
        pages[pg].areaUnit = m.unit;
      } else if (m.type === 'distance' || m.type === 'polyline' || m.type === 'perimeter') {
        pages[pg].totalDistance += m.value;
        pages[pg].distUnit = m.unit;
      }
    }
    return pages;
  }, [measurements]);

  // ── Export CSV ──

  const handleExportCSV = useCallback(() => {
    const rows: string[][] = [
      ['Page', 'Groupe', 'Produit', 'Catégorie', 'Mesure', 'Type', 'Déduction', 'Qté brute', 'Qté nette', 'Perte %', 'Qté avec perte', 'Unité prix', 'Prix unitaire ($)', 'Coût total ($)'],
    ];

    let total = 0;

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
      total += cost;
      const uLabel = PRICE_UNITS.find((u) => u.value === prod.priceUnit)?.label ?? prod.priceUnit;

      rows.push([
        String(m.pageNumber ?? 1),
        m.group ?? '',
        prod.name,
        prod.category,
        m.label || `${m.type} #${m.id.slice(-4)}`,
        m.type,
        isDeduction ? 'Oui' : 'Non',
        (grossQty ?? 0).toFixed(3),
        (netQty ?? 0).toFixed(3),
        (prod.wastePct || 0).toFixed(1),
        (qtyWithWaste ?? 0).toFixed(3),
        uLabel,
        (prod.price ?? 0).toFixed(2),
        (cost ?? 0).toFixed(2),
      ]);
    }

    rows.push([]);
    rows.push(['', '', '', '', '', '', '', '', '', '', '', '', 'TOTAL', (total ?? 0).toFixed(2)]);

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume-multi-pages-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [measurements, products, getNetValue]);

  // ── Render ──

  const hasGroups = measurementGroups.length > 0 && Object.values(groupedMeasurements.groups).some((ms) => ms.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/60">
      <div className="bg-metre-surface border border-metre-border rounded-xl shadow-xl w-[95vw] max-w-[1100px] max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-metre-border">
          <h2 className="text-base font-semibold text-metre-text">
            Résumé multi-pages
          </h2>
          <button
            onClick={toggleSummary}
            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
          >
            Fermer
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* ── Client / Projet / Metré header ── */}
          <div className="grid grid-cols-3 gap-3">
            {/* CLIENT */}
            <div className="bg-metre-bg rounded-lg p-3 border border-metre-border">
              <h4 className="text-xs font-semibold text-metre-text uppercase tracking-wider mb-2">Client</h4>
              <div className="space-y-1.5">
                <FieldRow label="Nom" value={clientName} onChange={setClientName} placeholder="Nom du client" />
                <FieldRow label="Adresse" value={clientAddress} onChange={setClientAddress} placeholder="Adresse complète" />
                <FieldRow label="Ville" value={clientCity} onChange={setClientCity} placeholder="Ville, Province, Code postal" />
                <FieldRow label="Téléphone" value={clientPhone} onChange={setClientPhone} placeholder="(514) 000-0000" />
                <FieldRow label="Courriel" value={clientEmail} onChange={setClientEmail} placeholder="courriel@exemple.com" />
              </div>
            </div>

            {/* PROJET */}
            <div className="bg-metre-bg rounded-lg p-3 border border-metre-border">
              <h4 className="text-xs font-semibold text-metre-text uppercase tracking-wider mb-2">Projet</h4>
              <div className="space-y-1.5">
                <FieldRow label="Nom" value={projectName} onChange={setProjectName} placeholder="Nom du projet" />
                <FieldRow label="Adresse" value={projectAddress} onChange={setProjectAddress} placeholder="Adresse du chantier" />
                <FieldRow label="Type" value={projectType} onChange={setProjectType} placeholder="Résidentiel / Commercial / Industriel" />
                <FieldRow label="Superficie" value={projectArea} onChange={setProjectArea} placeholder="Superficie approximative" />
              </div>
            </div>

            {/* METRÉ (TAKE OFF) */}
            <div className="bg-metre-bg rounded-lg p-3 border border-metre-border">
              <h4 className="text-xs font-semibold text-metre-text uppercase tracking-wider mb-2">Métré (Take Off)</h4>
              <div className="space-y-1.5 text-xs text-metre-muted">
                <p><span className="text-metre-text font-medium">Mesures:</span> {measurements.filter((m) => !m.isDeduction).length}{measurements.some((m) => m.isDeduction) ? ` (+ ${measurements.filter((m) => m.isDeduction).length} deductions)` : ''}</p>
                <p><span className="text-metre-text font-medium">Produits liés:</span> {new Set(measurements.filter((m) => m.productId && !m.isDeduction).map((m) => m.productId)).size}</p>
                <p><span className="text-metre-text font-medium">Pages analysées:</span> {new Set(measurements.map((m) => m.pageNumber ?? 1)).size}</p>
                <p><span className="text-metre-text font-medium">Groupes:</span> {measurementGroups.length > 0 ? measurementGroups.join(', ') : 'Aucun'}</p>
              </div>
            </div>
          </div>

          {measurements.length === 0 ? (
            <p className="text-metre-muted text-sm text-center py-8">
              Aucune mesure enregistrée.
            </p>
          ) : (
            <>
              {/* ── By Group ── */}
              {hasGroups && (
                <section>
                  <h3 className="text-sm font-semibold text-metre-text mb-3 uppercase tracking-wider">
                    Par groupe
                  </h3>
                  <div className="space-y-4">
                    {Object.entries(groupedMeasurements.groups).map(([groupName, ms]) => {
                      if (ms.length === 0) return null;
                      return (
                        <div key={groupName} className="bg-metre-bg rounded-lg p-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium text-metre-accent">{groupName}</span>
                            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                              {(groupCosts[groupName] ?? 0).toFixed(2)} $
                            </span>
                          </div>
                          <div className="space-y-1">
                            {ms.map((m) => {
                              const prod = m.productId ? products.find((p) => p.id === m.productId) : null;
                              const netQty = m.isDeduction ? 0 : getNetValue(m) * (m.slopeFactor ?? 1);
                              const wasteFactor = prod ? 1 + (prod.wastePct || 0) / 100 : 1;
                              const cost = prod && !m.isDeduction ? netQty * wasteFactor * prod.price : 0;
                              return (
                                <div key={m.id} className="flex items-center justify-between text-xs text-metre-muted px-2 py-0.5">
                                  <span className={`truncate flex-1 mr-2 ${m.isDeduction ? 'text-red-600 dark:text-red-400' : ''}`}>
                                    {m.isDeduction ? '\u2212 ' : ''}{m.label || `${m.type} #${m.id.slice(-4)}`}
                                    <span className="text-metre-muted ml-1">({m.type})</span>
                                  </span>
                                  <span className="font-mono whitespace-nowrap mr-3">
                                    {/* circle is treated as area for display (square unit). */}
                                    {formatMeasurement(
                                      m.value ?? 0,
                                      m.unit,
                                      m.type === 'circle' ? 'area' : m.type,
                                    )}
                                  </span>
                                  {prod && (
                                    <span className="font-mono whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                                      {m.isDeduction ? '\u2014' : `${(cost ?? 0).toFixed(2)} $`}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-between items-center pt-2 mt-2 border-t border-metre-border">
                            <span className="text-xs text-metre-muted">{ms.length} mesure{ms.length !== 1 ? 's' : ''}</span>
                            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                              Sous-total: {(groupCosts[groupName] ?? 0).toFixed(2)} $
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── By Type ── */}
              <section>
                <h3 className="text-sm font-semibold text-metre-text mb-3 uppercase tracking-wider">
                  Par type
                </h3>
                <div className="bg-metre-bg rounded-lg p-3 space-y-1.5">
                  {Object.entries(byType).map(([type, info]) => (
                    <div key={type} className="flex justify-between items-center text-xs">
                      <span className="text-metre-muted">{typeDisplayName(type, info.unit)}</span>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-metre-text">
                          {info.count} mesure{info.count !== 1 ? 's' : ''}
                        </span>
                        <span className="font-mono text-metre-accent min-w-[100px] text-right">
                          {type === 'count'
                            ? info.totalValue
                            : type === 'angle'
                            ? `${(info.totalValue ?? 0).toFixed(1)}\u00b0`
                            : formatMeasurement(info.totalValue ?? 0, info.unit, type)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {Object.keys(byType).length === 0 && (
                    <p className="text-metre-muted text-xs text-center py-2">Aucune mesure</p>
                  )}
                </div>
              </section>

              {/* ── By Product ── */}
              <section>
                <h3 className="text-sm font-semibold text-metre-text mb-3 uppercase tracking-wider">
                  Par produit
                </h3>
                {Object.keys(byProduct).length === 0 ? (
                  <p className="text-metre-muted text-xs py-2">Aucun produit associé aux mesures.</p>
                ) : (
                  <div className="bg-metre-bg rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-metre-muted border-b border-metre-border">
                          <th className="text-left px-3 py-2 font-medium">Produit</th>
                          <th className="text-right px-3 py-2 font-medium">Qte nette</th>
                          <th className="text-right px-3 py-2 font-medium">Qte + perte</th>
                          <th className="text-right px-3 py-2 font-medium">Prix unit.</th>
                          <th className="text-right px-3 py-2 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(byProduct).map(([prodId, p]) => (
                          <tr key={prodId} className="border-b border-metre-border/50 hover:bg-metre-panel/50">
                            <td className="px-3 py-1.5 text-metre-text">
                              {p.productName}
                              <span className="text-metre-muted ml-1 text-[10px]">({p.category})</span>
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-metre-text">
                              {(p.totalQty ?? 0).toFixed(3)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-amber-600 dark:text-amber-400">
                              {(p.totalQtyWaste ?? 0).toFixed(3)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-metre-muted">
                              {(p.unitPrice ?? 0).toFixed(2)} $/{unitLabel(p.priceUnit)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                              {(p.totalCost ?? 0).toFixed(2)} $
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-metre-border">
                          <td colSpan={4} className="px-3 py-2 text-right text-metre-text font-semibold">
                            Grand Total
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                            {(grandTotal ?? 0).toFixed(2)} $
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>

              {/* ── By Page ── */}
              <section>
                <h3 className="text-sm font-semibold text-metre-text mb-3 uppercase tracking-wider">
                  Par page
                </h3>
                <div className="bg-metre-bg rounded-lg p-3 space-y-1.5">
                  {Object.entries(byPage)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([page, info]) => (
                      <div key={page} className="flex justify-between items-center text-xs">
                        <span className="text-metre-muted">Page {page}</span>
                        <div className="flex items-center gap-4">
                          <span className="font-mono text-metre-text">
                            {info.count} mesure{info.count !== 1 ? 's' : ''}
                          </span>
                          {info.totalArea > 0 && (
                            <span className="font-mono text-metre-accent">
                              {formatMeasurement(info.totalArea ?? 0, info.areaUnit, 'area')}
                            </span>
                          )}
                          {info.totalDistance > 0 && (
                            <span className="font-mono text-metre-accent">
                              {formatMeasurement(info.totalDistance ?? 0, info.distUnit, 'distance')}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  {Object.keys(byPage).length === 0 && (
                    <p className="text-metre-muted text-xs text-center py-2">Aucune page</p>
                  )}
                </div>
              </section>

              {/* ── Export ── */}
              <div className="flex justify-end gap-2 flex-wrap">
                <button
                  onClick={() => downloadEstimationPdf({
                    measurements,
                    products,
                    laborTrades,
                    getNetValue,
                    projectName: projectName || undefined,
                    projectAddress: projectAddress || undefined,
                    projectType: projectType || undefined,
                    projectArea: projectArea || undefined,
                    clientName: clientName || undefined,
                    clientAddress: clientAddress || undefined,
                    clientCity: clientCity || undefined,
                    clientPhone: clientPhone || undefined,
                    clientEmail: clientEmail || undefined,
                  })}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Soumission PDF
                </button>
                <button
                  onClick={handleExportCSV}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Exporter CSV
                </button>
                <button
                  onClick={() => openEstimationInNewTab({
                    measurements,
                    products,
                    laborTrades,
                    groups: measurementGroups,
                    getNetValue,
                    projectName: projectName || undefined,
                    projectAddress: projectAddress || undefined,
                    projectType: projectType || undefined,
                    projectArea: projectArea || undefined,
                    clientName: clientName || undefined,
                    clientAddress: clientAddress || undefined,
                    clientCity: clientCity || undefined,
                    clientPhone: clientPhone || undefined,
                    clientEmail: clientEmail || undefined,
                  })}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
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
                    projectName: projectName || undefined,
                    projectAddress: projectAddress || undefined,
                    projectType: projectType || undefined,
                    projectArea: projectArea || undefined,
                    clientName: clientName || undefined,
                    clientAddress: clientAddress || undefined,
                    clientCity: clientCity || undefined,
                    clientPhone: clientPhone || undefined,
                    clientEmail: clientEmail || undefined,
                  })}
                  className="px-4 py-2 bg-metre-panel hover:bg-metre-bg text-metre-text text-sm font-medium rounded-lg border border-metre-border transition-colors"
                >
                  Télécharger HTML
                </button>
                <button
                  onClick={() => downloadDxf(measurements, calibration, undefined, useMetreStore.getState().symbolBlocks)}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  DXF (AutoCAD)
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-metre-border text-xs text-metre-muted flex justify-between">
          <span>{measurements.length} mesure{measurements.length !== 1 ? 's' : ''} au total</span>
          <span>
            {Object.keys(byPage).length} page{Object.keys(byPage).length !== 1 ? 's' : ''}
            {measurementGroups.length > 0 && ` \u2022 ${measurementGroups.length} groupe${measurementGroups.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>
    </div>
  );
}
