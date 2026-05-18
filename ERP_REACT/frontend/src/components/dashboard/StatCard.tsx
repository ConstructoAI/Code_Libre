/**
 * ERP React Frontend - Stat Card Component
 * Displays a single KPI metric with icon and label.
 */

import clsx from 'clsx';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'teal';
  trend?: string;
}

const colorStyles: Record<NonNullable<StatCardProps['color']>, { bg: string; icon: string }> = {
  blue: { bg: 'bg-[#7BAFD4]/10 dark:bg-[#7BAFD4]/20', icon: 'text-[#4A7FA8] dark:text-[#9BC8E4]' },
  green: { bg: 'bg-[#7DC4A5]/10 dark:bg-[#7DC4A5]/20', icon: 'text-[#4A9475] dark:text-[#9DD4B5]' },
  red: { bg: 'bg-[#E8919A]/10 dark:bg-[#E8919A]/20', icon: 'text-[#B8616A] dark:text-[#E8A1AA]' },
  yellow: { bg: 'bg-[#F6C87A]/10 dark:bg-[#F6C87A]/20', icon: 'text-[#9E7B1E] dark:text-[#F6D89A]' },
  purple: { bg: 'bg-[#B09BD8]/10 dark:bg-[#B09BD8]/20', icon: 'text-[#7A6BA8] dark:text-[#C0ABE8]' },
  teal: { bg: 'bg-[#7DC4B5]/10 dark:bg-[#7DC4B5]/20', icon: 'text-[#4A9485] dark:text-[#9DD4C5]' },
};

export default function StatCard({ label, value, icon, color = 'blue', trend }: StatCardProps) {
  const styles = colorStyles[color];

  return (
    <div className="erp-card p-3 sm:p-4 border-t-2 border-t-transparent hover:border-t-[#0078D4] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] sm:text-xs text-[#605e5c] dark:text-[#a19f9d] uppercase font-semibold tracking-wide truncate">{label}</p>
          <p className="mt-1 sm:mt-1.5 text-xl sm:text-2xl font-bold text-[#323130] dark:text-[#f3f2f1] truncate">{value}</p>
          {trend && (
            <p className="mt-0.5 text-[10px] sm:text-xs text-[#a19f9d] dark:text-[#605e5c] truncate">{trend}</p>
          )}
        </div>
        <div className={clsx('p-1.5 sm:p-2 rounded shrink-0', styles.bg)}>
          <div className={styles.icon}>{icon}</div>
        </div>
      </div>
    </div>
  );
}
