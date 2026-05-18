/**
 * SEAOP React Frontend - File Upload Hook
 * Handles single and multi-file uploads with progress tracking.
 */

import { useState, useCallback } from 'react';
import api from '@/api/client';

interface UploadResult {
  fileId: string;
  filename: string;
  data: string; // base64
}

const MAX_FILE_SIZE_MB = 150;
const MAX_FILES = 5;

export function useFileUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File): Promise<UploadResult | null> => {
    setError(null);

    // Validate size
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Le fichier dépasse la taille maximale de ${MAX_FILE_SIZE_MB} Mo`);
      return null;
    }

    setIsUploading(true);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Content-Type header is stripped by the axios interceptor when data
      // is FormData — letting the browser set the multipart boundary itself.
      const { data } = await api.post<UploadResult>('/uploads', formData, {
        onUploadProgress: (e) => {
          if (e.total) {
            setProgress(Math.round((e.loaded * 100) / e.total));
          }
        },
      });

      setProgress(100);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du téléchargement';
      setError(message);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, []);

  const uploadMulti = useCallback(async (files: File[]): Promise<UploadResult[]> => {
    setError(null);

    // Validate count
    if (files.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} fichiers autorisés`);
      return [];
    }

    // Validate sizes
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(`Le fichier "${file.name}" dépasse la taille maximale de ${MAX_FILE_SIZE_MB} Mo`);
        return [];
      }
    }

    setIsUploading(true);
    setProgress(0);

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));

      const { data } = await api.post<UploadResult[]>('/uploads/multi', formData, {
        onUploadProgress: (e) => {
          if (e.total) {
            setProgress(Math.round((e.loaded * 100) / e.total));
          }
        },
      });

      setProgress(100);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du téléchargement';
      setError(message);
      return [];
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { upload, uploadMulti, isUploading, progress, error };
}
