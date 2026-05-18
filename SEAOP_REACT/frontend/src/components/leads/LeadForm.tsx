import React, { useState, useMemo, useEffect } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Send, AlertTriangle, ChevronDown, ChevronRight, ShieldCheck, RotateCcw } from 'lucide-react';

const DRAFT_KEY = 'seaop_lead_draft';
const DRAFT_VERSION = 1;

import type { LeadCreate } from '@/types';
import { useAuthStore } from '@/store/useAuthStore';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import FileUpload from '@/components/ui/FileUpload';
import { uploadMultipleFiles } from '@/api/uploads';
import { TYPES_PROJETS, TRANCHES_BUDGET, DELAIS_REALISATION } from '@/utils/constants';
import { calculateUrgency, getUrgencyConfig } from '@/utils/urgency';
import {
  validateEmail,
  validatePhone,
  validatePostalCode,
  validateRequired,
} from '@/utils/validation';
import { scrollToFirstError } from '@/utils/scrollToFirstError';
import type { BadgeColor } from '@/components/ui/Badge';

interface Props {
  onSubmit: (data: LeadCreate) => Promise<void>;
  initialData?: Partial<LeadCreate>;
  isLoading?: boolean;
}

interface FormState {
  nom: string;
  email: string;
  telephone: string;
  codePostal: string;
  typeProjet: string;
  budget: string;
  delaiRealisation: string;
  description: string;
  dateLimiteSoumissions: string;
  dateDebutSouhaite: string;
}

type FormErrors = Partial<Record<keyof FormState, string>>;

/** Default date helper: today + N days in YYYY-MM-DD */
function defaultDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

/** Map urgency level string to Badge color */
function urgencyBadgeColor(level: string): BadgeColor {
  switch (level) {
    case 'critique':
      return 'red';
    case 'eleve':
      return 'yellow';
    case 'normal':
      return 'blue';
    case 'faible':
    default:
      return 'gray';
  }
}

const typeProjetOptions = TYPES_PROJETS.map((t) => ({ value: t, label: t }));
const budgetOptions = TRANCHES_BUDGET.map((b) => ({ value: b, label: b }));
const delaiOptions = DELAIS_REALISATION.map((d) => ({ value: d, label: d }));

