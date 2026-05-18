import React, { useEffect, useMemo, useState } from 'react';
import { X, Sparkles, Loader2, Check, AlertCircle, ListChecks } from 'lucide-react';
import { useMetreStore } from '../../store';
import {
  listAIDetections,
  listAvailableSections,
  runAIDetect,
  runAIDetectMultiSection,
} from '../../aiDetections';

type DetectMode = 'generic' | 'single-section' | 'multi-section';

interface Props {
  open: boolean;
  onClose: () => void;
  documentId: number | null;
  /** 1-based page number (UI / pdf.js convention). Converted to 0-based for backend. */
  pageNumber: number;
}

/**
 * Modal de configuration de la detection IA.
 *
 * Trois modes:
 * 1. Generique: detection sans catalogue, prompt construction generique.
 * 2. Section unique avec BOM: detection filtree par catalogue produits d'une section.
 * 3. Multi-sections avec calques: une detection par section, layer dedie auto-cree.
 */
export const AIDetectModal: React.FC<Props> = ({ open, onClose, documentId, pageNumber }) => {
  const setAIDetections = useMetreStore((s) => s.setAIDetections);
  const setLoading = useMetreStore((s) => s.setAIDetectionLoading);
  const setError = useMetreStore((s) => s.setAIDetectionError);
  const setLastRun = useMetreStore((s) => s.setAIDetectionLastRun);
  const setMultiResult = useMetreStore((s) => s.setAIMultiSectionResult);
  const setAvailableSections = useMetreStore((s) => s.setAIAvailableSections);
  const availableSections = useMetreStore((s) => s.aiAvailableSections);
  const loading = useMetreStore((s) => s.aiDetectionLoading);
  const error = useMetreStore((s) => s.aiDetectionError);

  const [mode, setMode] = useState<DetectMode>('generic');
  const [singleSection, setSingleSection] = useState<string>('');
  const [multiSections, setMultiSections] = useState<Set<string>>(new Set());
  const [additionalContext, setAdditionalContext] = useState<string>('');
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // Charge la liste des sections quand le modal s'ouvre
  useEffect(() => {
    if (!open) return;
    // Round 8 I2 fix: reset stale progress/error from previous run when reopening
    setProgress(null);
    setSectionsLoading(true);
    listAvailableSections()
      .then((res) => {
        setAvailableSections(res.sections);
        if (res.sections.length > 0 && !singleSection) {
          setSingleSection(res.sections[0]);
        }
      })
      .catch((err) => {
        console.error('[AIDetectModal] Failed to load sections', err);
      })
      .finally(() => setSectionsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Round 15 fix: ERP_REACT historical convention is 1-based pageNumber.
  // CalibrationModal stores pageNumber=currentPage as-is (store.ts:917).
  // All backend calls use 1-based pageNumber to match calibration lookup.

  const toggleMultiSection = (s: string) => {
    setMultiSections((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const handleLaunch = async () => {
    if (!documentId || loading) return;
    setLoading(true);
    setError(null);
    setProgress(null);

    try {
      if (mode === 'multi-section') {
        if (multiSections.size === 0) {
          setError('Selectionne au moins une section.');
          setLoading(false);
          return;
        }
        const sectionList = Array.from(multiSections).sort();
        setProgress(`Lancement detection sur ${sectionList.length} sections...`);
        const result = await runAIDetectMultiSection(documentId, {
          pageNumber: pageNumber,
          sections: sectionList,
          autoCreateLayerPerSection: true,
          additionalContext: additionalContext || undefined,
        });
        setMultiResult(result);
        // Refresh detections (all pending for this page)
        const fresh = await listAIDetections(documentId, {
          pageNumber: pageNumber,
          status: 'pending',
        });
        setAIDetections(fresh);
        setProgress(
          `Detection terminee: ${result.totalDetections} elements sur ${result.sectionsProcessed.length} sections (cout: $${result.totalCostUsd.toFixed(3)})`,
        );
      } else {
        // Single section OR generic
        const sectionParam = mode === 'single-section' ? singleSection : undefined;
        const useBom = mode === 'single-section';
        setProgress(
          mode === 'single-section'
            ? `Detection avec catalogue Section ${sectionParam}...`
            : 'Detection generique en cours...',
        );
        const result = await runAIDetect(documentId, {
          pageNumber: pageNumber,
          detectionTypes: ['surface', 'distance', 'count'],
          additionalContext: additionalContext || undefined,
          sectionNumero: sectionParam,
          useBomCatalog: useBom,
        });
        setLastRun(result);
        const fresh = await listAIDetections(documentId, {
          pageNumber: pageNumber,
          status: 'pending',
        });
        setAIDetections(fresh);
        setProgress(
          `${result.total} detections (cout: $${result.costUsd.toFixed(3)})`,
        );
      }
      // Auto-close apres 2s en cas de succes
      setTimeout(() => {
        setProgress(null);
        onClose();
      }, 2000);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      const message =
        axiosErr?.response?.data?.detail ??
        (err instanceof Error ? err.message : 'Erreur lors de la detection IA');
      setError(message);
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const launchDisabled =
    loading ||
    !documentId ||
    (mode === 'single-section' && !singleSection) ||
    (mode === 'multi-section' && multiSections.size === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-gray-800">Detection IA - Configuration</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Mode selector */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Mode de detection
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer p-2 border border-gray-200 rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="detect-mode"
                  value="generic"
                  checked={mode === 'generic'}
                  onChange={() => setMode('generic')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">Generique (rapide)</div>
                  <div className="text-xs text-gray-500">
                    Detection automatique sans catalogue. ~$0.15
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer p-2 border border-gray-200 rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="detect-mode"
                  value="single-section"
                  checked={mode === 'single-section'}
                  onChange={() => setMode('single-section')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">
                    Section unique avec BOM
                  </div>
                  <div className="text-xs text-gray-500">
                    Detection filtree par catalogue produits d'une section. ~$0.20
                  </div>
                  {availableSections.length === 0 && !sectionsLoading && (
                    <div className="text-xs text-amber-600 mt-0.5">
                      Aucune section trouvee. Remplis "numero_section" sur tes produits BOM.
                    </div>
                  )}
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer p-2 border border-gray-200 rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="detect-mode"
                  value="multi-section"
                  checked={mode === 'multi-section'}
                  onChange={() => setMode('multi-section')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">
                    Multi-sections (avec calques)
                  </div>
                  <div className="text-xs text-gray-500">
                    Detection par section avec layer dedie. ~$0.20 x N sections
                  </div>
                  {availableSections.length === 0 && !sectionsLoading && (
                    <div className="text-xs text-amber-600 mt-0.5">
                      Aucune section trouvee. Remplis "numero_section" sur tes produits BOM.
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* Section selector (single mode) */}
          {mode === 'single-section' && (
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Section a detecter
              </label>
              {sectionsLoading ? (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
                </div>
              ) : availableSections.length === 0 ? (
                <div className="text-sm text-rose-600 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Aucune section trouvee dans le catalogue
                  produits
                </div>
              ) : (
                <select
                  value={singleSection}
                  onChange={(e) => setSingleSection(e.target.value)}
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

          {/* Sections selector (multi mode) */}
          {mode === 'multi-section' && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800 mb-2">
                <ListChecks className="w-4 h-4" />
                <span>
                  Sections a detecter ({multiSections.size}/{availableSections.length})
                </span>
              </div>
              {sectionsLoading ? (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
                </div>
              ) : availableSections.length === 0 ? (
                <div className="text-sm text-rose-600">Aucune section trouvee.</div>
              ) : (
                <>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setMultiSections(new Set(availableSections))}
                      className="text-xs px-2 py-1 rounded bg-gray-100 border border-gray-200 hover:bg-gray-200 text-gray-700"
                    >
                      Tout selectionner
                    </button>
                    <button
                      type="button"
                      onClick={() => setMultiSections(new Set())}
                      className="text-xs px-2 py-1 rounded bg-gray-100 border border-gray-200 hover:bg-gray-200 text-gray-700"
                    >
                      Tout deselectionner
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto p-2 border border-gray-200 rounded">
                    {availableSections.map((s) => (
                      <label
                        key={s}
                        className="flex items-center gap-2 cursor-pointer text-sm text-gray-800 p-1 rounded hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={multiSections.has(s)}
                          onChange={() => toggleMultiSection(s)}
                        />
                        <span>Section {s}</span>
                      </label>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    Cout estime: ~${(0.2 * multiSections.size).toFixed(2)}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Additional context */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">
              Contexte additionnel (optionnel)
            </label>
            <textarea
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value.slice(0, 1000))}
              placeholder="Ex: Plan de fondation seulement, ignore les annotations textuelles..."
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-800 resize-none"
              rows={3}
              maxLength={1000}
            />
            <div className="text-xs text-gray-500 mt-0.5">
              {additionalContext.length}/1000
            </div>
          </div>

          {/* Progress */}
          {progress && (
            <div className="flex items-start gap-2 p-2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm rounded">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mt-0.5" />
              ) : (
                <Check className="w-4 h-4 mt-0.5" />
              )}
              <span>{progress}</span>
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
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={launchDisabled}
            className="px-3 py-1.5 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-400 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{loading ? 'Detection...' : 'Lancer detection'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIDetectModal;
