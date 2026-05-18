/**
 * SoumissionModal -- Generate a devis (soumission) from Metre PDF measurements.
 *
 * Section 1: Fiche Client form (same fields as EstimationIA)
 * Section 2: Preview des lignes grouped by categorie with totals
 * Section 3: Action buttons (Créer un devis / Appliquer au devis / Annuler)
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Modal } from './ui/Modal';
import * as companiesApi from '../../../api/companies';
import type { Company, Contact } from '../../../api/companies';
import { previewHtmlWithItems, type PreviewHtmlItem } from '../../../api/devis';
import DevisHtmlPreviewModal from '../../devis/DevisHtmlPreviewModal';
import type { SoumissionConsolidationMode } from '../store';

// Items with these categories are computed from % on the devis (admin/contingences/profit),
// not persisted as lignes — exclude them from preview to match onApplyToDevis behavior.
const EXCLUDED_CATS = /^(?:\d+\.\d+\s*-\s*)?(administration|contingences?|profit|gestion de projet|frais g[eé]n[eé]raux)$/i;

// Pattern matching the labor category emitted by `generateSoumissionItems`. Used
// to filter labor lines on/off when the user toggles "Inclure main-d'œuvre" and
// to style the labor section block in the preview. Tolerant to the typographic
// variants encountered in user-typed / imported data:
//   - hyphen OR space between "main" and "d'"  → [-\s]
//   - straight or curly apostrophe (or none)   → ['’ʼ]?
//   - "œuvre" (correct) or "oeuvre" (ASCII)    → (?:œuvre|oeuvre)
const LABOR_CAT = /^\s*main[-\s]d['’ʼ]?\s*(?:œuvre|oeuvre)\s*$/i;

/* ------------------------------------------------------------------ */
/*  Exported types                                                      */
/* ------------------------------------------------------------------ */

export interface ClientInfo {
  nomProjet: string;
  clientCompanyId?: number;
  clientContactId?: number;
  clientNomDirect?: string;
  poClient?: string;
  datePrevu?: string;
  dateSoumis?: string;
  priorite?: string;
  description?: string;
}

export interface SoumissionItem {
  description: string;
  quantite: number;
  unite: string;
  prixUnitaire: number;
  montantLigne: number;
  categorie: string;
}

/**
 * Consolidation mode for soumission line generation. Re-exported from the
 * Métré store so the type has a single source of truth (load/save helpers
 * live in `../store`).
 *  - `detailed`              : one line per measurement (legacy behaviour)
 *  - `by-product-and-layer`  : aggregate by (product, layer) — preserves layer
 *                              organisation while still merging duplicates
 *  - `by-product`            : aggregate by product only — max consolidation,
 *                              matches the PDF "Résumé par produit" view
 */
export type ConsolidationMode = SoumissionConsolidationMode;

