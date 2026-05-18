import { useEffect, useMemo, memo } from 'react';
import { useBottomBarState } from '../hooks/useBottomBarState';
import type { Tool } from '../types';

const TOOL_LABELS: Record<Tool, string> = {
  select: 'Sélection',
  distance: 'Distance',
  area: 'Surface',
  rectangle: 'Rectangle',
  perimeter: 'Périmètre',
  polyline: 'Polyligne',
  mur: 'Mur',
  angle: 'Angle',
  count: 'Comptage',
  circle: 'Cercle',
  calibrate: 'Calibration',
  pan: 'Déplacement',
  text: 'Texte',
  arrow: 'Flèche',
  cloud: 'Nuage révision',
  freehand: 'Main levée',
  highlight: 'Surligner',
  note: 'Note',
  dimension: 'Cotation',
  callout: 'Bulle texte',
  stamp: 'Symbole',
};

export default memo(function BottomBar() {
  const {
    activeTool, mouseWorldPosition, mousePosition,
    liveMeasurementValue, activeSnapType,
    calibration, measurements, currentPage,
    displayUnit, toggleDisplayUnit, clipboardCount,
  } = useBottomBarState();

  // Ctrl+U keyboard shortcut to toggle units
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        toggleDisplayUnit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleDisplayUnit]);

  const pageMeasurementCount = useMemo(
    () => measurements.filter((m) => m.pageNumber === currentPage).length,
    [measurements, currentPage],
  );
  const unit = calibration?.unit ?? 'px';

  return (
    <div className="h-7 bg-metre-surface border-t border-metre-border flex items-center px-3 gap-4 text-[11px] flex-shrink-0">
      {/* Active tool */}
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-metre-accent" />
        <span className="text-metre-text font-medium">{TOOL_LABELS[activeTool]}</span>
      </div>

      <div className="w-px h-3.5 bg-metre-border" />

      {/* Mouse coordinates */}
      <div className="text-metre-muted font-mono tabular-nums">
        {mouseWorldPosition ? (
          <span>
            X: {(mouseWorldPosition.x ?? 0).toFixed(2)} {unit}, Y: {(mouseWorldPosition.y ?? 0).toFixed(2)} {unit}
          </span>
        ) : (
          <span>
            X: {(mousePosition.x ?? 0).toFixed(0)} px, Y: {(mousePosition.y ?? 0).toFixed(0)} px
          </span>
        )}
      </div>

      {/* Live measurement */}
      {liveMeasurementValue && (
        <>
          <div className="w-px h-3.5 bg-metre-border" />
          <span className="text-metre-accent font-mono tabular-nums font-medium">
            {liveMeasurementValue}
          </span>
        </>
      )}

      {/* Snap indicator */}
      {activeSnapType && (
        <>
          <div className="w-px h-3.5 bg-metre-border" />
          <span className="text-metre-success text-[10px] uppercase tracking-wider">
            SNAP: {activeSnapType}
          </span>
        </>
      )}

      <div className="flex-1" />

      {/* Clipboard indicator */}
      {clipboardCount > 0 && (
        <>
          <span className="text-metre-accent text-[10px]">
            {clipboardCount} copie{clipboardCount !== 1 ? 's' : ''} (Ctrl+V pour coller)
          </span>
          <div className="w-px h-3.5 bg-metre-border" />
        </>
      )}

      {/* Measurement count */}
      <span className="text-metre-muted">
        {pageMeasurementCount} mesure{pageMeasurementCount !== 1 ? 's' : ''}
      </span>

      <div className="w-px h-3.5 bg-metre-border" />

      {/* Unit toggle */}
      <button
        onClick={toggleDisplayUnit}
        className="text-metre-muted hover:text-metre-text transition-colors px-1.5 py-0.5 rounded hover:bg-metre-bg"
        title="Basculer Impérial/Métrique (Ctrl+U)"
      >
        {displayUnit === 'imperial' ? 'Impérial (ft)' : 'Métrique (m)'}
      </button>

      <div className="w-px h-3.5 bg-metre-border" />

      {/* Calibration status */}
      <span className={calibration ? 'text-metre-success' : 'text-metre-warning'}>
        {calibration ? `Calibré (${unit})` : 'Non calibré'}
      </span>
    </div>
  );
});
