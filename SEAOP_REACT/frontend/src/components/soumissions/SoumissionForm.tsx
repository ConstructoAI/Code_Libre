/**
 * SEAOP React Frontend - Soumission Form
 * Entrepreneur fills this out to submit a bid on a lead.
 */

import { useEffect, useMemo, useState } from 'react';
import { Send, Info, Calculator } from 'lucide-react';

import type { SoumissionCreate } from '@/types';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import FileUpload from '@/components/ui/FileUpload';
import { uploadMultipleFiles } from '@/api/uploads';
import { formatCurrency } from '@/utils/format';
import { scrollToFirstError } from '@/utils/scrollToFirstError';

// Québec tax rates
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

const DRAFT_KEY_PREFIX = 'seaop_soumission_draft';
const draftKeyFor = (leadId: number) => `${DRAFT_KEY_PREFIX}_${leadId}`;

interface DraftState {
  montant: string;
  descriptionTravaux: string;
  delaiExecution: string;
  validiteOffre: string;
  inclusions: string;
  exclusions: string;
  conditions: string;
  isTTC: boolean;
}

interface Props {
  leadId: number;
  onSubmit: (data: SoumissionCreate) => Promise<void>;
  isLoading?: boolean;
}

interface FormErrors {
  montant?: string;
  descriptionTravaux?: string;
  delaiExecution?: string;
  validiteOffre?: string;
  montantCautionnement?: string;
}

/**
 * Parse a user-entered currency string into a number.
 * Supports both locales:
 *   - Québec/French : "15 000,50"  (space thousands + comma decimal)
 *   - Anglo         : "15,000.50"  (comma thousands + dot decimal)
 * Disambiguation :
 *   - If both ',' and '.' are present, the one appearing LAST is the decimal separator.
 *   - If only one separator appears and there are more than 2 digits after it
 *     (e.g. "15,000"), it's treated as a thousands separator.
 *   - Otherwise it's the decimal separator.
 * Returns NaN on empty/invalid input.
 */
