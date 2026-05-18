/**
 * ERP React Frontend - Production Zustand Store
 * Work orders + detail (lines, assignations, comments).
 */

import { create } from 'zustand';
import * as productionApi from '@/api/production';
import * as projectsApi from '@/api/projects';
import type { WorkOrder, KanbanData, LineItem, Assignation, BtComment, CalendarEvent, Operation } from '@/api/production';
import type { GanttProject } from '@/api/projects';

// Helper extractError (lecon #45): preserver le message backend `detail`
// (ex: "Transition de statut interdite: TERMINE -> BROUILLON",
// "Stock insuffisant", "Acces refuse. Role requis: admin").
const extractError = (err: unknown, fallback: string): string => {
  const e = err as any;
  return (
    e?.response?.data?.detail
    || e?.response?.data?.message
    || (err instanceof Error ? err.message : null)
    || fallback
  );
};

interface ProductionState {
  // List
  items: WorkOrder[];
  kanban: KanbanData | null;
  isLoading: boolean;
  error: string | null;
  filters: { statut: string; priorite: string; search: string; page: number; perPage: number };
  total: number;

  // Gantt
  ganttData: GanttProject[];
  ganttLoading: boolean;

  // Calendar
  calendarEvents: CalendarEvent[];
  calendarLoading: boolean;

  // Detail
  selected: WorkOrder | null;
  lines: LineItem[];
  assignations: Assignation[];
  comments: BtComment[];
  operations: Operation[];
  btTimeEntries: unknown[];
  detailLoading: boolean;

  // Operations global
  allOperations: Operation[];
  operationTypes: string[];

  // Actions - list
  fetchAll: () => Promise<void>;
  create: (data: {
    nom?: string; projectId?: number; priorite?: string;
    dateEcheance?: string; dateDebut?: string; dateFin?: string; notes?: string;
  }) => Promise<WorkOrder>;
  update: (id: number, data: Partial<WorkOrder>) => Promise<void>;
  remove: (id: number) => Promise<{ hard_deleted?: boolean }>;
  restore: (id: number) => Promise<void>;
  fetchKanban: () => Promise<void>;
  fetchGantt: () => Promise<void>;
  fetchCalendarEvents: (year: number, month: number) => Promise<void>;
  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;

  // Actions - detail
  selectWorkOrder: (id: number) => Promise<void>;
  clearSelection: () => void;
  fetchLines: (btId: number) => Promise<void>;
  addLine: (btId: number, data: { description: string; quantite?: number; unite?: string; prixUnitaire?: number; produitId?: number }) => Promise<void>;
  removeLine: (btId: number, lineId: number) => Promise<void>;
  fetchAssignations: (btId: number) => Promise<void>;
  addAssignation: (btId: number, data: { employeeId: number; role?: string }) => Promise<void>;
  removeAssignation: (btId: number, assignationId: number) => Promise<void>;
  fetchComments: (btId: number) => Promise<void>;
  addComment: (btId: number, commentText: string) => Promise<void>;
  fetchBtTimeEntries: (btId: number) => Promise<void>;
  fetchOperations: (btId: number) => Promise<void>;
  addOperation: (btId: number, data: {
    nom?: string; description?: string; quantite?: number;
    employeeId?: number; fournisseur?: string; heuresPrevues?: number;
    statut?: string; dateDebut?: string; dateFin?: string;
  }) => Promise<void>;
  updateOperation: (btId: number, opId: number, data: Partial<Operation>) => Promise<void>;
  removeOperation: (btId: number, opId: number) => Promise<void>;
  fetchAllOperations: () => Promise<void>;
  fetchOperationTypes: () => Promise<void>;
}

