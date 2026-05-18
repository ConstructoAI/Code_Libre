import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useMetreStore, mapServerComponent } from '../store';
import * as metreApi from '../api';
import {
  evaluateFormula,
  extractVariables,
  type FormulaInputs,
} from '../utils/bomEvaluator';
import {
  aggregateBoms,
  extractSheetFromBomName,
  extractMarioSectionOrder,
  formatCSVExport,
  formatCSVEstimationExport,
  type BomSection,
  type ExplodedLine,
} from '../utils/bomAggregation';
import type {
  Product,
  ProductComponent,
  BomInputDef,
  LaborTrade,
  Measurement,
  MeasurementLayer,
} from '../types';

/**
 * Stable display order of sheet groups. Pure function, hoisted at module
 * scope so it isn't recreated on every render and doesn't trigger
 * react-hooks/exhaustive-deps lint warnings when used inside useMemo.
 *
 * - "Mes assemblages" (-10) always first (Mario's chronologie chantier 0a-17).
 * - Known sheets from the Excel seeder follow in domain order.
 * - Unknown sheet names fall in the middle (500).
 * - "Autres" (1000) always last.
 */
const KNOWN_SHEET_ORDER = [
  'Sous-Sol',
  'Rez-de-chaussee',
  'Etage',
  'Finition',
  'Patio',
  'Toiture',
  'Garage',
  'Plancher',
];
function sheetOrderIndex(sheet: string): number {
  if (sheet === 'Mes assemblages') return -10;
  if (sheet === 'Autres') return 1000;
  const i = KNOWN_SHEET_ORDER.indexOf(sheet);
  return i === -1 ? 500 : i;
}

/**
 * Suffix for auto-derived variables that resolve to `points.length` of the
 * measurement bearing the base label. See `effectiveInputs` below for the
 * resolution logic. Module-scope const so it stays stable across renders.
 */
const NB_POINTS_SUFFIX = '_nb_points';

/**
 * Trigger a file download in the browser. Adds a UTF-8 BOM so Excel
 * recognizes the encoding (avoids accent corruption on French text).
 * Cleans up the object URL after the click to avoid memory leaks.
 */
