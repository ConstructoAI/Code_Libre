/**
 * LayerManager - Gestion Des Calques
 *
 * Composant generique d'activation/desactivation de calques visuels pour
 * l'editeur de plans Wall Builder Pro. Permet de basculer la visibilite
 * des elements de construction (Solives De Plancher, Bardeaux De Toiture,
 * Revetement Mural, Grille De Sol, etc.) dans 5 categories :
 *   Planchers / Murs / Toitures / Revetement / Environnement
 *
 * Interface generique : ne connait PAS les types exacts des panneaux
 * parametriques (Phase 12 Plancher, Phase 13 Mur, Phase 14 Toiture, etc.).
 * Le consommateur fournit son propre etat via la prop `categories` et
 * recoit les changements via les callbacks `onToggle` / `onToggleSub`.
 *
 * 3 variants supportes :
 *   - modal     : bottom-sheet mobile / modal centre desktop (defaut)
 *   - inline    : tabs + contenu integre, sans modal ni header
 *   - sidebar   : tabs verticales a gauche, contenu a droite (desktop wide)
 *
 * Style : orange ambre actif (#f59e0b), pastel orange items (#fff7ed),
 * texte (#1e293b), border-radius genereux, animations 200ms.
 *
 * Accessibilite : role="dialog" aria-modal, role="tab" / "tabpanel",
 * keyboard nav (Tab / Shift+Tab / Espace pour toggle, Echap pour fermer).
 *
 * Pas d'emoji. Pas d'em dash. TypeScript strict. Francais Quebec.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Sliders,
  X,
  Layers,
  Home,
  Wrench,
  Triangle,
  PaintBucket,
  Grid3x3,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export type LayerCategoryId =
  | 'planchers'
  | 'murs'
  | 'toitures'
  | 'revetement'
  | 'environnement';

export interface LayerSubItem {
  id: string;
  label: string;
  visible: boolean;
}

export interface LayerItem {
  id: string;
  label: string;
  icon?: ReactNode;
  visible: boolean;
  color?: string;
  subItems?: LayerSubItem[];
}

export interface LayerCategory {
  id: LayerCategoryId;
  label: string;
  icon?: ReactNode;
  items: LayerItem[];
}

export type LayerVariant = 'modal' | 'inline' | 'sidebar';

export interface LayerManagerProps {
  categories: LayerCategory[];
  onToggle: (
    categoryId: LayerCategoryId,
    itemId: string,
    visible: boolean
  ) => void;
  onToggleSub?: (
    categoryId: LayerCategoryId,
    itemId: string,
    subItemId: string,
    visible: boolean
  ) => void;
  initialTab?: LayerCategoryId;
  className?: string;
  variant?: LayerVariant;
  isOpen?: boolean;
  onClose?: () => void;
  title?: string;
}

// ---------------------------------------------------------------------------
// Constantes exportees : configuration par defaut
// ---------------------------------------------------------------------------

export const DEFAULT_LAYER_CATEGORIES: LayerCategory[] = [
  {
    id: 'planchers',
    label: 'Planchers',
    items: [
      {
        id: 'solives',
        label: 'Solives De Plancher',
        visible: true,
        color: '#92400e',
      },
      {
        id: 'sous-plancher',
        label: 'Sous-plancher',
        visible: true,
        color: '#a16207',
      },
      {
        id: 'blocking',
        label: 'Entretoises',
        visible: false,
        color: '#78716c',
      },
    ],
  },
  {
    id: 'murs',
    label: 'Murs',
    items: [
      {
        id: 'show-walls',
        label: 'Afficher Les Murs',
        visible: true,
        color: '#1e293b',
      },
      {
        id: 'sheathing',
        label: 'Revetement Mural',
        visible: true,
        color: '#f59e0b',
      },
      {
        id: 'labels',
        label: 'Etiquettes De Mur',
        visible: true,
      },
    ],
  },
  {
    id: 'toitures',
    label: 'Toitures',
    items: [
      {
        id: 'show-roofs',
        label: 'Afficher Les Toitures',
        visible: true,
        color: '#7f1d1d',
      },
      {
        id: 'shingles',
        label: 'Bardeaux De Toiture',
        visible: true,
        color: '#1f2937',
      },
      {
        id: 'sheathing-roof',
        label: 'Voligeage De Toit',
        visible: false,
        color: '#a16207',
      },
      {
        id: 'rafters-edge',
        label: 'Chevrons De Rive',
        visible: true,
        color: '#78350f',
      },
      {
        id: 'rafters-common',
        label: 'Chevrons Communs',
        visible: true,
        color: '#92400e',
      },
    ],
  },
  {
    id: 'revetement',
    label: 'Revetement',
    items: [
      {
        id: 'finition',
        label: 'Finition',
        visible: true,
        color: '#84cc16',
      },
      {
        id: 'revetement-cladding',
        label: 'Revetement',
        visible: true,
        color: '#65a30d',
      },
      {
        id: 'soffite',
        label: 'Soffite',
        visible: true,
        color: '#a3e635',
      },
    ],
  },
  {
    id: 'environnement',
    label: 'Environnement',
    items: [
      {
        id: 'grid',
        label: 'Grille De Sol',
        visible: true,
        color: '#d1d5db',
      },
      {
        id: 'ombres',
        label: 'Ombres',
        visible: false,
      },
    ],
  },
];

// Icones par defaut associees a chaque categorie
const DEFAULT_CATEGORY_ICONS: Record<LayerCategoryId, ReactNode> = {
  planchers: <Home size={16} />,
  murs: <Wrench size={16} />,
  toitures: <Triangle size={16} />,
  revetement: <PaintBucket size={16} />,
  environnement: <Grid3x3 size={16} />,
};

// ---------------------------------------------------------------------------
// Helpers utilitaires exportes
// ---------------------------------------------------------------------------

/**
 * Recupere la visibilite d'un item dans une liste de categories.
 * Retourne false si la categorie ou l'item n'existe pas.
 */