const LeadForm: React.FC<Props> = ({ onSubmit, initialData, isLoading = false }) => {
  const user = useAuthStore((s) => s.user);

  // Check for existing draft on mount
  const draftFromStorage = useMemo(() => {
    if (initialData) return null; // prefer explicit initialData
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?._v !== DRAFT_VERSION) return null;
      return parsed as FormState & { _v: number; _savedAt: string };
    } catch {
      return null;
    }
  }, [initialData]);

  const [draftAvailable, setDraftAvailable] = useState<boolean>(!!draftFromStorage);

  const [form, setForm] = useState<FormState>(() => ({
    nom: initialData?.nom ?? '',
    email: initialData?.email ?? (user?.userType === 'client' ? user.email : ''),
    telephone: initialData?.telephone ?? '',
    codePostal: initialData?.codePostal ?? '',
    typeProjet: initialData?.typeProjet ?? '',
    budget: initialData?.budget ?? '',
    delaiRealisation: initialData?.delaiRealisation ?? '',
    description: initialData?.description ?? '',
    dateLimiteSoumissions:
      initialData?.dateLimiteSoumissions ?? defaultDate(14),
    dateDebutSouhaite: initialData?.dateDebutSouhaite ?? defaultDate(30),
  }));

  function restoreDraft() {
    if (!draftFromStorage) return;
    setForm({
      nom: draftFromStorage.nom ?? '',
      email: draftFromStorage.email ?? '',
      telephone: draftFromStorage.telephone ?? '',
      codePostal: draftFromStorage.codePostal ?? '',
      typeProjet: draftFromStorage.typeProjet ?? '',
      budget: draftFromStorage.budget ?? '',
      delaiRealisation: draftFromStorage.delaiRealisation ?? '',
      description: draftFromStorage.description ?? '',
      dateLimiteSoumissions: draftFromStorage.dateLimiteSoumissions ?? defaultDate(14),
      dateDebutSouhaite: draftFromStorage.dateDebutSouhaite ?? defaultDate(30),
    });
    setDraftAvailable(false);
    toast.success('Brouillon restauré', {
      description: 'Votre saisie précédente a été chargée.',
    });
  }

  function dismissDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    setDraftAvailable(false);
  }

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState('');

  // Compliance state
  const [showCompliance, setShowCompliance] = useState(false);
  const [rbqRequis, setRbqRequis] = useState(initialData?.rbqRequis ?? false);
  const [categoriesRbqRequises, setCategoriesRbqRequises] = useState(initialData?.categoriesRbqRequises ?? '');
  const [cnesstRequis, setCnesstRequis] = useState(initialData?.cnesstRequis ?? false);
  const [assuranceRequise, setAssuranceRequise] = useState(initialData?.assuranceRequise ?? false);
  const [montantAssuranceMin, setMontantAssuranceMin] = useState(initialData?.montantAssuranceMin?.toString() ?? '');
  const [cautionnementRequis, setCautionnementRequis] = useState(initialData?.cautionnementRequis ?? false);
  const [pourcentageCautionnement, setPourcentageCautionnement] = useState(initialData?.pourcentageCautionnement?.toString() ?? '10');

  // Pre-fill email from auth store if client logs in after mount
  useEffect(() => {
    if (user?.userType === 'client' && !form.email) {
      setForm((prev) => ({ ...prev, email: user.email }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Auto-save draft to localStorage (debounced)
  useEffect(() => {
    // Don't save empty drafts, and don't persist when user has just accepted a restored draft
    const isEmpty =
      !form.nom &&
      !form.telephone &&
      !form.codePostal &&
      !form.typeProjet &&
      !form.budget &&
      !form.description;
    if (isEmpty) return;

    const timer = setTimeout(() => {
      try {
        const payload = {
          ...form,
          _v: DRAFT_VERSION,
          _savedAt: new Date().toISOString(),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      } catch {
        // ignore storage quota errors
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [form]);

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  // Real-time urgency calculation
  const urgencyInfo = useMemo(() => {
    const level = calculateUrgency(
      form.dateLimiteSoumissions || null,
      form.dateDebutSouhaite || null,
    );
    const config = getUrgencyConfig(level);
    return { level, config };
  }, [form.dateLimiteSoumissions, form.dateDebutSouhaite]);

  function validate(): boolean {
    const errs: FormErrors = {};

    const nomErr = validateRequired(form.nom, 'Nom du projet');
    if (nomErr) errs.nom = nomErr;

    if (!form.email.trim()) {
      errs.email = 'Le courriel est requis.';
    } else if (!validateEmail(form.email)) {
      errs.email = 'Veuillez entrer un courriel valide.';
    }

    if (!form.telephone.trim()) {
      errs.telephone = 'Le téléphone est requis.';
    } else if (!validatePhone(form.telephone)) {
      errs.telephone = 'Numéro de téléphone invalide (10 chiffres).';
    }

    if (!form.codePostal.trim()) {
      errs.codePostal = 'Le code postal est requis.';
    } else if (!validatePostalCode(form.codePostal)) {
      errs.codePostal = 'Code postal invalide (format: A1A 1A1).';
    }

    if (!form.typeProjet) {
      errs.typeProjet = 'Le type de projet est requis.';
    }

    if (!form.budget) {
      errs.budget = 'Le budget est requis.';
    }

    if (!form.delaiRealisation) {
      errs.delaiRealisation = 'Le délai de réalisation est requis.';
    }

    if (!form.description.trim()) {
      errs.description = 'La description est requise.';
    } else if (form.description.trim().length < 20) {
      errs.description = 'La description doit contenir au moins 20 caractères.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!validate()) {
      scrollToFirstError();
      return;
    }

    const data: LeadCreate = {
      nom: form.nom.trim(),
      email: form.email.trim(),
      telephone: form.telephone.trim(),
      codePostal: form.codePostal.trim().toUpperCase(),
      typeProjet: form.typeProjet,
      budget: form.budget,
      delaiRealisation: form.delaiRealisation,
      description: form.description.trim(),
    };

    if (form.dateLimiteSoumissions) {
      data.dateLimiteSoumissions = form.dateLimiteSoumissions;
    }
    if (form.dateDebutSouhaite) {
      data.dateDebutSouhaite = form.dateDebutSouhaite;
    }
    // Set calculated urgency
    data.niveauUrgence = urgencyInfo.level;

    // Compliance fields
    data.rbqRequis = rbqRequis;
    if (rbqRequis && categoriesRbqRequises.trim()) {
      data.categoriesRbqRequises = categoriesRbqRequises.trim();
    }
    data.cnesstRequis = cnesstRequis;
    data.assuranceRequise = assuranceRequise;
    if (assuranceRequise && montantAssuranceMin) {
      data.montantAssuranceMin = parseFloat(montantAssuranceMin);
    }
    data.cautionnementRequis = cautionnementRequis;
    if (cautionnementRequis && pourcentageCautionnement) {
      data.pourcentageCautionnement = parseFloat(pourcentageCautionnement);
    }

    // Upload files if any were selected
    if (files.length > 0) {
      try {
        setUploadError('');
        const results = await uploadMultipleFiles(files);
        data.documents = JSON.stringify(results);
      } catch {
        setUploadError('Erreur lors du téléversement des fichiers. Veuillez réessayer.');
        return;
      }
    }

    try {
      await onSubmit(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Une erreur est survenue lors de la soumission.';
      setSubmitError(message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Draft banner */}
      {draftAvailable && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <RotateCcw className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
            <strong>Brouillon disponible</strong> — votre saisie précédente a été sauvegardée.
            {draftFromStorage?._savedAt && (
              <span className="text-xs text-amber-700 dark:text-amber-300 ml-1">
                ({new Date(draftFromStorage._savedAt).toLocaleString('fr-CA')})
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={restoreDraft}
            >
              Restaurer
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismissDraft}
            >
              Nouveau
            </Button>
          </div>
        </div>
      )}

      {/* Submit Error */}
      {submitError && (
        <Alert type="error" onClose={() => setSubmitError(null)}>
          {submitError}
        </Alert>
      )}

      {/* Real-time Urgency Indicator */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
        <AlertTriangle className="h-4 w-4 text-gray-500 dark:text-gray-400 shrink-0" />
        <span className="text-sm text-gray-600 dark:text-gray-400">
          Niveau d&apos;urgence calculé :
        </span>
        <Badge color={urgencyBadgeColor(urgencyInfo.level)} size="md">
          {urgencyInfo.config.label}
        </Badge>
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Col 1 */}
        <Input
          label="Nom du projet *"
          type="text"
          placeholder="Rénovation de la bibliothèque municipale"
          value={form.nom}
          onChange={(e) => updateField('nom', e.target.value)}
          error={errors.nom}
          disabled={isLoading}
        />

        {/* Col 2 */}
        <Input
          label="Courriel *"
          type="email"
          placeholder="contact@organisme.qc.ca"
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

        <Input
          label="Code postal *"
          type="text"
          placeholder="H2X 1Y4"
          value={form.codePostal}
          onChange={(e) => updateField('codePostal', e.target.value)}
          error={errors.codePostal}
          disabled={isLoading}
          autoComplete="postal-code"
        />

        <Select
          label="Type de projet *"
          options={typeProjetOptions}
          value={form.typeProjet}
          onChange={(e) => updateField('typeProjet', e.target.value)}
          error={errors.typeProjet}
          disabled={isLoading}
          placeholder="Sélectionnez un type"
        />

        <Select
          label="Budget *"
          options={budgetOptions}
          value={form.budget}
          onChange={(e) => updateField('budget', e.target.value)}
          error={errors.budget}
          disabled={isLoading}
          placeholder="Sélectionnez une tranche"
        />

        <Select
          label="Délai de réalisation *"
          options={delaiOptions}
          value={form.delaiRealisation}
          onChange={(e) => updateField('delaiRealisation', e.target.value)}
          error={errors.delaiRealisation}
          disabled={isLoading}
          placeholder="Sélectionnez un délai"
          helperText="Durée estimée pour compléter les travaux"
        />

        <Input
          label="Date limite des soumissions"
          type="date"
          value={form.dateLimiteSoumissions}
          onChange={(e) => updateField('dateLimiteSoumissions', e.target.value)}
          disabled={isLoading}
          helperText="Donnez aux entrepreneurs au moins 2 semaines"
        />

        <Input
          label="Date de début souhaitée"
          type="date"
          value={form.dateDebutSouhaite}
          onChange={(e) => updateField('dateDebutSouhaite', e.target.value)}
          disabled={isLoading}
          helperText="Date prévue pour le démarrage des travaux"
        />
      </div>

      {/* Description spans full width */}
      <Textarea
        label="Description du projet *"
        placeholder="Décrivez en détail les travaux souhaités, les exigences techniques, les conditions particulières..."
        value={form.description}
        onChange={(e) => updateField('description', e.target.value)}
        error={errors.description}
        disabled={isLoading}
        rows={5}
        helperText={`Décrivez le scope des travaux, matériaux, défis particuliers \u2014 ${form.description.length} caractère${form.description.length !== 1 ? 's' : ''} (minimum 20)`}
      />

      {/* File upload */}
      <FileUpload
        label="Documents et plans (optionnel)"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
        maxFiles={5}
        maxSizeMb={150}
        files={files}
        onFilesSelected={(incoming) => {
          setFiles((prev) => [...prev, ...incoming]);
          setUploadError('');
        }}
        onRemoveFile={(index) => setFiles((prev) => prev.filter((_, i) => i !== index))}
      />
      {uploadError && (
        <p className="text-sm text-red-500 dark:text-red-400">{uploadError}</p>
      )}

      {/* Compliance Section (collapsible) */}
      <div className="border-2 border-teal-200 dark:border-teal-800 rounded-lg overflow-hidden bg-teal-50/30 dark:bg-teal-900/10">
        <button
          type="button"
          onClick={() => setShowCompliance((prev) => !prev)}
          className="flex items-center justify-between w-full px-4 py-4 hover:bg-teal-100/40 dark:hover:bg-teal-900/20 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          aria-expanded={showCompliance}
        >
          <div className="flex items-start gap-3 min-w-0">
            <ShieldCheck className="h-5 w-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  Exigences légales et assurances
                </span>
                <Badge color="teal" size="sm">Recommandé</Badge>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                RBQ, CNESST, assurance responsabilité, cautionnement — pour attirer des entrepreneurs qualifiés.
              </p>
              {!showCompliance && (
                <p className="text-xs text-teal-700 dark:text-teal-300 mt-1.5 font-medium">
                  ▸ Cliquez pour configurer
                </p>
              )}
            </div>
          </div>
          {showCompliance ? (
            <ChevronDown className="h-5 w-5 text-teal-600 dark:text-teal-400 shrink-0" />
          ) : (
            <ChevronRight className="h-5 w-5 text-teal-600 dark:text-teal-400 shrink-0" />
          )}
        </button>

        {showCompliance && (
          <div className="px-4 py-4 space-y-4">
            {/* RBQ */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rbqRequis}
                onChange={(e) => setRbqRequis(e.target.checked)}
                disabled={isLoading}
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Licence RBQ requise
              </span>
            </label>

            {rbqRequis && (
              <div className="ml-6">
                <Input
                  label="Catégories RBQ acceptées"
                  type="text"
                  placeholder="Ex: 1.1.1, 1.3.2"
                  value={categoriesRbqRequises}
                  onChange={(e) => setCategoriesRbqRequises(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            )}

            {/* CNESST */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cnesstRequis}
                onChange={(e) => setCnesstRequis(e.target.checked)}
                disabled={isLoading}
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Attestation CNESST requise
              </span>
            </label>

            {/* Assurance */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={assuranceRequise}
                onChange={(e) => setAssuranceRequise(e.target.checked)}
                disabled={isLoading}
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Assurance responsabilité civile requise
              </span>
            </label>

            {assuranceRequise && (
              <div className="ml-6">
                <Input
                  label="Montant minimum d&apos;assurance ($)"
                  type="number"
                  placeholder="Ex: 2000000"
                  value={montantAssuranceMin}
                  onChange={(e) => setMontantAssuranceMin(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            )}

            {/* Cautionnement */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cautionnementRequis}
                onChange={(e) => setCautionnementRequis(e.target.checked)}
                disabled={isLoading}
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Cautionnement de soumission requis
              </span>
            </label>

            {cautionnementRequis && (
              <div className="ml-6">
                <Input
                  label="Pourcentage de cautionnement (%)"
                  type="number"
                  placeholder="10"
                  value={pourcentageCautionnement}
                  onChange={(e) => setPourcentageCautionnement(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isLoading}
          leftIcon={<Send className="h-5 w-5" />}
          className="w-full sm:w-auto"
        >
          Publier l&apos;appel d&apos;offres
        </Button>
      </div>
    </form>
  );
};

LeadForm.displayName = 'LeadForm';

export { LeadForm };
export type { Props as LeadFormProps };
