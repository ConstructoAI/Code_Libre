/**
 * SEAOP React Frontend - Lead Detail Page
 * Displays full project details for a single lead (appel d'offres).
 * Route: /projet/:id
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  DollarSign,
  Clock,
  MapPin,
  CalendarDays,
  Phone,
  Mail,
  FileText,
  Image,
  Send,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  Plus,
  ScrollText,
} from 'lucide-react';

import type { Lead, SoumissionCreate, Addendum } from '@/types';
import type { UploadResult } from '@/api/uploads';
import { getAddenda, createAddendum } from '@/api/leads';
import { useLeadStore } from '@/store/useLeadStore';
import { useSoumissionStore } from '@/store/useSoumissionStore';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { Modal } from '@/components/ui/Modal';
import { SoumissionCard } from '@/components/soumissions/SoumissionCard';
import { SoumissionForm } from '@/components/soumissions/SoumissionForm';
import { getUrgencyConfig } from '@/utils/urgency';
import { formatDate, formatDaysRemaining, daysRemaining, formatPhone } from '@/utils/format';
import { STATUTS_PROJET } from '@/utils/constants';
import type { BadgeColor } from '@/components/ui/Badge';

// ============ Helpers ============

/** Map urgency level to Badge color */
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

/** Map project status to Badge color */
function statusBadgeColor(statut: string | null): BadgeColor {
  switch (statut) {
    case 'nouveau':
      return 'blue';
    case 'en_cours':
      return 'yellow';
    case 'attribue':
      return 'green';
    case 'annule':
      return 'red';
    case 'ferme':
      return 'gray';
    default:
      return 'gray';
  }
}

/** Map days remaining to text color class */
function daysRemainingColorClass(days: number | null): string {
  if (days === null) return 'text-gray-500 dark:text-gray-400';
  if (days <= 0) return 'text-red-600 dark:text-red-400';
  if (days <= 3) return 'text-red-500 dark:text-red-400';
  if (days <= 7) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-green-600 dark:text-green-400';
}

