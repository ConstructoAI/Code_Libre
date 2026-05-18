/**
 * SEAOP React Frontend - Pagination Component
 * Page navigation with numbered buttons and ellipsis for large ranges.
 * Mobile-optimized: shows compact prev/next with page indicator on small screens.
 */

import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Build an array of page numbers / ellipsis markers to display. */
function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | 'ellipsis')[] = [1];

  if (current > 3) {
    pages.push('ellipsis');
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push('ellipsis');
  }

  pages.push(total);

  return pages;
}

function Pagination({ page, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const pages = getPageNumbers(page, totalPages);

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Pagination">
      {/* Previous */}
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={clsx(
          'inline-flex items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] text-sm transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500',
          page <= 1
            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
        )}
        aria-label="Page précédente"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* Mobile: compact page indicator */}
      <span className="sm:hidden text-sm font-medium text-gray-700 dark:text-gray-300 px-2 min-w-[60px] text-center">
        {page} / {totalPages}
      </span>

      {/* Desktop: Page numbers */}
      <div className="hidden sm:flex items-center gap-1">
        {pages.map((p, idx) => {
          if (p === 'ellipsis') {
            return (
              <span
                key={`ellipsis-${idx}`}
                className="px-2 text-sm text-gray-400 dark:text-gray-500 select-none"
                aria-hidden="true"
              >
                ...
              </span>
            );
          }

          const isActive = p === page;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className={clsx(
                'inline-flex items-center justify-center rounded-lg min-w-[36px] h-9 px-3 text-sm font-medium transition-colors duration-150',
                'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500',
                isActive
                  ? 'bg-seaop-primary-600 text-white dark:bg-seaop-primary-500'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              {p}
            </button>
          );
        })}
      </div>

      {/* Next */}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={clsx(
          'inline-flex items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] text-sm transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500',
          page >= totalPages
            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
        )}
        aria-label="Page suivante"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </nav>
  );
}

Pagination.displayName = 'Pagination';

export { Pagination };
export type { Props as PaginationProps };
