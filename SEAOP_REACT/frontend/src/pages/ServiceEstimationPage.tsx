/**
 * SEAOP React Frontend - Service d'Estimation — Wizard public
 *
 * Formulaire multi-etapes que les clients remplissent sans authentification
 * pour soumettre une demande d'estimation. Reponse promise sous 24-48h par
 * courriel. Le formulaire est inspire du flow helpeur.ca: selection du
 * corps de metier, secteur, description + photos optionnelles, urgence,
 * localisation, puis coordonnees du client.
 *
 * Etapes:
 *   1. Projet          — corps de metier + secteur + (type de projet)
 *   2. Besoin          — description + photos + urgence + disponibilite
 *   3. Details          — superficie + budget + delai + localisation
 *   4. Coordonnees     — prenom/nom/email/tel/entreprise + envoi
 *   5. Confirmation    — numero de reference + message 24-48h
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Check,
  Clock,
  FileText,
  File as FileIcon,
  FolderOpen,
  Mail,
  MapPin,
  Phone,
  UserPlus,
  UserRound,
  Zap,
  Calendar as CalendarIcon,
  Image as ImageIcon,
  Upload,
  X,
} from 'lucide-react';

import {
  createEstimationRequest,
  getEstimationMetadata,
  uploadEstimationPlan,
  type EstimationMetadata,
  type EstimationRequestInput,
} from '@/api/services';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { validateEmail } from '@/utils/validation';

// ============ Types ============

interface UploadedPlan {
  planId: string;
  filename: string;
  size: number;
}

interface FormState {
  // Step 1
  corpsMetier: string;
  secteur: string;
  typeProjet: string;
  // Step 2
  description: string;
  photos: string[]; // data URLs
  plans: UploadedPlan[];
  urgence: 'normal' | 'urgent';
  disponibilite: 'des_que_possible' | 'date_specifique';
  dateSouhaitee: string;
  // Step 3
  superficie: string;
  budgetEstime: string;
  delai: string;
  codePostal: string;
  localisation: string;
  // Step 4
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  entreprise: string;
}

const INITIAL_STATE: FormState = {
  corpsMetier: '',
  secteur: '',
  typeProjet: '',
  description: '',
  photos: [],
  plans: [],
  urgence: 'normal',
  disponibilite: 'des_que_possible',
  dateSouhaitee: '',
  superficie: '',
  budgetEstime: '',
  delai: '',
  codePostal: '',
  localisation: '',
  prenom: '',
  nom: '',
  email: '',
  telephone: '',
  entreprise: '',
};

const STEPS = [
  { id: 1, label: 'Projet', icon: Briefcase },
  { id: 2, label: 'Besoin', icon: FileText },
  { id: 3, label: 'Détails', icon: MapPin },
  { id: 4, label: 'Coordonnées', icon: UserRound },
];

/** Single combined cap: photos + PDFs share this budget. */
const MAX_DOCS = 10;
const MAX_PHOTO_SIZE_MB = 5;
const DEFAULT_MAX_PLAN_SIZE_MB = 150;

interface PricingTier {
  id: 'simple' | 'moyen' | 'complexe';
  label: string;
  price: number;
  description: string;
  highlighted?: boolean;
}

const PRICING_TIERS: PricingTier[] = [
  {
    id: 'simple',
    label: 'SIMPLE',
    price: 200,
    description: 'Démolition résidentielle, projet standard, faible envergure',
  },
  {
    id: 'moyen',
    label: 'MOYEN',
    price: 275,
    description:
      'Projet commercial, multiples corps de métier, envergure modérée',
    highlighted: true,
  },
  {
    id: 'complexe',
    label: 'COMPLEXE',
    price: 350,
    description:
      'Projet institutionnel, décontamination, contraintes spéciales',
  },
];

const PRICING_BULLETS = [
  'Estimation complète incluse : analyse des plans, devis, addenda, AO, etc.',
  'Facturation uniquement à la livraison de la soumission complétée',
  'Le niveau de complexité est déterminé par le consultant assigné',
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 o';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${(mb ?? 0).toFixed(1)} Mo`;
  return `${(bytes / 1024).toFixed(0)} Ko`;
}

