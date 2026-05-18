import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional error message shown below the input. */
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, ...props }, ref) => {
    const base =
      'h-9 w-full rounded-lg border bg-slate-50 dark:bg-neutral-800 px-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-neutral-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-50';
    const borderClass = error
      ? 'border-red-500'
      : 'border-slate-200 dark:border-neutral-700 hover:border-slate-400 dark:hover:border-neutral-500';

    return (
      <div className="flex flex-col gap-1">
        <input
          ref={ref}
          className={`${base} ${borderClass} ${className}`}
          {...props}
        />
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
