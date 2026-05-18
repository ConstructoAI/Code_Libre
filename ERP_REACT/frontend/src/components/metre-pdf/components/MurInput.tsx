/**
 * MurInput — Overlay for keyboard-driven dimension entry during mur tool.
 *
 * Shows the current direction, typed imperial dimension (PP-II-SS),
 * and its real-world equivalent in real time.
 *
 * Workflow:
 *  1. User clicks a start point (or chains from previous endpoint)
 *  2. Presses arrow key or moves mouse to set direction
 *  3. Types dimension in PP-II-SS format
 *  4. Enter → segment is drawn, endpoint chains to next
 *  5. Escape → cancel
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  parseImperialInput,
  DIRECTION_LABELS,
  DIRECTION_ARROWS,
  ARROW_KEY_MAP,
  type DrawDirection,
} from '../utils/imperialInput';

interface MurInputProps {
  /** Current direction (set by arrow keys or mouse) */
  direction: DrawDirection | null;
  /** Angle in degrees (when mouse-determined, snapped to 15deg) */
  angleDeg: number | null;
  /** Current input value */
  inputValue: string;
  /** Whether calibration is available */
  isCalibrated: boolean;
  /** Calibration unit (m, cm, mm, ft, in) */
  calibrationUnit: string;
  /** Position on screen (CSS pixels) */
  posX: number;
  posY: number;
  /** Viewport dimensions for clamping */
  viewportWidth: number;
  viewportHeight: number;
  /** Callbacks */
  onInputChange: (value: string) => void;
  onDirectionChange: (dir: DrawDirection) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const OVERLAY_WIDTH = 230;
const OVERLAY_HEIGHT = 100;

