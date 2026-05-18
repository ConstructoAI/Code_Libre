import React, { useMemo, useState } from 'react';
import { Check, X, Edit3, CheckCheck, Trash2, Sparkles } from 'lucide-react';
import { useMetreStore } from '../../store';
import { AI_CATEGORY_COLORS, AI_CATEGORY_LABELS_FR } from '../../types';
import type { AIDetection, Measurement } from '../../types';
import { updateAIDetectionStatus } from '../../aiDetections';
import { listMeasurements } from '../../api';
import { AIConfidenceBadge } from './AIConfidenceBadge';

interface Props {
  /** 1-based page number (UI / pdf.js convention). */
  pageNumber: number;
  className?: string;
}

/**
 * Panneau lateral listant les suggestions IA pour la page courante avec
 * actions accept / reject / corriger.
 *
 * Indexation des pages: la prop `pageNumber` est 1-based (UI), tandis que
 * les detections persistees en BD via le backend stockent `pageNumber` en
 * 0-based. On convertit donc dans le filter ci-dessous.
 */
export const AISuggestionsPanel: React.FC<Props> = ({ pageNumber, className = '' }) => {
  const detections = useMetreStore((s) => s.aiDetections);
  const updateStatus = useMetreStore((s) => s.updateAIDetectionStatus);
  const removeDetection = useMetreStore((s) => s.removeAIDetection);
  const clearAll = useMetreStore((s) => s.clearAIDetections);
  const lastRun = useMetreStore((s) => s.aiDetectionLastRun);
  const setMeasurements = useMetreStore((s) => s.setMeasurements);
  const documentRef = useMetreStore((s) => s.document);

  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Round 15 fix: ERP_REACT historical convention is 1-based pageNumber
  // (CalibrationModal stores pageNumber=currentPage, see store.ts:917). All
  // pageNumber values are 1-based: calibrations, measurements, AI detections.
  const pageDetections = useMemo(
    () =>
      detections.filter(
        (d) => d.pageNumber === pageNumber && d.status === 'pending',
      ),
    [detections, pageNumber],
  );

  const stats = useMemo(() => {
    const total = pageDetections.length;
    const avgConf =
      total > 0
        ? pageDetections.reduce((acc, d) => acc + (d.confidence || 0), 0) / total
        : 0;
    return { total, avgConf };
  }, [pageDetections]);

  /**
   * After the backend creates a measurement from an accepted AI detection,
   * the frontend store would otherwise show stale data until full reload.
   * Refetch the document's measurements so the freshly-created row is
   * reflected in the canvas / list immediately.
   */
  const refreshMeasurementsForDocument = async () => {
    const docId = documentRef?.id;
    if (!docId) return;
    try {
      const fresh: Measurement[] = await listMeasurements(docId);
      setMeasurements(fresh);
    } catch (err) {
      console.error('AI accept: refresh measurements failed', err);
    }
  };

  /**
   * Accept a single detection.
   *
   * Round 4 B1: `skipRefresh=true` lets `handleAcceptAll` defer the measurements
   * refetch and trigger a single bulk refresh once, instead of N parallel
   * `listMeasurements` calls (re-render storm, redundant network traffic).
   */
  const handleAccept = async (
    det: AIDetection,
    correctedValue?: number,
    skipRefresh = false,
  ) => {
    try {
      const result = await updateAIDetectionStatus(det.id, 'accepted', {
        userCorrectionValue: correctedValue,
        createMeasurement: true,
      });
      updateStatus(det.id, 'accepted', correctedValue);
      removeDetection(det.id);
      setEditing(null);
      // Backend created a metre_measurements row -> pull fresh list so the
      // measurement appears on the canvas without a manual reload.
      if (!skipRefresh && result?.measurementId) {
        await refreshMeasurementsForDocument();
      }
      return result;
    } catch (err) {
      console.error('AI accept error', err);
      throw err; // rethrow so Promise.allSettled can flag the failure
    }
  };

  const handleEditConfirm = (det: AIDetection) => {
    const parsed = parseFloat(editValue);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    void handleAccept(det, parsed);
  };

  const handleReject = async (det: AIDetection) => {
    try {
      await updateAIDetectionStatus(det.id, 'rejected');
      updateStatus(det.id, 'rejected');
      removeDetection(det.id);
    } catch (err) {
      console.error('AI reject error', err);
    }
  };

  const handleAcceptAll = async () => {
    // Snapshot to avoid mutating the iteration target while detections are
    // being removed from the store on each successful accept.
    const snapshot = [...pageDetections];
    // Round 4 B1: pass skipRefresh=true so each accept does NOT trigger its
    // own listMeasurements call (would be N parallel HTTP requests + N
    // setMeasurements re-renders). Single bulk refresh below covers them all.
    const results = await Promise.allSettled(
      snapshot.map((det) => handleAccept(det, undefined, true)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    if (failed > 0) {
      console.warn(
        `AI acceptAll: ${failed}/${snapshot.length} acceptations IA ont echoue`,
      );
    }
    if (succeeded > 0) {
      // Single refetch covers all newly-created measurements.
      await refreshMeasurementsForDocument();
    }
  };

  const isEditValueValid = Number.isFinite(parseFloat(editValue)) && parseFloat(editValue) >= 0;

  if (pageDetections.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-8 text-gray-500 ${className}`}
      >
        <Sparkles className="w-8 h-8 mb-2" />
        <p className="text-sm">Aucune suggestion IA pour cette page</p>
        <p className="text-xs mt-1">
          Cliquez sur "Detecter IA" pour lancer l'analyse
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <span className="font-semibold text-sm text-gray-800">
            Suggestions IA ({stats.total})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            Conf. moy. {Math.round(stats.avgConf * 100)}%
          </span>
          {lastRun && (
            <span
              className="text-xs text-gray-500"
              title={`Cout: $${lastRun.costUsd.toFixed(4)} - Tokens: ${lastRun.tokensIn} in / ${lastRun.tokensOut} out`}
            >
              ${lastRun.costUsd.toFixed(3)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 p-2 border-b border-gray-200 bg-gray-50">
        <button
          type="button"
          onClick={handleAcceptAll}
          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700"
        >
          <CheckCheck className="w-3.5 h-3.5" />
          Tout accepter
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
          title="Vider les suggestions"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {pageDetections.map((det) => {
          const cat = det.category ?? 'other';
          const catLabel = AI_CATEGORY_LABELS_FR[cat] ?? 'Autre';
          const catColor = AI_CATEGORY_COLORS[cat] ?? '#9CA3AF';
          const isEditing = editing === det.id;
          return (
            <div
              key={det.id}
              className="border-b border-gray-200 p-2 hover:bg-gray-50"
            >
              <div className="flex items-start gap-2">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                  style={{ backgroundColor: catColor }}
                  title={catLabel}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-800 truncate">
                      {det.label || catLabel}
                    </span>
                    <AIConfidenceBadge confidence={det.confidence} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {catLabel} - {det.detectedValue.toFixed(2)} {det.unit}
                  </div>
                  {isEditing && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-20 px-1.5 py-0.5 text-xs bg-white border border-gray-300 rounded text-gray-800 focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleEditConfirm(det)}
                        disabled={!isEditValueValid}
                        className={[
                          'px-1.5 py-0.5 text-xs rounded',
                          isEditValueValid
                            ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                            : 'bg-emerald-200 text-emerald-500 cursor-not-allowed',
                        ].join(' ')}
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Annuler
                      </button>
                    </div>
                  )}
                </div>
                {!isEditing && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAccept(det)}
                      className="p-1 rounded text-emerald-600 hover:bg-emerald-100"
                      title="Accepter"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(det.id);
                        setEditValue(det.detectedValue.toString());
                      }}
                      className="p-1 rounded text-amber-600 hover:bg-amber-100"
                      title="Corriger valeur"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(det)}
                      className="p-1 rounded text-rose-600 hover:bg-rose-100"
                      title="Rejeter"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AISuggestionsPanel;
