import { useMetreStore } from '../store';
import { useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw, RotateCw } from 'lucide-react';

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];

export default function ZoomControls() {
  const viewState = useMetreStore((s) => s.viewState);
  const setViewState = useMetreStore((s) => s.setViewState);

  const zoomPercent = Math.round(viewState.zoom * 100);

  const handleZoomIn = useCallback(() => {
    // Snap to next preset
    const next = ZOOM_PRESETS.find((z) => z > viewState.zoom + 0.01);
    setViewState({ zoom: next ?? Math.min(viewState.zoom * 1.25, 10) });
  }, [viewState.zoom, setViewState]);

  const handleZoomOut = useCallback(() => {
    const prev = [...ZOOM_PRESETS].reverse().find((z) => z < viewState.zoom - 0.01);
    setViewState({ zoom: prev ?? Math.max(viewState.zoom / 1.25, 0.1) });
  }, [viewState.zoom, setViewState]);

  const handleFitToPage = useCallback(() => {
    setViewState({ zoom: 1, offsetX: 0, offsetY: 0 });
  }, [setViewState]);

  const handleRotateLeft = useCallback(() => {
    setViewState({ rotation: (viewState.rotation - 90 + 360) % 360 });
  }, [viewState.rotation, setViewState]);

  const handleRotateRight = useCallback(() => {
    setViewState({ rotation: (viewState.rotation + 90) % 360 });
  }, [viewState.rotation, setViewState]);

  const handleResetRotation = useCallback(() => {
    setViewState({ rotation: 0 });
  }, [setViewState]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      setViewState({ zoom: val });
    },
    [setViewState]
  );

  return (
    <div className="absolute bottom-4 right-4 flex flex-col items-center gap-1 z-10">
      <div className="bg-metre-surface/90 backdrop-blur border border-metre-border rounded-lg p-1.5 flex flex-col items-center gap-1 shadow-xl">
        {/* Zoom in */}
        <button
          className="tool-btn w-7 h-7"
          onClick={handleZoomIn}
          title="Zoom avant"
        >
          <ZoomIn size={15} />
        </button>

        {/* Zoom slider (vertical) */}
        <div className="h-24 flex items-center">
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.05"
            value={viewState.zoom}
            onChange={handleSliderChange}
            className="h-20 appearance-none bg-metre-border rounded-full cursor-pointer"
            style={{
              writingMode: 'vertical-lr',
              direction: 'rtl',
              width: '4px',
            }}
            title={`Zoom: ${zoomPercent}%`}
          />
        </div>

        {/* Zoom out */}
        <button
          className="tool-btn w-7 h-7"
          onClick={handleZoomOut}
          title="Zoom arriere"
        >
          <ZoomOut size={15} />
        </button>

        <div className="w-5 h-px bg-metre-border my-0.5" />

        {/* Fit to page */}
        <button
          className="tool-btn w-7 h-7"
          onClick={handleFitToPage}
          title="Ajuster a la page"
        >
          <Maximize size={15} />
        </button>

        <div className="w-5 h-px bg-metre-border my-0.5" />

        {/* Rotation */}
        <button className="tool-btn w-7 h-7" onClick={handleRotateLeft} title="Rotation -90deg">
          <RotateCcw size={15} />
        </button>
        <button className="tool-btn w-7 h-7" onClick={handleRotateRight} title="Rotation +90deg">
          <RotateCw size={15} />
        </button>

        {/* Reset rotation */}
        {viewState.rotation !== 0 && (
          <button
            className="tool-btn w-7 h-7"
            onClick={handleResetRotation}
            title="Réinitialiser la rotation"
          >
            <RotateCcw size={15} />
          </button>
        )}

        {/* Zoom percentage */}
        <span className="text-[10px] text-metre-muted tabular-nums font-mono">
          {zoomPercent}%
        </span>
      </div>
    </div>
  );
}