export default function MurInput({
  direction,
  angleDeg,
  inputValue,
  isCalibrated,
  calibrationUnit,
  posX,
  posY,
  viewportWidth,
  viewportHeight,
  onInputChange,
  onDirectionChange,
  onConfirm,
  onCancel,
}: MurInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [calibrationWarning, setCalibrationWarning] = useState(false);

  // Auto-focus on mount and keep focus persistent (inspired by CAO AI CommandInput)
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  // Re-focus when direction or angle changes (covers both arrow keys and mouse clicks)
  useEffect(() => {
    // Small delay to let React finish rendering before grabbing focus
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [direction, angleDeg]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Arrow keys change direction — stop propagation to prevent global handler double-fire
      const dir = ARROW_KEY_MAP[e.key];
      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        onDirectionChange(dir);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        // Block confirmation if not calibrated — flash warning
        if (!isCalibrated) {
          setCalibrationWarning(true);
          setTimeout(() => setCalibrationWarning(false), 2000);
          return;
        }
        // Only confirm if input is valid (parsed successfully)
        const parsed = parseImperialInput(inputValue);
        if (parsed) {
          onConfirm();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }

      // Stop propagation for all other keys so global shortcuts don't fire
      e.stopPropagation();
    },
    [onDirectionChange, onConfirm, onCancel, inputValue, direction, angleDeg],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Only allow digits and dashes, enforce PP-II-SS structure
      let cleaned = e.target.value.replace(/[^0-9-]/g, '');
      // Remove leading dashes
      cleaned = cleaned.replace(/^-+/, '');
      // Collapse consecutive dashes to single
      cleaned = cleaned.replace(/-{2,}/g, '-');
      // Limit to max 2 dashes (3 parts)
      const dashCount = (cleaned.match(/-/g) || []).length;
      if (dashCount > 2) {
        const parts = cleaned.split('-');
        cleaned = parts.slice(0, 3).join('-');
      }
      onInputChange(cleaned);
    },
    [onInputChange],
  );

  // Handle blur: aggressively reclaim focus (like CAO AI keeps CommandInput focused)
  // The input must stay focused so arrow keys and typing always work
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (containerRef.current && relatedTarget && containerRef.current.contains(relatedTarget)) {
        return; // Focus moved within the component, no action needed
      }
      // Focus left the component — reclaim focus after React finishes processing
      // Use requestAnimationFrame for more reliable timing than setTimeout(0)
      requestAnimationFrame(() => {
        if (inputRef.current && document.body.contains(inputRef.current)) {
          inputRef.current.focus();
        }
      });
    },
    [],
  );

  // Parse current input for preview
  const parsed = parseImperialInput(inputValue);
  const imperialDisplay = parsed ? parsed.displayString : null;
  const metricDisplay = parsed
    ? `${(parsed.totalMeters ?? 0).toFixed(4)} ${calibrationUnit}`
    : null;

  // Direction display
  const dirLabel = direction
    ? DIRECTION_LABELS[direction]
    : angleDeg !== null
      ? `${angleDeg}deg`
      : 'Flèche ou souris';

  // Clamp position to viewport
  const clampedX = Math.max(0, Math.min(posX, viewportWidth - OVERLAY_WIDTH));
  const clampedY = Math.max(0, Math.min(posY - OVERLAY_HEIGHT, viewportHeight - OVERLAY_HEIGHT));

  return (
    <div
      ref={containerRef}
      className="absolute pointer-events-none"
      role="dialog"
      aria-label="Saisie de dimension Mur"
      style={{
        left: clampedX,
        top: clampedY,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          background: 'var(--metre-bg)',
          borderRadius: 6,
          padding: '6px 10px',
          border: '1px solid #0078D4',
          minWidth: OVERLAY_WIDTH,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          pointerEvents: 'auto',
        }}
      >
        {/* Direction indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: '#0078D4',
            fontFamily: 'monospace',
          }}
        >
          <span style={{ fontSize: 14 }}>
            {direction ? DIRECTION_ARROWS[direction] : '\u25CE'}
          </span>
          <span>{dirLabel}</span>
          {!isCalibrated && (
            <span
              style={{
                color: calibrationWarning ? '#ffffff' : '#f87171',
                background: calibrationWarning ? '#dc2626' : 'transparent',
                marginLeft: 'auto',
                fontSize: 10,
                padding: calibrationWarning ? '1px 4px' : 0,
                borderRadius: 3,
                transition: 'all 0.2s',
              }}
            >
              {calibrationWarning ? 'Calibrez d\'abord!' : 'Non calibré'}
            </span>
          )}
        </div>

        {/* Input row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span
            style={{
              color: 'var(--metre-muted)',
              fontSize: 11,
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}
          >
            PP-II-SS / PPIISS =
          </span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            aria-label="Dimension imperiale PP-II-SS ou format compact PPIISS (ex: 200608 = 20 pieds 6 pouces 1/2)"
            style={{
              flex: 1,
              width: 90,
              background: 'var(--metre-surface)',
              border: '1px solid var(--metre-border)',
              borderRadius: 3,
              outline: 'none',
              color: 'var(--metre-text)',
              fontSize: 14,
              fontFamily: 'monospace',
              fontWeight: 'bold',
              padding: '2px 6px',
              letterSpacing: 1,
            }}
            placeholder="20-06-08 ou 200608"
          />
        </div>

        {/* Live preview */}
        {imperialDisplay && (
          <div
            aria-live="polite"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#0369a1',
              paddingTop: 2,
            }}
          >
            <span>{imperialDisplay}</span>
            <span style={{ color: 'var(--metre-muted)' }}>{metricDisplay}</span>
          </div>
        )}

        {/* Help text */}
        <div
          style={{
            fontSize: 9,
            color: 'var(--metre-muted)',
            fontFamily: 'monospace',
            lineHeight: 1.3,
            paddingTop: 2,
          }}
        >
          PP=pieds | II=pouces | SS=seizièmes (08=1/2" 12=3/4")
          <br />
          {'\u2191\u2193\u2190\u2192'} direction | Enter confirmer | Esc annuler
        </div>
      </div>
    </div>
  );
}
