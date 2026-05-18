import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Check, ChevronRight, ShieldCheck, Zap } from 'lucide-react';

import { useAuthStore } from '@/store/useAuthStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import {
  validateEmail,
  validatePhone,
  validatePassword,
  validateRequired,
} from '@/utils/validation';
import { scrollToFirstError } from '@/utils/scrollToFirstError';

interface FormData {
  nomEntreprise: string;
  nomContact: string;
  email: string;
  telephone: string;
  motDePasse: string;
  confirmMotDePasse: string;
  numeroRbq: string;
  categoriesRbq: string;
  assuranceResponsabilite: boolean;
  montantAssurance: string;
  zonesDesservies: string;
  typesProjets: string;
  certifications: string;
}

interface FormErrors {
  nomEntreprise?: string;
  nomContact?: string;
  email?: string;
  telephone?: string;
  motDePasse?: string;
  confirmMotDePasse?: string;
  numeroRbq?: string;
}

/** RBQ license number format: XXXX-XXXX-XX (4 digits, dash, 4 digits, dash, 2 digits) */
const RBQ_PATTERN = /^\d{4}-\d{4}-\d{2}$/;

const INITIAL_FORM: FormData = {
  nomEntreprise: '',
  nomContact: '',
  email: '',
  telephone: '',
  motDePasse: '',
  confirmMotDePasse: '',
  numeroRbq: '',
  categoriesRbq: '',
  assuranceResponsabilite: false,
  montantAssurance: '',
  zonesDesservies: '',
  typesProjets: '',
  certifications: '',
};

type Step = 1 | 2;

