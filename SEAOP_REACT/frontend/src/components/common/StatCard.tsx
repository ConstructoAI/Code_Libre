/**
 * SEAOP React Frontend - Statistics Card Component
 * Displays a metric value with label, optional icon, and optional trend indicator.
 * Used on dashboards and summary sections.
 */

import clsx from 'clsx';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Props {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { value: number; isPositive: boolean };
  className?: string;
}

export default function StatCard({ label, value, icon, trend, className }: Props) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-gray-200 bg-white p-3 sm:p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Text content */}
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
            {label}
          </p>
          <p className="mt-1 text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
            {value}
          </p>

          {/* Trend indicator */}
          {trend && (
            <div
              className={clsx(
                'mt-2 inline-flex items-center gap-1 text-xs font-medium',
                trend.isPositive
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400',
              )}
            >
              {trend.isPositive ? (
                <TrendingUp size={14} />
              ) : (
                <TrendingDown size={14} />
              )}
              <span>
                {trend.isPositive ? '+' : ''}
                {trend.value}%
              </span>
            </div>
          )}
        </div>

        {/* Icon */}
        {icon && (
          <div className="flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-seaop-primary-100 text-seaop-primary-600 dark:bg-seaop-primary-900/40 dark:text-seaop-primary-400">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
