/**
 * Mobile React Frontend - Photo Upload Utility Page
 * Camera capture + gallery upload with preview and upload action.
 */

import { useState } from 'react';
import { Camera, Upload, Check } from 'lucide-react';
import { uploadPhoto } from '@/api/photo';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';

export default function PhotoUploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    setSelectedFile(file);
    setUploadedUrl(null);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setError(null);
    try {
      const result = await uploadPhoto(selectedFile);
      setUploadedUrl(result.photoUrl);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Erreur lors du téléchargement');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadedUrl(null);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-[#1b1a19]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Camera className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
          Téléchargement photo
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-safe">
        {/* Capture / Gallery buttons */}
        {!selectedFile && (
          <div className="space-y-3">
            {/* Camera capture */}
            <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-8 cursor-pointer hover:border-seaop-primary-400 dark:hover:border-seaop-primary-500 transition-colors">
              <div className="h-14 w-14 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/40 flex items-center justify-center">
                <Camera className="h-7 w-7 text-seaop-primary-600 dark:text-seaop-primary-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Prendre une photo
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Utiliser la caméra de l&apos;appareil
                </p>
              </div>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCameraCapture}
                className="hidden"
              />
            </label>

            {/* Gallery */}
            <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-8 cursor-pointer hover:border-seaop-primary-400 dark:hover:border-seaop-primary-500 transition-colors">
              <div className="h-14 w-14 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <Upload className="h-7 w-7 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Choisir de la galerie
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Sélectionner une image existante
                </p>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleGallerySelect}
                className="hidden"
              />
            </label>
          </div>
        )}

        {/* Preview */}
        {previewUrl && (
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <img
                src={previewUrl}
                alt="Aperçu de la photo"
                className="w-full max-h-96 object-contain bg-gray-100 dark:bg-gray-900"
              />
              <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {selectedFile?.name}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {selectedFile
                    ? `${(selectedFile.size / 1024).toFixed(0)} Ko`
                    : ''}
                </p>
              </div>
            </div>

            {/* Error */}
            {error && (
              <Alert type="error" onDismiss={() => setError(null)}>
                {error}
              </Alert>
            )}

            {/* Success */}
            {uploadedUrl && (
              <Alert type="success">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0" />
                  <span>Photo téléchargée avec succès!</span>
                </div>
                <p className="text-xs mt-1 break-all opacity-80">{uploadedUrl}</p>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={handleReset}
                className="flex-1"
                disabled={isUploading}
              >
                Changer
              </Button>
              {!uploadedUrl ? (
                <Button
                  onClick={handleUpload}
                  isLoading={isUploading}
                  leftIcon={
                    isUploading ? undefined : <Upload className="h-4 w-4" />
                  }
                  className="flex-1"
                  disabled={isUploading}
                >
                  {isUploading ? 'Envoi...' : 'Télécharger'}
                </Button>
              ) : (
                <Button
                  onClick={handleReset}
                  leftIcon={<Camera className="h-4 w-4" />}
                  className="flex-1"
                >
                  Nouvelle photo
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Upload spinner overlay */}
        {isUploading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 flex flex-col items-center gap-3 shadow-xl">
              <Spinner size="lg" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Envoi en cours...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
