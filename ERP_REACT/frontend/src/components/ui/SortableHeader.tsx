import type { ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { SortConfig } from '@/hooks/useSortable';

interface SortableHeaderProps {
  label?: string;
  children?: ReactNode;
  sortKey: string;
  sortConfig: SortConfig;
  onSort: (key: string) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
  /** Column width in px (optional — enables resizing visuals) */
  width?: number;
  /** Called on mousedown of the resize handle */
  onResizeStart?: (e: React.MouseEvent) => void;
  /** Called on double-click of the resize handle — auto-fit column */
  onAutoFit?: (e: React.MouseEvent) => void;
}

export function SortableHeader({ label, children, sortKey, sortConfig, onSort, className = '', align, width, onResizeStart, onAutoFit }: SortableHeaderProps) {
  const isActive = sortConfig.key === sortKey && sortConfig.direction !== null;
  const direction = isActive ? sortConfig.direction : null;
  const text = label || children;

  return (
    <th
      className={`relative cursor-pointer select-none group hover:bg-[#edebe9] dark:hover:bg-[#3b3a39] px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${className}`}
      style={width ? { width, minWidth: 40 } : undefined}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {text}
        <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
          {direction === 'asc' ? (
            <ArrowUp size={12} className="text-[#0078D4]" />
          ) : direction === 'desc' ? (
            <ArrowDown size={12} className="text-[#0078D4]" />
          ) : (
            <ArrowUpDown size={12} className="text-[#a19f9d]" />
          )}
        </span>
      </span>
      {onResizeStart && (
        <div
          className="absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize hover:bg-blue-300 z-10"
          onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e); }}
          onDoubleClick={(e) => { e.stopPropagation(); onAutoFit?.(e); }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </th>
  );
}
