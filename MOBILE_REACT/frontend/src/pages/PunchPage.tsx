/**
 * PunchPage - Pointage entrée/sortie
 *
 * Mobile time-tracking page allowing employees to punch in/out
 * of work orders with optional notes and live elapsed timer.
 */

import React, { useEffect, useState } from 'react';
import { Clock, Play, Square, MapPin, FileText, AlertCircle, PenLine } from 'lucide-react';
import { usePunchStore } from '@/store/usePunchStore';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { WeatherBadge } from '@/components/ui/WeatherBadge';
import SignatureModal, { type PunchContext } from '@/components/punch/SignatureModal';
import TimeHistorySection from '@/components/punch/TimeHistorySection';
import { formatTime, formatElapsedMinutes } from '@/utils/format';

const PunchPage: React.FC = () => {
  // Selecteurs Zustand individuels (anti-pattern destructuring v5 = risque React #185).
  const status = usePunchStore((s) => s.status);
  const workOrders = usePunchStore((s) => s.workOrders);
  const isLoading = usePunchStore((s) => s.isLoading);
  const error = usePunchStore((s) => s.error);
  const fetchStatus = usePunchStore((s) => s.fetchStatus);
  const fetchWorkOrders = usePunchStore((s) => s.fetchWorkOrders);
  const punchIn = usePunchStore((s) => s.punchIn);
  const punchOut = usePunchStore((s) => s.punchOut);
  const submitSignatureExterne = usePunchStore((s) => s.submitSignatureExterne);
  const clearError = usePunchStore((s) => s.clearError);

  const [selectedBtId, setSelectedBtId] = useState<number | null>(null);
  const [selectedOpId, setSelectedOpId] = useState<number | null>(null);
  const [notesIn, setNotesIn] = useState('');
  const [notesOut, setNotesOut] = useState('');
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0);

  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureEntryId, setSignatureEntryId] = useState<number | null>(null);
  const [signatureContext, setSignatureContext] = useState<PunchContext | null>(null);
  const [isSubmittingSignature, setIsSubmittingSignature] = useState(false);

  // Fetch status and work orders on mount
  useEffect(() => {
    fetchStatus();
    fetchWorkOrders();
  }, [fetchStatus, fetchWorkOrders]);

  // Live elapsed timer when punched in
  useEffect(() => {
    if (!status?.isPunchedIn || !status.activeEntry?.punchIn) {
      setElapsedMinutes(0);
      return;
    }

    // Ensure UTC parsing: append 'Z' if no timezone info present
    const raw = status.activeEntry.punchIn;
    const iso = raw.endsWith('Z') || raw.includes('+') ? raw : raw + 'Z';
    const punchInTime = new Date(iso).getTime();

    const tick = () => {
      const now = Date.now();
      const delta = Math.floor((now - punchInTime) / 60_000);
      setElapsedMinutes(delta < 0 ? 0 : delta);
    };

    tick();
    const interval = setInterval(tick, 1_000);

    return () => clearInterval(interval);
  }, [status?.isPunchedIn, status?.activeEntry?.punchIn]);

  const handlePunchIn = async () => {
    if (selectedBtId === null) return;
    await punchIn(selectedBtId, notesIn.trim() || undefined, selectedOpId ?? undefined);
    setNotesIn('');
    setSelectedBtId(null);
    setSelectedOpId(null);
  };

  const handlePunchOut = async () => {
    await punchOut(notesOut.trim() || undefined);
    setNotesOut('');
  };

  const handlePunchOutWithSignature = async () => {
    // Capture le contexte AVANT le punch out (apres, status.activeEntry devient null).
    // Lecture directe depuis status pour eviter toute dependance sur des const declares plus bas.
    const currentActive = status?.activeEntry ?? null;
    const snapshot: PunchContext = {
      numeroBt: currentActive?.numeroBt ?? null,
      operationNom: currentActive?.operationNom ?? null,
      projectNom: currentActive?.projectNom ?? null,
      elapsedMinutes,
    };
    const entry = await punchOut(notesOut.trim() || undefined);
    setNotesOut('');
    if (entry && entry.id) {
      setSignatureEntryId(entry.id);
      setSignatureContext(snapshot);
      // Defense en profondeur : clear toute erreur store residuelle (le punchOut
      // store action clear deja, mais on confirme ici) AVANT d'ouvrir le modal
      // pour eviter qu'une erreur sans rapport ne s'affiche dans submissionError.
      clearError();
      setSignatureModalOpen(true);
    }
  };

  const handleSignatureSubmit = async (signatureBase64: string, signataireNom: string): Promise<boolean> => {
    if (signatureEntryId === null) return false;
    setIsSubmittingSignature(true);
    // Clear store error AVANT submission : garantit que `error` qu'on passera
    // en submissionError au modal reflete uniquement la tentative en cours,
    // pas une erreur de punch out anterieure.
    clearError();
    try {
      const ok = await submitSignatureExterne(signatureEntryId, signatureBase64, signataireNom);
      return ok;
    } finally {
      setIsSubmittingSignature(false);
    }
  };

  const handleSignatureClose = () => {
    setSignatureModalOpen(false);
    setSignatureEntryId(null);
    setSignatureContext(null);
    // Clear l'erreur store en sortant du modal pour ne pas la voir reapparaitre
    // dans l'UI principale apres fermeture.
    clearError();
  };

  // ── Loading state while initial status is unknown ──────────────
  if (status === null && !error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  const isPunchedIn = status?.isPunchedIn ?? false;
  const active = status?.activeEntry ?? null;

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center justify-center h-12 w-12 rounded-full ${
            isPunchedIn
              ? 'bg-green-100 dark:bg-green-900/30'
              : 'bg-gray-100 dark:bg-gray-800'
          }`}
        >
          <Clock
            className={`h-6 w-6 ${
              isPunchedIn
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Pointage
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {isPunchedIn ? 'En service' : 'Hors service'}
          </p>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────── */}
      {error && (
        <Alert type="error" onDismiss={clearError}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </Alert>
      )}

      {/* ── PUNCHED IN VIEW ─────────────────────────────────── */}
      {isPunchedIn && active && (
        <div className="space-y-5">
          {/* Active entry card */}
          <div className="rounded-xl border border-green-200 bg-green-50 p-5 dark:border-green-800 dark:bg-green-900/20">
            {/* Work order & project */}
            <div className="flex items-start gap-3 mb-4">
              <FileText className="h-5 w-5 mt-0.5 text-green-700 dark:text-green-400 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-green-900 dark:text-green-200 truncate">
                  BT {active.numeroBt ?? '--'}
                </p>
                {active.operationNom && (
                  <p className="text-sm text-green-700 dark:text-green-400 truncate">
                    {active.operationNom}
                  </p>
                )}
                {active.projectNom && (
                  <p className="text-sm text-green-600 dark:text-green-500 truncate">
                    {active.projectNom}
                  </p>
                )}
              </div>
            </div>

            {/* Punch-in time */}
            <div className="flex items-center gap-3 mb-4 text-sm text-green-700 dark:text-green-400">
              <MapPin className="h-4 w-4 shrink-0" />
              <span>
                Entrée à {formatTime(active.punchIn)}
              </span>
            </div>

            {/* Live elapsed timer */}
            <div className="text-center py-4 border-t border-green-200 dark:border-green-800">
              <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">
                Temps écoulé
              </p>
              <p className="text-4xl font-mono font-bold text-green-900 dark:text-green-100">
                {formatElapsedMinutes(elapsedMinutes)}
              </p>
            </div>

            {/* Météo capturée à l'entrée (si disponible) */}
            {active.weatherIn && (
              <div className="mt-4 pt-4 border-t border-green-200 dark:border-green-800">
                <WeatherBadge
                  weather={active.weatherIn}
                  variant="detailed"
                  label="à l'entrée"
                />
              </div>
            )}
          </div>

          {/* Notes for punch out */}
          <div>
            <label
              htmlFor="notes-out"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              Notes (optionnel)
            </label>
            <textarea
              id="notes-out"
              rows={3}
              value={notesOut}
              onChange={(e) => setNotesOut(e.target.value)}
              placeholder="Remarques, travaux complétés..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
                placeholder:text-gray-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/20
                dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500
                dark:focus:border-red-400 dark:focus:ring-red-400/20 resize-none"
            />
          </div>

          {/* Punch out buttons */}
          <div className="space-y-2">
            <Button
              variant="danger"
              size="lg"
              className="w-full text-lg py-4"
              isLoading={isLoading}
              leftIcon={<Square className="h-6 w-6" />}
              onClick={handlePunchOut}
            >
              Pointer la sortie
            </Button>
            <Button
              size="lg"
              className="w-full text-base py-3 !bg-seaop-primary-600 hover:!bg-seaop-primary-700
                active:!bg-seaop-primary-800 dark:!bg-seaop-primary-600 dark:hover:!bg-seaop-primary-700"
              isLoading={isLoading}
              leftIcon={<PenLine className="h-5 w-5" />}
              onClick={handlePunchOutWithSignature}
            >
              Pointer la sortie + signature client
            </Button>
          </div>
        </div>
      )}

      {/* ── NOT PUNCHED IN VIEW ─────────────────────────────── */}
      {!isPunchedIn && (
        <div className="space-y-5">
          {/* Work order selection */}
          <div>
            <label
              htmlFor="work-order-select"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              Bon de travail
            </label>

            {workOrders.length === 0 && !isLoading ? (
              <Alert type="warning">
                Aucun bon de travail disponible.
              </Alert>
            ) : (
              <select
                id="work-order-select"
                value={selectedBtId ?? ''}
                onChange={(e) => {
                  setSelectedBtId(e.target.value ? Number(e.target.value) : null);
                  setSelectedOpId(null);
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm
                  focus:border-seaop-primary-500 focus:ring-2 focus:ring-seaop-primary-500/20
                  dark:border-gray-600 dark:bg-gray-800 dark:text-white
                  dark:focus:border-seaop-primary-400 dark:focus:ring-seaop-primary-400/20
                  min-h-[44px]"
              >
                <option value="">-- Sélectionnez un bon de travail --</option>
                {workOrders.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.numeroDocument}
                    {wo.description ? ` - ${wo.description}` : ''}
                    {wo.projectNom ? ` | ${wo.projectNom}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Selected work order details */}
          {selectedBtId !== null && (() => {
            const selected = workOrders.find((wo) => wo.id === selectedBtId);
            if (!selected) return null;
            return (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-800/50 space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400 shrink-0" />
                  <span className="font-medium text-gray-900 dark:text-white">
                    {selected.numeroDocument}
                    {selected.description ? ` - ${selected.description}` : ''}
                  </span>
                </div>
                {selected.projectNom && (
                  <p className="text-gray-600 dark:text-gray-400 ml-6">
                    {selected.projectNom}
                  </p>
                )}
                {selected.adresseChantier && (
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span>
                      {selected.adresseChantier}
                      {selected.villeChantier ? `, ${selected.villeChantier}` : ''}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Operation selection (if BT has operations) */}
          {selectedBtId !== null && (() => {
            const selected = workOrders.find((wo) => wo.id === selectedBtId);
            if (!selected || selected.operations.length === 0) return null;
            return (
              <div>
                <label
                  htmlFor="operation-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  Opération (optionnel)
                </label>
                <select
                  id="operation-select"
                  value={selectedOpId ?? ''}
                  onChange={(e) =>
                    setSelectedOpId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm
                    focus:border-seaop-primary-500 focus:ring-2 focus:ring-seaop-primary-500/20
                    dark:border-gray-600 dark:bg-gray-800 dark:text-white
                    dark:focus:border-seaop-primary-400 dark:focus:ring-seaop-primary-400/20
                    min-h-[44px]"
                >
                  <option value="">-- Aucune opération --</option>
                  {selected.operations.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.nom}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}

          {/* Notes for punch in */}
          <div>
            <label
              htmlFor="notes-in"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              Notes (optionnel)
            </label>
            <textarea
              id="notes-in"
              rows={3}
              value={notesIn}
              onChange={(e) => setNotesIn(e.target.value)}
              placeholder="Tâches prévues, conditions météo..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
                placeholder:text-gray-400 focus:border-green-500 focus:ring-2 focus:ring-green-500/20
                dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500
                dark:focus:border-green-400 dark:focus:ring-green-400/20 resize-none"
            />
          </div>

          {/* Punch in button */}
          <Button
            size="lg"
            className="w-full text-lg py-4 !bg-green-600 hover:!bg-green-700 active:!bg-green-800
              dark:!bg-green-600 dark:hover:!bg-green-700"
            isLoading={isLoading}
            disabled={selectedBtId === null}
            leftIcon={<Play className="h-6 w-6" />}
            onClick={handlePunchIn}
          >
            Pointer l&apos;entrée
          </Button>
        </div>
      )}

      {/* Historique de pointage + resume hebdo (fusion ex-HistoryPage) */}
      <TimeHistorySection />

      {/* Signature externe modale (apres punch out + signature client) */}
      <SignatureModal
        isOpen={signatureModalOpen}
        context={signatureContext ?? undefined}
        isSubmitting={isSubmittingSignature}
        submissionError={signatureModalOpen ? error : null}
        onSubmit={handleSignatureSubmit}
        onClose={handleSignatureClose}
      />
    </div>
  );
};

PunchPage.displayName = 'PunchPage';

export default PunchPage;
