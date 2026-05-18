/**
 * Mobile React Frontend - Attachments Zustand Store
 * State management des pieces jointes polymorphiques (cache 30s par parent).
 */

import { create } from 'zustand';
import type {
  Attachment, AttachmentParentType, AttachmentCategory,
} from '@/types';
import * as attApi from '@/api/attachments';
import { extractApiError } from '@/types/api';

const CACHE_TTL_MS = 30_000; // 30 s
const parentKey = (pt: AttachmentParentType, pid: number) => `${pt}:${pid}`;

interface AttachmentsState {
  /** Map (parentType:parentId) -> Attachment[] */
  byParent: Map<string, Attachment[]>;
  /** Map (parentType:parentId) -> lastFetch epoch ms */
  lastFetch: Map<string, number>;
  isLoading: boolean;
  uploadProgress: Map<string, number>; // tempUploadId -> 0-100
  error: string | null;

  fetchAttachments: (
    parentType: AttachmentParentType,
    parentId: number,
    force?: boolean,
  ) => Promise<void>;

  uploadAttachment: (
    parentType: AttachmentParentType,
    parentId: number,
    file: File,
    opts?: { category?: AttachmentCategory; description?: string; tempId?: string },
  ) => Promise<Attachment | null>;

  deleteAttachment: (
    parentType: AttachmentParentType,
    parentId: number,
    attachmentId: number,
  ) => Promise<boolean>;

  renameAttachment: (
    parentType: AttachmentParentType,
    parentId: number,
    attachmentId: number,
    payload: { filename?: string; category?: AttachmentCategory; description?: string },
  ) => Promise<boolean>;

  clearError: () => void;
  clearAll: () => void;
}

export const useAttachmentsStore = create<AttachmentsState>((set, get) => ({
  byParent: new Map(),
  lastFetch: new Map(),
  isLoading: false,
  uploadProgress: new Map(),
  error: null,

  fetchAttachments: async (parentType, parentId, force = false) => {
    const key = parentKey(parentType, parentId);
    const last = get().lastFetch.get(key);
    if (!force && last && Date.now() - last < CACHE_TTL_MS) {
      return; // cache encore frais
    }
    set({ isLoading: true, error: null });
    try {
      const list = await attApi.listAttachments(parentType, parentId);
      set((state) => {
        const byParent = new Map(state.byParent);
        const lastFetch = new Map(state.lastFetch);
        byParent.set(key, list);
        lastFetch.set(key, Date.now());
        return { byParent, lastFetch, isLoading: false };
      });
    } catch (err) {
      set({ isLoading: false, error: extractApiError(err, 'Erreur chargement pieces jointes') });
    }
  },

  uploadAttachment: async (parentType, parentId, file, opts = {}) => {
    const tempId = opts.tempId || `${file.name}-${Date.now()}`;
    set((state) => {
      const uploadProgress = new Map(state.uploadProgress);
      uploadProgress.set(tempId, 0);
      return { uploadProgress, error: null };
    });
    try {
      const result = await attApi.uploadAttachment(parentType, parentId, file, {
        category: opts.category,
        description: opts.description,
        onProgress: (pct) =>
          set((state) => {
            const uploadProgress = new Map(state.uploadProgress);
            uploadProgress.set(tempId, pct);
            return { uploadProgress };
          }),
      });

      // Force refresh des attachments du parent (background, on n'attend pas)
      void get().fetchAttachments(parentType, parentId, true);

      // Nettoyer la progress entry apres un court delai (UX feedback)
      setTimeout(() => {
        set((state) => {
          const uploadProgress = new Map(state.uploadProgress);
          uploadProgress.delete(tempId);
          return { uploadProgress };
        });
      }, 1500);

      // Synthetiser un Attachment depuis le result + opts (evite race avec
      // fetchAttachments async qui peut ne pas avoir encore termine).
      return {
        id: result.id,
        parentType,
        parentId,
        filename: result.filename,
        originalFilename: file.name,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        category: opts.category || 'AUTRE',
        uploadedBy: 0,  // sera mis a jour par le fetchAttachments background
        uploadedByName: null,
        uploadedAt: new Date().toISOString(),
      };
    } catch (err) {
      set((state) => {
        const uploadProgress = new Map(state.uploadProgress);
        uploadProgress.delete(tempId);
        return {
          uploadProgress,
          error: extractApiError(err, "Erreur lors de l'upload"),
        };
      });
      return null;
    }
  },

  deleteAttachment: async (parentType, parentId, attachmentId) => {
    set({ error: null });
    try {
      await attApi.deleteAttachment(attachmentId);
      // Retire de la liste locale sans refetch
      const key = parentKey(parentType, parentId);
      set((state) => {
        const byParent = new Map(state.byParent);
        const list = byParent.get(key) || [];
        byParent.set(key, list.filter((a) => a.id !== attachmentId));
        return { byParent };
      });
      return true;
    } catch (err) {
      set({ error: extractApiError(err, 'Erreur lors de la suppression') });
      return false;
    }
  },

  renameAttachment: async (parentType, parentId, attachmentId, payload) => {
    set({ error: null });
    try {
      const updated = await attApi.updateAttachment(attachmentId, payload);
      const key = parentKey(parentType, parentId);
      set((state) => {
        const byParent = new Map(state.byParent);
        const list = byParent.get(key) || [];
        byParent.set(
          key,
          list.map((a) => (a.id === attachmentId ? { ...a, ...updated } : a)),
        );
        return { byParent };
      });
      return true;
    } catch (err) {
      set({ error: extractApiError(err, 'Erreur lors de la mise a jour') });
      return false;
    }
  },

  clearError: () => set({ error: null }),
  clearAll: () => set({ byParent: new Map(), lastFetch: new Map(), uploadProgress: new Map(), error: null }),
}));
