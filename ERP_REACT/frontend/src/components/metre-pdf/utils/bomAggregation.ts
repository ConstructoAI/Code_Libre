/**
 * Multi-BOM aggregation logic for the BomEstimationPanel.
 *
 * Given a set of selected BOMs (each with their exploded lines computed
 * by the formula evaluator), produces:
 *
 * - The detailed view (one section per BOM, lines as-is)
 * - The cumulated view (one line per unique child product, summed across
 *   all selected BOMs, sorted by category then name)
 *
 * The cumulated view is what gets sent to the supplier. The detailed
 * view is for traceability ("which BOM consumed which materials").
 */

export interface ExplodedLine {
  componentId: string;
  childProductId: string;
  childName: string;
  childCategory: string;
  childPriceUnit: string;
  /** Quantity per parent unit -- if formula failed, this is NaN */
  quantity: number;
  fromFormula: boolean;
  formula?: string | null;
  error: string | null;
}

export interface BomSection {
  bomId: string;
  bomName: string;
  /** The Excel sheet (Sous-Sol / Rez-de-chaussee / ...) extracted from the BOM name */
  sheet: string;
  lines: ExplodedLine[];
  /**
   * Labour-time fields propagated from the parent composite. Used by
   * formatCSVEstimationExport to produce the per-section header row.
   */
  numeroSection?: string | null;
  nbHommes?: number | null;
  nbHrsParJour?: number | null;
  nbJours?: number | null;
  /**
   * Hourly rate resolved client-side from the LaborCatalog using the
   * parent's labor_trade_id. Null when the BOM has no trade assigned.
   */
  hourlyRate?: number | null;
  /** Trade name resolved client-side, for human-readable display. */
  laborTradeName?: string | null;
}

export interface CumulLine {
  childProductId: string;
  childName: string;
  childCategory: string;
  childPriceUnit: string;
  /** Sum of quantity over all source BOMs (NaN inputs treated as 0) */
  totalQuantity: number;
  /** Names of BOMs that contributed to this cumul -- for traceability */
  sources: string[];
  /** True if at least one source line had an evaluation error */
  hasError: boolean;
}

export interface AggregateResult {
  sections: BomSection[];
  cumul: CumulLine[];
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
 * Extract the sheet name suffix `(Sheet)` from a BOM parent name. Supports:
 * - The Excel-seeder collision-disambiguated form `(Lxx, Sheet)` -> Sheet
 * - The custom user form `Section Xx - Description` -> "Mes assemblages"
 *   (chronologie chantier 0a, 0b, 0c, 1, 2, 4, 7-17 du formulaire papier)
 * - Fallback: any trailing parenthesized text -> that text
 * - Default: "Autres"
 *
 * Note: the label "Mes assemblages" is intentionally user-friendly (vs the
 * developer-internal "BOM Mario" used in earlier iterations). The string
 * is also referenced in BomEstimationPanel.tsx:sheetOrderIndex — keep them
 * in sync if you rename it.
 */
export function extractSheetFromBomName(name: string): string {
  // User's custom BOMs follow `Section Xx - Description` (sometimes with
  // parens at the end like `Section 14 - Gyproc (RDC + Garage + Sous-sol)`).
  // Detect the `Section Xx` prefix FIRST so a trailing parenthesis doesn't
  // mis-classify them under a chaotic sub-group. Also handle the special
  // "Section ? - Non identifiee" name (pages manquantes) so it lands in the
  // same group instead of falling through to "Autres".
  if (/^Section\s+([0-9]+[a-zA-Z]*|\?)(\s|-|$)/i.test(name)) {
    return 'Mes assemblages';
  }
  const m = name.match(/\(([^)]+)\)\s*$/);
  if (!m) return 'Autres';
  return m[1].replace(/^L\d+,\s*/, '').trim();
}

/**
 * Extract the section number from a Mario BOM name. Returns a sortable
 * tuple [primaryNum, suffix] so `Section 9b` sorts after `Section 9` but
 * before `Section 10`. Returns `null` for non-Mario BOMs.
 *
 * Examples:
 *   "Section 0a - ..." -> [0, 'a']
 *   "Section 1 - ..."  -> [1, '']
 *   "Section 10pg - ..." -> [10, 'pg']
 *   "Section ? - ..."  -> [Infinity, '?'] (unknown section, sort last)
 *   "Excel BOM (Sheet)" -> null
 */
