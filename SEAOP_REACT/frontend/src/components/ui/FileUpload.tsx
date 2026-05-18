/**
 * SEAOP React Frontend - Drag-and-Drop File Upload Zone
 * Supports drag-and-drop, click to browse, file validation, and dark mode.
 */

import { useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import { Upload, X, FileText } from 'lucide-react';

interface Props {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMb?: number;
  accept?: string; // e.g. ".pdf,.jpg,.png"
  label?: string;
  files?: File[]; // Currently selected files (controlled)
  onRemoveFile?: (index: number) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function FileUpload({
  onFilesSelected,
  maxFiles = 5,
  maxSizeMb = 150,
  accept,
  label,
  files = [],
  onRemoveFile,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validateAndSelect = useCallback(
    (incoming: File[]) => {
      setValidationError(null);

      // Check max files
      if (incoming.length + files.length > maxFiles) {
        setValidationError(`Maximum ${maxFiles} fichiers autorisés`);
        return;
      }

      // Check max size
      const oversized = incoming.find((f) => f.size > maxSizeMb * 1024 * 1024);
      if (oversized) {
        setValidationError(
          `Le fichier "${oversized.name}" dépasse la taille maximale de ${maxSizeMb} Mo`,
        );
        return;
      }

      onFilesSelected(incoming);
    },
    [files.length, maxFiles, maxSizeMb, onFilesSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        validateAndSelect(droppedFiles);
      }
    },
    [validateAndSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      if (selected.length > 0) {
        validateAndSelect(selected);
      }
      // Reset input so the same file can be selected again
      if (inputRef.current) inputRef.current.value = '';
    },
    [validateAndSelect],
  );

  return (
    <div className="space-y-3">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label={`Zone de dépôt de fichiers. Maximum ${maxFiles} ${maxFiles > 1 ? 'fichiers' : 'fichier'} de ${maxSizeMb} Mo chacun. Appuyez sur Entrée ou glissez vos fichiers.`}
        className={clsx(
          'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 sm:p-6 cursor-pointer transition-colors min-h-[44px]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-seaop-primary-500',
          isDragging
            ? 'border-seaop-primary-500 bg-seaop-primary-50 dark:bg-seaop-primary-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500',
          'bg-gray-50 dark:bg-gray-800/50',
        )}
      >
        <Upload
          size={32}
          className={clsx(
            'mb-2',
            isDragging
              ? 'text-seaop-primary-500'
              : 'text-gray-400 dark:text-gray-500',
          )}
        />
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
          Glissez vos fichiers ici ou cliquez pour parcourir
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Max {maxFiles} fichiers, {maxSizeMb} Mo chacun
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple={maxFiles > 1}
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />

      {/* Validation error */}
      {validationError && (
        <p className="text-sm text-red-500 dark:text-red-400">{validationError}</p>
      )}

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2"
            >
              <FileText size={18} className="shrink-0 text-gray-400 dark:text-gray-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                  {file.name}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {formatFileSize(file.size)}
                </p>
              </div>
              {onRemoveFile && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFile(index);
                  }}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
                  aria-label={`Retirer ${file.name}`}
                >
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