function parseMontant(value: string): number {
  if (!value) return NaN;
  // Keep digits, dots and commas only (strip spaces, $, non-breaking spaces, etc.)
  const clean = value.replace(/[^\d.,]/g, '');
  if (!clean) return NaN;

  const lastDot = clean.lastIndexOf('.');
  const lastComma = clean.lastIndexOf(',');

  let normalized: string;
  if (lastDot === -1 && lastComma === -1) {
    normalized = clean;
  } else if (lastDot >= 0 && lastComma >= 0) {
    // Both present → the LAST one is the decimal separator.
    if (lastComma > lastDot) {
      // Québec format : "15.000,50" → strip dots, comma → dot
      normalized = clean.replace(/\./g, '').replace(',', '.');
    } else {
      // Anglo format : "15,000.50" → strip commas
      normalized = clean.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    // Only comma(s). If the same separator appears multiple times it can ONLY
    // be a thousands separator (e.g. "1,000,000"). Otherwise, fall back to
    // "exactly 3 digits after = thousands; else decimal" heuristic.
    const commaCount = (clean.match(/,/g) || []).length;
    const afterComma = clean.length - 1 - lastComma;
    if (commaCount > 1) {
      // "1,000,000" → strip all commas
      normalized = clean.replace(/,/g, '');
    } else if (afterComma === 3) {
      // "15,000" → thousands separator (strip)
      normalized = clean.replace(/,/g, '');
    } else {
      // "15,50" → decimal separator
      normalized = clean.replace(/,/g, '.');
    }
  } else {
    // Only dot(s). Same heuristic: multiple dots ⇒ thousands separators,
    // single dot with 3 digits after ⇒ thousands, else decimal.
    const dotCount = (clean.match(/\./g) || []).length;
    const afterDot = clean.length - 1 - lastDot;
    if (dotCount > 1) {
      // "1.000.000" → strip all dots
      normalized = clean.replace(/\./g, '');
    } else if (afterDot === 3) {
      // "15.000" → thousands separator (strip)
      normalized = clean.replace(/\./g, '');
    } else {
      // "15.50" → decimal separator (already)
      normalized = clean;
    }
  }

  return parseFloat(normalized);
}

function SoumissionForm({ leadId, onSubmit, isLoading = false }: Props) {
  // Load draft from localStorage if present (lead-specific key → no cross-tab overwrites)
  const loadDraft = (): Partial<DraftState> => {
    try {
      const raw = localStorage.getItem(draftKeyFor(leadId));
      if (!raw) return {};
      return JSON.parse(raw) as Partial<DraftState>;
    } catch {
      return {};
    }
  };
  const draft = loadDraft();

  const [montant, setMontant] = useState(draft.montant ?? '');
  const [isTTC, setIsTTC] = useState(draft.isTTC ?? false);
  const [descriptionTravaux, setDescriptionTravaux] = useState(draft.descriptionTravaux ?? '');
  const [delaiExecution, setDelaiExecution] = useState(draft.delaiExecution ?? '');
  const [validiteOffre, setValiditeOffre] = useState(draft.validiteOffre ?? '30 jours');
  const [inclusions, setInclusions] = useState(draft.inclusions ?? '');
  const [exclusions, setExclusions] = useState(draft.exclusions ?? '');
  const [conditions, setConditions] = useState(draft.conditions ?? '');
  const [cautionnementInclus, setCautionnementInclus] = useState(false);
  const [typeCautionnement, setTypeCautionnement] = useState('');
  const [montantCautionnement, setMontantCautionnement] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  // Once set after successful submit, suppress the auto-save effect so we don't
  // recreate a "zombie" draft between the cleanup in the page and unmount.
  const [submitted, setSubmitted] = useState(false);

  // Parse current montant into a number (for tax calculation).
  // Use the same regex as validate()/handleSubmit() for consistency.
  const montantNum = useMemo(() => {
    const n = parseMontant(montant);
    return isNaN(n) || n <= 0 ? null : n;
  }, [montant]);

  // Compute HT / TPS / TVQ / TTC breakdown
  const taxes = useMemo(() => {
    if (montantNum == null) return null;
    if (isTTC) {
      // User entered TTC; back-compute HT
      const ht = montantNum / (1 + TPS_RATE + TVQ_RATE);
      return {
        ht,
        tps: ht * TPS_RATE,
        tvq: ht * TVQ_RATE,
        ttc: montantNum,
      };
    }
    // User entered HT
    const tps = montantNum * TPS_RATE;
    const tvq = montantNum * TVQ_RATE;
    return {
      ht: montantNum,
      tps,
      tvq,
      ttc: montantNum + tps + tvq,
    };
  }, [montantNum, isTTC]);

  // Auto-save draft to localStorage (suppressed once the form has been submitted
  // to prevent a "zombie" draft from being rewritten between submit + unmount).
  useEffect(() => {
    if (submitted) return;
    const timer = setTimeout(() => {
      try {
        const draftData: DraftState = {
          montant,
          descriptionTravaux,
          delaiExecution,
          validiteOffre,
          inclusions,
          exclusions,
          conditions,
          isTTC,
        };
        localStorage.setItem(draftKeyFor(leadId), JSON.stringify(draftData));
      } catch {
        // ignore
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [submitted, leadId, montant, descriptionTravaux, delaiExecution, validiteOffre, inclusions, exclusions, conditions, isTTC]);

  function validate(): boolean {
    const newErrors: FormErrors = {};

    const amount = parseMontant(montant);
    if (!montant || isNaN(amount) || amount <= 0) {
      newErrors.montant = 'Le montant doit être supérieur à 0';
    }

    if (!descriptionTravaux || descriptionTravaux.trim().length < 50) {
      newErrors.descriptionTravaux = 'La description doit contenir au moins 50 caractères';
    }

    if (!delaiExecution.trim()) {
      newErrors.delaiExecution = "Le délai d'exécution est requis";
    }

    if (!validiteOffre.trim()) {
      newErrors.validiteOffre = "La validité de l'offre est requise";
    }

    // Cautionnement validation : if user checked the box, a type + positive amount are required
    if (cautionnementInclus) {
      const cautionnementAmount = parseMontant(montantCautionnement);
      if (!montantCautionnement || isNaN(cautionnementAmount) || cautionnementAmount <= 0) {
        newErrors.montantCautionnement = 'Indiquez un montant de cautionnement supérieur à 0';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) {
      scrollToFirstError();
      return;
    }

    // We always submit the HT amount to the backend (pre-tax)
    const finalMontant = taxes ? taxes.ht : parseMontant(montant);

    const data: SoumissionCreate = {
      leadId,
      montant: finalMontant,
      descriptionTravaux: descriptionTravaux.trim(),
      delaiExecution: delaiExecution.trim(),
      validiteOffre: validiteOffre.trim(),
      ...(inclusions.trim() && { inclusions: inclusions.trim() }),
      ...(exclusions.trim() && { exclusions: exclusions.trim() }),
      ...(conditions.trim() && { conditions: conditions.trim() }),
      cautionnementInclus,
      ...(cautionnementInclus && typeCautionnement && { typeCautionnement }),
      ...(cautionnementInclus && montantCautionnement && {
        montantCautionnement: parseMontant(montantCautionnement),
      }),
    };

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

    // Freeze draft auto-save BEFORE calling onSubmit to avoid re-writing a draft
    // between the parent page's cleanup and this component's unmount.
    setSubmitted(true);
    try {
      await onSubmit(data);
    } catch {
      // If the submit failed, re-enable auto-save so the user doesn't lose their input.
      setSubmitted(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Montant section with TPS/TVQ calculator */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Montant */}
          <div>
            <Input
              label={`Montant ${isTTC ? '(TTC) *' : '(HT — avant taxes) *'}`}
              type="text"
              inputMode="decimal"
              placeholder="ex: 15 000,00"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              error={errors.montant}
            />
            <label className="mt-2 flex items-center gap-2 cursor-pointer text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={isTTC}
                onChange={(e) => setIsTTC(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
              />
              <span>J&apos;ai entré un montant TTC (taxes incluses)</span>
            </label>
          </div>

          {/* Délai d'exécution */}
          <Input
            label={"Délai d'exécution *"}
            type="text"
            placeholder="ex: 30 jours"
            value={delaiExecution}
            onChange={(e) => setDelaiExecution(e.target.value)}
            error={errors.delaiExecution}
            helperText="En jours ouvrables après signature"
          />
        </div>

        {/* Tax calculator preview */}
        {taxes && (
          <div
            className="rounded-lg border border-seaop-primary-200 dark:border-seaop-primary-800 bg-seaop-primary-50 dark:bg-seaop-primary-900/20 p-3 sm:p-4"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-seaop-primary-700 dark:text-seaop-primary-300 mb-2">
              <Calculator className="h-4 w-4" />
              <span>Récapitulatif avec taxes Québec</span>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600 dark:text-gray-400">Sous-total (HT)</dt>
                <dd className="font-mono text-gray-900 dark:text-gray-100">{formatCurrency(taxes.ht)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600 dark:text-gray-400">TPS (5%)</dt>
                <dd className="font-mono text-gray-900 dark:text-gray-100">{formatCurrency(taxes.tps)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600 dark:text-gray-400">TVQ (9,975%)</dt>
                <dd className="font-mono text-gray-900 dark:text-gray-100">{formatCurrency(taxes.tvq)}</dd>
              </div>
              <div className="flex justify-between pt-1 border-t border-seaop-primary-200 dark:border-seaop-primary-800">
                <dt className="font-semibold text-gray-800 dark:text-gray-200">Total TTC</dt>
                <dd className="font-mono font-bold text-seaop-primary-700 dark:text-seaop-primary-300">
                  {formatCurrency(taxes.ttc)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Le client verra le montant hors taxes ({formatCurrency(taxes.ht)}). Les taxes sont appliquées à la facturation finale.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Validité de l'offre */}
          <Input
            label={"Validité de l'offre *"}
            type="text"
            placeholder="ex: 30 jours"
            value={validiteOffre}
            onChange={(e) => setValiditeOffre(e.target.value)}
            error={errors.validiteOffre}
            helperText="Combien de temps votre offre reste valide"
          />
        </div>
      </div>

      {/* Description - full width */}
      <Textarea
        label="Description des travaux *"
        placeholder={"Décrivez en détail les travaux proposés, les matériaux, les méthodes... (min. 50 caractères)"}
        rows={5}
        value={descriptionTravaux}
        onChange={(e) => setDescriptionTravaux(e.target.value)}
        error={errors.descriptionTravaux}
        helperText={`${descriptionTravaux.length}/50 caractères minimum`}
      />

      {/* Optional sections in two-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Textarea
          label="Inclusions"
          placeholder="Ce qui est inclus dans la soumission..."
          rows={3}
          value={inclusions}
          onChange={(e) => setInclusions(e.target.value)}
        />

        <Textarea
          label="Exclusions"
          placeholder="Ce qui n'est pas inclus..."
          rows={3}
          value={exclusions}
          onChange={(e) => setExclusions(e.target.value)}
        />
      </div>

      {/* Conditions - full width */}
      <Textarea
        label="Conditions"
        placeholder={"Conditions particulières, modalités de paiement..."}
        rows={3}
        value={conditions}
        onChange={(e) => setConditions(e.target.value)}
      />

      {/* File upload */}
      <FileUpload
        label="Documents joints (optionnel)"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
        maxFiles={3}
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

      {/* Cautionnement / Bid Bond */}
      <fieldset className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <legend className="text-sm font-semibold text-gray-800 dark:text-gray-200 px-1">
          Cautionnement de soumission (optionnel)
        </legend>

        <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-gray-700 dark:text-gray-300 flex gap-2">
          <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="space-y-1">
            <p>
              <strong>Qu&apos;est-ce qu&apos;un cautionnement ?</strong> C&apos;est une garantie
              (chèque, lettre bancaire ou cautionnement d&apos;assurance) prouvant que vous vous engagez à honorer votre soumission si elle est retenue.
            </p>
            <p>
              <strong>Montant typique :</strong> 5 à 10% du prix de la soumission. <strong>Remboursable</strong> si votre offre n&apos;est pas retenue.
            </p>
            <p>
              Consultez les exigences du projet pour voir si le client l&apos;exige.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cautionnementInclus}
            onChange={(e) => {
              const checked = e.target.checked;
              setCautionnementInclus(checked);
              if (!checked) {
                // Reset dependent fields so a stale value can't be submitted
                // if the user re-checks without re-entering the amount/type.
                setTypeCautionnement('');
                setMontantCautionnement('');
                setErrors((prev) => ({ ...prev, montantCautionnement: undefined }));
              }
            }}
            className="h-4 w-4 rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            J&apos;inclus un cautionnement dans ma soumission
          </span>
        </label>

        {cautionnementInclus && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <Select
              label="Type de cautionnement"
              value={typeCautionnement}
              onChange={(e) => setTypeCautionnement(e.target.value)}
              options={[
                { value: 'cheque_certifie', label: 'Chèque certifié' },
                { value: 'lettre_garantie', label: 'Lettre de garantie bancaire' },
                { value: 'cautionnement_soumission', label: 'Cautionnement d\u2019assurance' },
              ]}
              placeholder="Sélectionner un type"
            />
            <Input
              label="Montant du cautionnement ($)"
              type="text"
              inputMode="decimal"
              placeholder="ex: 1 500,00"
              value={montantCautionnement}
              onChange={(e) => setMontantCautionnement(e.target.value)}
              error={errors.montantCautionnement}
              helperText={
                errors.montantCautionnement
                  ? undefined
                  : taxes
                    ? `Suggestion 5-10% : ${formatCurrency(taxes.ht * 0.05)} à ${formatCurrency(taxes.ht * 0.1)}`
                    : '5 à 10% du montant de la soumission'
              }
            />
          </div>
        )}
      </fieldset>

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isLoading}
          leftIcon={<Send className="h-5 w-5" />}
          className="w-full sm:w-auto"
        >
          Soumettre la proposition
        </Button>
      </div>
    </form>
  );
}

SoumissionForm.displayName = 'SoumissionForm';

export { SoumissionForm };
export type { Props as SoumissionFormProps };
