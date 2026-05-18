/**
 * SEAOP React Frontend - Nouveau Projet Page
 * Create a new appel d'offres. Wraps LeadForm with submit logic.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FileText, CheckCircle, Copy, Check } from 'lucide-react';

import { useLeadStore } from '@/store/useLeadStore';
import { LeadForm } from '@/components/leads/LeadForm';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import type { LeadCreate } from '@/types';

export default function NouveauProjetPage() {
  const navigate = useNavigate();
  const { createLead, isLoading } = useLeadStore();
  const [error, setError] = useState<string | null>(null);
  const [successRef, setSuccessRef] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  async function handleSubmit(data: LeadCreate) {
    setError(null);
    try {
      const lead = await createLead(data);
      const ref = lead.numeroReference ?? null;
      setSuccessRef(ref);
      // Clear draft on successful submit
      try {
        localStorage.removeItem('seaop_lead_draft');
      } catch {
        // ignore storage errors
      }
      // Auto-copy reference number if available
      if (ref) {
        try {
          await navigator.clipboard.writeText(ref);
          toast.success('Appel d\u2019offres publié', {
            description: `Référence ${ref} copiée automatiquement dans le presse-papier.`,
          });
        } catch {
          toast.success('Appel d\u2019offres publié', {
            description: `Référence : ${ref}`,
          });
        }
      } else {
        toast.success('Appel d\u2019offres publié avec succès.');
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Une erreur est survenue lors de la publication de l’appel d’offres.";
      setError(message);
      toast.error('Publication impossible', { description: message });
    }
  }

  async function handleCopy() {
    if (successRef) {
      try {
        await navigator.clipboard.writeText(successRef);
        setCopied(true);
        toast.success('Numéro de référence copié dans le presse-papier');
        if (copyTimerRef.current) {
          clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('Impossible de copier — sélectionnez et copiez manuellement.');
      }
    }
  }

  // Success screen after lead is created
  if (successRef) {
    return (
      <div className="max-w-lg mx-auto mt-6 sm:mt-12">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 sm:p-8 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Votre appel d&apos;offres a été publié avec succès!
          </h2>

          <button
            type="button"
            onClick={handleCopy}
            className="mt-6 w-full group bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg p-4 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-seaop-primary-500"
            aria-label="Copier le numéro de référence"
          >
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Votre numéro de référence {copied ? '— copié !' : '(cliquez pour copier)'}
            </p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg sm:text-xl font-mono font-bold text-seaop-primary-600 dark:text-seaop-primary-400 break-all">
                {successRef}
              </p>
              {copied ? (
                <Check className="h-5 w-5 text-green-500 shrink-0" />
              ) : (
                <Copy className="h-5 w-5 text-gray-400 dark:text-gray-500 group-hover:text-seaop-primary-500 shrink-0" />
              )}
            </div>
          </button>

          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            📧 Un courriel de confirmation a été envoyé. Conservez ce numéro pour accéder à vos soumissions.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="button"
              variant="primary"
              className="w-full"
              onClick={() =>
                navigate('/', {
                  state: {
                    successMessage: `Votre projet ${successRef} est publié. Les entrepreneurs peuvent maintenant soumissionner.`,
                  },
                })
              }
            >
              Retour à l&apos;accueil
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => navigate('/appels-offres')}
            >
              Voir les autres appels d&apos;offres
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <FileText className="h-7 w-7 text-seaop-primary-600 dark:text-seaop-primary-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Déposer un appel d&apos;offres
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Décrivez votre projet pour recevoir des soumissions d&apos;entrepreneurs qualifiés
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6">
          <Alert type="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}

      {/* Lead Form */}
      <LeadForm onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  );
}
