/**
 * D365-style Command Bar
 * Horizontal toolbar above tables/lists with action buttons.
 */

import clsx from 'clsx';

export interface CommandBarAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'default' | 'danger';
  disabled?: boolean;
  hidden?: boolean;
}

interface CommandBarProps {
  actions: CommandBarAction[];
  /** Optional right-side content (search, filters, etc.) */
  right?: React.ReactNode;
  className?: string;
}

export function CommandBar({ actions, right, className }: CommandBarProps) {
  const visibleActions = actions.filter(a => !a.hidden);

  return (
    <div className={clsx(
      'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2',
      'bg-[#f3f2f1] dark:bg-[#292827] border border-[#d2d0ce] dark:border-[#484644] rounded shadow-sm',
      className,
    )}>
      {/* Left: action buttons — always visible, scrollable on mobile */}
      <div className="flex items-center gap-0.5 overflow-x-auto shrink-0 -mx-1 px-1 scrollbar-hide">
        {visibleActions.map((action, i) => (
          <button
            key={i}
            onClick={action.onClick}
            disabled={action.disabled}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-[13px] font-semibold rounded-sm transition-colors whitespace-nowrap min-h-[40px]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              action.variant === 'primary' && 'bg-[#0078D4] text-white hover:bg-[#005ea2] active:bg-[#004578]',
              action.variant === 'danger' && 'text-[#a4262c] hover:bg-[#fde7e9] dark:text-[#f87171] dark:hover:bg-red-900/20',
              (!action.variant || action.variant === 'default') && 'text-[#323130] dark:text-[#c8c6c4] hover:bg-[#edebe9] dark:hover:bg-[#3b3a39]',
              i > 0 && visibleActions[i - 1]?.variant !== action.variant && 'ml-1 pl-2.5 sm:pl-3 border-l border-[#edebe9] dark:border-[#3b3a39]',
            )}
          >
            {action.icon && <span className="shrink-0">{action.icon}</span>}
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {/* Right: search, filters — wraps below on mobile */}
      {right && (
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {right}
        </div>
      )}
    </div>
  );
}
