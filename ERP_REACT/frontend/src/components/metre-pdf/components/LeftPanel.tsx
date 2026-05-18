import { useMetreStore } from '../store';
import { formatMeasurement } from '../utils/format';
import { parseFeetInput, formatFeetImperial } from '../utils/imperialInput';
import type { MeasurementLayer, Product } from '../types';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Copy,
  Ruler,
  PenTool,
  Triangle,
  Compass,
  Hash,
  Spline,
  CircleDot,
  Type,
  ArrowUpRight,
  Cloud,
  Pencil,
  Highlighter,
  StickyNote,
  MessageSquare,
  AlignHorizontalJustifyCenter,
  Stamp,
  AlertCircle,
  Package,
  BarChart3,
  ExternalLink,
  Link2,
  Link2Off,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Measurement, MeasurementType } from '../types';
import type { ReactNode } from 'react';
import TruncatedText from './TruncatedText';
import { ColorPicker } from './ui/ColorPicker';

const TYPE_ICONS: Record<MeasurementType, ReactNode> = {
  distance: <Ruler size={14} />,
  area: <PenTool size={14} />,
  perimeter: <Triangle size={14} />,
  polyline: <Spline size={14} />,
  angle: <Compass size={14} />,
  count: <Hash size={14} />,
  circle: <CircleDot size={14} />,
  dimension: <AlignHorizontalJustifyCenter size={14} />,
  text: <Type size={14} />,
  arrow: <ArrowUpRight size={14} />,
  cloud: <Cloud size={14} />,
  freehand: <Pencil size={14} />,
  highlight: <Highlighter size={14} />,
  note: <StickyNote size={14} />,
  callout: <MessageSquare size={14} />,
  symbol: <Stamp size={14} />,
};

const TYPE_LABELS: Record<MeasurementType, string> = {
  distance: 'Distance',
  area: 'Surface',
  perimeter: 'Périmètre',
  polyline: 'Polyligne',
  angle: 'Angle',
  count: 'Comptage',
  circle: 'Cercle',
  dimension: 'Cotation',
  text: 'Texte',
  arrow: 'Flèche',
  cloud: 'Nuage révision',
  freehand: 'Main levée',
  highlight: 'Surligner',
  note: 'Note',
  callout: 'Bulle texte',
  symbol: 'Symbole',
};

/** Measurement types that produce a billable quantity and therefore need a
 *  product assignment for the soumission. Annotation types (text, note,
 *  callout, arrow, freehand, highlight, cloud, dimension, symbol) are
 *  excluded from the "missing product" warnings. */
const VALUE_TYPES: ReadonlySet<MeasurementType> = new Set([
  'distance',
  'area',
  'perimeter',
  'polyline',
  'angle',
  'count',
  'circle',
]);

function isValueType(t: MeasurementType): boolean {
  return VALUE_TYPES.has(t);
}

// Delegate to the central `formatMeasurement` (utils/format.ts) so imperial
// calibration (ft/in) renders as feet-inches-fraction (1/16" precision)
// consistently with the canvas labels. Keeps the panel and the on-PDF
// labels in sync.
function formatValue(value: number, type: MeasurementType, unit: string): string {
  return formatMeasurement(value ?? 0, unit, type);
}

/**
 * Input spécialisé pour les variables BOM avec unité 'pi' (pieds).
 *
 * Accepte 3 formats de saisie :
 *   - Compact PPIISS (6 digits): "100608" → 10'-6 1/2" → 10.5417 pi
 *   - Compact IISS (4 digits): "0608" → 0'-6 1/2" → 0.5417 pi
 *   - Décimal (point ou virgule FR): "1.333", "1,333" → 1.333 pi
 *
 * Affichage au repos : format lisible feet-inches-fraction (ex: 1'-4 1/2").
 * Affichage en édition : valeur brute saisie (laisse l'utilisateur taper).
 * Validation au blur : si parsing échoue, revert à la valeur précédente.
 *
 * Évite les confusions d'unité observées en production (6.8 / 010400 / 8
 * interprétés comme pieds décimaux au lieu de pieds-pouces).
 */