export const useProductionStore = create<ProductionState>((set, get) => ({
  items: [],
  kanban: null,
  isLoading: false,
  error: null,
  filters: { statut: '', priorite: '', search: '', page: 1, perPage: 25 },
  total: 0,

  ganttData: [],
  ganttLoading: false,

  calendarEvents: [],
  calendarLoading: false,

  selected: null,
  lines: [],
  assignations: [],
  comments: [],
  operations: [],
  btTimeEntries: [],
  detailLoading: false,

  allOperations: [],
  operationTypes: [],

  // ========== List Actions ==========

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await productionApi.listWorkOrders({
        page: filters.page,
        perPage: filters.perPage,
        statut: filters.statut || undefined,
        priorite: filters.priorite || undefined,
        search: filters.search || undefined,
      });
      set({ items: res.items, total: res.total, isLoading: false });
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement des bons de travail');
      set({ isLoading: false, error: message });
    }
  },

  create: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await productionApi.createWorkOrder(data);
      const wo: WorkOrder = {
        id: res.id,
        numeroDocument: res.numero,
        nom: res.nom || data.nom || res.numero,
        statut: 'BROUILLON',
        priorite: data.priorite ?? 'NORMALE',
        projectId: data.projectId,
        dateEcheance: data.dateEcheance,
        notes: data.notes,
      };
      set((s) => ({ items: [wo, ...s.items], isLoading: false }));
      return wo;
    } catch (err) {
      const message = extractError(err, 'Erreur lors de la création');
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  update: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await productionApi.updateWorkOrder(id, data);
      set((s) => ({
        items: s.items.map((wo) => (wo.id === id ? { ...wo, ...data } : wo)),
        selected: s.selected?.id === id ? { ...s.selected, ...data } : s.selected,
        isLoading: false,
      }));
    } catch (err) {
      const message = extractError(err, 'Erreur lors de la mise à jour');
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  remove: async (id) => {
    try {
      const res = await productionApi.deleteWorkOrder(id);
      if (res.hard_deleted) {
        // Hard delete -> retirer de la liste
        set((s) => ({
          items: s.items.filter((wo) => wo.id !== id),
          selected: s.selected?.id === id ? null : s.selected,
        }));
      } else {
        // Soft delete -> garder dans la liste mais update statut a ANNULE
        set((s) => ({
          items: s.items.map((wo) => (wo.id === id ? { ...wo, statut: 'ANNULE' } : wo)),
          selected: s.selected?.id === id ? { ...s.selected, statut: 'ANNULE' } : s.selected,
        }));
      }
      return res;
    } catch (err) {
      const message = extractError(err, 'Erreur lors de la suppression');
      set({ error: message });
      throw err;
    }
  },

  restore: async (id) => {
    try {
      await productionApi.restoreWorkOrder(id);
      set((s) => ({
        items: s.items.map((wo) => (wo.id === id ? { ...wo, statut: 'BROUILLON' } : wo)),
        selected: s.selected?.id === id ? { ...s.selected, statut: 'BROUILLON' } : s.selected,
      }));
    } catch (err) {
      const message = extractError(err, 'Erreur lors de la restauration');
      set({ error: message });
      throw err;
    }
  },

  fetchKanban: async () => {
    set({ isLoading: true, error: null });
    try {
      const kanban = await productionApi.getKanbanData();
      set({ kanban, isLoading: false });
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement du kanban');
      set({ isLoading: false, error: message });
    }
  },

  fetchGantt: async () => {
    set({ ganttLoading: true, error: null });
    try {
      const res = await projectsApi.getGanttData();
      set({ ganttData: res.items, ganttLoading: false });
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement du Gantt');
      set({ ganttLoading: false, error: message });
    }
  },

  fetchCalendarEvents: async (year: number, month: number) => {
    set({ calendarLoading: true, error: null });
    try {
      const res = await productionApi.getCalendarEvents(year, month);
      set({ calendarEvents: res.events, calendarLoading: false });
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement du calendrier');
      set({ calendarLoading: false, error: message });
    }
  },

  setFilter: (key, value) => {
    set((s) => ({
      filters: {
        ...s.filters,
        [key]: value,
        page: key === 'page' ? (value as number) : 1,
      },
    }));
  },

  clearError: () => set({ error: null }),

  // ========== Detail Actions ==========

  selectWorkOrder: async (id) => {
    set({ detailLoading: true, error: null });
    try {
      const wo = await productionApi.getWorkOrder(id);
      set({ selected: wo, detailLoading: false });
      // Load sub-resources in parallel
      const state = get();
      state.fetchLines(id);
      state.fetchAssignations(id);
      state.fetchComments(id);
      state.fetchOperations(id);
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement');
      set({ detailLoading: false, error: message });
    }
  },

  clearSelection: () => set({ selected: null, lines: [], assignations: [], comments: [], operations: [] }),

  fetchLines: async (btId) => {
    try {
      const res = await productionApi.listLines(btId);
      set({ lines: res.items });
    } catch {
      // silent
    }
  },

  addLine: async (btId, data) => {
    try {
      await productionApi.addLine(btId, data);
      // Refresh lines and work order (for updated montant_total)
      const state = get();
      state.fetchLines(btId);
      state.selectWorkOrder(btId);
    } catch (err) {
      const message = extractError(err, 'Erreur lors de l\'ajout de la ligne');
      set({ error: message });
    }
  },

  removeLine: async (btId, lineId) => {
    try {
      await productionApi.deleteLine(btId, lineId);
      set((s) => ({ lines: s.lines.filter((l) => l.id !== lineId) }));
      // Refresh work order for updated total
      get().selectWorkOrder(btId);
    } catch (err) {
      const message = extractError(err, 'Erreur lors de la suppression');
      set({ error: message });
    }
  },

  fetchAssignations: async (btId) => {
    try {
      const res = await productionApi.listAssignations(btId);
      set({ assignations: res.items });
    } catch {
      // silent
    }
  },

  addAssignation: async (btId, data) => {
    try {
      await productionApi.addAssignation(btId, data);
      get().fetchAssignations(btId);
    } catch (err) {
      const message = extractError(err, 'Erreur lors de l\'assignation');
      set({ error: message });
    }
  },

  removeAssignation: async (btId, assignationId) => {
    try {
      await productionApi.removeAssignation(btId, assignationId);
      set((s) => ({ assignations: s.assignations.filter((a) => a.id !== assignationId) }));
    } catch (err) {
      const message = extractError(err, 'Erreur lors de la suppression');
      set({ error: message });
    }
  },

  fetchComments: async (btId) => {
    try {
      const res = await productionApi.listComments(btId);
      set({ comments: res.items });
    } catch {
      // silent
    }
  },

  addComment: async (btId, commentText) => {
    try {
      await productionApi.addComment(btId, { commentText });
      get().fetchComments(btId);
    } catch (err) {
      const message = extractError(err, 'Erreur lors de l\'ajout du commentaire');
      set({ error: message });
    }
  },

  fetchBtTimeEntries: async (btId: number) => {
    try {
      const { getBtTimeEntries } = await import('../api/production');
      const result = await getBtTimeEntries(btId);
      set({ btTimeEntries: result.items || [] });
    } catch {
      set({ btTimeEntries: [] });
    }
  },

  // ========== Operations Actions ==========

  fetchOperations: async (btId) => {
    try {
      const res = await productionApi.listOperations(btId);
      set({ operations: res.items });
    } catch {
      // silent
    }
  },

  addOperation: async (btId, data) => {
    try {
      await productionApi.addOperation(btId, data);
      get().fetchOperations(btId);
    } catch (err) {
      const message = extractError(err, "Erreur lors de l'ajout de l'operation");
      set({ error: message });
      // FIX P1 (round 3): re-throw pour que le composant (saveEditOp) puisse
      // garder le mode edition ouvert et preserver les modifications utilisateur.
      throw err;
    }
  },

  updateOperation: async (btId, opId, data) => {
    try {
      await productionApi.updateOperation(btId, opId, data);
      get().fetchOperations(btId);
    } catch (err) {
      const message = extractError(err, "Erreur lors de la mise à jour");
      set({ error: message });
      throw err;
    }
  },

  removeOperation: async (btId, opId) => {
    try {
      await productionApi.deleteOperation(btId, opId);
      set((s) => ({ operations: s.operations.filter((o) => o.id !== opId) }));
    } catch (err) {
      const message = extractError(err, "Erreur lors de la suppression");
      set({ error: message });
      throw err;
    }
  },

  fetchAllOperations: async () => {
    try {
      const res = await productionApi.listAllOperations();
      set({ allOperations: res.items });
    } catch {
      // silent
    }
  },

  fetchOperationTypes: async () => {
    try {
      const res = await productionApi.listOperationTypes();
      set({ operationTypes: res.items });
    } catch {
      // silent
    }
  },
}));
