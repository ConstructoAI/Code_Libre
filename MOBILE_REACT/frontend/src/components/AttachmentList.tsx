/**
 * Mobile React Frontend - AttachmentList
 * Grille de pieces jointes polymorphiques avec menu d'actions (download, rename, delete).
 * Style D365 Fluent, mode dark, mobile-first (touch targets 44px).
 */

import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  MoreVertical, FolderOpen, Image as ImageIcon, FileText, File,
  Download, Pencil, Trash2,
} from 'lucide-react';
import { useAttachmentsStore } from '@/store/useAttachmentsStore';
import type { Attachment, AttachmentParentType } from '@/types';
import { useConfirm } from '@/hooks/useConfirm';
import { Alert } from '@/components/ui/Alert';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { getDownloadUrl } from '@/api/attachments';

interface AttachmentListProps {
  parentType: AttachmentParentType;
  parentId: number;
  canDelete?: boolean;
  canDownload?: boolean;
  canRename?: boolean;
  onPreview?: (att: Attachment, index: number) => void;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

function isPdf(mime: string): boolean {
  return mime === 'application/pdf';
}

const AttachmentList: React.FC<AttachmentListProps> = ({
  parentType,
  parentId,
  canDelete = false,
  canDownload = true,
  canRename = false,
  onPreview,
  className,
}) => {
  const fetchAttachments = useAttachmentsStore((s) => s.fetchAttachments);
  const deleteAttachment = useAttachmentsStore((s) => s.deleteAttachment);
  const renameAttachment = useAttachmentsStore((s) => s.renameAttachment);
  const byParent = useAttachmentsStore((s) => s.byParent);
  const isLoading = useAttachmentsStore((s) => s.isLoading);
  const error = useAttachmentsStore((s) => s.error);
  const clearError = useAttachmentsStore((s) => s.clearError);

  const { confirm, element: confirmElement } = useConfirm();

  const [menuAtt, setMenuAtt] = useState<Attachment | null>(null);
  const [renameAtt, setRenameAtt] = useState<Attachment | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchAttachments(parentType, parentId);
  }, [parentType, parentId, fetchAttachments]);

  const attachments = useMemo<Attachment[]>(
    () => byParent.get(`${parentType}:${parentId}`) || [],
    [byParent, parentType, parentId],
  );

  const openMenu = (att: Attachment) => setMenuAtt(att);
  const closeMenu = () => setMenuAtt(null);

  const handleDownload = async (att: Attachment) => {
    setActionLoading(true);
    try {
      const url = await getDownloadUrl(att.id);
      window.open(url, '_blank', 'noopener');
    } catch {
      // L'erreur est silencieuse — l'utilisateur peut reessayer
    } finally {
      setActionLoading(false);
      closeMenu();
    }
  };

  const openRename = (att: Attachment) => {
    setRenameAtt(att);
    setRenameValue(att.originalFilename || att.filename);
    closeMenu();
  };

  const closeRename = () => {
    setRenameAtt(null);
    setRenameValue('');
  };

  const handleRenameSubmit = async () => {
    if (!renameAtt) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setRenameLoading(true);
    const ok = await renameAttachment(parentType, parentId, renameAtt.id, {
      filename: trimmed,
    });
    setRenameLoading(false);
    if (ok) closeRename();
  };

  const handleDelete = async (att: Attachment) => {
    closeMenu();
    const ok = await confirm({
      title: 'Supprimer la piece jointe',
      message: `Supprimer "${att.originalFilename || att.filename}" ? Cette action est irreversible.`,
      variant: 'danger',
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    await deleteAttachment(parentType, parentId, att.id);
  };

  if (isLoading && attachments.length === 0) {
    return (
      <div className={clsx('grid grid-cols-2 gap-2 sm:grid-cols-3', className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-gray-100 dark:bg-gray-800 animate-pulse aspect-square rounded-lg"
          />
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {error && (
        <Alert type="error" className="mb-3" onDismiss={clearError}>
          {error}
        </Alert>
      )}

      {attachments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8">
          <FolderOpen className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
            Aucune piece jointe
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((att, index) => {
            const displayName = att.originalFilename || att.filename;
            const Icon = isImage(att.mimeType)
              ? ImageIcon
              : isPdf(att.mimeType)
                ? FileText
                : File;

            return (
              <div
                key={att.id}
                className={clsx(
                  'relative aspect-square rounded-lg border',
                  'bg-white dark:bg-gray-800',
                  'border-gray-200 dark:border-gray-700',
                  'overflow-hidden flex flex-col',
                  onPreview && 'cursor-pointer active:bg-gray-50 dark:active:bg-gray-700',
                )}
              >
                <button
                  type="button"
                  onClick={() => onPreview?.(att, index)}
                  className="flex-1 flex flex-col items-center justify-center px-2 pt-3 pb-1 w-full text-left"
                  aria-label={`Apercu ${displayName}`}
                >
                  <Icon className="w-10 h-10 text-gray-400 dark:text-gray-500" />
                </button>

                {isPdf(att.mimeType) && (
                  <span className="absolute top-1 left-1 text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-1.5 py-0.5 rounded z-10">
                    PDF
                  </span>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openMenu(att);
                  }}
                  className={clsx(
                    'absolute top-0 right-0 min-h-[44px] min-w-[44px]',
                    'flex items-center justify-center rounded-lg z-10',
                    'text-gray-500 dark:text-gray-400',
                    'hover:bg-gray-100 dark:hover:bg-gray-700',
                    'active:bg-gray-200 dark:active:bg-gray-600',
                  )}
                  aria-label="Actions"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>

                <div className="px-2 pb-2 pt-1">
                  <p className="text-xs truncate text-gray-700 dark:text-gray-200" title={displayName}>
                    {displayName}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    {formatBytes(att.sizeBytes)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom-sheet menu d'actions */}
      <Modal
        isOpen={menuAtt !== null}
        onClose={closeMenu}
        title={menuAtt?.originalFilename || menuAtt?.filename || 'Actions'}
      >
        <div className="flex flex-col gap-1">
          {canDownload && menuAtt && (
            <button
              type="button"
              onClick={() => handleDownload(menuAtt)}
              disabled={actionLoading}
              className={clsx(
                'flex items-center gap-3 w-full min-h-[44px] px-3 py-2 rounded-lg text-left',
                'text-gray-700 dark:text-gray-200',
                'hover:bg-gray-100 dark:hover:bg-gray-700',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <Download className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-medium">Telecharger</span>
            </button>
          )}
          {canRename && menuAtt && (
            <button
              type="button"
              onClick={() => openRename(menuAtt)}
              className={clsx(
                'flex items-center gap-3 w-full min-h-[44px] px-3 py-2 rounded-lg text-left',
                'text-gray-700 dark:text-gray-200',
                'hover:bg-gray-100 dark:hover:bg-gray-700',
              )}
            >
              <Pencil className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-medium">Renommer</span>
            </button>
          )}
          {canDelete && menuAtt && (
            <button
              type="button"
              onClick={() => handleDelete(menuAtt)}
              className={clsx(
                'flex items-center gap-3 w-full min-h-[44px] px-3 py-2 rounded-lg text-left',
                'text-red-600 dark:text-red-400',
                'hover:bg-red-50 dark:hover:bg-red-900/20',
              )}
            >
              <Trash2 className="w-5 h-5" />
              <span className="text-sm font-medium">Supprimer</span>
            </button>
          )}
        </div>
      </Modal>

      {/* Modale de renommage */}
      <Modal isOpen={renameAtt !== null} onClose={closeRename} title="Renommer la piece jointe">
        <div className="space-y-4">
          <Input
            label="Nouveau nom"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            disabled={renameLoading}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeRename} disabled={renameLoading}>
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={handleRenameSubmit}
              isLoading={renameLoading}
              disabled={!renameValue.trim()}
            >
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>

      {confirmElement}
    </div>
  );
};

AttachmentList.displayName = 'AttachmentList';

export { AttachmentList };
export type { AttachmentListProps };
