/**
 * Mobile React Frontend - Receipt Scanner Modal (Phase 4A)
 *
 * Wow-feature mobile chantier : un ouvrier photographie un recu chez
 * Home Depot/Reno-Depot, l'app extrait via Claude Vision (fournisseur,
 * lignes, taxes, total) et propose la creation d'un Bon de Commande
 * pre-rempli que l'ouvrier valide ou modifie.
 *
 * Flow UI (3 etapes) :
 *  1. capture   : choix camera (capture=environment) ou galerie + preview.
 *  2. analyzing : spinner pendant appel OCR (~3-10s).
 *  3. validate  : formulaire editable avec champs extraits + creation BC.
 */

import { useState, useCallback, useRef } from 'react';
import {
  Camera, Upload, X, ScanLine, Sparkles, AlertCircle, CheckCircle,
  Plus, Trash2, Building2,
} from 'lucide-react';
import { scanReceipt } from '@/api/ocr';
import { createDocument, addLine } from '@/api/documents';
import { compressImageIfNeeded } from '@/utils/imageCompression';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import type { OcrReceiptLine, OcrReceiptResponse } from '@/types';

type Stage = 'capture' | 'analyzing' | 'validate' | 'creating' | 'success';

interface ReceiptScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Callback optionnel apres creation reussie d'un BC (pour navigate / refresh). */
  onCreated?: (bcId: number, numero: string) => void;
}

interface EditableLine extends OcrReceiptLine {
  /** Cle locale pour React (les lignes n'ont pas d'ID avant creation). */
  localId: string;
}

function genLocalId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function lineToEditable(line: OcrReceiptLine): EditableLine {
  return { ...line, localId: genLocalId() };
}

function emptyLine(): EditableLine {
  return {
    localId: genLocalId(),
    description: '',
    quantite: 1,
    unite: 'unite',
    prixUnitaire: 0,
    montantLigne: 0,
  };
}

