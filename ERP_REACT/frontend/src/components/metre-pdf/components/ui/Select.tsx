import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
  error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', error, children, ...props }, ref) => {
    const base =
      'h-9 w-full appearance-none rounded-lg border bg-slate-50 dark:bg-neutral-800 px-3 pr-8 text-sm text-slate-900 dark:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-50';
    const borderClass = error
      ? 'border-red-500'
      : 'border-slate-200 dark:border-neutral-700 hover:border-slate-400 dark:hover:border-neutral-500';

    return (
      <div className="relative flex flex-col gap-1">
        <select
          ref={ref}
          className={`${base} ${borderClass} ${className}`}
          {...props}
        >
          {children}
        </select>
        {/* Chevron */}
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-neutral-400"
          width="12"
          height="12"
          viewBox="0 0 12 12"
        >
          <path
            d="M2 4L6 8L10 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';
