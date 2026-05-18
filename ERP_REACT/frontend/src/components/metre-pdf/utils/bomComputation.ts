/**
 * bomComputation — Utilitaires de calcul partagé entre BomEstimationPanel
 * (rendu live) et MetrePdf.handleOpenSoumissionBom (export soumission).
 *
 * Cette factorisation evite la divergence des deux logiques BOM (P3.4
 * calques lies aux composites) qui partagent :
 *   - Resolution variables d'un composite pour un scope donne (global ou
 *     scope d'un calque P3.4)
 *   - Construction des lignes explose d'un composite (formule ou qpu)
 *   - Boucle composite x calque : N sections (1 par calque lie) ou 1
 *     section legacy quand aucun calque n'est lie.
 *
 * Pure functions : aucune dependance React, aucune lecture de store.
 * Toutes les donnees viennent en parametres -- testables en isolation.
 */

import {
  evaluateFormula,
  extractVariables,
  type FormulaInputs,
} from './bomEvaluator';
import {
  aggregateBoms,
  extractSheetFromBomName,
  type BomSection,
  type ExplodedLine,
} from './bomAggregation';
import type {
  Product,
  ProductComponent,
  BomInputDef,
  LaborTrade,
  Measurement,
  MeasurementLayer,
} from '../types';

/** Suffix pour variables auto-derived `<base>_nb_points`. */
export const NB_POINTS_SUFFIX = '_nb_points';

/**
 * Calcule les inputs d'un composite pour un SCOPE precis (un calque donne
 * dans le cadre de P3.4, ou globalement quand le composite n'est lie a aucun
 * calque). Priorite, du plus fort au plus faible :
 *   1. layerCompositeInputs[name]  (saisie par calque, ex: type_bois=6)
 *   2. globalManualInputs[name]    (saisie globale dans le panneau BOM)
 *   3. Auto-derived `<base>_nb_points` depuis les mesures du scope
 *   4. Somme des mesures du scope avec label === name
 *   5. input.default
 */
