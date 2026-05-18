/**
 * ERP React Frontend - Devis Page
 * Quote/estimate management with line items, tax calculation,
 * HTML generation, preview, and client sending.
 */

import { useEffect, useMemo, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Pencil, Trash2, Eye, EyeOff, Send, Code2, Check, X, ChevronLeft, Download, Copy, CheckSquare,
  ChevronDown, ChevronRight, RotateCcw, FileText, FileSpreadsheet, Save,
} from 'lucide-react';
import * as devisApi from '@/api/devis';
import { useAuthStore } from '@/store/useAuthStore';
import * as companiesApi from '@/api/companies';
import type { Company, Contact } from '@/api/companies';
// PDF export removed — use Generer HTML + Apercu instead
import type { Devis, DevisLigne } from '@/api/devis';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { formatDate, formatCurrency } from '@/utils/format';
import ConstructionTemplate from '@/components/devis/ConstructionTemplate';
import type { TemplateTotals } from '@/components/devis/ConstructionTemplate';
import type { SelectedItem, ConstructionConfig } from '@/data/constructionItems';
import EstimationIA from '@/components/devis/EstimationIA';
import type { ClientInfo } from '@/components/devis/EstimationIA';
import ClientInfoCard from '@/components/devis/ClientInfoCard';
import DevisHtmlPreviewModal from '@/components/devis/DevisHtmlPreviewModal';
import type { SoumissionItem } from '@/api/devis';
import { useSortable } from '@/hooks/useSortable';
import { useColumnResize } from '@/hooks/useColumnResize';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { CommandBar } from '@/components/ui/CommandBar';

const MetrePdf = lazy(() => import('../components/metre-pdf/MetrePdf'));

/* ── MO / MAT ratios — Quebec construction industry (CCQ, APCHQ, SCHL) ── */
const MO_MAT_RULES: Array<{ keywords: string[]; mo: number; mat: number }> = [
  { keywords: ['peinture', 'teinture', 'vernis', 'laque'], mo: 70, mat: 30 },
  { keywords: ['demolition', 'demontage', 'deconstruction'], mo: 65, mat: 35 },
  { keywords: ['gypse', 'platrage', 'platre', 'tirage de joint'], mo: 60, mat: 40 },
  { keywords: ['electricite', 'electrique', 'cablage', 'eclairage', 'panneau electrique', 'filage'], mo: 55, mat: 45 },
  { keywords: ['ceramique', 'carrelage', 'tuile'], mo: 55, mat: 45 },
  { keywords: ['maconnerie', 'brique', 'pierre naturelle', 'bloc de beton'], mo: 55, mat: 45 },
  { keywords: ['soudure', 'metal ouvre', 'acier', 'fer forge'], mo: 55, mat: 45 },
  { keywords: ['finition', 'finitions interieures'], mo: 55, mat: 45 },
  { keywords: ['plomberie', 'tuyauterie', 'drain', 'robinet'], mo: 50, mat: 50 },
  { keywords: ['coffrage'], mo: 50, mat: 50 },
  { keywords: ['revetement exterieur', 'bardage', 'parement', 'canexel', 'vinyle'], mo: 45, mat: 55 },
  { keywords: ['charpente', 'ossature', 'structure bois', 'colombage'], mo: 45, mat: 55 },
  { keywords: ['toiture', 'couverture', 'bardeaux', 'membrane', 'toit'], mo: 45, mat: 55 },
  { keywords: ['beton', 'fondation', 'dalle', 'structure portante', 'semelle', 'pilier'], mo: 40, mat: 60 },
  { keywords: ['cvac', 'cvca', 'chauffage', 'ventilation', 'climatisation', 'thermopompe', 'echangeur'], mo: 40, mat: 60 },
  { keywords: ['isolation', 'enveloppe thermique', 'laine', 'styromousse', 'urethan', 'pare-vapeur'], mo: 35, mat: 65 },
  { keywords: ['amenagement paysager', 'paysagement', 'plantation', 'pave'], mo: 35, mat: 65 },
  { keywords: ['excavation', 'terrassement', 'deblai', 'remblai'], mo: 30, mat: 70 },
  { keywords: ['armoire', 'ebenisterie', 'cuisine', 'vanite', 'comptoir'], mo: 30, mat: 70 },
  { keywords: ['porte', 'fenetre', 'vitrerie', 'vitrage', 'moustiquaire'], mo: 30, mat: 70 },
];

function getMoMatRatio(description: string): { mo: number; mat: number } {
  const desc = description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const rule of MO_MAT_RULES) {
    for (const kw of rule.keywords) {
      if (desc.includes(kw)) return { mo: rule.mo, mat: rule.mat };
    }
  }
  return { mo: 50, mat: 50 };
}

/* Resolve MO/MAT ratio for a ligne: priority to user custom overrides, fallback
   to keyword auto-detection. Must stay in sync with backend _generate_devis_html
   (devis.py) so the in-app preview matches the exported HTML. */
function resolveMoMatRatio(l: DevisLigne): { mo: number; mat: number } {
  if (l.moPct != null || l.matPct != null) {
    if (l.moPct == null) return { mo: Math.max(0, 100 - Number(l.matPct)), mat: Number(l.matPct) };
    if (l.matPct == null) return { mo: Number(l.moPct), mat: Math.max(0, 100 - Number(l.moPct)) };
    return { mo: Number(l.moPct), mat: Number(l.matPct) };
  }
  return getMoMatRatio(l.description);
}

/* ── Export CSV QuickBooks ── */
function generateQuickBooksCSV(devis: Devis): string {
  const allLines = devis.lignes || [];
  const visibleLines = allLines.filter(l => l.visible !== false);
  const admPct = (devis.administrationPct ?? 3) / 100;
  const conPct = (devis.contingencesPct ?? 12) / 100;
  const proPct = (devis.profitPct ?? 15) / 100;
  // Per-line markup honours admin_pct_ligne / contingence_pct_ligne /
  // profit_pct_ligne overrides — same logic as `_line_markup` in
  // backend `_generate_devis_html`. Without this, the QB CSV export would
  // diverge from the PDF/HTML/XLSX outputs as soon as a line uses an
  // override (the bug reported in the multi-agent QA round).
  const lineMarkup = (l: DevisLigne): number => {
    const a = l.adminPctLigne != null ? l.adminPctLigne / 100 : admPct;
    const c = l.contingencePctLigne != null ? l.contingencePctLigne / 100 : conPct;
    const p = l.profitPctLigne != null ? l.profitPctLigne / 100 : proPct;
    return 1 + a + c + p;
  };

  const csvEsc = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const fmtNum = (n: number) => (n ?? 0).toFixed(2);

  const headers = ['Item', 'Description', 'Category', 'Quantity', 'Unit', 'Unit Price', 'Amount', 'Tax Code', 'MO %', 'MO $', 'MAT %', 'MAT $'];
  const rows: string[] = [headers.join(',')];

  for (const l of visibleLines) {
    const lm = lineMarkup(l);
    const prix = +((l.prixUnitaire || 0) * lm).toFixed(2);
    const montant = +((l.montantLigne || 0) * lm).toFixed(2);
    const r = resolveMoMatRatio(l);
    const moVal = +(montant * r.mo / 100).toFixed(2);
    const matVal = +(montant * r.mat / 100).toFixed(2);
    rows.push([
      csvEsc(l.codeArticle || ''),
      csvEsc(l.description),
      csvEsc(l.categorie || ''),
      fmtNum(l.quantite || 0),
      csvEsc(l.unite || ''),
      fmtNum(prix),
      fmtNum(montant),
      'TPS/TVQ',
      String(r.mo),
      fmtNum(moVal),
      String(r.mat),
      fmtNum(matVal),
    ].join(','));
  }

  // Totaux — alignés EXACTEMENT sur _generate_devis_html (backend devis.py:4568-4583)
  // et export_devis_xlsx (backend devis.py:5411-5434) pour garantir que les 3
  // exports (HTML, XLSX, CSV QB) produisent les mêmes montants au cent près,
  // avec la même sémantique : "Sous-total HT" = somme brute des lignes,
  // Administration/Contingences/Profit sur des lignes séparées, puis
  // "Sous-total avant taxes" = HT + admin + cont + profit.
  // round2() miroir de Python round(x, 2) — banker's rounding différences
  // négligeables sur montants en dollars.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Subtotal includes ALL lines (hidden lines still count in totals, same as PDF/XLSX)
  const sousTotalHt = allLines.reduce((s, l) => s + (l.montantLigne || 0), 0);
  // Aggregate admin/contingences/profit per line (override-aware) so the CSV
  // matches the backend `_recompute_devis_totals` output.
  let adminAcc = 0;
  let contAcc = 0;
  let profitAcc = 0;
  for (const l of allLines) {
    const m = l.montantLigne || 0;
    const a = l.adminPctLigne != null ? l.adminPctLigne / 100 : admPct;
    const c = l.contingencePctLigne != null ? l.contingencePctLigne / 100 : conPct;
    const p = l.profitPctLigne != null ? l.profitPctLigne / 100 : proPct;
    adminAcc += m * a;
    contAcc += m * c;
    profitAcc += m * p;
  }
  const admin = round2(adminAcc);
  const contingences = round2(contAcc);
  const profit = round2(profitAcc);
  const sousTotalAvantTaxes = round2(sousTotalHt + admin + contingences + profit);
  const tps = round2(sousTotalAvantTaxes * 0.05);
  const tvq = round2(sousTotalAvantTaxes * 0.09975);
  const total = round2(sousTotalAvantTaxes + tps + tvq);

  rows.push('');
  rows.push([csvEsc(''), csvEsc('Sous-total HT'), '', '', '', '', fmtNum(sousTotalHt), '', '', '', '', ''].join(','));
  if (admin > 0)
    rows.push([csvEsc(''), csvEsc(`Administration (${(admPct * 100).toFixed(2).replace(/\.?0+$/, '')}%)`), '', '', '', '', fmtNum(admin), '', '', '', '', ''].join(','));
  if (contingences > 0)
    rows.push([csvEsc(''), csvEsc(`Contingences (${(conPct * 100).toFixed(2).replace(/\.?0+$/, '')}%)`), '', '', '', '', fmtNum(contingences), '', '', '', '', ''].join(','));
  if (profit > 0)
    rows.push([csvEsc(''), csvEsc(`Profit (${(proPct * 100).toFixed(2).replace(/\.?0+$/, '')}%)`), '', '', '', '', fmtNum(profit), '', '', '', '', ''].join(','));
  rows.push([csvEsc(''), csvEsc('Sous-total avant taxes'), '', '', '', '', fmtNum(sousTotalAvantTaxes), '', '', '', '', ''].join(','));
  rows.push([csvEsc(''), csvEsc('TPS (5%)'), '', '', '', '', fmtNum(tps), '', '', '', '', ''].join(','));
  rows.push([csvEsc(''), csvEsc('TVQ (9.975%)'), '', '', '', '', fmtNum(tvq), '', '', '', '', ''].join(','));
  rows.push([csvEsc(''), csvEsc('TOTAL TTC'), '', '', '', '', fmtNum(total), '', '', '', '', ''].join(','));

  return rows.join('\n');
}

/* ── Defauts conditions/exclusions (backend fallback miroir pour placeholder) ── */
const DEFAULT_CONDITIONS_PLACEHOLDER = [
  "Ce devis est valide pour une periode de 30 jours a compter de la date d'emission.",
  'Calendrier de paiement: 30% a la signature, 40% en cours de travaux, 30% a la fin des travaux.',
  "Garantie de 1 an sur la main-d'oeuvre et materiaux, selon les normes RBQ.",
  "Les travaux debuteront dans un delai convenu apres l'acceptation du devis.",
  "Toute modification au devis fera l'objet d'un avenant signe par les deux parties.",
].join('\n');

const DEFAULT_EXCLUSIONS_PLACEHOLDER = [
  'Travaux de demolition non mentionnes dans la description des travaux',
  'Reparation ou remplacement des fondations existantes',
  'Travaux de decontamination des sols ou des materiaux',
  "Travaux d'amenagement paysager et de plantation",
  'Permis et frais de ville (a la charge du client)',
].join('\n');

