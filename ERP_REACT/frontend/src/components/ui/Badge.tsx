import React from 'react';
import clsx from 'clsx';

type BadgeColor = 'blue' | 'green' | 'red' | 'yellow' | 'gray' | 'teal' | 'purple' | 'amber' | 'indigo' | 'orange';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  children: React.ReactNode;
  color?: BadgeColor;
  size?: BadgeSize;
  className?: string;
}

// Palette pastel harmonisee avec le module Suivi (Gantt/Kanban/Calendrier)
const colorStyles: Record<BadgeColor, string> = {
  blue:    'bg-[#7BAFD4]/15 text-[#4A7FA8] dark:bg-[#7BAFD4]/20 dark:text-[#9BC8E4]',
  green:   'bg-[#7DC4A5]/15 text-[#4A9475] dark:bg-[#7DC4A5]/20 dark:text-[#9DD4B5]',
  red:     'bg-[#E8919A]/15 text-[#B8616A] dark:bg-[#E8919A]/20 dark:text-[#E8A1AA]',
  yellow:  'bg-[#F6C87A]/15 text-[#9E7B1E] dark:bg-[#F6C87A]/20 dark:text-[#F6D89A]',
  gray:    'bg-[#B8C4CE]/20 text-[#6B7B8A] dark:bg-[#B8C4CE]/15 dark:text-[#B8C4CE]',
  teal:    'bg-[#7DC4B5]/15 text-[#4A9485] dark:bg-[#7DC4B5]/20 dark:text-[#9DD4C5]',
  purple:  'bg-[#B09BD8]/15 text-[#7A6BA8] dark:bg-[#B09BD8]/20 dark:text-[#C0ABE8]',
  amber:   'bg-[#E8C17A]/15 text-[#8B7030] dark:bg-[#E8C17A]/20 dark:text-[#E8D19A]',
  indigo:  'bg-[#8B9FD4]/15 text-[#5B6FA4] dark:bg-[#8B9FD4]/20 dark:text-[#ABBBE4]',
  orange:  'bg-[#F0B07A]/15 text-[#A06A2A] dark:bg-[#F0B07A]/20 dark:text-[#F0C09A]',
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

const Badge: React.FC<BadgeProps> = ({
  children,
  color = 'gray',
  size = 'sm',
  className,
}) => {
  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium rounded-full whitespace-nowrap',
        colorStyles[color],
        sizeStyles[size],
        className,
      )}
    >
      {children}
    </span>
  );
};

Badge.displayName = 'Badge';

export { Badge };
export type { BadgeProps, BadgeColor, BadgeSize };