export function getLayerVisibility(
  categories: LayerCategory[],
  categoryId: LayerCategoryId,
  itemId: string
): boolean {
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return false;
  const item = cat.items.find((i) => i.id === itemId);
  return item?.visible ?? false;
}

/**
 * Retourne un nouveau tableau de categories avec un item modifie.
 * Immuable : ne mute pas l'entree.
 */
export function updateLayerVisibility(
  categories: LayerCategory[],
  categoryId: LayerCategoryId,
  itemId: string,
  visible: boolean
): LayerCategory[] {
  return categories.map((cat) =>
    cat.id === categoryId
      ? {
          ...cat,
          items: cat.items.map((it) =>
            it.id === itemId ? { ...it, visible } : it
          ),
        }
      : cat
  );
}

/**
 * Retourne un nouveau tableau de categories avec un sous-item modifie.
 */
export function updateLayerSubVisibility(
  categories: LayerCategory[],
  categoryId: LayerCategoryId,
  itemId: string,
  subItemId: string,
  visible: boolean
): LayerCategory[] {
  return categories.map((cat) => {
    if (cat.id !== categoryId) return cat;
    return {
      ...cat,
      items: cat.items.map((it) => {
        if (it.id !== itemId || !it.subItems) return it;
        return {
          ...it,
          subItems: it.subItems.map((sub) =>
            sub.id === subItemId ? { ...sub, visible } : sub
          ),
        };
      }),
    };
  });
}

/**
 * Bascule la visibilite (toggle) sans connaitre l'etat actuel.
 */
export function toggleLayerVisibility(
  categories: LayerCategory[],
  categoryId: LayerCategoryId,
  itemId: string
): LayerCategory[] {
  const current = getLayerVisibility(categories, categoryId, itemId);
  return updateLayerVisibility(categories, categoryId, itemId, !current);
}

/**
 * Compte le nombre de calques visibles dans une categorie.
 */
export function countVisibleLayers(
  categories: LayerCategory[],
  categoryId: LayerCategoryId
): number {
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return 0;
  return cat.items.filter((it) => it.visible).length;
}

// ---------------------------------------------------------------------------
// Composant Toggle Switch interne (style iOS)
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: ToggleSwitchProps): JSX.Element {
  const handleClick = useCallback(() => {
    if (disabled) return;
    onChange(!checked);
  }, [checked, disabled, onChange]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onChange(!checked);
      }
    },
    [checked, disabled, onChange]
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full',
        'transition-all duration-200 ease-in-out',
        'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2',
        checked ? 'bg-amber-500' : 'bg-slate-300',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md',
          'transition-transform duration-200 ease-in-out mt-0.5',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Composant Item ligne (avec sub-items expandables)
// ---------------------------------------------------------------------------