export default function ReceiptScannerModal({
  isOpen,
  onClose,
  onCreated,
}: ReceiptScannerModalProps) {
  const [stage, setStage] = useState<Stage>('capture');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Donnees extraites editables
  const [fournisseurNom, setFournisseurNom] = useState('');
  const [dateAchat, setDateAchat] = useState('');
  const [numeroFacture, setNumeroFacture] = useState('');
  const [lignes, setLignes] = useState<EditableLine[]>([]);
  const [sousTotal, setSousTotal] = useState<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const [tvq, setTvq] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [createdBc, setCreatedBc] = useState<{ id: number; numero: string } | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setStage('capture');
    setSelectedFile(null);
    setPreviewUrl(null);
    setError(null);
    setFournisseurNom('');
    setDateAchat('');
    setNumeroFacture('');
    setLignes([]);
    setSousTotal(null);
    setTps(null);
    setTvq(null);
    setTotal(null);
    setConfidence(0);
    setCreatedBc(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const populateFromOcr = useCallback((data: OcrReceiptResponse) => {
    setFournisseurNom(data.fournisseurNom ?? '');
    setDateAchat(data.dateAchat ?? '');
    setNumeroFacture(data.numeroFacture ?? '');
    setLignes((data.lignes ?? []).map(lineToEditable));
    setSousTotal(data.sousTotal);
    setTps(data.tps);
    setTvq(data.tvq);
    setTotal(data.total);
    setConfidence(data.confidence ?? 0);
  }, []);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setSelectedFile(file);
    setError(null);

    // Preview
    const reader = new FileReader();
    reader.onload = (e) => setPreviewUrl((e.target?.result as string) ?? null);
    reader.readAsDataURL(file);

    // Auto-launch OCR
    setStage('analyzing');
    try {
      const compressed = await compressImageIfNeeded(file, {
        maxWidthOrHeight: 2400, // recus = besoin de detail pour lire petits chiffres
        quality: 0.9,
      });
      const result = await scanReceipt(compressed.file);
      populateFromOcr(result);
      setStage('validate');
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Erreur lors de l’analyse du recu';
      // Extract backend HTTPException detail if axios error
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail || message);
      setStage('capture');
    }
  }, [populateFromOcr]);

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    void handleFile(file);
  };

  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    void handleFile(file);
  };

  const updateLine = (localId: string, patch: Partial<OcrReceiptLine>) => {
    setLignes((prev) =>
      prev.map((ln) => {
        if (ln.localId !== localId) return ln;
        const updated = { ...ln, ...patch };
        // Recalculer montant si quantite ou prix change
        if (patch.quantite !== undefined || patch.prixUnitaire !== undefined) {
          updated.montantLigne = Number(
            (updated.quantite * updated.prixUnitaire).toFixed(2),
          );
        }
        return updated;
      }),
    );
  };

  const removeLine = (localId: string) => {
    setLignes((prev) => prev.filter((ln) => ln.localId !== localId));
  };

  const addEmptyLine = () => {
    setLignes((prev) => [...prev, emptyLine()]);
  };

  const handleCreateBc = async () => {
    if (!fournisseurNom.trim()) {
      setError('Le nom du fournisseur est requis pour creer le bon de commande');
      return;
    }
    if (lignes.length === 0) {
      setError('Ajoutez au moins une ligne au bon de commande');
      return;
    }
    setError(null);
    setStage('creating');
    try {
      // 1. Creer le BC en BROUILLON
      const noteParts: string[] = ['Cree depuis scan OCR recu.'];
      if (numeroFacture) noteParts.push(`No facture fournisseur: ${numeroFacture}`);
      if (dateAchat) noteParts.push(`Date achat: ${dateAchat}`);
      if (confidence < 0.7) {
        noteParts.push(`Confiance OCR: ${(confidence * 100).toFixed(0)}% — verifier les chiffres.`);
      }

      const bc = await createDocument('bons-commande', {
        fournisseurNom: fournisseurNom.trim(),
        notes: noteParts.join(' '),
      });

      // 2. Ajouter les lignes (sequentiel pour respecter l'ordre)
      let seq = 0;
      for (const ln of lignes) {
        if (!ln.description.trim()) continue;
        await addLine('bons-commande', bc.id, {
          description: ln.description.trim().slice(0, 1000),
          quantite: ln.quantite || 1,
          unite: ln.unite || 'unite',
          prixUnitaire: ln.prixUnitaire || 0,
          sequenceLigne: seq++,
        });
      }

      setCreatedBc({ id: bc.id, numero: bc.numero });
      setStage('success');
      onCreated?.(bc.id, bc.numero);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail || (err instanceof Error ? err.message : 'Erreur creation BC'));
      setStage('validate');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900" role="dialog" aria-modal="true">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-sm">
            <ScanLine className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
              Scanner un recu
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {stage === 'capture' && 'Photographiez le recu'}
              {stage === 'analyzing' && 'Analyse IA en cours'}
              {stage === 'validate' && 'Validez les donnees'}
              {stage === 'creating' && 'Creation du bon de commande'}
              {stage === 'success' && 'Bon de commande cree'}
            </p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="rounded-lg p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-safe">
        {error && (
          <Alert type="error" onDismiss={() => setError(null)} className="mb-4">
            {error}
          </Alert>
        )}

        {/* ─── STAGE 1: CAPTURE ─── */}
        {stage === 'capture' && (
          <div className="space-y-4">
            {previewUrl ? (
              <div className="space-y-3">
                <img
                  src={previewUrl}
                  alt="Apercu du recu"
                  className="w-full max-h-96 object-contain rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900"
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setPreviewUrl(null);
                    setSelectedFile(null);
                  }}
                >
                  Choisir une autre image
                </Button>
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border border-purple-200 dark:border-purple-800 p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        Comment ca marche
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Photographiez votre recu Home Depot, Reno-Depot ou autre,
                        et l&apos;IA extraira automatiquement le fournisseur,
                        les items, taxes et total. Ensuite, validez ou modifiez
                        avant de creer le bon de commande.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Bouton camera */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-purple-300 dark:border-purple-600 bg-purple-50/50 dark:bg-purple-900/10 p-8 active:scale-[0.98] transition-transform min-h-[56px]"
                >
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                    <Camera className="h-8 w-8 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-base font-bold text-gray-900 dark:text-gray-100">
                      Prendre une photo
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Utiliser la camera de l&apos;appareil
                    </p>
                  </div>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/*"
                    capture="environment"
                    onChange={handleCameraChange}
                    className="hidden"
                  />
                </button>

                {/* Bouton galerie */}
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 active:scale-[0.98] transition-transform min-h-[56px]"
                >
                  <Upload className="h-6 w-6 text-gray-600 dark:text-gray-400" />
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Choisir de la galerie
                  </p>
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/*"
                    onChange={handleGalleryChange}
                    className="hidden"
                  />
                </button>
              </>
            )}
          </div>
        )}

        {/* ─── STAGE 2: ANALYZING ─── */}
        {stage === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-16 space-y-6">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Recu en cours d'analyse"
                className="max-h-48 rounded-xl border border-gray-200 dark:border-gray-700 opacity-50"
              />
            )}
            <div className="relative">
              <Spinner size="lg" className="text-purple-600 dark:text-purple-400" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-purple-500 animate-pulse" />
              </div>
            </div>
            <div className="text-center px-4">
              <p className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                Analyse du recu en cours
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                L&apos;IA extrait le fournisseur, les items, taxes et total.
                Cela prend environ 5 a 10 secondes.
              </p>
            </div>
          </div>
        )}

        {/* ─── STAGE 3: VALIDATE ─── */}
        {stage === 'validate' && (
          <div className="space-y-4">
            {/* Banner confiance */}
            {confidence < 0.7 && (
              <Alert type="warning">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold">
                      Confiance OCR : {(confidence * 100).toFixed(0)}%
                    </p>
                    <p className="opacity-80">
                      Verifiez attentivement les montants et descriptions.
                    </p>
                  </div>
                </div>
              </Alert>
            )}
            {confidence >= 0.7 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                <p className="text-xs text-green-800 dark:text-green-300">
                  Confiance OCR : {(confidence * 100).toFixed(0)}% — donnees fiables
                </p>
              </div>
            )}

            {/* Preview vignette */}
            {previewUrl && (
              <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <summary className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                  Voir le recu scanne
                </summary>
                <img
                  src={previewUrl}
                  alt="Recu scanne"
                  className="w-full max-h-64 object-contain p-2"
                />
              </details>
            )}

            {/* Fournisseur */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <Building2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                Fournisseur
              </div>
              <Input
                label="Nom du fournisseur"
                value={fournisseurNom}
                onChange={(e) => setFournisseurNom(e.target.value)}
                placeholder="Home Depot"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Date d'achat"
                  type="date"
                  value={dateAchat}
                  onChange={(e) => setDateAchat(e.target.value)}
                />
                <Input
                  label="No facture"
                  value={numeroFacture}
                  onChange={(e) => setNumeroFacture(e.target.value)}
                  placeholder="RC-12345"
                />
              </div>
            </div>

            {/* Lignes */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Items ({lignes.length})
                </p>
                <button
                  type="button"
                  onClick={addEmptyLine}
                  className="flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline min-h-[44px] px-2"
                >
                  <Plus className="h-4 w-4" /> Ajouter
                </button>
              </div>
              {lignes.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic text-center py-4">
                  Aucune ligne detectee. Cliquez sur Ajouter.
                </p>
              ) : (
                <div className="space-y-3">
                  {lignes.map((ln) => (
                    <div
                      key={ln.localId}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 space-y-2"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="text"
                          value={ln.description}
                          onChange={(e) => updateLine(ln.localId, { description: e.target.value })}
                          placeholder="Description"
                          className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        />
                        <button
                          type="button"
                          onClick={() => removeLine(ln.localId)}
                          className="shrink-0 p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 min-h-[44px] min-w-[44px] flex items-center justify-center"
                          aria-label="Supprimer la ligne"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 font-medium">Qte</label>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={ln.quantite}
                            onChange={(e) => updateLine(ln.localId, { quantite: Number(e.target.value) || 0 })}
                            className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 font-medium">Unite</label>
                          <input
                            type="text"
                            value={ln.unite}
                            onChange={(e) => updateLine(ln.localId, { unite: e.target.value })}
                            className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 font-medium">Prix</label>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={ln.prixUnitaire}
                            onChange={(e) => updateLine(ln.localId, { prixUnitaire: Number(e.target.value) || 0 })}
                            className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 font-medium">Total</label>
                          <div className="w-full rounded-md border border-transparent px-2 py-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
                            {ln.montantLigne.toFixed(2)} $
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Totaux */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-4 space-y-1.5">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Recapitulatif (extrait du recu)
              </p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Sous-total</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {sousTotal !== null ? `${sousTotal.toFixed(2)} $` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">TPS (5%)</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {tps !== null ? `${tps.toFixed(2)} $` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">TVQ (9,975%)</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {tvq !== null ? `${tvq.toFixed(2)} $` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-base border-t border-gray-300 dark:border-gray-600 pt-2 mt-1">
                <span className="font-bold text-gray-900 dark:text-gray-100">Total</span>
                <span className="font-bold text-purple-700 dark:text-purple-400">
                  {total !== null ? `${total.toFixed(2)} $` : '—'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 sticky bottom-0 bg-white dark:bg-gray-900 pt-3 pb-2 -mx-4 px-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="secondary" className="flex-1" onClick={resetState}>
                Recommencer
              </Button>
              <Button className="flex-1" onClick={handleCreateBc}>
                Creer le bon de commande
              </Button>
            </div>
          </div>
        )}

        {/* ─── STAGE 4: CREATING ─── */}
        {stage === 'creating' && (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <Spinner size="lg" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Creation du bon de commande...
            </p>
          </div>
        )}

        {/* ─── STAGE 5: SUCCESS ─── */}
        {stage === 'success' && createdBc && (
          <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center">
            <div className="h-20 w-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                Bon de commande cree
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {createdBc.numero}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full">
              <Button onClick={handleClose} className="w-full">
                Terminer
              </Button>
              <Button variant="secondary" onClick={resetState} className="w-full">
                Scanner un autre recu
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
