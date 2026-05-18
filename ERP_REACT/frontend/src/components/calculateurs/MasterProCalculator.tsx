/**
 * ERP React - Construction Master Pro Calculator (desktop adaptation)
 *
 * Adapte la calculatrice mobile (MOBILE_REACT/.../CalculatricePage.tsx) pour
 * l'integration dans le module Calculateurs du ERP desktop.
 *
 * Style preserve: pillules charcoal Master Pro, gradient subtil + biseau 3D,
 * shift labels italiques, LCD vert pale, fond transparent pour laisser
 * passer le fond gradient de l'app ERP.
 *
 * Diferences vs mobile :
 *   - Largeur max 720px centree (vs full width mobile)
 *   - Pas de Tabs/sheets en plein ecran -- les modals (Conv, Hist, FT/IN)
 *     restent ancrees dans le calculateur (z-50 mais relative au conteneur)
 *   - h-12 boutons OK pour desktop avec souris/trackpad
 *   - Logique calcReducer 100% identique (importee du meme utility)
 */

import { useReducer, useState, useEffect } from 'react';
import { Clock, Trash2, Ruler, Hash } from 'lucide-react';
import {
  createInitialCalcState,
  calcReducer,
  resolveAction,
  parseFeetInches,
  formatFeetInches,
  type CalcAction,
  type CalcState,
} from '@/utils/constructionCalculator';