interface LayerItemRowProps {
  item: LayerItem;
  categoryId: LayerCategoryId;
  onToggle: LayerManagerProps['onToggle'];
  onToggleSub?: LayerManagerProps['onToggleSub'];
}

function LayerItemRow({
  item,
  categoryId,
  onToggle,
  onToggleSub,
}: LayerItemRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasSub = !!item.subItems && item.subItems.length > 0;

  const handleToggle = useCallback(
    (visible: boolean) => {
      onToggle(categoryId, item.id, visible);
    },
    [categoryId, item.id, onToggle]
  );

  const handleSubToggle = useCallback(
    (subId: string, visible: boolean) => {
      if (onToggleSub) {
        onToggleSub(categoryId, item.id, subId, visible);
      }
    },
    [categoryId, item.id, onToggleSub]
  );

  const handleExpand = useCallback(() => {
    if (hasSub) setExpanded((p) => !p);
  }, [hasSub]);

  return (
    <div className="w-full">
      <div
        className={[
          'flex items-center gap-3 px-4 py-3 rounded-xl',
          'bg-orange-50 border border-orange-100',
          'transition-all duration-200 hover:shadow-md hover:bg-orange-100',
        ].join(' ')}
        style={{ backgroundColor: '#fff7ed', borderColor: '#fed7aa' }}
      >
        {/* Bouton chevron pour expand si sous-items */}
        {hasSub ? (
          <button
            type="button"
            onClick={handleExpand}
            aria-label={expanded ? 'Replier' : 'Deplier'}
            aria-expanded={expanded}
            className="text-slate-500 hover:text-slate-800 transition-colors"
          >
            {expanded ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
        ) : (
          <span className="w-4" aria-hidden="true" />
        )}

        {/* Pastille couleur si fournie */}
        {item.color && (
          <span
            className="inline-block w-4 h-4 rounded-md border border-slate-300 shadow-sm shrink-0"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
        )}

        {/* Icone optionnelle de l'item */}
        {item.icon && (
          <span className="text-slate-700 shrink-0" aria-hidden="true">
            {item.icon}
          </span>
        )}

        {/* Label */}
        <span
          className="flex-1 text-sm font-medium text-slate-800 truncate"
          style={{ color: '#1e293b' }}
        >
          {item.label}
        </span>

        {/* Indicateur visuel oeil */}
        <span className="text-slate-500 shrink-0" aria-hidden="true">
          {item.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </span>

        {/* Toggle switch */}
        <ToggleSwitch
          checked={item.visible}
          onChange={handleToggle}
          ariaLabel={`Basculer la visibilite de ${item.label}`}
        />
      </div>

      {/* Sous-items */}
      {hasSub && expanded && item.subItems && (
        <div className="mt-2 ml-6 space-y-2">
          {item.subItems.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-slate-200"
            >
              <span
                className="flex-1 text-sm text-slate-700"
                style={{ color: '#334155' }}
              >
                {sub.label}
              </span>
              <ToggleSwitch
                checked={sub.visible}
                onChange={(v) => handleSubToggle(sub.id, v)}
                ariaLabel={`Basculer la visibilite de ${sub.label}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant Tabs (horizontale ou verticale)
// ---------------------------------------------------------------------------

interface LayerTabsProps {
  categories: LayerCategory[];
  activeTab: LayerCategoryId;
  onTabChange: (id: LayerCategoryId) => void;
  orientation: 'horizontal' | 'vertical';
}

function LayerTabs({
  categories,
  activeTab,
  onTabChange,
  orientation,
}: LayerTabsProps): JSX.Element {
  const isVertical = orientation === 'vertical';

  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      className={[
        isVertical
          ? 'flex flex-col gap-2 p-2 border-r border-slate-200 bg-slate-50 min-w-[160px]'
          : 'flex gap-2 overflow-x-auto px-4 py-3 border-b border-slate-200 bg-white scrollbar-thin',
      ].join(' ')}
    >
      {categories.map((cat) => {
        const isActive = cat.id === activeTab;
        const icon = cat.icon ?? DEFAULT_CATEGORY_ICONS[cat.id];
        const visibleCount = cat.items.filter((it) => it.visible).length;
        return (
          <button
            key={cat.id}
            type="button"
            role="tab"
            id={`layer-tab-${cat.id}`}
            aria-selected={isActive}
            aria-controls={`layer-tabpanel-${cat.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(cat.id)}
            className={[
              'flex items-center gap-2 whitespace-nowrap shrink-0',
              'px-4 py-2 rounded-xl border text-sm font-medium',
              'transition-all duration-200',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1',
              isActive
                ? 'bg-amber-500 text-white border-amber-500 shadow-md'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300',
              isVertical ? 'w-full justify-start' : '',
            ].join(' ')}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{cat.label}</span>
            <span
              className={[
                'ml-auto text-xs font-semibold rounded-full px-1.5 py-0.5 min-w-[20px] text-center',
                isActive
                  ? 'bg-white/30 text-white'
                  : 'bg-slate-100 text-slate-600',
              ].join(' ')}
              aria-label={`${visibleCount} calques visibles`}
            >
              {visibleCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant Panel (contenu d'une categorie)
// ---------------------------------------------------------------------------

interface LayerPanelProps {
  category: LayerCategory;
  onToggle: LayerManagerProps['onToggle'];
  onToggleSub?: LayerManagerProps['onToggleSub'];
}

function LayerPanel({
  category,
  onToggle,
  onToggleSub,
}: LayerPanelProps): JSX.Element {
  return (
    <div
      role="tabpanel"
      id={`layer-tabpanel-${category.id}`}
      aria-labelledby={`layer-tab-${category.id}`}
      className="flex flex-col gap-2 p-4 overflow-y-auto"
    >
      {category.items.length === 0 ? (
        <p className="text-sm text-slate-500 italic text-center py-8">
          Aucun calque dans cette categorie.
        </p>
      ) : (
        category.items.map((item) => (
          <LayerItemRow
            key={item.id}
            item={item}
            categoryId={category.id}
            onToggle={onToggle}
            onToggleSub={onToggleSub}
          />
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant principal LayerManager
// ---------------------------------------------------------------------------

export function LayerManager({
  categories,
  onToggle,
  onToggleSub,
  initialTab,
  className = '',
  variant = 'modal',
  isOpen = true,
  onClose,
  title = 'Gestion Des Calques',
}: LayerManagerProps): JSX.Element | null {
  // Tab actif : initialTab si fourni et valide, sinon premiere categorie
  const firstCategoryId = categories[0]?.id ?? 'planchers';
  const [activeTab, setActiveTab] = useState<LayerCategoryId>(() => {
    if (initialTab && categories.some((c) => c.id === initialTab)) {
      return initialTab;
    }
    return firstCategoryId;
  });

  // Si la categorie active disparait des `categories`, revenir a la premiere
  useEffect(() => {
    if (!categories.some((c) => c.id === activeTab)) {
      setActiveTab(firstCategoryId);
    }
  }, [categories, activeTab, firstCategoryId]);

  const activeCategory = useMemo(
    () => categories.find((c) => c.id === activeTab),
    [categories, activeTab]
  );

  // Gestion Echap pour fermer modal
  useEffect(() => {
    if (variant !== 'modal' || !isOpen || !onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [variant, isOpen, onClose]);

  // Verrouillage du scroll de l'arriere-plan lorsque la modal est ouverte
  useEffect(() => {
    if (variant !== 'modal' || !isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [variant, isOpen]);

  // ----- Gestion drag bottom (mobile, desktop tactile, stylet) pour fermer modal -----
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const dragOffset = useRef<number>(0);
  const dragPointerId = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY;
    dragOffset.current = 0;
    dragPointerId.current = e.pointerId;
    // Capture du pointeur pour continuer a recevoir les events meme hors de l'element
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    if (dragPointerId.current !== null && e.pointerId !== dragPointerId.current) return;
    const delta = e.clientY - dragStartY.current;
    if (delta > 0) {
      dragOffset.current = delta;
      setDragY(delta);
    }
  }, []);

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragPointerId.current !== null && e.pointerId !== dragPointerId.current) return;
      if (dragOffset.current > 120 && onClose) {
        onClose();
      }
      try {
        if (dragPointerId.current !== null) {
          e.currentTarget.releasePointerCapture(dragPointerId.current);
        }
      } catch {
        /* ignore */
      }
      dragStartY.current = null;
      dragOffset.current = 0;
      dragPointerId.current = null;
      setDragY(0);
    },
    [onClose],
  );

  // ----- Header (commun a variant modal) -----
  const renderHeader = (): JSX.Element => (
    <div
      className={[
        'flex items-center justify-between gap-3 px-5 py-4',
        'border-b border-slate-200 bg-white',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-amber-100 text-amber-700"
          aria-hidden="true"
        >
          <Sliders size={18} />
        </span>
        <h2
          className="text-base font-semibold text-slate-800"
          style={{ color: '#1e293b' }}
        >
          {title}
        </h2>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la gestion des calques"
          className={[
            'inline-flex items-center justify-center w-9 h-9 rounded-xl',
            'text-slate-500 hover:text-slate-800 hover:bg-slate-100',
            'transition-colors duration-200',
            'focus:outline-none focus:ring-2 focus:ring-amber-500',
          ].join(' ')}
        >
          <X size={18} />
        </button>
      )}
    </div>
  );

  // ----- Drag handle mobile (Pointer events : couvre touch + mouse + pen + cancel) -----
  const renderDragHandle = (): JSX.Element => (
    <div
      className="w-full flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      aria-hidden="true"
    >
      <div className="w-12 h-1.5 rounded-full bg-slate-300" />
    </div>
  );

  // ----- VARIANT inline -----
  if (variant === 'inline') {
    return (
      <div
        className={[
          'flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden',
          className,
        ].join(' ')}
      >
        <LayerTabs
          categories={categories}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          orientation="horizontal"
        />
        {activeCategory && (
          <LayerPanel
            category={activeCategory}
            onToggle={onToggle}
            onToggleSub={onToggleSub}
          />
        )}
      </div>
    );
  }

  // ----- VARIANT sidebar -----
  if (variant === 'sidebar') {
    return (
      <div
        className={[
          'flex bg-white rounded-2xl border border-slate-200 overflow-hidden',
          'min-h-[400px]',
          className,
        ].join(' ')}
      >
        <LayerTabs
          categories={categories}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          orientation="vertical"
        />
        <div className="flex-1 flex flex-col">
          <div className="px-5 py-3 border-b border-slate-200 bg-white">
            <h3
              className="text-sm font-semibold text-slate-700 flex items-center gap-2"
              style={{ color: '#334155' }}
            >
              <Layers size={16} />
              {activeCategory?.label ?? title}
            </h3>
          </div>
          {activeCategory && (
            <LayerPanel
              category={activeCategory}
              onToggle={onToggle}
              onToggleSub={onToggleSub}
            />
          )}
        </div>
      </div>
    );
  }

  // ----- VARIANT modal (defaut) -----
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="layer-manager-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet / Modal */}
      <div
        ref={sheetRef}
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragY > 0 ? 'none' : 'transform 250ms ease-out',
        }}
        className={[
          'relative w-full sm:w-[480px] max-w-[100vw]',
          'bg-white shadow-2xl',
          'rounded-t-2xl sm:rounded-2xl',
          'max-h-[85vh] sm:max-h-[80vh]',
          'flex flex-col overflow-hidden',
          'animate-layer-slide-up',
          className,
        ].join(' ')}
      >
        {/* Drag handle mobile uniquement */}
        <div className="sm:hidden">{renderDragHandle()}</div>

        {/* Header */}
        <div id="layer-manager-title" className="sr-only">
          {title}
        </div>
        {renderHeader()}

        {/* Tabs */}
        <LayerTabs
          categories={categories}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          orientation="horizontal"
        />

        {/* Panel */}
        <div className="flex-1 overflow-y-auto">
          {activeCategory && (
            <LayerPanel
              category={activeCategory}
              onToggle={onToggle}
              onToggleSub={onToggleSub}
            />
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex items-center justify-between">
          <span>
            {activeCategory
              ? `${activeCategory.items.filter((it) => it.visible).length}/${activeCategory.items.length} calques visibles`
              : ''}
          </span>
          <span className="hidden sm:inline">Appuyez sur Echap pour fermer</span>
        </div>
      </div>

      {/* Animation CSS injectee localement. @keyframes hors @media (CSS standard). */}
      <style>{`
        @keyframes layer-slide-up {
          from {
            transform: translateY(100%);
            opacity: 0.6;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes layer-slide-up-desktop {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .animate-layer-slide-up {
          animation: layer-slide-up 250ms ease-out;
        }
        @media (min-width: 640px) {
          .animate-layer-slide-up {
            animation: layer-slide-up-desktop 250ms ease-out;
          }
        }
      `}</style>
    </div>
  );
}

export default LayerManager;
