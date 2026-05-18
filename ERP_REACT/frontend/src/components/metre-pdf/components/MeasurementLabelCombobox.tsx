import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BomSuggestionGroup } from '../utils/bomInputSuggestions';

/**
 * Combobox for the measurement Etiquette field.
 *
 * Provides a typeahead text input with a grouped dropdown of canonical BOM
 * input names. The user can either pick a suggestion from the dropdown or
 * type any free-form label.
 *
 * Filtering: starts-with on the input name (case-insensitive). Sheet
 * groups whose inputs are all filtered out are hidden.
 *
 * Keyboard:
 *   ArrowDown  -- open dropdown / focus next item (wraps)
 *   ArrowUp    -- focus previous item (wraps)
 *   Enter      -- pick highlighted item
 *   Escape     -- close dropdown without changing value
 *   Home / End -- first / last item
 *
 * ARIA combobox pattern (WAI-ARIA 1.2): role=combobox on input,
 * aria-expanded, aria-controls, aria-autocomplete=list,
 * aria-activedescendant pointing at the highlighted option.
 *
 * Free-form input is preserved -- the user can label measurements with
 * custom names not declared in any BOM schema.
 */

interface Props {
  value: string;
  onChange: (next: string) => void;
  groups: BomSuggestionGroup[];
  placeholder?: string;
  className?: string;
}

interface FlatItem {
  index: number;
  name: string;
  unit: string;
  description: string;
  groupSheet: string;
  /** Index of the first item in the group -- so we can render the sheet header before */
  isFirstInGroup: boolean;
}

const LISTBOX_ID = 'mlc-listbox';
const ITEM_ID_PREFIX = 'mlc-opt-';

export default function MeasurementLabelCombobox({
  value,
  onChange,
  groups,
  placeholder,
  className,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Filter groups by starts-with on input name (case-insensitive).
  const filteredGroups = useMemo<BomSuggestionGroup[]>(() => {
    const query = (value ?? '').trim().toLowerCase();
    if (!query) return groups;
    const out: BomSuggestionGroup[] = [];
    for (const g of groups) {
      const matched = g.inputs.filter((i) => i.name.toLowerCase().startsWith(query));
      if (matched.length > 0) out.push({ sheet: g.sheet, inputs: matched });
    }
    return out;
  }, [groups, value]);

  // Flatten the filtered groups into a single list for keyboard navigation.
  // The flat index maps 1:1 to the visual order of options in the dropdown.
  const flatItems = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    let idx = 0;
    for (const g of filteredGroups) {
      g.inputs.forEach((i, ii) => {
        out.push({
          index: idx,
          name: i.name,
          unit: i.unit,
          description: i.description,
          groupSheet: g.sheet,
          isFirstInGroup: ii === 0,
        });
        idx++;
      });
    }
    return out;
  }, [filteredGroups]);

  // Reset active index when the filtered list changes (defensive).
  useEffect(() => {
    if (activeIndex >= flatItems.length) {
      setActiveIndex(flatItems.length > 0 ? 0 : -1);
    }
  }, [flatItems, activeIndex]);

  // Scroll the active item into view when it changes via keyboard.
  useEffect(() => {
    if (!isOpen || activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `#${ITEM_ID_PREFIX}${activeIndex}`,
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const handleSelect = useCallback(
    (name: string) => {
      onChange(name);
      setIsOpen(false);
      setActiveIndex(-1);
      // Keep the input focused so the user can keep typing if they want
      // to switch to a different suggestion. Some patterns blur here --
      // we prefer to leave focus for power users.
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setActiveIndex(flatItems.length > 0 ? 0 : -1);
            return;
          }
          if (flatItems.length === 0) return;
          setActiveIndex((prev) => {
            const next = prev < 0 ? 0 : (prev + 1) % flatItems.length;
            return next;
          });
          return;
        case 'ArrowUp':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setActiveIndex(flatItems.length - 1);
            return;
          }
          if (flatItems.length === 0) return;
          setActiveIndex((prev) =>
            prev <= 0 ? flatItems.length - 1 : prev - 1,
          );
          return;
        case 'Enter':
          if (isOpen && activeIndex >= 0 && activeIndex < flatItems.length) {
            e.preventDefault();
            handleSelect(flatItems[activeIndex].name);
          }
          return;
        case 'Escape':
          if (isOpen) {
            e.preventDefault();
            setIsOpen(false);
            setActiveIndex(-1);
          }
          return;
        case 'Home':
          if (isOpen && flatItems.length > 0) {
            e.preventDefault();
            setActiveIndex(0);
          }
          return;
        case 'End':
          if (isOpen && flatItems.length > 0) {
            e.preventDefault();
            setActiveIndex(flatItems.length - 1);
          }
          return;
        default:
          return;
      }
    },
    [isOpen, flatItems, activeIndex, handleSelect],
  );

  const activeOptionId =
    activeIndex >= 0 && activeIndex < flatItems.length
      ? `${ITEM_ID_PREFIX}${activeIndex}`
      : undefined;

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        className="input-field mt-1 w-full pr-7"
        value={value}
        placeholder={placeholder ?? 'Nom de la mesure...'}
        onChange={(e) => {
          onChange(e.target.value);
          if (!isOpen) setIsOpen(true);
          // Reset active to first match on each keystroke so Enter picks
          // the most relevant suggestion.
          setActiveIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-label="Etiquette de la mesure"
      />
      {/* Chevron indicates there's a dropdown — critical for discoverability
          (without it, users don't know they can click to see suggestions).
          Click toggles open/close, and routes focus back to input so keyboard
          nav still works. */}
      <button
        type="button"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-metre-muted hover:text-metre-text p-0.5"
        onClick={(e) => {
          e.preventDefault();
          setIsOpen((o) => !o);
          inputRef.current?.focus();
        }}
        title={isOpen ? 'Fermer la liste' : 'Voir les variables BOM disponibles'}
        aria-label={isOpen ? 'Fermer la liste des suggestions' : 'Ouvrir la liste des suggestions'}
        tabIndex={-1}
      >
        <ChevronDown
          size={14}
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && filteredGroups.length > 0 && (
        <div
          ref={listRef}
          id={LISTBOX_ID}
          role="listbox"
          className="absolute z-50 mt-1 left-0 right-0 bg-metre-surface border border-metre-border rounded-md shadow-lg max-h-80 overflow-y-auto"
        >
          {flatItems.map((item) => (
            <div key={`${item.groupSheet}::${item.name}`}>
              {item.isFirstInGroup && (
                <div
                  className="sticky top-0 bg-metre-panel px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-metre-muted border-b border-metre-border"
                  aria-hidden="true"
                >
                  {item.groupSheet}
                </div>
              )}
              <button
                id={`${ITEM_ID_PREFIX}${item.index}`}
                type="button"
                role="option"
                aria-selected={item.index === activeIndex}
                className={`w-full text-left px-2 py-1.5 border-b border-metre-border last:border-b-0 text-xs ${
                  item.index === activeIndex ? 'bg-metre-panel' : 'hover:bg-metre-panel'
                }`}
                onMouseEnter={() => setActiveIndex(item.index)}
                onClick={() => handleSelect(item.name)}
                title={item.description}
              >
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-mono text-metre-text">{item.name}</span>
                  {item.unit && (
                    <span className="text-[10px] text-metre-muted">
                      {' -- ' + item.unit + ' -- '}
                    </span>
                  )}
                  <span className="text-[10px] text-metre-muted truncate">
                    {item.description}
                  </span>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
