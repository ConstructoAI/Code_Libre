import { useState, useEffect, useRef, useCallback } from 'react';

const COL_MIN_WIDTH = 40;
const COL_PADDING = 24; // px padding inside cells (px-4 = 16px * 2 sides ≈ 24 with gap)

/**
 * Hook for resizable table columns.
 * Returns colWidths state, a startResize handler for drag, and autoFit for double-click.
 */
export function useColumnResize(defaults: Record<string, number>) {
  const [colWidths, setColWidths] = useState<Record<string, number>>(defaults);
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const r = dragRef.current;
      if (!r) return;
      const delta = e.clientX - r.startX;
      setColWidths(prev => ({ ...prev, [r.key]: Math.max(COL_MIN_WIDTH, r.startW + delta) }));
    }
    function onMouseUp() {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = useCallback((e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { key, startX: e.clientX, startW: colWidths[key] ?? 100 };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths]);

  /**
   * Auto-fit column width to content on double-click.
   * Finds the <th> from the event, determines column index,
   * then measures all <td> cells in that column.
   */
  const autoFit = useCallback((e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    e.preventDefault();
    const th = (e.target as HTMLElement).closest('th');
    if (!th) return;
    const table = th.closest('table');
    if (!table) return;

    // Find column index
    const headerRow = th.parentElement;
    if (!headerRow) return;
    const ths = Array.from(headerRow.querySelectorAll('th'));
    const colIndex = ths.indexOf(th);
    if (colIndex < 0) return;

    // Measure header text width
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let maxWidth = COL_MIN_WIDTH;

    // Measure header content
    const headerText = th.textContent || '';
    const headerStyle = window.getComputedStyle(th);
    ctx.font = `${headerStyle.fontWeight} ${headerStyle.fontSize} ${headerStyle.fontFamily}`;
    maxWidth = Math.max(maxWidth, ctx.measureText(headerText).width + COL_PADDING + 16); // +16 for sort icon

    // Measure all body cells in this column
    const tbody = table.querySelector('tbody');
    if (tbody) {
      const rows = tbody.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const cell = cells[colIndex];
        if (!cell) return;
        const cellText = cell.textContent || '';
        const cellStyle = window.getComputedStyle(cell);
        ctx.font = `${cellStyle.fontWeight || '400'} ${cellStyle.fontSize} ${cellStyle.fontFamily}`;
        maxWidth = Math.max(maxWidth, ctx.measureText(cellText).width + COL_PADDING);
      });
    }

    // Clamp to reasonable bounds
    maxWidth = Math.min(600, Math.max(COL_MIN_WIDTH, Math.ceil(maxWidth)));
    setColWidths(prev => ({ ...prev, [key]: maxWidth }));
  }, []);

  return { colWidths, startResize, autoFit };
}
