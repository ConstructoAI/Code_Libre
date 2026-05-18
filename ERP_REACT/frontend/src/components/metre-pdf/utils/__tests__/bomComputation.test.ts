/**
 * Tests pour bomComputation.ts — logique partagée BOM (P3.4).
 *
 * Focus sur :
 *   - computeInputsForScope : priorité des sources (overrides > globalManual >
 *     auto-derived _nb_points > somme mesures > default)
 *   - buildBomLines : évaluation formule vs fallback quantityPerUnit
 *   - computeBomSectionsForState : boucle composite × calque (P3.4) avec
 *     scope par calque, et fallback legacy global quand pas de calque lié
 */
import { describe, it, expect } from 'vitest';
import {
  computeInputsForScope,
  buildBomLines,
  computeBomSectionsForState,
  autoSelectActiveComposites,
  NB_POINTS_SUFFIX,
} from '../bomComputation';
import type {
  Product,
  ProductComponent,
  BomInputDef,
  Measurement,
  MeasurementLayer,
  LaborTrade,
} from '../../types';

// ─── Helpers de fixtures ────────────────────────────────────────────

function makeInput(
  name: string,
  unit: string = 'pi',
  defaultValue: number = 0,
): BomInputDef {
  return { name, unit, default: defaultValue };
}

function makeMeasurement(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: 'm-' + Math.random().toString(36).slice(2, 9),
    type: 'distance',
    label: '',
    value: 0,
    unit: 'ft',
    color: '#000',
    layer: null,
    points: [],
    page: 1,
    ...overrides,
  } as Measurement;
}

function makeLayer(overrides: Partial<MeasurementLayer> = {}): MeasurementLayer {
  return {
    id: 'l-' + Math.random().toString(36).slice(2, 9),
    name: 'Calque',
    color: '#000',
    visible: true,
    locked: false,
    sortOrder: 0,
    compositeId: null,
    compositeInputs: null,
    ...overrides,
  } as MeasurementLayer;
}

function makeComponent(
  overrides: Partial<ProductComponent> = {},
): ProductComponent {
  return {
    id: 'c-' + Math.random().toString(36).slice(2, 9),
    parentProductId: 'p-1',
    childProductId: 'p-2',
    childName: 'Test Product',
    childCategory: 'Materiaux',
    childPriceUnit: 'un',
    childPrice: 0,
    quantityPerUnit: 1,
    formula: null,
    notes: null,
    sortOrder: 0,
    ...overrides,
  } as ProductComponent;
}

function makeComposite(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    name: 'Composite',
    category: 'Sous-Sol',
    isComposite: true,
    bomInputs: [],
    price: 0,
    priceUnit: 'un',
    color: '#000',
    wastePct: 0,
    components: [],
    displayMode: 'detailed',
    ...overrides,
  } as Product;
}

// ─── computeInputsForScope ──────────────────────────────────────────