/* ── Sous-composant: edition Conditions & Exclusions du devis ── */
function DevisConditionsEditor({ selected, onSave }: { selected: Devis; onSave: (payload: Partial<Devis>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [cond, setCond] = useState(selected.conditionsText ?? '');
  const [excl, setExcl] = useState(selected.exclusionsText ?? '');
  // Error feedback per-field so a failed save is visible (instead of silent)
  const [condError, setCondError] = useState<string | null>(null);
  const [exclError, setExclError] = useState<string | null>(null);

  // Sync textareas ONLY when the user selects a different devis. Re-fetch of
  // the same devis (after save) must NOT clobber in-progress edits — the
  // useEffect depends solely on selected.id to avoid stale-dep overwrites.
  // Also clears any leftover error badge from the previous devis.
  const lastSyncedId = useRef<number | null>(null);
  useEffect(() => {
    if (lastSyncedId.current !== selected.id) {
      setCond(selected.conditionsText ?? '');
      setExcl(selected.exclusionsText ?? '');
      setCondError(null);
      setExclError(null);
      lastSyncedId.current = selected.id;
    }
  }, [selected.id]);

  const showCond = selected.showConditions !== false;
  const showExcl = selected.showExclusions !== false;
  const usingDefaultCond = !selected.conditionsText || !selected.conditionsText.trim();
  const usingDefaultExcl = !selected.exclusionsText || !selected.exclusionsText.trim();

  const saveCond = async () => {
    const trimmed = cond.trim();
    // Always clear error on blur — even if nothing changed, user has moved on
    // and a stale badge from a previous failed attempt should not linger.
    setCondError(null);
    if ((selected.conditionsText ?? '').trim() === trimmed) return;
    try { await onSave({ conditionsText: trimmed }); }
    catch (e: any) { setCondError(e?.response?.data?.detail || 'Erreur sauvegarde'); }
  };
  const saveExcl = async () => {
    const trimmed = excl.trim();
    setExclError(null);
    if ((selected.exclusionsText ?? '').trim() === trimmed) return;
    try { await onSave({ exclusionsText: trimmed }); }
    catch (e: any) { setExclError(e?.response?.data?.detail || 'Erreur sauvegarde'); }
  };
  const resetCond = async () => {
    setCond('');
    setCondError(null);
    try { await onSave({ conditionsText: '' }); }
    catch (e: any) { setCondError(e?.response?.data?.detail || 'Erreur réinitialisation'); }
  };
  const resetExcl = async () => {
    setExcl('');
    setExclError(null);
    try { await onSave({ exclusionsText: '' }); }
    catch (e: any) { setExclError(e?.response?.data?.detail || 'Erreur réinitialisation'); }
  };

  return (
    <div className="mt-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50"
      >
        <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300 font-medium">
          {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
          <FileText size={13} className="text-gray-400" />
          Conditions &amp; Exclusions
        </span>
        <span className="text-[10px] text-gray-400">
          {usingDefaultCond && usingDefaultExcl ? 'Défauts' : 'Personnalisé'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Conditions */}
          <div className={showCond ? '' : 'opacity-40'}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={async () => { try { await onSave({ showConditions: !showCond } as Partial<Devis>); } catch { /* ignore */ } }}
                  className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  title={showCond ? 'Masquer la section Conditions' : 'Afficher la section Conditions'}
                >
                  {showCond ? <Eye size={12} className="text-gray-400" /> : <EyeOff size={12} className="text-amber-500" />}
                </button>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Conditions</span>
                {usingDefaultCond && <span className="text-[10px] text-gray-400 italic">(défauts de l'entreprise)</span>}
              </div>
              {!usingDefaultCond && (
                <button
                  onClick={resetCond}
                  className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  title="Réinitialiser aux défauts de l'entreprise"
                >
                  <RotateCcw size={10} /> Réinitialiser
                </button>
              )}
            </div>
            <textarea
              value={cond}
              onChange={(e) => setCond(e.target.value)}
              onBlur={saveCond}
              placeholder={DEFAULT_CONDITIONS_PLACEHOLDER}
              rows={5}
              className={`w-full text-xs px-2 py-1.5 border rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-mono resize-y focus:ring-1 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 ${condError ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
            />
            {condError ? (
              <div className="text-[10px] text-red-500 mt-0.5">{condError}</div>
            ) : (
              <div className="text-[10px] text-gray-400 mt-0.5">Une ligne par condition. Les puces sont ajoutées automatiquement.</div>
            )}
          </div>

          {/* Exclusions */}
          <div className={showExcl ? '' : 'opacity-40'}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={async () => { try { await onSave({ showExclusions: !showExcl } as Partial<Devis>); } catch { /* ignore */ } }}
                  className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  title={showExcl ? 'Masquer la section Exclusions' : 'Afficher la section Exclusions'}
                >
                  {showExcl ? <Eye size={12} className="text-gray-400" /> : <EyeOff size={12} className="text-amber-500" />}
                </button>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Exclusions</span>
                {usingDefaultExcl && <span className="text-[10px] text-gray-400 italic">(défauts de l'entreprise)</span>}
              </div>
              {!usingDefaultExcl && (
                <button
                  onClick={resetExcl}
                  className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  title="Réinitialiser aux défauts de l'entreprise"
                >
                  <RotateCcw size={10} /> Réinitialiser
                </button>
              )}
            </div>
            <textarea
              value={excl}
              onChange={(e) => setExcl(e.target.value)}
              onBlur={saveExcl}
              placeholder={DEFAULT_EXCLUSIONS_PLACEHOLDER}
              rows={6}
              className={`w-full text-xs px-2 py-1.5 border rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-mono resize-y focus:ring-1 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 ${exclError ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
            />
            {exclError ? (
              <div className="text-[10px] text-red-500 mt-0.5">{exclError}</div>
            ) : (
              <div className="text-[10px] text-gray-400 mt-0.5">Une ligne par exclusion. La numérotation est ajoutée automatiquement.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sous-composant: resume financier avec calcul temps reel ── */
function DevisFinancialSummary({ selected, onSave }: { selected: Devis; onSave: (payload: Partial<Devis>) => Promise<void> }) {
  const ht = selected.totalTravaux || 0;
  const [admPct, setAdmPct] = useState(selected.administrationPct ?? 3);
  const [conPct, setConPct] = useState(selected.contingencesPct ?? 12);
  const [proPct, setProPct] = useState(selected.profitPct ?? 15);
  const [admAmt, setAdmAmt] = useState<number | null>(null);
  const [conAmt, setConAmt] = useState<number | null>(null);
  const [proAmt, setProAmt] = useState<number | null>(null);

  // Raw string state for inputs — allows intermediate values like "", "3.", "0."
  const [admPctStr, setAdmPctStr] = useState<string | null>(null);
  const [conPctStr, setConPctStr] = useState<string | null>(null);
  const [proPctStr, setProPctStr] = useState<string | null>(null);
  const [admAmtStr, setAdmAmtStr] = useState<string | null>(null);
  const [conAmtStr, setConAmtStr] = useState<string | null>(null);
  const [proAmtStr, setProAmtStr] = useState<string | null>(null);

  // Sync state quand le devis change (ex: apres sauvegarde)
  useEffect(() => {
    setAdmPct(selected.administrationPct ?? 3);
    setConPct(selected.contingencesPct ?? 12);
    setProPct(selected.profitPct ?? 15);
    setAdmAmt(null);
    setConAmt(null);
    setProAmt(null);
    setAdmPctStr(null);
    setConPctStr(null);
    setProPctStr(null);
    setAdmAmtStr(null);
    setConAmtStr(null);
    setProAmtStr(null);
  }, [selected.id, selected.administrationPct, selected.contingencesPct, selected.profitPct]);

  // Calcul en temps reel
  const administration = admAmt !== null ? admAmt : Math.round(ht * admPct / 100 * 100) / 100;
  const contingences = conAmt !== null ? conAmt : Math.round(ht * conPct / 100 * 100) / 100;
  const profit = proAmt !== null ? proAmt : Math.round(ht * proPct / 100 * 100) / 100;
  const totalAvantTaxes = Math.round((ht + administration + contingences + profit) * 100) / 100;
  const tps = Math.round(totalAvantTaxes * 0.05 * 100) / 100;
  const tvq = Math.round(totalAvantTaxes * 0.09975 * 100) / 100;
  const totalTtc = Math.round((totalAvantTaxes + tps + tvq) * 100) / 100;

  const rows = [
    { label: selected.administrationLabel || 'Administration', defaultLabel: 'Administration', labelKey: 'administrationLabel' as keyof Devis, pct: admPct, setPct: setAdmPct, amt: administration, setAmt: setAdmAmt, pctKey: 'administrationPct' as const, amtKey: 'administration' as const, showKey: 'showAdministration' as keyof Devis, pctStr: admPctStr, setPctStr: setAdmPctStr, amtStr: admAmtStr, setAmtStr: setAdmAmtStr },
    { label: selected.contingencesLabel || 'Contingences', defaultLabel: 'Contingences', labelKey: 'contingencesLabel' as keyof Devis, pct: conPct, setPct: setConPct, amt: contingences, setAmt: setConAmt, pctKey: 'contingencesPct' as const, amtKey: 'contingences' as const, showKey: 'showContingences' as keyof Devis, pctStr: conPctStr, setPctStr: setConPctStr, amtStr: conAmtStr, setAmtStr: setConAmtStr },
    { label: selected.profitLabel || 'Profit', defaultLabel: 'Profit', labelKey: 'profitLabel' as keyof Devis, pct: proPct, setPct: setProPct, amt: profit, setAmt: setProAmt, pctKey: 'profitPct' as const, amtKey: 'profit' as const, showKey: 'showProfit' as keyof Devis, pctStr: proPctStr, setPctStr: setProPctStr, amtStr: proAmtStr, setAmtStr: setProAmtStr },
  ];

  return (
    <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-1 text-sm">
      <div className="flex justify-between"><span className="text-gray-500">Sous-total HT</span><span>{formatCurrency(totalAvantTaxes)}</span></div>
      <div className="text-[10px] text-gray-400 -mt-0.5 mb-0.5">Dont majoration incluse dans les prix unitaires :</div>
      {rows.map(({ label, labelKey, pct, setPct, amt, setAmt, pctKey, amtKey, showKey, pctStr, setPctStr, amtStr, setAmtStr }) => {
        const isVisible = selected[showKey] !== false;
        return (
        <div key={pctKey} className={`flex justify-between items-center${!isVisible ? ' opacity-40' : ''}`}>
          <span className="text-gray-500 flex items-center gap-1">
            <button
              onClick={async () => { try { await onSave({ [showKey]: !isVisible } as Partial<Devis>); } catch { /* ignore */ } }}
              className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              title={isVisible ? 'Masquer dans la soumission' : 'Afficher dans la soumission'}
            >
              {isVisible ? <Eye size={11} className="text-gray-400" /> : <EyeOff size={11} className="text-amber-500" />}
            </button>
            <input
              key={`${selected.id}-${labelKey}`}
              type="text"
              className="w-24 px-1 py-0.5 text-xs border border-transparent hover:border-gray-300 dark:hover:border-gray-600 rounded bg-transparent focus:bg-white dark:focus:bg-gray-700 focus:border-gray-300 dark:focus:border-gray-600 text-gray-500"
              defaultValue={label}
              onBlur={async (e) => {
                const val = e.target.value.trim() || label;
                e.target.value = val;
                if (val === (selected[labelKey] || label)) return;
                try { await onSave({ [labelKey]: val } as Partial<Devis>); } catch { /* ignore */ }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <input
              type="number"
              step="0.5"
              min="0"
              max="100"
              className="w-14 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-center"
              value={pctStr !== null ? pctStr : pct}
              onChange={(e) => {
                const raw = e.target.value;
                setPctStr(raw);
                const val = parseFloat(raw);
                if (!isNaN(val) && val >= 0 && val <= 100) { setPct(val); setAmt(null); }
              }}
              onBlur={async () => {
                setPctStr(null);
                if (pct === selected[pctKey]) return;
                try { await onSave({ [pctKey]: pct }); } catch { /* ignore */ }
              }}
            />
            <span className="text-xs">%</span>
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-28 px-1 py-0.5 text-xs text-right border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            value={amtStr !== null ? amtStr : (amt ?? 0).toFixed(2)}
            onChange={(e) => {
              const raw = e.target.value;
              setAmtStr(raw);
              const val = parseFloat(raw);
              if (!isNaN(val) && val >= 0) {
                setAmt(val);
                if (ht > 0) setPct(Math.round(val / ht * 100 * 10000) / 10000);
              }
            }}
            onBlur={async () => {
              setAmtStr(null);
              if (Math.abs(amt - (selected[amtKey] || 0)) < 0.005) return;
              try { await onSave({ [amtKey]: amt }); } catch { /* ignore */ }
            }}
          />
        </div>
        );
      })}
      <div className="flex justify-between border-t pt-1 border-gray-200 dark:border-gray-700"><span className="text-gray-500">TPS (5%)</span><span>{formatCurrency(tps)}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">TVQ (9.975%)</span><span>{formatCurrency(tvq)}</span></div>
      <div className="flex justify-between font-bold border-t pt-1 border-gray-200 dark:border-gray-700">
        <span>Total TTC</span><span>{formatCurrency(totalTtc)}</span>
      </div>
      {/* Column visibility toggles for HTML export */}
      <div className="border-t pt-2 mt-2 border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-400 uppercase tracking-wide">Colonnes soumission</span>
        <div className="mt-1 space-y-0.5">
          {([
            { key: 'showUnite' as keyof Devis, label: 'Unité', defaultOn: true },
            { key: 'showQuantite' as keyof Devis, label: 'Quantité', defaultOn: true },
            { key: 'showPrixUnitaire' as keyof Devis, label: 'Prix unitaire', defaultOn: true },
            { key: 'showMontantLigne' as keyof Devis, label: 'Montant par ligne', defaultOn: true },
            { key: 'showMoMat' as keyof Devis, label: 'MO et MAT', defaultOn: false },
          ] as const).map(({ key, label, defaultOn }) => {
            const vis = defaultOn ? selected[key] !== false : selected[key] === true;
            return (
              <div key={key} className={`flex items-center gap-1.5${!vis ? ' opacity-40' : ''}`}>
                <button
                  onClick={async () => { try { await onSave({ [key]: !vis } as Partial<Devis>); } catch { /* ignore */ } }}
                  className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  title={vis ? 'Masquer dans la soumission' : 'Afficher dans la soumission'}
                >
                  {vis ? <Eye size={11} className="text-gray-400" /> : <EyeOff size={11} className="text-amber-500" />}
                </button>
                <span className="text-xs text-gray-500">{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const STATUT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'Brouillon', label: 'Brouillon' },
  { value: 'Envoye', label: 'Envoyé' },
  { value: 'Accepte', label: 'Accepté' },
  { value: 'Refuse', label: 'Refusé' },
  { value: 'Expire', label: 'Expiré' },
];

const STATUT_COLORS: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'indigo' | 'amber'> = {
  'Brouillon': 'gray', 'Valide': 'blue', 'Envoye': 'indigo',
  'En attente': 'yellow', 'Accepte': 'green', 'Refuse': 'red',
  'Termine': 'green', 'Annule': 'red', 'Expire': 'amber',
};

const PRIORITE_OPTIONS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'CRITIQUE', label: 'Critique' },
];

// Items with these categories are computed from % on the devis (admin/contingences/profit),
// not persisted as lignes — exclude them from apply and preview paths for coherence with
// Metre and Estimation IA flows. Module-level regex to avoid recompiling on each render.
const MANUEL_EXCLUDED_CATS = /^(?:\d+\.\d+\s*-\s*)?(administration|contingences?|profit|gestion de projet|frais g[eé]n[eé]raux)$/i;

const TACHES_PRODUCTION = [
  { value: '', label: 'Aucune' },
  { value: '1.1 Definir les besoins et objectifs du projet', label: '1.1 Définir les besoins et objectifs' },
  { value: '1.2 Concevoir les plans architecturaux', label: '1.2 Concevoir les plans architecturaux' },
  { value: '1.3 Etablir un budget detaille', label: '1.3 Établir un budget détaillé' },
  { value: '1.4 Créer un calendrier prévisionnel', label: '1.4 Créer un calendrier prévisionnel' },
  { value: '1.5 Obtenir les permis de construire', label: '1.5 Obtenir les permis de construire' },
  { value: '2.1 Installer les clotures de securite', label: '2.1 Installer les clôtures de sécurité' },
  { value: '2.2 Mettre en place la signalisation', label: '2.2 Mettre en place la signalisation' },
  { value: '3.1 Deconnecter les services publics', label: '3.1 Déconnecter les services publics' },
  { value: '3.3 Demolir la structure existante', label: '3.3 Démolir la structure existante' },
  { value: '4.2 Creuser pour les fondations', label: '4.2 Creuser pour les fondations' },
  { value: '5.3 Couler les fondations', label: '5.3 Couler les fondations' },
  { value: '6.1 Installer les poutres principales', label: '6.1 Installer les poutres principales' },
  { value: '6.3 Poser la charpente de toit', label: '6.3 Poser la charpente de toit' },
  { value: '7.2 Poser les bardeaux', label: '7.2 Poser les bardeaux' },
  { value: '8.1 Installer isolation thermique', label: '8.1 Installer isolation thermique' },
  { value: '9.1 Installer le panneau electrique', label: '9.1 Installer le panneau électrique' },
  { value: '10.1 Installer la tuyauterie principale', label: '10.1 Installer la tuyauterie principale' },
  { value: '11.1 Installer le systeme de chauffage', label: '11.1 Installer le système de chauffage' },
  { value: '12.1 Monter les cloisons seches', label: '12.1 Monter les cloisons sèches' },
  { value: '12.4 Peindre les murs et plafonds', label: '12.4 Peindre les murs et plafonds' },
  { value: '13.2 Installer les revetements de sol', label: '13.2 Installer les revêtements de sol' },
  { value: '14.2 Monter les armoires de cuisine', label: '14.2 Monter les armoires de cuisine' },
  { value: '15.2 Installer les portes et fenetres', label: '15.2 Installer les portes et fenêtres' },
  { value: '16.3 Inspecter la qualite', label: '16.3 Inspecter la qualité' },
  { value: '16.4 Preparer la livraison', label: '16.4 Préparer la livraison' },
];

export default function DevisPage() {
  const authUser = useAuthStore((s) => s.user);
  const isAdmin = authUser?.role === 'admin';
  const [devisList, setDevisList] = useState<Devis[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statutFilter, setStatutFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Devis | null>(null);
  const [form, setForm] = useState({
    nomProjet: '', poClient: '', description: '', clientCompanyId: '',
    clientContactId: '', clientNomDirect: '', statut: 'Brouillon',
    priorite: 'NORMAL', tache: '', dateSoumis: '', datePrevu: '',
    dateFin: '', prixEstime: '0',
  });
  const perPage = 20;

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Devis>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Add line state
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineForm, setLineForm] = useState({ description: '', quantite: '1', unite: 'unite', prixUnitaire: '0' });
  const [lineLoading, setLineLoading] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);

  // Edit line state
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [editLineForm, setEditLineForm] = useState({
    description: '', quantite: '1', unite: 'unite', prixUnitaire: '0',
    moPct: '', matPct: '',
    // Per-line markup overrides (empty string = inherit devis-level %).
    adminPctLigne: '', contingencePctLigne: '', profitPctLigne: '',
  });
  const [editLineLoading, setEditLineLoading] = useState(false);

  // Inline date editing in list
  const [editingDateCell, setEditingDateCell] = useState<{ id: number; field: 'datePrevu' | 'dateFin' } | null>(null);
  const saveInlineDate = async (devisId: number, field: 'datePrevu' | 'dateFin', value: string) => {
    try {
      await devisApi.updateDevis(devisId, { [field]: value || undefined } as any);
      setDevisList((prev) => prev.map((d) => d.id === devisId ? { ...d, [field]: value || undefined } : d));
    } catch { setError('Erreur lors de la sauvegarde de la date'); }
    setEditingDateCell(null);
  };

  // HTML Preview state (persisted devis HTML — from "Apercu" button on selected devis)
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [xlsxLoading, setXlsxLoading] = useState(false);

  // Manuel tab ephemeral preview (items not yet persisted)
  const [showManuelPreview, setShowManuelPreview] = useState(false);
  const [manuelPreviewHtml, setManuelPreviewHtml] = useState('');
  const [manuelPreviewLoading, setManuelPreviewLoading] = useState(false);

  // Send modal state
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{ publicUrl: string; message: string; emailSent: boolean } | null>(null);

  // New feature state
  const [viewMode, setViewMode] = useState<'list' | 'table' | 'cards'>('list');
  const [statistics, setStatistics] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'devis' | 'statistiques' | 'ia' | 'metre-pdf' | 'manuel' | 'conditions'>('devis');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);

  const toggleSelectId = (id: string | number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleBatchUpdate = async (statut: string) => {
    if (selectedIds.length === 0) return;
    try {
      const res = await devisApi.batchUpdateDevis({ devisIds: selectedIds, statut });
      setSuccess(res.message);
      setSelectedIds([]);
      fetchDevis();
      fetchStatistics();
    } catch { setError('Erreur lors de la mise à jour en lot'); }
  };

  const fetchDevis = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await devisApi.listDevis({
        page, perPage, search: search || undefined, statut: statutFilter || undefined,
        typeSoumission: typeFilter || undefined,
      });
      setDevisList(res.items);
      setTotal(res.total);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [page, search, statutFilter, typeFilter]);

  useEffect(() => { fetchDevis(); fetchStatistics(); fetchCompaniesAndContacts(); }, [fetchDevis]);

  const fetchCompaniesAndContacts = async () => {
    try {
      const [compRes, contRes] = await Promise.all([
        companiesApi.listCompanies({ perPage: 100 }),
        companiesApi.listContacts({ perPage: 100 }),
      ]);
      setCompanies(compRes.items);
      setContacts(contRes.items);
    } catch { /* ignore */ }
  };

  // Auto-open item from ?open= query param (e.g. from calendar double-click)
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenHandled = useRef(false);
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && !autoOpenHandled.current) {
      autoOpenHandled.current = true;
      handleSelect(Number(openId));
      searchParams.delete('open');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  // Reset Manuel ephemeral preview when the selected devis changes — prevents
  // a stale preview (with devis A's numero) from showing for devis B.
  useEffect(() => {
    setShowManuelPreview(false);
    setManuelPreviewHtml('');
    setManuelPreviewLoading(false);
  }, [selected?.id]);

  // Manuel tab state
  const [manuelItems, setManuelItems] = useState<SelectedItem[]>([]);
  const [manuelTotals, setManuelTotals] = useState<TemplateTotals | null>(null);
  const [manuelLoading, setManuelLoading] = useState(false);
  const [manuelConfig, setManuelConfig] = useState<ConstructionConfig | undefined>(undefined);

  // Manuel tab: Fiche client — shown only when no devis is selected.
  // Mirrors the UX in EstimationIA / Metre so the 3 creation flows stay aligned.
  const [manuelClientForm, setManuelClientForm] = useState<ClientInfo>({
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

  const handleCreate = async () => {
    if (!form.nomProjet.trim()) return;
    try {
      const createBody: any = {
        nomProjet: form.nomProjet,
        description: form.description || undefined,
        poClient: form.poClient || undefined,
        clientCompanyId: form.clientCompanyId ? Number(form.clientCompanyId) : undefined,
        clientContactId: form.clientContactId ? Number(form.clientContactId) : undefined,
        clientNomDirect: form.clientNomDirect || undefined,
        priorite: form.priorite || undefined,
        tache: form.tache || undefined,
        dateSoumis: form.dateSoumis || undefined,
        datePrevu: form.datePrevu || undefined,
        dateFin: form.dateFin || undefined,
        prixEstime: parseFloat(form.prixEstime) || undefined,
      };
      const newDevis = await devisApi.createDevis(createBody);
      setShowCreate(false);
      setForm({
        nomProjet: '', poClient: '', description: '', clientCompanyId: '',
        clientContactId: '', clientNomDirect: '', statut: 'Brouillon',
        priorite: 'NORMAL', tache: '', dateSoumis: '', datePrevu: '',
        dateFin: '', prixEstime: '0',
      });
      fetchDevis();
      fetchStatistics();
      handleSelect(newDevis.id);
    } catch (err: any) { setError(err?.response?.data?.detail || 'Erreur de création'); }
  };

  // Manuel tab: apply template items to selected devis
  // Memoized to avoid re-filtering on every parent re-render.
  const manuelFilledItems = useMemo(
    () => manuelItems.filter(i => i.montant > 0),
    [manuelItems],
  );

  // Backend devis.py:1044 exige quantite > 0 (gt=0). Bien que `manuelFilledItems`
  // filtre montant > 0 (qui implique normalement qty > 0), on ajoute ici une
  // défense en profondeur explicite contre tout désync montant/quantite.
  const manuelWorkItems = useMemo(
    () => manuelFilledItems.filter(
      it => !MANUEL_EXCLUDED_CATS.test((it.categoryName || '').trim()) && (it.quantite ?? 0) > 0,
    ),
    [manuelFilledItems],
  );

  const handleManuelApply = async () => {
    if (manuelWorkItems.length === 0) return;
    setManuelLoading(true);
    try {
      const batch = manuelWorkItems.map(it => ({
        description: it.title, quantite: it.quantite, unite: it.unite,
        prixUnitaire: it.prixUnitaire, categorie: it.categoryName, notesLigne: it.description,
      }));
      const excluded = manuelFilledItems.length - manuelWorkItems.length;
      const zeroQty = manuelFilledItems.filter(it => (it.quantite ?? 0) <= 0 && !MANUEL_EXCLUDED_CATS.test((it.categoryName || '').trim())).length;
      const adminSkipped = excluded - zeroQty;

      if (selected) {
        // Add lines to the already-selected devis.
        const res = await devisApi.addDevisLignesBatch(selected.id, batch);
        setActiveTab('devis');
        handleSelect(selected.id);
        const notes: string[] = [];
        if (adminSkipped > 0) notes.push(`${adminSkipped} lignes admin/contingences exclues`);
        if (zeroQty > 0) notes.push(`${zeroQty} lignes ignorées (quantité 0)`);
        setSuccess(
          `${res.count} lignes ajoutées au devis depuis le template` +
            (notes.length > 0 ? ` (${notes.join(', ')})` : ''),
        );
      } else {
        // No devis selected — create a new one from the fiche client, then add lines.
        const devis = await devisApi.createDevis({
          nomProjet: manuelClientForm.nomProjet.trim() || 'Soumission Manuel',
          clientCompanyId: manuelClientForm.clientCompanyId,
          clientContactId: manuelClientForm.clientContactId,
          clientNomDirect: manuelClientForm.clientNomDirect || undefined,
          poClient: manuelClientForm.poClient || undefined,
          datePrevu: manuelClientForm.datePrevu || undefined,
          dateSoumis: manuelClientForm.dateSoumis || undefined,
          priorite: manuelClientForm.priorite || undefined,
          description: manuelClientForm.description || undefined,
        });
        await devisApi.addDevisLignesBatch(devis.id, batch);
        setActiveTab('devis');
        fetchDevis();
        handleSelect(devis.id);
        const notes: string[] = [];
        if (adminSkipped > 0) notes.push(`${adminSkipped} lignes admin/contingences exclues`);
        if (zeroQty > 0) notes.push(`${zeroQty} lignes ignorées (quantité 0)`);
        setSuccess(
          `Devis "${devis.numeroDevis}" créé avec ${manuelWorkItems.length} lignes depuis le template` +
            (notes.length > 0 ? ` (${notes.join(', ')})` : ''),
        );
        setManuelClientForm({
          nomProjet: '', clientCompanyId: undefined, clientContactId: undefined,
          clientNomDirect: '', poClient: '', datePrevu: '', dateSoumis: '',
          priorite: 'NORMAL', description: '',
        });
      }
      setManuelItems([]);
      setManuelConfig(undefined);
      setManuelTotals(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de l\'ajout des lignes');
    }
    finally { setManuelLoading(false); }
  };

  // Manuel tab: preview HTML with items (no persistence) — same template as DevisPage preview
  // Uses a separate modal (showManuelPreview) to make clear it's an ephemeral preview,
  // not the persisted devis HTML. Prevents the user from thinking the items are applied.
  const handleManuelPreviewHtml = async () => {
    if (!selected || manuelWorkItems.length === 0) return;
    setManuelPreviewLoading(true);
    setShowManuelPreview(true);
    setManuelPreviewHtml('');
    try {
      const extraItems = manuelWorkItems.map((it, idx) => ({
        description: it.title,
        quantite: it.quantite,
        unite: it.unite,
        prixUnitaire: it.prixUnitaire,
        categorie: it.categoryName,
        notesLigne: it.description,
        sequenceLigne: idx + 1,
      }));
      const res = await devisApi.previewHtmlWithItems(selected.id, extraItems);
      setManuelPreviewHtml(res.html);
    } catch {
      setError('Erreur lors de la generation du preview HTML');
      setShowManuelPreview(false);
    } finally {
      setManuelPreviewLoading(false);
    }
  };

  const handleSelect = async (id: number) => {
    try {
      const d = await devisApi.getDevis(id);
      setSelected(d);
    } catch { setError('Erreur'); }
  };

  const refreshSelected = async () => {
    if (!selected) return;
    try {
      const d = await devisApi.getDevis(selected.id);
      setSelected(d);
    } catch { /* ignore */ }
  };

  const openEdit = (devis: Devis) => {
    setEditForm({
      nomProjet: devis.nomProjet,
      description: devis.description || '',
      statut: devis.statut,
      datePrevu: devis.datePrevu || '',
      dateSoumis: devis.dateSoumis || '',
      dateFin: devis.dateFin || '',
      poClient: devis.poClient || '',
      clientCompanyId: devis.clientCompanyId || undefined,
      clientContactId: devis.clientContactId || undefined,
      clientNomDirect: devis.clientNomDirect || '',
      priorite: devis.priorite || 'NORMAL',
      tache: devis.tache || '',
      prixEstime: devis.prixEstime || 0,
      typeSoumission: devis.typeSoumission || 'Détaillée',
    });
    setEditError(null);
    setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!selected || !editForm.nomProjet?.trim()) return;
    setEditLoading(true);
    setEditError(null);
    try {
      await devisApi.updateDevis(selected.id, editForm);
      setShowEdit(false);
      const updated = await devisApi.getDevis(selected.id);
      setSelected(updated);
      fetchDevis();
    } catch (err: any) {
      setEditError(err?.response?.data?.detail || 'Erreur lors de la mise à jour');
    } finally {
      setEditLoading(false);
    }
  };

  const handleAddLine = async () => {
    if (!selected || !lineForm.description.trim()) return;
    setLineLoading(true);
    setLineError(null);
    try {
      await devisApi.addDevisLigne(selected.id, {
        description: lineForm.description,
        quantite: parseFloat(lineForm.quantite) || 1,
        unite: lineForm.unite,
        prixUnitaire: parseFloat(lineForm.prixUnitaire) || 0,
      });
      setShowAddLine(false);
      setLineForm({ description: '', quantite: '1', unite: 'unite', prixUnitaire: '0' });
      await refreshSelected();
      fetchDevis();
    } catch (err: any) {
      setLineError(err?.response?.data?.detail || 'Erreur lors de l\'ajout de la ligne');
    } finally {
      setLineLoading(false);
    }
  };

  const handleDeleteLine = async (ligneId: number) => {
    if (!selected) return;
    if (!window.confirm('Supprimer cette ligne ?')) return;
    try {
      await devisApi.deleteDevisLigne(selected.id, ligneId);
      await refreshSelected();
      fetchDevis();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la suppression de la ligne');
    }
  };

  const startEditLine = (l: DevisLigne) => {
    setEditingLineId(l.id);
    setEditLineForm({
      description: l.description,
      quantite: String(l.quantite ?? 1),
      unite: l.unite || 'unite',
      prixUnitaire: String(l.prixUnitaire ?? 0),
      moPct: l.moPct != null ? String(l.moPct) : '',
      matPct: l.matPct != null ? String(l.matPct) : '',
      adminPctLigne: l.adminPctLigne != null ? String(l.adminPctLigne) : '',
      contingencePctLigne: l.contingencePctLigne != null ? String(l.contingencePctLigne) : '',
      profitPctLigne: l.profitPctLigne != null ? String(l.profitPctLigne) : '',
    });
  };

  // Empty string → null (inherit devis-level %), valid number 0-100 → that
  // value rounded to 0.01. Throws on invalid input so the caller can show a
  // precise error message instead of silently coercing to null (which would
  // make the user think their value was saved when in fact it was discarded).
  // Accepts both "." and "," decimal separators (fr-CA users often type "5,5").
  const parseLinePct = (raw: string): number | null => {
    const trimmed = raw.trim().replace(',', '.');
    if (trimmed === '') return null;
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n)) {
      throw new Error('Pourcentage invalide — entrez un nombre entre 0 et 100');
    }
    if (n < 0 || n > 100) {
      throw new Error('Le pourcentage doit être entre 0 et 100');
    }
    return Math.round(n * 100) / 100;
  };

  const resetLineMarkupToInherit = () => {
    setEditLineForm(f => ({ ...f, adminPctLigne: '', contingencePctLigne: '', profitPctLigne: '' }));
  };

  // Auto-complete the other MO/MAT input when one changes. Empty = reset to auto.
  const handleMoPctChange = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setEditLineForm(f => ({ ...f, moPct: '', matPct: '' }));
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      setEditLineForm(f => ({ ...f, moPct: trimmed, matPct: String(Math.round((100 - n) * 100) / 100) }));
    } else {
      setEditLineForm(f => ({ ...f, moPct: trimmed }));
    }
  };
  const handleMatPctChange = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setEditLineForm(f => ({ ...f, moPct: '', matPct: '' }));
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      setEditLineForm(f => ({ ...f, matPct: trimmed, moPct: String(Math.round((100 - n) * 100) / 100) }));
    } else {
      setEditLineForm(f => ({ ...f, matPct: trimmed }));
    }
  };
  const resetMoMatToAuto = () => {
    setEditLineForm(f => ({ ...f, moPct: '', matPct: '' }));
  };

  const handleSaveEditLine = async () => {
    if (!selected || editingLineId === null) return;
    setEditLineLoading(true);
    try {
      const moRaw = editLineForm.moPct.trim();
      const matRaw = editLineForm.matPct.trim();
      const moPct = moRaw === '' ? null : (Number.isFinite(parseFloat(moRaw)) ? parseFloat(moRaw) : null);
      const matPct = matRaw === '' ? null : (Number.isFinite(parseFloat(matRaw)) ? parseFloat(matRaw) : null);
      // Parse the 3 markup overrides up-front so a validation error throws
      // BEFORE the network call. This way the user sees the precise reason
      // ("entre 0 et 100") instead of a generic save failure or — worse —
      // the input being silently coerced to null and "inheriting" the devis
      // global without their consent.
      let adminPctLigne: number | null;
      let contingencePctLigne: number | null;
      let profitPctLigne: number | null;
      try {
        adminPctLigne = parseLinePct(editLineForm.adminPctLigne);
        contingencePctLigne = parseLinePct(editLineForm.contingencePctLigne);
        profitPctLigne = parseLinePct(editLineForm.profitPctLigne);
      } catch (validationErr: any) {
        setError(validationErr?.message || 'Pourcentage de majoration invalide');
        setEditLineLoading(false);
        return;
      }
      await devisApi.updateDevisLigne(selected.id, editingLineId, {
        description: editLineForm.description,
        quantite: parseFloat(editLineForm.quantite) || 1,
        unite: editLineForm.unite,
        prixUnitaire: parseFloat(editLineForm.prixUnitaire) || 0,
        moPct,
        matPct,
        adminPctLigne,
        contingencePctLigne,
        profitPctLigne,
      });
      setEditingLineId(null);
      await refreshSelected();
      fetchDevis();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Erreur lors de la mise à jour de la ligne');
    } finally {
      setEditLineLoading(false);
    }
  };

  // Generate HTML preview
  const handleGenerateHtml = async () => {
    if (!selected) return;
    setHtmlLoading(true);
    try {
      const res = await devisApi.generateHtml(selected.id);
      setHtmlContent(res.html);
      setShowHtmlPreview(true);
    } catch {
      setError('Erreur lors de la generation HTML');
    } finally {
      setHtmlLoading(false);
    }
  };

  // Send devis to client
  const handleSendDevis = async () => {
    if (!selected || !sendEmail.trim()) return;
    setSendLoading(true);
    setSendResult(null);
    try {
      const res = await devisApi.sendDevis(selected.id, sendEmail.trim());
      setSendResult({ publicUrl: res.publicUrl, message: res.message, emailSent: res.emailSent });
      setSuccess(`Soumission envoyée à ${sendEmail}`);
      await refreshSelected();
      fetchDevis();
    } catch {
      setError('Erreur lors de l\'envoi de la soumission');
    } finally {
      setSendLoading(false);
    }
  };

  const fetchStatistics = async () => {
    try {
      const stats = await devisApi.getDevisStatistics();
      setStatistics(stats);
    } catch {}
  };

  const handleConvertToProject = async (devisId: number) => {
    if (!confirm('Convertir cette soumission en projet?')) return;
    try {
      const result = await devisApi.convertDevisToProject(devisId);
      // Backend returns created: false when the devis already had a project
      // (idempotent path); show a distinct message so the user isn't misled.
      const wasCreated = result.created !== false;
      alert(
        wasCreated
          ? `Projet créé: ${result.projectId}`
          : `Un projet est déjà lié à cette soumission (ID: ${result.projectId})`,
      );
      const updated = await devisApi.getDevis(devisId);
      setSelected(updated);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || 'Erreur conversion');
    }
  };

  const lineMontant = (parseFloat(lineForm.quantite) || 0) * (parseFloat(lineForm.prixUnitaire) || 0);

  const { sortedItems: sortedDevis, sortConfig, requestSort } = useSortable(devisList);
  const { colWidths, startResize, autoFit } = useColumnResize({
    numeroDevis: 120,
    nomProjet: 200,
    clientNomDirect: 160,
    prixEstime: 120,
    statut: 110,
    typeSoumission: 110,
    datePrevu: 120,
    dateFin: 120,
    createdAt: 120,
  });

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Soumissions</h2>
      </div>

      {/* KPI Stats Cards — always visible */}
      {statistics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Total soumissions</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{statistics.total || 0}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Brouillons</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{statistics.brouillons || 0}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Envoyés</div>
            <div className="text-2xl font-bold text-blue-600">{statistics.envoyes || 0}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Taux acceptation</div>
            <div className="text-2xl font-bold text-green-600">{statistics.tauxAcceptation?.toFixed(1) || 0}%</div>
          </Card>
        </div>
      )}

      {/* Tab Bar */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
        <div className="flex gap-1 mb-4 border-b dark:border-gray-700 min-w-max md:min-w-0">
          {[
            { key: 'devis', label: 'Soumissions' },
            { key: 'ia', label: 'Estimation IA' },
            { key: 'metre-pdf', label: 'Métré' },
            { key: 'manuel', label: 'Manuel' },
            ...(isAdmin ? [{ key: 'conditions', label: 'Conditions' }] : []),
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Estimation IA Tab */}
      {activeTab === 'ia' && (
        <EstimationIA
          devisId={selected?.id}
          devisNom={selected?.nomProjet}
          onApplyToDevis={async (items: SoumissionItem[], _clientInfo: ClientInfo) => {
            if (!selected) return;
            try {
              // Filter out admin/contingences/profit items — these are calculated by devis %
              const EXCLUDED_CATS = /^(?:\d+\.\d+\s*-\s*)?(administration|contingences?|profit|gestion de projet|frais g[eé]n[eé]raux)$/i;
              // Backend devis.py:1044 exige quantite > 0 (gt=0). Une hallucination IA
              // produisant qty=0 ferait rejeter tout le batch en 422.
              const workItems = items.filter(it =>
                !EXCLUDED_CATS.test((it.categorie || '').trim()) && (it.quantite ?? 0) > 0,
              );
              const excluded = items.length - workItems.length;
              const zeroQty = items.filter(it => (it.quantite ?? 0) <= 0 && !EXCLUDED_CATS.test((it.categorie || '').trim())).length;
              const adminSkipped = excluded - zeroQty;
              const batch = workItems.map(it => ({
                description: it.description, quantite: it.quantite, unite: it.unite,
                prixUnitaire: it.prixUnitaire, categorie: it.categorie,
              }));
              const res = await devisApi.addDevisLignesBatch(selected.id, batch);
              setActiveTab('devis');
              handleSelect(selected.id);
              const notes: string[] = [];
              if (adminSkipped > 0) notes.push(`${adminSkipped} lignes admin/contingences exclues, calculees par les %`);
              if (zeroQty > 0) notes.push(`${zeroQty} lignes ignorées (quantité 0)`);
              setSuccess(`${res.count} lignes ajoutées au devis` + (notes.length > 0 ? ` (${notes.join(', ')})` : ''));
            } catch { setError('Erreur lors de l\'ajout des lignes'); }
          }}
          onCreateDevis={async (items: SoumissionItem[], clientInfo: ClientInfo) => {
            try {
              const devis = await devisApi.createDevis({
                nomProjet: clientInfo.nomProjet,
                clientCompanyId: clientInfo.clientCompanyId,
                clientContactId: clientInfo.clientContactId,
                clientNomDirect: clientInfo.clientNomDirect || undefined,
                poClient: clientInfo.poClient || undefined,
                datePrevu: clientInfo.datePrevu || undefined,
                dateSoumis: clientInfo.dateSoumis || undefined,
                priorite: clientInfo.priorite || undefined,
                description: clientInfo.description || undefined,
              });
              // Filter out admin/contingences/profit items — these are calculated by devis %
              const EXCLUDED_CATS = /^(?:\d+\.\d+\s*-\s*)?(administration|contingences?|profit|gestion de projet|frais g[eé]n[eé]raux)$/i;
              // Backend devis.py:1044 exige quantite > 0 (gt=0). Une hallucination IA
              // produisant qty=0 ferait rejeter tout le batch en 422.
              const workItems = items.filter(it =>
                !EXCLUDED_CATS.test((it.categorie || '').trim()) && (it.quantite ?? 0) > 0,
              );
              const excluded = items.length - workItems.length;
              const zeroQty = items.filter(it => (it.quantite ?? 0) <= 0 && !EXCLUDED_CATS.test((it.categorie || '').trim())).length;
              const adminSkipped = excluded - zeroQty;
              const batch = workItems.map(it => ({
                description: it.description, quantite: it.quantite, unite: it.unite,
                prixUnitaire: it.prixUnitaire, categorie: it.categorie,
              }));
              await devisApi.addDevisLignesBatch(devis.id, batch);
              setActiveTab('devis');
              fetchDevis();
              handleSelect(devis.id);
              const notes: string[] = [];
              if (adminSkipped > 0) notes.push(`${adminSkipped} lignes admin/contingences exclues`);
              if (zeroQty > 0) notes.push(`${zeroQty} lignes ignorées (quantité 0)`);
              setSuccess(`Devis "${devis.numeroDevis}" créé avec ${workItems.length} lignes` + (notes.length > 0 ? ` (${notes.join(', ')})` : ''));
            } catch { setError('Erreur lors de la création du devis'); }
          }}
        />
      )}

      {/* Métré Tab */}
      {activeTab === 'metre-pdf' && (
        <Suspense fallback={<div className="flex items-center justify-center py-12"><Spinner /> <span className="ml-2 text-gray-500">Chargement Métré...</span></div>}>
          <MetrePdf
            devisId={selected?.id}
            devisNom={selected?.nomProjet}
            onApplyToDevis={async (items: SoumissionItem[], _clientInfo: ClientInfo) => {
              if (!selected) return;
              try {
                const EXCLUDED_CATS = /^(?:\d+\.\d+\s*-\s*)?(administration|contingences?|profit|gestion de projet|frais g[eé]n[eé]raux)$/i;
                // Backend devis.py:1044 exige quantite > 0 (gt=0). Les composites BOM
                // auto-sélectionnés sans mesure correspondante produisent qty=0 -> 422.
                const workItems = items.filter(it =>
                  !EXCLUDED_CATS.test((it.categorie || '').trim()) && (it.quantite ?? 0) > 0,
                );
                const excluded = items.length - workItems.length;
                const zeroQty = items.filter(it => (it.quantite ?? 0) <= 0 && !EXCLUDED_CATS.test((it.categorie || '').trim())).length;
                const adminSkipped = excluded - zeroQty;
                const batch = workItems.map(it => ({
                  description: it.description, quantite: it.quantite, unite: it.unite,
                  prixUnitaire: it.prixUnitaire, categorie: it.categorie,
                }));
                const res = await devisApi.addDevisLignesBatch(selected.id, batch);
                setActiveTab('devis');
                handleSelect(selected.id);
                const notes: string[] = [];
                if (adminSkipped > 0) notes.push(`${adminSkipped} lignes admin/contingences exclues`);
                if (zeroQty > 0) notes.push(`${zeroQty} lignes ignorées (quantité 0)`);
                setSuccess(`${res.count} lignes ajoutées au devis depuis le Métré` + (notes.length > 0 ? ` (${notes.join(', ')})` : ''));
              } catch { setError('Erreur lors de l\'ajout des lignes'); }
            }}
            onCreateDevis={async (items: SoumissionItem[], clientInfo: ClientInfo) => {
              try {
                const devis = await devisApi.createDevis({
                  nomProjet: clientInfo.nomProjet,
                  clientCompanyId: clientInfo.clientCompanyId,
                  clientContactId: clientInfo.clientContactId,
                  clientNomDirect: clientInfo.clientNomDirect || undefined,
                  poClient: clientInfo.poClient || undefined,
                  datePrevu: clientInfo.datePrevu || undefined,
                  dateSoumis: clientInfo.dateSoumis || undefined,
                  priorite: clientInfo.priorite || undefined,
                  description: clientInfo.description || undefined,
                });
                const EXCLUDED_CATS = /^(?:\d+\.\d+\s*-\s*)?(administration|contingences?|profit|gestion de projet|frais g[eé]n[eé]raux)$/i;
                // Backend devis.py:1044 exige quantite > 0 (gt=0). Les composites BOM
                // auto-sélectionnés sans mesure correspondante produisent qty=0 -> 422.
                const workItems = items.filter(it =>
                  !EXCLUDED_CATS.test((it.categorie || '').trim()) && (it.quantite ?? 0) > 0,
                );
                const excluded = items.length - workItems.length;
                const zeroQty = items.filter(it => (it.quantite ?? 0) <= 0 && !EXCLUDED_CATS.test((it.categorie || '').trim())).length;
                const adminSkipped = excluded - zeroQty;
                const batch = workItems.map(it => ({
                  description: it.description, quantite: it.quantite, unite: it.unite,
                  prixUnitaire: it.prixUnitaire, categorie: it.categorie,
                }));
                await devisApi.addDevisLignesBatch(devis.id, batch);
                setActiveTab('devis');
                fetchDevis();
                handleSelect(devis.id);
                const notes: string[] = [];
                if (adminSkipped > 0) notes.push(`${adminSkipped} lignes admin/contingences exclues`);
                if (zeroQty > 0) notes.push(`${zeroQty} lignes ignorées (quantité 0)`);
                setSuccess(`Devis "${devis.numeroDevis}" créé avec ${workItems.length} lignes depuis le Métré` + (notes.length > 0 ? ` (${notes.join(', ')})` : ''));
              } catch { setError('Erreur lors de la création du devis'); }
            }}
          />
        </Suspense>
      )}

      {/* Manuel Tab */}
      {activeTab === 'manuel' && (
        <div className="space-y-6">
          {/* Connected devis banner */}
          {selected ? (
            <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Devis connecte : <strong>{selected.nomProjet}</strong> — les items du template seront ajoutés à ce devis
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <span className="text-sm text-amber-700 dark:text-amber-300">
                Aucun devis sélectionné — sélectionnez un devis dans l'onglet Soumissions, ou un nouveau sera créé
              </span>
            </div>
          )}

          {/* Fiche client / Informations du devis — shown only when no devis is selected */}
          {!selected && (
            <ClientInfoCard
              clientForm={manuelClientForm}
              onChange={setManuelClientForm}
              companies={companies}
              contacts={contacts}
              defaultOpen
            />
          )}

          {/* Construction Template */}
          <ConstructionTemplate
            inline
            initialItems={manuelItems}
            initialConfig={manuelConfig}
            onCancel={() => {}}
            onSave={(items, config, totals) => {
              setManuelItems(items);
              setManuelConfig(config);
              setManuelTotals(totals);
            }}
          />

          {/* Action Button */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            {selected && (
              <Button
                variant="outline"
                onClick={handleManuelPreviewHtml}
                disabled={manuelWorkItems.length === 0 || manuelLoading || manuelPreviewLoading}
                title="Preview la soumission avec les items du template, sans persister"
              >
                {manuelPreviewLoading ? 'Generation...' : 'Apercu Soumission HTML'}
              </Button>
            )}
            <Button onClick={handleManuelApply} disabled={manuelWorkItems.length === 0 || manuelLoading} isLoading={manuelLoading}>
              {selected
                ? `Appliquer au devis « ${selected.nomProjet} » (${manuelWorkItems.length} items — ${manuelTotals ? formatCurrency(manuelTotals.totalTtc) : '0,00 $'})`
                : `Créer un nouveau devis (${manuelWorkItems.length} items — ${manuelTotals ? formatCurrency(manuelTotals.totalTtc) : '0,00 $'})`}
            </Button>
          </div>
        </div>
      )}

      {/* Conditions & Exclusions par défaut — admin only.
       * Migrated from Configuration > Soumissions tab. Edits apply
       * to all newly created devis; existing devis can still override
       * per-devis in the editor. */}
      {activeTab === 'conditions' && isAdmin && (
        <DevisDefaultsTab />
      )}

      {activeTab === 'devis' && (
      <>
      {/* Batch Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-3">
          <CheckSquare size={16} className="text-blue-600" />
          <span className="text-sm text-blue-700 dark:text-blue-300">{selectedIds.length} soumission(s) selectionnee(s)</span>
          <select
            onChange={(e) => { if (e.target.value) handleBatchUpdate(e.target.value); e.target.value = ''; }}
            className="text-xs border rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600"
            defaultValue=""
          >
            <option value="" disabled>Changer le statut...</option>
            <option value="Brouillon">Brouillon</option>
            <option value="Envoye">Envoyé</option>
            <option value="Accepte">Accepté</option>
            <option value="Refuse">Refusé</option>
            <option value="Expire">Expiré</option>
          </select>
          <button onClick={() => setSelectedIds([])} className="text-xs text-gray-500 hover:text-gray-700">Désélectionner</button>
        </div>
      )}

      <CommandBar
        actions={[
          { label: 'Nouvelle soumission', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
          { label: 'Liste', onClick: () => setViewMode('list'), variant: viewMode === 'list' ? 'primary' : 'default' },
          { label: 'Tableau', onClick: () => setViewMode('table'), variant: viewMode === 'table' ? 'primary' : 'default' },
          { label: 'Cartes', onClick: () => setViewMode('cards'), variant: viewMode === 'cards' ? 'primary' : 'default' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-28 sm:w-36 shrink-0">
              <Select options={STATUT_OPTIONS} value={statutFilter}
                onChange={(e) => { setStatutFilter(e.target.value); setPage(1); }} />
            </div>
            <div className="w-28 sm:w-36 shrink-0">
              <Select
                options={[
                  { value: '', label: 'Tous types' },
                  { value: 'Détaillée', label: 'Détaillée' },
                  { value: 'Budgétaire', label: 'Budgétaire' },
                ]}
                value={typeFilter}
                onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        }
      />

      <div className="flex gap-6">
        <div className={`flex-1 ${selected ? 'hidden md:block max-w-full md:max-w-[55%]' : ''}`}>
          {isLoading ? <SkeletonPage /> : (
            <>
              {/* List View */}
              {viewMode === 'list' && (
              <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-2 py-3 w-10"><input type="checkbox" checked={selectedIds.length === devisList.length && devisList.length > 0} onChange={() => setSelectedIds(selectedIds.length === devisList.length ? [] : devisList.map(d => d.id))} className="rounded border-gray-300" /></th>
                        <SortableHeader sortKey="numeroDevis" sortConfig={sortConfig} onSort={requestSort} width={colWidths.numeroDevis} onResizeStart={(e) => startResize(e, 'numeroDevis')} onAutoFit={(e) => autoFit(e, 'numeroDevis')} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</SortableHeader>
                        <SortableHeader sortKey="nomProjet" sortConfig={sortConfig} onSort={requestSort} width={colWidths.nomProjet} onResizeStart={(e) => startResize(e, 'nomProjet')} onAutoFit={(e) => autoFit(e, 'nomProjet')} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Titre</SortableHeader>
                        <SortableHeader sortKey="clientNomDirect" sortConfig={sortConfig} onSort={requestSort} width={colWidths.clientNomDirect} onResizeStart={(e) => startResize(e, 'clientNomDirect')} onAutoFit={(e) => autoFit(e, 'clientNomDirect')} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Client</SortableHeader>
                        <SortableHeader sortKey="prixEstime" sortConfig={sortConfig} onSort={requestSort} width={colWidths.prixEstime} onResizeStart={(e) => startResize(e, 'prixEstime')} onAutoFit={(e) => autoFit(e, 'prixEstime')} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant</SortableHeader>
                        <SortableHeader sortKey="statut" sortConfig={sortConfig} onSort={requestSort} width={colWidths.statut} onResizeStart={(e) => startResize(e, 'statut')} onAutoFit={(e) => autoFit(e, 'statut')} className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</SortableHeader>
                        <SortableHeader sortKey="typeSoumission" sortConfig={sortConfig} onSort={requestSort} width={colWidths.typeSoumission} onResizeStart={(e) => startResize(e, 'typeSoumission')} onAutoFit={(e) => autoFit(e, 'typeSoumission')} className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Type</SortableHeader>
                        <SortableHeader sortKey="datePrevu" sortConfig={sortConfig} onSort={requestSort} width={colWidths.datePrevu} onResizeStart={(e) => startResize(e, 'datePrevu')} onAutoFit={(e) => autoFit(e, 'datePrevu')} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Début Prévu</SortableHeader>
                        <SortableHeader sortKey="dateFin" sortConfig={sortConfig} onSort={requestSort} width={colWidths.dateFin} onResizeStart={(e) => startResize(e, 'dateFin')} onAutoFit={(e) => autoFit(e, 'dateFin')} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date Fin</SortableHeader>
                        <SortableHeader sortKey="createdAt" sortConfig={sortConfig} onSort={requestSort} width={colWidths.createdAt} onResizeStart={(e) => startResize(e, 'createdAt')} onAutoFit={(e) => autoFit(e, 'createdAt')} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Créé</SortableHeader>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-16"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedDevis.map((d) => (
                        <tr key={d.id} onClick={() => handleSelect(d.id)}
                          className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selected?.id === d.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                          <td className="px-2 py-3 w-10" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleSelectId(d.id)} className="rounded border-gray-300" /></td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.numeroDevis}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{d.nomProjet}</td>
                          <td className="px-4 py-3 text-gray-500">{d.clientNomCache || d.clientNom || d.clientNomDirect || '--'}</td>
                          <td className="px-4 py-3 text-right font-medium">{d.investissementTotal ? formatCurrency(d.investissementTotal) : '--'}</td>
                          <td className="px-4 py-3 text-center"><Badge color={STATUT_COLORS[d.statut] || 'gray'} size="sm">{d.statut}</Badge></td>
                          <td className="px-4 py-3 text-center">
                            <Badge color={d.typeSoumission === 'Budgétaire' ? 'amber' : 'blue'} size="sm">
                              {d.typeSoumission || 'Détaillée'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: d.id, field: 'datePrevu' }); }}>
                            {editingDateCell?.id === d.id && editingDateCell.field === 'datePrevu' ? (
                              <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={d.datePrevu || ''} onChange={(e) => saveInlineDate(d.id, 'datePrevu', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                            ) : (formatDate(d.datePrevu) || '--')}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: d.id, field: 'dateFin' }); }}>
                            {editingDateCell?.id === d.id && editingDateCell.field === 'dateFin' ? (
                              <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={d.dateFin || ''} onChange={(e) => saveInlineDate(d.id, 'dateFin', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                            ) : (formatDate(d.dateFin) || '--')}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">{formatDate(d.createdAt)}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={(e) => { e.stopPropagation(); if (confirm('Supprimer ce devis?')) { devisApi.deleteDevis(d.id).then(() => fetchDevis()).catch((err: any) => setError(err.response?.data?.detail || 'Erreur suppression')); } }}
                              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-600 transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {devisList.length === 0 && (
                        <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Aucune soumission</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {sortedDevis.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => handleSelect(d.id)}
                    className={`bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-3 cursor-pointer hover:shadow-md transition-shadow ${selected?.id === d.id ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-gray-500">{d.numeroDevis}</span>
                      <Badge color={STATUT_COLORS[d.statut] || 'gray'} size="sm">{d.statut}</Badge>
                    </div>
                    <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{d.nomProjet}</p>
                    <p className="text-xs text-gray-500 truncate">{d.clientNomCache || d.clientNom || d.clientNomDirect || '--'}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400">{formatDate(d.createdAt)}</span>
                      <span className="text-sm font-semibold">{d.investissementTotal ? formatCurrency(d.investissementTotal) : '--'}</span>
                    </div>
                  </div>
                ))}
                {devisList.length === 0 && (
                  <p className="text-center text-gray-400 py-8">Aucune soumission</p>
                )}
              </div>
              </>
              )}

              {/* Table View (compact with more columns) */}
              {viewMode === 'table' && (
              <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-2 py-2 w-10"><input type="checkbox" checked={selectedIds.length === devisList.length && devisList.length > 0} onChange={() => setSelectedIds(selectedIds.length === devisList.length ? [] : devisList.map(d => d.id))} className="rounded border-gray-300" /></th>
                        <SortableHeader sortKey="numeroDevis" sortConfig={sortConfig} onSort={requestSort} width={colWidths.numeroDevis} onResizeStart={(e) => startResize(e, 'numeroDevis')} onAutoFit={(e) => autoFit(e, 'numeroDevis')} className="px-2 py-2 text-left font-semibold text-gray-500 uppercase">Numéro</SortableHeader>
                        <SortableHeader sortKey="nomProjet" sortConfig={sortConfig} onSort={requestSort} width={colWidths.nomProjet} onResizeStart={(e) => startResize(e, 'nomProjet')} onAutoFit={(e) => autoFit(e, 'nomProjet')} className="px-2 py-2 text-left font-semibold text-gray-500 uppercase">Titre</SortableHeader>
                        <SortableHeader sortKey="clientNomDirect" sortConfig={sortConfig} onSort={requestSort} width={colWidths.clientNomDirect} onResizeStart={(e) => startResize(e, 'clientNomDirect')} onAutoFit={(e) => autoFit(e, 'clientNomDirect')} className="px-2 py-2 text-left font-semibold text-gray-500 uppercase">Client</SortableHeader>
                        <th className="px-2 py-2 text-right font-semibold text-gray-500 uppercase">HT</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-500 uppercase">TPS</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-500 uppercase">TVQ</th>
                        <SortableHeader sortKey="prixEstime" sortConfig={sortConfig} onSort={requestSort} width={colWidths.prixEstime} onResizeStart={(e) => startResize(e, 'prixEstime')} onAutoFit={(e) => autoFit(e, 'prixEstime')} className="px-2 py-2 text-right font-semibold text-gray-500 uppercase">Total</SortableHeader>
                        <SortableHeader sortKey="statut" sortConfig={sortConfig} onSort={requestSort} width={colWidths.statut} onResizeStart={(e) => startResize(e, 'statut')} onAutoFit={(e) => autoFit(e, 'statut')} className="px-2 py-2 text-center font-semibold text-gray-500 uppercase">Statut</SortableHeader>
                        <SortableHeader sortKey="datePrevu" sortConfig={sortConfig} onSort={requestSort} width={colWidths.datePrevu} onResizeStart={(e) => startResize(e, 'datePrevu')} onAutoFit={(e) => autoFit(e, 'datePrevu')} className="px-2 py-2 text-left font-semibold text-gray-500 uppercase">Début Prévu</SortableHeader>
                        <SortableHeader sortKey="dateFin" sortConfig={sortConfig} onSort={requestSort} width={colWidths.dateFin} onResizeStart={(e) => startResize(e, 'dateFin')} onAutoFit={(e) => autoFit(e, 'dateFin')} className="px-2 py-2 text-left font-semibold text-gray-500 uppercase">Date Fin</SortableHeader>
                        <SortableHeader sortKey="createdAt" sortConfig={sortConfig} onSort={requestSort} width={colWidths.createdAt} onResizeStart={(e) => startResize(e, 'createdAt')} onAutoFit={(e) => autoFit(e, 'createdAt')} className="px-2 py-2 text-left font-semibold text-gray-500 uppercase">Créé</SortableHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedDevis.map((d) => (
                        <tr key={d.id} onClick={() => handleSelect(d.id)}
                          className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selected?.id === d.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                          <td className="px-2 py-1.5 w-10" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleSelectId(d.id)} className="rounded border-gray-300" /></td>
                          <td className="px-2 py-1.5 font-mono text-gray-500">{d.numeroDevis}</td>
                          <td className="px-2 py-1.5 font-medium text-gray-900 dark:text-white truncate max-w-[100px] sm:max-w-[150px]">{d.nomProjet}</td>
                          <td className="px-2 py-1.5 text-gray-500 truncate max-w-[80px] sm:max-w-[120px]">{d.clientNomCache || d.clientNom || d.clientNomDirect || '--'}</td>
                          <td className="px-2 py-1.5 text-right">{d.totalTravaux ? formatCurrency(d.totalTravaux) : '--'}</td>
                          <td className="px-2 py-1.5 text-right">{d.tps ? formatCurrency(d.tps) : '--'}</td>
                          <td className="px-2 py-1.5 text-right">{d.tvq ? formatCurrency(d.tvq) : '--'}</td>
                          <td className="px-2 py-1.5 text-right font-medium">{d.investissementTotal ? formatCurrency(d.investissementTotal) : '--'}</td>
                          <td className="px-2 py-1.5 text-center"><Badge color={STATUT_COLORS[d.statut] || 'gray'} size="sm">{d.statut}</Badge></td>
                          <td className="px-2 py-1.5 text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: d.id, field: 'datePrevu' }); }}>
                            {editingDateCell?.id === d.id && editingDateCell.field === 'datePrevu' ? (
                              <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={d.datePrevu || ''} onChange={(e) => saveInlineDate(d.id, 'datePrevu', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                            ) : (formatDate(d.datePrevu) || '--')}
                          </td>
                          <td className="px-2 py-1.5 text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: d.id, field: 'dateFin' }); }}>
                            {editingDateCell?.id === d.id && editingDateCell.field === 'dateFin' ? (
                              <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={d.dateFin || ''} onChange={(e) => saveInlineDate(d.id, 'dateFin', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                            ) : (formatDate(d.dateFin) || '--')}
                          </td>
                          <td className="px-2 py-1.5 text-gray-400">{formatDate(d.createdAt)}</td>
                        </tr>
                      ))}
                      {devisList.length === 0 && (
                        <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">Aucune soumission</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {sortedDevis.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => handleSelect(d.id)}
                    className={`bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-3 cursor-pointer hover:shadow-md transition-shadow ${selected?.id === d.id ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-gray-500">{d.numeroDevis}</span>
                      <Badge color={STATUT_COLORS[d.statut] || 'gray'} size="sm">{d.statut}</Badge>
                    </div>
                    <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{d.nomProjet}</p>
                    <p className="text-xs text-gray-500 truncate">{d.clientNomCache || d.clientNom || d.clientNomDirect || '--'}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400">{formatDate(d.createdAt)}</span>
                      <span className="text-sm font-semibold">{d.investissementTotal ? formatCurrency(d.investissementTotal) : '--'}</span>
                    </div>
                  </div>
                ))}
                {devisList.length === 0 && (
                  <p className="text-center text-gray-400 py-8">Aucune soumission</p>
                )}
              </div>
              </>
              )}

              {/* Cards View */}
              {viewMode === 'cards' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedDevis.map(d => (
                  <div
                    key={d.id}
                    onClick={() => handleSelect(d.id)}
                    className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-mono text-gray-500">{d.numeroDevis}</span>
                      <Badge color={STATUT_COLORS[d.statut] || 'gray'}>{d.statut}</Badge>
                    </div>
                    <h3 className="font-medium text-sm mb-1 truncate">{d.nomProjet}</h3>
                    <p className="text-xs text-gray-500 mb-2">{d.clientNomCache || 'Sans client'}</p>
                    <div className="text-right text-sm font-semibold text-green-600">
                      {formatCurrency(d.investissementTotal || 0)}
                    </div>
                  </div>
                ))}
                {devisList.length === 0 && (
                  <p className="text-gray-400 col-span-full text-center py-8">Aucune soumission</p>
                )}
              </div>
              )}

              {totalPages > 1 && <div className="mt-4"><Pagination page={page} totalPages={totalPages} onPageChange={setPage} /></div>}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-full md:w-[45%] md:min-w-[320px] fixed inset-0 z-50 bg-white dark:bg-gray-900 overflow-y-auto md:relative md:inset-auto md:z-auto md:bg-transparent">
            <Card>
              {/* Mobile back button */}
              <button
                onClick={() => setSelected(null)}
                className="md:hidden flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-3"
              >
                <ChevronLeft size={16} />
                Retour a la liste
              </button>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-mono text-gray-400">{selected.numeroDevis}</p>
                    {selected.numeroOpportunite && (
                      <span className="text-xs font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">
                        {selected.numeroOpportunite}
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{selected.nomProjet}</h3>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(selected)}
                    className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                    title="Modifier"
                  >
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setSelected(null)} className="hidden md:block p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
                    <span className="text-lg leading-none">&times;</span>
                  </button>
                </div>
              </div>
              <Badge color={STATUT_COLORS[selected.statut] || 'gray'}>{selected.statut}</Badge>
              {(selected.clientNomCache || selected.clientNom || selected.clientNomDirect) && <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Client: {selected.clientNomCache || selected.clientNom || selected.clientNomDirect}</p>}
              {selected.description && <p className="text-xs text-gray-500 mt-1">{selected.description}</p>}

              {/* Montants — calcul en temps reel */}
              <DevisFinancialSummary
                selected={selected}
                onSave={async (payload) => {
                  await devisApi.updateDevis(selected.id, payload as any);
                  await refreshSelected();
                  fetchDevis();
                }}
              />

              {/* Conditions & Exclusions editables */}
              <DevisConditionsEditor
                selected={selected}
                onSave={async (payload) => {
                  await devisApi.updateDevis(selected.id, payload as any);
                  await refreshSelected();
                }}
              />

              {/* Action buttons */}
              <div className="mt-4 flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Code2 size={14} />}
                  onClick={handleGenerateHtml}
                  isLoading={htmlLoading}
                >
                  Générer HTML
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Eye size={14} />}
                  onClick={async () => {
                    setHtmlLoading(true);
                    try {
                      const res = await devisApi.generateHtml(selected.id);
                      setHtmlContent(res.html);
                      setShowHtmlPreview(true);
                    } catch {
                      setError('Erreur');
                    } finally {
                      setHtmlLoading(false);
                    }
                  }}
                  disabled={htmlLoading}
                >
                  Aperçu
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  leftIcon={<Send size={14} />}
                  onClick={() => {
                    setSendEmail('');
                    setSendResult(null);
                    setShowSendModal(true);
                  }}
                >
                  Envoyer au client
                </Button>
                {['Accepte', 'Acceptée', 'Termine'].includes(selected.statut) && !selected.projectId && (
                  <Button size="sm" onClick={() => handleConvertToProject(selected.id)} className="bg-green-600 hover:bg-green-700">
                    Convertir en projet
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Download size={14} />}
                  onClick={() => {
                    const csv = generateQuickBooksCSV(selected);
                    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${selected.numeroDevis || 'devis'}_quickbooks.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  CSV QuickBooks
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Copy size={14} />}
                  onClick={async () => {
                    try {
                      const csv = generateQuickBooksCSV(selected);
                      await navigator.clipboard.writeText(csv);
                      setSuccess('CSV copié dans le presse-papier');
                      setTimeout(() => setSuccess(null), 3000);
                    } catch {
                      setError('Erreur: impossible de copier dans le presse-papier');
                    }
                  }}
                >
                  Copier CSV
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<FileSpreadsheet size={14} />}
                  isLoading={xlsxLoading}
                  disabled={xlsxLoading}
                  onClick={async () => {
                    setXlsxLoading(true);
                    try {
                      await devisApi.exportDevisXlsx(selected.id, selected.numeroDevis);
                      setSuccess('Fichier Excel téléchargé');
                      setTimeout(() => setSuccess(null), 3000);
                    } catch (err: any) {
                      // Avec responseType:'blob', une erreur serveur JSON arrive comme Blob.
                      // Il faut la lire puis la parser pour extraire le vrai .detail.
                      let msg = "Erreur lors de l'export Excel";
                      const data = err?.response?.data;
                      if (data instanceof Blob) {
                        try {
                          const txt = await data.text();
                          const json = JSON.parse(txt);
                          if (json?.detail) msg = String(json.detail);
                        } catch {
                          // Blob non-JSON, on garde le message générique
                        }
                      } else if (data?.detail) {
                        msg = String(data.detail);
                      }
                      setError(msg);
                    } finally {
                      setXlsxLoading(false);
                    }
                  }}
                >
                  Excel (.xlsx)
                </Button>
              </div>

              {/* Lignes */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase">Lignes ({selected.lignes?.length || 0})</h4>
                  <button
                    onClick={() => { setLineError(null); setShowAddLine(true); }}
                    className="flex items-center gap-1 text-xs text-seaop-primary-600 hover:text-seaop-primary-700 font-medium"
                  >
                    <Plus size={12} /> Ajouter
                  </button>
                </div>
                {selected.lignes && selected.lignes.length > 0 ? (
                  <div className="space-y-1">
                    {selected.lignes.map((l) => {
                      // Per-line markup: line override wins, else falls back
                      // to the devis-level % (default behaviour for lines
                      // without overrides, i.e. all legacy lines).
                      const linAdm = l.adminPctLigne ?? selected.administrationPct ?? 3;
                      const linCon = l.contingencePctLigne ?? selected.contingencesPct ?? 12;
                      const linPro = l.profitPctLigne ?? selected.profitPct ?? 15;
                      const mf = 1 + (linAdm + linCon + linPro) / 100;
                      const hasLineOverride = l.adminPctLigne != null || l.contingencePctLigne != null || l.profitPctLigne != null;
                      const adjPrix = Math.round(l.prixUnitaire * mf * 100) / 100;
                      const adjMontant = Math.round(l.montantLigne * mf * 100) / 100;
                      return (
                      <div key={l.id} className="border-b border-gray-100 dark:border-gray-800 text-sm">
                        {editingLineId === l.id ? (
                          /* Mode édition inline */
                          <div className="py-2 space-y-2">
                            <input
                              className="erp-input text-sm w-full"
                              value={editLineForm.description}
                              onChange={(e) => setEditLineForm({ ...editLineForm, description: e.target.value })}
                              placeholder="Description"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input
                                className="erp-input text-sm"
                                type="number"
                                value={editLineForm.quantite}
                                onChange={(e) => setEditLineForm({ ...editLineForm, quantite: e.target.value })}
                                placeholder="Qte"
                              />
                              <input
                                className="erp-input text-sm"
                                value={editLineForm.unite}
                                onChange={(e) => setEditLineForm({ ...editLineForm, unite: e.target.value })}
                                placeholder="Unité"
                              />
                              <input
                                className="erp-input text-sm"
                                type="number"
                                step="0.01"
                                value={editLineForm.prixUnitaire}
                                onChange={(e) => setEditLineForm({ ...editLineForm, prixUnitaire: e.target.value })}
                                placeholder="Prix"
                              />
                            </div>
                            {/* Ratio MO/MAT custom (optionnel) */}
                            <div className="flex items-center gap-2 pt-1">
                              <label className="text-xs text-gray-500 shrink-0">MO / MAT :</label>
                              <input
                                className="erp-input text-sm w-20"
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={editLineForm.moPct}
                                onChange={(e) => handleMoPctChange(e.target.value)}
                                placeholder="MO %"
                                title="Main-d'œuvre (% — se complète auto)"
                              />
                              <span className="text-xs text-gray-400">/</span>
                              <input
                                className="erp-input text-sm w-20"
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={editLineForm.matPct}
                                onChange={(e) => handleMatPctChange(e.target.value)}
                                placeholder="MAT %"
                                title="Matériel (% — se complète auto)"
                              />
                              <span className="text-xs text-gray-400">%</span>
                              {(editLineForm.moPct !== '' || editLineForm.matPct !== '') && (
                                <button
                                  type="button"
                                  onClick={resetMoMatToAuto}
                                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                                  title="Revenir à la détection automatique par mots-clés"
                                >
                                  Auto
                                </button>
                              )}
                              {editLineForm.moPct === '' && editLineForm.matPct === '' && (
                                <span className="text-xs text-gray-400 italic">Détection auto</span>
                              )}
                            </div>
                            {/* Majoration personnalisée par ligne (admin / contingences / profit).
                                Vide = hérite des % globaux du devis (placeholder gris).
                                Modifié = override pour CETTE ligne uniquement. */}
                            {(() => {
                              const gAdm = selected.administrationPct ?? 3;
                              const gCon = selected.contingencesPct ?? 12;
                              const gPro = selected.profitPct ?? 15;
                              const hasOverride = editLineForm.adminPctLigne !== ''
                                || editLineForm.contingencePctLigne !== ''
                                || editLineForm.profitPctLigne !== '';
                              return (
                                <div className="pt-1 border-t border-dashed border-gray-200 dark:border-gray-700">
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs text-gray-500 shrink-0" title="Majoration appliquée à cette ligne. Laissez vide pour hériter des % du devis.">
                                      Majoration :
                                    </label>
                                    {hasOverride ? (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                                          Personnalisée
                                        </span>
                                        <button
                                          type="button"
                                          onClick={resetLineMarkupToInherit}
                                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                                          title="Vider les 3 champs et hériter des % du devis"
                                        >
                                          Hériter du devis
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-400 italic">Hérite du devis</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[11px] text-gray-500 w-12 text-right">Admin</span>
                                      <input
                                        className="erp-input text-sm w-16"
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        value={editLineForm.adminPctLigne}
                                        onChange={(e) => setEditLineForm({ ...editLineForm, adminPctLigne: e.target.value })}
                                        placeholder={`${gAdm}`}
                                        title={`Administration. Vide = hérite du devis (${gAdm}%).`}
                                      />
                                      <span className="text-xs text-gray-400">%</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[11px] text-gray-500 w-12 text-right">Conting.</span>
                                      <input
                                        className="erp-input text-sm w-16"
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        value={editLineForm.contingencePctLigne}
                                        onChange={(e) => setEditLineForm({ ...editLineForm, contingencePctLigne: e.target.value })}
                                        placeholder={`${gCon}`}
                                        title={`Contingences. Vide = hérite du devis (${gCon}%).`}
                                      />
                                      <span className="text-xs text-gray-400">%</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[11px] text-gray-500 w-12 text-right">Profit</span>
                                      <input
                                        className="erp-input text-sm w-16"
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        value={editLineForm.profitPctLigne}
                                        onChange={(e) => setEditLineForm({ ...editLineForm, profitPctLigne: e.target.value })}
                                        placeholder={`${gPro}`}
                                        title={`Profit. Vide = hérite du devis (${gPro}%).`}
                                      />
                                      <span className="text-xs text-gray-400">%</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                            <div className="flex items-center justify-between">
                              {(() => {
                                // Live preview : prix unitaire et total reflètent la majoration
                                // effective de cette ligne (override ou hérité du devis).
                                const gAdm = selected.administrationPct ?? 3;
                                const gCon = selected.contingencesPct ?? 12;
                                const gPro = selected.profitPct ?? 15;
                                const eAdm = editLineForm.adminPctLigne === '' ? gAdm : (parseFloat(editLineForm.adminPctLigne) || 0);
                                const eCon = editLineForm.contingencePctLigne === '' ? gCon : (parseFloat(editLineForm.contingencePctLigne) || 0);
                                const ePro = editLineForm.profitPctLigne === '' ? gPro : (parseFloat(editLineForm.profitPctLigne) || 0);
                                const editMf = 1 + (eAdm + eCon + ePro) / 100;
                                const total = (parseFloat(editLineForm.quantite) || 0) * (parseFloat(editLineForm.prixUnitaire) || 0) * editMf;
                                return (
                                  <span className="text-xs text-gray-500">
                                    = {formatCurrency(total)}{' '}
                                    <span className="text-gray-400">(majoration {((eAdm + eCon + ePro)).toFixed(2)}%)</span>
                                  </span>
                                );
                              })()}
                              <div className="flex gap-1">
                                <button onClick={handleSaveEditLine} disabled={editLineLoading}
                                  className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" title="Enregistrer">
                                  <Check size={14} />
                                </button>
                                <button onClick={() => setEditingLineId(null)}
                                  className="p-1.5 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" title="Annuler">
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Mode lecture */
                          <div className={`py-1.5${l.visible === false ? ' opacity-40' : ''}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-700 dark:text-gray-300 truncate flex items-center gap-2">
                                <span className="truncate">{l.description}</span>
                                {hasLineOverride && (
                                  <span
                                    className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300 px-1.5 py-0.5 rounded shrink-0"
                                    title={`Majoration personnalisée pour cette ligne — Admin ${l.adminPctLigne ?? selected.administrationPct ?? 3}%, Conting. ${l.contingencePctLigne ?? selected.contingencesPct ?? 12}%, Profit ${l.profitPctLigne ?? selected.profitPct ?? 15}%`}
                                  >
                                    %
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-gray-400">{l.quantite} {l.unite} x {formatCurrency(adjPrix)}</p>
                            </div>
                            <div className="flex items-center gap-1 ml-2">
                              <span className="font-medium mr-1">{formatCurrency(adjMontant)}</span>
                              <button
                                onClick={async () => {
                                  try {
                                    await devisApi.toggleDevisLigneVisibility(selected.id, l.id, l.visible === false);
                                    refreshSelected();
                                  } catch { /* ignore */ }
                                }}
                                className={`p-1 rounded ${l.visible !== false ? 'text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20' : 'text-amber-500 hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                                title={l.visible !== false ? 'Masquer dans la soumission' : 'Afficher dans la soumission'}
                              >
                                {l.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
                              </button>
                              <button onClick={() => startEditLine(l)}
                                className="p-1 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                                title="Modifier la ligne">
                                <Pencil size={12} />
                              </button>
                              <button onClick={() => handleDeleteLine(l.id)}
                                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                title="Supprimer la ligne">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                          {selected.showMoMat === true && (() => {
                            const r = resolveMoMatRatio(l);
                            const moVal = Math.round(adjMontant * r.mo / 100 * 100) / 100;
                            const matVal = Math.round(adjMontant * r.mat / 100 * 100) / 100;
                            return (
                              <p className="text-[11px] mt-0.5 pl-0.5">
                                <span className="text-blue-600">MO {r.mo}%: {formatCurrency(moVal)}</span>
                                <span className="mx-1.5 text-gray-300">|</span>
                                <span className="text-amber-600">MAT {r.mat}%: {formatCurrency(matVal)}</span>
                              </p>
                            );
                          })()}
                          </div>
                        )}
                      </div>
                      );
                    })}
                    {/* MO / MAT totals */}
                    {selected.showMoMat === true && selected.lignes && selected.lignes.length > 0 && (() => {
                      // Per-line markup (override-aware) — same logic as the
                      // line render above, so the MO/MAT totals match what
                      // the user sees printed on the quote.
                      const gAdm = selected.administrationPct ?? 3;
                      const gCon = selected.contingencesPct ?? 12;
                      const gPro = selected.profitPct ?? 15;
                      let tMo = 0, tMat = 0;
                      for (const l of selected.lignes) {
                        const linMf = 1 + (
                          (l.adminPctLigne ?? gAdm)
                          + (l.contingencePctLigne ?? gCon)
                          + (l.profitPctLigne ?? gPro)
                        ) / 100;
                        const adj = Math.round(l.montantLigne * linMf * 100) / 100;
                        const r = resolveMoMatRatio(l);
                        tMo += Math.round(adj * r.mo / 100 * 100) / 100;
                        tMat += Math.round(adj * r.mat / 100 * 100) / 100;
                      }
                      return (
                        <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2 text-xs space-y-0.5">
                          <div className="flex justify-between"><span className="text-blue-600 font-medium">Total Main-d'oeuvre (MO)</span><span className="text-blue-600 font-medium">{formatCurrency(tMo)}</span></div>
                          <div className="flex justify-between"><span className="text-amber-600 font-medium">Total Materiaux (MAT)</span><span className="text-amber-600 font-medium">{formatCurrency(tMat)}</span></div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Aucune ligne</p>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-3">Validite: {formatDate(selected.datePrevu)}</p>
            </Card>
          </div>
        )}
      </div>
      </>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle soumission" size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Column 1 */}
            <div className="space-y-4">
              <Input label="Nom du projet *" value={form.nomProjet} onChange={(e) => setForm({ ...form, nomProjet: e.target.value })} placeholder="Ex: Rénovation cuisine résidentielle" required />
              <Input label="No. PO Client" value={form.poClient} onChange={(e) => setForm({ ...form, poClient: e.target.value })} placeholder="Ex: PO-12345" />
              <Select
                label="Client (Entreprise)"
                options={[{ value: '', label: 'Sélectionner ou laisser vide' }, ...companies.map(c => ({ value: String(c.id), label: c.nom }))]}
                value={form.clientCompanyId}
                onChange={(e) => setForm({ ...form, clientCompanyId: e.target.value })}
              />
              <Select
                label="Client (Personne)"
                options={[{ value: '', label: 'Aucun contact' }, ...contacts.map(c => ({ value: String(c.id), label: `${c.prenom} ${c.nomFamille || c.nom || ''}${c.companyNom ? ` (${c.companyNom})` : ''}` }))]}
                value={form.clientContactId}
                onChange={(e) => setForm({ ...form, clientContactId: e.target.value })}
              />
              <Input label="Saisie manuelle (si client non dans le CRM)" value={form.clientNomDirect} onChange={(e) => setForm({ ...form, clientNomDirect: e.target.value })} placeholder="Ex: Jean Tremblay Construction" />
              <Select
                label="Statut"
                options={STATUT_OPTIONS.slice(1)}
                value={form.statut}
                onChange={(e) => setForm({ ...form, statut: e.target.value })}
              />
              <Select
                label="Priorité"
                options={PRIORITE_OPTIONS}
                value={form.priorite}
                onChange={(e) => setForm({ ...form, priorite: e.target.value })}
              />
            </div>
            {/* Column 2 */}
            <div className="space-y-4">
              <Select
                label="Tache actuelle"
                options={TACHES_PRODUCTION}
                value={form.tache}
                onChange={(e) => setForm({ ...form, tache: e.target.value })}
              />
              <Input label="Date limite de soumission" type="date" value={form.dateSoumis} onChange={(e) => setForm({ ...form, dateSoumis: e.target.value })} />
              <Input label="Début prévu des travaux" type="date" value={form.datePrevu} onChange={(e) => setForm({ ...form, datePrevu: e.target.value })} />
              <Input label="Fin prévue des travaux" type="date" value={form.dateFin} onChange={(e) => setForm({ ...form, dateFin: e.target.value })} />
              <Input label="Prix ($)" type="number" step="0.01" value={form.prixEstime} onChange={(e) => setForm({ ...form, prixEstime: e.target.value })} />
            </div>
          </div>
          <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />

          <p className="text-xs text-gray-400">* Obligatoire</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.nomProjet.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Modifier la soumission" size="xl">
        <div className="space-y-4">
          {editError && <Alert type="error" onClose={() => setEditError(null)}>{editError}</Alert>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Column 1 */}
            <div className="space-y-4">
              <Input label="Nom du projet *" value={editForm.nomProjet || ''} onChange={(e) => setEditForm({ ...editForm, nomProjet: e.target.value })} required />
              <Input label="No. PO Client" value={editForm.poClient || ''} onChange={(e) => setEditForm({ ...editForm, poClient: e.target.value })} placeholder="Ex: PO-12345" />
              <Select
                label="Client (Entreprise)"
                options={[{ value: '', label: 'Sélectionner ou laisser vide' }, ...companies.map(c => ({ value: String(c.id), label: c.nom }))]}
                value={String(editForm.clientCompanyId || '')}
                onChange={(e) => setEditForm({ ...editForm, clientCompanyId: e.target.value ? Number(e.target.value) : undefined })}
              />
              <Select
                label="Client (Personne)"
                options={[{ value: '', label: 'Aucun contact' }, ...contacts.map(c => ({ value: String(c.id), label: `${c.prenom} ${c.nomFamille || c.nom || ''}${c.companyNom ? ` (${c.companyNom})` : ''}` }))]}
                value={String(editForm.clientContactId || '')}
                onChange={(e) => setEditForm({ ...editForm, clientContactId: e.target.value ? Number(e.target.value) : undefined })}
              />
              <Input label="Saisie manuelle (si client non dans le CRM)" value={editForm.clientNomDirect || ''} onChange={(e) => setEditForm({ ...editForm, clientNomDirect: e.target.value })} placeholder="Ex: Jean Tremblay Construction" />
              <Select
                label="Statut"
                options={STATUT_OPTIONS.slice(1)}
                value={editForm.statut || 'Brouillon'}
                onChange={(e) => setEditForm({ ...editForm, statut: e.target.value })}
              />
              <Select
                label="Priorité"
                options={PRIORITE_OPTIONS}
                value={editForm.priorite || 'NORMAL'}
                onChange={(e) => setEditForm({ ...editForm, priorite: e.target.value })}
              />
              <Select
                label="Type de soumission"
                options={[
                  { value: 'Détaillée', label: 'Détaillée' },
                  { value: 'Budgétaire', label: 'Budgétaire' },
                ]}
                value={editForm.typeSoumission || 'Détaillée'}
                onChange={(e) => setEditForm({ ...editForm, typeSoumission: e.target.value })}
              />
            </div>
            {/* Column 2 */}
            <div className="space-y-4">
              <Select
                label="Tache actuelle"
                options={TACHES_PRODUCTION}
                value={editForm.tache || ''}
                onChange={(e) => setEditForm({ ...editForm, tache: e.target.value })}
              />
              <Input label="Date limite de soumission" type="date" value={editForm.dateSoumis || ''} onChange={(e) => setEditForm({ ...editForm, dateSoumis: e.target.value })} />
              <Input label="Début prévu des travaux" type="date" value={editForm.datePrevu || ''} onChange={(e) => setEditForm({ ...editForm, datePrevu: e.target.value })} />
              <Input label="Fin prevue des travaux" type="date" value={editForm.dateFin || ''} onChange={(e) => setEditForm({ ...editForm, dateFin: e.target.value })} />
              <Input label="Prix ($)" type="number" step="0.01" value={String(editForm.prixEstime || 0)} onChange={(e) => setEditForm({ ...editForm, prixEstime: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <Textarea label="Description" value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} />
          <p className="text-xs text-gray-400">* Obligatoire</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowEdit(false)}>Annuler</Button>
            <Button onClick={handleEdit} isLoading={editLoading} disabled={!editForm.nomProjet?.trim()}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* Add Line Modal */}
      <Modal isOpen={showAddLine} onClose={() => setShowAddLine(false)} title="Ajouter une ligne">
        <div className="space-y-4">
          {lineError && <Alert type="error" onClose={() => setLineError(null)}>{lineError}</Alert>}
          <Input label="Description *" value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} required />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Quantité" type="number" value={lineForm.quantite} onChange={(e) => setLineForm({ ...lineForm, quantite: e.target.value })} />
            <Input label="Unité" value={lineForm.unite} onChange={(e) => setLineForm({ ...lineForm, unite: e.target.value })} />
            <Input label="Prix unitaire" type="number" step="0.01" value={lineForm.prixUnitaire} onChange={(e) => setLineForm({ ...lineForm, prixUnitaire: e.target.value })} />
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Montant HT</span><span className="font-medium">{formatCurrency(lineMontant)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">TPS (5%)</span><span>{formatCurrency(lineMontant * 0.05)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">TVQ (9.975%)</span><span>{formatCurrency(lineMontant * 0.09975)}</span></div>
            <div className="flex justify-between font-bold border-t pt-1 border-gray-200 dark:border-gray-700">
              <span>Total TTC</span><span>{formatCurrency(lineMontant * 1.14975)}</span>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowAddLine(false)}>Annuler</Button>
            <Button onClick={handleAddLine} isLoading={lineLoading} disabled={!lineForm.description.trim()}>Ajouter</Button>
          </div>
        </div>
      </Modal>

      {/* HTML Preview Modal */}
      <Modal
        isOpen={showHtmlPreview}
        onClose={() => { setShowHtmlPreview(false); setHtmlContent(''); }}
        title={`Aperçu de la soumission ${selected?.numeroDevis || ''}`}
        size="xl"
      >
        <div className="space-y-4">
          {htmlContent ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden h-[calc(100vh-200px)] md:h-[70vh]">
              <iframe
                srcDoc={htmlContent}
                title="Aperçu soumission"
                className="w-full h-full bg-white"
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(htmlContent);
                  win.document.close();
                }
              }}
              disabled={!htmlContent}
            >
              Ouvrir dans un nouvel onglet
            </Button>
            <Button variant="ghost" onClick={() => { setShowHtmlPreview(false); setHtmlContent(''); }}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Manuel tab ephemeral preview (items not yet persisted) */}
      <DevisHtmlPreviewModal
        isOpen={showManuelPreview}
        onClose={() => {
          setShowManuelPreview(false);
          setManuelPreviewHtml('');
          setManuelPreviewLoading(false);
        }}
        html={manuelPreviewHtml}
        title={`Apercu Soumission ${selected?.numeroDevis || ''} (preview — non persiste)`}
        loading={manuelPreviewLoading}
      />

      {/* Send Devis Modal */}
      <Modal
        isOpen={showSendModal}
        onClose={() => { setShowSendModal(false); setSendResult(null); }}
        title="Envoyer la soumission au client"
      >
        <div className="space-y-4">
          {!sendResult ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Envoyez la soumission <strong>{selected?.numeroDevis}</strong> au client. Le statut sera mis à jour à "Envoyé"
                et un lien de validation publique sera généré.
              </p>
              <Input
                label="Adresse courriel du client *"
                type="email"
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                placeholder="client@example.com"
                required
              />
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setShowSendModal(false)}>Annuler</Button>
                <Button
                  onClick={handleSendDevis}
                  isLoading={sendLoading}
                  disabled={!sendEmail.trim() || sendLoading}
                  leftIcon={<Send size={14} />}
                >
                  Envoyer
                </Button>
              </div>
            </>
          ) : (
            <>
              <Alert type={sendResult.emailSent ? "success" : "warning"}>
                {sendResult.message}
              </Alert>
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Lien de validation publique:</p>
                <p className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
                  {window.location.origin}{sendResult.publicUrl}
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${window.location.origin}${sendResult.publicUrl}`);
                      setSuccess('Lien copié dans le presse-papier');
                      setTimeout(() => setSuccess(null), 3000);
                    } catch {
                      setError('Erreur: impossible de copier le lien');
                    }
                  }}
                >
                  Copier le lien
                </Button>
                <Button variant="ghost" onClick={() => { setShowSendModal(false); setSendResult(null); }}>
                  Fermer
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

    </div>
  );
}


// ============================================
// DEVIS DEFAULTS TAB (Conditions & Exclusions par défaut)
// ============================================
// Edits the entreprise-wide default conditions + exclusions that seed new
// devis. Each devis can still override per-devis in the editor above.
// Backend endpoints: GET /devis/defaults (any user), PUT /devis/defaults
// (admin only — enforced by require_role("admin") in backend/routers/devis.py).

function DevisDefaultsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'conditions' | 'exclusions' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [condError, setCondError] = useState<string | null>(null);
  const [exclError, setExclError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conditions, setConditions] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [serverConditions, setServerConditions] = useState('');
  const [serverExclusions, setServerExclusions] = useState('');
  const [conditionsFallback, setConditionsFallback] = useState('');
  const [exclusionsFallback, setExclusionsFallback] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await devisApi.getDevisDefaults();
      setConditions(d.conditions || '');
      setExclusions(d.exclusions || '');
      setServerConditions(d.conditions || '');
      setServerExclusions(d.exclusions || '');
      setConditionsFallback(d.conditionsFallback || '');
      setExclusionsFallback(d.exclusionsFallback || '');
    } catch (e: any) {
      setLoadError(e?.response?.data?.detail || 'Erreur lors du chargement des défauts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-clear success after 2.5s
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 2500);
      return () => clearTimeout(t);
    }
  }, [success]);

  const saveConditions = async () => {
    setSaving('conditions');
    setCondError(null);
    try {
      const res = await devisApi.updateDevisDefaults({ conditions });
      setServerConditions(res.conditions || '');
      setConditions(res.conditions || '');
      setSuccess('Conditions enregistrées');
    } catch (e: any) {
      setCondError(e?.response?.data?.detail || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(null);
    }
  };

  const saveExclusions = async () => {
    setSaving('exclusions');
    setExclError(null);
    try {
      const res = await devisApi.updateDevisDefaults({ exclusions });
      setServerExclusions(res.exclusions || '');
      setExclusions(res.exclusions || '');
      setSuccess('Exclusions enregistrées');
    } catch (e: any) {
      setExclError(e?.response?.data?.detail || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(null);
    }
  };

  const resetConditions = async () => {
    setConditions('');
    setSaving('conditions');
    setCondError(null);
    try {
      const res = await devisApi.updateDevisDefaults({ conditions: '' });
      setServerConditions(res.conditions || '');
      setSuccess('Conditions réinitialisées');
    } catch (e: any) {
      setCondError(e?.response?.data?.detail || 'Erreur lors de la réinitialisation');
    } finally {
      setSaving(null);
    }
  };

  const resetExclusions = async () => {
    setExclusions('');
    setSaving('exclusions');
    setExclError(null);
    try {
      const res = await devisApi.updateDevisDefaults({ exclusions: '' });
      setServerExclusions(res.exclusions || '');
      setSuccess('Exclusions réinitialisées');
    } catch (e: any) {
      setExclError(e?.response?.data?.detail || 'Erreur lors de la réinitialisation');
    } finally {
      setSaving(null);
    }
  };

  const conditionsChanged = conditions.trim() !== serverConditions.trim();
  const exclusionsChanged = exclusions.trim() !== serverExclusions.trim();
  const usingDefaultCond = !serverConditions.trim();
  const usingDefaultExcl = !serverExclusions.trim();

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && <Alert type="error" onClose={() => setLoadError(null)}>{loadError}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <Card>
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-seaop-primary-600" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Conditions &amp; Exclusions par défaut</h3>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Ces textes apparaîtront dans toutes vos nouvelles soumissions. Chaque devis peut ensuite être personnalisé individuellement dans l'éditeur de soumission.
          </p>
        </div>

        <div className="p-4 space-y-6">
          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Conditions
                {usingDefaultCond && <span className="ml-2 text-[11px] text-gray-400 italic">(valeurs système par défaut)</span>}
              </label>
              <div className="flex items-center gap-2">
                {!usingDefaultCond && (
                  <button
                    type="button"
                    onClick={resetConditions}
                    disabled={saving === 'conditions'}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
                    title="Revenir aux valeurs système par défaut"
                  >
                    <RotateCcw size={11} /> Réinitialiser
                  </button>
                )}
                <Button
                  size="sm"
                  variant={conditionsChanged ? 'primary' : 'ghost'}
                  disabled={!conditionsChanged || saving === 'conditions'}
                  isLoading={saving === 'conditions'}
                  onClick={saveConditions}
                  leftIcon={<Save size={14} />}
                >
                  Enregistrer
                </Button>
              </div>
            </div>
            <textarea
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder={conditionsFallback}
              rows={8}
              className={`w-full text-sm px-3 py-2 border rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono resize-y focus:ring-1 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 ${condError ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
            />
            {condError ? (
              <div className="text-[11px] text-red-500 mt-1">{condError}</div>
            ) : (
              <div className="text-[11px] text-gray-400 mt-1">Une ligne par condition. Les puces sont ajoutées automatiquement dans la soumission finale.</div>
            )}
          </div>

          {/* Exclusions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Exclusions
                {usingDefaultExcl && <span className="ml-2 text-[11px] text-gray-400 italic">(valeurs système par défaut)</span>}
              </label>
              <div className="flex items-center gap-2">
                {!usingDefaultExcl && (
                  <button
                    type="button"
                    onClick={resetExclusions}
                    disabled={saving === 'exclusions'}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
                    title="Revenir aux valeurs système par défaut"
                  >
                    <RotateCcw size={11} /> Réinitialiser
                  </button>
                )}
                <Button
                  size="sm"
                  variant={exclusionsChanged ? 'primary' : 'ghost'}
                  disabled={!exclusionsChanged || saving === 'exclusions'}
                  isLoading={saving === 'exclusions'}
                  onClick={saveExclusions}
                  leftIcon={<Save size={14} />}
                >
                  Enregistrer
                </Button>
              </div>
            </div>
            <textarea
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              placeholder={exclusionsFallback}
              rows={10}
              className={`w-full text-sm px-3 py-2 border rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono resize-y focus:ring-1 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 ${exclError ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
            />
            {exclError ? (
              <div className="text-[11px] text-red-500 mt-1">{exclError}</div>
            ) : (
              <div className="text-[11px] text-gray-400 mt-1">Une ligne par exclusion. La numérotation est ajoutée automatiquement.</div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