const CONSOLIDATION_LABELS: Record<ConsolidationMode, { short: string; full: string }> = {
  'detailed': {
    short: 'Détaillé',
    full: '1 ligne par mesure (détaillé)',
  },
  'by-product-and-layer': {
    short: 'Produit + calque',
    full: 'Consolider par produit + calque (recommandé)',
  },
  'by-product': {
    short: 'Produit seul',
    full: 'Consolider par produit seul (ignore les calques)',
  },
};

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface SoumissionModalProps {
  open: boolean;
  onClose: () => void;
  items: SoumissionItem[];
  devisId?: number;
  initialClientInfo?: ClientInfo;
  /** Current consolidation mode applied to `items`. Used to drive the toggle UI. */
  consolidationMode?: ConsolidationMode;
  /** Called when the user picks a different consolidation mode. Parent is
   *  expected to re-generate `items` so the preview updates live. */
  onConsolidationModeChange?: (mode: ConsolidationMode) => void;
  onApplyToDevis?: (items: SoumissionItem[], clientInfo: ClientInfo) => void;
  onCreateDevis?: (items: SoumissionItem[], clientInfo: ClientInfo) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function SoumissionModal({
  open,
  onClose,
  items,
  devisId,
  initialClientInfo,
  consolidationMode,
  onConsolidationModeChange,
  onApplyToDevis,
  onCreateDevis,
}: SoumissionModalProps) {
  /* ---- ERP data ---- */
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      companiesApi.listCompanies({ perPage: 100 }),
      companiesApi.listContacts({ perPage: 100 }),
    ]).then(([compRes, contRes]) => {
      setCompanies(compRes.items);
      setContacts(contRes.items);
    }).catch(() => {});
  }, [open]);

  /* ---- Client form ---- */
  const [clientForm, setClientForm] = useState<ClientInfo>(() => initialClientInfo ?? {
    nomProjet: '',
    clientCompanyId: undefined,
    clientContactId: undefined,
    clientNomDirect: '',
    poClient: '',
    datePrevu: '',
    dateSoumis: '',
    priorite: 'NORMAL',
    description: '',
  });

  // Re-hydrate form from parent only on the closed→open TRANSITION — not on every
  // parent re-render while the modal is open. Without this guard, any unrelated
  // parent re-render creates a fresh `initialClientInfo` reference and overwrites
  // the user's in-modal edits.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current && initialClientInfo) {
      setClientForm(initialClientInfo);
    }
    wasOpenRef.current = open;
  }, [open, initialClientInfo]);

  const filteredContacts = clientForm.clientCompanyId
    ? contacts.filter(c => c.companyId === clientForm.clientCompanyId)
    : contacts;

  const updateField = <K extends keyof ClientInfo>(key: K, value: ClientInfo[K]) =>
    setClientForm(prev => ({ ...prev, [key]: value }));

  /* ---- Labor toggle ---- */
  // `true` by default — most users want labor included; the toggle lets them
  // generate a materials-only quote without re-opening / re-editing the métré.
  // We reset to `true` on every modal open so a previous session's choice
  // doesn't silently carry over into a new métré (would be surprising UX
  // when the user just added new labor measurements). Uses a dedicated ref
  // (not `wasOpenRef`) because that one is already flipped by the earlier
  // effect in render order, so we'd never see the closed→open transition here.
  const [includeLabor, setIncludeLabor] = useState(true);
  const prevOpenForLaborRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenForLaborRef.current) setIncludeLabor(true);
    prevOpenForLaborRef.current = open;
  }, [open]);
  const hasLaborLines = useMemo(
    () => items.some(it => LABOR_CAT.test((it.categorie || '').trim())),
    [items],
  );

  /* ---- Filtered + grouped items (labor block always rendered last) ---- */
  const visibleItems = useMemo(
    () => (includeLabor ? items : items.filter(it => !LABOR_CAT.test((it.categorie || '').trim()))),
    [items, includeLabor],
  );

  const grouped = useMemo(() => {
    const map: Record<string, { items: SoumissionItem[]; total: number; isLabor: boolean }> = {};
    for (const it of visibleItems) {
      const cat = it.categorie || 'General';
      if (!map[cat]) map[cat] = { items: [], total: 0, isLabor: LABOR_CAT.test(cat.trim()) };
      map[cat].items.push(it);
      map[cat].total += it.montantLigne;
    }
    // Materials first (alphabetical), then the Main-d'œuvre block last so the
    // user reads the quote top-down: matériaux → main-d'œuvre → totaux.
    return Object.entries(map).sort(([a, ga], [b, gb]) => {
      if (ga.isLabor !== gb.isLabor) return ga.isLabor ? 1 : -1;
      return a.localeCompare(b, 'fr-CA');
    });
  }, [visibleItems]);

  /* ---- Subtotals split (materials / labor) for clarity ---- */
  const materialsSubtotal = useMemo(
    () => visibleItems
      .filter(it => !LABOR_CAT.test((it.categorie || '').trim()))
      .reduce((s, it) => s + it.montantLigne, 0),
    [visibleItems],
  );
  const laborSubtotal = useMemo(
    () => visibleItems
      .filter(it => LABOR_CAT.test((it.categorie || '').trim()))
      .reduce((s, it) => s + it.montantLigne, 0),
    [visibleItems],
  );
  const sousTotal = materialsSubtotal + laborSubtotal;
  const tps = Math.round(sousTotal * 0.05 * 100) / 100;
  const tvq = Math.round(sousTotal * 0.09975 * 100) / 100;
  const total = Math.round((sousTotal + tps + tvq) * 100) / 100;

  /* ---- Handlers ---- */
  const buildInfo = (): ClientInfo => ({
    ...clientForm,
    nomProjet: clientForm.nomProjet.trim() || 'Soumission Métré',
  });

  const handleCreate = () => {
    if (onCreateDevis) onCreateDevis(visibleItems, buildInfo());
  };

  const handleApply = () => {
    if (onApplyToDevis) onApplyToDevis(visibleItems, buildInfo());
  };

  /* ---- Preview HTML (uses backend template identical to DevisPage) ---- */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Reset preview state when the parent SoumissionModal closes — prevents
  // stale HTML from showing the next time the modal re-opens.
  useEffect(() => {
    if (!open) {
      setPreviewOpen(false);
      setPreviewHtml('');
      setPreviewError(null);
      setPreviewLoading(false);
    }
  }, [open]);

  const handlePreviewHtml = async () => {
    if (!devisId) return;
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      // Backend rejects quantite <= 0 with 422 (Pydantic gt=0 on PreviewLigneItem).
      // Filter here to mirror the same guard used elsewhere on the create/apply
      // paths, otherwise the preview HTML call fails silently with a generic
      // error toast that hides the real cause.
      const extraItems: PreviewHtmlItem[] = visibleItems
        .filter(it => !EXCLUDED_CATS.test((it.categorie || '').trim()))
        .filter(it => (it.quantite ?? 0) > 0)
        .map((it, idx) => ({
          description: it.description,
          quantite: it.quantite,
          unite: it.unite,
          prixUnitaire: it.prixUnitaire,
          categorie: it.categorie,
          sequenceLigne: idx + 1,
        }));
      const res = await previewHtmlWithItems(devisId, extraItems);
      setPreviewHtml(res.html);
    } catch {
      setPreviewError('Erreur lors de la génération du preview HTML');
    } finally {
      setPreviewLoading(false);
    }
  };

  /* ---- Shared input class ---- */
  const inputCls =
    'w-full rounded-md border border-slate-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 ' +
    'px-3 py-1.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-neutral-500 ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  const labelCls = 'block text-xs font-medium text-slate-600 dark:text-neutral-400 mb-1';

  /* ---------------------------------------------------------------- */
  return (
    <Modal open={open} onClose={onClose} title="Générer une soumission" maxWidth="max-w-4xl">
      <div className="max-h-[80vh] overflow-y-auto -mx-6 px-6 space-y-6">

        {/* ============ Section 1: Fiche Client ============ */}
        <section>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-neutral-300 mb-3">
            Fiche Client
          </h3>

          {/* Row 1: 2-column grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {/* Left column */}
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Nom du projet *</label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="Ex: Rénovation cuisine 2026"
                  value={clientForm.nomProjet}
                  onChange={e => updateField('nomProjet', e.target.value)}
                />
              </div>

              <div>
                <label className={labelCls}>Client Entreprise</label>
                <select
                  className={inputCls}
                  value={clientForm.clientCompanyId ?? ''}
                  onChange={e => {
                    const val = e.target.value ? Number(e.target.value) : undefined;
                    updateField('clientCompanyId', val);
                    updateField('clientContactId', undefined);
                  }}
                >
                  <option value="">-- Aucune --</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Client Contact</label>
                <select
                  className={inputCls}
                  value={clientForm.clientContactId ?? ''}
                  onChange={e => {
                    const val = e.target.value ? Number(e.target.value) : undefined;
                    updateField('clientContactId', val);
                  }}
                >
                  <option value="">-- Aucun --</option>
                  {filteredContacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.prenom} {c.nomFamille}{c.rolePoste ? ` (${c.rolePoste})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {!clientForm.clientCompanyId && (
                <div>
                  <label className={labelCls}>Saisie manuelle nom client</label>
                  <input
                    type="text"
                    className={inputCls}
                    placeholder="Nom du client"
                    value={clientForm.clientNomDirect ?? ''}
                    onChange={e => updateField('clientNomDirect', e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-3">
              <div>
                <label className={labelCls}>No. PO Client</label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="PO-000"
                  value={clientForm.poClient ?? ''}
                  onChange={e => updateField('poClient', e.target.value)}
                />
              </div>

              <div>
                <label className={labelCls}>Date limite soumission</label>
                <input
                  type="date"
                  className={inputCls}
                  value={clientForm.dateSoumis ?? ''}
                  onChange={e => updateField('dateSoumis', e.target.value)}
                />
              </div>

              <div>
                <label className={labelCls}>Début prévu travaux</label>
                <input
                  type="date"
                  className={inputCls}
                  value={clientForm.datePrevu ?? ''}
                  onChange={e => updateField('datePrevu', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Bottom row: Priorite + Description */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Priorité</label>
              <select
                className={inputCls}
                value={clientForm.priorite ?? 'NORMAL'}
                onChange={e => updateField('priorite', e.target.value)}
              >
                <option value="NORMAL">Normal</option>
                <option value="HAUTE">Haute</option>
                <option value="URGENTE">Urgente</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Description</label>
              <textarea
                className={inputCls + ' resize-none'}
                rows={2}
                placeholder="Notes supplémentaires..."
                value={clientForm.description ?? ''}
                onChange={e => updateField('description', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* ============ Section 2: Preview des lignes ============ */}
        <section>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-neutral-300">
              Lignes de soumission ({visibleItems.length} item{visibleItems.length !== 1 ? 's' : ''})
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              {consolidationMode && onConsolidationModeChange && items.length > 0 && (() => {
                const modes = Object.keys(CONSOLIDATION_LABELS) as ConsolidationMode[];
                // ARIA radiogroup pattern: one tab-stop into the group, Arrow
                // keys cycle, Home/End jump to first/last. The active button
                // is the only one with tabIndex=0 so the next Tab leaves the
                // group entirely.
                const handleKey = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
                  let nextIdx: number | null = null;
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % modes.length;
                  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + modes.length) % modes.length;
                  else if (e.key === 'Home') nextIdx = 0;
                  else if (e.key === 'End') nextIdx = modes.length - 1;
                  if (nextIdx === null) return;
                  e.preventDefault();
                  onConsolidationModeChange(modes[nextIdx]);
                  // Move focus to the newly selected radio
                  const group = e.currentTarget.parentElement;
                  const btn = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIdx];
                  btn?.focus();
                };
                return (
                  <div
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800 p-0.5"
                    role="radiogroup"
                    aria-label="Mode de consolidation des lignes de soumission"
                  >
                    <span className="px-2 text-[11px] font-medium text-slate-500 dark:text-neutral-400 select-none">
                      Consolidation :
                    </span>
                    {modes.map((m, idx) => {
                      const active = consolidationMode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={CONSOLIDATION_LABELS[m].full}
                          tabIndex={active ? 0 : -1}
                          onClick={() => onConsolidationModeChange(m)}
                          onKeyDown={(e) => handleKey(e, idx)}
                          title={CONSOLIDATION_LABELS[m].full}
                          className={
                            'rounded px-2.5 py-1 text-[11px] font-medium transition-colors ' +
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-neutral-800 ' +
                            (active
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-slate-600 dark:text-neutral-300 hover:bg-white dark:hover:bg-neutral-700')
                          }
                        >
                          {CONSOLIDATION_LABELS[m].short}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
              {hasLaborLines && (
                <label
                  className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                  title="Décochez pour générer un devis de matériaux uniquement"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-emerald-600 cursor-pointer"
                    checked={includeLabor}
                    onChange={e => setIncludeLabor(e.target.checked)}
                  />
                  <span className="text-xs font-medium text-emerald-800 dark:text-emerald-200">
                    Inclure la main-d&apos;œuvre
                  </span>
                </label>
              )}
            </div>
          </div>

          {visibleItems.length === 0 ? (
            <div className="rounded-lg border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800 p-6 text-center text-sm text-slate-500 dark:text-neutral-400">
              {items.length === 0
                ? 'Aucune mesure avec produit associé. Associez des produits à vos mesures pour générer des lignes.'
                : 'Aucune ligne à afficher. Cochez « Inclure la main-d\'œuvre » pour la rajouter.'}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 dark:border-neutral-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400">
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-left px-3 py-2 font-medium w-20">Unité</th>
                    <th className="text-right px-3 py-2 font-medium w-20">Qte</th>
                    <th className="text-right px-3 py-2 font-medium w-28">Prix unit.</th>
                    <th className="text-right px-3 py-2 font-medium w-28">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(([cat, group]) => {
                    // Distinct emerald palette for the labor block so users
                    // visually separate matériaux ↔ main-d'œuvre at a glance.
                    const headerCls = group.isLabor
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                      : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400';
                    return (
                      <React.Fragment key={cat}>
                        {/* Category header row */}
                        <tr className={headerCls}>
                          <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold">
                            {cat}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs font-semibold">
                            {fmt(group.total)} $
                          </td>
                        </tr>

                        {/* Line items */}
                        {group.items.map((it, i) => (
                          <tr
                            key={`${cat}-${i}`}
                            className={
                              i % 2 === 0
                                ? 'bg-white dark:bg-neutral-900'
                                : 'bg-slate-50 dark:bg-neutral-900/60'
                            }
                          >
                            <td className="px-3 py-1.5 text-slate-800 dark:text-neutral-200">
                              {it.description}
                            </td>
                            <td className="px-3 py-1.5 text-slate-500 dark:text-neutral-400">
                              {it.unite}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800 dark:text-neutral-200">
                              {fmt(it.quantite)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-800 dark:text-neutral-200">
                              {fmt(it.prixUnitaire)} $
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900 dark:text-white">
                              {fmt(it.montantLigne)} $
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>

                {/* Totals */}
                <tfoot>
                  {/* When labor lines are present AND included, show split
                      subtotals so the user sees materials vs labor breakdown
                      before the grand subtotal. Hidden when there's no labor
                      to declutter materials-only quotes. */}
                  {includeLabor && laborSubtotal > 0 && (
                    <>
                      <tr className="border-t border-slate-200 dark:border-neutral-700">
                        <td colSpan={4} className="px-3 py-1 text-right text-xs text-slate-500 dark:text-neutral-400">
                          Sous-total matériaux
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums text-xs text-slate-700 dark:text-neutral-300">
                          {fmt(materialsSubtotal)} $
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="px-3 py-1 text-right text-xs text-emerald-700 dark:text-emerald-400">
                          Sous-total main-d&apos;œuvre
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums text-xs text-emerald-700 dark:text-emerald-400">
                          {fmt(laborSubtotal)} $
                        </td>
                      </tr>
                    </>
                  )}
                  <tr className="border-t border-slate-200 dark:border-neutral-700">
                    <td colSpan={4} className="px-3 py-1.5 text-right text-sm font-medium text-slate-600 dark:text-neutral-400">
                      Sous-total
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900 dark:text-white">
                      {fmt(sousTotal)} $
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-3 py-1 text-right text-xs text-slate-500 dark:text-neutral-500">
                      TPS (5%)
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums text-xs text-slate-500 dark:text-neutral-500">
                      {fmt(tps)} $
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-3 py-1 text-right text-xs text-slate-500 dark:text-neutral-500">
                      TVQ (9.975%)
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums text-xs text-slate-500 dark:text-neutral-500">
                      {fmt(tvq)} $
                    </td>
                  </tr>
                  <tr className="border-t border-slate-300 dark:border-neutral-600">
                    <td colSpan={4} className="px-3 py-2 text-right text-sm font-bold text-slate-900 dark:text-white">
                      Total TTC
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-sm font-bold text-blue-600 dark:text-blue-400">
                      {fmt(total)} $
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* ============ Section 3: Action buttons ============ */}
        <section className="flex items-center justify-end gap-3 pt-2 pb-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium text-slate-700 dark:text-neutral-300 bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 transition-colors"
          >
            Annuler
          </button>

          {devisId && (
            <button
              type="button"
              onClick={handlePreviewHtml}
              disabled={visibleItems.length === 0 || previewLoading}
              className="px-4 py-2 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Preview la soumission avec les items du métré, sans persister"
            >
              {previewLoading ? 'Génération...' : 'Aperçu Soumission HTML'}
            </button>
          )}

          {devisId && onApplyToDevis && (
            <button
              type="button"
              onClick={handleApply}
              disabled={visibleItems.length === 0}
              className="px-4 py-2 rounded-md text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Appliquer au devis
            </button>
          )}

          {onCreateDevis && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={visibleItems.length === 0}
              className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Créer un devis
            </button>
          )}
        </section>
      </div>

      <DevisHtmlPreviewModal
        isOpen={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewHtml('');
          setPreviewError(null);
          setPreviewLoading(false);
        }}
        html={previewError ? `<div style="padding:2rem;font-family:sans-serif;color:#b91c1c">${previewError}</div>` : previewHtml}
        title="Aperçu de la soumission (preview — non persisté)"
        loading={previewLoading}
      />
    </Modal>
  );
}
