import { useState, useCallback } from 'react';
import { X, Triangle } from 'lucide-react';
import { useMetreStore } from '../store';
import {
  pitchToAngle,
  pitchToPercent,
  percentToPitch,
  percentToDegrees,
  degreesToPitch,
  degreesToPercent,
  PITCH_TABLE,
} from '../utils/constructionCalculator';

export default function SlopeConverterPanel() {
  const toggleSlopeConverter = useMetreStore((s) => s.toggleSlopeConverter);

  const [pitch, setPitch] = useState('6');
  const [degrees, setDegrees] = useState('26.57');
  const [percent, setPercent] = useState('50');
  const [activeField, setActiveField] = useState<'pitch' | 'deg' | 'pct'>('pitch');

  const round = (n: number, d = 2) => {
    const r = Math.round(n * 10 ** d) / 10 ** d;
    return isFinite(r) ? r : 0;
  };

  const onPitchChange = useCallback((val: string) => {
    setPitch(val);
    setActiveField('pitch');
    const n = parseFloat(val);
    if (!isNaN(n) && isFinite(n)) {
      setDegrees(String(round(pitchToAngle(n))));
      setPercent(String(round(pitchToPercent(n))));
    }
  }, []);

  const onDegreesChange = useCallback((val: string) => {
    setDegrees(val);
    setActiveField('deg');
    const n = parseFloat(val);
    if (!isNaN(n) && isFinite(n)) {
      setPitch(String(round(degreesToPitch(n))));
      setPercent(String(round(degreesToPercent(n))));
    }
  }, []);

  const onPercentChange = useCallback((val: string) => {
    setPercent(val);
    setActiveField('pct');
    const n = parseFloat(val);
    if (!isNaN(n) && isFinite(n)) {
      setPitch(String(round(percentToPitch(n))));
      setDegrees(String(round(percentToDegrees(n))));
    }
  }, []);

  const selectPreset = useCallback((p: number) => {
    onPitchChange(String(p));
  }, [onPitchChange]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/60">
      <div className="bg-metre-surface border border-metre-border rounded-xl shadow-xl w-[420px] max-h-[92vh] flex flex-col outline-none" tabIndex={-1}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-metre-border">
          <h2 className="text-sm font-semibold text-metre-text flex items-center gap-2">
            <Triangle className="w-4 h-4" /> Convertisseur de Pente
          </h2>
          <button
            onClick={toggleSlopeConverter}
            className="p-1 rounded hover:bg-metre-panel text-metre-muted hover:text-metre-text transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Visual slope indicator */}
          <div className="rounded-lg border border-metre-border overflow-hidden p-4 flex items-end justify-center bg-gradient-to-b from-[#f0fdf4] to-[#dcfce7] dark:from-[#022c22] dark:to-[#064e3b]"
               style={{ height: 120 }}>
            <SlopeVisual pitch={parseFloat(pitch) || 0} />
          </div>

          {/* Three input fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-metre-muted mb-1 font-semibold">
                Pente (x:12)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.5"
                  value={pitch}
                  onChange={(e) => onPitchChange(e.target.value)}
                  className={`input-field text-center text-lg font-mono pr-8 ${activeField === 'pitch' ? 'border-emerald-500' : ''}`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-metre-muted">/12</span>
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-metre-muted mb-1 font-semibold">
                Degrés
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.5"
                  value={degrees}
                  onChange={(e) => onDegreesChange(e.target.value)}
                  className={`input-field text-center text-lg font-mono pr-6 ${activeField === 'deg' ? 'border-emerald-500' : ''}`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-metre-muted">°</span>
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-metre-muted mb-1 font-semibold">
                Pourcentage
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  value={percent}
                  onChange={(e) => onPercentChange(e.target.value)}
                  className={`input-field text-center text-lg font-mono pr-6 ${activeField === 'pct' ? 'border-emerald-500' : ''}`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-metre-muted">%</span>
              </div>
            </div>
          </div>

          {/* Quick preset buttons */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-metre-muted mb-2 font-semibold">
              Pentes courantes
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((p) => (
                <button
                  key={p}
                  onClick={() => selectPreset(p)}
                  className={`h-9 text-xs font-bold rounded-lg transition-colors ${
                    Math.round(parseFloat(pitch)) === p
                      ? 'bg-emerald-600 text-white'
                      : 'bg-metre-panel hover:bg-metre-border-light text-metre-text'
                  }`}
                >
                  {p}/12
                </button>
              ))}
            </div>
          </div>

          {/* Reference table */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-metre-muted mb-2 font-semibold">
              Table de référence
            </div>
            <div className="border border-metre-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-metre-panel text-metre-muted">
                    <th className="px-2 py-1.5 text-left font-semibold">Pente</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Degrés</th>
                    <th className="px-2 py-1.5 text-right font-semibold">%</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {PITCH_TABLE.map((row) => (
                    <tr
                      key={row.pitch}
                      onClick={() => selectPreset(row.pitch)}
                      className={`cursor-pointer transition-colors ${
                        Math.round(parseFloat(pitch)) === row.pitch
                          ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                          : 'hover:bg-metre-panel text-metre-text'
                      }`}
                    >
                      <td className="px-2 py-1 font-mono">{row.pitch}:12</td>
                      <td className="px-2 py-1 font-mono text-right">{row.deg}°</td>
                      <td className="px-2 py-1 font-mono text-right">{row.pct}%</td>
                      <td className="px-2 py-1 text-metre-muted">{row.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Visual slope triangle ────────────────────────────────── */

function SlopeVisual({ pitch }: { pitch: number }) {
  const clampedPitch = Math.max(0, Math.min(24, pitch));
  const angle = Math.atan(clampedPitch / 12);
  const baseW = 140;
  const riseH = baseW * Math.tan(angle);
  const maxH = 80;
  const scale = riseH > maxH ? maxH / riseH : 1;
  const w = baseW * scale;
  const h = riseH * scale;

  const deg = pitchToAngle(clampedPitch);
  const pct = clampedPitch / 12 * 100;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={w + 40} height={h + 30} className="overflow-visible">
        {/* Triangle */}
        <polygon
          points={`20,${h + 10} ${w + 20},${h + 10} ${w + 20},10`}
          fill="rgba(34,197,94,0.15)"
          stroke="#22c55e"
          strokeWidth="2"
        />
        {/* Run label */}
        <text x={(w / 2) + 20} y={h + 26} textAnchor="middle" fill="#71717a" fontSize="10" fontFamily="monospace">
          12
        </text>
        {/* Rise label */}
        <text x={w + 32} y={(h / 2) + 10} textAnchor="middle" fill="#71717a" fontSize="10" fontFamily="monospace">
          {round2(clampedPitch)}
        </text>
        {/* Angle arc */}
        {deg > 0.5 && (
          <path
            d={describeArc(20, h + 10, 20, 0, -angle)}
            fill="none"
            stroke="#22c55e"
            strokeWidth="1.5"
            opacity="0.6"
          />
        )}
      </svg>
      <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
        {round2(clampedPitch)}:12 = {round2(deg)}° = {round2(pct)}%
      </div>
    </div>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const startX = cx + r * Math.cos(startAngle);
  const startY = cy + r * Math.sin(startAngle);
  const endX = cx + r * Math.cos(endAngle);
  const endY = cy + r * Math.sin(endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
  return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 0 ${endX} ${endY}`;
}
