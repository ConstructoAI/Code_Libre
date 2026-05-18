import React from 'react';
import clsx from 'clsx';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
  hover?: boolean;
}

const paddingStyles: Record<NonNullable<CardProps['padding']>, string> = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
};

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, padding = 'md', hover = false }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(
          'rounded-md border shadow-sm',
          'bg-white dark:bg-[#292827]',
          'border-[#edebe9] dark:border-[#3b3a39]',
          paddingStyles[padding],
          hover &&
            'transition-all duration-200 hover:shadow-md hover:border-[#0078D4]/30 dark:hover:border-[#0078D4]/40 cursor-pointer',
          className,
        )}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = 'Card';

export { Card };
export type { CardProps };