// ============ Component ============

export default function ServiceEstimationPage() {
  const [step, setStep] = useState<number>(1);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [metadata, setMetadata] = useState<EstimationMetadata | null>(null);
  const [metaLoading, setMetaLoading] = useState<boolean>(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [clientEmailSent, setClientEmailSent] = useState<boolean>(true);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // Drag-and-drop + sequential upload state (modeled on ERP Dossiers).
  // Files are processed one at a time so a single progress bar + "file N/M"
  // counter can reflect the batch accurately.
  const [dragOver, setDragOver] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadFileName, setUploadFileName] = useState<string>('');
  const [uploadFileIndex, setUploadFileIndex] = useState<[number, number]>([0, 0]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const maxPlanSizeMb = metadata?.maxPlanSizeMb ?? DEFAULT_MAX_PLAN_SIZE_MB;

  const wizardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Sync guard against double-drop: React state is async, so a second drop
  // that arrives before the first has had a chance to flip `uploading` to
  // true would start concurrently. This ref is checked + set synchronously
  // at the very top of handleDocsUpload to serialize batches.
  const uploadLock = useRef<boolean>(false);
  const scrollToWizard = useCallback(() => {
    wizardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Load metadata (trades + sectors)
  useEffect(() => {
    let cancelled = false;
    getEstimationMetadata()
      .then((meta) => {
        if (!cancelled) {
          setMetadata(meta);
          setMetaLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMetaError(
            err instanceof Error
              ? err.message
              : 'Impossible de charger les options. Veuillez recharger la page.',
          );
          setMetaLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Helpers
  const updateField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
    [],
  );

  const validateStep = useCallback((current: number): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (current === 1) {
      if (!form.corpsMetier) next.corpsMetier = 'Sélectionnez un corps de métier.';
      if (!form.secteur) next.secteur = 'Sélectionnez un secteur.';
    }
    if (current === 2) {
      if (form.description.trim().length < 10) {
        next.description = 'Décrivez votre besoin (minimum 10 caractères).';
      }
      if (form.disponibilite === 'date_specifique' && !form.dateSouhaitee) {
        next.dateSouhaitee = 'Choisissez une date.';
      }
    }
    if (current === 4) {
      if (!form.prenom.trim()) next.prenom = 'Prénom requis.';
      if (!form.nom.trim()) next.nom = 'Nom requis.';
      if (!form.email.trim()) {
        next.email = 'Courriel requis.';
      } else if (!validateEmail(form.email)) {
        next.email = 'Courriel invalide.';
      }
      if (!form.telephone.trim()) next.telephone = 'Téléphone requis.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form]);

  const goNext = useCallback(() => {
    // Block progression while documents are still uploading. Surfaced as a
    // banner — don't overwrite the description error, because a short
    // description AND an in-flight upload are two orthogonal issues.
    if (step === 2 && uploading) {
      setSubmitError(
        'Veuillez attendre que le téléversement des documents soit terminé.',
      );
      return;
    }
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, STEPS.length));
  }, [step, uploading, validateStep]);

  const goBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 1));
  }, []);

  const resetWizard = useCallback(() => {
    setForm(INITIAL_STATE);
    setStep(1);
    setReference(null);
    setSubmitError(null);
    setErrors({});
    setUploading(false);
    setUploadProgress(0);
    setUploadFileName('');
    setUploadFileIndex([0, 0]);
    setClientEmailSent(true);
    // Scroll back to the pricing hero so the user doesn't land in the
    // middle of the page after "Déposer une autre demande".
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const removePhoto = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index),
    }));
  }, []);

  const removePlan = useCallback((planId: string) => {
    setForm((prev) => ({
      ...prev,
      plans: prev.plans.filter((p) => p.planId !== planId),
    }));
  }, []);

  /**
   * Unified document uploader: accepts any File[], routes images to the
   * base64 photos bucket and PDFs to the multipart plans bucket. Honors
   * the combined MAX_DOCS cap. Processes files sequentially so a single
   * progress overlay (file N/M + percent) can mirror the ERP Dossiers UX.
   */
  const handleDocsUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      // Serialize concurrent drops: if a previous batch is still processing,
      // drop the new files on the floor with a banner. React state (`uploading`)
      // is async and can't be relied on for same-tick rejection — use a ref.
      if (uploadLock.current) {
        setSubmitError(
          'Un téléversement est déjà en cours — attendez qu\'il se termine avant d\'ajouter d\'autres documents.',
        );
        return;
      }
      uploadLock.current = true;

      // Wrap every post-acquisition path in try/finally so the lock is
      // guaranteed to be released even on an unexpected exception (e.g. an
      // unhandled error inside a FileReader callback, a thrown setForm
      // updater, etc.). Without this, the component would refuse all
      // further uploads for the rest of its lifetime.
      try {
        const currentCount = form.photos.length + form.plans.length;
        const remaining = MAX_DOCS - currentCount;
        if (remaining <= 0) {
          setSubmitError(`Maximum ${MAX_DOCS} documents au total.`);
          return;
        }
        // Pre-filter by MIME / extension so the "file N / M" counter in the
        // overlay only reflects files that will actually be processed. This
        // keeps the UX honest: we don't briefly show "Fichier 2/3" for a
        // file that gets immediately rejected with an error.
        const withinCap = files.slice(0, remaining);
        const rejectedTypes: string[] = [];
        const accepted: File[] = [];
        for (const file of withinCap) {
          const isImage = file.type.startsWith('image/');
          const isPdf =
            file.type === 'application/pdf' ||
            file.name.toLowerCase().endsWith('.pdf');
          if (isImage || isPdf) accepted.push(file);
          else rejectedTypes.push(file.name);
        }

        const errors: string[] = [];
        if (files.length > withinCap.length) {
          errors.push(
            `Limite de ${MAX_DOCS} documents — ${files.length - withinCap.length} fichier(s) ignoré(s).`,
          );
        }
        if (rejectedTypes.length > 0) {
          errors.push(
            `Type non supporté (seules images et PDF acceptés) : ${rejectedTypes.join(', ')}`,
          );
        }

        if (accepted.length === 0) {
          if (errors.length > 0) setSubmitError(errors.join(' · '));
          return;
        }

        const photoMaxBytes = MAX_PHOTO_SIZE_MB * 1024 * 1024;
        const planMaxBytes = maxPlanSizeMb * 1024 * 1024;

        setUploading(true);
        setSubmitError(null);
        setUploadProgress(0);

        try {
          for (let i = 0; i < accepted.length; i++) {
            const file = accepted[i];
            setUploadFileName(file.name);
            setUploadFileIndex([i + 1, accepted.length]);
            setUploadProgress(0);

            const isImage = file.type.startsWith('image/');

            if (isImage) {
              if (file.size > photoMaxBytes) {
                errors.push(
                  `"${file.name}" dépasse ${MAX_PHOTO_SIZE_MB} Mo (limite photo).`,
                );
                continue;
              }
              // Base64 encoding is near-instant; still animate the bar so
              // the user sees feedback for photos in the same flow as PDFs.
              try {
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') resolve(reader.result);
                    else reject(new Error('Lecture du fichier impossible.'));
                  };
                  reader.onerror = () =>
                    reject(reader.error ?? new Error('Lecture échouée.'));
                  reader.onprogress = (e) => {
                    if (e.lengthComputable && e.total) {
                      setUploadProgress(Math.round((e.loaded / e.total) * 100));
                    }
                  };
                  reader.readAsDataURL(file);
                });
                setUploadProgress(100);
                setForm((prev) => ({ ...prev, photos: [...prev.photos, dataUrl] }));
              } catch (err: unknown) {
                errors.push(
                  err instanceof Error
                    ? err.message
                    : `Échec de la lecture de "${file.name}".`,
                );
              }
              continue;
            }

            // PDF branch
            if (file.size > planMaxBytes) {
              errors.push(
                `"${file.name}" dépasse ${maxPlanSizeMb} Mo (limite PDF).`,
              );
              continue;
            }
            try {
              const uploaded = await uploadEstimationPlan(file, (percent) => {
                setUploadProgress(percent);
              });
              setForm((prev) => ({
                ...prev,
                plans: [
                  ...prev.plans,
                  {
                    planId: uploaded.planId,
                    filename: uploaded.filename || file.name,
                    size: uploaded.size || file.size,
                  },
                ],
              }));
            } catch (err: unknown) {
              const axiosErr = err as AxiosError<{ detail?: string }>;
              errors.push(
                typeof axiosErr.response?.data?.detail === 'string'
                  ? axiosErr.response.data.detail
                  : `Échec du téléversement de "${file.name}".`,
              );
            }
          }
        } finally {
          // Always reset the overlay state, even if the loop throws.
          // The outer try/finally handles the lock itself.
          setUploading(false);
          setUploadFileName('');
          setUploadFileIndex([0, 0]);
          setUploadProgress(0);
        }
        if (errors.length > 0) setSubmitError(errors.join(' · '));
      } finally {
        uploadLock.current = false;
      }
    },
    [form.photos.length, form.plans.length, maxPlanSizeMb],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      // Reset the input so the user can re-select the same file twice in
      // a row if they accidentally remove it — but capture the files first.
      const picked = files ? Array.from(files) : [];
      e.target.value = '';
      void handleDocsUpload(picked);
    },
    [handleDocsUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only clear if the drag actually left the zone (not its children).
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) void handleDocsUpload(files);
    },
    [handleDocsUpload],
  );

  // Submit
  const handleSubmit = useCallback(async () => {
    // Refuse to submit while any upload is still running — otherwise the
    // in-flight plan_id hasn't been pushed to form.plans yet and its PDF
    // would be orphaned in pending/ until the GC sweeps it.
    if (uploading) {
      setSubmitError(
        'Un ou plusieurs documents sont encore en cours de téléversement. Veuillez patienter.',
      );
      return;
    }
    if (!validateStep(4)) return;

    setSubmitting(true);
    setSubmitError(null);

    const payload: EstimationRequestInput = {
      prenom: form.prenom.trim(),
      nom: form.nom.trim(),
      email: form.email.trim(),
      telephone: form.telephone.trim(),
      entreprise: form.entreprise.trim() || undefined,
      corpsMetier: form.corpsMetier,
      secteur: form.secteur,
      description: form.description.trim(),
      typeProjet: form.typeProjet.trim() || undefined,
      superficie: form.superficie.trim() || undefined,
      budgetEstime: form.budgetEstime.trim() || undefined,
      delai: form.delai.trim() || undefined,
      urgence: form.urgence,
      disponibilite: form.disponibilite,
      dateSouhaitee:
        form.disponibilite === 'date_specifique' && form.dateSouhaitee
          ? form.dateSouhaitee
          : undefined,
      codePostal: form.codePostal.trim() || undefined,
      localisation: form.localisation.trim() || undefined,
      photos: form.photos.length > 0 ? form.photos : undefined,
      planIds: (() => {
        const ids = form.plans.map((p) => p.planId).filter(Boolean);
        return ids.length > 0 ? ids : undefined;
      })(),
    };

    try {
      const result = await createEstimationRequest(payload);
      setReference(result.numeroReference || '');
      setClientEmailSent(result.clientEmailSent !== false);
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ detail?: string | Array<{ msg: string }> }>;
      const detail = axiosErr.response?.data?.detail;
      const message = Array.isArray(detail)
        ? detail.map((d) => d.msg).join(', ')
        : typeof detail === 'string'
          ? detail
          : 'Une erreur est survenue. Veuillez réessayer.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }, [form, uploading, validateStep]);

  // ============ Computed ============

  const metierOptions = useMemo(
    () =>
      (metadata?.corpsMetiers || []).map((m) => ({ value: m, label: m })),
    [metadata],
  );

  const secteurOptions = useMemo(
    () =>
      (metadata?.secteurs || []).map((s) => ({ value: s, label: s })),
    [metadata],
  );

  // ============ Render ============

  if (metaLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (metaError) {
    return (
      <Alert type="error" title="Erreur de chargement">
        {metaError}
      </Alert>
    );
  }

  // Success screen
  if (reference) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 px-4">
        <div className="flex justify-center mb-6">
          <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Demande reçue
        </h1>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          Merci, votre demande d&apos;estimation a été transmise à notre équipe.
        </p>
        <div className="mt-6 inline-block rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-6 py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Numéro de référence
          </p>
          <p className="mt-1 font-mono font-bold text-lg text-[#002050] dark:text-[#6cb8f6]">
            {reference}
          </p>
        </div>
        <p className="mt-6 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          Vous recevrez une estimation détaillée par courriel
          <br />
          <strong>dans un délai de 24 à 48 heures ouvrables</strong>.
        </p>
        {!clientEmailSent && (
          <div className="mt-6 max-w-md mx-auto">
            <Alert type="warning">
              Votre demande a bien été enregistrée, mais le courriel de
              confirmation n&apos;a pas pu être envoyé. Conservez votre numéro
              de référence&nbsp;: notre équipe vous contactera directement.
            </Alert>
          </div>
        )}
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="secondary" onClick={resetWizard}>
            Déposer une autre demande
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-6 px-4">
      {/* ===================== PRICING HERO ===================== */}
      <section className="max-w-5xl mx-auto mb-10">
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 dark:bg-blue-900/30 px-4 py-1.5 text-xs font-semibold tracking-wider text-[#0078D4]">
            <UserPlus size={14} />
            SERVICE PROFESSIONNEL
          </span>
        </div>

        <h1 className="mt-5 text-3xl sm:text-4xl font-bold text-center text-gray-900 dark:text-gray-100">
          Service d&rsquo;estimation en sous-traitance
        </h1>
        <p className="mt-3 max-w-2xl mx-auto text-center text-sm sm:text-base text-gray-600 dark:text-gray-400">
          Confiez vos estimations à des professionnels d&rsquo;expérience — analyse
          des plans, devis complet et suivi du projet inclus.
        </p>

        {/* Pricing cards */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={clsx(
                'relative rounded-xl border bg-white dark:bg-gray-800 p-6 shadow-sm transition-all',
                tier.highlighted
                  ? 'border-2 border-[#0078D4] shadow-md'
                  : 'border-gray-200 dark:border-gray-700 hover:shadow-md',
              )}
            >
              {tier.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#0078D4] px-3 py-1 text-xs font-semibold text-white shadow">
                  Le plus courant
                </span>
              )}
              <div className="text-xs font-semibold tracking-wider text-gray-500 dark:text-gray-400">
                {tier.label}
              </div>
              <div className="mt-3 flex items-baseline gap-1 text-gray-900 dark:text-gray-100">
                <span className="text-4xl font-bold">{tier.price}</span>
                <span className="text-xl font-semibold text-gray-500">$</span>
              </div>
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {tier.description}
              </p>
            </div>
          ))}
        </div>

        {/* Bullet points */}
        <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 max-w-3xl mx-auto">
          {PRICING_BULLETS.map((bullet, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Check
                size={18}
                className="mt-0.5 shrink-0 text-[#0078D4]"
                strokeWidth={2.5}
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        {/* CTA + legal */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <Button
            size="lg"
            onClick={scrollToWizard}
            leftIcon={<Mail className="h-4 w-4" />}
          >
            Demander une estimation
          </Button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tous les prix sont en dollars canadiens + taxes applicables (TPS + TVQ)
          </p>
          <div className="mt-2 flex flex-col sm:flex-row items-center gap-x-6 gap-y-2 text-sm text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              Pour une soumission&nbsp;:
            </span>
            <a
              href="mailto:info@constructoai.ca"
              className="inline-flex items-center gap-1.5 text-[#0078D4] hover:underline"
            >
              <Mail size={16} />
              info@constructoai.ca
            </a>
            <a
              href="tel:+15148201972"
              className="inline-flex items-center gap-1.5 text-[#0078D4] hover:underline"
            >
              <Phone size={16} />
              514-820-1972
            </a>
          </div>
        </div>
      </section>

      {/* ===================== WIZARD ===================== */}
      <div ref={wizardRef} className="max-w-3xl mx-auto scroll-mt-20">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Demande d&apos;estimation
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Décrivez votre projet et recevez une estimation professionnelle en 24 à 48 heures.
          Aucun compte requis.
        </p>
      </div>

      {/* Stepper */}
      <nav aria-label="Étapes" className="mb-6">
        <ol className="flex items-center justify-between gap-1 sm:gap-2">
          {STEPS.map((s) => {
            const Icon = s.icon;
            const active = s.id === step;
            const complete = s.id < step;
            return (
              <li key={s.id} className="flex-1 flex items-center gap-2 min-w-0">
                <div
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-full shrink-0 transition-colors',
                    active && 'bg-[#002050] text-white',
                    complete && 'bg-green-600 text-white',
                    !active && !complete && 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                  )}
                >
                  {complete ? <CheckCircle2 size={18} /> : <Icon size={16} />}
                </div>
                <span
                  className={clsx(
                    'text-xs sm:text-sm font-medium truncate',
                    active ? 'text-[#002050] dark:text-[#6cb8f6]' : 'text-gray-500 dark:text-gray-400',
                  )}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {submitError && (
        <div className="mb-4">
          <Alert type="error" onClose={() => setSubmitError(null)}>
            {submitError}
          </Alert>
        </div>
      )}

      {/* Step content — each step is its own card */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 sm:p-6 shadow-sm">
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Votre projet
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Commencez par préciser le type de travaux.
              </p>
            </div>

            <Select
              label="Corps de métier *"
              options={metierOptions}
              placeholder="Sélectionner…"
              value={form.corpsMetier}
              onChange={(e) => updateField('corpsMetier', e.target.value)}
              error={errors.corpsMetier}
            />

            <Select
              label="Secteur *"
              options={secteurOptions}
              placeholder="Sélectionner…"
              value={form.secteur}
              onChange={(e) => updateField('secteur', e.target.value)}
              error={errors.secteur}
            />

            <Input
              label="Type de projet (optionnel)"
              placeholder="ex. Rénovation cuisine, Construction neuve, Réparation…"
              value={form.typeProjet}
              onChange={(e) => updateField('typeProjet', e.target.value)}
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Décrivez votre besoin
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Plus votre description est précise, meilleure sera l&apos;estimation.
              </p>
            </div>

            <Textarea
              label="Description du travail à effectuer *"
              placeholder="Décrivez le problème ou le besoin, la pièce ou l'emplacement concerné, les matériaux souhaités, etc."
              rows={6}
              maxLength={5000}
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              error={errors.description}
              helperText={`${form.description.length}/5000 caractères (minimum 10)`}
            />

            {/* Documents (photos + PDFs combinés) — drag-and-drop ERP-style */}
            <div>
              <label className="block text-sm font-medium mb-1.5 text-[#323130] dark:text-[#f3f2f1]">
                Documents (optionnel) — {form.photos.length + form.plans.length}/{MAX_DOCS}
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Images (JPG/PNG/WebP — max {MAX_PHOTO_SIZE_MB} Mo) et PDF (max {maxPlanSizeMb} Mo) — glisser/déposer plusieurs fichiers à la fois.
              </p>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={clsx(
                  'relative rounded-xl border-2 border-dashed transition-colors min-h-[180px]',
                  dragOver
                    ? 'border-[#0078D4] bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600',
                )}
              >
                {uploading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 dark:bg-gray-900/90 rounded-xl z-10 px-8">
                    <Spinner size="sm" />
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-3 truncate max-w-full">
                      {uploadFileName}
                    </p>
                    {uploadFileIndex[1] > 1 && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Fichier {uploadFileIndex[0]} / {uploadFileIndex[1]}
                      </p>
                    )}
                    <div className="w-full max-w-xs mt-3 bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="h-full bg-[#0078D4] rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5 tabular-nums">
                      {uploadProgress}%
                    </p>
                  </div>
                )}
                {dragOver && !uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-blue-50/90 dark:bg-blue-900/40 rounded-xl z-10 pointer-events-none">
                    <div className="text-center">
                      <Upload size={32} className="mx-auto text-[#0078D4] mb-2" />
                      <p className="text-sm font-medium text-[#0078D4]">
                        Déposer ici
                      </p>
                    </div>
                  </div>
                )}
                {form.photos.length === 0 && form.plans.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <FolderOpen size={40} className="mb-3" />
                    <p className="text-sm">Aucun document ajouté</p>
                    <p className="text-xs mt-1">
                      Glissez-déposez vos fichiers ici ou cliquez sur «&nbsp;Parcourir&nbsp;»
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2 p-3">
                    {form.photos.map((src, idx) => (
                      <li
                        key={`photo-${idx}`}
                        className="flex items-center gap-3 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2"
                      >
                        <img
                          src={src}
                          alt={`photo ${idx + 1}`}
                          className="h-10 w-10 rounded object-cover shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-gray-900 dark:text-gray-100">
                            Photo {idx + 1}
                          </p>
                          <p className="text-xs text-gray-500">
                            Image — ajoutée
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePhoto(idx)}
                          className="shrink-0 rounded-full p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                          aria-label={`Retirer la photo ${idx + 1}`}
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                    {form.plans.map((plan) => (
                      <li
                        key={`plan-${plan.planId}`}
                        className="flex items-center gap-3 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2"
                      >
                        <FileIcon className="h-5 w-5 text-red-600 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-gray-900 dark:text-gray-100">
                            {plan.filename}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatBytes(plan.size)} — téléversé
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePlan(plan.planId)}
                          className="shrink-0 rounded-full p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                          aria-label={`Retirer ${plan.filename}`}
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    uploading ||
                    form.photos.length + form.plans.length >= MAX_DOCS
                  }
                  leftIcon={<Upload className="h-4 w-4" />}
                >
                  Parcourir…
                </Button>
                {form.photos.length + form.plans.length > 0 && (
                  <span className="text-xs text-gray-500">
                    {form.photos.length} photo{form.photos.length > 1 ? 's' : ''}
                    {' · '}
                    {form.plans.length} PDF{form.plans.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Urgency */}
            <div>
              <label className="block text-sm font-medium mb-2 text-[#323130] dark:text-[#f3f2f1]">
                Niveau d&apos;urgence
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => updateField('urgence', 'normal')}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all',
                    form.urgence === 'normal'
                      ? 'border-[#0078D4] bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
                  )}
                >
                  <Clock className="h-5 w-5 text-[#0078D4] shrink-0" />
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Normal</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Intervention dans les délais standards
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => updateField('urgence', 'urgent')}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all',
                    form.urgence === 'urgent'
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
                  )}
                >
                  <Zap className="h-5 w-5 text-orange-500 shrink-0" />
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Urgent</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Intervention prioritaire sous 24h
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Availability */}
            <div>
              <label className="block text-sm font-medium mb-2 text-[#323130] dark:text-[#f3f2f1]">
                Quand souhaitez-vous le service ?
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => updateField('disponibilite', 'des_que_possible')}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all',
                    form.disponibilite === 'des_que_possible'
                      ? 'border-[#0078D4] bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
                  )}
                >
                  <CalendarIcon className="h-5 w-5 text-[#0078D4] shrink-0" />
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Dès que possible</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Le plus tôt disponible</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => updateField('disponibilite', 'date_specifique')}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all',
                    form.disponibilite === 'date_specifique'
                      ? 'border-[#0078D4] bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
                  )}
                >
                  <CalendarIcon className="h-5 w-5 text-[#0078D4] shrink-0" />
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Date spécifique</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Choisir une date précise</div>
                  </div>
                </button>
              </div>
              {form.disponibilite === 'date_specifique' && (
                <div className="mt-3">
                  <Input
                    type="date"
                    label="Date souhaitée"
                    value={form.dateSouhaitee}
                    onChange={(e) => updateField('dateSouhaitee', e.target.value)}
                    error={errors.dateSouhaitee}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Détails additionnels
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Tous les champs de cette étape sont optionnels — ils aident à affiner l&apos;estimation.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                label="Code postal"
                placeholder="H2X 1Y4"
                value={form.codePostal}
                onChange={(e) => updateField('codePostal', e.target.value)}
              />
              <Input
                label="Superficie / dimensions"
                placeholder="ex. 120 m², 800 pi²"
                value={form.superficie}
                onChange={(e) => updateField('superficie', e.target.value)}
              />
            </div>

            <Input
              label="Localisation / adresse"
              placeholder="Ville, quartier ou adresse"
              value={form.localisation}
              onChange={(e) => updateField('localisation', e.target.value)}
            />

            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                label="Budget estimé"
                placeholder="ex. 10 000 - 25 000 $"
                value={form.budgetEstime}
                onChange={(e) => updateField('budgetEstime', e.target.value)}
              />
              <Input
                label="Délai souhaité"
                placeholder="ex. 2 mois, été 2026"
                value={form.delai}
                onChange={(e) => updateField('delai', e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Vos coordonnées
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Nous vous enverrons l&apos;estimation à l&apos;adresse courriel fournie.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                label="Prénom *"
                autoComplete="given-name"
                value={form.prenom}
                onChange={(e) => updateField('prenom', e.target.value)}
                error={errors.prenom}
              />
              <Input
                label="Nom *"
                autoComplete="family-name"
                value={form.nom}
                onChange={(e) => updateField('nom', e.target.value)}
                error={errors.nom}
              />
            </div>

            <Input
              label="Courriel *"
              type="email"
              autoComplete="email"
              placeholder="vous@exemple.com"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              error={errors.email}
            />

            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                label="Téléphone *"
                type="tel"
                autoComplete="tel"
                placeholder="(514) 555-1234"
                value={form.telephone}
                onChange={(e) => updateField('telephone', e.target.value)}
                error={errors.telephone}
              />
              <Input
                label="Entreprise (optionnel)"
                autoComplete="organization"
                value={form.entreprise}
                onChange={(e) => updateField('entreprise', e.target.value)}
              />
            </div>

            {/* Summary */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 text-sm">
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                <Building2 size={16} />
                Récapitulatif
              </h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-gray-600 dark:text-gray-400">
                <dt className="font-medium">Corps de métier</dt>
                <dd>{form.corpsMetier || '—'}</dd>
                <dt className="font-medium">Secteur</dt>
                <dd>{form.secteur || '—'}</dd>
                <dt className="font-medium">Urgence</dt>
                <dd>{form.urgence === 'urgent' ? 'Urgent' : 'Normal'}</dd>
                <dt className="font-medium">Disponibilité</dt>
                <dd>
                  {form.disponibilite === 'date_specifique' && form.dateSouhaitee
                    ? form.dateSouhaitee
                    : 'Dès que possible'}
                </dd>
                {form.photos.length > 0 && (
                  <>
                    <dt className="font-medium">Photos jointes</dt>
                    <dd>{form.photos.length}</dd>
                  </>
                )}
                {form.plans.length > 0 && (
                  <>
                    <dt className="font-medium">Plans PDF</dt>
                    <dd>{form.plans.length}</dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between mt-5">
        <Button
          variant="ghost"
          onClick={goBack}
          disabled={step === 1 || submitting}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          Retour
        </Button>
        {step < STEPS.length ? (
          <Button onClick={goNext} rightIcon={<ArrowRight className="h-4 w-4" />}>
            Continuer
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            isLoading={submitting}
            rightIcon={<CheckCircle2 className="h-4 w-4" />}
          >
            Envoyer ma demande
          </Button>
        )}
      </div>
      </div>
    </div>
  );
}