function downloadCSV(filename: string, content: string): void {
  // UTF-8 BOM (U+FEFF) prefix so Excel reconnait l'encodage et n'affiche
  // pas les accents en mojibake. Escape Unicode explicite pour rester
  // ASCII-source compliant.
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to read the blob (some browsers
  // race-condition this without the timeout).
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Build a date-stamped filename like `bordereau-fournisseur-2026-05-01.csv`.
 */
function buildFilename(prefix: string): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${prefix}-${yyyy}-${mm}-${dd}.csv`;
}

/**
 * BomEstimationPanel -- multi-BOM live estimation.
 *
 * Behaviour (validated with user choices Q1.D + Q2.F + Q3.I + Q4.K):
 *
 * - Q1.D : auto-select BOMs whose at least one input is fed by a measurement
 *          label, with manual override per BOM (checkbox list).
 * - Q2.F : show detailed sections (one block per selected BOM) AND a
 *          cumulated block at the bottom (one row per unique child
 *          product, summed across all selected BOMs).
 * - Q3.I : "Copier TSV" exports BOTH blocks (detail then cumulated)
 *          for paste into a supplier order.
 * - Q4.K : the cumulated block is sorted by childCategory (then childName).
 *
 * Inputs are unified across selected BOMs (each declared input appears
 * once in the panel even when used by multiple BOMs). Effective input
 * value priority: manual override > measurement label match > BOM default.
 */

interface Props {
  onClose?: () => void;
}

/**
 * Calcule les inputs d'un composite pour un SCOPE precis (un calque donne
 * dans le cadre de P3.4, ou globalement quand le composite n'est lie a aucun
 * calque). Priorite, du plus fort au plus faible :
 *   1. layerCompositeInputs[name]  (saisie par calque, ex: type_bois=6)
 *   2. globalManualInputs[name]    (saisie globale dans le panneau BOM)
 *   3. Auto-derived `<base>_nb_points` depuis les mesures du scope
 *   4. Somme des mesures du scope avec label === name
 *   5. input.default
 *
 * Le scope est defini par la liste `scopedMeasurements` (toutes les mesures
 * du document quand pas de calque lie, mesures d'UN calque quand lie).
 */
function computeInputsForScope(
  bomInputs: BomInputDef[],
  scopedMeasurements: Measurement[],
  layerCompositeInputs: Record<string, number> | null | undefined,
  globalManualInputs: Record<string, number>,
): FormulaInputs {
  const out: FormulaInputs = {};
  const overrides = layerCompositeInputs ?? {};
  for (const input of bomInputs) {
    if (overrides[input.name] !== undefined) {
      out[input.name] = overrides[input.name];
      continue;
    }
    if (globalManualInputs[input.name] !== undefined) {
      out[input.name] = globalManualInputs[input.name];
      continue;
    }
    if (input.name.endsWith(NB_POINTS_SUFFIX)) {
      const baseName = input.name.slice(0, -NB_POINTS_SUFFIX.length);
      const matched = scopedMeasurements.filter(
        (m) => m.label?.trim() === baseName,
      );
      if (matched.length > 0) {
        out[input.name] = matched.reduce((sum, m) => {
          const n = Array.isArray(m.points) ? m.points.length : 0;
          return sum + n;
        }, 0);
        continue;
      }
      out[input.name] = input.default ?? 0;
      continue;
    }
    const matched = scopedMeasurements.filter(
      (m) => m.label?.trim() === input.name,
    );
    if (matched.length > 0) {
      out[input.name] = matched.reduce((sum, m) => {
        const raw = m.quantity ?? m.value ?? 0;
        const num = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
        return sum + num;
      }, 0);
      continue;
    }
    out[input.name] = input.default ?? 0;
  }
  return out;
}

export default function BomEstimationPanel({ onClose }: Props) {
  const products = useMetreStore((s) => s.products);
  const measurements = useMetreStore((s) => s.measurements);
  const laborTrades = useMetreStore((s) => s.laborTrades);
  const layers = useMetreStore((s) => s.layers);

  const composites = useMemo<Product[]>(
    () => products.filter((p) => p.isComposite),
    [products],
  );

  // Build a fast lookup: laborTradeId -> { hourlyRate, name }
  // Used to compute the cost column in the estimation TSV.
  const laborTradeById = useMemo<Map<string, LaborTrade>>(() => {
    const map = new Map<string, LaborTrade>();
    for (const t of laborTrades) map.set(t.id, t);
    return map;
  }, [laborTrades]);

  // ----------------------------------------------------------------
  // Auto-selection: BOMs that declare at least one input matching the
  // label of a tracked measurement.
  // ----------------------------------------------------------------
  const measuredLabels = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const m of measurements) {
      const label = m.label?.trim();
      if (label) set.add(label);
    }
    return set;
  }, [measurements]);

  // Ref to read the currently-cached components without triggering a useEffect
  // re-run when they change. Updated via setComponentsByBom below.
  const componentsByBomRef = useRef<Map<string, ProductComponent[]>>(new Map());

  // Auto-selection: a BOM is auto-selected when at least one variable
  // ACTUALLY referenced by one of its formulas is fed by a tracked
  // measurement label. We use the cached components (fetched in the
  // background for all composites) to extract the real list of
  // variables -- not bom_inputs which over-declares (e.g. Sous-Sol
  // declares 16 inputs but each individual BOM uses only 2-4 of them).
  //
  // Fallback when components are not yet loaded: use bom_inputs (broader
  // match). This avoids an empty selection at panel open while the
  // background fetch is in flight.
  const [bomFormulaVars, setBomFormulaVars] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );

  const autoSelectedIds = useMemo<Set<string>>(() => {
    // Map a variable name to its "lookup label" — the label of the
    // measurement that should trigger auto-selection. For auto-derived
    // `<base>_nb_points` variables, the trigger is the base label (Mario
    // doesn't draw measurements with the suffix, only the base name).
    const toLookupLabel = (v: string): string =>
      v.endsWith(NB_POINTS_SUFFIX)
        ? v.slice(0, -NB_POINTS_SUFFIX.length)
        : v;

    const ids = new Set<string>();

    // P3.4 : un calque explicitement lie a un composite force l'activation
    // de ce composite, meme sans mesure correspondante (l'utilisateur a
    // signale son intention).
    for (const layer of layers) {
      if (layer.compositeId) ids.add(layer.compositeId);
    }

    for (const bom of composites) {
      if (ids.has(bom.id)) continue;
      const realVars = bomFormulaVars.get(bom.id);
      if (realVars) {
        // Components loaded -- precise matching on actual formula variables
        for (const v of realVars) {
          if (measuredLabels.has(toLookupLabel(v))) {
            ids.add(bom.id);
            break;
          }
        }
      } else {
        // Components not loaded yet -- fallback to bom_inputs (broader)
        const inputs = bom.bomInputs ?? [];
        if (inputs.some((i) => measuredLabels.has(toLookupLabel(i.name)))) {
          ids.add(bom.id);
        }
      }
    }
    return ids;
  }, [composites, measuredLabels, bomFormulaVars, layers]);

  // Manual overrides per BOM. Map<bomId, true|false>.
  // Absent = follow auto. Present = explicit user choice.
  const [manualOverrides, setManualOverrides] = useState<Map<string, boolean>>(
    () => new Map(),
  );

  const selectedIds = useMemo<Set<string>>(() => {
    const result = new Set<string>();
    for (const bom of composites) {
      const manual = manualOverrides.get(bom.id);
      const auto = autoSelectedIds.has(bom.id);
      const isSelected = manual !== undefined ? manual : auto;
      if (isSelected) result.add(bom.id);
    }
    return result;
  }, [composites, autoSelectedIds, manualOverrides]);

  const toggleBom = useCallback(
    (id: string) => {
      setManualOverrides((prev) => {
        const next = new Map(prev);
        const auto = autoSelectedIds.has(id);
        const current = next.get(id);
        // Logic: clicking flips the current state. If we end up matching
        // the auto state, drop the override so the user goes back to
        // following auto-selection on subsequent measurement changes.
        const isCurrentlySelected = current !== undefined ? current : auto;
        const nextValue = !isCurrentlySelected;
        if (nextValue === auto) {
          next.delete(id);
        } else {
          next.set(id, nextValue);
        }
        return next;
      });
    },
    [autoSelectedIds],
  );

  const resetToAuto = useCallback(() => {
    setManualOverrides(new Map());
  }, []);

  // ----------------------------------------------------------------
  // Components are pre-fetched for ALL composites (not just selected ones)
  // so that auto-selection can match the *real* formula variables instead
  // of the over-broad bom_inputs schema. Cache in state; the ref keeps the
  // useEffect dep list to [composites] only -- avoids re-running on every
  // setComponentsByBom (would otherwise trigger a benign but wasteful
  // re-render cycle when fetches arrive one by one).
  // ----------------------------------------------------------------
  const [componentsByBom, setComponentsByBom] = useState<
    Map<string, ProductComponent[]>
  >(() => new Map());
  componentsByBomRef.current = componentsByBom;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const idsToFetch: string[] = [];
    for (const bom of composites) {
      if (!componentsByBomRef.current.has(bom.id)) idsToFetch.push(bom.id);
    }
    if (idsToFetch.length === 0) return;

    Promise.all(
      idsToFetch.map((id) =>
        metreApi
          .listProductComponents(id)
          .then((rows) => ({ id, rows }))
          .catch((err: unknown) => ({ id, error: err })),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        setComponentsByBom((prev) => {
          const next = new Map(prev);
          for (const r of results) {
            if ('error' in r) continue; // skip BOMs that failed to load
            // Reuse the store's mapServerComponent helper so the defensive
            // Number() coercion on quantityPerUnit (V12) is applied here too.
            // Without it, DECIMAL/NUMERIC strings from the backend would
            // silently poison buildCumulFromSections (Number.isFinite check).
            const mapped: ProductComponent[] = (
              r.rows as unknown as Record<string, unknown>[]
            ).map(mapServerComponent);
            next.set(r.id, mapped);
          }
          return next;
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Erreur de chargement');
      });

    return () => {
      cancelled = true;
    };
  }, [composites]);

  // Whenever components arrive, extract the set of variables actually used
  // by each BOM's formulas. This drives the precise auto-selection matching
  // (vs the broader bom_inputs schema match used as fallback while loading).
  useEffect(() => {
    setBomFormulaVars((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const [bomId, components] of componentsByBom) {
        if (next.has(bomId)) continue;
        const vars = new Set<string>();
        for (const c of components) {
          if (c.formula) {
            for (const v of extractVariables(c.formula)) vars.add(v);
          }
        }
        next.set(bomId, vars);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [componentsByBom]);

  // ----------------------------------------------------------------
  // Unified inputs across all selected BOMs (deduplicated by name).
  // First-seen wins for default value when BOMs disagree.
  // ----------------------------------------------------------------
  const unifiedInputs = useMemo<BomInputDef[]>(() => {
    const map = new Map<string, BomInputDef>();
    for (const bom of composites) {
      if (!selectedIds.has(bom.id)) continue;
      for (const input of bom.bomInputs ?? []) {
        if (!map.has(input.name)) map.set(input.name, input);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [composites, selectedIds]);

  // Manual input overrides (saisie locale dans le panneau)
  const [manualInputs, setManualInputs] = useState<Record<string, number>>({});

  // Effective inputs: manual > measurement match > default.
  //
  // Auto-derived variables: a variable named `<base>_nb_points` resolves to
  // the sum of `points.length` over all measurements labelled `<base>`.
  // Lets formulas count corners/segments without manual entry — e.g. a
  // foundation drawn as a 4-vertex polygon labelled `perimetre_fondation`
  // exposes `perimetre_fondation_nb_points = 4`. Plywood used only at corners
  // becomes `CEIL(perimetre_fondation_nb_points / 3)` = 2 sheets, no matter
  // the foundation shape (rectangle 4 corners, L-shape 6, etc.).
  // (`NB_POINTS_SUFFIX` declared at module scope, see top of file.)
  const effectiveInputs = useMemo<FormulaInputs>(() => {
    const out: FormulaInputs = {};
    for (const input of unifiedInputs) {
      if (manualInputs[input.name] !== undefined) {
        out[input.name] = manualInputs[input.name];
        continue;
      }
      // Auto-derived `<base>_nb_points` variable
      if (input.name.endsWith(NB_POINTS_SUFFIX)) {
        const baseName = input.name.slice(0, -NB_POINTS_SUFFIX.length);
        const matched = measurements.filter((m) => m.label?.trim() === baseName);
        if (matched.length > 0) {
          out[input.name] = matched.reduce((sum, m) => {
            const n = Array.isArray(m.points) ? m.points.length : 0;
            return sum + n;
          }, 0);
          continue;
        }
        out[input.name] = input.default ?? 0;
        continue;
      }
      // Standard variable: name == measurement label
      const matched = measurements.filter((m) => m.label?.trim() === input.name);
      if (matched.length > 0) {
        out[input.name] = matched.reduce((sum, m) => {
          const raw = m.quantity ?? m.value ?? 0;
          const num = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
          return sum + num;
        }, 0);
        continue;
      }
      out[input.name] = input.default ?? 0;
    }
    return out;
  }, [unifiedInputs, manualInputs, measurements]);

  const inputSource = useMemo<Record<string, 'manual' | 'measurement' | 'default'>>(
    () => {
      const out: Record<string, 'manual' | 'measurement' | 'default'> = {};
      for (const input of unifiedInputs) {
        if (manualInputs[input.name] !== undefined) out[input.name] = 'manual';
        else if (input.name.endsWith(NB_POINTS_SUFFIX)) {
          // Source for `<base>_nb_points` mirrors source of `<base>` —
          // measurement when one is labelled, default otherwise.
          const base = input.name.slice(0, -NB_POINTS_SUFFIX.length);
          out[input.name] = measurements.some((m) => m.label?.trim() === base)
            ? 'measurement'
            : 'default';
        }
        else if (measurements.some((m) => m.label?.trim() === input.name))
          out[input.name] = 'measurement';
        else out[input.name] = 'default';
      }
      return out;
    },
    [unifiedInputs, manualInputs, measurements],
  );

  // ----------------------------------------------------------------
  // Build sections (one per selected BOM, with components evaluated)
  // and aggregate into detail+cumul.
  //
  // P3.4 (2026-05-11): si au moins un calque est lie a un composite via
  // `layer.compositeId`, ce composite genere N sections (une par calque
  // lie) au lieu d'une seule. Chaque instance reduit son scope aux mesures
  // du calque correspondant et applique ses propres overrides
  // `layer.compositeInputs` (ex: type_bois=4 sur un mur, type_bois=6 sur
  // un autre). Composites sans calque lie conservent le comportement legacy.
  // ----------------------------------------------------------------
  const aggregate = useMemo(() => {
    const rawSections: BomSection[] = [];

    const buildLines = (
      components: ProductComponent[],
      inputs: FormulaInputs,
    ): ExplodedLine[] =>
      components.map((c) => {
        let qty = c.quantityPerUnit;
        let err: string | null = null;
        const formula = c.formula?.trim();
        const hasFormula = !!formula;
        if (hasFormula) {
          const r = evaluateFormula(formula, inputs);
          qty = r.value;
          err = r.error;
        }
        return {
          componentId: c.id,
          childProductId: c.childProductId,
          childName: c.childName ?? '(produit inconnu)',
          childCategory: c.childCategory ?? '',
          childPriceUnit: c.childPriceUnit ?? 'un',
          quantity: qty,
          fromFormula: hasFormula,
          formula: c.formula,
          error: err,
        };
      });

    for (const bom of composites) {
      if (!selectedIds.has(bom.id)) continue;
      const components = componentsByBom.get(bom.id);
      if (!components) continue; // still loading
      const sheet = extractSheetFromBomName(bom.name);
      const trade = bom.laborTradeId
        ? laborTradeById.get(bom.laborTradeId)
        : undefined;

      const linkedLayers: MeasurementLayer[] = layers.filter(
        (l) => l.compositeId === bom.id,
      );

      if (linkedLayers.length === 0) {
        // Legacy : aucun calque lie -> 1 section avec inputs globaux.
        rawSections.push({
          bomId: bom.id,
          bomName: bom.name,
          sheet,
          lines: buildLines(components, effectiveInputs),
          numeroSection: bom.numeroSection ?? null,
          nbHommes: bom.nbHommes ?? null,
          nbHrsParJour: bom.nbHrsParJour ?? null,
          nbJours: bom.nbJours ?? null,
          hourlyRate: trade?.hourlyRate ?? null,
          laborTradeName: trade?.trade ?? null,
        });
      } else {
        // P3.4 : une instance par calque lie.
        for (const layer of linkedLayers) {
          const layerMeasurements = measurements.filter(
            (m) => m.layer === layer.id,
          );
          const layerInputs = computeInputsForScope(
            bom.bomInputs ?? [],
            layerMeasurements,
            layer.compositeInputs,
            manualInputs,
          );
          rawSections.push({
            bomId: `${bom.id}:${layer.id}`,
            bomName: `${bom.name} (${layer.name})`,
            sheet,
            lines: buildLines(components, layerInputs),
            numeroSection: bom.numeroSection ?? null,
            nbHommes: bom.nbHommes ?? null,
            nbHrsParJour: bom.nbHrsParJour ?? null,
            nbJours: bom.nbJours ?? null,
            hourlyRate: trade?.hourlyRate ?? null,
            laborTradeName: trade?.trade ?? null,
          });
        }
      }
    }
    // Sorting is delegated to aggregateBoms() -> sortSections() which
    // handles numeroSection ascending with proper fallback (V9). Avoid
    // duplicating the sort logic here.
    return aggregateBoms(rawSections);
  }, [
    composites,
    selectedIds,
    componentsByBom,
    effectiveInputs,
    laborTradeById,
    layers,
    measurements,
    manualInputs,
  ]);

  // P3.4 — Detection des mesures "orphelines" : mesures placees sur un calque
  // NON-LIE alors qu'un autre calque est lie au meme composite et que la
  // mesure porte un label de variable du composite. Ces mesures sont
  // silencieusement ignorees par le calcul, donc on alerte l'utilisateur.
  //
  // Dedup via Map<measurementId, Measurement> : si plusieurs composites
  // selectionnes partagent le meme label de variable (ex: `perimetre_fondation`
  // utilise par Section 01 ET Section 04), la mesure orpheline ne doit
  // apparaitre qu'UNE seule fois dans le banner.
  const orphanedMeasurements = useMemo<Measurement[]>(() => {
    const orphans = new Map<string, Measurement>();
    for (const bom of composites) {
      if (!selectedIds.has(bom.id)) continue;
      const linkedLayers = layers.filter((l) => l.compositeId === bom.id);
      if (linkedLayers.length === 0) continue;
      const linkedLayerIds = new Set(linkedLayers.map((l) => l.id));
      const inputLabels = new Set<string>();
      for (const i of bom.bomInputs ?? []) {
        inputLabels.add(i.name);
        if (i.name.endsWith(NB_POINTS_SUFFIX)) {
          inputLabels.add(i.name.slice(0, -NB_POINTS_SUFFIX.length));
        }
      }
      for (const m of measurements) {
        const lbl = m.label?.trim();
        if (!lbl || !inputLabels.has(lbl)) continue;
        if (linkedLayerIds.has(m.layer)) continue;
        orphans.set(m.id, m);
      }
    }
    return Array.from(orphans.values());
  }, [composites, selectedIds, layers, measurements]);

  // Group composites by sheet for the selector UI.
  // Within each group, sort by Mario section number when present (`Section Xx`
  // -> chronological chantier order: 0a, 0b, 0c, 1, 2, 4, 7-17), else
  // alphabetical. Avoids alpha-sort placing "Section 10" before "Section 2".
  const compositesBySheet = useMemo<Map<string, Product[]>>(() => {
    const map = new Map<string, Product[]>();
    for (const bom of composites) {
      const sheet = extractSheetFromBomName(bom.name);
      const list = map.get(sheet) ?? [];
      list.push(bom);
      map.set(sheet, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const oa = extractMarioSectionOrder(a.name);
        const ob = extractMarioSectionOrder(b.name);
        if (oa && ob) {
          if (oa[0] !== ob[0]) return oa[0] - ob[0];
          return oa[1].localeCompare(ob[1]);
        }
        if (oa && !ob) return -1; // Mario sections first
        if (!oa && ob) return 1;
        return a.name.localeCompare(b.name);
      });
    }
    return map;
  }, [composites]);

  // Helper: select-all / deselect-all per group. Used by the group header
  // button (UX boost — avoids 22 individual clicks for Mario's catalog).
  const setGroupSelection = useCallback(
    (sheetName: string, select: boolean) => {
      const list = compositesBySheet.get(sheetName);
      if (!list) return;
      setManualOverrides((prev) => {
        const next = new Map(prev);
        for (const bom of list) {
          const auto = autoSelectedIds.has(bom.id);
          // If target state matches auto, drop the override; else set it
          // explicitly (mirrors the toggleBom logic).
          if (select === auto) {
            next.delete(bom.id);
          } else {
            next.set(bom.id, select);
          }
        }
        return next;
      });
    },
    [compositesBySheet, autoSelectedIds],
  );

  // Per-group selection counts: used to show "(N/M)" + smart label
  // ("Tout cocher" if any unselected, "Tout decocher" if all selected).
  const groupSelectionCount = useMemo(() => {
    const counts = new Map<string, { selected: number; total: number }>();
    for (const [sheet, list] of compositesBySheet) {
      const selected = list.filter((bom) => selectedIds.has(bom.id)).length;
      counts.set(sheet, { selected, total: list.length });
    }
    return counts;
  }, [compositesBySheet, selectedIds]);

  // Stable order of groups: BOM Mario first (chronologie chantier), then
  // known sheet names, then alphabetical, then "Autres" at the end.
  // Avoids the JS Map insertion-order randomness.
  // (sheetOrderIndex defined at module scope to keep the deps array clean
  // and avoid lint warnings re: missing dep on a render-recreated function.)
  const compositesBySheetSorted = useMemo<Array<[string, Product[]]>>(() => {
    return Array.from(compositesBySheet.entries()).sort(([a], [b]) => {
      const oa = sheetOrderIndex(a);
      const ob = sheetOrderIndex(b);
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
  }, [compositesBySheet]);

  const handleManualInputChange = useCallback((name: string, raw: string) => {
    if (raw === '' || raw === '-') {
      setManualInputs((prev) => {
        const { [name]: _omit, ...rest } = prev;
        return rest;
      });
      return;
    }
    const num = parseFloat(raw);
    if (!Number.isNaN(num)) {
      setManualInputs((prev) => ({ ...prev, [name]: num }));
    }
  }, []);

  const downloadFournisseurCSV = useCallback(() => {
    if (aggregate.sections.length === 0) return;
    try {
      const text = formatCSVExport(aggregate);
      downloadCSV(buildFilename('bordereau-fournisseur'), text);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de telechargement');
    }
  }, [aggregate]);

  const downloadEstimationCSV = useCallback(() => {
    if (aggregate.sections.length === 0) return;
    try {
      const text = formatCSVEstimationExport(aggregate);
      downloadCSV(buildFilename('bordereau-estimation'), text);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de telechargement');
    }
  }, [aggregate]);

  // Grand totals for the estimation summary block (top of the panel)
  const grandTotals = useMemo(() => {
    let totalHrs = 0;
    let totalCost = 0;
    for (const section of aggregate.sections) {
      const nbH = Number(section.nbHommes ?? 0);
      const nbHrs = Number(section.nbHrsParJour ?? 0);
      const nbJ = Number(section.nbJours ?? 0);
      const sectionHrs = nbH * nbHrs * nbJ;
      const rate = Number(section.hourlyRate ?? 0);
      totalHrs += sectionHrs;
      totalCost += sectionHrs * rate;
    }
    return { totalHrs, totalCost };
  }, [aggregate]);

  const hasManualOverrides = manualOverrides.size > 0;

  // ----------------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------------
  return (
    <div className="bg-metre-surface border-l border-metre-border w-[480px] flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-metre-border">
        <div>
          <h2 className="text-sm font-semibold text-metre-text">
            Estimation en direct des assemblages
          </h2>
          <p className="text-[11px] text-metre-muted mt-0.5">
            {selectedIds.size} assemblage{selectedIds.size > 1 ? 's' : ''} actif
            {selectedIds.size > 1 ? 's' : ''} sur {composites.length}
            {hasManualOverrides && ' (selection manuelle)'}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-metre-muted hover:text-metre-text text-lg leading-none"
            title="Fermer"
            aria-label="Fermer le panneau d'estimation"
          >
            {'×'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* P3.4 — Banner mesures orphelines : alerte quand des mesures sont
            placees sur un calque non-lie alors qu'un calque LIE existe pour
            le meme composite. Ces mesures sont silencieusement ignorees. */}
        {orphanedMeasurements.length > 0 && (
          <div className="rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <div className="font-medium mb-1">
              <AlertTriangle className="w-4 h-4 inline mr-1" /> {orphanedMeasurements.length} mesure
              {orphanedMeasurements.length > 1 ? 's' : ''} ignoree
              {orphanedMeasurements.length > 1 ? 's' : ''} dans le calcul
            </div>
            <p className="text-[11px] leading-relaxed">
              Ces mesures portent un label de variable d'un assemblage lie a
              un autre calque, mais ne sont pas sur un calque lie elles-memes.
              Deplace-les vers le bon calque (ex: "Mur Est") pour qu'elles
              soient prises en compte.
            </p>
            <ul className="mt-1 space-y-0.5 text-[10px] font-mono opacity-80 max-h-20 overflow-y-auto">
              {orphanedMeasurements.slice(0, 5).map((m) => (
                <li key={m.id}>
                  {m.label} ={' '}
                  {Number.isFinite(m.value) ? m.value.toFixed(2) : '?'}{' '}
                  {m.unit} (calque{' '}
                  {layers.find((l) => l.id === m.layer)?.name ?? m.layer})
                </li>
              ))}
              {orphanedMeasurements.length > 5 && (
                <li className="italic">
                  ... et {orphanedMeasurements.length - 5} de plus
                </li>
              )}
            </ul>
          </div>
        )}

        {/* SECTION 1 -- BOM selector with checkboxes grouped by sheet */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted">
              Assemblages actifs ({selectedIds.size}/{composites.length})
            </h3>
            {hasManualOverrides && (
              <button
                onClick={resetToAuto}
                className="px-2 py-0.5 text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
                title="Revenir a la selection auto basee sur les mesures tracees"
              >
                Reset auto
              </button>
            )}
          </div>
          {/* Help text ABOVE the list so first-time users see it before scanning the items.
              Reformule pour eviter le jargon technique (label canonique, variable, etc.). */}
          <p className="text-[11px] text-metre-muted mb-2 leading-relaxed">
            Coche un assemblage pour le calculer.{' '}
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">Tout activer</span>{' '}
            coche un groupe complet d'un coup. Si tu traces une mesure avec un nom comme{' '}
            <span className="font-mono">perimetre_fondation</span>, les assemblages
            qui l'utilisent s'allument automatiquement (badge{' '}
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">auto</span>).
          </p>
          <div className="rounded border border-metre-border max-h-60 overflow-y-auto">
            {compositesBySheetSorted.map(([sheet, list]) => {
              const counts = groupSelectionCount.get(sheet) ?? { selected: 0, total: list.length };
              const allSelected = counts.selected === counts.total;
              return (
              <div key={sheet}>
                <div className="sticky top-0 bg-metre-panel px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-metre-muted border-b border-metre-border flex items-center justify-between gap-2">
                  <span>
                    {sheet}
                    <span className="ml-1.5 text-metre-muted font-normal lowercase tracking-normal">
                      ({counts.selected}/{counts.total})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setGroupSelection(sheet, !allSelected)}
                    className={
                      'px-2 py-0.5 text-[11px] normal-case tracking-normal font-medium rounded border transition-colors ' +
                      (allSelected
                        ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40'
                        : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40')
                    }
                    title={
                      allSelected
                        ? `Desactiver les ${counts.total} assemblages de ${sheet}`
                        : `Activer les ${counts.total} assemblages de ${sheet}`
                    }
                    aria-label={
                      allSelected
                        ? `Desactiver les ${counts.total} assemblages du groupe ${sheet}`
                        : `Activer les ${counts.total} assemblages du groupe ${sheet}`
                    }
                  >
                    {allSelected ? 'Tout desactiver' : 'Tout activer'}
                  </button>
                </div>
                {list.map((bom) => {
                  const isSelected = selectedIds.has(bom.id);
                  const isAuto = autoSelectedIds.has(bom.id);
                  const isOverride = manualOverrides.has(bom.id);
                  return (
                    <label
                      key={bom.id}
                      className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-metre-panel border-b border-metre-border last:border-b-0 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleBom(bom.id)}
                        className="rounded"
                      />
                      <span
                        className={
                          isSelected ? 'text-metre-text' : 'text-metre-muted'
                        }
                      >
                        {bom.name}
                      </span>
                      {isAuto && !isOverride && (
                        <span className="ml-auto text-[9px] text-emerald-600 dark:text-emerald-400 uppercase font-medium">
                          auto
                        </span>
                      )}
                      {isOverride && (
                        <span className="ml-auto text-[9px] text-blue-600 dark:text-blue-400 uppercase font-medium">
                          manuel
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              );
            })}
          </div>
        </section>

        {selectedIds.size === 0 ? (
          <div className="rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-2 text-xs text-amber-700 dark:text-amber-300">
            Aucun assemblage actif pour l'instant. Pour commencer :
            <ol className="list-decimal list-inside mt-1 space-y-0.5 text-[11px]">
              <li>Coche un assemblage ci-dessus, ou clique <strong>Tout activer</strong> sur un groupe.</li>
              <li>Trace tes mesures sur le PDF pour alimenter les calculs.</li>
              <li>Telecharge le bordereau au format CSV pour ton fournisseur.</li>
            </ol>
          </div>
        ) : (
          <>
            {/* SECTION 2 -- Unified inputs */}
            {unifiedInputs.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted mb-2">
                  Donnees du chantier ({unifiedInputs.length})
                </h3>
                <div className="space-y-1.5">
                  {unifiedInputs.map((input) => {
                    const value = effectiveInputs[input.name];
                    const source = inputSource[input.name];
                    const sourceLabel =
                      source === 'manual'
                        ? 'manuel'
                        : source === 'measurement'
                        ? 'mesure'
                        : 'defaut';
                    const sourceColor =
                      source === 'manual'
                        ? 'text-blue-600 dark:text-blue-400'
                        : source === 'measurement'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-metre-muted';
                    return (
                      <div
                        key={input.name}
                        className="grid grid-cols-12 gap-2 items-center text-xs"
                      >
                        <div className="col-span-6">
                          <div className="text-metre-text font-mono text-[11px]">
                            {input.name}
                          </div>
                          <div className="text-[10px] text-metre-muted truncate">
                            {input.description}
                          </div>
                        </div>
                        <div className="col-span-4">
                          <input
                            type="number"
                            className="input-field text-right"
                            value={
                              source === 'manual'
                                ? manualInputs[input.name] ?? 0
                                : value ?? 0
                            }
                            onChange={(e) =>
                              handleManualInputChange(input.name, e.target.value)
                            }
                            step="0.01"
                          />
                        </div>
                        <div className="col-span-2 flex items-center gap-1">
                          <span className="text-[10px] text-metre-muted">
                            {input.unit}
                          </span>
                          <span
                            className={`text-[9px] font-medium uppercase ${sourceColor}`}
                          >
                            {sourceLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* SECTION 3 -- Detailed bordereau (one block per BOM) */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted">
                  Bordereau detaille ({aggregate.sections.length} assemblage
                  {aggregate.sections.length > 1 ? 's' : ''})
                </h3>
                <div className="flex gap-1">
                  <button
                    onClick={downloadFournisseurCSV}
                    disabled={aggregate.sections.length === 0}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[10px] font-medium rounded transition-colors"
                    title="Telecharger le bordereau fournisseur (detail + cumul) au format CSV"
                  >
                    CSV Fournisseur
                  </button>
                  <button
                    onClick={downloadEstimationCSV}
                    disabled={aggregate.sections.length === 0}
                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[10px] font-medium rounded transition-colors"
                    title="Telecharger l'estimation projet (format Excel avec temps + cout) au format CSV"
                  >
                    CSV Estimation
                  </button>
                </div>
              </div>

              {/* Grand totals summary */}
              {grandTotals.totalHrs > 0 && (
                <div className="mb-2 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1.5 text-xs">
                  <div className="flex justify-between text-emerald-800 dark:text-emerald-200">
                    <span className="font-medium">Total estimation projet</span>
                    <span className="tabular-nums font-mono">
                      {grandTotals.totalHrs.toFixed(1)} h
                      {' / '}
                      {grandTotals.totalCost.toFixed(2)} $
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {aggregate.sections.map((section) => {
                  const nbH = Number(section.nbHommes ?? 0);
                  const nbHrs = Number(section.nbHrsParJour ?? 0);
                  const nbJ = Number(section.nbJours ?? 0);
                  const sectionTotalHrs = nbH * nbHrs * nbJ;
                  const sectionRate = Number(section.hourlyRate ?? 0);
                  const sectionCost = sectionTotalHrs * sectionRate;
                  return (
                  <div
                    key={section.bomId}
                    className="rounded border border-metre-border overflow-hidden"
                  >
                    <div className="bg-metre-panel px-2 py-1 text-[11px] font-semibold text-metre-text border-b border-metre-border">
                      {section.numeroSection && (
                        <span className="text-metre-muted mr-1">
                          {`#${section.numeroSection}`}
                        </span>
                      )}
                      {section.bomName}{' '}
                      <span className="font-normal text-metre-muted">
                        ({section.lines.length} lignes)
                      </span>
                      {sectionTotalHrs > 0 && (
                        <div className="font-normal text-[10px] text-metre-muted mt-0.5">
                          {section.laborTradeName ?? 'metier non assigne'}
                          {' -- '}
                          {nbH} hommes x {nbHrs} h/j x {nbJ} j = {sectionTotalHrs.toFixed(1)} h
                          {' = '}
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            {sectionCost.toFixed(2)} $
                          </span>
                        </div>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <tbody>
                        {section.lines.map((l) => (
                          <tr
                            key={l.componentId}
                            className={`border-t border-metre-border ${
                              l.error ? 'bg-red-50 dark:bg-red-900/10' : ''
                            }`}
                            title={
                              l.error
                                ? `Erreur: ${l.error}\nFormule: ${l.formula}`
                                : l.formula
                                ? `Formule: ${l.formula}`
                                : 'Quantite fixe'
                            }
                          >
                            <td className="px-2 py-1">
                              <div className="text-metre-text">{l.childName}</div>
                              {l.fromFormula && (
                                <div className="text-[9px] text-blue-600 dark:text-blue-400">
                                  formule
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums font-mono w-16">
                              {Number.isFinite(l.quantity) ? (
                                l.quantity.toFixed(2)
                              ) : (
                                <span className="text-red-600">ERR</span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-metre-muted w-12">
                              {l.childPriceUnit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  );
                })}
              </div>
            </section>

            {/* SECTION 4 -- Cumulated bordereau (sorted by category then name) */}
            {aggregate.cumul.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted mb-2">
                  Cumule tous assemblages ({aggregate.cumul.length} produits uniques)
                </h3>
                <div className="rounded border border-metre-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-metre-panel text-metre-muted">
                      <tr>
                        <th className="text-left px-2 py-1 font-medium">
                          Produit
                        </th>
                        <th className="text-right px-2 py-1 font-medium w-16">
                          Total
                        </th>
                        <th className="text-left px-2 py-1 font-medium w-12">
                          Un.
                        </th>
                        <th className="text-right px-2 py-1 font-medium w-12"
                            title="Nombre d'assemblages qui contribuent a ce total">
                          Assembl.
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregate.cumul.map((c) => (
                        <tr
                          key={c.childProductId}
                          className={`border-t border-metre-border ${
                            c.hasError ? 'bg-red-50 dark:bg-red-900/10' : ''
                          }`}
                          title={`Sources: ${c.sources.join(', ')}`}
                        >
                          <td className="px-2 py-1">
                            <div className="text-metre-text">{c.childName}</div>
                            <div className="text-[9px] text-metre-muted">
                              {c.childCategory}
                            </div>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums font-mono">
                            {Number.isFinite(c.totalQuantity) ? (
                              c.totalQuantity.toFixed(2)
                            ) : (
                              <span className="text-red-600">ERR</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-metre-muted">
                            {c.childPriceUnit}
                          </td>
                          <td className="px-2 py-1 text-right text-metre-muted tabular-nums">
                            {c.sources.length}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-metre-muted mt-1">
                  Trie par categorie puis nom. La colonne <strong>Assembl.</strong> indique combien
                  d'assemblages contribuent a chaque produit (utile pour valider les
                  doublons potentiels avant de passer la commande).
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