function ImperialFeetInput({
  value,
  defaultValue,
  onChange,
}: {
  value: number | null;
  defaultValue: number;
  onChange: (n: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const prevValueRef = useRef(value);

  // Resync raw quand value change externe pendant editing.
  // Évite la perte silencieuse d'updates concurrents (autre tab, undo, sync).
  useEffect(() => {
    if (editing && prevValueRef.current !== value) {
      setRaw(value !== null ? String(value) : '');
    }
    prevValueRef.current = value;
  }, [value, editing]);

  const displayValue = value ?? defaultValue;
  const formatted = formatFeetImperial(displayValue);

  return (
    <input
      type="text"
      value={editing ? raw : value !== null ? formatted : ''}
      placeholder={formatFeetImperial(defaultValue)}
      title={`Formats accepted: 100608 (10'-6 1/2"), 0608 (6 1/2"), 10-06-08, 1.333 / 1,333 (décimal pi), 8 (entier pi)`}
      aria-label="Valeur en pieds (format compact ou décimal)"
      onFocus={() => {
        setEditing(true);
        setRaw(value !== null ? String(value) : '');
      }}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        if (raw.trim() === '') {
          onChange(null);
        } else {
          const parsed = parseFeetInput(raw);
          if (parsed !== null) onChange(parsed);
        }
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-20 px-1 py-0.5 text-[11px] rounded bg-metre-bg border border-metre-border text-metre-text font-mono tabular-nums"
    />
  );
}

/**
 * Mini-panneau de liaison calque -> composite BOM (P3.4).
 *
 * Affiche :
 *  - Un select de composite (option "Aucun" = delier)
 *  - Une fois lie : la liste des variables du composite, separees en :
 *      - "Auto" (au moins une mesure du calque avec ce label) : affichage read-only
 *      - "Manuelle" (aucune mesure) : input numeric pour saisie par calque
 *
 * La detection auto/manuel utilise les mesures du calque uniquement.
 * Sylvain doit pouvoir avoir un mur 2x4 (calque A) et un mur 2x6 (calque B)
 * lies au meme composite Section 02 avec des type_bois differents.
 */
function CompositeLinkPanel({
  layer,
  composites,
  measurements,
  onChange,
  onClose,
}: {
  layer: MeasurementLayer;
  composites: Product[];
  measurements: Measurement[];
  onChange: (updates: Partial<MeasurementLayer>) => void;
  onClose: () => void;
}) {
  const linkedComposite = layer.compositeId
    ? composites.find((c) => c.id === layer.compositeId)
    : null;

  // Mesures de CE calque uniquement -- sert a detecter quelles variables
  // sont auto (presence d'une mesure avec ce label) vs manuelles.
  const layerMeasurements = useMemo(
    () => measurements.filter((m) => m.layer === layer.id),
    [measurements, layer.id],
  );

  const labelsInLayer = useMemo(() => {
    const set = new Set<string>();
    for (const m of layerMeasurements) {
      const lbl = m.label?.trim();
      if (lbl) set.add(lbl);
    }
    return set;
  }, [layerMeasurements]);

  const compositeInputs = layer.compositeInputs ?? {};

  const updateCompositeInput = useCallback(
    (varName: string, raw: string) => {
      const next = { ...(layer.compositeInputs ?? {}) };
      if (raw === '') {
        delete next[varName];
      } else {
        const n = Number(raw);
        if (Number.isFinite(n)) next[varName] = n;
      }
      onChange({ compositeInputs: Object.keys(next).length > 0 ? next : null });
    },
    [layer.compositeInputs, onChange],
  );

  // Variante pour inputs typés number (ex: ImperialFeetInput pour unité 'pi').
  // Évite le double parsing string→number et permet de stocker `null` pour
  // revenir au default du composite quand l'utilisateur efface le champ.
  const updateCompositeInputValue = useCallback(
    (varName: string, value: number | null) => {
      const next = { ...(layer.compositeInputs ?? {}) };
      if (value === null) {
        delete next[varName];
      } else {
        next[varName] = value;
      }
      onChange({ compositeInputs: Object.keys(next).length > 0 ? next : null });
    },
    [layer.compositeInputs, onChange],
  );

  return (
    <div
      className="ml-4 mt-1 mb-1 p-2 rounded bg-metre-bg/60 border border-metre-border/40 text-[11px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-metre-muted">
          Liaison BOM
        </span>
        <button
          className="text-[10px] text-metre-muted hover:text-metre-text"
          onClick={onClose}
          title="Replier"
        >
          Fermer
        </button>
      </div>

      <select
        className="w-full px-1 py-0.5 mb-1.5 text-[11px] rounded bg-metre-bg border border-metre-border text-metre-text"
        value={layer.compositeId ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          // On garde les overrides SEULEMENT si l'utilisateur reste sur le
          // meme composite (cas: pas un vrai changement). Tout changement
          // (delier OU lier a un autre composite) efface les overrides
          // pour eviter les orphelins silencieux qui ne matchent pas le
          // nouveau bom_inputs.
          const keepInputs =
            v && v === layer.compositeId
              ? layer.compositeInputs ?? null
              : null;
          onChange({
            compositeId: v || null,
            compositeInputs: keepInputs,
          });
        }}
      >
        <option value="">-- Aucun (calque non lie) --</option>
        {composites.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {linkedComposite && (
        <div className="space-y-1">
          {(linkedComposite.bomInputs ?? []).length === 0 ? (
            <p className="text-[10px] italic text-metre-muted">
              Ce composite n'a pas de variables parametriques.
            </p>
          ) : (
            (linkedComposite.bomInputs ?? []).map((input) => {
              const isAuto = labelsInLayer.has(input.name);
              const manualValue = compositeInputs[input.name];
              return (
                <div
                  key={input.name}
                  className="flex items-center gap-1.5 text-[10px]"
                >
                  <span
                    className="flex-1 truncate text-metre-muted"
                    title={input.description}
                  >
                    {input.name}
                    {input.unit ? (
                      <span className="opacity-60"> ({input.unit})</span>
                    ) : null}
                  </span>
                  {isAuto ? (
                    <span className="text-[10px] italic text-metre-accent/80 whitespace-nowrap">
                      auto (mesures du calque)
                    </span>
                  ) : input.unit === 'pi' ? (
                    <ImperialFeetInput
                      value={manualValue ?? null}
                      defaultValue={input.default ?? 0}
                      onChange={(v) =>
                        updateCompositeInputValue(input.name, v)
                      }
                    />
                  ) : (
                    <input
                      type="number"
                      step="any"
                      placeholder={
                        input.default != null ? String(input.default) : '0'
                      }
                      value={manualValue ?? ''}
                      onChange={(e) =>
                        updateCompositeInput(input.name, e.target.value)
                      }
                      className="w-16 px-1 py-0.5 text-[11px] rounded bg-metre-bg border border-metre-border text-metre-text font-mono tabular-nums"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function LeftPanel() {
  const leftPanelWidth = useMetreStore((s) => s.leftPanelWidth);
  const layers = useMetreStore((s) => s.layers);
  const measurements = useMetreStore((s) => s.measurements);
  const products = useMetreStore((s) => s.products);
  const addLayer = useMetreStore((s) => s.addLayer);
  const updateLayer = useMetreStore((s) => s.updateLayer);
  const removeLayer = useMetreStore((s) => s.removeLayer);
  const moveLayerUp = useMetreStore((s) => s.moveLayerUp);
  const moveLayerDown = useMetreStore((s) => s.moveLayerDown);
  const activeLayerId = useMetreStore((s) => s.activeLayerId);
  const setActiveLayerId = useMetreStore((s) => s.setActiveLayerId);
  const selectedMeasurementIds = useMetreStore((s) => s.selectedMeasurementIds);
  const setSelectedMeasurementId = useMetreStore((s) => s.setSelectedMeasurementId);
  const toggleMeasurementSelection = useMetreStore((s) => s.toggleMeasurementSelection);
  const extendMeasurementSelection = useMetreStore((s) => s.extendMeasurementSelection);
  const removeMeasurement = useMetreStore((s) => s.removeMeasurement);
  const duplicateMeasurement = useMetreStore((s) => s.duplicateMeasurement);
  const currentPage = useMetreStore((s) => s.currentPage);
  const toggleSummary = useMetreStore((s) => s.toggleSummary);

  const [newLayerName, setNewLayerName] = useState('');
  const [showAddLayer, setShowAddLayer] = useState(false);

  /** Calque dont le panneau de liaison BOM est deplie (null = aucun).
   *  Un seul panneau ouvert a la fois pour rester compact. */
  const [expandedBomLayerId, setExpandedBomLayerId] = useState<string | null>(null);

  /** Composites disponibles (BOM Mario + Excel). Triés par categorie puis nom. */
  const composites = useMemo(() => {
    return products
      .filter((p) => p.isComposite)
      .sort((a, b) => {
        const cmpCat = (a.category || '').localeCompare(b.category || '');
        if (cmpCat !== 0) return cmpCat;
        return a.name.localeCompare(b.name);
      });
  }, [products]);

  // --- Inline rename (double-click to edit) ---
  /** Layer id currently being renamed (null = no edit in progress). */
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  /** Draft value while editing; committed to the store on blur/Enter. */
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  /** Mirror of `renamingLayerId` we can read from stale closures (e.g. the
   *  blur handler of a now-unmounted input). Lets us detect "another rename
   *  has started in the meantime" and skip clobbering the new state. */
  const renamingLayerIdRef = useRef<string | null>(null);
  renamingLayerIdRef.current = renamingLayerId;
  /** When the user presses Escape, the input is unmounted which triggers a
   *  blur. Without this guard, the blur's stale-closure call to commitRename
   *  would persist the typed draft anyway — defeating the cancel. We set
   *  this flag in cancelRename and the very next commitRename early-returns. */
  const skipNextCommitRef = useRef(false);

  /** Focus + select the input as soon as the rename mode opens. */
  useEffect(() => {
    if (renamingLayerId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingLayerId]);

  const beginRename = useCallback((layerId: string, currentName: string) => {
    setRenamingLayerId(layerId);
    setRenameDraft(currentName);
  }, []);

  const cancelRename = useCallback(() => {
    // Arm the skip flag BEFORE clearing state — the unmount blur that fires
    // after this set must read true.
    skipNextCommitRef.current = true;
    setRenamingLayerId(null);
    setRenameDraft('');
  }, []);

  /** Commit a rename for an explicit layer + draft.
   *
   *  The `forLayerId` and `draft` are passed in from the JSX closure (captured
   *  at render time of the input that fired the event). This avoids the race
   *  where the user opens a NEW rename on layer B before the blur of layer A's
   *  input has fired: with stale-closure resets, the second commit would
   *  clobber the new in-progress state. By taking explicit args + checking
   *  `renamingLayerIdRef.current === forLayerId` before the reset, the blur
   *  of A still persists A's pending change but leaves B's edit untouched. */
  const commitRename = useCallback(
    (forLayerId: string, draft: string) => {
      // Escape was just pressed: consume the flag and skip any persistence.
      // (The state was already cleared by cancelRename; this guard just
      // prevents the blur of the unmounting input from writing the draft.)
      if (skipNextCommitRef.current) {
        skipNextCommitRef.current = false;
        return;
      }
      const trimmed = draft.trim();
      if (trimmed) {
        const current = layers.find((l) => l.id === forLayerId);
        if (current && current.name !== trimmed) {
          updateLayer(forLayerId, { name: trimmed.slice(0, 100) });
        }
      }
      // Only clear the global rename state if THIS layer is still the active
      // edit target. If the user has already started renaming another layer,
      // do nothing here.
      if (renamingLayerIdRef.current === forLayerId) {
        setRenamingLayerId(null);
        setRenameDraft('');
      }
    },
    [layers, updateLayer],
  );

  const handleAddLayer = useCallback(() => {
    if (!newLayerName.trim()) return;
    // Ajout d'un suffixe random apres Date.now() pour eviter une collision
    // d'id temp lorsque 2 calques sont crees dans la meme milliseconde
    // (test E2E, paste massive, ou via un script). Sans ce suffixe, le swap
    // local->backend dans store.addLayer ecraserait l'un par l'autre.
    const id = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];
    const color = colors[layers.length % colors.length];
    addLayer({
      id,
      documentId: '',
      name: newLayerName.trim(),
      color,
      visible: true,
      locked: false,
    });
    setActiveLayerId(id);
    setNewLayerName('');
    setShowAddLayer(false);
  }, [newLayerName, layers.length, addLayer, setActiveLayerId]);

  // Measurements for current page, grouped by layer
  const pageMeasurements = measurements.filter((m) => m.pageNumber === currentPage);

  /** O(1) product lookup so we don't .find() on every measurement render
   *  (130 mesures × 879 produits = 110k iterations otherwise). */
  const productById = useMemo(() => {
    const m = new Map<string, typeof products[number]>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  /** Consolidated totals across ALL pages — for the bottom-of-panel summary
   *  the user uses to read off totals while drawing without scrolling between
   *  pages.
   *
   *  byProduct is aligned 1:1 with `SummaryPanel.tsx:138-175` and
   *  `Estimation HTML` (same `getNetValue * slope * waste * price` formula),
   *  so the $ totals Mario sees here match the export.
   *
   *  byType uses gross `m.value` like `SummaryPanel.tsx:101-113` BUT also
   *  filters out non-value-types (annotations: text, note, callout, arrow,
   *  freehand, highlight, cloud, dimension, symbol). SummaryPanel includes
   *  them with their `value=0` — visible there but a no-op visually.
   *  We exclude them inline to keep the bottom panel compact and focused on
   *  billable quantities, which is what the user is reading at a glance. */
  const consolidated = useMemo(() => {
    // Index deductions by parent for O(1) net-value computation
    const deductionsByParent = new Map<string, Measurement[]>();
    for (const m of measurements) {
      if (!m.isDeduction || !m.parentMeasurementId) continue;
      const list = deductionsByParent.get(m.parentMeasurementId) ?? [];
      list.push(m);
      deductionsByParent.set(m.parentMeasurementId, list);
    }
    const netValue = (m: Measurement): number => {
      const ds = deductionsByParent.get(m.id) ?? [];
      const totalDeducted = ds.reduce((s, d) => s + (d.quantity ?? d.value), 0);
      return Math.max(0, (m.quantity ?? m.value) - totalDeducted);
    };

    // Per-type aggregation (count + sum of GROSS values) — exclude deductions
    // and annotations. Uses `m.value` (not netValue) to match SummaryPanel's
    // `byType` which displays gross totals; deductions show their effect via
    // the per-product cost section below.
    const byType = new Map<
      MeasurementType,
      { count: number; total: number; unit: string }
    >();
    for (const m of measurements) {
      if (m.isDeduction || !isValueType(m.type)) continue;
      const cur = byType.get(m.type) ?? { count: 0, total: 0, unit: m.unit };
      cur.count += 1;
      cur.total += (m.value ?? 0);
      byType.set(m.type, cur);
    }

    // Per-product aggregation — only when productId resolves to a live product
    const byProduct = new Map<
      string,
      { name: string; qty: number; priceUnit: string; cost: number }
    >();
    let totalCost = 0;
    for (const m of measurements) {
      if (m.isDeduction || !m.productId) continue;
      const prod = productById.get(m.productId);
      if (!prod) continue;
      const netQty = netValue(m) * (m.slopeFactor ?? 1);
      const wasteFactor = 1 + (prod.wastePct || 0) / 100;
      const qtyW = netQty * wasteFactor;
      const cost = qtyW * prod.price;
      totalCost += cost;
      const cur = byProduct.get(prod.id) ?? {
        name: prod.name,
        qty: 0,
        priceUnit: prod.priceUnit,
        cost: 0,
      };
      cur.qty += qtyW;
      cur.cost += cost;
      byProduct.set(prod.id, cur);
    }

    return { byType, byProduct, totalCost };
  }, [measurements, productById]);

  /** Count of measurements on the current page that need attention:
   *   - no product assigned (`!m.productId`), OR
   *   - dangling reference: productId points to a product that no longer
   *     exists in the catalog (deleted product). Both states are surfaced
   *     identically to the user — they look like "broken" measurements.
   *  Annotation types are excluded. */
  const missingProductCount = useMemo(
    () =>
      pageMeasurements.filter(
        (m) =>
          isValueType(m.type) &&
          (!m.productId || !productById.get(m.productId)),
      ).length,
    [pageMeasurements, productById],
  );

  /** Filter toggle — when active, only the unassigned measurements are
   *  rendered. Off by default; visible only when at least one is missing. */
  const [showOnlyMissingProduct, setShowOnlyMissingProduct] = useState(false);
  // Auto-disable the filter when there are no missing entries left so the
  // user doesn't see an empty list after fixing the last one.
  useEffect(() => {
    if (missingProductCount === 0 && showOnlyMissingProduct) {
      setShowOnlyMissingProduct(false);
    }
  }, [missingProductCount, showOnlyMissingProduct]);

  const visibleMeasurements = showOnlyMissingProduct
    ? pageMeasurements.filter(
        (m) =>
          isValueType(m.type) &&
          (!m.productId || !productById.get(m.productId)),
      )
    : pageMeasurements;

  return (
    <div
      className="bg-metre-surface border-r border-metre-border overflow-y-auto flex-shrink-0"
      style={{ width: leftPanelWidth }}
    >
      {/* Layers */}
      <div className="panel-section">
        <div className="flex items-center justify-between mb-2">
          <span className="panel-title mb-0">Calques</span>
          <button
            className="tool-btn w-6 h-6"
            onClick={() => setShowAddLayer(!showAddLayer)}
            title="Ajouter un calque"
          >
            <Plus size={14} />
          </button>
        </div>

        {showAddLayer && (
          <div className="flex gap-1 mb-2">
            <input
              className="input-field flex-1"
              placeholder="Nom du calque..."
              value={newLayerName}
              onChange={(e) => setNewLayerName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddLayer()}
              autoFocus
            />
            <button
              className="px-2 py-1 text-xs bg-metre-accent text-white rounded hover:bg-metre-accent-hover"
              onClick={handleAddLayer}
            >
              OK
            </button>
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          {layers.map((layer) => {
            const linkedComposite = layer.compositeId
              ? composites.find((c) => c.id === layer.compositeId)
              : null;
            const isBomExpanded = expandedBomLayerId === layer.id;
            return (
            <div key={layer.id}>
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm cursor-pointer ${
                activeLayerId === layer.id
                  ? 'bg-metre-panel text-metre-text'
                  : 'text-metre-muted hover:text-metre-text hover:bg-metre-bg'
              }`}
              onClick={() => setActiveLayerId(layer.id)}
            >
              {/* Color swatch (clickable to change layer color) */}
              <div onClick={(e) => e.stopPropagation()}>
                <ColorPicker
                  value={layer.color}
                  onChange={(color) => updateLayer(layer.id, { color })}
                  compact
                />
              </div>

              {renamingLayerId === layer.id ? (
                <input
                  ref={renameInputRef}
                  className="flex-1 min-w-0 text-xs px-1 py-0.5 rounded border border-metre-accent bg-metre-bg text-metre-text focus:outline-none focus:ring-1 focus:ring-metre-accent"
                  value={renameDraft}
                  maxLength={100}
                  aria-label={`Renommer le calque "${layer.name}"`}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename(layer.id, renameDraft);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onBlur={() => commitRename(layer.id, renameDraft)}
                />
              ) : (
                <TruncatedText
                  text={layer.name}
                  hint="Double-cliquer pour renommer"
                  className="flex-1 truncate text-xs select-none"
                  // We need to attach the dblclick handler to the same span.
                  // Wrap inside a generic event-receiving element via children.
                >
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginRename(layer.id, layer.name);
                    }}
                  >
                    {layer.name}
                  </span>
                </TruncatedText>
              )}

              <span className="text-[10px] text-metre-muted">
                {pageMeasurements.filter((m) => m.layer === layer.id).length}
              </span>

              {/* Visibility toggle */}
              <button
                className="p-0.5 hover:text-metre-text"
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(layer.id, { visible: !layer.visible });
                }}
                title={layer.visible ? 'Masquer' : 'Afficher'}
              >
                {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>

              {/* Lock toggle */}
              <button
                className="p-0.5 hover:text-metre-text"
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(layer.id, { locked: !layer.locked });
                }}
                title={layer.locked ? 'Déverrouiller' : 'Verrouiller'}
              >
                {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>

              {/* Draw order */}
              <button
                className="p-0.5 hover:text-metre-text disabled:opacity-20"
                disabled={layers.indexOf(layer) === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  moveLayerUp(layer.id);
                }}
                title="Monter (dessous)"
              >
                <ChevronUp size={12} />
              </button>
              <button
                className="p-0.5 hover:text-metre-text disabled:opacity-20"
                disabled={layers.indexOf(layer) === layers.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  moveLayerDown(layer.id);
                }}
                title="Descendre (dessus)"
              >
                <ChevronDown size={12} />
              </button>

              {/* BOM link toggle - opens the composite linking panel */}
              <button
                className={`p-0.5 hover:text-metre-text ${
                  layer.compositeId ? 'text-metre-accent' : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedBomLayerId(isBomExpanded ? null : layer.id);
                }}
                title={
                  layer.compositeId
                    ? `Lie a: ${linkedComposite?.name ?? 'composite supprime'}`
                    : 'Lier ce calque a un assemblage BOM'
                }
              >
                {layer.compositeId ? <Link2 size={12} /> : <Link2Off size={12} />}
              </button>

              {/* Delete layer (not default) */}
              {layer.id !== 'default' && (
                <button
                  className="p-0.5 hover:text-metre-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLayer(layer.id);
                  }}
                  title="Supprimer le calque"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            {/* Composite linking panel — visible when 🔗 button is clicked */}
            {isBomExpanded && (
              <CompositeLinkPanel
                layer={layer}
                composites={composites}
                measurements={measurements}
                onChange={(updates) => updateLayer(layer.id, updates)}
                onClose={() => setExpandedBomLayerId(null)}
              />
            )}
            </div>
          );
          })}
        </div>
      </div>

      {/* Measurements list */}
      <div className="panel-section border-b-0">
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="panel-title mb-0">Mesures (page {currentPage})</span>
          {missingProductCount > 0 && (
            <button
              type="button"
              onClick={() => setShowOnlyMissingProduct((v) => !v)}
              title={
                showOnlyMissingProduct
                  ? 'Afficher toutes les mesures'
                  : 'Afficher uniquement les mesures sans produit ou avec produit supprimé'
              }
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                showOnlyMissingProduct
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50'
              }`}
            >
              <AlertCircle size={10} />
              {missingProductCount} à corriger
            </button>
          )}
        </div>

        {layers.map((layer) => {
          const layerMeasurements = visibleMeasurements.filter(
            (m) => m.layer === layer.id
          );
          if (layerMeasurements.length === 0) return null;

          return (
            <div key={layer.id} className="mb-2">
              <div className="flex items-center gap-1.5 mb-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: layer.color }}
                />
                <span className="text-[10px] uppercase text-metre-muted tracking-wider">
                  {layer.name}
                </span>
              </div>

              <div className="flex flex-col gap-0.5 ml-3">
                {layerMeasurements.map((m) => {
                  const isSelected = selectedMeasurementIds.includes(m.id);
                  // Build an ordered ID list for Shift+click range selection
                  const orderedIds = visibleMeasurements.map((mm) => mm.id);
                  const product = m.productId ? productById.get(m.productId) : undefined;
                  // Three states for the product line:
                  //  - product found  → render swatch + name (gray)
                  //  - no productId   → "Sans produit" (orange) — only on value types
                  //  - productId set but product not found in catalog (deleted)
                  //                   → "Produit introuvable" (orange) — only on value types
                  const showMissingProduct = isValueType(m.type) && !m.productId;
                  const showDanglingProduct =
                    isValueType(m.type) && !!m.productId && !product;
                  return (
                    <div
                      key={m.id}
                      className={`group flex flex-col gap-0.5 px-2 py-1 rounded text-xs cursor-pointer ${
                        isSelected
                          ? 'bg-metre-accent/20 text-metre-accent'
                          : 'text-metre-muted hover:text-metre-text hover:bg-metre-bg'
                      }`}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                          toggleMeasurementSelection(m.id);
                        } else if (e.shiftKey) {
                          extendMeasurementSelection(m.id, orderedIds);
                        } else {
                          setSelectedMeasurementId(m.id);
                        }
                      }}
                    >
                      {/* Line 1 — icon + label + value + actions */}
                      <div className="flex items-center gap-1.5">
                        <span className="flex-shrink-0 opacity-70">
                          {TYPE_ICONS[m.type]}
                        </span>
                        <TruncatedText
                          text={m.label || TYPE_LABELS[m.type]}
                          className="flex-1 truncate"
                        />
                        <span className="flex-shrink-0 tabular-nums font-mono text-[11px]">
                          {formatValue(m.value, m.type, m.unit)}
                        </span>
                        <button
                          className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-metre-accent"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateMeasurement(m.id);
                          }}
                          title="Dupliquer (Ctrl+D)"
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-metre-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeMeasurement(m.id);
                          }}
                          title="Supprimer"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>

                      {/* Line 2 — product info (compact, indented) */}
                      {(product || showMissingProduct || showDanglingProduct) && (
                        <div className="flex items-center gap-1.5 ml-5 text-[10px]">
                          {product ? (
                            <>
                              <div
                                className="w-2 h-2 rounded-sm flex-shrink-0 border border-metre-border/50"
                                // Fallback color guards against products imported
                                // with an empty color string (which would render
                                // the 2×2 swatch invisible).
                                style={{ backgroundColor: product.color || '#94a3b8' }}
                              />
                              <TruncatedText
                                text={product.name || 'Produit sans nom'}
                                hint={product.dimensions ? product.dimensions : undefined}
                                className="flex-1 truncate text-metre-muted/80"
                              >
                                {product.name || <em>Produit sans nom</em>}
                              </TruncatedText>
                            </>
                          ) : showDanglingProduct ? (
                            <>
                              <AlertCircle
                                size={10}
                                className="flex-shrink-0 text-orange-500"
                              />
                              <TruncatedText
                                text="Produit introuvable"
                                hint="Le produit attribué a été supprimé du catalogue. Réassignez un produit pour que la mesure apparaisse dans la soumission."
                                className="flex-1 truncate text-orange-600 dark:text-orange-400 italic"
                              />
                            </>
                          ) : (
                            <>
                              <AlertCircle
                                size={10}
                                className="flex-shrink-0 text-orange-500"
                              />
                              <TruncatedText
                                text="Sans produit"
                                hint="Cette mesure n’a pas de produit attribué — elle ne sera pas exportée dans la soumission."
                                className="flex-1 truncate text-orange-600 dark:text-orange-400 italic"
                              />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {pageMeasurements.length === 0 && (
          <p className="text-metre-muted text-xs text-center py-4">
            Aucune mesure sur cette page
          </p>
        )}

        {pageMeasurements.length > 0 && visibleMeasurements.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-4 text-xs text-metre-muted">
            <Package size={20} className="opacity-40" />
            <p className="text-center">Toutes les mesures ont un produit valide attribué.</p>
          </div>
        )}
      </div>

      {/* Mesures consolidées — totals across ALL pages, always visible at the
          bottom of the left panel. Lets the user read off cumulative totals
          (per type and per product) without opening the SummaryPanel modal,
          and without leaving the current page. The "Détails" link opens the
          full multi-page summary modal (which has CSV/PDF/HTML exports). */}
      {(consolidated.byType.size > 0 || consolidated.byProduct.size > 0) && (
        <div className="panel-section border-t border-metre-border bg-metre-bg/40">
          <div className="flex items-center justify-between mb-2">
            <span className="panel-title mb-0 flex items-center gap-1.5">
              <BarChart3 size={12} />
              Consolidé (toutes pages)
            </span>
            <button
              type="button"
              onClick={toggleSummary}
              className="text-[10px] text-metre-accent hover:underline flex items-center gap-0.5"
              title="Ouvrir le résumé multi-pages détaillé (CSV / PDF / HTML)"
            >
              Détails <ExternalLink size={10} />
            </button>
          </div>

          {/* Per-type totals */}
          <div className="space-y-0.5">
            {Array.from(consolidated.byType.entries()).map(([type, info]) => (
              <div key={type} className="flex items-center justify-between text-[11px]">
                <span className="text-metre-muted flex items-center gap-1.5 truncate">
                  <span className="opacity-60 flex-shrink-0">{TYPE_ICONS[type]}</span>
                  <span className="truncate">{TYPE_LABELS[type]} ({info.count})</span>
                </span>
                <span className="font-mono tabular-nums text-metre-text whitespace-nowrap">
                  {formatMeasurement(info.total, info.unit, type)}
                </span>
              </div>
            ))}
          </div>

          {/* Per-product totals (only if at least one measurement is associated
              with a live catalog product) */}
          {consolidated.byProduct.size > 0 && (
            <>
              <div className="text-[10px] text-metre-muted uppercase tracking-wider mt-2 mb-1 pt-1.5 border-t border-metre-border/60">
                Par produit ({consolidated.byProduct.size})
              </div>
              <div className="space-y-0.5">
                {Array.from(consolidated.byProduct.entries()).map(([id, info]) => (
                  <div
                    key={id}
                    className="flex items-center justify-between text-[10px] gap-1.5"
                  >
                    <TruncatedText
                      text={info.name}
                      hint={`${info.qty.toFixed(2)} ${info.priceUnit} - ${info.cost.toFixed(2)} $`}
                      className="flex-1 truncate text-metre-muted"
                    />
                    <span className="font-mono tabular-nums text-metre-text whitespace-nowrap">
                      {info.qty.toFixed(2)} {info.priceUnit}
                    </span>
                    <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap w-14 text-right">
                      {info.cost.toFixed(2)} $
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 mt-1 border-t border-metre-border/60">
                  <span className="text-xs text-metre-text font-semibold">Total</span>
                  <span className="text-sm font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-bold">
                    {consolidated.totalCost.toFixed(2)} $
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
