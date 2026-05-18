/**
 * Merged Zustand selector for MeasurementCanvas.
 *
 * Replaces 26 individual useMetreStore() subscriptions with a single
 * shallow-compared selector.  On any store change only ONE selector runs
 * instead of 26, and the component only re-renders when a value it
 * actually uses has changed (shallow equality).
 */
import { useMetreStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

export const useCanvasState = () =>
  useMetreStore(
    useShallow((s) => ({
      // viewport
      viewState: s.viewState,
      setViewState: s.setViewState,

      // tool
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,

      // measurements
      measurements: s.measurements,
      addMeasurement: s.addMeasurement,

      // layers
      layers: s.layers,
      currentPage: s.currentPage,
      activeLayerId: s.activeLayerId,

      // selection
      selectedMeasurementIds: s.selectedMeasurementIds,
      selectedMeasurementId: s.selectedMeasurementId,
      setSelectedMeasurementId: s.setSelectedMeasurementId,
      toggleMeasurementSelection: s.toggleMeasurementSelection,
      setSelectedMeasurementIds: s.setSelectedMeasurementIds,

      // drawing
      drawingPoints: s.drawingPoints,
      addDrawingPoint: s.addDrawingPoint,
      clearDrawing: s.clearDrawing,

      // calibration
      calibration: s.calibration,
      setLiveMeasurementValue: s.setLiveMeasurementValue,

      // toggles
      orthoEnabled: s.orthoEnabled,
      toggleOrtho: s.toggleOrtho,
      gridEnabled: s.gridEnabled,
      toggleGrid: s.toggleGrid,

      // snap
      snapEnabled: s.snapEnabled,
      setSnapPoints: s.setSnapPoints,

      // document
      pdfDocument: s.document,
    })),
  );
