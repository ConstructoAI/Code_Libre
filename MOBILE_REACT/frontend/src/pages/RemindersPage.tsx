/**
 * Mobile React Frontend - Relances factures impayees (Phase 4B)
 *
 * Page reservee ADMIN/MANAGER. Affiche les factures en retard groupees par
 * aging bucket (J30/J60/J90/J90+) avec montants. Permet l'envoi en lot des
 * relances par email (mode reel, dry_run, ou test email).
 *
 * Conformite UX :
 *  - Touch targets >= 44 px
 *  - Pas d'emojis
 *  - Francais Quebec
 *  - Pas de any TS
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  Mail,
  Send,
  X,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Info,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate } from '@/utils/format';
import { getOverdueFactures, sendReminders } from '@/api/reminders';
import { extractApiError } from '@/types/api';
import type {
  OverdueResponse,
  ReminderBucket,
  RemindersSendResponse,
} from '@/types';

const ALL_BUCKETS: ReminderBucket[] = ['J30', 'J60', 'J90', 'J90+'];

const BUCKET_META: Record<ReminderBucket, { label: string; description: string; color: string; bg: string }> = {
  J30: {
    label: 'J + 30',
    description: '1 a 30 jours de retard',
    color: 'text-yellow-700 dark:text-yellow-300',
    bg: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  },
  J60: {
    label: 'J + 60',
    description: '31 a 60 jours de retard',
    color: 'text-orange-700 dark:text-orange-300',
    bg: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
  },
  J90: {
    label: 'J + 90',
    description: '61 a 90 jours de retard',
    color: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  },
  'J90+': {
    label: 'J + 90 et plus',
    description: 'Plus de 90 jours de retard',
    color: 'text-red-900 dark:text-red-200',
    bg: 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700',
  },
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RemindersPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<OverdueResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modale envoi
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedBuckets, setSelectedBuckets] = useState<Set<ReminderBucket>>(
    new Set(ALL_BUCKETS),
  );
  const [dryRun, setDryRun] = useState(false);
  const [useTestEmail, setUseTestEmail] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<RemindersSendResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const resp = await getOverdueFactures();
      setData(resp);
    } catch (err) {
      setError(extractApiError(err, 'Impossible de charger les factures en retard'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Compteur factures eligibles pour les buckets selectionnes
  const selectedTotals = useMemo(() => {
    if (!data) return { count: 0, amount: 0 };
    let count = 0;
    let amount = 0;
    for (const b of data.buckets) {
      if (selectedBuckets.has(b.bucket)) {
        count += b.count;
        amount += b.totalSoldeDu;
      }
    }
    return { count, amount };
  }, [data, selectedBuckets]);

  const toggleBucket = (bucket: ReminderBucket) => {
    setSelectedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) {
        next.delete(bucket);
      } else {
        next.add(bucket);
      }
      return next;
    });
  };

  const openSendModal = () => {
    setSendResult(null);
    setSendError(null);
    setDryRun(false);
    setUseTestEmail(false);
    setTestEmail('');
    // Pre-cocher les buckets ayant au moins 1 facture
    if (data) {
      const withCount = new Set<ReminderBucket>();
      for (const b of data.buckets) {
        if (b.count > 0) withCount.add(b.bucket);
      }
      setSelectedBuckets(withCount.size > 0 ? withCount : new Set(ALL_BUCKETS));
    } else {
      setSelectedBuckets(new Set(ALL_BUCKETS));
    }
    setShowSendModal(true);
  };

  const closeSendModal = () => {
    if (sending) return;
    setShowSendModal(false);
  };

  const handleSend = async () => {
    setSendError(null);
    setSendResult(null);

    if (selectedBuckets.size === 0) {
      setSendError('Veuillez selectionner au moins un bucket.');
      return;
    }

    let testEmailClean: string | undefined;
    if (useTestEmail) {
      testEmailClean = testEmail.trim();
      if (!EMAIL_REGEX.test(testEmailClean)) {
        setSendError('Adresse email de test invalide.');
        return;
      }
    }

    setSending(true);
    try {
      const resp = await sendReminders({
        buckets: Array.from(selectedBuckets),
        dryRun,
        testEmail: testEmailClean,
      });
      setSendResult(resp);
      // Recharger les donnees si envoi reel (factures inchangees apres dry_run)
      if (!resp.dryRun) {
        void loadData();
      }
    } catch (err) {
      setSendError(extractApiError(err, "Echec de l'envoi des relances"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-4 py-5 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Retour"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Relances factures
          </h1>
        </div>
        <button
          onClick={() => void loadData()}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
          aria-label="Actualiser"
        >
          <RefreshCw className={`w-5 h-5 text-gray-600 dark:text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <Alert type="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Totaux globaux */}
      {data && (
        <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Total factures en retard
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {data.totalCount}
              </p>
              <p className="text-sm font-semibold text-red-600 dark:text-red-400 mt-0.5">
                {formatCurrency(data.totalAmount)} a recouvrer
              </p>
            </div>
            {data.totalCount > 0 && (
              <Button
                type="button"
                variant="primary"
                onClick={openSendModal}
                leftIcon={<Mail className="w-4 h-4" />}
              >
                Envoyer relances
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Loader initial */}
      {isLoading && !data && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {/* Buckets */}
      {data && data.totalCount === 0 && !isLoading && (
        <div className="text-center py-12">
          <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-green-500" />
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            Aucune facture en retard
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Toutes les factures sont a jour.
          </p>
        </div>
      )}

      {data && data.totalCount > 0 && (
        <div className="space-y-4">
          {data.buckets.map((bucket) => {
            if (bucket.count === 0) return null;
            const meta = BUCKET_META[bucket.bucket];
            return (
              <div
                key={bucket.bucket}
                className={`rounded-xl border ${meta.bg} overflow-hidden`}
              >
                <div className="px-4 py-3 border-b border-current/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-sm font-bold ${meta.color}`}>
                        {meta.label}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {meta.description}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${meta.color}`}>
                        {bucket.count}
                      </p>
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        {formatCurrency(bucket.totalSoldeDu)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                  {bucket.factures.map((f) => (
                    <div
                      key={f.id}
                      className="px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {f.numero}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {f.clientNom || 'Client inconnu'}
                          </p>
                          {f.clientEmail ? (
                            <p className="text-[10px] text-gray-500 dark:text-gray-500 truncate mt-0.5">
                              {f.clientEmail}
                            </p>
                          ) : (
                            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                              Email client manquant
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                            {formatCurrency(f.soldeDu)}
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                            {f.dateEcheance ? formatDate(f.dateEcheance) : '--'}
                          </p>
                          <p className="text-[10px] font-medium text-gray-600 dark:text-gray-300">
                            {f.daysOverdue} j
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modale envoi */}
      <Modal
        isOpen={showSendModal}
        onClose={closeSendModal}
        title="Envoyer les relances"
      >
        <div className="space-y-4">
          {sendResult ? (
            <SendResultView result={sendResult} onClose={closeSendModal} />
          ) : (
            <>
              <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                <Mail className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Selectionnez les buckets a relancer. Chaque facture eligible
                  recevra un courriel avec PDF en piece jointe.
                </span>
              </div>

              {sendError && (
                <Alert type="error" onDismiss={() => setSendError(null)}>
                  {sendError}
                </Alert>
              )}

              {/* Selection buckets */}
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Buckets
                </p>
                <div className="space-y-2">
                  {ALL_BUCKETS.map((b) => {
                    const meta = BUCKET_META[b];
                    const summary = data?.buckets.find((x) => x.bucket === b);
                    const count = summary?.count ?? 0;
                    const checked = selectedBuckets.has(b);
                    const disabled = count === 0 || sending;
                    return (
                      <label
                        key={b}
                        className={`flex items-center justify-between gap-3 p-3 rounded-lg border min-h-[44px] cursor-pointer ${
                          disabled
                            ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'
                            : checked
                            ? `${meta.bg} border-current`
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBucket(b)}
                            disabled={disabled}
                            className="w-5 h-5 rounded text-seaop-primary-600 focus:ring-seaop-primary-500"
                          />
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium ${checked ? meta.color : 'text-gray-700 dark:text-gray-300'}`}>
                              {meta.label}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {meta.description}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">
                            {count}
                          </p>
                          {summary && summary.totalSoldeDu > 0 && (
                            <p className="text-[10px] text-gray-500 dark:text-gray-400">
                              {formatCurrency(summary.totalSoldeDu)}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Selection : {selectedTotals.count} facture
                  {selectedTotals.count !== 1 ? 's' : ''} ({formatCurrency(selectedTotals.amount)})
                </p>
              </div>

              {/* Options */}
              <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
                <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    disabled={sending}
                    className="w-5 h-5 mt-0.5 rounded text-seaop-primary-600 focus:ring-seaop-primary-500"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Mode simulation (dry run)
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Affiche la liste qui serait envoyee, sans envoyer reellement.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={useTestEmail}
                    onChange={(e) => setUseTestEmail(e.target.checked)}
                    disabled={sending}
                    className="w-5 h-5 mt-0.5 rounded text-seaop-primary-600 focus:ring-seaop-primary-500"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Email de test
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Envoie toutes les relances a une adresse de test au lieu des vrais clients.
                    </p>
                  </div>
                </label>

                {useTestEmail && (
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="test@exemple.ca"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    disabled={sending}
                    className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 disabled:opacity-50"
                  />
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={closeSendModal}
                  disabled={sending}
                  leftIcon={<X className="w-4 h-4" />}
                >
                  Annuler
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void handleSend()}
                  isLoading={sending}
                  disabled={sending || selectedTotals.count === 0}
                  leftIcon={sending ? undefined : <Send className="w-4 h-4" />}
                >
                  {sending
                    ? 'Envoi en cours...'
                    : dryRun
                    ? `Simuler (${selectedTotals.count})`
                    : `Envoyer (${selectedTotals.count})`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

interface SendResultViewProps {
  result: RemindersSendResponse;
  onClose: () => void;
}

function SendResultView({ result, onClose }: SendResultViewProps) {
  const isDry = result.dryRun;
  const hasFailures = result.failedCount > 0;
  const failedDetails = result.details.filter((d) => d.status === 'failed');
  const skippedDetails = result.details.filter((d) => d.status === 'skipped');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {hasFailures ? (
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
        )}
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {isDry ? 'Simulation terminee' : 'Envoi termine'}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            {result.totalProcessed} facture{result.totalProcessed !== 1 ? 's' : ''} traitee{result.totalProcessed !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center border border-green-200 dark:border-green-800">
          <p className="text-[10px] text-green-700 dark:text-green-300 font-medium">
            {isDry ? 'Simulees' : 'Envoyees'}
          </p>
          <p className="text-xl font-bold text-green-700 dark:text-green-300">
            {isDry ? result.totalProcessed - result.failedCount - result.skippedCount : result.sentCount}
          </p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center border border-amber-200 dark:border-amber-800">
          <p className="text-[10px] text-amber-700 dark:text-amber-300 font-medium">
            Ignorees
          </p>
          <p className="text-xl font-bold text-amber-700 dark:text-amber-300">
            {result.skippedCount}
          </p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center border border-red-200 dark:border-red-800">
          <p className="text-[10px] text-red-700 dark:text-red-300 font-medium">
            Echecs
          </p>
          <p className="text-xl font-bold text-red-700 dark:text-red-300">
            {result.failedCount}
          </p>
        </div>
      </div>

      {/* Details echecs */}
      {failedDetails.length > 0 && (
        <div className="border border-red-200 dark:border-red-800 rounded-lg p-3 bg-red-50 dark:bg-red-900/10">
          <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-2 flex items-center gap-1.5">
            <XCircle className="w-4 h-4" />
            Echecs
          </p>
          <ul className="space-y-1 text-xs text-red-700 dark:text-red-300">
            {failedDetails.map((d) => (
              <li key={`failed-${d.factureId}`}>
                {d.numero} ({d.bucket}) : {d.error || 'erreur inconnue'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Details skipped */}
      {skippedDetails.length > 0 && (
        <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 bg-amber-50 dark:bg-amber-900/10">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1.5">
            <Info className="w-4 h-4" />
            Ignorees
          </p>
          <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
            {skippedDetails.map((d) => (
              <li key={`skipped-${d.factureId}`}>
                {d.numero} ({d.bucket}) : {d.error || 'raison non specifiee'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="button" variant="primary" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </div>
  );
}