export default function MasterProCalculator() {
  const [state, dispatch] = useReducer(calcReducer, undefined, createInitialCalcState);
  const [showUnits, setShowUnits] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showFtIn, setShowFtIn] = useState(false);

  const d = (a: CalcAction) => dispatch(a);
  const act = (a: CalcAction, shiftA?: CalcAction) =>
    dispatch(resolveAction(state, a, shiftA));

  // Keyboard support : 0-9, +-*/, Enter/=, Esc=ClearAll, Backspace=Clear,
  // f=Feet, i=Inch, y=Yds, c=Conv toggle, %, virgule = decimal.
  // Skip si focus dans input/textarea (modal saisie FT/IN) OU si une sheet
  // interne est ouverte (la sheet a son propre listener ESC qui doit fermer
  // la sheet -- pas declencher clearAll sur la calc en arriere-plan).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Si une sheet interne est ouverte, deleguer entierement le keyboard
      // a la sheet (qui gere ESC pour se fermer + Enter pour submit).
      if (showFtIn || showUnits || showHistory) return;
      const k = e.key;
      if (k >= '0' && k <= '9') {
        e.preventDefault();
        dispatch({ type: 'digit', digit: k });
        return;
      }
      switch (k) {
        case '.':
        case ',':
          e.preventDefault();
          dispatch({ type: 'decimal' });
          break;
        case '+':
          e.preventDefault();
          dispatch({ type: 'operation', op: '+' });
          break;
        case '-':
          e.preventDefault();
          dispatch({ type: 'operation', op: '-' });
          break;
        case '*':
        case 'x':
        case 'X':
          e.preventDefault();
          dispatch({ type: 'operation', op: '*' });
          break;
        case '/':
          e.preventDefault();
          if (state.dimMode && !state.newNumber && state.dimFracNum == null) {
            dispatch({ type: 'fractionSep' });
          } else {
            dispatch({ type: 'operation', op: '/' });
          }
          break;
        case 'Enter':
        case '=':
          e.preventDefault();
          dispatch({ type: 'equals' });
          break;
        case 'Backspace':
          e.preventDefault();
          dispatch({ type: 'clear' });
          break;
        case 'Escape':
          e.preventDefault();
          dispatch({ type: 'clearAll' });
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          dispatch({ type: 'applyFeet' });
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          dispatch({ type: 'applyInch' });
          break;
        case 'y':
        case 'Y':
          e.preventDefault();
          dispatch({ type: 'convertUnit', unit: 'yds' });
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          dispatch({ type: 'toggleShift' });
          break;
        case '%':
          e.preventDefault();
          dispatch({ type: 'percent' });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.dimMode, state.newNumber, state.dimFracNum, showFtIn, showUnits, showHistory]);

  const indicators: string[] = [];
  if (state.shiftMode) indicators.push('CONV');
  if (state.memory !== 0) indicators.push(`M=${state.memory}`);
  if (state.rise != null) indicators.push(`Rise=${state.rise}`);
  if (state.run != null) indicators.push(`Run=${state.run}`);
  if (state.pitch != null) indicators.push(`Pitch=${state.pitch}:12`);
  if (state.length != null) indicators.push(`L=${state.length}`);
  if (state.width != null) indicators.push(`W=${state.width}`);
  if (state.height != null) indicators.push(`H=${state.height}`);
  if (state.pendingFn) indicators.push(`[${state.pendingFn}…]`);

  const lr = state.lastResult;

  return (
    <div className="max-w-[720px] mx-auto px-3 py-4">
      {/* LCD Display */}
      <div className="rounded-2xl border border-stone-400/60 dark:border-zinc-700 bg-[#cfd6c2] dark:bg-[#3a4234] shadow-inner overflow-hidden mb-4 h-28 flex flex-col">
        {indicators.length > 0 && (
          <div className="px-3 pt-1.5 flex flex-wrap gap-1.5">
            {indicators.map((ind, i) => (
              <span
                key={i}
                className="text-[10px] font-mono italic text-stone-700/70 dark:text-stone-300/70"
              >
                {ind}
              </span>
            ))}
          </div>
        )}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="px-4 py-3 flex-1 flex items-end justify-end text-stone-900 dark:text-stone-100"
        >
          <LcdDisplay state={state} />
        </div>
      </div>

      {/* Function rows (4 x 5 = 20 buttons) */}
      <div className="grid grid-cols-5 gap-x-2 gap-y-5 pt-4">
        <Btn shift="Slope%" label="Pitch" onClick={() => act({ type: 'setPitch' }, { type: 'calcSlopePercent' })} active={state.shiftMode} />
        <Btn shift="R/Wall" label="Rise" onClick={() => d({ type: 'setRise' })} active={state.shiftMode} />
        <Btn shift="Polygon" label="Run" onClick={() => act({ type: 'setRun' }, { type: 'calcPolygon' })} active={state.shiftMode} />
        <Btn shift="Roof" label="Diag" onClick={() => act({ type: 'calcDiag' }, { type: 'calcRoofArea' })} active={state.shiftMode} />
        <Btn shift="Ir/Pitch" label="Hip/V" onClick={() => d({ type: 'calcHipV' })} active={state.shiftMode} />

        <Btn shift="Spring" label="Miter" onClick={() => act({ type: 'calcCompMiter' }, { type: 'calcSpringAngle' })} active={state.shiftMode} />
        <Btn shift="Riser Ltd" label="Stair" onClick={() => act({ type: 'calcStair' }, { type: 'calcRiserLimited' })} active={state.shiftMode} />
        <Btn shift="Radius" label="Arc" onClick={() => d({ type: 'calcArc' })} active={state.shiftMode} />
        <Btn shift="Col/Cone" label="Circ" onClick={() => act({ type: 'calcCirc' }, { type: 'calcColumnCone' })} active={state.shiftMode} />
        <Btn shift="Ir/Jack" label="Jack" onClick={() => d({ type: 'calcJack' })} active={state.shiftMode} />

        <Btn shift="Blocks" label="m" onClick={() => act({ type: 'convertUnit', unit: 'm' }, { type: 'calcBlocks' })} active={state.shiftMode} />
        <Btn shift="Footing" label="Length" onClick={() => act({ type: 'setLength' }, { type: 'calcFooting' })} active={state.shiftMode} />
        <Btn shift="Drywall" label="Width" onClick={() => act({ type: 'setWidth' }, { type: 'calcDrywall' })} active={state.shiftMode} />
        <Btn label="Height" onClick={() => d({ type: 'setHeight' })} active={state.shiftMode} />
        <Btn shift="x²" label="%" onClick={() => act({ type: 'percent' }, { type: 'square' })} active={state.shiftMode} />

        <Btn label="Yds" onClick={() => d({ type: 'convertUnit', unit: 'yds' })} active={state.shiftMode} />
        <Btn label="Feet" onClick={() => d({ type: 'applyFeet' })} active={state.shiftMode} />
        <Btn label="Inch" onClick={() => d({ type: 'applyInch' })} active={state.shiftMode} />
        <Btn label="/" onClick={() => d({ type: 'fractionSep' })} active={state.shiftMode} />
        <Btn label="Clear" tone="danger" onClick={() => d({ type: 'clear' })} active={state.shiftMode} />
      </div>

      {/* Numpad rows (4 x 5 = 20 buttons) */}
      <div className="grid grid-cols-5 gap-x-2 gap-y-5 mt-5">
        <Btn label={state.shiftMode ? 'CONV' : 'Conv'} tone={state.shiftMode ? 'accentActive' : 'accent'} onClick={() => d({ type: 'toggleShift' })} active={state.shiftMode} ariaPressed={state.shiftMode} ariaLabel={state.shiftMode ? 'CONV active' : 'CONV inactive'} />
        <NumBtn shift="cm" label="7" onClick={() => act({ type: 'digit', digit: '7' }, { type: 'convertUnit', unit: 'cm' })} active={state.shiftMode} />
        <NumBtn shift="Bd Ft" label="8" onClick={() => act({ type: 'digit', digit: '8' }, { type: 'calcBoardFeet' })} active={state.shiftMode} />
        <NumBtn shift="mm" label="9" onClick={() => act({ type: 'digit', digit: '9' }, { type: 'convertUnit', unit: 'mm' })} active={state.shiftMode} />
        <Btn shift="1/x" label="÷" tone="op" onClick={() => act({ type: 'operation', op: '/' }, { type: 'inverse' })} active={state.shiftMode} />

        <Btn label="Store" onClick={() => d({ type: 'memoryStore' })} active={state.shiftMode} />
        <NumBtn shift="lbs" label="4" onClick={() => act({ type: 'digit', digit: '4' }, { type: 'convertUnit', unit: 'lbs' })} active={state.shiftMode} />
        <NumBtn shift="Studs" label="5" onClick={() => act({ type: 'digit', digit: '5' }, { type: 'calcStuds' })} active={state.shiftMode} />
        <NumBtn shift="tons" label="6" onClick={() => act({ type: 'digit', digit: '6' }, { type: 'convertUnit', unit: 'tons' })} active={state.shiftMode} />
        <Btn shift="Clear All" label="×" tone="op" onClick={() => act({ type: 'operation', op: '*' }, { type: 'clearAll' })} active={state.shiftMode} />

        <Btn shift="MC" label="Rcl" onClick={() => act({ type: 'memoryRecall' }, { type: 'memoryClear' })} active={state.shiftMode} />
        <NumBtn shift="kg" label="1" onClick={() => act({ type: 'digit', digit: '1' }, { type: 'convertUnit', unit: 'kg' })} active={state.shiftMode} />
        <NumBtn shift="Acre" label="2" onClick={() => act({ type: 'digit', digit: '2' }, { type: 'convertUnit', unit: 'acre' })} active={state.shiftMode} />
        <NumBtn shift="m.tons" label="3" onClick={() => act({ type: 'digit', digit: '3' }, { type: 'convertUnit', unit: 'met_tons' })} active={state.shiftMode} />
        <Btn shift="±" label="−" tone="op" onClick={() => act({ type: 'operation', op: '-' }, { type: 'plusMinus' })} active={state.shiftMode} />

        <Btn shift="M−" label="M+" onClick={() => act({ type: 'memoryAdd' }, { type: 'memorySubtract' })} active={state.shiftMode} />
        <NumBtn shift="Cost" label="0" onClick={() => act({ type: 'digit', digit: '0' }, { type: 'calcCost' })} active={state.shiftMode} />
        <NumBtn shift="dms↔°" label="•" onClick={() => act({ type: 'decimal' }, { type: 'dmsDeg' })} active={state.shiftMode} />
        <Btn label="=" tone="equals" onClick={() => d({ type: 'equals' })} active={state.shiftMode} />
        <Btn label="+" tone="op" onClick={() => d({ type: 'operation', op: '+' })} active={state.shiftMode} />
      </div>

      {/* Result detail panel */}
      {lr && (
        <div className="mt-4">
          <ResultDetail result={lr} />
        </div>
      )}

      {/* Footer 4 boutons */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => setShowFtIn(true)}
          aria-label="Saisir une dimension en pieds-pouces"
          className={`h-12 text-xs font-bold rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors active:scale-95 ${
            state.displayAsFeetInches
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-300'
              : 'bg-zinc-700 hover:bg-zinc-600 text-white'
          }`}
        >
          <Hash className="w-4 h-4" />
          FT/IN
        </button>
        <button
          type="button"
          onClick={() => setShowUnits(true)}
          aria-label="Ouvrir conversions d'unités"
          className="h-12 text-xs font-medium bg-zinc-700 hover:bg-zinc-600 active:scale-95 text-white rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors"
        >
          <Ruler className="w-4 h-4" />
          Conversion
        </button>
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          aria-label="Ouvrir historique"
          className="relative h-12 text-xs font-medium bg-zinc-700 hover:bg-zinc-600 active:scale-95 text-white rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors"
        >
          <Clock className="w-4 h-4" />
          Historique
          {state.history.length > 0 && (
            <span className="absolute top-0.5 right-1 text-[9px] bg-amber-500 text-zinc-900 font-bold px-1 rounded-full">{state.history.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => d({ type: 'clearAll' })}
          aria-label="Effacer tout"
          className="h-12 text-xs font-bold bg-red-500 hover:bg-red-600 active:scale-95 text-white rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Clear All
        </button>
      </div>

      {/* Sheets modales (z-50, fixed inset-0) */}
      {showFtIn && (
        <FtInSheet
          isOn={state.displayAsFeetInches}
          onSubmit={(inches) => {
            d({ type: 'enterDimension', inches });
            setShowFtIn(false);
          }}
          onToggleMode={() => {
            d({ type: 'toggleFeetInchesDisplay' });
          }}
          onClose={() => setShowFtIn(false)}
        />
      )}

      {showUnits && (
        <Sheet title="Conversion d'unités" icon="📏" onClose={() => setShowUnits(false)}>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 italic">
            Tape un nombre puis touche l&apos;unité — convertit vers l&apos;unité de base (m / kg / m²).
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(['m', 'cm', 'mm', 'ft', 'in', 'yds'] as const).map((u) => (
              <button
                type="button"
                key={u}
                onClick={() => {
                  d({ type: 'convertUnit', unit: u });
                  setShowUnits(false);
                }}
                className="px-2 py-2.5 text-sm font-medium bg-zinc-700 hover:bg-zinc-600 active:scale-95 text-white rounded-lg transition-colors"
              >
                {u === 'm' ? 'Mètres' : u === 'ft' ? 'Feet' : u === 'in' ? 'Inch' : u === 'yds' ? 'Yards' : u}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {showHistory && (
        <Sheet title="Historique" icon={<Clock size={14} />} onClose={() => setShowHistory(false)}>
          {state.history.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">Aucun calcul</p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-0.5">
              {state.history.map((h, i) => (
                <div
                  key={i}
                  className="flex justify-between text-sm font-mono px-2 py-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"
                >
                  <span className="text-zinc-500 dark:text-zinc-400">{h.op}</span>
                  <span className="text-zinc-900 dark:text-white">{h.result}</span>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────── */

type Tone = 'default' | 'op' | 'equals' | 'danger' | 'accent' | 'accentActive';

const BEVEL =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-2px_0_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.35)] ' +
  'active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.45),0_0_0_rgba(0,0,0,0)] active:translate-y-px ' +
  'focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent outline-none';

const TONE_CLASS: Record<Tone, string> = {
  default: `bg-gradient-to-b from-zinc-600 to-zinc-800 hover:from-zinc-500 hover:to-zinc-700 text-white ${BEVEL}`,
  op: `bg-gradient-to-b from-zinc-700 to-zinc-900 hover:from-zinc-600 hover:to-zinc-800 text-white ${BEVEL}`,
  equals: `bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 text-white ring-1 ring-emerald-500/40 ${BEVEL}`,
  danger: `bg-gradient-to-b from-red-500 to-red-700 hover:from-red-600 hover:to-red-800 text-white ${BEVEL}`,
  accent: `bg-gradient-to-b from-orange-500 to-orange-700 hover:from-orange-600 hover:to-orange-800 text-white ${BEVEL}`,
  accentActive: `bg-gradient-to-b from-amber-500 to-amber-700 ring-2 ring-amber-300 text-white ${BEVEL}`,
};

function Btn({
  label,
  shift,
  onClick,
  tone = 'default',
  active,
  ariaPressed,
  ariaLabel,
}: {
  label: string;
  shift?: string;
  onClick: () => void;
  tone?: Tone;
  active?: boolean;
  ariaPressed?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed}
      aria-label={ariaLabel}
      className={`relative h-12 rounded-full text-sm font-bold tracking-tight transition-all ${TONE_CLASS[tone]}`}
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Helvetica Neue", system-ui, sans-serif' }}
    >
      {shift && (
        <span className={`absolute -top-3.5 left-0 right-0 text-[10px] italic leading-none font-semibold ${active ? 'text-amber-300 drop-shadow' : 'text-zinc-700 dark:text-zinc-300'}`}>
          {shift}
        </span>
      )}
      <span className="block">{label}</span>
    </button>
  );
}

function NumBtn({
  label,
  shift,
  onClick,
  active,
}: {
  label: string;
  shift?: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-12 rounded-full text-lg font-bold tracking-tight transition-all ${
        active && shift
          ? `bg-gradient-to-b from-amber-500 to-amber-700 ring-2 ring-amber-300 text-white ${BEVEL}`
          : `bg-gradient-to-b from-zinc-500 to-zinc-700 hover:from-zinc-400 hover:to-zinc-600 text-white ${BEVEL}`
      }`}
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Helvetica Neue", system-ui, sans-serif' }}
    >
      {shift && (
        <span className={`absolute -top-3.5 left-0 right-0 text-[10px] italic leading-none font-semibold ${active ? 'text-amber-200 drop-shadow' : 'text-zinc-700 dark:text-zinc-300'}`}>
          {shift}
        </span>
      )}
      <span className="block">{label}</span>
    </button>
  );
}

function Sheet({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const titleId = `sheet-title-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md mx-3 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 id={titleId} className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <span>{typeof icon === 'string' ? icon : icon}</span>
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-lg leading-none px-2 py-1 -m-1 rounded focus-visible:ring-2 focus-visible:ring-amber-400 outline-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function FtInSheet({
  isOn,
  onSubmit,
  onToggleMode,
  onClose,
}: {
  isOn: boolean;
  onSubmit: (inches: number) => void;
  onToggleMode: () => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const parsed = input.trim() ? parseFeetInches(input) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const titleId = 'sheet-title-feet-inches';

  const handleSubmit = () => {
    if (!input.trim()) {
      setError('Saisie vide');
      return;
    }
    const v = parseFeetInches(input);
    if (v === null) {
      setError(`Format invalide. Exemples: 3'10 1/4", 5'2 1/2", 1/2"`);
      return;
    }
    setError(null);
    onSubmit(v);
  };

  const handleQuick = (preset: string) => {
    setInput(preset);
    setError(null);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md mx-3 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 id={titleId} className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <Hash size={14} />
            Dimension pieds-pouces
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-lg leading-none px-2 py-1 -m-1 rounded focus-visible:ring-2 focus-visible:ring-amber-400 outline-none"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 italic">
          Exemples : 3&apos;10 1/4&quot;, 5&apos;2 1/2&quot;, 10 3/16&quot;, 1/2&quot;
        </p>

        <input
          type="text"
          inputMode="text"
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
          placeholder={`3'10 1/4"`}
          aria-label="Dimension en pieds-pouces"
          className="w-full text-base font-mono bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-white px-3 py-2.5 rounded-lg border-2 border-zinc-300 dark:border-zinc-700 focus:border-emerald-500 dark:focus:border-emerald-400 outline-none"
        />

        {parsed !== null && (
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 font-mono">
            ↳ {parsed} pouces = {parsed / 12} pieds = {(parsed * 0.0254).toFixed(4)} m
          </p>
        )}

        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {[`8'`, `4'`, `2'6"`, `1' 6"`, `12"`, `6"`, `3"`, `1"`].map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => handleQuick(p)}
              className="px-2 py-1 text-xs font-mono bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200 rounded transition-colors"
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onToggleMode}
            className={`h-11 text-xs font-medium rounded-xl transition-colors active:scale-95 ${
              isOn
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200'
            }`}
          >
            Mode {isOn ? 'pieds-pouces ✓' : 'décimal'}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={parsed === null}
            className="h-11 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white rounded-xl transition-colors active:scale-95"
          >
            Saisir
          </button>
        </div>
      </div>
    </>
  );
}

function LcdDisplay({ state }: { state: CalcState }) {
  if (!state.displayAsFeetInches) {
    return (
      <div className="text-right font-mono text-3xl tracking-wider truncate w-full">
        {state.display}
      </div>
    );
  }

  if (state.dimMode) {
    const accumStr = formatFeetInches(state.dimAccum);
    const buf = state.newNumber ? '' : state.display;
    let suffix = '';
    if (state.dimFracNum != null) {
      suffix = ` ${state.dimFracNum}/${buf || '?'}`;
    } else if (buf && buf !== '0') {
      suffix = ` + ${buf}`;
    }
    return (
      <div className="text-right font-mono text-3xl tracking-wider truncate w-full">
        {accumStr}
        <span className="text-stone-700/70 dark:text-stone-300/70 text-2xl">{suffix}</span>
      </div>
    );
  }

  return <FeetInchesStructured inches={state.currentValue} />;
}

function FeetInchesStructured({ inches }: { inches: number }) {
  if (!isFinite(inches)) {
    return <div className="text-right font-mono text-3xl">Error</div>;
  }
  if (inches === 0) {
    return <div className="text-right font-mono text-4xl">0&quot;</div>;
  }
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const totalScaled = Math.round(abs * 16);
  let feet = Math.floor(totalScaled / (12 * 16));
  let restScaled = totalScaled - feet * 12 * 16;
  let wholeIn = Math.floor(restScaled / 16);
  let fracN = restScaled - wholeIn * 16;
  let fracD = 16;
  if (fracN >= 16) {
    fracN -= 16;
    wholeIn += 1;
  }
  if (wholeIn >= 12) {
    feet += Math.floor(wholeIn / 12);
    wholeIn = wholeIn % 12;
  }
  while (fracN > 0 && fracN % 2 === 0) {
    fracN /= 2;
    fracD /= 2;
  }
  const hasFeet = feet > 0;
  const hasInch = wholeIn > 0 || fracN > 0;

  return (
    <div className="flex items-end justify-end gap-3 w-full">
      {hasFeet && (
        <div className="flex flex-col items-center">
          <div className="font-mono text-4xl leading-none">{sign}{feet}</div>
          <div className="text-[9px] tracking-[0.2em] text-stone-700/80 dark:text-stone-300/80 mt-1">FEET</div>
        </div>
      )}
      {hasFeet && hasInch && (
        <div className="font-mono text-3xl pb-5 text-stone-700 dark:text-stone-300">−</div>
      )}
      {hasInch && (
        <div className="flex flex-col items-center">
          <div className="flex items-baseline justify-center gap-1.5">
            <span className="font-mono text-4xl leading-none">
              {!hasFeet ? sign : ''}{wholeIn || (fracN === 0 ? 0 : '')}
            </span>
            {fracN > 0 && (
              <div className="flex flex-col font-mono text-base leading-[1.05]">
                <span className="text-center">{fracN}</span>
                <span className="text-center border-t border-current">{fracD}</span>
              </div>
            )}
          </div>
          <div className="text-[9px] tracking-[0.2em] text-stone-700/80 dark:text-stone-300/80 mt-1">INCH</div>
        </div>
      )}
      {!hasFeet && !hasInch && (
        <div className="font-mono text-4xl">{sign}0&quot;</div>
      )}
    </div>
  );
}

type DetailedResult =
  | { type: 'stair'; risers: number; treads: number; riserHeight: number; treadDepth: number; totalRun: number; stringerLength: number; blondel: number }
  | { type: 'circle'; radius: number; diameter: number; circumference: number; area: number }
  | { type: 'arc'; rise: number; arcLength: number; angleDeg: number; angleRad: number }
  | { type: 'polygon'; interiorAngle: number; apothem: number; circumradius: number; perimeter: number; area: number }
  | { type: 'compMiter'; miterAngle: number; bevelAngle: number }
  | { type: 'springAngle'; miterAngle: number; bevelAngle: number }
  | { type: 'jack'; jackDifference: number; lengthFactor: number; pitch: number; spacing: number }
  | { type: 'columnCone'; cylinderVolume: number; coneVolume: number }
  | { type: 'studs'; studs40cm: number; studs60cm: number };

function ResultDetail({ result }: { result: { type?: string } & Record<string, unknown> }) {
  if (!result?.type) return null;

  const rows: [string, string][] = [];
  const r = result as DetailedResult;

  switch (r.type) {
    case 'stair':
      rows.push(
        ['Contremarches', `${r.risers}`],
        ['Marches', `${r.treads}`],
        ['Hauteur marche', `${r.riserHeight} cm`],
        ['Profondeur', `${r.treadDepth} cm`],
        ['Parcours total', `${r.totalRun} cm`],
        ['Limon', `${r.stringerLength} cm`],
        ['Blondel', `${r.blondel} cm`],
      );
      break;
    case 'circle':
      rows.push(
        ['Rayon', `${r.radius}`],
        ['Diamètre', `${r.diameter}`],
        ['Circonférence', `${(r.circumference ?? 0).toFixed(4)}`],
        ['Aire', `${(r.area ?? 0).toFixed(4)}`],
      );
      break;
    case 'arc':
      rows.push(
        ['Flèche', `${r.rise}`],
        ['Longueur arc', `${r.arcLength}`],
        ['Angle', `${r.angleDeg}°`],
      );
      break;
    case 'polygon':
      rows.push(
        ['Angle intérieur', `${r.interiorAngle}°`],
        ['Apothème', `${r.apothem}`],
        ['Périmètre', `${r.perimeter}`],
        ['Aire', `${r.area}`],
      );
      break;
    case 'compMiter':
    case 'springAngle':
      rows.push(
        ['Angle onglet', `${r.miterAngle}°`],
        ['Angle biseau', `${r.bevelAngle}°`],
      );
      break;
    case 'jack':
      rows.push(
        ['Différence jack', `${r.jackDifference}`],
        ['Facteur longueur', `${r.lengthFactor}`],
      );
      break;
    case 'columnCone':
      rows.push(
        ['Vol. cylindre', `${r.cylinderVolume}`],
        ['Vol. cône', `${r.coneVolume}`],
      );
      break;
    case 'studs':
      rows.push(
        ['@ 40 cm', `${r.studs40cm} montants`],
        ['@ 60 cm', `${r.studs60cm} montants`],
      );
      break;
    default:
      return null;
  }

  return (
    <div className="bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl px-3 py-2.5">
      <div className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1.5 font-semibold">
        Résultat {r.type}
      </div>
      <div className="space-y-0.5">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">{k}</span>
            <span className="text-zinc-900 dark:text-white font-mono">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