/** Safely parse a JSON string that may contain an array of UploadResult */
function parseDocArray(raw: string | null): UploadResult[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Human-readable file size */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** True when content type represents an image */
function isImageType(contentType: string): boolean {
  return contentType.startsWith('image/');
}

// ============ Detail Field Component ============

function DetailField({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 mt-0.5 text-[#0078D4] dark:text-[#6cb8f6]">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-[#605e5c] dark:text-[#a19f9d] uppercase tracking-wide">
          {label}
        </p>
        <p className={`text-sm font-semibold text-[#323130] dark:text-[#f3f2f1] mt-0.5 ${className ?? ''}`}>
          {value || <span className="text-[#a19f9d] dark:text-[#605e5c] font-normal">--</span>}
        </p>
      </div>
    </div>
  );
}

// ============ Main Component ============

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { currentLead, isLoadingDetail, error, fetchLead } = useLeadStore();
  const {
    soumissionsForLead,
    isLoadingSoumissions,
    fetchSoumissionsForLead,
    submitSoumission,
  } = useSoumissionStore();
  const { isAuthenticated, user } = useAuthStore();

  const [showBidModal, setShowBidModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bidSuccess, setBidSuccess] = useState(false);

  // Addenda state
  const [addenda, setAddenda] = useState<Addendum[]>([]);
  const [isLoadingAddenda, setIsLoadingAddenda] = useState(false);
  const [showAddendumForm, setShowAddendumForm] = useState(false);
  const [addendumTitre, setAddendumTitre] = useState('');
  const [addendumDescription, setAddendumDescription] = useState('');
  const [isSubmittingAddendum, setIsSubmittingAddendum] = useState(false);

  const fetchAddenda = useCallback(async (leadId: number) => {
    setIsLoadingAddenda(true);
    try {
      const data = await getAddenda(leadId);
      setAddenda(data);
    } catch {
      // Silently handle - addenda are supplementary
    } finally {
      setIsLoadingAddenda(false);
    }
  }, []);

  // Fetch lead + soumissions + addenda on mount
  useEffect(() => {
    if (id) {
      const numericId = parseInt(id, 10);
      if (!isNaN(numericId)) {
        fetchLead(numericId);
        fetchSoumissionsForLead(numericId);
        fetchAddenda(numericId);
      }
    }
  }, [id, fetchLead, fetchSoumissionsForLead, fetchAddenda]);

  // Handle bid submission
  async function handleSubmitBid(data: SoumissionCreate) {
    setIsSubmitting(true);
    try {
      await submitSoumission(data);
      setBidSuccess(true);
      toast.success('Soumission envoyée', {
        description: 'Le client a été notifié de votre offre.',
      });
      try {
        localStorage.removeItem(`seaop_soumission_draft_${data.leadId}`);
      } catch {
        // ignore
      }
      setTimeout(() => {
        setBidSuccess(false);
        setShowBidModal(false);
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\u2019envoi';
      toast.error('Soumission impossible', { description: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCloseModal() {
    setBidSuccess(false);
    setShowBidModal(false);
  }

  // Handle award (attribuer)
  async function handleAwardSoumission(soumissionId: number) {
    if (!id) return;
    try {
      await useSoumissionStore.getState().awardSoumission(soumissionId, parseInt(id, 10));
      toast.success('Contrat attribué', {
        description: 'L\u2019entrepreneur a été notifié. Les autres soumissions ont été refusées.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur';
      toast.error('Attribution impossible', { description: message });
    }
  }

  // Handle addendum submission
  async function handleSubmitAddendum(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !addendumTitre.trim() || !addendumDescription.trim()) return;
    setIsSubmittingAddendum(true);
    try {
      await createAddendum(parseInt(id, 10), {
        titre: addendumTitre.trim(),
        description: addendumDescription.trim(),
      });
      setAddendumTitre('');
      setAddendumDescription('');
      setShowAddendumForm(false);
      fetchAddenda(parseInt(id, 10));
      toast.success('Addenda publié', {
        description: 'Les entrepreneurs qui ont soumissionné seront notifiés.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la publication';
      toast.error('Addenda non publié', { description: message });
    } finally {
      setIsSubmittingAddendum(false);
    }
  }

  // Derived values
  const lead: Lead | null = currentLead;
  const isEntrepreneur = isAuthenticated && user?.userType === 'entrepreneur';
  const isClient = isAuthenticated && user?.userType === 'client';
  const isLeadOwner = isClient && lead && user?.email === lead.email;
  const isAdmin = isAuthenticated && (user?.userType === 'admin' || user?.userType === 'super_admin');

  // ===== Loading State =====
  if (isLoadingDetail) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
        <p className="mt-4 text-sm text-[#605e5c] dark:text-[#a19f9d]">
          Chargement du projet...
        </p>
      </div>
    );
  }

  // ===== Error / Not Found State =====
  if (!lead) {
    return (
      <div className="max-w-2xl mx-auto py-16">
        <Alert type="error" title="Projet introuvable">
          {error || "Le projet demandé n’existe pas ou n’est plus disponible."}
        </Alert>
        <div className="mt-6">
          <Button
            variant="secondary"
            onClick={() => navigate('/appels-offres')}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Retour aux projets
          </Button>
        </div>
      </div>
    );
  }

  // Computed lead info
  const urgencyLevel = lead.niveauUrgence || 'normal';
  const urgencyConfig = getUrgencyConfig(urgencyLevel);
  const statusConfig = STATUTS_PROJET[lead.statut || 'nouveau'];
  const deadlineDays = daysRemaining(lead.dateLimiteSoumissions);
  const deadlineText = formatDaysRemaining(lead.dateLimiteSoumissions);
  const title = lead.nom || `Projet ${lead.numeroReference || lead.id}`;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24 sm:pb-0">
      {/* ===== Top Bar: Back + Badges ===== */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/appels-offres')}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          Retour aux projets
        </Button>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {lead.statut && (
            <Badge color={statusBadgeColor(lead.statut)} size="md">
              {statusConfig?.label || lead.statut}
            </Badge>
          )}
          <Badge color={urgencyBadgeColor(urgencyLevel)} size="md">
            {urgencyConfig.label}
          </Badge>
        </div>
      </div>

      {/* ===== Section 1: Project Header ===== */}
      <Card padding="lg">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color="teal" size="sm">
              {lead.typeProjet}
            </Badge>
            {lead.numeroReference && (
              <span className="text-xs text-[#605e5c] dark:text-[#a19f9d] font-mono">
                Réf. {lead.numeroReference}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1]">
            {title}
          </h1>

          {lead.dateCreation && (
            <p className="text-sm text-[#605e5c] dark:text-[#a19f9d]">
              Publié le {formatDate(lead.dateCreation)}
            </p>
          )}
        </div>
      </Card>

      {/* ===== Section 2: Full Description ===== */}
      <Card padding="lg">
        <h2 className="text-base font-semibold text-[#323130] dark:text-[#f3f2f1] mb-3">
          Description du projet
        </h2>
        <p className="text-sm text-[#323130] dark:text-[#c8c6c4] leading-relaxed whitespace-pre-line">
          {lead.description || 'Aucune description fournie.'}
        </p>
      </Card>

      {/* ===== Section 2b: Attached Documents ===== */}
      {(() => {
        const docs = parseDocArray(lead.documents);
        const plans = parseDocArray(lead.plans);
        const photos = parseDocArray(lead.photos);
        const allFiles = [
          ...docs.map((d) => ({ ...d, category: 'Document' as const })),
          ...plans.map((d) => ({ ...d, category: 'Plan' as const })),
          ...photos.map((d) => ({ ...d, category: 'Photo' as const })),
        ];
        if (allFiles.length === 0) return null;
        return (
          <Card padding="lg">
            <h2 className="text-base font-semibold text-[#323130] dark:text-[#f3f2f1] mb-3">
              Documents joints
            </h2>
            <ul className="space-y-2">
              {allFiles.map((file) => (
                <li
                  key={file.fileId}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2"
                >
                  {isImageType(file.contentType) ? (
                    <Image className="h-5 w-5 shrink-0 text-[#0078D4] dark:text-[#6cb8f6]" />
                  ) : (
                    <FileText className="h-5 w-5 shrink-0 text-[#0078D4] dark:text-[#6cb8f6]" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1] truncate">
                      {file.filename}
                    </p>
                    <p className="text-xs text-[#605e5c] dark:text-[#a19f9d]">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <Badge color="blue" size="sm">
                    {file.category}
                  </Badge>
                  {file.data && (
                    <button
                      type="button"
                      onClick={() => {
                        const byteChars = atob(file.data);
                        const byteNums = new Array(byteChars.length);
                        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                        const blob = new Blob([new Uint8Array(byteNums)], { type: file.contentType });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = file.filename;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-[#0078D4] hover:bg-[#deecf9] dark:text-[#6cb8f6] dark:hover:bg-[rgba(0,120,212,0.15)] transition-colors min-h-[44px] flex items-center"
                    >
                      Télécharger
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })()}

      {/* ===== Section 3: Key Details Grid ===== */}
      <Card padding="lg">
        <h2 className="text-base font-semibold text-[#323130] dark:text-[#f3f2f1] mb-4">
          Détails du projet
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          <DetailField
            icon={<DollarSign className="h-4 w-4" />}
            label="Budget"
            value={lead.budget}
          />
          <DetailField
            icon={<Clock className="h-4 w-4" />}
            label="Délai de réalisation"
            value={lead.delaiRealisation}
          />
          <DetailField
            icon={<CalendarDays className="h-4 w-4" />}
            label="Date de début souhaitée"
            value={formatDate(lead.dateDebutSouhaite)}
          />
          <DetailField
            icon={<CalendarDays className="h-4 w-4" />}
            label="Date limite des soumissions"
            value={
              lead.dateLimiteSoumissions ? (
                <span className="flex items-center gap-2">
                  <span>{formatDate(lead.dateLimiteSoumissions)}</span>
                  <span
                    className={`text-xs font-medium ${daysRemainingColorClass(deadlineDays)}`}
                  >
                    ({deadlineText})
                  </span>
                </span>
              ) : null
            }
          />
          <DetailField
            icon={<MapPin className="h-4 w-4" />}
            label="Code postal"
            value={lead.codePostal}
          />
          <DetailField
            icon={<Phone className="h-4 w-4" />}
            label="Téléphone"
            value={formatPhone(lead.telephone)}
          />
          <DetailField
            icon={<Mail className="h-4 w-4" />}
            label="Courriel"
            value={lead.email}
          />
        </div>
      </Card>

      {/* ===== Section 3b: Exigences de conformite ===== */}
      {(lead.rbqRequis || lead.cnesstRequis || lead.assuranceRequise || lead.cautionnementRequis) && (
        <Card padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <h2 className="text-base font-semibold text-[#323130] dark:text-[#f3f2f1]">
              Exigences de conformité
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {lead.rbqRequis && (
              <Badge color="teal" size="md">RBQ requise</Badge>
            )}
            {lead.cnesstRequis && (
              <Badge color="teal" size="md">CNESST requise</Badge>
            )}
            {lead.assuranceRequise && (
              <Badge color="teal" size="md">Assurance requise</Badge>
            )}
            {lead.cautionnementRequis && (
              <Badge color="teal" size="md">Cautionnement requis</Badge>
            )}
          </div>
          <div className="space-y-2 text-sm text-[#323130] dark:text-[#c8c6c4]">
            {lead.rbqRequis && lead.categoriesRbqRequises && (
              <p>
                <span className="font-medium">Catégories RBQ acceptées :</span>{' '}
                {lead.categoriesRbqRequises}
              </p>
            )}
            {lead.assuranceRequise && lead.montantAssuranceMin != null && lead.montantAssuranceMin > 0 && (
              <p>
                <span className="font-medium">Montant minimum d&apos;assurance :</span>{' '}
                {new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(lead.montantAssuranceMin)}
              </p>
            )}
            {lead.cautionnementRequis && lead.pourcentageCautionnement != null && (
              <p>
                <span className="font-medium">Cautionnement :</span>{' '}
                {lead.pourcentageCautionnement}%
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ===== Section 3c: Addenda ===== */}
      <Card padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 mb-4">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-[#0078D4] dark:text-[#6cb8f6]" />
            <h2 className="text-base font-semibold text-[#323130] dark:text-[#f3f2f1]">
              Addenda
            </h2>
            <Badge color="blue" size="sm">
              {addenda.length}
            </Badge>
          </div>
          {(isLeadOwner || isAdmin) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAddendumForm(!showAddendumForm)}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Ajouter un addendum
            </Button>
          )}
        </div>

        {/* Addendum creation form */}
        {showAddendumForm && (
          <form onSubmit={handleSubmitAddendum} className="mb-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 space-y-3">
            <input
              type="text"
              placeholder="Titre de l'addendum"
              value={addendumTitre}
              onChange={(e) => setAddendumTitre(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-[#323130] dark:text-[#f3f2f1] placeholder-gray-400 focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
            />
            <textarea
              placeholder="Description de la modification ou clarification..."
              value={addendumDescription}
              onChange={(e) => setAddendumDescription(e.target.value)}
              required
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-[#323130] dark:text-[#f3f2f1] placeholder-gray-400 focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none resize-none"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddendumForm(false);
                  setAddendumTitre('');
                  setAddendumDescription('');
                }}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isSubmittingAddendum}
                disabled={!addendumTitre.trim() || !addendumDescription.trim()}
              >
                Publier l&apos;addendum
              </Button>
            </div>
          </form>
        )}

        {/* Addenda list */}
        {isLoadingAddenda ? (
          <div className="flex justify-center py-4">
            <Spinner size="sm" />
          </div>
        ) : addenda.length > 0 ? (
          <div className="space-y-3">
            {addenda.map((a) => (
              <div
                key={a.id}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge color="blue" size="sm">
                    #{a.numero}
                  </Badge>
                  <h3 className="text-sm font-semibold text-[#323130] dark:text-[#f3f2f1]">
                    {a.titre}
                  </h3>
                </div>
                <p className="text-sm text-[#323130] dark:text-[#c8c6c4] whitespace-pre-line break-words mb-1">
                  {a.description}
                </p>
                <p className="text-xs text-[#605e5c] dark:text-[#a19f9d]">
                  {a.dateCreation ? formatDate(a.dateCreation) : ''}
                  {a.auteurEmail ? ` - ${a.auteurEmail}` : ''}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#605e5c] dark:text-[#a19f9d] text-center py-4">
            Aucun addendum pour ce projet.
          </p>
        )}
      </Card>

      {/* ===== Section 4: Soumissions reçues ===== */}
      <Card padding="lg">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base font-semibold text-[#323130] dark:text-[#f3f2f1]">
            Soumissions reçues
          </h2>
          <Badge color="blue" size="sm">
            {soumissionsForLead.length}
          </Badge>
        </div>

        {isLoadingSoumissions ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : soumissionsForLead.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {soumissionsForLead.map((s) => (
              <SoumissionCard
                key={s.id}
                soumission={s}
                isClientView={isClient ?? false}
                onAward={isClient ? handleAwardSoumission : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <FileText className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm text-[#605e5c] dark:text-[#a19f9d]">
              Aucune soumission pour ce projet pour le moment.
            </p>
          </div>
        )}
      </Card>

      {/* ===== Bottom CTA: Soumettre une proposition ===== */}
      {isEntrepreneur && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-white dark:bg-[#292827] border-t border-[#edebe9] dark:border-[#3b3a39] p-4 sm:static sm:border-0 sm:bg-transparent sm:dark:bg-transparent sm:p-0 sm:mt-8">
          <Button
            variant="primary"
            size="lg"
            className="w-full shadow-lg"
            onClick={() => setShowBidModal(true)}
            leftIcon={<Send className="h-5 w-5" />}
          >
            Soumettre une proposition
          </Button>
        </div>
      )}

      {/* ===== Bid Form Modal ===== */}
      <Modal
        isOpen={showBidModal}
        onClose={handleCloseModal}
        title={`Soumettre une proposition — ${lead.typeProjet}${lead.numeroReference ? ` (${lead.numeroReference})` : ''}`}
        size="xl"
      >
        {bidSuccess ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <Alert type="success" title="Soumission envoyée avec succès!">
              Votre proposition a été soumise. Vous pouvez suivre son statut dans
              l&apos;onglet «&nbsp;Mes soumissions&nbsp;».
            </Alert>
          </div>
        ) : (
          <SoumissionForm
            leadId={lead.id}
            onSubmit={handleSubmitBid}
            isLoading={isSubmitting}
          />
        )}
      </Modal>
    </div>
  );
}
