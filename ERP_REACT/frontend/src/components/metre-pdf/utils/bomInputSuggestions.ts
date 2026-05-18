/**
 * Build a grouped, deduplicated list of BOM input suggestions for the
 * measurement label combobox. Reads `bomInputs` from every composite product
 * in the catalog and groups them by sheet (extracted from the parent BOM
 * name suffix `(...)`).
 *
 * Each input is reported once even when used by multiple BOMs of the same
 * sheet (deduplication by name+sheet). Cross-sheet usage shows the input
 * under each sheet where it is declared.
 */
import type { Product, BomInputDef } from '../types';
import { extractMarioSectionOrder } from './bomAggregation';

export interface BomInputSuggestion {
  name: string;
  unit: string;
  description: string;
}

export interface BomSuggestionGroup {
  sheet: string;
  inputs: BomInputSuggestion[];
}

const SHEET_ORDER = [
  'Sous-Sol',
  'Rez-de-chaussee',
  'Etage',
  'Finition',
  'Patio',
  'Toiture',
  'Garage',
  'Plancher',
];

/**
 * Extract the sheet name from a BOM parent product name.
 *
 * Supports two naming conventions:
 *
 * 1. **Excel-seeded**: `'Fondation (Sous-Sol)'` or `'Beton (L21, Sous-Sol)'`
 *    (the latter is the collision-disambiguated form with a row prefix).
 *    Trailing `(Sheet)` extracted, optional `Lxx,` prefix stripped.
 *
 * 2. **User custom (Mario form)**: `'Section 1 - Fondation mur'`,
 *    `'Section 9b - Coffrage galerie 18\'x16\''`, `'Section ? - Non identifiee'`.
 *    These don't have a trailing `(Sheet)` so we group them under
 *    `"Mes assemblages"` (matches the label used in the BOM live panel —
 *    cf. `bomAggregation.ts:extractSheetFromBomName`).
 *
 * Returns `null` if neither convention matches, which signals the caller
 * to drop this product from the suggestion list.
 */
function extractSheetFromName(name: string): string | null {
  // User custom convention `Section Xx - Description` (or `Section ? - ...`).
  // Return the full section name as the group label, so each section becomes
  // its own sub-group in the combobox. Otherwise 49+ variables would be
  // crammed into a single "Mes assemblages" group, making it hard for the
  // user to know which variable belongs to which section.
  // Sample output: "Section 1 - Fondation mur", "Section 7 - Bardeaux toiture".
  if (/^Section\s+([0-9]+[a-zA-Z]*|\?)(\s|-|$)/i.test(name)) {
    return name.trim();
  }
  // Excel-seeded convention `... (Sheet)`
  const m = name.match(/\(([^)]+)\)\s*$/);
  if (!m) return null;
  // Strip leading "Lxx, " if present (collision-disambiguated names)
  return m[1].replace(/^L\d+,\s*/, '').trim();
}

export function buildBomLabelSuggestions(products: Product[]): BomSuggestionGroup[] {
  const seen = new Set<string>();  // dedupe key = `${sheet}::${name}`
  const grouped = new Map<string, BomInputSuggestion[]>();

  for (const p of products) {
    if (!p.isComposite) continue;
    const inputs = p.bomInputs;
    if (!Array.isArray(inputs) || inputs.length === 0) continue;
    const sheet = extractSheetFromName(p.name);
    if (!sheet) continue;

    for (const raw of inputs) {
      // Backend may return either snake_case or camelCase keys depending on
      // the route; normalize defensively.
      const input = raw as BomInputDef & Record<string, unknown>;
      const name = (input.name as string) ?? '';
      if (!name) continue;
      // Skip auto-derived variables (`<base>_nb_points`) — Mario should
      // label measurements with the BASE name only; the system fills the
      // `_nb_points` companion automatically from `points.length`. Surfacing
      // these in the dropdown would invite mislabeling.
      if (name.endsWith('_nb_points')) continue;
      const key = `${sheet}::${name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const list = grouped.get(sheet) ?? [];
      list.push({
        name,
        unit: (input.unit as string) ?? '',
        description: (input.description as string) ?? '',
      });
      grouped.set(sheet, list);
    }
  }

  const groups: BomSuggestionGroup[] = [];
  for (const [sheet, inputs] of grouped) {
    inputs.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ sheet, inputs });
  }

  // Sort: user "Section Xx" first (chronological chantier order via
  // extractMarioSectionOrder: 0a, 0b, 1, 2, 7, 9b, 10, 10pg, ...), then known
  // Excel sheets in domain order, then any unknown sheet alphabetically.
  groups.sort((a, b) => {
    const oa = extractMarioSectionOrder(a.sheet);
    const ob = extractMarioSectionOrder(b.sheet);
    if (oa && ob) {
      // Both are "Section Xx" — chronological order.
      if (oa[0] !== ob[0]) return oa[0] - ob[0];
      return oa[1].localeCompare(ob[1]);
    }
    if (oa && !ob) return -1; // Mario sections always before Excel sheets
    if (!oa && ob) return 1;
    // Neither is a Mario section -- fallback to original Excel sheet order.
    const ai = SHEET_ORDER.indexOf(a.sheet);
    const bi = SHEET_ORDER.indexOf(b.sheet);
    if (ai === -1 && bi === -1) return a.sheet.localeCompare(b.sheet);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return groups;
}
