import React from 'react';
import clsx from 'clsx';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
  hover?: boolean;
  draggable?: boolean;
}

const paddingStyles: Record<NonNullable<CardProps['padding']>, string> = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
};

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className, padding = 'md', hover = false, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(
          'rounded-xl border shadow-sm',
          'bg-white dark:bg-gray-800',
          'border-gray-200 dark:border-gray-700',
          paddingStyles[padding],
          hover &&
            'transition-all duration-200 hover:shadow-md hover:scale-[1.02] cursor-pointer',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = 'Card';

export { Card };
export type { CardProps };
