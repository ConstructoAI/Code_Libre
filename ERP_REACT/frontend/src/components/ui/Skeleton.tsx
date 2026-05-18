/**
 * D365-style Skeleton loader — placeholder animation during loading.
 */

import clsx from 'clsx';

interface SkeletonProps {
  className?: string;
  /** Width (Tailwind class or inline) */
  width?: string;
  /** Height (Tailwind class or inline) */
  height?: string;
  /** Shape variant */
  variant?: 'text' | 'rectangular' | 'circular';
}

export function Skeleton({ className, width, height, variant = 'text' }: SkeletonProps) {
  return (
    <div
      className={clsx(
        'animate-pulse bg-[#edebe9] dark:bg-[#3b3a39]',
        variant === 'text' && 'rounded h-4',
        variant === 'rectangular' && 'rounded',
        variant === 'circular' && 'rounded-full',
        width,
        height,
        className,
      )}
      style={{
        width: width && !width.startsWith('w-') ? width : undefined,
        height: height && !height.startsWith('h-') ? height : undefined,
      }}
    />
  );
}

/** Skeleton for a StatCard KPI */
export function SkeletonStatCard() {
  return (
    <div className="erp-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          <Skeleton width="w-24" height="h-3" />
          <Skeleton width="w-16" height="h-7" />
          <Skeleton width="w-20" height="h-3" />
        </div>
        <Skeleton variant="rectangular" width="w-10" height="h-10" />
      </div>
    </div>
  );
}

/** Skeleton for a table row */
export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton width={i === 0 ? 'w-32' : 'w-20'} />
        </td>
      ))}
    </tr>
  );
}

/** Skeleton for a full table */
export function SkeletonTable({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="erp-card overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 bg-[#faf9f8] dark:bg-[#292827] border-b border-[#edebe9] dark:border-[#3b3a39]">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} width={i === 0 ? 'w-28' : 'w-16'} height="h-3" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-[#f3f2f1] dark:divide-[#3b3a39]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3">
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton key={j} width={j === 0 ? 'w-32' : 'w-20'} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for a full page (KPI cards + table) */
export function SkeletonPage() {
  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
        <SkeletonStatCard />
      </div>
      {/* Command bar */}
      <Skeleton variant="rectangular" height="h-10" className="w-full" />
      {/* Table */}
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}