export function extractMarioSectionOrder(name: string): [number, string] | null {
  // Match `Section ?` first (special case for unidentified pages).
  if (/^Section\s+\?/.test(name)) return [Number.POSITIVE_INFINITY, '?'];
  const m = name.match(/^Section\s+([0-9]+)([a-zA-Z]*)/i);
  if (!m) return null;
  return [parseInt(m[1], 10), (m[2] || '').toLowerCase()];
}

function sheetOrder(sheet: string): number {
  const i = SHEET_ORDER.indexOf(sheet);
  return i === -1 ? 99 : i;
}

/**
 * Sort BOM sections. When BOMs have a `numeroSection` (the canonical
 * sequence used in the estimation TSV, e.g. 1-31 for the residential
 * template), sort by that ascending. Fall back to sheet order + name
 * for BOMs without a numero (legacy or custom BOMs).
 */
export function sortSections(sections: BomSection[]): BomSection[] {
  const parseNum = (s: string | null | undefined): number => {
    if (s == null) return Number.POSITIVE_INFINITY;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
  };
  return [...sections].sort((a, b) => {
    const an = parseNum(a.numeroSection);
    const bn = parseNum(b.numeroSection);
    if (an !== bn) return an - bn;
    const so = sheetOrder(a.sheet) - sheetOrder(b.sheet);
    if (so !== 0) return so;
    return a.bomName.localeCompare(b.bomName);
  });
}

/**
 * Build the cumulated view: group all section lines by child_product_id,
 * sum quantities (NaN -> 0), and sort by childCategory then childName.
 *
 * The `sources` array preserves the order BOMs appeared in the input,
 * deduplicated -- useful for telling the user "this product is used in 3 BOMs".
 */
export function buildCumulFromSections(sections: BomSection[]): CumulLine[] {
  const byProduct = new Map<string, CumulLine>();

  for (const section of sections) {
    for (const line of section.lines) {
      const key = String(line.childProductId);
      const existing = byProduct.get(key);
      const safeQty = Number.isFinite(line.quantity) ? line.quantity : 0;
      const lineHasError = !!line.error || !Number.isFinite(line.quantity);

      if (existing) {
        existing.totalQuantity += safeQty;
        if (!existing.sources.includes(section.bomName)) {
          existing.sources.push(section.bomName);
        }
        if (lineHasError) existing.hasError = true;
      } else {
        byProduct.set(key, {
          childProductId: line.childProductId,
          childName: line.childName,
          childCategory: line.childCategory,
          childPriceUnit: line.childPriceUnit,
          totalQuantity: safeQty,
          sources: [section.bomName],
          hasError: lineHasError,
        });
      }
    }
  }

  // Sort: category alpha, then product name alpha
  return Array.from(byProduct.values()).sort((a, b) => {
    const cmpCat = (a.childCategory || '').localeCompare(b.childCategory || '');
    if (cmpCat !== 0) return cmpCat;
    return a.childName.localeCompare(b.childName);
  });
}

/**
 * Top-level entry: takes a list of pre-built sections (each with its
 * exploded lines) and returns the sorted detailed sections + the cumul.
 *
 * Pure function -- no I/O, no side effects, fully memoizable upstream.
 */
export function aggregateBoms(rawSections: BomSection[]): AggregateResult {
  const sections = sortSections(rawSections);
  const cumul = buildCumulFromSections(sections);
  return { sections, cumul };
}

/**
 * RFC 4180 CSV value escaping. Wraps a cell in double-quotes when it
 * contains the separator, a quote, or a newline; doubles up internal
 * quotes per spec.
 */
function csvEscape(value: string | number, separator = ','): string {
  const s = String(value);
  if (
    s.includes(separator) ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r')
  ) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Format an estimation report as RFC 4180 CSV (comma separator, CRLF
 * line terminator). Prefixes the file with `sep=,\r\n` so Excel can
 * auto-detect the separator regardless of the user's locale (Quebec
 * Excel uses `;` natively, but `sep=,` overrides that).
 *
 * Column layout matches the user's Excel estimation template:
 *   # | Section | Produit | Qt | # homme | # hrs | # jours | total/hrs | Cout
 */