describe('computeInputsForScope', () => {
  it('returns default when no measurement matches label', () => {
    const inputs = [makeInput('perimetre_fondation', 'pi', 180)];
    const result = computeInputsForScope(inputs, [], null, {});
    expect(result.perimetre_fondation).toBe(180);
  });

  it('uses layer composite_inputs override (highest priority)', () => {
    const inputs = [makeInput('hauteur_pierre', 'pi', 0.5)];
    const result = computeInputsForScope(
      inputs,
      [],
      { hauteur_pierre: 1.333 },
      { hauteur_pierre: 0.667 },
    );
    expect(result.hauteur_pierre).toBe(1.333);
  });

  it('uses globalManualInputs when no layer override', () => {
    const inputs = [makeInput('hauteur_pierre', 'pi', 0.5)];
    const result = computeInputsForScope(inputs, [], null, {
      hauteur_pierre: 0.667,
    });
    expect(result.hauteur_pierre).toBe(0.667);
  });

  it('sums measurements with matching label', () => {
    const inputs = [makeInput('longueur_div', 'pi', 0)];
    const measures = [
      makeMeasurement({ label: 'longueur_div', value: 47.5 }),
      makeMeasurement({ label: 'longueur_div', value: 11.5 }),
      makeMeasurement({ label: 'longueur_div', value: 8.75 }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result.longueur_div).toBe(47.5 + 11.5 + 8.75);
  });

  it('uses quantity over value when both present', () => {
    const inputs = [makeInput('perimetre', 'pi', 0)];
    const measures = [
      makeMeasurement({ label: 'perimetre', value: 100, quantity: 105 }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result.perimetre).toBe(105);
  });

  it('auto-derives _nb_points from measurement points length', () => {
    const inputs = [makeInput('perimetre' + NB_POINTS_SUFFIX, 'un', 0)];
    const measures = [
      makeMeasurement({
        label: 'perimetre',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ] as any,
      }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result['perimetre' + NB_POINTS_SUFFIX]).toBe(4);
  });

  it('falls back to default when _nb_points base label has no measurement', () => {
    const inputs = [makeInput('foo' + NB_POINTS_SUFFIX, 'un', 6)];
    const result = computeInputsForScope(inputs, [], null, {});
    expect(result['foo' + NB_POINTS_SUFFIX]).toBe(6);
  });

  it('ignores non-finite quantity values', () => {
    const inputs = [makeInput('perimetre', 'pi', 0)];
    const measures = [
      makeMeasurement({ label: 'perimetre', value: NaN }),
      makeMeasurement({ label: 'perimetre', value: 50 }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result.perimetre).toBe(50);
  });

  // ─── Edge cases ajoutes (audit QA) ────────────────────────────────

  it('treats explicit quantity=0 as zero (not fallback to value)', () => {
    // Le `??` operator preserve 0 (truthy pour ??), donc une mesure avec
    // quantity=0 doit etre comptee comme 0, pas tomber sur value=100.
    const inputs = [makeInput('perimetre', 'pi', 999)];
    const measures = [
      makeMeasurement({ label: 'perimetre', value: 100, quantity: 0 }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result.perimetre).toBe(0);
  });

  it('falls back to value when quantity is explicitly null', () => {
    // Bien que TypeScript declare quantity?: number, le backend peut
    // renvoyer null. Le `??` doit alors tomber sur value.
    const inputs = [makeInput('perimetre', 'pi', 0)];
    const measures = [
      makeMeasurement({ label: 'perimetre', value: 42, quantity: null as any }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result.perimetre).toBe(42);
  });

  it('sums negative measurement values (deduction use case)', () => {
    // Round 5 : isDeduction est porte par le caller (store), mais ici
    // on s'assure que des valeurs negatives ne crashent pas.
    const inputs = [makeInput('surface', 'pi2', 0)];
    const measures = [
      makeMeasurement({ label: 'surface', value: 200 }),
      makeMeasurement({ label: 'surface', value: -40 }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result.surface).toBe(160);
  });

  it('respects override even when value is 0', () => {
    // 0 est une valeur valide pour un override (ex: desactiver une variable).
    const inputs = [makeInput('hauteur', 'pi', 8)];
    const result = computeInputsForScope(inputs, [], { hauteur: 0 }, {});
    expect(result.hauteur).toBe(0);
  });

  it('respects globalManual 0 over default', () => {
    const inputs = [makeInput('hauteur', 'pi', 8)];
    const result = computeInputsForScope(inputs, [], null, { hauteur: 0 });
    expect(result.hauteur).toBe(0);
  });

  it('trims whitespace from measurement labels', () => {
    const inputs = [makeInput('perimetre', 'pi', 0)];
    const measures = [
      makeMeasurement({ label: '  perimetre  ', value: 75 }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result.perimetre).toBe(75);
  });

  it('ignores measurements without label', () => {
    const inputs = [makeInput('perimetre', 'pi', 999)];
    const measures = [
      makeMeasurement({ label: '', value: 50 }),
      makeMeasurement({ label: null as any, value: 25 }),
    ];
    const result = computeInputsForScope(inputs, measures, null, {});
    expect(result.perimetre).toBe(999); // tombe sur le default
  });
});

// ─── buildBomLines ───────────────────────────────────────────────────

describe('buildBomLines', () => {
  it('uses quantityPerUnit when no formula', () => {
    const components = [
      makeComponent({ quantityPerUnit: 2.5, formula: null }),
    ];
    const lines = buildBomLines(components, {});
    expect(lines[0].quantity).toBe(2.5);
    expect(lines[0].fromFormula).toBe(false);
    expect(lines[0].error).toBeNull();
  });

  it('evaluates formula and returns computed quantity', () => {
    const components = [
      makeComponent({
        quantityPerUnit: 1,
        formula: 'CEIL(perimetre * 1.05 / 10)',
      }),
    ];
    const lines = buildBomLines(components, { perimetre: 223.3 });
    expect(lines[0].quantity).toBe(24); // CEIL(23.4465) = 24
    expect(lines[0].fromFormula).toBe(true);
    expect(lines[0].error).toBeNull();
  });

  it('returns error string for invalid formula', () => {
    const components = [
      makeComponent({ quantityPerUnit: 1, formula: 'INVALID@@@' }),
    ];
    const lines = buildBomLines(components, {});
    expect(lines[0].error).not.toBeNull();
  });

  it('handles empty components list', () => {
    expect(buildBomLines([], {})).toEqual([]);
  });

  it('uses childName fallback when null', () => {
    const components = [makeComponent({ childName: null as any })];
    const lines = buildBomLines(components, {});
    expect(lines[0].childName).toBe('(produit inconnu)');
  });

  // ─── Edge cases ajoutes (audit QA) ────────────────────────────────

  it('returns NaN when formula divides by zero', () => {
    // bomEvaluator.ts ligne 308 : r===0 -> NaN. Le downstream
    // (handleOpenSoumissionBom + buildCumulFromSections) doit ensuite
    // filtrer/coercer 0. Ici on verifie juste que la propagation existe.
    const components = [
      makeComponent({ quantityPerUnit: 1, formula: 'surface / 0' }),
    ];
    const lines = buildBomLines(components, { surface: 100 });
    expect(Number.isFinite(lines[0].quantity)).toBe(false);
    expect(lines[0].error).not.toBeNull();
  });

  it('propagates negative formula results (caller filters)', () => {
    // buildBomLines ne filtre PAS les negatives. C'est handleOpenSoumissionBom
    // (MetrePdf.tsx:975) qui les coerce a 0 via Number.isFinite && >= 0.
    const components = [
      makeComponent({ quantityPerUnit: 1, formula: 'surface - 200' }),
    ];
    const lines = buildBomLines(components, { surface: 100 });
    expect(lines[0].quantity).toBe(-100);
    expect(lines[0].error).toBeNull();
  });

  it('treats empty formula string as no formula (fallback qpu)', () => {
    // formula.trim() vide -> hasFormula false -> qty = quantityPerUnit.
    const components = [
      makeComponent({ quantityPerUnit: 7, formula: '   ' }),
    ];
    const lines = buildBomLines(components, {});
    expect(lines[0].quantity).toBe(7);
    expect(lines[0].fromFormula).toBe(false);
  });

  it('returns NaN when formula references unknown variable', () => {
    const components = [
      makeComponent({ quantityPerUnit: 1, formula: 'unknown_var * 2' }),
    ];
    const lines = buildBomLines(components, {});
    expect(Number.isFinite(lines[0].quantity)).toBe(false);
    expect(lines[0].error).toContain('non fournie');
  });
});

// ─── computeBomSectionsForState ──────────────────────────────────────

describe('computeBomSectionsForState', () => {
  it('skips composites not in selectedIds', () => {
    const composite = makeComposite({ id: 'comp-1' });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(), // empty -> nothing selected
      componentsByBom: new Map([['comp-1', [makeComponent()]]]),
      layers: [],
      measurements: [],
      manualInputs: {},
      laborTradeById: new Map(),
    });
    expect(result.sections).toEqual([]);
  });

  it('skips composites without loaded components', () => {
    const composite = makeComposite({ id: 'comp-1' });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map(), // no components loaded
      layers: [],
      measurements: [],
      manualInputs: {},
      laborTradeById: new Map(),
    });
    expect(result.sections).toEqual([]);
  });

  it('generates 1 section with global inputs when no linked layer (legacy)', () => {
    const composite = makeComposite({
      id: 'comp-1',
      name: '02. (P) Drain',
      bomInputs: [makeInput('perimetre_fondation', 'pi', 100)],
    });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map([
        ['comp-1', [makeComponent({ quantityPerUnit: 2 })]],
      ]),
      layers: [],
      measurements: [],
      manualInputs: { perimetre_fondation: 200 },
      laborTradeById: new Map(),
    });
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].bomName).toBe('02. (P) Drain');
    expect(result.sections[0].lines.length).toBe(1);
  });

  it('generates N sections when N layers linked to composite (P3.4)', () => {
    const composite = makeComposite({
      id: 'comp-1',
      name: '02. (P) Drain',
      bomInputs: [makeInput('perimetre_fondation', 'pi', 100)],
    });
    const layer1 = makeLayer({ id: 'l1', name: 'Maison', compositeId: 'comp-1' });
    const layer2 = makeLayer({ id: 'l2', name: 'Garage', compositeId: 'comp-1' });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map([
        ['comp-1', [makeComponent({ quantityPerUnit: 1 })]],
      ]),
      layers: [layer1, layer2],
      measurements: [
        makeMeasurement({ layer: 'l1', label: 'perimetre_fondation', value: 169 }),
        makeMeasurement({ layer: 'l2', label: 'perimetre_fondation', value: 61 }),
      ],
      manualInputs: {},
      laborTradeById: new Map(),
    });
    expect(result.sections.length).toBe(2);
    const maisonSection = result.sections.find((s) => s.bomName.includes('Maison'));
    const garageSection = result.sections.find((s) => s.bomName.includes('Garage'));
    expect(maisonSection).toBeDefined();
    expect(garageSection).toBeDefined();
  });

  it('uses layer composite_inputs override per layer (P3.4)', () => {
    const composite = makeComposite({
      id: 'comp-1',
      name: 'Test',
      bomInputs: [makeInput('h', 'pi', 0.5)],
    });
    const layer1 = makeLayer({
      id: 'l1',
      name: 'A',
      compositeId: 'comp-1',
      compositeInputs: { h: 1.333 },
    });
    const layer2 = makeLayer({
      id: 'l2',
      name: 'B',
      compositeId: 'comp-1',
      compositeInputs: { h: 0.667 },
    });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map([
        ['comp-1', [makeComponent({ quantityPerUnit: 1, formula: 'h * 100' })]],
      ]),
      layers: [layer1, layer2],
      measurements: [],
      manualInputs: {},
      laborTradeById: new Map(),
    });
    expect(result.sections.length).toBe(2);
    const sA = result.sections.find((s) => s.bomName.includes('A'))!;
    const sB = result.sections.find((s) => s.bomName.includes('B'))!;
    expect(sA.lines[0].quantity).toBeCloseTo(133.3, 1);
    expect(sB.lines[0].quantity).toBeCloseTo(66.7, 1);
  });

  // ─── Edge cases ajoutes (audit QA) ────────────────────────────────

  it('handles laborTradeId null gracefully (no trade lookup)', () => {
    const composite = makeComposite({
      id: 'comp-1',
      name: 'Test',
      laborTradeId: null,
    });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map([['comp-1', [makeComponent()]]]),
      layers: [],
      measurements: [],
      manualInputs: {},
      laborTradeById: new Map(),
    });
    expect(result.sections[0].hourlyRate).toBeNull();
    expect(result.sections[0].laborTradeName).toBeNull();
  });

  it('handles laborTradeId present but not in catalog map', () => {
    // Cas reel : un trade a ete supprime ou n'a pas ete charge cote client.
    const composite = makeComposite({
      id: 'comp-1',
      name: 'Test',
      laborTradeId: 'ccq-fantome',
    });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map([['comp-1', [makeComponent()]]]),
      layers: [],
      measurements: [],
      manualInputs: {},
      laborTradeById: new Map(), // catalogue vide
    });
    expect(result.sections[0].hourlyRate).toBeNull();
    expect(result.sections[0].laborTradeName).toBeNull();
  });

  it('extracts sheet "Autres" when BOM name has no trailing parens', () => {
    const composite = makeComposite({
      id: 'comp-1',
      name: 'Mon assemblage custom sans suffixe',
    });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map([['comp-1', [makeComponent()]]]),
      layers: [],
      measurements: [],
      manualInputs: {},
      laborTradeById: new Map(),
    });
    expect(result.sections[0].sheet).toBe('Autres');
  });

  it('uses effectiveInputs over manualInputs when provided (legacy scope)', () => {
    // Le panel pre-calcule des inputs globaux via auto-derived; le caller
    // passe effectiveInputs pour court-circuiter la duplication de logique.
    const composite = makeComposite({
      id: 'comp-1',
      name: 'Test',
      bomInputs: [makeInput('h', 'pi', 0.5)],
    });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map([
        ['comp-1', [makeComponent({ quantityPerUnit: 1, formula: 'h * 10' })]],
      ]),
      layers: [],
      measurements: [],
      manualInputs: { h: 1 },
      effectiveInputs: { h: 5 }, // doit gagner
      laborTradeById: new Map(),
    });
    expect(result.sections[0].lines[0].quantity).toBe(50);
  });

  it('sorts sections deterministically when numeroSection identique', () => {
    // sortSections tombe sur sheet order puis bomName (alpha) quand
    // numeroSection est egal. Test deterministique.
    const c1 = makeComposite({
      id: 'c1',
      name: '02. (P) Zebra',
      numeroSection: '5',
    });
    const c2 = makeComposite({
      id: 'c2',
      name: '02. (P) Alpha',
      numeroSection: '5',
    });
    const result = computeBomSectionsForState({
      composites: [c1, c2],
      selectedIds: new Set(['c1', 'c2']),
      componentsByBom: new Map([
        ['c1', [makeComponent({ childProductId: 'p1' })]],
        ['c2', [makeComponent({ childProductId: 'p2' })]],
      ]),
      layers: [],
      measurements: [],
      manualInputs: {},
      laborTradeById: new Map(),
    });
    expect(result.sections.length).toBe(2);
    // Alpha < Zebra (localeCompare ascending) -> c2 first
    expect(result.sections[0].bomName).toBe('02. (P) Alpha');
    expect(result.sections[1].bomName).toBe('02. (P) Zebra');
  });

  it('produces N x M sections when N composites × M linked layers', () => {
    // Verifie le produit cartesien : 2 composites x 2 calques = 4 sections.
    const c1 = makeComposite({ id: 'c1', name: 'C1' });
    const c2 = makeComposite({ id: 'c2', name: 'C2' });
    const l1 = makeLayer({ id: 'l1', name: 'Maison', compositeId: 'c1' });
    const l2 = makeLayer({ id: 'l2', name: 'Garage', compositeId: 'c1' });
    const l3 = makeLayer({ id: 'l3', name: 'Maison', compositeId: 'c2' });
    const l4 = makeLayer({ id: 'l4', name: 'Garage', compositeId: 'c2' });
    const result = computeBomSectionsForState({
      composites: [c1, c2],
      selectedIds: new Set(['c1', 'c2']),
      componentsByBom: new Map([
        ['c1', [makeComponent({ childProductId: 'p1' })]],
        ['c2', [makeComponent({ childProductId: 'p2' })]],
      ]),
      layers: [l1, l2, l3, l4],
      measurements: [],
      manualInputs: {},
      laborTradeById: new Map(),
    });
    expect(result.sections.length).toBe(4);
  });

  it('propagates NaN through cumul (caller filter responsibility)', () => {
    // Une formule echouee (NaN) est inseree dans la section, puis le cumul
    // doit la coercer a 0 (buildCumulFromSections ligne 169). Verifie aussi
    // que hasError est propage.
    const composite = makeComposite({
      id: 'comp-1',
      name: 'Test',
      bomInputs: [makeInput('h', 'pi', 1)],
    });
    const result = computeBomSectionsForState({
      composites: [composite],
      selectedIds: new Set(['comp-1']),
      componentsByBom: new Map([
        ['comp-1', [makeComponent({ formula: 'h / 0' })]],
      ]),
      layers: [],
      measurements: [],
      manualInputs: { h: 5 },
      laborTradeById: new Map(),
    });
    expect(Number.isFinite(result.sections[0].lines[0].quantity)).toBe(false);
    expect(result.cumul[0].totalQuantity).toBe(0);
    expect(result.cumul[0].hasError).toBe(true);
  });
});

