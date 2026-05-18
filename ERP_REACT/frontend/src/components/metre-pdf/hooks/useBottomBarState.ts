/**
 * Merged Zustand selector for BottomBar.
 *
 * Replaces 11 individual subscriptions with a single shallow-compared selector.
 * Critical because mousePosition updates at 60fps during mouse movement.
 */
import { useMetreStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

export const useBottomBarState = () =>
  useMetreStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      mouseWorldPosition: s.mouseWorldPosition,
      mousePosition: s.mousePosition,
      liveMeasurementValue: s.liveMeasurementValue,
      activeSnapType: s.activeSnapType,
      calibration: s.calibration,
      measurements: s.measurements,
      currentPage: s.currentPage,
      displayUnit: s.displayUnit,
      toggleDisplayUnit: s.toggleDisplayUnit,
      clipboardCount: s.clipboard.length,
    })),
  );