const RegisterForm: React.FC = () => {
  const navigate = useNavigate();
  const { registerEntrepreneur, isLoading, error, clearError } = useAuthStore();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});

  function updateField(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validateStep1(): boolean {
    const errs: FormErrors = {};

    const nomEntrepriseErr = validateRequired(form.nomEntreprise, "Nom de l'entreprise");
    if (nomEntrepriseErr) errs.nomEntreprise = nomEntrepriseErr;

    const nomContactErr = validateRequired(form.nomContact, 'Nom du contact');
    if (nomContactErr) errs.nomContact = nomContactErr;

    if (!form.email.trim()) {
      errs.email = 'Le courriel est requis.';
    } else if (!validateEmail(form.email)) {
      errs.email = 'Veuillez entrer un courriel valide.';
    }

    if (!form.telephone.trim()) {
      errs.telephone = 'Le téléphone est requis.';
    } else if (!validatePhone(form.telephone)) {
      errs.telephone = 'Veuillez entrer un numéro de téléphone valide (10 chiffres).';
    }

    const pwdResult = validatePassword(form.motDePasse);
    if (!pwdResult.valid) {
      errs.motDePasse = pwdResult.message;
    }

    if (!form.confirmMotDePasse) {
      errs.confirmMotDePasse = 'Veuillez confirmer le mot de passe.';
    } else if (form.motDePasse !== form.confirmMotDePasse) {
      errs.confirmMotDePasse = 'Les mots de passe ne correspondent pas.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    const errs: FormErrors = {};
    // RBQ format validation (only if a value is provided)
    if (form.numeroRbq.trim() && !RBQ_PATTERN.test(form.numeroRbq.trim())) {
      errs.numeroRbq = 'Format invalide. Ex: 1234-5678-90';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    clearError();
    if (validateStep1()) {
      setStep(2);
      // Scroll to top on step change (mobile)
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      scrollToFirstError();
    }
  }

  function handleBack() {
    setStep(1);
    setErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submitRegistration(skipProfileDetails: boolean) {
    clearError();

    if (!skipProfileDetails && !validateStep2()) {
      scrollToFirstError();
      return;
    }

    const payload: Parameters<typeof registerEntrepreneur>[0] = {
      nomEntreprise: form.nomEntreprise.trim(),
      nomContact: form.nomContact.trim(),
      email: form.email.trim(),
      telephone: form.telephone.trim(),
      motDePasse: form.motDePasse,
    };

    if (!skipProfileDetails) {
      if (form.numeroRbq.trim()) payload.numeroRbq = form.numeroRbq.trim();
      if (form.categoriesRbq.trim()) (payload as Record<string, unknown>).categoriesRbq = form.categoriesRbq.trim();
      if (form.assuranceResponsabilite) (payload as Record<string, unknown>).assuranceResponsabilite = true;
      if (form.montantAssurance.trim()) {
        const montant = parseFloat(form.montantAssurance.replace(/[^\d.,]/g, '').replace(',', '.'));
        if (!isNaN(montant) && montant > 0) (payload as Record<string, unknown>).montantAssurance = montant;
      }
      if (form.zonesDesservies.trim()) payload.zonesDesservies = form.zonesDesservies.trim();
      if (form.typesProjets.trim()) payload.typesProjets = form.typesProjets.trim();
      if (form.certifications.trim()) payload.certifications = form.certifications.trim();
    }

    try {
      await registerEntrepreneur(payload);
      const { isAuthenticated, error: authError } = useAuthStore.getState();
      if (isAuthenticated) {
        toast.success('Bienvenue sur SEAOP !', {
          description: skipProfileDetails
            ? 'Complétez votre profil à tout moment pour recevoir des opportunités mieux ciblées.'
            : 'Votre profil est prêt. Découvrez les appels d\u2019offres disponibles.',
        });
        navigate('/appels-offres');
      } else if (authError) {
        // Store captured an error but didn't throw — surface it as a toast.
        toast.error('Inscription impossible', { description: authError });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Une erreur inattendue est survenue.';
      toast.error('Inscription impossible', { description: message });
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à la connexion
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Inscription Entrepreneur
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {step === 1
            ? 'Créez votre compte en 30 secondes. Vous compléterez votre profil après.'
            : 'Complétez votre profil pour recevoir des opportunités mieux ciblées — ou passez cette étape et ajoutez ces infos plus tard.'}
        </p>
      </div>

      {/* Step indicator */}
      <ol className="flex items-center gap-2 mb-6" aria-label="Progression de l'inscription">
        <li
          aria-current={step === 1 ? 'step' : undefined}
          className={`flex items-center gap-2 text-sm font-medium ${
            step >= 1 ? 'text-seaop-primary-600 dark:text-seaop-primary-400' : 'text-gray-400'
          }`}
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full ${
              step > 1
                ? 'bg-seaop-primary-600 text-white dark:bg-seaop-primary-500'
                : step === 1
                  ? 'bg-seaop-primary-100 text-seaop-primary-700 dark:bg-seaop-primary-900/40 dark:text-seaop-primary-300'
                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800'
            }`}
            aria-hidden="true"
          >
            {step > 1 ? <Check className="h-4 w-4" /> : '1'}
          </span>
          <span className="hidden sm:inline">Compte</span>
          <span className="sr-only">Étape 1 sur 2 : Compte {step > 1 ? '(complétée)' : '(en cours)'}</span>
        </li>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
        <li
          aria-current={step === 2 ? 'step' : undefined}
          className={`flex items-center gap-2 text-sm font-medium ${
            step >= 2 ? 'text-seaop-primary-600 dark:text-seaop-primary-400' : 'text-gray-400'
          }`}
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full ${
              step === 2
                ? 'bg-seaop-primary-100 text-seaop-primary-700 dark:bg-seaop-primary-900/40 dark:text-seaop-primary-300'
                : 'bg-gray-100 text-gray-400 dark:bg-gray-800'
            }`}
            aria-hidden="true"
          >
            2
          </span>
          <span className="hidden sm:inline">Profil (optionnel)</span>
          <span className="sr-only">Étape 2 sur 2 : Profil optionnel {step === 2 ? '(en cours)' : ''}</span>
        </li>
      </ol>

      {/* Error Alert */}
      {error && (
        <div className="mb-4">
          <Alert type="error" onClose={clearError}>
            {error}
          </Alert>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center mb-4">
          <Spinner size="md" />
        </div>
      )}

      {/* ============ STEP 1 ============ */}
      {step === 1 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleNext();
          }}
        >
          <Input
            label="Nom de l'entreprise *"
            type="text"
            placeholder="Construction ABC inc."
            value={form.nomEntreprise}
            onChange={(e) => updateField('nomEntreprise', e.target.value)}
            error={errors.nomEntreprise}
            disabled={isLoading}
            autoComplete="organization"
          />

          <Input
            label="Nom du contact *"
            type="text"
            placeholder="Jean Tremblay"
            value={form.nomContact}
            onChange={(e) => updateField('nomContact', e.target.value)}
            error={errors.nomContact}
            disabled={isLoading}
            autoComplete="name"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Courriel *"
              type="email"
              placeholder="contact@entreprise.com"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              error={errors.email}
              disabled={isLoading}
              autoComplete="email"
            />

            <Input
              label="Téléphone *"
              type="tel"
              placeholder="(514) 555-1234"
              value={form.telephone}
              onChange={(e) => updateField('telephone', e.target.value)}
              error={errors.telephone}
              disabled={isLoading}
              autoComplete="tel"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Mot de passe *"
              type="password"
              placeholder="Minimum 8 caractères"
              value={form.motDePasse}
              onChange={(e) => updateField('motDePasse', e.target.value)}
              error={errors.motDePasse}
              disabled={isLoading}
              autoComplete="new-password"
            />

            <Input
              label="Confirmer le mot de passe *"
              type="password"
              placeholder="Répétez le mot de passe"
              value={form.confirmMotDePasse}
              onChange={(e) => updateField('confirmMotDePasse', e.target.value)}
              error={errors.confirmMotDePasse}
              disabled={isLoading}
              autoComplete="new-password"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            rightIcon={<ChevronRight className="h-4 w-4" />}
            disabled={isLoading}
          >
            Continuer
          </Button>

          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Déjà inscrit ?{' '}
            <Link
              to="/login"
              className="font-medium text-seaop-primary-600 hover:text-seaop-primary-500 dark:text-seaop-primary-400 dark:hover:text-seaop-primary-300"
            >
              Se connecter
            </Link>
          </p>
        </form>
      )}

      {/* ============ STEP 2 ============ */}
      {step === 2 && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submitRegistration(false);
          }}
        >
          <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-gray-700 dark:text-gray-300 flex gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
            <p>
              Ces informations sont <strong>facultatives</strong> mais elles augmentent votre crédibilité auprès des donneurs d&apos;ouvrage. Vous pourrez les modifier à tout moment.
            </p>
          </div>

          <div>
            <Input
              label="Numéro RBQ"
              type="text"
              placeholder="1234-5678-90"
              value={form.numeroRbq}
              onChange={(e) => updateField('numeroRbq', e.target.value)}
              error={errors.numeroRbq}
              disabled={isLoading}
              helperText="Format : XXXX-XXXX-XX"
            />
            <a
              href="https://www.rbq.gouv.qc.ca/services-en-ligne/repertoire-des-detenteurs-de-licence/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1 text-xs text-seaop-primary-600 hover:text-seaop-primary-500 dark:text-seaop-primary-400 dark:hover:text-seaop-primary-300 underline"
            >
              Vérifier votre licence sur le registre officiel
            </a>
          </div>

          <Input
            label="Catégories RBQ"
            type="text"
            placeholder="Ex: 1.1.1, 1.1.2"
            value={form.categoriesRbq}
            onChange={(e) => updateField('categoriesRbq', e.target.value)}
            disabled={isLoading}
            helperText="Catégories de votre licence (séparées par virgules)"
          />

          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.assuranceResponsabilite}
                onChange={(e) => setForm((prev) => ({ ...prev, assuranceResponsabilite: e.target.checked }))}
                disabled={isLoading}
                className="h-4 w-4 rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
              />
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                J&apos;ai une assurance responsabilité civile
              </span>
            </label>

            {form.assuranceResponsabilite && (
              <Input
                label="Montant d'assurance ($)"
                type="text"
                inputMode="decimal"
                placeholder="ex: 2 000 000"
                value={form.montantAssurance}
                onChange={(e) => updateField('montantAssurance', e.target.value)}
                disabled={isLoading}
              />
            )}
          </div>

          <Textarea
            label="Zones desservies"
            placeholder="Ex: Montréal, Laval, Rive-Nord, Rive-Sud"
            value={form.zonesDesservies}
            onChange={(e) => updateField('zonesDesservies', e.target.value)}
            disabled={isLoading}
            rows={2}
            helperText="Séparez par des virgules. Permet d'activer le filtre 'Mes zones' sur les appels d'offres."
          />

          <Textarea
            label="Types de projets"
            placeholder="Ex: Rénovation résidentielle, construction commerciale, toiture"
            value={form.typesProjets}
            onChange={(e) => updateField('typesProjets', e.target.value)}
            disabled={isLoading}
            rows={2}
          />

          <Textarea
            label="Certifications"
            placeholder="Ex: ISO 9001, LEED, ASP Construction"
            value={form.certifications}
            onChange={(e) => updateField('certifications', e.target.value)}
            disabled={isLoading}
            rows={2}
          />

          <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleBack}
              disabled={isLoading}
              leftIcon={<ArrowLeft className="h-4 w-4" />}
            >
              Retour
            </Button>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => submitRegistration(true)}
                disabled={isLoading}
                leftIcon={<Zap className="h-4 w-4" />}
              >
                Ignorer et créer mon compte
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isLoading}
                leftIcon={<Check className="h-4 w-4" />}
              >
                Enregistrer et continuer
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
};

RegisterForm.displayName = 'RegisterForm';

export { RegisterForm };
