import React from 'react';
import clsx from 'clsx';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, id, ...rest }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className={clsx(
              'block text-sm font-medium mb-1.5',
              'text-[#323130] dark:text-[#f3f2f1]',
            )}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            'block w-full rounded border px-3 py-2 text-base sm:text-sm transition-colors duration-150',
            'bg-white dark:bg-[#1b1a19]',
            'text-[#323130] dark:text-[#f3f2f1]',
            'placeholder:text-[#a19f9d] dark:placeholder:text-[#605e5c]',
            'focus:outline-none focus:ring-1 focus:ring-offset-0',
            error
              ? 'border-red-500 focus:ring-red-500 dark:border-red-400'
              : 'border-[#8a8886] dark:border-[#605e5c] focus:ring-[#0078D4] focus:border-[#0078D4] dark:focus:ring-[#6cb8f6] dark:focus:border-[#6cb8f6]',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-[#f3f2f1] dark:disabled:bg-[#1b1a19]',
            className,
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            error
              ? `${inputId}-error`
              : helperText
                ? `${inputId}-helper`
                : undefined
          }
          {...rest}
        />
        {error && (
          <p
            id={`${inputId}-error`}
            className="mt-1.5 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
        {!error && helperText && (
          <p
            id={`${inputId}-helper`}
            className="mt-1.5 text-sm text-[#605e5c] dark:text-[#a19f9d]"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

export { Input };
export type { InputProps };