// ─── autoSelectActiveComposites ───────────────────────────────────────

describe('autoSelectActiveComposites', () => {
  it('returns empty set when nothing matches', () => {
    const composites = [makeComposite({ id: 'c1', name: 'C1', bomInputs: [] })];
    const ids = autoSelectActiveComposites(composites, [], [], new Map());
    expect(ids.size).toBe(0);
  });

  it('always includes composites linked via layer.compositeId', () => {
    // Priorite absolue : meme sans mesure, le composite est inclus.
    const composites = [makeComposite({ id: 'c1', name: 'C1', bomInputs: [] })];
    const layers = [makeLayer({ id: 'l1', compositeId: 'c1' })];
    const ids = autoSelectActiveComposites(composites, layers, [], new Map());
    expect(ids.has('c1')).toBe(true);
  });

  it('matches via real formula variables when components loaded (precise)', () => {
    // Le composite declare 3 inputs mais une seule (perimetre_ss) est
    // utilisee dans la formule. Une mesure "perimetre_ss" doit suffire.
    const composite = makeComposite({
      id: 'c1',
      bomInputs: [
        makeInput('perimetre_ss'),
        makeInput('surface_rc'),
        makeInput('hauteur_mur'),
      ],
    });
    const components = [makeComponent({ formula: 'perimetre_ss * 0.25 + 3' })];
    const measurements = [
      makeMeasurement({ label: 'perimetre_ss', value: 100 }),
    ];
    const ids = autoSelectActiveComposites(
      [composite],
      [],
      measurements,
      new Map([['c1', components]]),
    );
    expect(ids.has('c1')).toBe(true);
  });

  it('does NOT match when measurement label matches an unused bom_input', () => {
    // Round 5 fix C1 : si surface_rc est dans bom_inputs mais n'est PAS
    // utilise dans une formule, alors une mesure "surface_rc" ne doit
    // PAS activer ce composite (le panel n'affiche rien d'utile).
    const composite = makeComposite({
      id: 'c1',
      bomInputs: [makeInput('perimetre_ss'), makeInput('surface_rc')],
    });
    const components = [makeComponent({ formula: 'perimetre_ss * 0.25' })];
    const measurements = [
      makeMeasurement({ label: 'surface_rc', value: 100 }),
    ];
    const ids = autoSelectActiveComposites(
      [composite],
      [],
      measurements,
      new Map([['c1', components]]),
    );
    expect(ids.has('c1')).toBe(false);
  });

  it('falls back to bom_inputs broad match when components not loaded', () => {
    // Phase 1 du handleOpenSoumissionBom : componentsByBom vide -> on
    // n'a pas encore fetch les components, donc fallback bom_inputs.
    const composite = makeComposite({
      id: 'c1',
      bomInputs: [makeInput('perimetre_ss')],
    });
    const measurements = [
      makeMeasurement({ label: 'perimetre_ss', value: 100 }),
    ];
    const ids = autoSelectActiveComposites(
      [composite],
      [],
      measurements,
      new Map(), // pas de components charges
    );
    expect(ids.has('c1')).toBe(true);
  });

  it('matches _nb_points variable on base label of measurement', () => {
    // Mario trace "perimetre" (label) -> auto-derived "perimetre_nb_points"
    // utilise dans formule. Doit activer.
    const composite = makeComposite({
      id: 'c1',
      bomInputs: [makeInput('perimetre' + NB_POINTS_SUFFIX)],
    });
    const components = [
      makeComponent({ formula: 'perimetre' + NB_POINTS_SUFFIX + ' * 1' }),
    ];
    const measurements = [makeMeasurement({ label: 'perimetre', value: 100 })];
    const ids = autoSelectActiveComposites(
      [composite],
      [],
      measurements,
      new Map([['c1', components]]),
    );
    expect(ids.has('c1')).toBe(true);
  });

  it('returns orphan layer.compositeId not in composites array', () => {
    // BUG POTENTIEL DOCUMENTE : si un calque pointe vers un composite
    // supprime, l'id est inclus dans le retour. C'est au caller de
    // filtrer via composites.filter(c => activeIds.has(c.id)).
    const composites: any[] = []; // composite supprime
    const layers = [makeLayer({ id: 'l1', compositeId: 'ghost' })];
    const ids = autoSelectActiveComposites(composites, layers, [], new Map());
    expect(ids.has('ghost')).toBe(true);
    // Le caller (computeBomSectionsForState) filtre via le `for (const bom
    // of composites)` loop -> ghost n'apparaitra pas dans les sections.
  });

  it('ignores empty labels in measurements', () => {
    const composite = makeComposite({
      id: 'c1',
      bomInputs: [makeInput('perimetre_ss')],
    });
    const measurements = [
      makeMeasurement({ label: '', value: 100 }),
      makeMeasurement({ label: '   ', value: 50 }),
    ];
    const ids = autoSelectActiveComposites(
      [composite],
      [],
      measurements,
      new Map(),
    );
    expect(ids.has('c1')).toBe(false);
  });

  it('trims whitespace from measurement labels for matching', () => {
    const composite = makeComposite({
      id: 'c1',
      bomInputs: [makeInput('perimetre_ss')],
    });
    const measurements = [
      makeMeasurement({ label: '  perimetre_ss  ', value: 100 }),
    ];
    const ids = autoSelectActiveComposites(
      [composite],
      [],
      measurements,
      new Map(),
    );
    expect(ids.has('c1')).toBe(true);
  });

  it('does not match composite with empty bom_inputs and no components', () => {
    const composite = makeComposite({ id: 'c1', bomInputs: [] });
    const measurements = [makeMeasurement({ label: 'foo', value: 100 })];
    const ids = autoSelectActiveComposites(
      [composite],
      [],
      measurements,
      new Map(),
    );
    expect(ids.has('c1')).toBe(false);
  });

  it('handles components array with formula=null (no real vars)', () => {
    // Un composite avec seulement des qpu fixes (sans formula) ne devrait
    // jamais s'auto-selectionner via mesures (rien a parametrer).
    const composite = makeComposite({
      id: 'c1',
      bomInputs: [makeInput('perimetre_ss')],
    });
    const components = [
      makeComponent({ formula: null, quantityPerUnit: 5 }),
    ];
    const measurements = [
      makeMeasurement({ label: 'perimetre_ss', value: 100 }),
    ];
    const ids = autoSelectActiveComposites(
      [composite],
      [],
      measurements,
      new Map([['c1', components]]),
    );
    // realVars is empty -> no match. Composite doit etre EXCLU.
    expect(ids.has('c1')).toBe(false);
  });

  it('layer compositeId priority overrides absence of matching variable', () => {
    // Meme si components charges et aucune var ne matche, layer.compositeId
    // force l'inclusion (intention explicite utilisateur).
    const composite = makeComposite({
      id: 'c1',
      bomInputs: [makeInput('perimetre_ss')],
    });
    const components = [makeComponent({ formula: 'perimetre_ss * 1' })];
    const layers = [makeLayer({ id: 'l1', compositeId: 'c1' })];
    const ids = autoSelectActiveComposites(
      [composite],
      layers,
      [], // aucune mesure
      new Map([['c1', components]]),
    );
    expect(ids.has('c1')).toBe(true);
  });
});
