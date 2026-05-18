import React from 'react';
import clsx from 'clsx';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

// Palette pastel harmonisee avec ERP Suivi (Gantt/Kanban/Calendrier)
const variantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-[#B8C4CE]/20 text-[#6B7B8A] dark:bg-[#B8C4CE]/15 dark:text-[#B8C4CE]',
  success: 'bg-[#7DC4A5]/15 text-[#4A9475] dark:bg-[#7DC4A5]/20 dark:text-[#9DD4B5]',
  warning: 'bg-[#F6C87A]/15 text-[#9E7B1E] dark:bg-[#F6C87A]/20 dark:text-[#F6D89A]',
  danger: 'bg-[#E8919A]/15 text-[#B8616A] dark:bg-[#E8919A]/20 dark:text-[#E8A1AA]',
  info: 'bg-[#7BAFD4]/15 text-[#4A7FA8] dark:bg-[#7BAFD4]/20 dark:text-[#9BC8E4]',
};

const Badge: React.FC<BadgeProps> = ({ children, className, variant = 'default', ...rest }) => {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap',
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
};

Badge.displayName = 'Badge';

export { Badge };
export type { BadgeProps };
