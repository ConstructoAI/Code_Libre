import React, { useState, useRef, useEffect } from 'react';

const PRESET_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#a855f7', // purple
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  /** Additional class names for the trigger button. */
  className?: string;
  /** Compact mode: tiny swatch trigger (for inline use in layer/product lists). */
  compact?: boolean;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  className = '',
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Draft local pour le hex text input — permet la frappe libre (#1a, #1a2)
  // sans bloquer le re-rendu via la prop `value` controlée.
  const [hexDraft, setHexDraft] = useState(value);

  // Sync draft when external value changes (ex: preset click, native picker)
  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={
          compact
            ? 'h-3 w-3 rounded-sm flex-shrink-0 transition-transform hover:scale-125'
            : 'flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-neutral-700 transition-colors hover:border-slate-400 dark:hover:border-neutral-500'
        }
        style={compact ? { backgroundColor: value } : undefined}
        aria-label="Choisir une couleur"
      >
        {!compact && (
          <span
            className="h-5 w-5 rounded-md"
            style={{ backgroundColor: value }}
          />
        )}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2 shadow-xl">
          <div className="grid grid-cols-4 gap-1">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                className={`h-7 w-7 rounded-md border-2 transition-transform hover:scale-110 ${
                  color === value
                    ? 'border-slate-900 dark:border-white'
                    : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
                aria-label={color}
              />
            ))}
          </div>

          {/* Custom color input */}
          <div className="mt-2 flex items-center gap-1.5 border-t border-slate-200 dark:border-neutral-700 pt-2">
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <input
              type="text"
              value={hexDraft}
              onChange={(e) => {
                const v = e.target.value;
                // Toujours mettre a jour le draft local (frappe libre)
                setHexDraft(v);
                // Propager au parent uniquement les formats hex complets
                // (#abc ou #aabbcc) pour eviter les warnings React sur
                // <input type="color"> ci-dessus.
                if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                  onChange(v);
                }
              }}
              onBlur={() => {
                // Reset au value parent si l'utilisateur quitte avec un hex invalide
                if (!/^#[0-9a-fA-F]{6}$/.test(hexDraft)) {
                  setHexDraft(value);
                }
              }}
              className="h-7 w-20 rounded border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800 px-2 text-xs text-slate-900 dark:text-white"
              maxLength={7}
            />
          </div>
        </div>
      )}
    </div>
  );
};
