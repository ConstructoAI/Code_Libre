/**
 * SEAOP React Frontend - Soumission Card
 * Displays a single bid (soumission) in a card format.
 */

import { useState } from 'react';
import clsx from 'clsx';
import {
  Building2,
  ShieldCheck,
  Clock,
  CalendarDays,
  Eye,
  CheckCircle,
  XCircle,
  Award,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';

import { Link } from 'react-router-dom';
import type { Soumission } from '@/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StarRating } from '@/components/ui/StarRating';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatCurrency, formatDate, truncate } from '@/utils/format';
import type { BadgeColor } from '@/components/ui/Badge';

interface Props {
  soumission: Soumission;
  isClientView?: boolean;
  onAccept?: (id: number) => void;
  onReject?: (id: number) => void;
  onAward?: (id: number) => void;
  onViewDetails?: (id: number) => void;
}

/** Map soumission status to badge color */
function statusBadgeColor(statut: string | null): BadgeColor {
  switch (statut) {
    case 'acceptee':
      return 'green';
    case 'refusee':
      return 'red';
    case 'en_evaluation':
      return 'yellow';
    case 'vue':
      return 'blue';
    case 'envoyee':
    default:
      return 'gray';
  }
}

/** Map soumission status to display label */
function statusLabel(statut: string | null): string {
  switch (statut) {
    case 'envoyee':
      return 'Envoyée';
    case 'vue':
      return 'Vue';
    case 'en_evaluation':
      return 'En évaluation';
    case 'acceptee':
      return 'Contrat attribué';
    case 'refusee':
      return 'Non retenue';
    default:
      return statut || 'Inconnue';
  }
}

function SoumissionCard({
  soumission,
  isClientView = false,
  onAccept,
  onReject,
  onAward,
  onViewDetails,
}: Props) {
  const isEnvoyee = soumission.statut === 'envoyee';
  const isAcceptee = soumission.statut === 'acceptee';
  const isRefusee = soumission.statut === 'refusee';
  const canAward = isClientView && !isAcceptee && !isRefusee;
  const [showAwardConfirm, setShowAwardConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);

  function handleAwardConfirm() {
    setShowAwardConfirm(false);
    if (onAward) {
      onAward(soumission.id);
    }
  }

  function handleRejectConfirm() {
    setShowRejectConfirm(false);
    if (onReject) {
      onReject(soumission.id);
    }
  }

  function handleAcceptConfirm() {
    setShowAcceptConfirm(false);
    if (onAccept) {
      onAccept(soumission.id);
    }
  }

  const showLeadInfo = !isClientView && (soumission.leadNom || soumission.leadTypeProjet || soumission.leadNumeroReference);

  return (
    <Card className="flex flex-col h-full">
      {/* Lead info banner — only for entrepreneur view */}
      {showLeadInfo && (
        <Link
          to={`/projet/${soumission.leadId}`}
          className="block -m-3 sm:-m-5 mb-3 p-3 sm:p-4 rounded-t-md bg-seaop-primary-50 dark:bg-seaop-primary-900/20 border-b border-seaop-primary-200 dark:border-seaop-primary-800 hover:bg-seaop-primary-100 dark:hover:bg-seaop-primary-900/30 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-seaop-primary-500"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-seaop-primary-700 dark:text-seaop-primary-300 mb-0.5">
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold uppercase tracking-wide">Projet</span>
                {soumission.leadNumeroReference && (
                  <span className="font-mono truncate">{soumission.leadNumeroReference}</span>
                )}
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {soumission.leadTypeProjet || soumission.leadNom || 'Projet'}
              </p>
            </div>
            <ExternalLink className="h-4 w-4 text-seaop-primary-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>
      )}

      {/* Header: Entrepreneur name + status badge */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="h-5 w-5 text-gray-400 dark:text-gray-500 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {soumission.nomEntreprise || 'Entrepreneur'}
            </h3>
            {soumission.nomContact && (
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {soumission.nomContact}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isClientView && soumission.vueParClient && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 bg-green-50 dark:bg-green-900/30 rounded-full"
              title="Le client a consulté votre soumission"
            >
              <Eye className="h-3 w-3 text-green-600 dark:text-green-400" />
              <span className="text-xs text-green-700 dark:text-green-400 font-medium">Vue</span>
            </div>
          )}
          <Badge color={statusBadgeColor(soumission.statut)} size="sm">
            {statusLabel(soumission.statut)}
          </Badge>
        </div>
      </div>

      {/* RBQ + Cautionnement badges */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {soumission.rbqVerifie && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-green-50 dark:bg-green-900/30 rounded-full">
            <ShieldCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            <span className="text-xs text-green-700 dark:text-green-400 font-medium">RBQ vérifié</span>
          </div>
        )}
        {!soumission.rbqVerifie && soumission.numeroRbq && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-gray-50 dark:bg-gray-800 rounded-full">
            <ShieldCheck className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">RBQ: {soumission.numeroRbq}</span>
          </div>
        )}
        {soumission.assuranceResponsabilite && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 rounded-full">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">Assuré</span>
          </div>
        )}
        {soumission.cautionnementInclus && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-green-50 dark:bg-green-900/30 rounded-full">
            <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            <span className="text-xs text-green-700 dark:text-green-400 font-medium">Cautionné</span>
          </div>
        )}
      </div>

      {/* Amount - prominent */}
      <div className="mb-3">
        <p className="text-2xl font-bold text-seaop-primary-600 dark:text-seaop-primary-400">
          {formatCurrency(soumission.montant)}
        </p>
      </div>

      {/* Description (truncated) */}
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3">
        {truncate(soumission.descriptionTravaux, 200)}
      </p>

      {/* Info row */}
      <div className="flex items-center gap-4 mb-3 text-sm text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          <span>{soumission.delaiExecution}</span>
        </div>
        <div className="flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5" />
          <span>Validité: {soumission.validiteOffre}</span>
        </div>
      </div>

      {/* Evaluation stars (if evaluated) */}
      {soumission.evaluationsMoyenne != null && soumission.evaluationsMoyenne > 0 && (
        <div className="mb-3">
          <StarRating value={soumission.evaluationsMoyenne} size="sm" showValue />
        </div>
      )}

      {/* Date */}
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
        Soumise le {formatDate(soumission.dateCreation)}
      </p>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
        {onViewDetails && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewDetails(soumission.id)}
            leftIcon={<Eye className="h-4 w-4" />}
          >
            Détails
          </Button>
        )}

        {/* Award button for clients - visible when bid is not already accepted/rejected */}
        {canAward && onAward && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAwardConfirm(true)}
            leftIcon={<Award className="h-4 w-4" />}
            className="!bg-green-600 hover:!bg-green-700 dark:!bg-green-500 dark:hover:!bg-green-600"
          >
            Attribuer
          </Button>
        )}

        {isClientView && isEnvoyee && (
          <>
            {onAccept && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAcceptConfirm(true)}
                leftIcon={<CheckCircle className="h-4 w-4" />}
                className="!bg-green-600 hover:!bg-green-700 dark:!bg-green-500 dark:hover:!bg-green-600"
              >
                Accepter
              </Button>
            )}
            {onReject && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowRejectConfirm(true)}
                leftIcon={<XCircle className="h-4 w-4" />}
              >
                Refuser
              </Button>
            )}
          </>
        )}
      </div>

      {/* Award Confirmation */}
      <ConfirmDialog
        isOpen={showAwardConfirm}
        title="Attribuer le contrat"
        message={
          <>
            Vous êtes sur le point d&apos;attribuer ce contrat à{' '}
            <strong>{soumission.nomEntreprise || 'cet entrepreneur'}</strong> pour{' '}
            <strong>{formatCurrency(soumission.montant)}</strong>.
            <br />
            <br />
            Les autres soumissions seront automatiquement refusées et les entrepreneurs notifiés.
          </>
        }
        confirmLabel="Confirmer l'attribution"
        variant="primary"
        onConfirm={handleAwardConfirm}
        onCancel={() => setShowAwardConfirm(false)}
      />

      {/* Reject Confirmation */}
      <ConfirmDialog
        isOpen={showRejectConfirm}
        title="Refuser cette soumission ?"
        message={
          <>
            Vous êtes sur le point de refuser la soumission de{' '}
            <strong>{soumission.nomEntreprise || 'cet entrepreneur'}</strong>.
            Il recevra une notification. Cette action ne peut pas être annulée.
          </>
        }
        confirmLabel="Refuser"
        variant="danger"
        onConfirm={handleRejectConfirm}
        onCancel={() => setShowRejectConfirm(false)}
      />

      {/* Accept Confirmation */}
      <ConfirmDialog
        isOpen={showAcceptConfirm}
        title="Accepter cette soumission ?"
        message={
          <>
            Vous êtes sur le point d&apos;accepter la soumission de{' '}
            <strong>{soumission.nomEntreprise || 'cet entrepreneur'}</strong> pour{' '}
            <strong>{formatCurrency(soumission.montant)}</strong>.
            <br />
            <br />
            L&apos;entrepreneur sera notifié et pourra commencer à communiquer avec vous.
            Vous pourrez attribuer définitivement le contrat plus tard.
          </>
        }
        confirmLabel="Accepter"
        variant="primary"
        onConfirm={handleAcceptConfirm}
        onCancel={() => setShowAcceptConfirm(false)}
      />
    </Card>
  );
}

SoumissionCard.displayName = 'SoumissionCard';

export { SoumissionCard };
export type { Props as SoumissionCardProps };
