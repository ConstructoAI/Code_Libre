/**
 * Merged Zustand selector for TopToolbar.
 *
 * Replaces 26 individual subscriptions with a single shallow-compared selector.
 */
import { useMetreStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

export const useToolbarState = () =>
  useMetreStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,
      viewState: s.viewState,
      setViewState: s.setViewState,
      snapEnabled: s.snapEnabled,
      toggleSnap: s.toggleSnap,
      orthoEnabled: s.orthoEnabled,
      toggleOrtho: s.toggleOrtho,
      gridEnabled: s.gridEnabled,
      toggleGrid: s.toggleGrid,
      undo: s.undo,
      redo: s.redo,
      undoStack: s.undoStack,
      redoStack: s.redoStack,
      showSummary: s.showSummary,
      toggleSummary: s.toggleSummary,
      showCalculator: s.showCalculator,
      toggleCalculator: s.toggleCalculator,
      showSlopeConverter: s.showSlopeConverter,
      toggleSlopeConverter: s.toggleSlopeConverter,
      showCatalog: s.showCatalog,
      toggleCatalog: s.toggleCatalog,
      showLaborCatalog: s.showLaborCatalog,
      toggleLaborCatalog: s.toggleLaborCatalog,
      showSymbolCatalog: s.showSymbolCatalog,
      toggleSymbolCatalog: s.toggleSymbolCatalog,
      selectedMeasurementIds: s.selectedMeasurementIds,
      rotateMeasurement45: s.rotateMeasurement45,
      mirrorCopyMeasurement: s.mirrorCopyMeasurement,
    })),
  );
