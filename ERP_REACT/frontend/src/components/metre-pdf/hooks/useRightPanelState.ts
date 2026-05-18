/**
 * Merged Zustand selector for RightPanel.
 *
 * Replaces 24 individual subscriptions with a single shallow-compared selector.
 */
import { useMetreStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

export const useRightPanelState = () =>
  useMetreStore(
    useShallow((s) => ({
      rightPanelWidth: s.rightPanelWidth,
      measurements: s.measurements,
      selectedMeasurementIds: s.selectedMeasurementIds,
      selectedMeasurementId: s.selectedMeasurementId,
      updateMeasurement: s.updateMeasurement,
      updateSelectedMeasurements: s.updateSelectedMeasurements,
      removeSelectedMeasurements: s.removeSelectedMeasurements,
      calibration: s.calibration,
      pdfDocument: s.document,
      products: s.products,
      toggleCatalog: s.toggleCatalog,
      duplicateMeasurement: s.duplicateMeasurement,
      duplicateSelectedMeasurements: s.duplicateSelectedMeasurements,
      bringMeasurementToFront: s.bringMeasurementToFront,
      sendMeasurementToBack: s.sendMeasurementToBack,
      moveMeasurementUp: s.moveMeasurementUp,
      moveMeasurementDown: s.moveMeasurementDown,
      measurementGroups: s.measurementGroups,
      addMeasurementGroup: s.addMeasurementGroup,
      propertyClipboard: s.propertyClipboard,
      copyMeasurementProperties: s.copyMeasurementProperties,
      pasteMeasurementProperties: s.pasteMeasurementProperties,
      laborTrades: s.laborTrades,
      toggleLaborCatalog: s.toggleLaborCatalog,
      symbolBlocks: s.symbolBlocks,
      toggleSymbolCatalog: s.toggleSymbolCatalog,
      currentPage: s.currentPage,
      setSelectedMeasurementId: s.setSelectedMeasurementId,
    })),
  );
