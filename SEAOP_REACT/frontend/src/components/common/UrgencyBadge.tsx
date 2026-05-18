/**
 * SEAOP React Frontend - Urgency Badge Component
 * Displays a pill badge with color and optional icon based on urgency level.
 */

import clsx from 'clsx';
import { Clock, Info, AlertTriangle, AlertCircle } from 'lucide-react';
import { getUrgencyConfig } from '@/utils/urgency';
import type { UrgencyLevel } from '@/types';

// Map icon names from URGENCY_CONFIG to actual lucide components
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, any> = {
  clock: Clock,
  info: Info,
  'alert-triangle': AlertTriangle,
  'alert-circle': AlertCircle,
};

interface Props {
  level: UrgencyLevel | string;
  showIcon?: boolean;
}

export default function UrgencyBadge({ level, showIcon = true }: Props) {
  const config = getUrgencyConfig(level as UrgencyLevel);
  const IconComponent = ICON_MAP[config.icon] ?? Info;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
      )}
      style={{
        backgroundColor: config.bgColor,
        color: config.textColor,
      }}
    >
      {showIcon && <IconComponent size={14} />}
      {config.label}
    </span>
  );
}
