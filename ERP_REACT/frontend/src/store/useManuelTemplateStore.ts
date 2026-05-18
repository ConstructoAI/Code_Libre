/**
 * ERP React Frontend - Devis Manuel Template Zustand Store
 *
 * Etat des sections + lignes personnalisees du template Manuel, persistees en BD.
 * Optimistic updates: l'UI se met a jour immediatement, rollback si l'API echoue.
 */

import { create } from 'zustand';
import * as api from '@/api/devisManuelTemplate';
import type {
  CustomSection,
  CustomLigne,
  SectionCreatePayload,
  SectionUpdatePayload,
  LigneCreatePayload,
  LigneUpdatePayload,
} from '@/api/devisManuelTemplate';

interface ManuelTemplateState {
  sections: CustomSection[];
  lignes: CustomLigne[];
  loaded: boolean;
  isLoading: boolean;
  error: string | null;

  load: (force?: boolean) => Promise<void>;

  createSection: (payload: SectionCreatePayload) => Promise<CustomSection>;
  renameSection: (id: number, nom: string) => Promise<void>;
  deleteSection: (id: number) => Promise<void>;

  createLigne: (payload: LigneCreatePayload) => Promise<CustomLigne>;
  updateLigne: (id: number, payload: LigneUpdatePayload) => Promise<void>;
  deleteLigne: (id: number) => Promise<void>;

  // Selectors
  lignesForSectionCode: (code: string) => CustomLigne[];
  lignesForSectionId: (sectionId: number) => CustomLigne[];

  clearError: () => void;
}

export const useManuelTemplateStore = create<ManuelTemplateState>((set, get) => ({
  sections: [],
  lignes: [],
  loaded: false,
  isLoading: false,
  error: null,

  load: async (force = false) => {
    if (get().isLoading) return;
    if (get().loaded && !force) return;
    set({ isLoading: true, error: null });
    try {
      const [sections, lignes] = await Promise.all([
        api.listCustomSections(),
        api.listCustomLignes(),
      ]);
      set({ sections, lignes, loaded: true, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement du template personnalise';
      set({ isLoading: false, error: message });
    }
  },

  createSection: async (payload) => {
    try {
      const created = await api.createCustomSection(payload);
      set((s) => ({ sections: [...s.sections, created] }));
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la creation de la section';
      set({ error: message });
      throw err;
    }
  },

  renameSection: async (id, nom) => {
    const previous = get().sections;
    // Optimistic
    set((s) => ({
      sections: s.sections.map((sec) => (sec.id === id ? { ...sec, nom } : sec)),
      error: null,
    }));
    try {
      await api.updateCustomSection(id, { nom });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du renommage';
      set({ sections: previous, error: message });
      throw err;
    }
  },

  deleteSection: async (id) => {
    const previousSections = get().sections;
    const previousLignes = get().lignes;
    // Optimistic: remove section + cascade lignes attached to it
    set((s) => ({
      sections: s.sections.filter((sec) => sec.id !== id),
      lignes: s.lignes.filter((l) => l.sectionId !== id),
      error: null,
    }));
    try {
      await api.deleteCustomSection(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      set({ sections: previousSections, lignes: previousLignes, error: message });
      throw err;
    }
  },

  createLigne: async (payload) => {
    try {
      const created = await api.createCustomLigne(payload);
      set((s) => ({ lignes: [...s.lignes, created] }));
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la creation de la ligne';
      set({ error: message });
      throw err;
    }
  },

  updateLigne: async (id, payload) => {
    const previous = get().lignes;
    // Optimistic
    set((s) => ({
      lignes: s.lignes.map((l) => (l.id === id ? { ...l, ...payload } : l)),
      error: null,
    }));
    try {
      const updated = await api.updateCustomLigne(id, payload);
      set((s) => ({
        lignes: s.lignes.map((l) => (l.id === id ? updated : l)),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise a jour';
      set({ lignes: previous, error: message });
      throw err;
    }
  },

  deleteLigne: async (id) => {
    const previous = get().lignes;
    set((s) => ({ lignes: s.lignes.filter((l) => l.id !== id), error: null }));
    try {
      await api.deleteCustomLigne(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      set({ lignes: previous, error: message });
      throw err;
    }
  },

  lignesForSectionCode: (code) => {
    return get()
      .lignes.filter((l) => l.sectionCode === code)
      .sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  },

  lignesForSectionId: (sectionId) => {
    return get()
      .lignes.filter((l) => l.sectionId === sectionId)
      .sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  },

  clearError: () => set({ error: null }),
}));
