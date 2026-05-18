/**
 * ERP React Frontend - Projects Zustand Store
 */

import { create } from 'zustand';
import * as projectsApi from '@/api/projects';
import type { Project, ProjectPhase } from '@/api/projects';

interface ProjectsState {
  items: Project[];
  current: Project | null;
  isLoading: boolean;
  error: string | null;
  filters: { search: string; statut: string; priorite: string; page: number; perPage: number };
  total: number;

  // Actions
  fetchAll: () => Promise<void>;
  fetchOne: (id: number | string) => Promise<void>;
  create: (data: Partial<Project>) => Promise<Project>;
  update: (id: number | string, data: Partial<Project>) => Promise<void>;
  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;

  // Phases
  createPhase: (projectId: string, data: {
    nom: string; description?: string; ordre?: number; dateDebut?: string; dateFin?: string;
  }) => Promise<ProjectPhase>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  items: [],
  current: null,
  isLoading: false,
  error: null,
  filters: { search: '', statut: '', priorite: '', page: 1, perPage: 25 },
  total: 0,

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await projectsApi.listProjects(filters);
      set({ items: res.items, total: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des projets';
      set({ isLoading: false, error: message });
    }
  },

  fetchOne: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const project = await projectsApi.getProject(id);
      set({ current: project, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  create: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await projectsApi.createProject(data);
      const project = await projectsApi.getProject(res.id);
      set((s) => ({ items: [project, ...s.items], isLoading: false }));
      return project;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  update: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await projectsApi.updateProject(id, data);
      const updated = await projectsApi.getProject(id);
      const numId = typeof id === 'string' ? parseInt(id, 10) : id;
      set((s) => ({
        items: s.items.map((p) => (p.id === numId ? updated : p)),
        current: s.current?.id === numId ? updated : s.current,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value, page: key === 'page' ? (value as number) : 1 } }));
  },

  clearError: () => set({ error: null }),

  // ---- Phases ----
  createPhase: async (projectId, data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await projectsApi.createPhase(projectId, data);
      const phase: ProjectPhase = {
        id: res.id,
        nom: data.nom,
        description: data.description,
        ordre: data.ordre ?? 0,
        statut: 'planifie',
        dateDebut: data.dateDebut,
        dateFin: data.dateFin,
        progression: 0,
      };
      // Refresh current project to include the new phase
      const updated = await projectsApi.getProject(projectId);
      const numProjId = typeof projectId === 'string' ? parseInt(projectId, 10) : projectId;
      set((s) => ({
        current: s.current?.id === numProjId ? updated : s.current,
        isLoading: false,
      }));
      return phase;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création de la phase';
      set({ isLoading: false, error: message });
      throw err;
    }
  },
}));
