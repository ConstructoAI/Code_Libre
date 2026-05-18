import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMetreStore } from '../store';
import { PRICE_UNITS } from '../types';
import type { Product, ProductComponent, BomInputDef } from '../types';
import * as metreApi from '../api';
import { extractVariables } from '../utils/bomEvaluator';

/**
 * Standard unit options for BOM input variables. Empty string allowed for
 * dimensionless inputs (e.g. boolean toggles). The table-edit dropdown adds
 * a `__custom__` sentinel to preserve legacy non-standard values without
 * forcing the user to retype them — kept readonly until they switch to a
 * standard unit.
 */
const BOM_UNIT_OPTIONS: readonly string[] = ['pi', 'pi2', 'm', 'm2', 'u', 'bool', ''];

/**
 * Validate a BOM input variable name. Must match the backend regex
 * `^[a-z][a-z0-9_]*$` (snake_case, starts with a letter). Max 80 chars
 * to mirror the Pydantic constraint in `metre_pdf.py:BomInputDef`.
 */
const _BOM_INPUT_NAME_RE = /^[a-z][a-z0-9_]*$/;

function validateBomInputName(
  name: string,
  existingNames: string[],
): string | null {
  if (!name) return 'Le nom est requis';
  if (name.length > 80) return 'Maximum 80 caracteres';
  if (!_BOM_INPUT_NAME_RE.test(name)) {
    return 'Format invalide (snake_case, commence par lettre, ex: perimetre_fondation)';
  }
  // Case-insensitive dedup: a legacy entry like "Perimetre" stored uppercase
  // would otherwise allow a duplicate "perimetre" under the new constraint.
  const lower = name.toLowerCase();
  if (existingNames.some((n) => n.toLowerCase() === lower)) {
    return 'Ce nom existe deja';
  }
  return null;
}

/**
 * Parse a number string accepting both decimal point and Quebec comma (",").
 * `Number("3,14")` is NaN in JS by default. Mario uses a fr-CA keyboard so
 * "3,14" is the natural input.
 *
 * Strategy: strip ASCII spaces (typical thousand separator FR-CA) THEN if
 * exactly ONE comma remains, treat it as the decimal point. If multiple
 * commas remain, the input is ambiguous (thousand separator? mistyped?) →
 * return NaN so the caller surfaces a clear error.
 *
 * Examples:
 *   "3,14"       → 3.14
 *   "3.14"       → 3.14
 *   " 1 234,56 " → 1234.56  (FR-CA "12 345,67" with NBSP-or-space thousands)
 *   "1,234.56"   → NaN     (US format, 2 separators ambiguous here)
 *   "1.234,56"   → NaN     (EU format, mixed separators rejected)
 *   ""           → NaN
 */
function parseLocalizedNumber(s: string): number {
  // Strip ASCII space, NBSP (U+00A0) and narrow-no-break-space (U+202F) as
  // those are the visual thousand-separators used in fr-CA locale.
  const stripped = s.trim().replace(/[\s  ]/g, '');
  if (stripped === '') return NaN;
  const commaCount = (stripped.match(/,/g) ?? []).length;
  // No comma → standard JS parse
  if (commaCount === 0) return Number(stripped);
  // Single comma + no dot → comma is the decimal separator
  if (commaCount === 1 && !stripped.includes('.')) {
    return Number(stripped.replace(',', '.'));
  }
  // Anything else (multi-comma, dot+comma) is ambiguous → reject
  return NaN;
}

/**
 * CompositeEditor -- manages the sub-products (BOM) of a composite product.
 *
 * Opens as a modal over the ProductCatalog. Lets the user:
 * - Add child products with `quantityPerUnit` (how many child per 1 parent unit)
 * - Edit / delete existing components
 * - Toggle `displayMode` (detailed = N lines / summary = 1 line in soumission)
 * - Override the auto-computed unit price
 *
 * All mutations go straight to the backend via metreApi.* and the local store
 * is refreshed after each change so the catalog list reflects the new state.
 */

interface Props {
  productId: string;
  onClose: () => void;
}

