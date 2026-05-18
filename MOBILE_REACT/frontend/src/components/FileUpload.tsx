/**
 * Mobile React Frontend - FileUpload
 * Composant d'upload mobile-first avec 3 sources (camera, galerie, fichiers),
 * compression d'image cote client, queue serie et progress par item.
 *
 * Pipeline par fichier:
 *   queued -> compressing -> uploading -> done (auto-remove 2s)
 *                                       \-> error (retry possible)
 */

import clsx from 'clsx';
import {
  Camera,
  File as FileIcon,
  FileImage,
  FileText,
  Image as ImageIcon,
  Paperclip,
  RotateCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAlert } from '@/hooks/useAlert';
import { useAttachmentsStore } from '@/store/useAttachmentsStore';
import type {
  Attachment,
  AttachmentCategory,
  AttachmentParentType,
} from '@/types';
import { compressImageIfNeeded } from '@/utils/imageCompression';

type UploadStatus = 'queued' | 'compressing' | 'uploading' | 'done' | 'error';

interface PendingUpload {
  id: string;
  file: File;
  preview: string | null;
  progress: number;
  status: UploadStatus;
  error: string | null;
}

interface FileUploadProps {
  parentType: AttachmentParentType;
  parentId: number;
  onUploadSuccess?: (att: Attachment) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  category?: AttachmentCategory;
  enableCamera?: boolean;
  enableGallery?: boolean;
  enableFiles?: boolean;
  className?: string;
}

const SOURCE_BUTTON_CLS =
  'flex flex-col items-center justify-center min-h-[56px] min-w-[56px] px-3 py-2 ' +
  'rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 ' +
  'hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition ' +
  'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 cursor-pointer';

const ICON_CLS = 'w-6 h-6 text-gray-600 dark:text-gray-400';
const LABEL_CLS = 'text-xs text-gray-500 dark:text-gray-400 mt-1';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf';
}

