/**
 * defaultSymbolBlocks.ts — Default architectural symbol catalog.
 *
 * Each symbol is defined with normalized 0-1 coordinates inside its bounding box.
 * widthReal / heightReal are in meters (real-world default dimensions).
 * view: 'plan' (top-down), 'elevation' (front), 'droite' (right side)
 *
 * Conversion notes:
 *   1 inch = 0.0254 m
 *   36" = 0.9144 m,  30" = 0.762 m,  24" = 0.6096 m
 */

import type { SymbolBlockDef } from '../types';

// Helper: inches to meters
const inM = (inches: number) => inches * 0.0254;

export const DEFAULT_SYMBOL_BLOCKS: SymbolBlockDef[] = [
  // ═══════════════════════════════════════
  // PORTES (Doors) — PLAN
  // ═══════════════════════════════════════
  {
    id: 'door-swing-24', name: 'Porte battante 24po', category: 'Portes', view: 'plan',
    widthReal: inM(24), heightReal: inM(24), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 1, 0, 0] },
      { type: 'line', data: [1, 1, 1, 0.95] },
      { type: 'line', data: [0, 0, 1, 0] },
      { type: 'arc', data: [0, 1, 1, -90, 0] },
    ],
  },
  {
    id: 'door-swing-28', name: 'Porte battante 28po', category: 'Portes', view: 'plan',
    widthReal: inM(28), heightReal: inM(28), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 1, 0, 0] },
      { type: 'line', data: [1, 1, 1, 0.95] },
      { type: 'line', data: [0, 0, 1, 0] },
      { type: 'arc', data: [0, 1, 1, -90, 0] },
    ],
  },
  {
    id: 'door-swing-30', name: 'Porte battante 30po', category: 'Portes', view: 'plan',
    widthReal: inM(30), heightReal: inM(30), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 1, 0, 0] },
      { type: 'line', data: [1, 1, 1, 0.95] },
      { type: 'line', data: [0, 0, 1, 0] },
      { type: 'arc', data: [0, 1, 1, -90, 0] },
    ],
  },
  {
    id: 'door-swing-32', name: 'Porte battante 32po', category: 'Portes', view: 'plan',
    widthReal: inM(32), heightReal: inM(32), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 1, 0, 0] },
      { type: 'line', data: [1, 1, 1, 0.95] },
      { type: 'line', data: [0, 0, 1, 0] },
      { type: 'arc', data: [0, 1, 1, -90, 0] },
    ],
  },
  {
    id: 'door-swing-34', name: 'Porte battante 34po', category: 'Portes', view: 'plan',
    widthReal: inM(34), heightReal: inM(34), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 1, 0, 0] },
      { type: 'line', data: [1, 1, 1, 0.95] },
      { type: 'line', data: [0, 0, 1, 0] },
      { type: 'arc', data: [0, 1, 1, -90, 0] },
    ],
  },
  {
    id: 'door-swing-36', name: 'Porte battante 36po', category: 'Portes', view: 'plan',
    widthReal: inM(36), heightReal: inM(36), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 1, 0, 0] },
      { type: 'line', data: [1, 1, 1, 0.95] },
      { type: 'line', data: [0, 0, 1, 0] },
      { type: 'arc', data: [0, 1, 1, -90, 0] },
    ],
  },
  {
    id: 'door-double-60', name: 'Porte double 60po', category: 'Portes', view: 'plan',
    widthReal: inM(60), heightReal: inM(30), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 1, 0, 0] },
      { type: 'line', data: [0, 0, 0.5, 0] },
      { type: 'arc', data: [0, 1, 0.5, -90, 0] },
      { type: 'line', data: [1, 1, 1, 0] },
      { type: 'line', data: [1, 0, 0.5, 0] },
      { type: 'arc', data: [1, 1, 0.5, -180, -90] },
    ],
  },
  {
    id: 'door-sliding-60', name: 'Porte coulissante 60po', category: 'Portes', view: 'plan',
    widthReal: inM(60), heightReal: inM(6), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 0, 0, 1] },
      { type: 'line', data: [1, 0, 1, 1] },
      { type: 'line', data: [0.02, 0.3, 0.55, 0.3] },
      { type: 'line', data: [0.02, 0.7, 0.55, 0.7] },
      { type: 'line', data: [0.3, 0.5, 0.55, 0.5] },
    ],
  },
  {
    id: 'door-garage-96', name: 'Porte garage 8pi', category: 'Portes', view: 'plan',
    widthReal: inM(96), heightReal: inM(6), color: '#06b6d4',
    paths: [
      { type: 'line', data: [0, 0, 0, 1] },
      { type: 'line', data: [1, 0, 1, 1] },
      { type: 'line', data: [0, 0, 1, 0] },
      { type: 'line', data: [0, 1, 1, 1] },
      { type: 'line', data: [0, 0.25, 1, 0.25] },
      { type: 'line', data: [0, 0.5, 1, 0.5] },
      { type: 'line', data: [0, 0.75, 1, 0.75] },
    ],
  },

  // ═══════════════════════════════════════
  // PORTES — ÉLÉVATION (front view)
  // ═══════════════════════════════════════
  {
    id: 'door-swing-24-elev', name: 'Porte battante 24po', category: 'Portes', view: 'elevation',
    widthReal: inM(24), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.08, 0.05, 0.84, 0.42] },
      { type: 'rect', data: [0.08, 0.53, 0.84, 0.42] },
      { type: 'arc', data: [0.85, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-28-elev', name: 'Porte battante 28po', category: 'Portes', view: 'elevation',
    widthReal: inM(28), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.08, 0.05, 0.84, 0.42] },
      { type: 'rect', data: [0.08, 0.53, 0.84, 0.42] },
      { type: 'arc', data: [0.85, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-30-elev', name: 'Porte battante 30po', category: 'Portes', view: 'elevation',
    widthReal: inM(30), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.08, 0.05, 0.84, 0.42] },
      { type: 'rect', data: [0.08, 0.53, 0.84, 0.42] },
      { type: 'arc', data: [0.85, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-32-elev', name: 'Porte battante 32po', category: 'Portes', view: 'elevation',
    widthReal: inM(32), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.08, 0.05, 0.84, 0.42] },
      { type: 'rect', data: [0.08, 0.53, 0.84, 0.42] },
      { type: 'arc', data: [0.85, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-34-elev', name: 'Porte battante 34po', category: 'Portes', view: 'elevation',
    widthReal: inM(34), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.08, 0.05, 0.84, 0.42] },
      { type: 'rect', data: [0.08, 0.53, 0.84, 0.42] },
      { type: 'arc', data: [0.85, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-36-elev', name: 'Porte battante 36po', category: 'Portes', view: 'elevation',
    widthReal: inM(36), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.08, 0.05, 0.84, 0.42] },
      { type: 'rect', data: [0.08, 0.53, 0.84, 0.42] },
      { type: 'arc', data: [0.85, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-double-60-elev', name: 'Porte double 60po', category: 'Portes', view: 'elevation',
    widthReal: inM(60), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
      { type: 'rect', data: [0.05, 0.05, 0.4, 0.42] },
      { type: 'rect', data: [0.05, 0.53, 0.4, 0.42] },
      { type: 'rect', data: [0.55, 0.05, 0.4, 0.42] },
      { type: 'rect', data: [0.55, 0.53, 0.4, 0.42] },
      { type: 'arc', data: [0.42, 0.5, 0.03, 0, 360] },
      { type: 'arc', data: [0.58, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-sliding-60-elev', name: 'Porte coulissante 60po', category: 'Portes', view: 'elevation',
    widthReal: inM(60), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
      { type: 'rect', data: [0.05, 0.05, 0.42, 0.9] },
      { type: 'rect', data: [0.53, 0.05, 0.42, 0.9] },
      { type: 'line', data: [0.25, 0.5, 0.45, 0.5] },
    ],
  },
  {
    id: 'door-garage-96-elev', name: 'Porte garage 8pi', category: 'Portes', view: 'elevation',
    widthReal: inM(96), heightReal: inM(84), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0, 0.25, 1, 0.25] },
      { type: 'line', data: [0, 0.5, 1, 0.5] },
      { type: 'line', data: [0, 0.75, 1, 0.75] },
      { type: 'line', data: [0.33, 0, 0.33, 1] },
      { type: 'line', data: [0.67, 0, 0.67, 1] },
    ],
  },

  // ═══════════════════════════════════════
  // PORTES — DROITE (right side view)
  // ═══════════════════════════════════════
  {
    id: 'door-swing-24-dr', name: 'Porte battante 24po', category: 'Portes', view: 'droite',
    widthReal: inM(2), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'arc', data: [0.75, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-28-dr', name: 'Porte battante 28po', category: 'Portes', view: 'droite',
    widthReal: inM(2), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'arc', data: [0.75, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-30-dr', name: 'Porte battante 30po', category: 'Portes', view: 'droite',
    widthReal: inM(2), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'arc', data: [0.75, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-32-dr', name: 'Porte battante 32po', category: 'Portes', view: 'droite',
    widthReal: inM(2), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'arc', data: [0.75, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-34-dr', name: 'Porte battante 34po', category: 'Portes', view: 'droite',
    widthReal: inM(2), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'arc', data: [0.75, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-swing-36-dr', name: 'Porte battante 36po', category: 'Portes', view: 'droite',
    widthReal: inM(2), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'arc', data: [0.75, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-double-60-dr', name: 'Porte double 60po', category: 'Portes', view: 'droite',
    widthReal: inM(4), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
      { type: 'arc', data: [0.25, 0.5, 0.03, 0, 360] },
      { type: 'arc', data: [0.75, 0.5, 0.03, 0, 360] },
    ],
  },
  {
    id: 'door-sliding-60-dr', name: 'Porte coulissante 60po', category: 'Portes', view: 'droite',
    widthReal: inM(4), heightReal: inM(80), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.15, 0.05, 0.7, 0.9] },
    ],
  },
  {
    id: 'door-garage-96-dr', name: 'Porte garage 8pi', category: 'Portes', view: 'droite',
    widthReal: inM(4), heightReal: inM(84), color: '#06b6d4',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0, 0.25, 1, 0.25] },
      { type: 'line', data: [0, 0.5, 1, 0.5] },
      { type: 'line', data: [0, 0.75, 1, 0.75] },
    ],
  },

  // ═══════════════════════════════════════
  // FENÊTRES (Windows) — PLAN
  // ═══════════════════════════════════════
  {
    id: 'window-single-24', name: 'Fenêtre simple 24po', category: 'Fenêtres', view: 'plan',
    widthReal: inM(24), heightReal: inM(4), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
    ],
  },
  {
    id: 'window-single-30', name: 'Fenêtre simple 30po', category: 'Fenêtres', view: 'plan',
    widthReal: inM(30), heightReal: inM(4), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
    ],
  },
  {
    id: 'window-single-36', name: 'Fenêtre simple 36po', category: 'Fenêtres', view: 'plan',
    widthReal: inM(36), heightReal: inM(4), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
    ],
  },
  {
    id: 'window-double-48', name: 'Fenêtre double 48po', category: 'Fenêtres', view: 'plan',
    widthReal: inM(48), heightReal: inM(4), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.33, 0, 0.33, 1] },
      { type: 'line', data: [0.67, 0, 0.67, 1] },
    ],
  },
  {
    id: 'window-sliding-60', name: 'Fenêtre coulissante 60po', category: 'Fenêtres', view: 'plan',
    widthReal: inM(60), heightReal: inM(4), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
      { type: 'line', data: [0.3, 0.5, 0.48, 0.5] },
    ],
  },
  {
    id: 'window-bay-72', name: 'Baie vitrée 72po', category: 'Fenêtres', view: 'plan',
    widthReal: inM(72), heightReal: inM(4), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.25, 0, 0.25, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
      { type: 'line', data: [0.75, 0, 0.75, 1] },
    ],
  },

  // ═══════════════════════════════════════
  // FENÊTRES — ÉLÉVATION
  // ═══════════════════════════════════════
  {
    id: 'window-single-24-elev', name: 'Fenêtre simple 24po', category: 'Fenêtres', view: 'elevation',
    widthReal: inM(24), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'line', data: [0.05, 0.5, 0.95, 0.5] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-single-30-elev', name: 'Fenêtre simple 30po', category: 'Fenêtres', view: 'elevation',
    widthReal: inM(30), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'line', data: [0.05, 0.5, 0.95, 0.5] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-single-36-elev', name: 'Fenêtre simple 36po', category: 'Fenêtres', view: 'elevation',
    widthReal: inM(36), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.05, 0.5, 0.95] },
      { type: 'line', data: [0.05, 0.5, 0.95, 0.5] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-double-48-elev', name: 'Fenêtre double 48po', category: 'Fenêtres', view: 'elevation',
    widthReal: inM(48), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.33, 0, 0.33, 1] },
      { type: 'line', data: [0.67, 0, 0.67, 1] },
      { type: 'line', data: [0.05, 0.5, 0.95, 0.5] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-sliding-60-elev', name: 'Fenêtre coulissante 60po', category: 'Fenêtres', view: 'elevation',
    widthReal: inM(60), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
      { type: 'line', data: [0.05, 0.5, 0.95, 0.5] },
      { type: 'line', data: [0.3, 0.25, 0.48, 0.25] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-bay-72-elev', name: 'Baie vitrée 72po', category: 'Fenêtres', view: 'elevation',
    widthReal: inM(72), heightReal: inM(60), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.25, 0, 0.25, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
      { type: 'line', data: [0.75, 0, 0.75, 1] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },

  // ═══════════════════════════════════════
  // FENÊTRES — DROITE
  // ═══════════════════════════════════════
  {
    id: 'window-single-24-dr', name: 'Fenêtre simple 24po', category: 'Fenêtres', view: 'droite',
    widthReal: inM(6), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.3, 0.05, 0.3, 0.95] },
      { type: 'line', data: [0.7, 0.05, 0.7, 0.95] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-single-30-dr', name: 'Fenêtre simple 30po', category: 'Fenêtres', view: 'droite',
    widthReal: inM(6), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.3, 0.05, 0.3, 0.95] },
      { type: 'line', data: [0.7, 0.05, 0.7, 0.95] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-single-36-dr', name: 'Fenêtre simple 36po', category: 'Fenêtres', view: 'droite',
    widthReal: inM(6), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.3, 0.05, 0.3, 0.95] },
      { type: 'line', data: [0.7, 0.05, 0.7, 0.95] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-double-48-dr', name: 'Fenêtre double 48po', category: 'Fenêtres', view: 'droite',
    widthReal: inM(6), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.3, 0.05, 0.3, 0.95] },
      { type: 'line', data: [0.7, 0.05, 0.7, 0.95] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-sliding-60-dr', name: 'Fenêtre coulissante 60po', category: 'Fenêtres', view: 'droite',
    widthReal: inM(6), heightReal: inM(36), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.3, 0.05, 0.3, 0.95] },
      { type: 'line', data: [0.7, 0.05, 0.7, 0.95] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },
  {
    id: 'window-bay-72-dr', name: 'Baie vitrée 72po', category: 'Fenêtres', view: 'droite',
    widthReal: inM(6), heightReal: inM(60), color: '#3b82f6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.3, 0.05, 0.3, 0.95] },
      { type: 'line', data: [0.7, 0.05, 0.7, 0.95] },
      { type: 'line', data: [0, 1.02, 1, 1.02] },
    ],
  },

  // ═══════════════════════════════════════
  // SANITAIRE — PLAN
  // ═══════════════════════════════════════
  {
    id: 'toilet', name: 'Toilette', category: 'Sanitaire', view: 'plan',
    widthReal: inM(18), heightReal: inM(28), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0.15, 0, 0.7, 0.3] },
      { type: 'line', data: [0.1, 0.3, 0.1, 0.7] },
      { type: 'line', data: [0.9, 0.3, 0.9, 0.7] },
      { type: 'arc', data: [0.5, 0.7, 0.4, 0, 180] },
      { type: 'line', data: [0.1, 0.3, 0.9, 0.3] },
    ],
  },
  {
    id: 'sink-vanity', name: 'Lavabo vanité', category: 'Sanitaire', view: 'plan',
    widthReal: inM(24), heightReal: inM(20), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'arc', data: [0.5, 0.5, 0.3, 0, 360] },
    ],
  },
  {
    id: 'bathtub-60', name: 'Bain 60po', category: 'Sanitaire', view: 'plan',
    widthReal: inM(60), heightReal: inM(30), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.05, 0.05, 0.9, 0.9] },
      { type: 'arc', data: [0.85, 0.5, 0.04, 0, 360] },
    ],
  },
  {
    id: 'shower-36', name: 'Douche 36po', category: 'Sanitaire', view: 'plan',
    widthReal: inM(36), heightReal: inM(36), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0, 0, 1, 1] },
      { type: 'arc', data: [0.5, 0.5, 0.06, 0, 360] },
    ],
  },

  // ═══════════════════════════════════════
  // SANITAIRE — ÉLÉVATION
  // ═══════════════════════════════════════
  {
    id: 'toilet-elev', name: 'Toilette', category: 'Sanitaire', view: 'elevation',
    widthReal: inM(18), heightReal: inM(28), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0.2, 0, 0.6, 0.35] },
      { type: 'rect', data: [0.1, 0.35, 0.8, 0.3] },
      { type: 'arc', data: [0.5, 0.65, 0.4, 0, 180] },
      { type: 'line', data: [0.1, 0.65, 0.9, 0.65] },
    ],
  },
  {
    id: 'sink-vanity-elev', name: 'Lavabo vanité', category: 'Sanitaire', view: 'elevation',
    widthReal: inM(24), heightReal: inM(34), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0.4, 1, 0.6] },
      { type: 'rect', data: [0.15, 0.4, 0.7, 0.2] },
      { type: 'arc', data: [0.5, 0.35, 0.05, 0, 360] },
      { type: 'line', data: [0.5, 0.6, 0.5, 0.95] },
    ],
  },
  {
    id: 'bathtub-60-elev', name: 'Bain 60po', category: 'Sanitaire', view: 'elevation',
    widthReal: inM(60), heightReal: inM(20), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0.3, 1, 0.7] },
      { type: 'line', data: [0, 0.3, 0.05, 0] },
      { type: 'line', data: [1, 0.3, 0.95, 0] },
      { type: 'arc', data: [0.9, 0.35, 0.03, 0, 360] },
    ],
  },
  {
    id: 'shower-36-elev', name: 'Douche 36po', category: 'Sanitaire', view: 'elevation',
    widthReal: inM(36), heightReal: inM(72), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.05, 0.05, 0.9, 0.9] },
      { type: 'arc', data: [0.5, 0.1, 0.08, 0, 360] },
      { type: 'line', data: [0.5, 0.18, 0.5, 0.35] },
      { type: 'line', data: [0.4, 0.25, 0.6, 0.25] },
    ],
  },

  // ═══════════════════════════════════════
  // SANITAIRE — DROITE
  // ═══════════════════════════════════════
  {
    id: 'toilet-dr', name: 'Toilette', category: 'Sanitaire', view: 'droite',
    widthReal: inM(28), heightReal: inM(28), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0.6, 0, 0.4, 0.4] },
      { type: 'line', data: [0.6, 0.4, 0.1, 0.4] },
      { type: 'arc', data: [0.35, 0.65, 0.35, -90, 90] },
      { type: 'line', data: [0.35, 0.65, 0.35, 1] },
      { type: 'line', data: [0, 1, 1, 1] },
    ],
  },
  {
    id: 'sink-vanity-dr', name: 'Lavabo vanité', category: 'Sanitaire', view: 'droite',
    widthReal: inM(20), heightReal: inM(34), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0.4, 1, 0.15] },
      { type: 'line', data: [0.3, 0.55, 0.3, 0.95] },
      { type: 'line', data: [0.7, 0.55, 0.7, 0.95] },
      { type: 'line', data: [0.2, 0.95, 0.8, 0.95] },
    ],
  },
  {
    id: 'bathtub-60-dr', name: 'Bain 60po', category: 'Sanitaire', view: 'droite',
    widthReal: inM(30), heightReal: inM(20), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0.3, 1, 0.7] },
      { type: 'line', data: [0, 0.3, 0, 0] },
      { type: 'line', data: [1, 0.3, 1, 0] },
    ],
  },
  {
    id: 'shower-36-dr', name: 'Douche 36po', category: 'Sanitaire', view: 'droite',
    widthReal: inM(36), heightReal: inM(72), color: '#8b5cf6',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.05, 0.05, 0.9, 0.9] },
      { type: 'arc', data: [0.5, 0.1, 0.06, 0, 360] },
      { type: 'line', data: [0.5, 0.16, 0.5, 0.3] },
    ],
  },

  // ═══════════════════════════════════════
  // CUISINE — PLAN
  // ═══════════════════════════════════════
  {
    id: 'stove-30', name: 'Cuisinière 30po', category: 'Cuisine', view: 'plan',
    widthReal: inM(30), heightReal: inM(25), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'arc', data: [0.25, 0.3, 0.12, 0, 360] },
      { type: 'arc', data: [0.75, 0.3, 0.12, 0, 360] },
      { type: 'arc', data: [0.25, 0.7, 0.1, 0, 360] },
      { type: 'arc', data: [0.75, 0.7, 0.1, 0, 360] },
    ],
  },
  {
    id: 'fridge-36', name: 'Réfrigérateur 36po', category: 'Cuisine', view: 'plan',
    widthReal: inM(36), heightReal: inM(30), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0, 0.5, 1] },
      { type: 'arc', data: [0.45, 0.5, 0.02, 0, 360] },
      { type: 'arc', data: [0.55, 0.5, 0.02, 0, 360] },
    ],
  },
  {
    id: 'dishwasher-24', name: 'Lave-vaisselle 24po', category: 'Cuisine', view: 'plan',
    widthReal: inM(24), heightReal: inM(24), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.1, 0.3, 0.9, 0.3] },
      { type: 'line', data: [0.1, 0.7, 0.9, 0.7] },
    ],
  },
  {
    id: 'sink-kitchen', name: 'Évier cuisine double', category: 'Cuisine', view: 'plan',
    widthReal: inM(33), heightReal: inM(22), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.05, 0.1, 0.42, 0.8] },
      { type: 'rect', data: [0.53, 0.1, 0.42, 0.8] },
    ],
  },

  // ═══════════════════════════════════════
  // CUISINE — ÉLÉVATION
  // ═══════════════════════════════════════
  {
    id: 'stove-30-elev', name: 'Cuisinière 30po', category: 'Cuisine', view: 'elevation',
    widthReal: inM(30), heightReal: inM(36), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.05, 0.05, 0.9, 0.2] },
      { type: 'rect', data: [0.1, 0.35, 0.8, 0.55] },
      { type: 'arc', data: [0.5, 0.12, 0.03, 0, 360] },
    ],
  },
  {
    id: 'fridge-36-elev', name: 'Réfrigérateur 36po', category: 'Cuisine', view: 'elevation',
    widthReal: inM(36), heightReal: inM(70), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0, 0.35, 1, 0.35] },
      { type: 'rect', data: [0.05, 0.02, 0.9, 0.31] },
      { type: 'rect', data: [0.05, 0.38, 0.9, 0.58] },
      { type: 'line', data: [0.85, 0.15, 0.85, 0.22] },
      { type: 'line', data: [0.85, 0.55, 0.85, 0.75] },
    ],
  },
  {
    id: 'dishwasher-24-elev', name: 'Lave-vaisselle 24po', category: 'Cuisine', view: 'elevation',
    widthReal: inM(24), heightReal: inM(34), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.08, 0.08, 0.84, 0.84] },
      { type: 'line', data: [0.4, 0.04, 0.6, 0.04] },
      { type: 'arc', data: [0.5, 0.5, 0.04, 0, 360] },
    ],
  },
  {
    id: 'sink-kitchen-elev', name: 'Évier cuisine double', category: 'Cuisine', view: 'elevation',
    widthReal: inM(33), heightReal: inM(10), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.05, 0.15, 0.42, 0.8] },
      { type: 'rect', data: [0.53, 0.15, 0.42, 0.8] },
      { type: 'arc', data: [0.5, 0.05, 0.04, 0, 360] },
    ],
  },

  // ═══════════════════════════════════════
  // CUISINE — DROITE
  // ═══════════════════════════════════════
  {
    id: 'stove-30-dr', name: 'Cuisinière 30po', category: 'Cuisine', view: 'droite',
    widthReal: inM(25), heightReal: inM(36), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0, 0.25, 1, 0.25] },
      { type: 'rect', data: [0.1, 0.35, 0.8, 0.55] },
    ],
  },
  {
    id: 'fridge-36-dr', name: 'Réfrigérateur 36po', category: 'Cuisine', view: 'droite',
    widthReal: inM(30), heightReal: inM(70), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0, 0.35, 1, 0.35] },
      { type: 'line', data: [0.85, 0.15, 0.85, 0.22] },
      { type: 'line', data: [0.85, 0.55, 0.85, 0.75] },
    ],
  },
  {
    id: 'dishwasher-24-dr', name: 'Lave-vaisselle 24po', category: 'Cuisine', view: 'droite',
    widthReal: inM(24), heightReal: inM(34), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.08, 0.08, 0.84, 0.84] },
      { type: 'line', data: [0.85, 0.45, 0.85, 0.55] },
    ],
  },
  {
    id: 'sink-kitchen-dr', name: 'Évier cuisine double', category: 'Cuisine', view: 'droite',
    widthReal: inM(22), heightReal: inM(10), color: '#f59e0b',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.1, 0.15, 0.8, 0.7] },
      { type: 'arc', data: [0.5, 0.05, 0.04, 0, 360] },
    ],
  },

  // ═══════════════════════════════════════
  // ÉLECTRIQUE — PLAN
  // ═══════════════════════════════════════
  {
    id: 'elec-panel', name: 'Panneau électrique', category: 'Électrique', view: 'plan',
    widthReal: inM(20), heightReal: inM(30), color: '#ef4444',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.15, 0.35, 0.5] },
      { type: 'line', data: [0.35, 0.5, 0.6, 0.5] },
      { type: 'line', data: [0.6, 0.5, 0.45, 0.85] },
    ],
  },
  {
    id: 'elec-outlet', name: 'Prise électrique', category: 'Électrique', view: 'plan',
    widthReal: inM(3), heightReal: inM(3), color: '#ef4444',
    paths: [
      { type: 'arc', data: [0.5, 0.5, 0.5, 0, 360] },
      { type: 'line', data: [0.35, 0.35, 0.35, 0.55] },
      { type: 'line', data: [0.65, 0.35, 0.65, 0.55] },
    ],
  },
  {
    id: 'elec-switch', name: 'Interrupteur', category: 'Électrique', view: 'plan',
    widthReal: inM(3), heightReal: inM(3), color: '#ef4444',
    paths: [
      { type: 'arc', data: [0.5, 0.5, 0.5, 0, 360] },
      { type: 'line', data: [0.35, 0.35, 0.65, 0.35] },
      { type: 'line', data: [0.65, 0.35, 0.35, 0.65] },
      { type: 'line', data: [0.35, 0.65, 0.65, 0.65] },
    ],
  },

  // ═══════════════════════════════════════
  // ÉLECTRIQUE — ÉLÉVATION
  // ═══════════════════════════════════════
  {
    id: 'elec-panel-elev', name: 'Panneau électrique', category: 'Électrique', view: 'elevation',
    widthReal: inM(20), heightReal: inM(30), color: '#ef4444',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.1, 0.05, 0.8, 0.9] },
      { type: 'line', data: [0.5, 0.1, 0.5, 0.9] },
      { type: 'line', data: [0.1, 0.5, 0.9, 0.5] },
      { type: 'line', data: [0.5, 0.15, 0.35, 0.35] },
      { type: 'line', data: [0.35, 0.35, 0.6, 0.35] },
      { type: 'line', data: [0.6, 0.35, 0.45, 0.55] },
    ],
  },
  {
    id: 'elec-outlet-elev', name: 'Prise électrique', category: 'Électrique', view: 'elevation',
    widthReal: inM(3), heightReal: inM(5), color: '#ef4444',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.35, 0.25, 0.35, 0.45] },
      { type: 'line', data: [0.65, 0.25, 0.65, 0.45] },
      { type: 'arc', data: [0.5, 0.65, 0.06, 0, 180] },
    ],
  },
  {
    id: 'elec-switch-elev', name: 'Interrupteur', category: 'Électrique', view: 'elevation',
    widthReal: inM(3), heightReal: inM(5), color: '#ef4444',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'rect', data: [0.3, 0.2, 0.4, 0.6] },
      { type: 'line', data: [0.5, 0.35, 0.5, 0.55] },
    ],
  },

  // ═══════════════════════════════════════
  // ÉLECTRIQUE — DROITE
  // ═══════════════════════════════════════
  {
    id: 'elec-panel-dr', name: 'Panneau électrique', category: 'Électrique', view: 'droite',
    widthReal: inM(4), heightReal: inM(30), color: '#ef4444',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.2, 0.05, 0.2, 0.95] },
      { type: 'line', data: [0.8, 0.05, 0.8, 0.95] },
    ],
  },
  {
    id: 'elec-outlet-dr', name: 'Prise électrique', category: 'Électrique', view: 'droite',
    widthReal: inM(2), heightReal: inM(5), color: '#ef4444',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.2, 0.5, 0.8] },
    ],
  },
  {
    id: 'elec-switch-dr', name: 'Interrupteur', category: 'Électrique', view: 'droite',
    widthReal: inM(2), heightReal: inM(5), color: '#ef4444',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.5, 0.2, 0.5, 0.5] },
      { type: 'line', data: [0.5, 0.5, 0.8, 0.35] },
    ],
  },

  // ═══════════════════════════════════════
  // ESCALIERS — PLAN
  // ═══════════════════════════════════════
  {
    id: 'stairs-straight', name: 'Escalier droit', category: 'Escaliers', view: 'plan',
    widthReal: inM(36), heightReal: inM(120), color: '#10b981',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0, 0.083, 1, 0.083] },
      { type: 'line', data: [0, 0.167, 1, 0.167] },
      { type: 'line', data: [0, 0.25, 1, 0.25] },
      { type: 'line', data: [0, 0.333, 1, 0.333] },
      { type: 'line', data: [0, 0.417, 1, 0.417] },
      { type: 'line', data: [0, 0.5, 1, 0.5] },
      { type: 'line', data: [0, 0.583, 1, 0.583] },
      { type: 'line', data: [0, 0.667, 1, 0.667] },
      { type: 'line', data: [0, 0.75, 1, 0.75] },
      { type: 'line', data: [0, 0.833, 1, 0.833] },
      { type: 'line', data: [0, 0.917, 1, 0.917] },
      { type: 'line', data: [0.5, 0.9, 0.5, 0.1] },
      { type: 'line', data: [0.5, 0.1, 0.35, 0.2] },
      { type: 'line', data: [0.5, 0.1, 0.65, 0.2] },
    ],
  },
  {
    id: 'stairs-l-shape', name: 'Escalier en L', category: 'Escaliers', view: 'plan',
    widthReal: inM(72), heightReal: inM(72), color: '#10b981',
    paths: [
      { type: 'rect', data: [0, 0.5, 0.5, 0.5] },
      { type: 'line', data: [0, 0.583, 0.5, 0.583] },
      { type: 'line', data: [0, 0.667, 0.5, 0.667] },
      { type: 'line', data: [0, 0.75, 0.5, 0.75] },
      { type: 'line', data: [0, 0.833, 0.5, 0.833] },
      { type: 'line', data: [0, 0.917, 0.5, 0.917] },
      { type: 'rect', data: [0, 0, 0.5, 0.5] },
      { type: 'rect', data: [0.5, 0, 0.5, 0.5] },
      { type: 'line', data: [0.583, 0, 0.583, 0.5] },
      { type: 'line', data: [0.667, 0, 0.667, 0.5] },
      { type: 'line', data: [0.75, 0, 0.75, 0.5] },
      { type: 'line', data: [0.833, 0, 0.833, 0.5] },
      { type: 'line', data: [0.917, 0, 0.917, 0.5] },
    ],
  },

  // ═══════════════════════════════════════
  // ESCALIERS — ÉLÉVATION
  // ═══════════════════════════════════════
  {
    id: 'stairs-straight-elev', name: 'Escalier droit', category: 'Escaliers', view: 'elevation',
    widthReal: inM(120), heightReal: inM(108), color: '#10b981',
    paths: [
      { type: 'line', data: [0, 1, 0.083, 1] },
      { type: 'line', data: [0.083, 1, 0.083, 0.917] },
      { type: 'line', data: [0.083, 0.917, 0.167, 0.917] },
      { type: 'line', data: [0.167, 0.917, 0.167, 0.833] },
      { type: 'line', data: [0.167, 0.833, 0.25, 0.833] },
      { type: 'line', data: [0.25, 0.833, 0.25, 0.75] },
      { type: 'line', data: [0.25, 0.75, 0.333, 0.75] },
      { type: 'line', data: [0.333, 0.75, 0.333, 0.667] },
      { type: 'line', data: [0.333, 0.667, 0.417, 0.667] },
      { type: 'line', data: [0.417, 0.667, 0.417, 0.583] },
      { type: 'line', data: [0.417, 0.583, 0.5, 0.583] },
      { type: 'line', data: [0.5, 0.583, 0.5, 0.5] },
      { type: 'line', data: [0.5, 0.5, 0.583, 0.5] },
      { type: 'line', data: [0.583, 0.5, 0.583, 0.417] },
      { type: 'line', data: [0.583, 0.417, 0.667, 0.417] },
      { type: 'line', data: [0.667, 0.417, 0.667, 0.333] },
      { type: 'line', data: [0.667, 0.333, 0.75, 0.333] },
      { type: 'line', data: [0.75, 0.333, 0.75, 0.25] },
      { type: 'line', data: [0.75, 0.25, 0.833, 0.25] },
      { type: 'line', data: [0.833, 0.25, 0.833, 0.167] },
      { type: 'line', data: [0.833, 0.167, 0.917, 0.167] },
      { type: 'line', data: [0.917, 0.167, 0.917, 0.083] },
      { type: 'line', data: [0.917, 0.083, 1, 0.083] },
      { type: 'line', data: [1, 0.083, 1, 0] },
    ],
  },
  {
    id: 'stairs-l-shape-elev', name: 'Escalier en L', category: 'Escaliers', view: 'elevation',
    widthReal: inM(72), heightReal: inM(108), color: '#10b981',
    paths: [
      { type: 'line', data: [0, 1, 0.1, 1] },
      { type: 'line', data: [0.1, 1, 0.1, 0.9] },
      { type: 'line', data: [0.1, 0.9, 0.2, 0.9] },
      { type: 'line', data: [0.2, 0.9, 0.2, 0.8] },
      { type: 'line', data: [0.2, 0.8, 0.3, 0.8] },
      { type: 'line', data: [0.3, 0.8, 0.3, 0.7] },
      { type: 'line', data: [0.3, 0.7, 0.4, 0.7] },
      { type: 'line', data: [0.4, 0.7, 0.4, 0.6] },
      { type: 'line', data: [0.4, 0.6, 0.5, 0.6] },
      { type: 'line', data: [0.5, 0.6, 0.5, 0.5] },
      { type: 'rect', data: [0.5, 0.4, 0.15, 0.1] },
      { type: 'line', data: [0.65, 0.4, 0.75, 0.4] },
      { type: 'line', data: [0.75, 0.4, 0.75, 0.3] },
      { type: 'line', data: [0.75, 0.3, 0.85, 0.3] },
      { type: 'line', data: [0.85, 0.3, 0.85, 0.2] },
      { type: 'line', data: [0.85, 0.2, 0.95, 0.2] },
      { type: 'line', data: [0.95, 0.2, 0.95, 0.1] },
      { type: 'line', data: [0.95, 0.1, 1, 0.1] },
      { type: 'line', data: [1, 0.1, 1, 0] },
    ],
  },

  // ═══════════════════════════════════════
  // ESCALIERS — DROITE
  // ═══════════════════════════════════════
  {
    id: 'stairs-straight-dr', name: 'Escalier droit', category: 'Escaliers', view: 'droite',
    widthReal: inM(36), heightReal: inM(108), color: '#10b981',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0.1, 0, 0.1, 1] },
      { type: 'line', data: [0.9, 0, 0.9, 1] },
      { type: 'line', data: [0, 0.5, 1, 0.5] },
    ],
  },
  {
    id: 'stairs-l-shape-dr', name: 'Escalier en L', category: 'Escaliers', view: 'droite',
    widthReal: inM(36), heightReal: inM(108), color: '#10b981',
    paths: [
      { type: 'rect', data: [0, 0, 1, 0.5] },
      { type: 'rect', data: [0, 0.5, 0.6, 0.5] },
      { type: 'line', data: [0.1, 0, 0.1, 1] },
      { type: 'line', data: [0, 0.5, 1, 0.5] },
    ],
  },

  // ═══════════════════════════════════════
  // MOBILIER — PLAN
  // ═══════════════════════════════════════
  {
    id: 'counter-section', name: 'Comptoir 24po', category: 'Mobilier', view: 'plan',
    widthReal: inM(48), heightReal: inM(25), color: '#6b7280',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
      { type: 'line', data: [0, 0.08, 1, 0.08] },
    ],
  },
  {
    id: 'table-rect', name: 'Table rectangulaire', category: 'Mobilier', view: 'plan',
    widthReal: inM(60), heightReal: inM(36), color: '#6b7280',
    paths: [
      { type: 'rect', data: [0, 0, 1, 1] },
    ],
  },
  {
    id: 'table-round', name: 'Table ronde 42po', category: 'Mobilier', view: 'plan',
    widthReal: inM(42), heightReal: inM(42), color: '#6b7280',
    paths: [
      { type: 'arc', data: [0.5, 0.5, 0.5, 0, 360] },
    ],
  },

  // ═══════════════════════════════════════
  // MOBILIER — ÉLÉVATION
  // ═══════════════════════════════════════
  {
    id: 'counter-section-elev', name: 'Comptoir 24po', category: 'Mobilier', view: 'elevation',
    widthReal: inM(48), heightReal: inM(36), color: '#6b7280',
    paths: [
      { type: 'rect', data: [0, 0, 1, 0.08] },
      { type: 'line', data: [0.05, 0.08, 0.05, 1] },
      { type: 'line', data: [0.95, 0.08, 0.95, 1] },
      { type: 'rect', data: [0.1, 0.12, 0.35, 0.4] },
      { type: 'rect', data: [0.55, 0.12, 0.35, 0.4] },
    ],
  },
  {
    id: 'table-rect-elev', name: 'Table rectangulaire', category: 'Mobilier', view: 'elevation',
    widthReal: inM(60), heightReal: inM(30), color: '#6b7280',
    paths: [
      { type: 'rect', data: [0, 0, 1, 0.08] },
      { type: 'line', data: [0.08, 0.08, 0.08, 1] },
      { type: 'line', data: [0.92, 0.08, 0.92, 1] },
    ],
  },
  {
    id: 'table-round-elev', name: 'Table ronde 42po', category: 'Mobilier', view: 'elevation',
    widthReal: inM(42), heightReal: inM(30), color: '#6b7280',
    paths: [
      { type: 'rect', data: [0.05, 0, 0.9, 0.08] },
      { type: 'line', data: [0.35, 0.08, 0.2, 1] },
      { type: 'line', data: [0.65, 0.08, 0.8, 1] },
    ],
  },

  // ═══════════════════════════════════════
  // MOBILIER — DROITE
  // ═══════════════════════════════════════
  {
    id: 'counter-section-dr', name: 'Comptoir 24po', category: 'Mobilier', view: 'droite',
    widthReal: inM(25), heightReal: inM(36), color: '#6b7280',
    paths: [
      { type: 'rect', data: [0, 0, 1, 0.08] },
      { type: 'line', data: [0.05, 0.08, 0.05, 1] },
      { type: 'line', data: [0.95, 0.08, 0.95, 1] },
      { type: 'line', data: [0, 0.1, 0.5, 0.1] },
    ],
  },
  {
    id: 'table-rect-dr', name: 'Table rectangulaire', category: 'Mobilier', view: 'droite',
    widthReal: inM(36), heightReal: inM(30), color: '#6b7280',
    paths: [
      { type: 'rect', data: [0, 0, 1, 0.08] },
      { type: 'line', data: [0.1, 0.08, 0.1, 1] },
      { type: 'line', data: [0.9, 0.08, 0.9, 1] },
    ],
  },
  {
    id: 'table-round-dr', name: 'Table ronde 42po', category: 'Mobilier', view: 'droite',
    widthReal: inM(42), heightReal: inM(30), color: '#6b7280',
    paths: [
      { type: 'rect', data: [0.1, 0, 0.8, 0.08] },
      { type: 'line', data: [0.5, 0.08, 0.5, 1] },
      { type: 'line', data: [0.2, 1, 0.8, 1] },
    ],
  },
];
