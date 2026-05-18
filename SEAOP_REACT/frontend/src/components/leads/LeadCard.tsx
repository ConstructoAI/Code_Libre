import React from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  Send,
  DollarSign,
  Clock,
  MapPin,
  CalendarDays,
  FileText,
} from 'lucide-react';

import type { Lead } from '@/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { getUrgencyConfig } from '@/utils/urgency';
import { formatDate, daysRemaining, formatDaysRemaining, truncate } from '@/utils/format';
import type { BadgeColor } from '@/components/ui/Badge';

interface Props {
  lead: Lead;
  onView?: (id: number) => void;
  onSubmitBid?: (id: number) => void;
  showBidButton?: boolean;
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

/** Map days remaining to text color class */
function daysRemainingColorClass(days: number | null): string {
  if (days === null) return 'text-gray-500 dark:text-gray-400';
  if (days <= 0) return 'text-red-600 dark:text-red-400';
  if (days <= 3) return 'text-red-500 dark:text-red-400';
  if (days <= 7) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-green-600 dark:text-green-400';
}

function statusBadge(statut: string | null | undefined): {
  color: 'gray' | 'green' | 'blue' | 'yellow' | 'red';
  label: string;
} | null {
  switch (statut) {
    case 'nouveau':
    case 'en_cours':
      return null; // active = no need to clutter the card
    case 'attribue':
      return { color: 'blue', label: 'Attribué' };
    case 'ferme':
      return { color: 'gray', label: 'Fermé' };
    case 'annule':
      return { color: 'red', label: 'Annulé' };
    default:
      return null;
  }
}

const LeadCard: React.FC<Props> = ({ lead, onView, onSubmitBid, showBidButton = false }) => {
  const navigate = useNavigate();
  const urgencyLevel = lead.niveauUrgence || 'normal';
  const urgencyConfig = getUrgencyConfig(urgencyLevel);
  const deadlineDays = daysRemaining(lead.dateLimiteSoumissions);
  const deadlineText = formatDaysRemaining(lead.dateLimiteSoumissions);
  const title = lead.nom || `Projet ${lead.numeroReference || lead.id}`;
  const statusInfo = statusBadge(lead.statut);
  const isInactive = statusInfo?.color === 'gray' || statusInfo?.color === 'red';
  const isAwarded = lead.statut === 'attribue';
  const canBid = !isInactive && !isAwarded;

  return (
    <Card
      hover
      padding="sm"
      className={clsx(
        'flex flex-col h-full sm:p-5',
        isInactive && 'opacity-70',
      )}
    >
      {/* Top: Badges */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {statusInfo ? (
          <Badge color={statusInfo.color} size="sm">
            {statusInfo.label}
          </Badge>
        ) : (
          <Badge color={urgencyBadgeColor(urgencyLevel)} size="sm">
            {urgencyConfig.label}
          </Badge>
        )}
        <Badge color="teal" size="sm">
          {lead.typeProjet}
        </Badge>
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {title}
      </h3>

      {/* Description (2 lines truncated) */}
      {lead.description && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3 sm:line-clamp-2">
          {truncate(lead.description, 150)}
        </p>
      )}

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-sm">
        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <DollarSign className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{lead.budget || '--'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{lead.delaiRealisation || '--'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{lead.codePostal || '--'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{formatDate(lead.dateLimiteSoumissions)}</span>
        </div>
      </div>

      {/* Days Remaining Indicator */}
      {lead.dateLimiteSoumissions && (
        <div
          className={clsx(
            'flex items-center gap-1.5 text-xs font-medium mb-3',
            daysRemainingColorClass(deadlineDays),
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          {deadlineText}
        </div>
      )}

      {/* Spacer to push bottom content down */}
      <div className="flex-1" />

      {/* Bottom: Soumissions count + Actions */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <FileText className="h-4 w-4" />
          <span>
            {lead.nbSoumissions ?? 0} soumission{(lead.nbSoumissions ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/projet/${lead.id}`)}
            leftIcon={<Eye className="h-4 w-4" />}
            className="min-h-[44px]"
          >
            Voir détails
          </Button>

          {showBidButton && canBid && onSubmitBid && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onSubmitBid(lead.id)}
              leftIcon={<Send className="h-4 w-4" />}
              className="min-h-[44px]"
            >
              Soumettre
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

LeadCard.displayName = 'LeadCard';

export { LeadCard };
export type { Props as LeadCardProps };
