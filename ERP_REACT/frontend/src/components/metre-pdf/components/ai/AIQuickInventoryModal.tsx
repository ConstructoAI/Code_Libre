import React, { useEffect, useState } from 'react';
import {
  X,
  Sparkles,
  Loader2,
  Check,
  AlertCircle,
  Copy,
  Download,
  ListChecks,
} from 'lucide-react';
import { listAvailableSections, runAIQuickInventory } from '../../aiDetections';
import { useMetreStore } from '../../store';
import type { AIQuickInventoryResult } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  documentId: number | null;
  /** 1-based page number (UI / pdf.js convention). */
  pageNumber: number;
}

/**
 * PHASE 3: Modal "Inventaire rapide IA".
 *
 * Alternative au mode markup overlay (AIDetectModal). Claude analyse le plan
 * et retourne une liste texte structuree (item, dimensions, quantity, notes)
 * SANS coordonnees ni overlay - juste un tableau.
 *
 * Plus precis pour plans manuscrits car Claude n'a pas a pointer des
 * coordonnees exactes - juste lire les annotations.
 *
 * NOTE: la calibration n'est PAS necessaire pour ce mode (Claude lit les
 * dimensions du plan, pas besoin de scale_factor).
 */
export const AIQuickInventoryModal: React.FC<Props> = ({
  open,
  onClose,
  documentId,
  pageNumber,
}) => {
  const setAvailableSections = useMetreStore((s) => s.setAIAvailableSections);
  const availableSections = useMetreStore((s) => s.aiAvailableSections);

  const [query, setQuery] = useState<string>('');
  const [additionalContext, setAdditionalContext] = useState<string>('');
  const [useBom, setUseBom] = useState<boolean>(false);
  const [section, setSection] = useState<string>('');
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [precisionMode, setPrecisionMode] = useState<boolean>(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AIQuickInventoryResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Charge la liste des sections quand le modal s'ouvre (pour BOM optionnel).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setCopied(false);
    setSectionsLoading(true);
    listAvailableSections()
      .then((res) => {
        setAvailableSections(res.sections);
        if (res.sections.length > 0 && !section) {
          setSection(res.sections[0]);
        }
      })
      .catch((err) => {
        console.error('[AIQuickInventoryModal] Failed to load sections', err);
      })
      .finally(() => setSectionsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleLaunch = async () => {
    if (!documentId || loading) return;
    if (!query.trim()) {
      setError('Saisis une question (ex: "Donne-moi tous les fenetres de l\'agrandissement").');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await runAIQuickInventory(documentId, {
        pageNumber,
        query: query.trim(),
        additionalContext: additionalContext.trim() || undefined,
        sectionNumero: useBom ? section || undefined : undefined,
        useBomCatalog: useBom,
        precisionMode,
      });
      setResult(res);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      const message =
        axiosErr?.response?.data?.detail ??
        (err instanceof Error ? err.message : "Erreur lors de l'inventaire IA");
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    const lines: string[] = [];
    if (result.summary) lines.push(result.summary, '');
    lines.push('Item\tDimensions\tQuantite\tUnite\tNotes');
    for (const it of result.inventory) {
      lines.push(
        [
          it.item,
          it.dimensions ?? '',
          it.quantity,
          it.unit,
          (it.notes ?? '').replace(/\t/g, ' '),
        ].join('\t'),
      );
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Impossible de copier dans le presse-papier.');
    }
  };

  const handleExportCsv = () => {
    if (!result) return;
    const escape = (v: unknown): string => {
      const s = String(v ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines: string[] = [];
    lines.push(['Item', 'Dimensions', 'Quantite', 'Unite', 'Notes', 'Categorie'].map(escape).join(','));
    for (const it of result.inventory) {
      lines.push(
        [it.item, it.dimensions ?? '', it.quantity, it.unit, it.notes ?? '', it.category ?? '']
          .map(escape)
          .join(','),
      );
    }
    const csv = lines.join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventaire-page-${pageNumber}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCloseModal = () => {
    if (loading) return;
    setQuery('');
    setAdditionalContext('');
    setResult(null);
    setError(null);
    setCopied(false);
    setPrecisionMode(true);
    onClose();
  };

  if (!open) return null;

  const launchDisabled = loading || !documentId || !query.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-semibold text-gray-800">Inventaire IA rapide</h2>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            disabled={loading}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!result && (
            <>
              {/* Query */}
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">
                  Question / Inventaire a faire
                </label>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value.slice(0, 500))}
                  placeholder='Ex: Donne-moi tous les fenetres de l&apos;agrandissement seulement, avec leurs dimensions.'
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-800 resize-none"
                  rows={3}
                  maxLength={500}
                  disabled={loading}
                />
                <div className="text-xs text-gray-500 mt-0.5">{query.length}/500</div>
              </div>

              {/* BOM toggle */}
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useBom}
                    onChange={(e) => setUseBom(e.target.checked)}
                    disabled={loading || sectionsLoading || availableSections.length === 0}
                  />
                  <ListChecks className="w-4 h-4 text-gray-600" />
                  <span>Filtrer par section BOM (optionnel)</span>
                </label>
                {useBom && (
                  <div className="mt-2 ml-6">
                    {sectionsLoading ? (
                      <div className="text-sm text-gray-500 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
                      </div>
                    ) : availableSections.length === 0 ? (
                      <div className="text-sm text-rose-600 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" /> Aucune section trouvee
                      </div>
                    ) : (
                      <select
                        value={section}
                        onChange={(e) => setSection(e.target.value)}
                        disabled={loading}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-800"
                      >
                        {availableSections.map((s) => (
                          <option key={s} value={s}>
                            Section {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Precision mode toggle (Extended Thinking) */}
              <div className="flex items-start gap-2 p-3 border border-amber-200 bg-amber-50 rounded">
                <input
                  type="checkbox"
                  id="precision-mode"
                  checked={precisionMode}
                  onChange={(e) => setPrecisionMode(e.target.checked)}
                  disabled={loading}
                  className="mt-0.5"
                />
                <label htmlFor="precision-mode" className="flex-1 cursor-pointer">
                  <div className="text-sm font-medium text-amber-900">
                    Mode precision etendue (multi-pass) - Recommande [defaut]
                  </div>
                  <div className="text-xs text-amber-700 mt-0.5">
                    Active par defaut. 2 passages: Pass 1 lit chaque label mot-pour-mot
                    (anti-hallucination), Pass 2 filtre selon ta requete. Plus lent (90-120s vs 30s)
                    et plus cher (~$0.60-0.80 vs $0.10) mais precision elevee sur plans complexes.
                    Decoche pour mode rapide.
                  </div>
                </label>
              </div>

              {/* Additional context */}
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">
                  Contexte additionnel (optionnel)
                </label>
                <textarea
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value.slice(0, 1000))}
                  placeholder="Ex: Plan d&apos;agrandissement seulement, ignore l&apos;existant. Verifier 2 fois les dimensions..."
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-800 resize-none"
                  rows={3}
                  maxLength={1000}
                  disabled={loading}
                />
                <div className="text-xs text-gray-500 mt-0.5">
                  {additionalContext.length}/1000
                </div>
              </div>

              {/* Loading hint */}
              {loading && (
                <div className="flex items-start gap-2 p-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded">
                  <Loader2 className="w-4 h-4 animate-spin mt-0.5" />
                  <span>Analyse en cours... (peut prendre 30-90 secondes)</span>
                </div>
              )}
            </>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              {/* Summary */}
              {result.summary && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded">
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium mb-1">Resume</div>
                      <div>{result.summary}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
                <span>
                  <strong className="text-gray-700">{result.totalItems}</strong> ligne(s)
                </span>
                <span>
                  Cout: <strong className="text-gray-700">${result.costUsd.toFixed(4)}</strong>
                </span>
                <span>
                  Tokens: {result.tokensIn} in / {result.tokensOut} out
                </span>
                {result.precisionModeUsed && (
                  <span className="text-amber-700 font-medium">
                    Mode precision etendue ({result.thinkingTokens ?? 0} thinking tokens)
                  </span>
                )}
              </div>

              {/* Table */}
              {result.inventory.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    Aucun element trouve. Reformule la question ou precise une zone.
                  </span>
                </div>
              ) : (
                <div className="border border-gray-200 rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-700">Item</th>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-700">
                          Dimensions
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-700">Qte</th>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-700">Unite</th>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-700">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.inventory.map((it, idx) => (
                        <tr
                          key={idx}
                          className={
                            idx % 2 === 0
                              ? 'bg-white border-b border-gray-100'
                              : 'bg-gray-50/40 border-b border-gray-100'
                          }
                        >
                          <td className="px-2 py-1.5 text-gray-800">{it.item}</td>
                          <td className="px-2 py-1.5 text-gray-700">{it.dimensions ?? '-'}</td>
                          <td className="px-2 py-1.5 text-right text-gray-800 font-mono tabular-nums">
                            {it.quantity}
                          </td>
                          <td className="px-2 py-1.5 text-gray-700">{it.unit}</td>
                          <td className="px-2 py-1.5 text-gray-600 text-xs">
                            {it.notes ?? ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {copied && (
                <div className="text-xs text-emerald-700 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Copie dans le presse-papier
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200">
          {result ? (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1.5 text-sm rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"
              >
                <Copy className="w-4 h-4" />
                Copier liste
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-1.5 text-sm rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                Exporter CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
                className="px-3 py-1.5 text-sm rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Nouvelle question
              </button>
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Fermer
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={loading}
                className="px-3 py-1.5 text-sm rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleLaunch}
                disabled={launchDisabled}
                className="px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-400 disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>{loading ? 'Analyse...' : 'Lancer inventaire'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIQuickInventoryModal;