export function formatCSVEstimationExport(result: AggregateResult): string {
  const lines: string[] = [];
  // Excel hint: use comma as separator regardless of locale settings.
  lines.push('sep=,');
  lines.push(
    ['#', 'Section', 'Produit', 'Qt', '# homme', '# hrs', '# jours', 'total/hrs', 'Cout']
      .map((c) => csvEscape(c))
      .join(','),
  );

  let grandTotalHrs = 0;
  let grandTotalCost = 0;

  for (const section of result.sections) {
    const nbH = Number(section.nbHommes ?? 0);
    const nbHrs = Number(section.nbHrsParJour ?? 0);
    const nbJ = Number(section.nbJours ?? 0);
    const totalHrs = nbH * nbHrs * nbJ;
    const rate = Number(section.hourlyRate ?? 0);
    const cost = totalHrs * rate;
    grandTotalHrs += totalHrs;
    grandTotalCost += cost;

    const num = section.numeroSection ?? '';
    const tradeSuffix = section.laborTradeName
      ? ` [${section.laborTradeName}]`
      : '';
    lines.push(
      [
        num,
        section.bomName + tradeSuffix,
        '',
        '',
        nbH > 0 ? String(nbH) : '',
        nbHrs > 0 ? String(nbHrs) : '',
        nbJ > 0 ? String(nbJ) : '',
        totalHrs > 0 ? totalHrs.toFixed(1) : '',
        cost > 0 ? cost.toFixed(2) + ' $' : '',
      ]
        .map((c) => csvEscape(c))
        .join(','),
    );

    for (const l of section.lines) {
      // CSV Estimation : exclure les produits a 0 ou en erreur (NaN).
      // L'objectif est de fournir une liste de commande directement actionnable
      // sans les composants conditionnels (IF type_bois/longueur_mur) qui resolvent
      // a 0 selon les parametres du chantier.
      if (!Number.isFinite(l.quantity) || l.quantity === 0) continue;
      const qty = l.quantity.toFixed(2);
      lines.push(
        ['', '', l.childName, `${qty} ${l.childPriceUnit}`, '', '', '', '', '']
          .map((c) => csvEscape(c))
          .join(','),
      );
    }
  }

  lines.push('');
  lines.push(
    [
      '',
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      grandTotalHrs.toFixed(1),
      grandTotalCost > 0 ? grandTotalCost.toFixed(2) + ' $' : '',
    ]
      .map((c) => csvEscape(c))
      .join(','),
  );

  // Excel + Windows convention: CRLF line terminator
  return lines.join('\r\n');
}

/**
 * Format the dual-block CSV export (detail + cumul) for supplier orders.
 * Two blocks: per-BOM detail then a category-sorted cumul across all BOMs.
 */
export function formatCSVExport(result: AggregateResult): string {
  const lines: string[] = [];
  lines.push('sep=,');
  lines.push('=== DETAILLE PAR BOM ===');
  for (const section of result.sections) {
    lines.push('');
    lines.push(`### ${section.bomName}`);
    lines.push(['Quantite', 'Unite', 'Produit'].map((c) => csvEscape(c)).join(','));
    for (const l of section.lines) {
      const qty = Number.isFinite(l.quantity) ? l.quantity.toFixed(2) : 'ERR';
      lines.push(
        [qty, l.childPriceUnit, l.childName].map((c) => csvEscape(c)).join(','),
      );
    }
  }
  lines.push('');
  lines.push('=== CUMULE TOUS BOMs (trie par categorie) ===');
  lines.push(
    ['Quantite', 'Unite', 'Produit', 'Categorie', 'BOMs source']
      .map((c) => csvEscape(c))
      .join(','),
  );
  for (const c of result.cumul) {
    const qty = Number.isFinite(c.totalQuantity) ? c.totalQuantity.toFixed(2) : 'ERR';
    lines.push(
      [qty, c.childPriceUnit, c.childName, c.childCategory, c.sources.length]
        .map((v) => csvEscape(v))
        .join(','),
    );
  }
  return lines.join('\r\n');
}

