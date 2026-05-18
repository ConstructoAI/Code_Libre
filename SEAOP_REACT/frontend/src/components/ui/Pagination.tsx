/**
 * SEAOP React Frontend - Pagination Component
 * Page navigation with numbered buttons and ellipsis for large ranges.
 */

import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Build an array of page numbers / ellipsis markers to display. */
function getPageNumbers(
  current: number,
  total: number,
  compact = false,
): (number | 'ellipsis')[] {
  const maxVisible = compact ? 5 : 7;
  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | 'ellipsis')[] = [1];
  const window = compact ? 0 : 1;

  if (current > 2 + window) {
    pages.push('ellipsis');
  }

  const start = Math.max(2, current - window);
  const end = Math.min(total - 1, current + window);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 1 - window) {
    pages.push('ellipsis');
  }

  pages.push(total);

  return pages;
}

function Pagination({ page, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const desktopPages = getPageNumbers(page, totalPages, false);
  const mobilePages = getPageNumbers(page, totalPages, true);

  const renderPageButton = (p: number | 'ellipsis', idx: number) => {
    if (p === 'ellipsis') {
      return (
        <span
          key={`ellipsis-${idx}`}
          className="px-1 sm:px-2 text-sm text-gray-400 dark:text-gray-500 select-none"
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
          'inline-flex items-center justify-center rounded-lg min-w-[44px] h-11 sm:min-w-[36px] sm:h-9 px-2 sm:px-3 text-sm font-medium transition-colors duration-150',
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
  };

  const navButtonClass = (dimmed: boolean) =>
    clsx(
      'inline-flex items-center justify-center rounded-lg min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] p-2 text-sm transition-colors duration-150',
      'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500',
      dimmed
        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
    );

  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-1"
      aria-label="Pagination"
    >
      {/* Previous */}
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={navButtonClass(page <= 1)}
        aria-label="Page précédente"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Page numbers — mobile (< sm) */}
      <div className="flex items-center gap-1 sm:hidden">
        {mobilePages.map(renderPageButton)}
      </div>

      {/* Page numbers — desktop (sm+) */}
      <div className="hidden sm:flex items-center gap-1">
        {desktopPages.map(renderPageButton)}
      </div>

      {/* Next */}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={navButtonClass(page >= totalPages)}
        aria-label="Page suivante"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

Pagination.displayName = 'Pagination';

export { Pagination };
export type { Props as PaginationProps };