function pickFileIcon(file: File) {
  if (isImage(file)) return FileImage;
  if (isPdf(file)) return FileText;
  return FileIcon;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export function FileUpload({
  accept = '*/*',
  category,
  className,
  enableCamera = true,
  enableFiles = true,
  enableGallery = true,
  maxSizeMB = 25,
  multiple = false,
  onUploadSuccess,
  parentId,
  parentType,
}: FileUploadProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const [queue, setQueue] = useState<PendingUpload[]>([]);
  const uploadAttachment = useAttachmentsStore((s) => s.uploadAttachment);
  const uploadProgress = useAttachmentsStore((s) => s.uploadProgress);
  const { alert: showAlert, element: alertElement } = useAlert();

  // Guard pour eviter setState apres unmount (les async runPipeline continuent
  // a tourner en background si l'utilisateur navigue ailleurs pendant l'upload).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync progress depuis le store vers les items en cours d'upload.
  useEffect(() => {
    if (!isMountedRef.current) return;
    setQueue((q) =>
      q.map((it) => {
        if (it.status !== 'uploading') return it;
        const pct = uploadProgress.get(it.id);
        return pct !== undefined && pct !== it.progress ? { ...it, progress: pct } : it;
      }),
    );
  }, [uploadProgress]);

  const updateItem = useCallback(
    (id: string, patch: Partial<PendingUpload>) => {
      if (!isMountedRef.current) return;
      setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    },
    [],
  );

  const removeItem = useCallback((id: string) => {
    setQueue((q) => {
      const target = q.find((it) => it.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return q.filter((it) => it.id !== id);
    });
  }, []);

  const runPipeline = useCallback(
    async (item: PendingUpload) => {
      try {
        updateItem(item.id, { status: 'compressing', error: null, progress: 0 });
        const compressed = await compressImageIfNeeded(item.file);

        updateItem(item.id, { status: 'uploading' });
        const att = await uploadAttachment(parentType, parentId, compressed.file, {
          category,
          tempId: item.id,
        });

        if (!att) {
          updateItem(item.id, {
            status: 'error',
            error: "L'upload a echoue. Reessayez.",
          });
          return;
        }

        updateItem(item.id, { status: 'done', progress: 100 });
        onUploadSuccess?.(att);
        setTimeout(() => removeItem(item.id), 2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        updateItem(item.id, { status: 'error', error: msg });
      }
    },
    [category, onUploadSuccess, parentId, parentType, removeItem, updateItem, uploadAttachment],
  );

  const processFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const maxBytes = maxSizeMB * 1024 * 1024;
      const items: PendingUpload[] = [];

      for (const file of Array.from(files)) {
        if (file.size > maxBytes) {
          await showAlert({
            title: 'Fichier trop volumineux',
            message: `${file.name} (${formatSize(file.size)}) depasse la limite de ${maxSizeMB} Mo.`,
            type: 'warning',
          });
          continue;
        }
        items.push({
          id: makeId(),
          file,
          preview: isImage(file) ? URL.createObjectURL(file) : null,
          progress: 0,
          status: 'queued',
          error: null,
        });
      }

      if (items.length === 0) return;
      setQueue((q) => [...q, ...items]);

      // Pipeline en serie pour ne pas saturer la connexion 3G/4G.
      for (const it of items) {
        // eslint-disable-next-line no-await-in-loop
        await runPipeline(it);
      }
    },
    [maxSizeMB, runPipeline, showAlert],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      processFiles(files);
      // Reset pour permettre la re-selection du meme fichier.
      e.target.value = '';
    },
    [processFiles],
  );

  const handleRetry = useCallback(
    (id: string) => {
      const item = queue.find((it) => it.id === id);
      if (item) runPipeline(item);
    },
    [queue, runPipeline],
  );

  // Cleanup au unmount: revoke toutes les ObjectURL encore en queue.
  // Cleanup au unmount : on utilise un ref qui suit la queue courante pour
  // eviter la closure stale (useEffect avec [] deps capturerait la queue du
  // premier render et ne revoquerait que ces URLs-la).
  const queueRef = useRef<PendingUpload[]>([]);
  queueRef.current = queue;
  useEffect(() => {
    return () => {
      queueRef.current.forEach((it) => {
        if (it.preview) URL.revokeObjectURL(it.preview);
      });
    };
  }, []);

  return (
    <div className={clsx('space-y-3', className)}>
      {/* Sources cachees */}
      {enableCamera && (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple={multiple}
          onChange={handleInputChange}
          className="hidden"
        />
      )}
      {enableGallery && (
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple={multiple}
          onChange={handleInputChange}
          className="hidden"
        />
      )}
      {enableFiles && (
        <input
          ref={filesInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleInputChange}
          className="hidden"
        />
      )}

      {/* Boutons sources */}
      <div className="flex gap-2 items-center justify-center">
        {enableCamera && (
          <button
            type="button"
            aria-label="Prendre une photo avec la camera"
            className={SOURCE_BUTTON_CLS}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className={ICON_CLS} />
            <span className={LABEL_CLS}>Camera</span>
          </button>
        )}
        {enableGallery && (
          <button
            type="button"
            aria-label="Choisir une image depuis la galerie"
            className={SOURCE_BUTTON_CLS}
            onClick={() => galleryInputRef.current?.click()}
          >
            <ImageIcon className={ICON_CLS} />
            <span className={LABEL_CLS}>Galerie</span>
          </button>
        )}
        {enableFiles && (
          <button
            type="button"
            aria-label="Joindre un fichier"
            className={SOURCE_BUTTON_CLS}
            onClick={() => filesInputRef.current?.click()}
          >
            <Paperclip className={ICON_CLS} />
            <span className={LABEL_CLS}>Fichier</span>
          </button>
        )}
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <ul aria-live="polite" className="space-y-2">
          {queue.map((item) => {
            const Icon = pickFileIcon(item.file);
            const pct = Math.max(0, Math.min(100, item.progress));
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
              >
                <div className="w-12 h-12 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-900 flex items-center justify-center shrink-0">
                  {item.preview ? (
                    <img
                      src={item.preview}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Icon className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {item.file.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatSize(item.file.size)}
                    {item.status === 'compressing' && ' - Compression...'}
                    {item.status === 'uploading' && ` - ${pct}%`}
                    {item.status === 'done' && ' - Termine'}
                    {item.status === 'error' && (
                      <span className="text-red-500 dark:text-red-400">
                        {' '}- {item.error || 'Echec'}
                      </span>
                    )}
                  </p>
                  {(item.status === 'uploading' || item.status === 'done') && (
                    <div className="mt-1 h-1 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-seaop-primary-500 transition-all duration-150"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex items-center gap-1">
                  {item.status === 'error' && (
                    <button
                      type="button"
                      aria-label="Reessayer"
                      onClick={() => handleRetry(item.id)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition"
                    >
                      <RotateCw className="w-4 h-4 text-seaop-primary-600 dark:text-seaop-primary-400" />
                    </button>
                  )}
                  {item.status !== 'uploading' && item.status !== 'compressing' && (
                    <button
                      type="button"
                      aria-label="Retirer de la liste"
                      onClick={() => removeItem(item.id)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition"
                    >
                      <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {alertElement}
    </div>
  );
}

export default FileUpload;
