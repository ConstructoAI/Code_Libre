/**
 * Mobile React Frontend - Modale "Rendre facture recurrente" (Phase 5C)
 *
 * Permet a un ADMIN ou MANAGER de marquer une facture comme template
 * recurrent. Le serveur stocke une config dans la table publique
 * mobile_recurrent_invoices_config et dupliquera la facture source a chaque
 * appel du endpoint /factures/recurrent/run.
 *
 * Conformite UX :
 *  - Touch targets >= 44 px
 *  - Pas d'emojis, fr-CA
 *  - Pas de "any" TS
 */

import { useState } from 'react';
import { RotateCw, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import {
  createRecurrentInvoice,
  type RecurrentFrequency,
  type RecurrentInvoiceConfig,
} from '@/api/documents';
import { extractApiError } from '@/types/api';

interface RecurrentInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  factureId: number;
  factureNumero?: string | null;
  onSuccess?: (config: RecurrentInvoiceConfig) => void;
}

const FREQUENCY_LABELS: Record<RecurrentFrequency, string> = {
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  quarterly: 'Chaque trimestre',
  yearly: 'Chaque annee',
};

export function RecurrentInvoiceModal({
  isOpen,
  onClose,
  factureId,
  factureNumero,
  onSuccess,
}: RecurrentInvoiceModalProps) {
  const [frequency, setFrequency] = useState<RecurrentFrequency>('monthly');
  const [startDate, setStartDate] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClose = () => {
    if (submitting) return;
    setError(null);
    setSuccess(null);
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const config = await createRecurrentInvoice(factureId, {
        frequency,
        description: description.trim() || undefined,
        startDate: startDate.trim() || undefined,
      });
      setSuccess(
        `Facture marquee comme ${FREQUENCY_LABELS[frequency].toLowerCase()}. `
        + `Prochaine generation : ${new Date(config.next_run_at).toLocaleDateString('fr-CA')}.`,
      );
      if (onSuccess) onSuccess(config);
      // Auto-close after 1.8s
      setTimeout(() => {
        handleClose();
      }, 1800);
    } catch (err) {
      const apiErr = err as { response?: { status?: number; data?: { detail?: string } } };
      const status = apiErr?.response?.status;
      if (status === 403) {
        setError("Permission insuffisante. Seuls les roles ADMIN et MANAGER peuvent rendre une facture recurrente.");
      } else if (status === 404) {
        setError('Facture source introuvable.');
      } else {
        setError(extractApiError(err, 'Erreur lors de la creation de la facture recurrente.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const label = factureNumero ? factureNumero : `facture #${factureId}`;

  // ISO date du lendemain (defaut suggere). Stockee comme string YYYY-MM-DD.
  const tomorrowIso = (() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return t.toISOString().slice(0, 10);
  })();

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Rendre la facture recurrente">
      <div className="px-4 py-4 space-y-4">
        <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
          <RotateCw className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            La {label} sera utilisee comme modele. Une nouvelle facture sera
            generee automatiquement a la frequence choisie.
          </span>
        </div>

        {error && (
          <Alert type="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert type="success" onDismiss={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        <div>
          <label
            htmlFor="recurrent-frequency"
            className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
          >
            Frequence *
          </label>
          <select
            id="recurrent-frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as RecurrentFrequency)}
            disabled={submitting}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 disabled:opacity-50 min-h-[44px]"
          >
            <option value="weekly">Chaque semaine</option>
            <option value="monthly">Chaque mois</option>
            <option value="quarterly">Chaque trimestre</option>
            <option value="yearly">Chaque annee</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="recurrent-start-date"
            className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
          >
            Date de la prochaine generation (optionnel)
          </label>
          <input
            id="recurrent-start-date"
            type="date"
            value={startDate}
            min={tomorrowIso}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={submitting}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 disabled:opacity-50 min-h-[44px]"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Laisser vide pour generer dans une periode (selon la frequence).
          </p>
        </div>

        <div>
          <label
            htmlFor="recurrent-description"
            className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
          >
            Description (optionnel)
          </label>
          <textarea
            id="recurrent-description"
            rows={3}
            placeholder="Ex. contrat de maintenance mensuel"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            maxLength={2000}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 disabled:opacity-50 resize-y"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
            leftIcon={<X className="w-4 h-4" />}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            isLoading={submitting}
            disabled={submitting}
            leftIcon={submitting ? undefined : <RotateCw className="w-4 h-4" />}
          >
            {submitting ? 'Enregistrement...' : 'Confirmer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