export function computeInputsForScope(
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

/**
 * Construit les lignes explosees d'un composite a partir de ses components.
 * Chaque ligne represente un child product avec sa quantite calculee
 * (formule prioritaire, sinon quantityPerUnit fallback).
 *
 * CONTRAT (filtrage = responsabilite caller) :
 *   - NaN propagation : si une formule produit NaN (division par zero,
 *     variable manquante), `line.quantity` est NaN. Les callers DOIVENT
 *     filtrer via `Number.isFinite()` avant d'afficher / multiplier.
 *   - Negatifs : une formule peut produire un nombre negatif (cas voulu
 *     pour deductions). Filtre seulement si le contexte impose qty >= 0
 *     (ex: export soumission, cf. MetrePdf.handleOpenSoumissionBom).
 *   - Erreurs syntaxe : `line.error` contient le message d'erreur, qty
 *     non garantie significative.
 */
export function buildBomLines(
  components: ProductComponent[],
  inputs: FormulaInputs,
): ExplodedLine[] {
  return components.map((c) => {
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
}

/**
 * Arguments de `computeBomSectionsForState`.
 *
 * `manualInputs` est utilise UNIQUEMENT pour les composites SANS calque lie
 * (legacy global). Quand un calque est lie, l'override `composite_inputs`
 * du calque a la priorite (cf. computeInputsForScope).
 *
 * `effectiveInputs` (optionnel) : inputs globaux deja resolus pour les
 * composites sans calque. Si non fourni, equivaut a manualInputs (utile
 * pour le scenario soumission BOM sans pre-calcul global).
 */
export interface BomComputeArgs {
  composites: Product[];
  selectedIds: Set<string>;
  componentsByBom: Map<string, ProductComponent[]>;
  layers: MeasurementLayer[];
  measurements: Measurement[];
  manualInputs: Record<string, number>;
  laborTradeById: Map<string, LaborTrade>;
  effectiveInputs?: FormulaInputs;
}

/**
 * Auto-selection des composites actifs (logique alignee sur BomEstimationPanel).
 *
 * Un composite est ACTIF si :
 *   1. Il est explicitement lie a au moins un calque (`layer.compositeId`)
 *      -- l'utilisateur a signale son intention (priorite absolue)
 *   OU
 *   2. Au moins une variable REELLEMENT UTILISEE dans une formule de
 *      ses components correspond a un label de mesure tracee. Cette
 *      version precise (basee sur `extractVariables`) elimine les
 *      faux-positifs : `bom_inputs` declare typiquement 16 variables
 *      alors qu'un composite n'en utilise que 2-4 dans ses formules.
 *      Quand les components ne sont PAS encore charges, fallback sur
 *      `bom_inputs` (broader match) pour eviter de manquer un composite.
 *
 * Cette fonction reproduit la logique de
 * `BomEstimationPanel.autoSelectedIds` (lignes 229-268) afin que les
 * deux chemins (panel rendu live + handleOpenSoumissionBom) partagent
 * exactement la meme selection. Evite la divergence ou le bouton
 * "Soumission BOM" produirait plus de composites que le panel n'en
 * affiche (Round 5 QA bug C1).
 *
 * CONTRAT (orphelins = responsabilite caller) :
 *   Si `layer.compositeId` pointe vers un composite supprime / inexistant
 *   dans `composites`, l'ID orphelin sera inclus dans le Set retourne.
 *   `computeBomSectionsForState` filtre naturellement (boucle sur
 *   composites) donc pas d'impact sur la generation de sections. Mais si
 *   un futur caller utilise `autoSelectActiveComposites(...).size` comme
 *   compteur, il doit filtrer prealablement les orphelins.
 */
export function autoSelectActiveComposites(
  composites: Product[],
  layers: MeasurementLayer[],
  measurements: Measurement[],
  componentsByBom: Map<string, ProductComponent[]>,
): Set<string> {
  const ids = new Set<string>();

  // 1. Calques explicitement lies (priorite absolue)
  for (const layer of layers) {
    if (layer.compositeId) ids.add(layer.compositeId);
  }

  // 2. Labels de mesures tracees
  const measuredLabels = new Set<string>();
  for (const m of measurements) {
    const label = m.label?.trim();
    if (label) measuredLabels.add(label);
  }

  // Convertit nom de variable -> label de mesure attendu.
  // Pour les variables auto-derived `<base>_nb_points`, le label trace
  // est `<base>` (Mario ne trace pas la variable avec le suffixe).
  const toLookupLabel = (v: string): string =>
    v.endsWith(NB_POINTS_SUFFIX) ? v.slice(0, -NB_POINTS_SUFFIX.length) : v;

  for (const bom of composites) {
    if (ids.has(bom.id)) continue;

    const components = componentsByBom.get(bom.id);
    if (components && components.length > 0) {
      // Matching precis sur variables reellement utilisees dans les
      // formules. Extrait variables de chaque formule via extractVariables.
      const realVars = new Set<string>();
      for (const c of components) {
        if (c.formula) {
          for (const v of extractVariables(c.formula)) {
            realVars.add(v);
          }
        }
      }
      let matched = false;
      for (const v of realVars) {
        if (measuredLabels.has(toLookupLabel(v))) {
          matched = true;
          break;
        }
      }
      if (matched) ids.add(bom.id);
    } else {
      // Fallback (components pas charges) : match sur bom_inputs (broader)
      const inputs = bom.bomInputs ?? [];
      if (inputs.some((i) => measuredLabels.has(toLookupLabel(i.name)))) {
        ids.add(bom.id);
      }
    }
  }

  return ids;
}

/**
 * Calcule les sections BOM pour l'etat courant : pour chaque composite
 * selectionne, produit N sections (1 par calque lie P3.4) ou 1 section
 * legacy (aucun calque lie -> inputs globaux).
 *
 * Retourne le resultat `aggregateBoms()` qui inclut sections triees et
 * cumul cross-section pour le bordereau fournisseur.
 */
export function computeBomSectionsForState(args: BomComputeArgs): {
  sections: BomSection[];
  cumul: import('./bomAggregation').CumulLine[];
} {
  const {
    composites,
    selectedIds,
    componentsByBom,
    layers,
    measurements,
    manualInputs,
    laborTradeById,
    effectiveInputs,
  } = args;

  const globalInputs: FormulaInputs = effectiveInputs ?? manualInputs;
  const rawSections: BomSection[] = [];

  for (const bom of composites) {
    if (!selectedIds.has(bom.id)) continue;
    const components = componentsByBom.get(bom.id);
    if (!components) continue;
    const sheet = extractSheetFromBomName(bom.name);
    const trade = bom.laborTradeId
      ? laborTradeById.get(bom.laborTradeId)
      : undefined;

    const linkedLayers: MeasurementLayer[] = layers.filter(
      (l) => l.compositeId === bom.id,
    );

    if (linkedLayers.length === 0) {
      rawSections.push({
        bomId: bom.id,
        bomName: bom.name,
        sheet,
        lines: buildBomLines(components, globalInputs),
        numeroSection: bom.numeroSection ?? null,
        nbHommes: bom.nbHommes ?? null,
        nbHrsParJour: bom.nbHrsParJour ?? null,
        nbJours: bom.nbJours ?? null,
        hourlyRate: trade?.hourlyRate ?? null,
        laborTradeName: trade?.trade ?? null,
      });
    } else {
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
          lines: buildBomLines(components, layerInputs),
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

  return aggregateBoms(rawSections);
}
