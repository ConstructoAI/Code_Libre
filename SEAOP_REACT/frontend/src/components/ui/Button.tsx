import React from 'react';
import clsx from 'clsx';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[#0078D4] text-white hover:bg-[#005ea2] focus-visible:bg-[#005ea2] active:bg-[#004578] dark:bg-[#2b88d8] dark:hover:bg-[#6cb8f6] dark:focus-visible:bg-[#6cb8f6]',
  secondary:
    'bg-white text-[#323130] border border-[#8a8886] hover:bg-[#f3f2f1] focus-visible:bg-[#f3f2f1] active:bg-[#edebe9] dark:bg-[#323130] dark:text-[#f3f2f1] dark:border-[#605e5c] dark:hover:bg-[#3b3a39] dark:focus-visible:bg-[#3b3a39]',
  accent:
    'bg-[#f97316] text-white hover:bg-[#fb923c] focus-visible:bg-[#fb923c] active:bg-[#ea580c]',
  ghost:
    'bg-transparent text-[#323130] hover:bg-[#f3f2f1] focus-visible:bg-[#f3f2f1] active:bg-[#edebe9] dark:text-[#c8c6c4] dark:hover:bg-[#323130] dark:focus-visible:bg-[#323130] dark:hover:text-[#f3f2f1] dark:focus-visible:text-[#f3f2f1]',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:bg-red-700 active:bg-red-800 dark:bg-red-500 dark:hover:bg-red-600 dark:focus-visible:bg-red-600',
  outline:
    'bg-transparent text-[#323130] border border-[#d2d0ce] hover:bg-[#f3f2f1] focus-visible:bg-[#f3f2f1] dark:text-[#c8c6c4] dark:border-[#484644] dark:hover:bg-[#323130] dark:focus-visible:bg-[#323130]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5 min-h-[44px] sm:min-h-[36px]',
  md: 'px-4 py-2 text-base gap-2 min-h-[44px] sm:min-h-[40px]',
  lg: 'px-6 py-3 text-lg gap-2.5 min-h-[52px] sm:min-h-[44px]',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      className,
      disabled,
      children,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={clsx(
          'inline-flex items-center justify-center font-semibold rounded transition-all duration-150',
          'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0078D4] dark:focus:ring-[#6cb8f6] dark:focus:ring-offset-[#1b1a19]',
          variantStyles[variant],
          sizeStyles[size],
          isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          className,
        )}
        {...rest}
      >
        {isLoading ? (
          <Spinner
            size={size === 'lg' ? 'md' : 'sm'}
            className="text-current"
          />
        ) : (
          leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
        )}
        {children}
        {!isLoading && rightIcon && (
          <span className="inline-flex shrink-0">{rightIcon}</span>
        )}
      </button>
    );
  },
);

Button.displayName = 'Button';

export { Button };
export type { ButtonProps, ButtonVariant, ButtonSize };
