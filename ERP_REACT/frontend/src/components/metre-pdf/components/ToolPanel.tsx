import React from 'react';
import type { Tool } from '../types';
import { useMetreStore } from '../store';
import { Tooltip } from './ui/Tooltip';

interface ToolDef {
  id: Tool;
  label: string;
  shortcut: string;
  icon: string; // SVG path or emoji fallback
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Sélection', shortcut: 'V', icon: 'cursor' },
  { id: 'distance', label: 'Distance', shortcut: 'D', icon: 'ruler' },
  { id: 'area', label: 'Aire', shortcut: 'A', icon: 'square' },
  { id: 'perimeter', label: 'Périmètre', shortcut: 'P', icon: 'polyline' },
  { id: 'angle', label: 'Angle', shortcut: 'G', icon: 'angle' },
  { id: 'count', label: 'Comptage', shortcut: 'C', icon: 'hash' },
  { id: 'calibrate', label: 'Calibration', shortcut: 'K', icon: 'calibrate' },
  { id: 'pan', label: 'Déplacer', shortcut: 'Espace', icon: 'hand' },
];

/** SVG icon for each tool. */
const ToolIcon: React.FC<{ name: string; size?: number }> = ({
  name,
  size = 20,
}) => {
  const s = size;
  const half = s / 2;

  const paths: Record<string, React.ReactNode> = {
    cursor: (
      <path
        d="M4 2 L4 16 L8 12 L13 18 L15 16 L10 10 L15 10 Z"
        fill="currentColor"
      />
    ),
    ruler: (
      <>
        <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="2" />
        <line x1="7" y1="17" x2="9" y2="15" stroke="currentColor" strokeWidth="1.5" />
        <line x1="11" y1="13" x2="13" y2="11" stroke="currentColor" strokeWidth="1.5" />
      </>
    ),
    square: (
      <rect
        x="3"
        y="3"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    ),
    polyline: (
      <polyline
        points="3,17 8,5 14,12 17,3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    ),
    angle: (
      <>
        <polyline
          points="3,17 10,10 17,17"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M7 13 A5 5 0 0 1 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
      </>
    ),
    hash: (
      <>
        <circle cx={half} cy={half} r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <text
          x={half}
          y={half + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="currentColor"
          fontSize="10"
          fontWeight="bold"
        >
          #
        </text>
      </>
    ),
    calibrate: (
      <>
        <line x1="3" y1={half} x2="17" y2={half} stroke="currentColor" strokeWidth="2" />
        <line x1="3" y1="6" x2="3" y2="14" stroke="currentColor" strokeWidth="1.5" />
        <line x1="17" y1="6" x2="17" y2="14" stroke="currentColor" strokeWidth="1.5" />
        <line x1="8" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" />
      </>
    ),
    hand: (
      <path
        d="M10 3 C10 3 10 1 12 1 C14 1 14 3 14 3 L14 8 C14 8 14 7 16 7 C18 7 18 9 18 9 L18 14 C18 18 14 19 12 19 L9 19 C6 19 4 17 4 14 L4 9 C4 7 6 7 6 7 C8 7 8 8 8 9 L8 5 C8 3 10 3 10 3 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ),
  };

  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 20 20"
      className="shrink-0"
    >
      {paths[name] ?? paths.cursor}
    </svg>
  );
};

export const ToolPanel: React.FC = () => {
  const activeTool = useMetreStore((s) => s.activeTool);
  const setTool = useMetreStore((s) => s.setTool);
  const snapEnabled = useMetreStore((s) => s.snapEnabled);
  const orthoEnabled = useMetreStore((s) => s.orthoEnabled);
  const toggleSnap = useMetreStore((s) => s.toggleSnap);
  const toggleOrtho = useMetreStore((s) => s.toggleOrtho);

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 dark:border-neutral-700 bg-white/95 dark:bg-neutral-900/95 p-1.5 shadow-lg backdrop-blur-sm">
      {/* Tool buttons */}
      {TOOLS.map((tool) => {
        const isActive = activeTool === tool.id;
        return (
          <Tooltip key={tool.id} content={`${tool.label} (${tool.shortcut})`} side="right">
            <button
              type="button"
              onClick={() => setTool(tool.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-900 dark:hover:text-white'
              }`}
              aria-label={tool.label}
            >
              <ToolIcon name={tool.icon} />
            </button>
          </Tooltip>
        );
      })}

      {/* Divider */}
      <div className="my-1 border-t border-slate-200 dark:border-neutral-700" />

      {/* Toggle buttons */}
      <Tooltip content={`Accrochage (S) ${snapEnabled ? 'ON' : 'OFF'}`} side="right">
        <button
          type="button"
          onClick={toggleSnap}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold transition-colors ${
            snapEnabled
              ? 'bg-emerald-700 text-white'
              : 'text-slate-400 dark:text-neutral-500 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-900 dark:hover:text-white'
          }`}
          aria-label="Toggle snap"
        >
          SN
        </button>
      </Tooltip>

      <Tooltip content={`Ortho (O) ${orthoEnabled ? 'ON' : 'OFF'}`} side="right">
        <button
          type="button"
          onClick={toggleOrtho}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold transition-colors ${
            orthoEnabled
              ? 'bg-emerald-700 text-white'
              : 'text-slate-400 dark:text-neutral-500 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-900 dark:hover:text-white'
          }`}
          aria-label="Toggle ortho"
        >
          OR
        </button>
      </Tooltip>
    </div>
  );
};
