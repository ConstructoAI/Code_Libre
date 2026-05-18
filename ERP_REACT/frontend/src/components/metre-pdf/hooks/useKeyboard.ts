import { useEffect, useRef } from 'react';
import { useMetreStore } from '../store';

/**
 * Registers global keyboard shortcuts for the measurement workspace.
 *
 * Shortcuts:
 *   Escape        - cancel current drawing / deselect
 *   Delete/Bksp   - delete selected measurement
 *   Ctrl+Z        - undo
 *   Ctrl+Shift+Z  - redo
 *   Ctrl+Y        - redo (alt)
 *   S             - toggle snap
 *   O             - toggle ortho
 *   V             - select tool
 *   D             - distance tool
 *   A             - area tool
 *   P             - perimeter tool
 *   G             - angle tool
 *   C             - count tool
 *   K             - calibrate tool
 *   Space (hold)  - pan tool
 */
export function useKeyboard() {
  const prevToolRef = useRef<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when focus is inside an input / textarea / contenteditable
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (active?.isContentEditable) return;
      // Si la calculatrice est ouverte, deleguer toutes les touches a son
      // propre listener (sinon C/S/V/D/A/P/G/K declencheraient des outils
      // PDF en arriere-plan pendant que l'user calcule).
      if (useMetreStore.getState().showCalculator) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key;

      /* ── undo / redo ─────────────────────────── */
      if (ctrl && !shift && key === 'z') {
        e.preventDefault();
        useMetreStore.getState().undo();
        return;
      }
      if ((ctrl && shift && key === 'Z') || (ctrl && key === 'y')) {
        e.preventDefault();
        useMetreStore.getState().redo();
        return;
      }

      // Remaining shortcuts must not have ctrl held
      if (ctrl) return;

      const store = useMetreStore.getState();

      switch (key) {
        case 'Escape':
          e.preventDefault();
          if (store.activeCountId) {
            store.finalizeCount();
          } else if (store.isDrawing) {
            store.clearPoints();
          } else {
            store.selectMeasurement(null);
          }
          break;

        case 'Delete':
        case 'Backspace': {
          e.preventDefault();
          const state = useMetreStore.getState();
          if (state.selectedMeasurementIds.length > 0) {
            state.removeSelectedMeasurements();
          }
          break;
        }

        case 's':
          e.preventDefault();
          store.toggleSnap();
          break;

        case 'o':
          e.preventDefault();
          store.toggleOrtho();
          break;

        case 'v':
          e.preventDefault();
          store.setTool('select');
          break;

        case 'd':
          e.preventDefault();
          store.setTool('distance');
          break;

        case 'a':
          e.preventDefault();
          store.setTool('area');
          break;

        case 'p':
          e.preventDefault();
          store.setTool('perimeter');
          break;

        case 'g':
          e.preventDefault();
          store.setTool('angle');
          break;

        case 'c':
          e.preventDefault();
          store.setTool('count');
          break;

        case 'k':
          e.preventDefault();
          store.setTool('calibrate');
          break;

        case ' ':
          e.preventDefault();
          if (!store.isDrawing && store.activeTool !== 'pan') {
            prevToolRef.current = store.activeTool;
            store.setTool('pan');
          }
          break;

        default:
          break;
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === ' ' && prevToolRef.current !== null) {
        const prev = prevToolRef.current;
        prevToolRef.current = null;
        useMetreStore
          .getState()
          .setTool(prev as ReturnType<typeof useMetreStore.getState>['activeTool']);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
}
