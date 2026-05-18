/**
 * Mobile React Frontend - Modale d'envoi de document par courriel (Phase 3B)
 *
 * Permet d'envoyer un devis, une facture, un bon de travail ou un bon de
 * commande par courriel avec le PDF joint. Sujet et message generes automa-
 * tiquement cote serveur si laisses vides.
 *
 * Conformite UX :
 *  - Touch targets >= 44 px
 *  - Pas d'emojis (texte fr-CA)
 *  - Validation email cote client + cote serveur (Pydantic EmailStr)
 *  - CC multiples separes par virgule ou retour ligne, parse leger
 */

import { useState } from 'react';
import { Mail, X, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { sendDocumentByEmail } from '@/api/documents';
import type { DocType } from '@/types';
import { extractApiError } from '@/types/api';

interface EmailDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  docType: DocType;
  docId: number;
  docNumero?: string | null;
  defaultToEmail?: string;
  onSuccess?: (toEmail: string) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitCcInput(raw: string): string[] {
  // Accept comma, semicolon, newline, or space as separator.
  return raw
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function EmailDocumentModal({
  isOpen,
  onClose,
  docType,
  docId,
  docNumero,
  defaultToEmail,
  onSuccess,
}: EmailDocumentModalProps) {
  const [toEmail, setToEmail] = useState(defaultToEmail ?? '');
  const [ccInput, setCcInput] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClose = () => {
    if (sending) return;
    setError(null);
    setSuccess(null);
    onClose();
  };

  const handleSend = async () => {
    setError(null);
    setSuccess(null);

    const to = toEmail.trim();
    if (!EMAIL_REGEX.test(to)) {
      setError('Adresse courriel invalide');
      return;
    }

    const ccList = splitCcInput(ccInput);
    const invalidCc = ccList.find((c) => !EMAIL_REGEX.test(c));
    if (invalidCc) {
      setError(`Adresse CC invalide : ${invalidCc}`);
      return;
    }
    if (ccList.length > 10) {
      setError('Maximum 10 adresses en CC');
      return;
    }

    setSending(true);
    try {
      await sendDocumentByEmail(docType, docId, {
        toEmail: to,
        cc: ccList,
        subject: subject.trim(),
        message: message.trim(),
      });
      setSuccess(`Courriel envoye a ${to}`);
      if (onSuccess) onSuccess(to);
      // Auto-close after 1.5s on success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(extractApiError(err, "Echec de l'envoi du courriel"));
    } finally {
      setSending(false);
    }
  };

  const docLabel = docNumero ? `${docNumero}` : `document #${docId}`;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Envoyer par courriel">
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Mail className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Envoi du {docLabel} avec PDF en piece jointe.
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
            htmlFor="email-to"
            className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
          >
            Destinataire *
          </label>
          <input
            id="email-to"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="client@exemple.ca"
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            disabled={sending}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 disabled:opacity-50"
          />
        </div>

        <div>
          <label
            htmlFor="email-cc"
            className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
          >
            CC (optionnel)
          </label>
          <input
            id="email-cc"
            type="text"
            inputMode="email"
            placeholder="autre@exemple.ca, contact@..."
            value={ccInput}
            onChange={(e) => setCcInput(e.target.value)}
            disabled={sending}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Plusieurs adresses separees par une virgule
          </p>
        </div>

        <div>
          <label
            htmlFor="email-subject"
            className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
          >
            Sujet (optionnel)
          </label>
          <input
            id="email-subject"
            type="text"
            placeholder="Genere automatiquement si vide"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            maxLength={500}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 disabled:opacity-50"
          />
        </div>

        <div>
          <label
            htmlFor="email-message"
            className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300"
          >
            Message (optionnel)
          </label>
          <textarea
            id="email-message"
            rows={4}
            placeholder="Message professionnel par defaut si vide"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={sending}
            maxLength={10000}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 disabled:opacity-50 resize-y"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={sending}
            leftIcon={<X className="w-4 h-4" />}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSend}
            isLoading={sending}
            disabled={sending || !toEmail.trim()}
            leftIcon={sending ? undefined : <Send className="w-4 h-4" />}
          >
            {sending ? 'Envoi en cours...' : 'Envoyer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