export default function CompositeEditor({ productId, onClose }: Props) {
  const allProducts = useMetreStore((s) => s.products);
  const updateProduct = useMetreStore((s) => s.updateProduct);
  const refreshProduct = useMetreStore((s) => s.refreshProduct);

  const parent = useMemo<Product | undefined>(
    () => allProducts.find((p) => p.id === productId),
    [allProducts, productId],
  );

  // Non-composite products eligible to be added as children (1-level nesting only)
  const eligibleChildren = useMemo(
    () => allProducts.filter((p) => !p.isComposite && p.id !== productId),
    [allProducts, productId],
  );

  const [components, setComponents] = useState<ProductComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Add-row state ---
  const [newChildId, setNewChildId] = useState<string>('');
  const [newQty, setNewQty] = useState<number>(1);
  const [newFormula, setNewFormula] = useState<string>('');
  const [newNotes, setNewNotes] = useState<string>('');

  // --- Parent-level options ---
  const [displayMode, setDisplayMode] = useState<'detailed' | 'summary'>(
    parent?.displayMode ?? 'detailed',
  );
  const [priceOverrideEnabled, setPriceOverrideEnabled] = useState<boolean>(
    parent?.priceOverride != null,
  );
  const [priceOverride, setPriceOverride] = useState<number>(
    parent?.priceOverride ?? 0,
  );

  // --- BOM inputs (parametric variables schema) ---
  // Mirrors `metre_products.bom_inputs` (JSONB). Saved via PUT /products/{id}.
  // Edits are local until the user clicks "Sauvegarder les variables" — keeps
  // the save explicit so a typo on `name` doesn't immediately invalidate every
  // formula that references the old name.
  //
  // Defensive: backend stores JSONB; if it ever returns a non-array (corrupted
  // tenant or schema migration glitch), `Array.isArray` keeps the UI alive
  // instead of crashing on `.map(i => i.name)` later. Same guard at sync.
  const parsedParentBomInputs = useMemo<BomInputDef[]>(() => {
    const raw = parent?.bomInputs;
    return Array.isArray(raw) ? (raw as BomInputDef[]) : [];
  }, [parent?.bomInputs]);

  const [bomInputs, setBomInputs] = useState<BomInputDef[]>(parsedParentBomInputs);
  const [savingBomInputs, setSavingBomInputs] = useState(false);
  const [bomInputsSavedNotice, setBomInputsSavedNotice] = useState(false);

  // Dirty flag: true once the user has edited bomInputs locally without saving.
  // Used to BLOCK the parent-sync useEffect below from clobbering in-progress
  // edits when refreshProduct/another-tab updates parent.bomInputs mid-edit.
  // Reset to false after a successful save (server is now the truth).
  const [bomInputsDirty, setBomInputsDirty] = useState(false);

  // Mounted ref: handleSaveBomInputs awaits 1-2 network round-trips. If the
  // user clicks "Fermer" during the save, the trailing setState calls would
  // hit an unmounted component (React warning + harmless leak). Guarded.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Track the saved-notice timer so chained saves don't accumulate timers
  // (Round 2 review CRIT-2). Cleared on re-save and on unmount.
  const savedNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (savedNoticeTimerRef.current !== null) {
        clearTimeout(savedNoticeTimerRef.current);
        savedNoticeTimerRef.current = null;
      }
    };
  }, []);

  // Sync local state when parent.bomInputs changes externally (e.g. another
  // tab edited the same product, or refreshProduct updated the store).
  // SKIP if the user has unsaved local edits (would silently destroy them).
  // SKIP during an in-flight save (refreshProduct triggers this hook itself).
  useEffect(() => {
    if (bomInputsDirty || savingBomInputs) return;
    setBomInputs(parsedParentBomInputs);
  }, [parsedParentBomInputs, bomInputsDirty, savingBomInputs]);

  // New input form state
  const [newInputName, setNewInputName] = useState('');
  const [newInputUnit, setNewInputUnit] = useState('pi');
  const [newInputDefault, setNewInputDefault] = useState<string>('');
  const [newInputDescription, setNewInputDescription] = useState('');
  const [newInputError, setNewInputError] = useState<string | null>(null);

  // Live mirror of referencedVarsByFormulas useMemo. Read by handleRemoveBomInput
  // (declared before the useMemo for hoisting reasons — circular dep otherwise).
  // Synced via the useEffect right after the useMemo declaration, line ~370.
  const referencedVarsByFormulasRef = useRef<Set<string>>(new Set());

  // Load components from the backend on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    metreApi
      .listProductComponents(productId)
      .then((rows) => {
        if (cancelled) return;
        const mapped = (rows as unknown as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          parentProductId: String(r.parentProductId),
          childProductId: String(r.childProductId),
          quantityPerUnit: (r.quantityPerUnit as number) ?? 1,
          formula: (r.formula as string | null) ?? null,
          notes: (r.notes as string) ?? undefined,
          sortOrder: (r.sortOrder as number) ?? 0,
          childName: (r.childName as string) ?? undefined,
          childCategory: (r.childCategory as string) ?? undefined,
          childPrice: (r.childPrice as number) ?? undefined,
          childPriceUnit: (r.childPriceUnit as string) ?? undefined,
          childWastePct: (r.childWastePct as number) ?? undefined,
          childColor: (r.childColor as string) ?? undefined,
        }));
        setComponents(mapped);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur de chargement');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // --- Price computation ---
  const autoUnitPrice = useMemo(() => {
    return components.reduce((sum, c) => {
      const childWaste = (c.childWastePct ?? 0) / 100;
      const childPrice = c.childPrice ?? 0;
      return sum + childPrice * c.quantityPerUnit * (1 + childWaste);
    }, 0);
  }, [components]);

  const effectiveUnitPrice = priceOverrideEnabled ? priceOverride : autoUnitPrice;

  // --- Handlers ---
  const handleAddChild = useCallback(async () => {
    if (!newChildId) return;
    try {
      setError(null);
      const childIdNum = parseInt(newChildId, 10);
      if (Number.isNaN(childIdNum)) {
        setError('ID produit enfant invalide (doit etre numerique -- composites non supportes)');
        return;
      }
      await metreApi.addProductComponent(productId, {
        childProductId: childIdNum,
        quantityPerUnit: newQty,
        formula: newFormula.trim() || undefined,
        notes: newNotes || undefined,
        sortOrder: components.length,
      });
      // Refetch components -- keep this mapper IN SYNC with the one in useEffect
      // so the `formula` field (and other newly-added fields) propagates correctly.
      const rows = await metreApi.listProductComponents(productId);
      const mapped = (rows as unknown as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        parentProductId: String(r.parentProductId),
        childProductId: String(r.childProductId),
        quantityPerUnit: (r.quantityPerUnit as number) ?? 1,
        formula: (r.formula as string | null) ?? null,
        notes: (r.notes as string) ?? undefined,
        sortOrder: (r.sortOrder as number) ?? 0,
        childName: (r.childName as string) ?? undefined,
        childCategory: (r.childCategory as string) ?? undefined,
        childPrice: (r.childPrice as number) ?? undefined,
        childPriceUnit: (r.childPriceUnit as string) ?? undefined,
        childWastePct: (r.childWastePct as number) ?? undefined,
        childColor: (r.childColor as string) ?? undefined,
      }));
      setComponents(mapped);
      setNewChildId('');
      setNewQty(1);
      setNewFormula('');
      setNewNotes('');
      refreshProduct(productId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'ajout');
    }
  }, [productId, newChildId, newQty, newFormula, newNotes, components.length, refreshProduct]);

  // Stores the pre-edit value of a field so we can roll back on API error.
  // Captured on input focus (before any onChange mutation), then flushed on blur.
  const preEditValuesRef = useRef<Map<string, unknown>>(new Map());

  const handleUpdateComponent = useCallback(
    async (componentId: string, field: 'quantityPerUnit' | 'notes' | 'formula', value: number | string | null) => {
      const key = `${componentId}:${field}`;
      const oldValue = preEditValuesRef.current.get(key);
      // Cleanup the captured pre-edit value after we've read it.
      preEditValuesRef.current.delete(key);
      try {
        setError(null);
        await metreApi.updateProductComponent(productId, componentId, { [field]: value });
        setComponents((prev) =>
          prev.map((c) => (c.id === componentId ? { ...c, [field]: value } : c)),
        );
        refreshProduct(productId);
      } catch (err: unknown) {
        // Rollback to the captured pre-edit value (not the post-optimistic value)
        if (oldValue !== undefined) {
          setComponents((prev) =>
            prev.map((c) => (c.id === componentId ? { ...c, [field]: oldValue } : c)),
          );
        }
        setError(err instanceof Error ? err.message : 'Erreur de mise a jour -- modification annulee');
      }
    },
    [productId, refreshProduct],
  );

  /** Capture the current value of a field before the user starts editing it.
   *  Call from input.onFocus. */
  const capturePreEditValue = useCallback(
    (componentId: string, field: 'quantityPerUnit' | 'notes' | 'formula') => {
      const key = `${componentId}:${field}`;
      const current = components.find((c) => c.id === componentId);
      if (current) {
        preEditValuesRef.current.set(key, (current as unknown as Record<string, unknown>)[field]);
      }
    },
    [components],
  );

  const handleRemoveComponent = useCallback(
    async (componentId: string) => {
      try {
        setError(null);
        await metreApi.deleteProductComponent(productId, componentId);
        setComponents((prev) => prev.filter((c) => c.id !== componentId));
        refreshProduct(productId);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erreur de suppression');
      }
    },
    [productId, refreshProduct],
  );

  // --- BOM inputs handlers ---
  // Use a functional setter inside callbacks that need to read `bomInputs`
  // synchronously to avoid stale closure on rapid clicks (e.g. user clicking
  // "+" twice within one render frame).
  const handleAddBomInput = useCallback(() => {
    setNewInputError(null);
    const name = newInputName.trim().toLowerCase();
    const trimmedDescription = newInputDescription.trim();
    if (trimmedDescription.length > 255) {
      setNewInputError('Description trop longue (max 255 caracteres)');
      return;
    }
    let defaultValue: number | null = null;
    if (newInputDefault.trim() !== '') {
      const num = parseLocalizedNumber(newInputDefault);
      if (!Number.isFinite(num)) {
        setNewInputError('Default doit etre un nombre (utiliser . ou , decimal)');
        return;
      }
      defaultValue = num;
    }
    let validationError: string | null = null;
    setBomInputs((prev) => {
      // Validate against the freshest state to avoid stale-closure dupes.
      validationError = validateBomInputName(
        name,
        prev.map((i) => i.name),
      );
      if (validationError) return prev;
      const newInput: BomInputDef = {
        name,
        unit: newInputUnit.trim().slice(0, 20),
        default: defaultValue,
        description: trimmedDescription,
      };
      return [...prev, newInput];
    });
    if (validationError) {
      setNewInputError(validationError);
      return;
    }
    setBomInputsDirty(true);
    setBomInputsSavedNotice(false);
    // Reset name + default + description but KEEP `unit` sticky — Mario often
    // adds several variables of the same unit in a row (e.g. surface_X for an
    // isolation BOM). Less friction than re-selecting `pi2` every time.
    setNewInputName('');
    setNewInputDefault('');
    setNewInputDescription('');
  }, [newInputName, newInputUnit, newInputDefault, newInputDescription]);

  const handleRemoveBomInput = useCallback(
    (name: string) => {
      // Confirm if the variable is still referenced by a formula — silent
      // delete would break those formulas (silent ERR at evaluation).
      const referenced = referencedVarsByFormulasRef.current.has(name);
      if (referenced) {
        const ok = window.confirm(
          `La variable "${name}" est referencee par au moins une formule de ce BOM. ` +
            `La supprimer va casser ces formules (elles retourneront ERR a l'evaluation). ` +
            `Continuer ?`,
        );
        if (!ok) return;
      }
      setBomInputs((prev) => prev.filter((i) => i.name !== name));
      setBomInputsDirty(true);
      setBomInputsSavedNotice(false);
    },
    [],
  );

  const handleUpdateBomInputField = useCallback(
    (name: string, field: 'unit' | 'default' | 'description', value: string) => {
      setBomInputs((prev) =>
        prev.map((i) => {
          if (i.name !== name) return i;
          if (field === 'default') {
            // Allow clearing (empty -> null). Reject non-numeric (keep prev).
            // Accepts both decimal point and Quebec comma via parseLocalizedNumber.
            if (value.trim() === '') return { ...i, default: null };
            const num = parseLocalizedNumber(value);
            return Number.isFinite(num) ? { ...i, default: num } : i;
          }
          const maxLen = field === 'unit' ? 20 : 255;
          return { ...i, [field]: value.slice(0, maxLen) };
        }),
      );
      setBomInputsDirty(true);
      setBomInputsSavedNotice(false);
    },
    [],
  );

  const handleSaveBomInputs = useCallback(async () => {
    if (!isMountedRef.current) return;
    setSavingBomInputs(true);
    setError(null);
    setBomInputsSavedNotice(false);
    // Snapshot what we actually send so post-save reconciliation compares
    // against the in-flight payload (not a state that may have been edited
    // mid-flight by another keypress — agent 3 race scenario #3).
    const payloadSnapshot = bomInputs;
    try {
      // PUT /products/{id} — accepted via metre_pdf.py:_validate_fields
      // (`bom_inputs` ∈ ALLOWED_PRODUCT_FIELDS_UPDATE, line 471-475).
      await metreApi.updateProductApi(
        productId,
        { bomInputs: payloadSnapshot } as unknown as Record<string, unknown>,
      );
      if (!isMountedRef.current) return;
      updateProduct(productId, { bomInputs: payloadSnapshot });
      // refreshProduct reloads from backend so the optimistic state is replaced
      // with what the server actually persisted (e.g. trimming applied server-side).
      await refreshProduct(productId);
      if (!isMountedRef.current) return;
      setBomInputsDirty(false);
      setBomInputsSavedNotice(true);
      // Clear any prior saved-notice timer to avoid concurrent timers when
      // chained saves happen quickly (Round 2 review CRIT-2).
      if (savedNoticeTimerRef.current !== null) {
        clearTimeout(savedNoticeTimerRef.current);
      }
      savedNoticeTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) setBomInputsSavedNotice(false);
        savedNoticeTimerRef.current = null;
      }, 3000);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      // Surface backend Pydantic detail when available (e.g. "name must
      // match pattern...") instead of the generic axios message.
      // Pydantic 422 returns `detail: [{loc, msg, type}, ...]` (array);
      // FastAPI HTTPException returns `detail: "..."` (string). Handle both.
      const axiosErr = err as { response?: { data?: { detail?: unknown } }; message?: string };
      const detail = axiosErr?.response?.data?.detail;
      if (typeof detail === 'string' && detail.length > 0) {
        setError(detail);
      } else if (Array.isArray(detail) && detail.length > 0) {
        // Pydantic ValidationError list: extract `msg` (and `loc` last segment
        // for context). Truncate to ~5 errors to keep the banner readable.
        const messages = (detail as Array<{ loc?: unknown[]; msg?: string }>)
          .slice(0, 5)
          .map((d) => {
            const loc = Array.isArray(d.loc) && d.loc.length > 0 ? String(d.loc[d.loc.length - 1]) : '';
            const msg = typeof d.msg === 'string' ? d.msg : 'invalide';
            return loc ? `${loc}: ${msg}` : msg;
          })
          .filter(Boolean);
        setError(messages.length > 0 ? messages.join(' ; ') : 'Erreur de validation');
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Erreur de sauvegarde des variables BOM',
        );
      }
    } finally {
      if (isMountedRef.current) setSavingBomInputs(false);
    }
  }, [productId, bomInputs, updateProduct, refreshProduct]);

  // Variables actually referenced by any of the components' formulas. Used
  // to flag declared-but-unused inputs (warning yellow chip) and to detect
  // formulas referencing variables that aren't declared yet (banner above
  // the add form).
  const referencedVarsByFormulas = useMemo<Set<string>>(() => {
    const vars = new Set<string>();
    for (const c of components) {
      if (c.formula) {
        for (const v of extractVariables(c.formula)) vars.add(v);
      }
    }
    return vars;
  }, [components]);

  // Mirror to ref so handleRemoveBomInput (declared earlier) can read the
  // live set without taking a closure on it (would force [referencedVarsByFormulas]
  // dep, which would re-create the callback on every formula edit).
  useEffect(() => {
    referencedVarsByFormulasRef.current = referencedVarsByFormulas;
  }, [referencedVarsByFormulas]);

  const undeclaredVars = useMemo<string[]>(() => {
    const declared = new Set(bomInputs.map((i) => i.name));
    return Array.from(referencedVarsByFormulas)
      .filter((v) => !declared.has(v))
      .sort();
  }, [referencedVarsByFormulas, bomInputs]);

  // Dirty-state derived from save-readiness: button enabled only when changes
  // exist OR the saved-notice is currently shown (so user sees the success
  // toast clearly). Compared via JSON stringify on the BomInputDef arrays —
  // small enough to be cheap (<200 entries typical) and order-sensitive on
  // purpose (reorder = different schema, future-proof for sortOrder).
  const bomInputsHasChanges = useMemo(
    () => JSON.stringify(bomInputs) !== JSON.stringify(parsedParentBomInputs),
    [bomInputs, parsedParentBomInputs],
  );

  const handleSaveParentOptions = useCallback(async () => {
    // Call the backend directly with await + try/catch so we can surface real errors.
    // Also propagate the new values to the Zustand store so the catalog reflects them.
    const payload = {
      displayMode,
      priceOverride: priceOverrideEnabled ? priceOverride : null,
    };
    try {
      setError(null);
      await metreApi.updateProductApi(productId, payload as unknown as Record<string, unknown>);
      // Update local store (optimistic; refreshProduct below would also work)
      updateProduct(productId, payload);
      await refreshProduct(productId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de sauvegarde des options');
    }
  }, [productId, displayMode, priceOverrideEnabled, priceOverride, updateProduct, refreshProduct]);

  const unitLabel = (val: string) => PRICE_UNITS.find((u) => u.value === val)?.label ?? val;

  if (!parent) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-metre-surface border border-metre-border rounded-xl shadow-2xl w-[760px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-metre-border">
          <div>
            <h2 className="text-base font-semibold text-metre-text">
              Composants -- {parent.name}
            </h2>
            <p className="text-xs text-metre-muted mt-0.5">
              Assemblage BOM ({components.length} sous-produit{components.length !== 1 ? 's' : ''})
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
          >
            Fermer
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-metre-muted text-center py-8">Chargement...</p>
          ) : (
            <>
              {/* Composite options */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted">
                  Options d'assemblage
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-metre-muted block mb-1">
                      Mode d'affichage dans la soumission
                    </label>
                    <select
                      className="input-field"
                      value={displayMode}
                      onChange={(e) => setDisplayMode(e.target.value as 'detailed' | 'summary')}
                    >
                      <option value="detailed">Détaillé (N lignes)</option>
                      <option value="summary">Résumé (1 ligne)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-metre-muted block mb-1">
                      Prix unitaire
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={priceOverrideEnabled}
                        onChange={(e) => setPriceOverrideEnabled(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-xs text-metre-muted">Override</span>
                      <input
                        type="number"
                        className="input-field flex-1"
                        value={priceOverrideEnabled ? priceOverride : (autoUnitPrice ?? 0).toFixed(2)}
                        onChange={(e) => setPriceOverride(Number(e.target.value))}
                        disabled={!priceOverrideEnabled}
                        step="0.01"
                        min="0"
                      />
                      <span className="text-xs text-metre-muted whitespace-nowrap">
                        $/{unitLabel(parent.priceUnit)}
                      </span>
                    </div>
                    <p className="text-[10px] text-metre-muted mt-1">
                      Calcule auto: {(autoUnitPrice ?? 0).toFixed(2)} $
                      {priceOverrideEnabled && priceOverride !== autoUnitPrice && (
                        <span className="text-amber-600 dark:text-amber-400 ml-2">
                          (override actif)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleSaveParentOptions}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md transition-colors"
                >
                  Sauvegarder les options
                </button>
              </section>

              <hr className="border-metre-border" />

              {/* BOM inputs — parametric variables schema for the formulas */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted">
                    Variables BOM ({bomInputs.length})
                    {bomInputsDirty && (
                      <span
                        className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 font-normal"
                        title="Modifications non sauvegardees"
                      >
                        non sauvegarde
                      </span>
                    )}
                    {bomInputsSavedNotice && !bomInputsDirty && (
                      <span
                        className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 font-normal"
                      >
                        Sauvegarde !
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={handleSaveBomInputs}
                    disabled={savingBomInputs || !bomInputsHasChanges}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-md transition-colors"
                    title={
                      !bomInputsHasChanges
                        ? 'Aucun changement a sauvegarder'
                        : savingBomInputs
                        ? 'Sauvegarde en cours...'
                        : 'Sauvegarder les modifications de variables'
                    }
                  >
                    {savingBomInputs ? 'Sauvegarde...' : 'Sauvegarder les variables'}
                  </button>
                </div>

                {/* Banner: variables referenced by formulas but not declared.
                    Surface BEFORE the list so the user sees the issue
                    immediately when they open the editor on a BOM with broken
                    formulas (the situation Mario was in this afternoon). */}
                {undeclaredVars.length > 0 && (
                  <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      <strong>Variables referencees dans des formules mais non declarees :</strong>{' '}
                      {undeclaredVars.map((v) => (
                        <span key={v} className="font-mono mr-2 underline decoration-dotted">
                          {v}
                        </span>
                      ))}
                    </p>
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">
                      Ces variables sont utilisees dans les formules des sous-produits
                      mais n'apparaissent pas dans la liste ci-dessous. Les formules
                      retourneront <span className="font-mono">ERR</span> a l'evaluation.
                      Ajoutez-les via le formulaire en bas.
                    </p>
                  </div>
                )}

                {bomInputs.length === 0 ? (
                  <p className="text-sm text-metre-muted text-center py-4">
                    Aucune variable declaree. Les formules referencant <span className="font-mono">perimetre_*</span>,{' '}
                    <span className="font-mono">surface_*</span>, etc. ne pourront pas s'evaluer.
                  </p>
                ) : (
                  <div className="rounded-lg border border-metre-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-metre-panel text-metre-muted">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium w-44">
                            Nom
                            <span
                              className="ml-1 text-[10px]"
                              title="snake_case, commence par une lettre, ex: perimetre_fondation"
                            >
                              (?)
                            </span>
                          </th>
                          <th className="text-left px-2 py-1.5 font-medium w-20">Unite</th>
                          <th className="text-right px-2 py-1.5 font-medium w-24">Default</th>
                          <th className="text-left px-2 py-1.5 font-medium">Description</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bomInputs.map((inp) => {
                          const isUsed = referencedVarsByFormulas.has(inp.name);
                          return (
                            <tr key={inp.name} className="border-t border-metre-border">
                              <td className="px-2 py-1.5">
                                <span className="font-mono text-metre-text">{inp.name}</span>
                                {!isUsed && (
                                  <span
                                    className="ml-2 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 align-middle"
                                    title="Aucune formule de ce BOM ne reference cette variable"
                                  >
                                    inutilisee
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <select
                                  className="input-field w-full text-xs"
                                  value={
                                    BOM_UNIT_OPTIONS.includes(inp.unit ?? '')
                                      ? inp.unit ?? ''
                                      : '__custom__'
                                  }
                                  onChange={(e) =>
                                    handleUpdateBomInputField(inp.name, 'unit', e.target.value === '__custom__' ? (inp.unit ?? '') : e.target.value)
                                  }
                                  disabled={savingBomInputs}
                                  title={inp.unit ?? ''}
                                >
                                  {BOM_UNIT_OPTIONS.map((u) => (
                                    <option key={u || '__empty__'} value={u}>
                                      {u || '(vide)'}
                                    </option>
                                  ))}
                                  {!BOM_UNIT_OPTIONS.includes(inp.unit ?? '') && inp.unit && (
                                    // disabled: this is a display-only marker
                                    // for legacy non-standard units. Selecting
                                    // it would be a no-op (revert via onChange);
                                    // disable to make that intent explicit.
                                    <option key="__custom__" value="__custom__" disabled>
                                      {inp.unit} (personnalise — selectionnez une unite standard pour modifier)
                                    </option>
                                  )}
                                </select>
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  className="input-field w-full text-right text-xs"
                                  value={inp.default ?? ''}
                                  onChange={(e) =>
                                    handleUpdateBomInputField(inp.name, 'default', e.target.value)
                                  }
                                  step="0.01"
                                  placeholder="vide"
                                  disabled={savingBomInputs}
                                  autoComplete="off"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="text"
                                  className="input-field w-full text-xs"
                                  value={inp.description ?? ''}
                                  onChange={(e) =>
                                    handleUpdateBomInputField(
                                      inp.name,
                                      'description',
                                      e.target.value,
                                    )
                                  }
                                  maxLength={255}
                                  placeholder="Optionnel"
                                  disabled={savingBomInputs}
                                  autoComplete="off"
                                />
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <button
                                  onClick={() => handleRemoveBomInput(inp.name)}
                                  className="text-red-600 dark:text-red-400 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-base leading-none"
                                  title="Supprimer cette variable"
                                  disabled={savingBomInputs}
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Add new input form */}
                <div className="rounded-lg border border-metre-border bg-metre-panel/30 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-metre-muted uppercase tracking-wider">
                    Ajouter une variable
                  </p>
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-4">
                      <label className="text-[10px] text-metre-muted block mb-1">
                        Nom (snake_case)
                      </label>
                      <input
                        type="text"
                        className="input-field text-xs font-mono"
                        value={newInputName}
                        onChange={(e) => {
                          // Force lowercase in the input — the regex is case-sensitive
                          // and Mario types in mixed case sometimes.
                          setNewInputName(e.target.value.toLowerCase());
                          setNewInputError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddBomInput();
                        }}
                        placeholder="ex: perimetre_fondation"
                        maxLength={80}
                        disabled={savingBomInputs}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-metre-muted block mb-1">Unite</label>
                      <select
                        className="input-field text-xs"
                        value={newInputUnit}
                        onChange={(e) => setNewInputUnit(e.target.value)}
                        disabled={savingBomInputs}
                      >
                        {BOM_UNIT_OPTIONS.map((u) => (
                          <option key={u || '__empty__'} value={u}>
                            {u || '(vide)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-metre-muted block mb-1">Default</label>
                      <input
                        type="number"
                        className="input-field text-xs"
                        value={newInputDefault}
                        onChange={(e) => setNewInputDefault(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddBomInput();
                        }}
                        step="0.01"
                        placeholder="vide"
                        disabled={savingBomInputs}
                        autoComplete="off"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="text-[10px] text-metre-muted block mb-1">Description</label>
                      <input
                        type="text"
                        className="input-field text-xs"
                        value={newInputDescription}
                        onChange={(e) => setNewInputDescription(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddBomInput();
                        }}
                        placeholder="Optionnel"
                        maxLength={255}
                        disabled={savingBomInputs}
                        autoComplete="off"
                      />
                    </div>
                    <div className="col-span-1 flex items-end">
                      <button
                        onClick={handleAddBomInput}
                        disabled={!newInputName.trim() || savingBomInputs}
                        className="w-full h-8 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors"
                        title="Ajouter cette variable au schema"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {newInputError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">{newInputError}</p>
                  )}
                  <p className="text-[10px] text-metre-muted">
                    Astuce : declarer ici les variables qui apparaissent dans les formules des
                    sous-produits. Si une formule utilise{' '}
                    <span className="font-mono">perimetre_fondation * 0.75</span>, declarer la
                    variable <span className="font-mono">perimetre_fondation</span> avec son unite
                    et un default. Le default sert quand aucune mesure ne porte ce label dans le
                    metre. Apres avoir modifie la liste, cliquer{' '}
                    <strong>Sauvegarder les variables</strong> pour persister en base.
                  </p>
                </div>
              </section>

              <hr className="border-metre-border" />

              {/* Components list */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted">
                  Sous-produits ({components.length})
                </h3>

                {components.length === 0 ? (
                  <p className="text-sm text-metre-muted text-center py-6">
                    Aucun sous-produit. Ajoutez-en un ci-dessous.
                  </p>
                ) : (
                  <div className="rounded-lg border border-metre-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-metre-panel text-metre-muted">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Produit</th>
                          <th className="text-right px-2 py-1.5 font-medium w-20">
                            Qte/unite
                          </th>
                          <th className="text-left px-2 py-1.5 font-medium w-48" title="Formule parametrique optionnelle. Si renseignee, prend le pas sur Qte/unite lors de l'evaluation BOM. Ex: perimetre_ss * 0.25 + 3">
                            Formule
                          </th>
                          <th className="text-right px-2 py-1.5 font-medium w-20">Prix</th>
                          <th className="text-right px-2 py-1.5 font-medium w-16">Perte</th>
                          <th className="text-right px-2 py-1.5 font-medium w-24">Sous-total</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {components.map((c) => {
                          const childWaste = (c.childWastePct ?? 0) / 100;
                          const lineTotal =
                            (c.childPrice ?? 0) * c.quantityPerUnit * (1 + childWaste);
                          return (
                            <tr key={c.id} className="border-t border-metre-border">
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="w-2.5 h-2.5 rounded-sm"
                                    style={{ backgroundColor: c.childColor ?? '#888' }}
                                  />
                                  <span className="text-metre-text">{c.childName}</span>
                                  <span className="text-[10px] text-metre-muted">
                                    ({c.childCategory})
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  className="input-field w-full text-right text-xs"
                                  value={c.quantityPerUnit}
                                  onFocus={() => capturePreEditValue(c.id, 'quantityPerUnit')}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setComponents((prev) =>
                                      prev.map((cc) =>
                                        cc.id === c.id ? { ...cc, quantityPerUnit: val } : cc,
                                      ),
                                    );
                                  }}
                                  onBlur={(e) =>
                                    handleUpdateComponent(c.id, 'quantityPerUnit', Number(e.target.value))
                                  }
                                  step="0.01"
                                  min="0"
                                  disabled={!!(c.formula && c.formula.trim())}
                                  title={c.formula ? 'Desactive : la formule prend le pas' : undefined}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="text"
                                  className="input-field w-full text-xs font-mono"
                                  value={c.formula ?? ''}
                                  onFocus={() => capturePreEditValue(c.id, 'formula')}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setComponents((prev) =>
                                      prev.map((cc) =>
                                        cc.id === c.id ? { ...cc, formula: val } : cc,
                                      ),
                                    );
                                  }}
                                  onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    handleUpdateComponent(c.id, 'formula', v === '' ? null : v);
                                  }}
                                  placeholder="ex: perimetre_ss * 0.25 + 3"
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right text-metre-muted tabular-nums">
                                {(c.childPrice ?? 0).toFixed(2)} $
                              </td>
                              <td className="px-2 py-1.5 text-right text-metre-muted tabular-nums">
                                {(c.childWastePct ?? 0)}%
                              </td>
                              <td className="px-2 py-1.5 text-right font-medium text-metre-accent tabular-nums">
                                {(lineTotal ?? 0).toFixed(2)} $
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <button
                                  onClick={() => handleRemoveComponent(c.id)}
                                  className="text-red-600 dark:text-red-400 hover:text-red-700 text-base leading-none"
                                  title="Supprimer"
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-metre-panel">
                        <tr>
                          <td colSpan={5} className="px-2 py-1.5 text-right text-metre-muted">
                            Total / unite parent:
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold text-metre-accent tabular-nums">
                            {(autoUnitPrice ?? 0).toFixed(2)} $
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>

              <hr className="border-metre-border" />

              {/* Add row */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-metre-muted">
                  Ajouter un sous-produit
                </h3>
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-6">
                    <label className="text-[10px] text-metre-muted block mb-1">
                      Produit (non-composite)
                    </label>
                    <select
                      className="input-field"
                      value={newChildId}
                      onChange={(e) => setNewChildId(e.target.value)}
                    >
                      <option value="">-- Choisir --</option>
                      {eligibleChildren.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.category} / {p.name} ({(p.price ?? 0).toFixed(2)} $/{unitLabel(p.priceUnit)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-metre-muted block mb-1">
                      Qte / unite
                    </label>
                    <input
                      type="number"
                      className="input-field"
                      value={newQty}
                      onChange={(e) => setNewQty(Number(e.target.value))}
                      step="0.01"
                      min="0"
                      disabled={newFormula.trim().length > 0}
                      title={newFormula.trim() ? 'Desactive : la formule prend le pas' : undefined}
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] text-metre-muted block mb-1">Notes</label>
                    <input
                      type="text"
                      className="input-field"
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      placeholder="Optionnel"
                    />
                  </div>
                  <div className="col-span-1 flex items-end">
                    <button
                      onClick={handleAddChild}
                      disabled={!newChildId}
                      className="w-full h-8 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <div className="col-span-12">
                    <label className="text-[10px] text-metre-muted block mb-1">
                      Formule parametrique (optionnelle)
                    </label>
                    <input
                      type="text"
                      className="input-field font-mono"
                      value={newFormula}
                      onChange={(e) => setNewFormula(e.target.value)}
                      placeholder="ex: perimetre_ss * 0.25 + 3 ou IF(surface_ss > 800, 3, 2)"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-metre-muted">
                  Astuce: &laquo; Qte / unite &raquo; = combien de ce sous-produit par 1 unite du produit parent.
                  Si une <strong>formule</strong> est saisie, elle est evaluee a la place
                  contre les inputs du BOM (perimetre, surface, etc.) lors du metre.
                  Operateurs supportes: + - * /, comparaisons, IF(cond, then, else), MIN, MAX, ROUND, SUM.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
