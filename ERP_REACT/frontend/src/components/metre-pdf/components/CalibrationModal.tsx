import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMetreStore } from '../store';
import type { MeasurementUnit } from '../types';
import { parseImperialInput } from '../utils/imperialInput';

const VALID_UNITS: MeasurementUnit[] = ['m', 'cm', 'mm', 'ft', 'in'];

const METERS_PER_FOOT = 0.3048;
const METERS_PER_INCH = 0.0254;
const METERS_PER_CM = 0.01;
const METERS_PER_MM = 0.001;

/** Convert totalMeters to value in the target unit (used when imperial format detected). */
function metersToUnit(meters: number, targetUnit: MeasurementUnit): number {
  switch (targetUnit) {
    case 'm':
      return meters;
    case 'cm':
      return meters / METERS_PER_CM;
    case 'mm':
      return meters / METERS_PER_MM;
    case 'ft':
      return meters / METERS_PER_FOOT;
    case 'in':
      return meters / METERS_PER_INCH;
  }
}

export default function CalibrationModal() {
  const pendingPxLen = useMetreStore((s) => s.pendingCalibrationPxLen);
  const setPendingPxLen = useMetreStore((s) => s.setPendingCalibrationPxLen);
  const setCalibration = useMetreStore((s) => s.setCalibration);
  const setActiveTool = useMetreStore((s) => s.setActiveTool);
  const currentPage = useMetreStore((s) => s.currentPage);
  const clearDrawing = useMetreStore((s) => s.clearDrawing);

  const [refLength, setRefLength] = useState('');
  const [unit, setUnit] = useState<MeasurementUnit>('m');
  // Track la preference utilisateur explicite (changements via select) pour
  // pouvoir restaurer apres l'auto-switch en imperial.
  const [userPreferredUnit, setUserPreferredUnit] = useState<MeasurementUnit>('m');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (pendingPxLen !== null && pendingPxLen > 0) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [pendingPxLen]);

  // Detection imperial: si l'input matche PPIISS ou PP-II-SS, on a une dimension.
  // Quand imperial detecte, l'unit est forcement pieds/pouces — on convertit
  // automatiquement la valeur stockee selon l'unit choisi (par defaut auto-switch a 'ft').
  const imperialParsed = useMemo(() => parseImperialInput(refLength), [refLength]);

  // Auto-switch unit a 'ft' si format imperial detecte ET unit actuel non-imperial.
  // Restaurer userPreferredUnit quand l'imperial disparait (ex: l'utilisateur efface
  // l'input et tape un decimal en mm).
  useEffect(() => {
    if (imperialParsed && unit !== 'ft' && unit !== 'in') {
      setUnit('ft');
    } else if (!imperialParsed && unit !== userPreferredUnit) {
      // Imperial disparu (input efface ou format invalide) → restaurer la preference
      setUnit(userPreferredUnit);
    }
  }, [imperialParsed, unit, userPreferredUnit]);

  // Capture le changement manuel d'unit (via le select) comme preference utilisateur
  const handleUnitChange = useCallback((newUnit: MeasurementUnit) => {
    setUnit(newUnit);
    setUserPreferredUnit(newUnit);
  }, []);

  // Compute la valeur effective selon le format saisi
  const effectiveValue = useMemo<number | null>(() => {
    if (imperialParsed) {
      return metersToUnit(imperialParsed.totalMeters, unit);
    }
    const v = parseFloat(refLength);
    return !isNaN(v) && v > 0 ? v : null;
  }, [imperialParsed, refLength, unit]);

  const handleSubmit = useCallback(() => {
    // Guard contre pendingPxLen null OR <= 0 (eviterait division par zero
    // qui produirait scaleFactor = Infinity et casserait toutes les mesures
    // futures du document). pendingPxLen normalement > 0 mais defense en
    // profondeur car la valeur vient du store (peut etre poisoned).
    if (pendingPxLen === null || pendingPxLen <= 0) return;
    if (effectiveValue === null || effectiveValue <= 0) return;

    setCalibration({
      id: `cal-${Date.now()}`,
      documentId: '',
      pageNumber: currentPage,
      scaleFactor: effectiveValue / pendingPxLen,
      unit,
      referenceLength: effectiveValue,
      pixelLength: pendingPxLen,
    });

    setPendingPxLen(null);
    setRefLength('');
    clearDrawing();
    setActiveTool('select');
  }, [pendingPxLen, effectiveValue, unit, currentPage, setCalibration, setPendingPxLen, clearDrawing, setActiveTool]);

  const handleCancel = useCallback(() => {
    setPendingPxLen(null);
    setRefLength('');
    clearDrawing();
  }, [setPendingPxLen, clearDrawing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSubmit();
      if (e.key === 'Escape') handleCancel();
    },
    [handleSubmit, handleCancel]
  );

  // Garde supplementaire: pendingPxLen <= 0 ne devrait pas declencher le modal
  // mais defense en profondeur pour eviter toute division par zero.
  if (pendingPxLen === null || pendingPxLen <= 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/60">
      <div
        className="bg-metre-surface border border-metre-border rounded-xl shadow-xl p-6 w-96"
        onKeyDown={handleKeyDown}
      >
        <h3 className="text-sm font-semibold text-metre-text mb-4">
          Calibration de l'échelle
        </h3>

        <label className="block text-xs text-metre-muted mb-1">
          Longueur réelle de la référence tracée
        </label>
        <div className="flex gap-2 mb-2">
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            value={refLength}
            onChange={(e) => setRefLength(e.target.value)}
            placeholder="3.048   ou   10-0-0   ou   160608"
            className="flex-1 bg-metre-bg border border-metre-border rounded px-3 py-2 text-sm text-metre-text focus:outline-none focus:border-blue-500"
          />
          <select
            value={unit}
            onChange={(e) => handleUnitChange(e.target.value as MeasurementUnit)}
            className="bg-metre-bg border border-metre-border rounded px-2 py-2 text-sm text-metre-text focus:outline-none focus:border-blue-500"
          >
            {VALID_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        {/* Feedback visuel: si format imperial detecte, montrer le parse */}
        {imperialParsed && (
          <div className="text-xs text-blue-600 dark:text-blue-400 mb-2 px-1">
            Imperial: <strong>{imperialParsed.displayString}</strong>
            {' = '}
            {imperialParsed.totalMeters.toFixed(4)} m
            {' = '}
            {metersToUnit(imperialParsed.totalMeters, unit).toFixed(4)} {unit}
          </div>
        )}

        <p className="text-xs text-metre-muted mb-4 leading-relaxed">
          Tracez une distance connue sur le plan, puis entrez sa valeur réelle.
          <br />
          Formats acceptés : décimal (<code>3.048</code>), imperial avec tirets
          (<code>10-0-0</code> = 10 pieds), ou compact 6 digits
          (<code>160608</code> = 16 pieds 6 pouces ½).
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-sm text-metre-muted hover:text-metre-text transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={effectiveValue === null || effectiveValue <= 0}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/40 text-white rounded-lg transition-colors"
          >
            Calibrer
          </button>
        </div>
      </div>
    </div>
  );
}
