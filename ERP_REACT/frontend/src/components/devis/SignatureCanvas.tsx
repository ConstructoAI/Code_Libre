/**
 * SignatureCanvas - HTML5 Canvas for drawing signatures
 * Supports mouse and touch input. Exports as base64 PNG.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { Eraser, Check } from 'lucide-react';

interface SignatureCanvasProps {
  width?: number;
  height?: number;
  onSignatureChange?: (dataUrl: string | null) => void;
  lineColor?: string;
  lineWidth?: number;
  className?: string;
}

export default function SignatureCanvas({
  width = 500,
  height = 200,
  onSignatureChange,
  lineColor = '#1a1a2e',
  lineWidth = 2.5,
  className = '',
}: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const hasContentRef = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }, [lineColor, lineWidth]);

  // Initialize canvas with white background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Draw signature line
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, height - 40);
    ctx.lineTo(width - 40, height - 40);
    ctx.stroke();
    // "X" marker
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px sans-serif';
    ctx.fillText('X', 20, height - 35);
  }, [width, height]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    lastPoint.current = pos;
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !lastPoint.current) return;
    e.preventDefault();
    const ctx = getContext();
    if (!ctx) return;

    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPoint.current = pos;

    if (!hasContentRef.current) {
      hasContentRef.current = true;
      setHasContent(true);
    }
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPoint.current = null;
    // Use ref (synchronous) instead of state (async) to check content
    if (hasContentRef.current) {
      const canvas = canvasRef.current;
      if (canvas && onSignatureChange) {
        onSignatureChange(canvas.toDataURL('image/png'));
      }
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Redraw signature line
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, height - 40);
    ctx.lineTo(width - 40, height - 40);
    ctx.stroke();
    ctx.fillStyle = '#9ca3af';
    ctx.font = '14px sans-serif';
    ctx.fillText('X', 20, height - 35);

    hasContentRef.current = false;
    setHasContent(false);
    onSignatureChange?.(null);
  };

  return (
    <div className={className}>
      <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white relative">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full cursor-crosshair touch-none"
          style={{ aspectRatio: `${width}/${height}` }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
          onTouchCancel={endDraw}
        />
        {!hasContent && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">Dessinez votre signature ici</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Eraser size={14} />
          Effacer
        </button>
        {hasContent && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check size={14} />
            Signature enregistrée
          </span>
        )}
      </div>
    </div>
  );
}
