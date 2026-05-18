import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

interface TruncatedTextProps {
  /** The full text to display (and to show in tooltip when truncated). */
  text: string;
  /** Optional ReactNode children — rendered instead of `text` if provided.
   *  The tooltip still uses `text` so the popup can show the canonical full
   *  string even when the visible label is decorated (e.g. italic). */
  children?: ReactNode;
  /** Tailwind / CSS classes for the truncated span. Should include
   *  `truncate` (or equivalent overflow + ellipsis rules) to enable the
   *  truncation detection. */
  className?: string;
  /** Optional inline style passthrough. */
  style?: CSSProperties;
  /** Extra info appended on a second line in the tooltip (e.g. dimensions
   *  or a hint like "Double-cliquer pour renommer"). */
  hint?: string;
  /** Delay in ms before showing the tooltip on hover (default 300). */
  delayMs?: number;
}

/**
 * A `<span>` that displays text with CSS truncation (ellipsis) and pops up
 * a custom floating tooltip on hover IFF the text is actually truncated
 * (i.e. `scrollWidth > clientWidth`). This avoids the noise of always-on
 * native `title` tooltips when the text already fits.
 *
 * The tooltip is rendered with a portal-free absolute layer that anchors
 * to the span's bounding rect, so it works correctly inside scroll
 * containers without clipping.
 */
export default function TruncatedText({
  text,
  children,
  className = '',
  style,
  hint,
  delayMs = 300,
}: TruncatedTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  /** Absolute viewport-coords for the tooltip's top-left, after clamping
   *  + flipping. `placement` lets the rendered JSX skip the translateY:
   *   - 'above' → tooltip's BOTTOM edge anchors at `top` (translateY -100%)
   *   - 'below' → tooltip's TOP edge anchors at `top` (no transform). */
  const [tooltipPos, setTooltipPos] = useState<
    | { top: number; left: number; placement: 'above' | 'below' }
    | null
  >(null);
  const tooltipId = useId();

  // Re-measure truncation state when text or available width changes.
  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    const measure = () => {
      // Some 1-pixel slack for sub-pixel rounding.
      setIsTruncated(el.scrollWidth - el.clientWidth > 1);
    };
    measure();
    // ResizeObserver picks up panel resize / window resize.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const cancelShow = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const scheduleShow = (rect: DOMRect) => {
    cancelShow();
    showTimerRef.current = setTimeout(() => {
      // Smart placement: prefer ABOVE the span, but flip BELOW when there's
      // not enough room above (e.g. for the first layers in the panel).
      // Estimate ~80 px tooltip height (1-2 lines of text) for the decision;
      // if the actual rendered tooltip is taller it'll just clip, but the
      // common case (single line + optional hint) fits.
      const ESTIMATED_TOOLTIP_HEIGHT = 80;
      const VIEWPORT_PADDING = 8;
      const placement: 'above' | 'below' =
        rect.top >= ESTIMATED_TOOLTIP_HEIGHT + VIEWPORT_PADDING ? 'above' : 'below';
      const top = placement === 'above' ? rect.top - VIEWPORT_PADDING : rect.bottom + VIEWPORT_PADDING;

      // Horizontal clamp: anchor at span's left, but if the tooltip's
      // max-width would overflow the right viewport edge, shift it left so
      // it fits. We use the SMALLER of (420 px, viewport - 16px) — same
      // ceiling the JSX uses for max-width.
      const tooltipMaxWidth = Math.min(420, window.innerWidth - 16);
      const overflowRight = rect.left + tooltipMaxWidth - (window.innerWidth - VIEWPORT_PADDING);
      const left = overflowRight > 0 ? Math.max(VIEWPORT_PADDING, rect.left - overflowRight) : rect.left;

      setTooltipPos({ top, left, placement });
      setTooltipVisible(true);
    }, delayMs);
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (!isTruncated) return;
    const rect = e.currentTarget.getBoundingClientRect();
    scheduleShow(rect);
  };

  const handleMouseLeave = () => {
    cancelShow();
    setTooltipVisible(false);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, []);

  return (
    <>
      <span
        ref={spanRef}
        className={className}
        style={style}
        aria-describedby={tooltipVisible ? tooltipId : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children ?? text}
      </span>
      {tooltipVisible && tooltipPos && (
        <div
          id={tooltipId}
          // Fixed position so it escapes any `overflow: hidden` ancestor.
          // `translateY(-100%)` is applied only when placement === 'above'
          // so the tooltip sits ABOVE the span; for 'below' the top edge
          // anchors directly at `tooltipPos.top` (already span.bottom + 8).
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: tooltipPos.placement === 'above' ? 'translateY(-100%)' : undefined,
            zIndex: 9999,
            pointerEvents: 'none',
            maxWidth: 'min(420px, calc(100vw - 16px))',
          }}
          className="px-2.5 py-1.5 rounded-md bg-slate-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs shadow-lg border border-slate-700/50 dark:border-neutral-300/50 break-words whitespace-pre-wrap"
          role="tooltip"
        >
          <div className="font-medium leading-tight">{text}</div>
          {hint && (
            <div className="text-[10px] mt-0.5 text-slate-300 dark:text-neutral-500 leading-tight">
              {hint}
            </div>
          )}
        </div>
      )}
    </>
  );
}
