/**
 * DocumentSignatureModal - Signature tactile d un devis ou d une facture
 *
 * Le commercial presente son telephone au client (ou son representant) qui
 * signe directement sur l ecran tactile, sans avoir a creer de compte
 * Constructo AI. Reutilise le pattern du SignatureModal du flow Punch.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Trash2, Check } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

interface DocumentSignatureModalProps {
  isOpen: boolean;
  documentNumero?: string | null;
  documentTypeLabel?: string;
  isSubmitting?: boolean;
  submissionError?: string | null;
  onSubmit: (signatureBase64: string, signataireNom: string) => Promise<boolean>;
  onClose: () => void;
}

const DocumentSignatureModal: React.FC<DocumentSignatureModalProps> = ({
  isOpen,
  documentNumero,
  documentTypeLabel,
  isSubmitting,
  submissionError,
  onSubmit,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [signataireNom, setSignataireNom] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDrawingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const initCanvas = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.floor(rect.width * ratio);
      const targetH = Math.floor(rect.height * ratio);
      if (canvas.width === targetW && canvas.height === targetH) {
        return;
      }
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    initCanvas();
    setHasSignature(false);
    setError(null);
    setSignataireNom('');

    // Re-init le canvas si l orientation change (portrait <-> paysage) ou si la
    // fenetre est redimensionnee : sinon les coords tactiles seraient decalees.
    const handleResize = () => {
      initCanvas();
      setHasSignature(false);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isOpen]);

  const getCoords = (e: React.TouchEvent | React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const t = e.touches[0] || e.changedTouches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
    // Ignore les gestes multi-touch (pinch-to-zoom, two-finger scroll).
    if ('touches' in e && e.touches.length > 1) {
      isDrawingRef.current = false;
      return;
    }
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    const prevFillStyle = ctx.fillStyle;
    ctx.beginPath();
    // Petit point initial pour qu un tap court compte comme signature valide.
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.fillStyle = prevFillStyle;
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
    if (!hasSignature) setHasSignature(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawingRef.current) return;
    if ('touches' in e && e.touches.length > 1) {
      isDrawingRef.current = false;
      return;
    }
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasSignature) setHasSignature(true);
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasSignature(false);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!hasSignature) {
      setError('Veuillez signer dans la zone ci-dessous.');
      return;
    }
    if (signataireNom.trim().length < 2) {
      setError('Veuillez saisir le nom du signataire.');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const ok = await onSubmit(base64, signataireNom.trim());
    if (ok) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const typeLabel = documentTypeLabel || 'document';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-lg max-h-[95vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Signature du {typeLabel}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Presentez votre telephone au client pour qu il signe directement sur l ecran.
            </p>
            {documentNumero && (
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-1">
                {documentNumero}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 shrink-0 -mt-1 -mr-1 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <Alert type="error">{error}</Alert>}
        {submissionError && !error && <Alert type="error">{submissionError}</Alert>}

        <div>
          <label
            htmlFor="doc-signataire-nom"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            Nom du signataire
          </label>
          <input
            id="doc-signataire-nom"
            type="text"
            value={signataireNom}
            onChange={(e) => setSignataireNom(e.target.value)}
            placeholder="ex. Jean Tremblay, directeur des achats"
            maxLength={200}
            disabled={isSubmitting}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
              placeholder:text-gray-400 focus:border-seaop-primary-500 focus:ring-2 focus:ring-seaop-primary-500/20
              dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500
              dark:focus:border-seaop-primary-400 dark:focus:ring-seaop-primary-400/20"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Signature
            </label>
            <button
              type="button"
              onClick={handleClear}
              disabled={!hasSignature || isSubmitting}
              className="text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-1
                disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] px-2"
            >
              <Trash2 className="h-3 w-3" /> Effacer
            </button>
          </div>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: 200, touchAction: 'none' }}
            className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg bg-white"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            onTouchCancel={stopDrawing}
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Signez avec le doigt ou un stylet directement dans la zone ci-dessus.
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 min-h-[44px]"
          >
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={!hasSignature || signataireNom.trim().length < 2}
            className="flex-1 min-h-[44px] !bg-green-600 hover:!bg-green-700 dark:!bg-green-600 dark:hover:!bg-green-700"
            leftIcon={<Check className="h-4 w-4" />}
          >
            Confirmer
          </Button>
        </div>
      </div>
    </div>
  );
};

DocumentSignatureModal.displayName = 'DocumentSignatureModal';

export default DocumentSignatureModal;
