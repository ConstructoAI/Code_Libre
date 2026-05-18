import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[#0078D4] text-white hover:bg-[#005ea2] active:bg-blue-700 disabled:bg-[#0078D4]/50',
  secondary:
    'bg-slate-200 dark:bg-neutral-700 text-slate-800 dark:text-neutral-100 hover:bg-slate-200 dark:hover:bg-neutral-700 active:bg-slate-200 dark:active:bg-neutral-700 disabled:bg-slate-200/50 dark:disabled:bg-neutral-700/50',
  ghost:
    'bg-transparent text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-900 dark:hover:text-white active:bg-slate-100 dark:active:bg-neutral-800 disabled:text-slate-400 dark:disabled:text-neutral-600',
  icon:
    'bg-transparent text-slate-500 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-900 dark:hover:text-white active:bg-slate-100 dark:active:bg-neutral-800 p-0 disabled:text-slate-400 dark:disabled:text-neutral-600',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900 disabled:pointer-events-none';

    return (
      <button
        ref={ref}
        className={`${base} ${variantClasses[variant]} ${variant !== 'icon' ? sizeClasses[size] : `h-9 w-9`} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
