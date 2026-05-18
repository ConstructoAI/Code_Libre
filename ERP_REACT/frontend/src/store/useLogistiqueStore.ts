/**
 * ERP React Frontend - Logistique Zustand Store
 * Deliveries, Equipment, Vehicles, Coordination.
 */

import { create } from 'zustand';
import * as logApi from '@/api/logistics';
import type {
  Delivery,
  DeliveryItem,
  LogisticsEquipment,
  EquipmentReservation,
  Vehicle,
  VehicleTrip,
  SiteCoordination,
  LogisticsStats,
} from '@/types';

interface LogistiqueState {
  // Lists
  deliveries: Delivery[];
  deliveriesTotal: number;
  equipment: LogisticsEquipment[];
  equipmentTotal: number;
  vehicles: Vehicle[];
  vehiclesTotal: number;
  coordination: SiteCoordination[];
  coordinationTotal: number;

  // Detail
  selectedDelivery: (Delivery & { items: DeliveryItem[] }) | null;
  selectedEquipment: LogisticsEquipment | null;
  reservations: EquipmentReservation[];
  trips: VehicleTrip[];

  // Stats
  stats: LogisticsStats | null;

  // State
  isLoading: boolean;
  detailLoading: boolean;
  error: string | null;

  // Filters
  deliveryFilters: { page: number; perPage: number; statut: string };
  equipmentFilters: { page: number; perPage: number; categorie: string; statut: string };
  vehicleFilters: { statut: string };
  coordinationFilters: { page: number; perPage: number; statut: string };

  // Delivery actions
  fetchDeliveries: () => Promise<void>;
  selectDelivery: (id: number) => Promise<void>;
  createDelivery: (data: Parameters<typeof logApi.createDelivery>[0]) => Promise<void>;
  updateDelivery: (id: number, data: Parameters<typeof logApi.updateDelivery>[1]) => Promise<void>;
  deleteDelivery: (id: number) => Promise<void>;
  addDeliveryItem: (deliveryId: number, data: Parameters<typeof logApi.addDeliveryItem>[1]) => Promise<void>;
  deleteDeliveryItem: (deliveryId: number, itemId: number) => Promise<void>;

  // Equipment actions
  fetchEquipment: () => Promise<void>;
  createEquipment: (data: Parameters<typeof logApi.createEquipment>[0]) => Promise<void>;
  updateEquipment: (id: number, data: Parameters<typeof logApi.updateEquipment>[1]) => Promise<void>;
  deleteEquipment: (id: number) => Promise<void>;
  fetchReservations: (equipmentId: number) => Promise<void>;
  createReservation: (equipmentId: number, data: Parameters<typeof logApi.createReservation>[1]) => Promise<void>;

  // Vehicle actions
  fetchVehicles: () => Promise<void>;
  createVehicle: (data: Parameters<typeof logApi.createVehicle>[0]) => Promise<void>;
  updateVehicle: (id: number, data: Parameters<typeof logApi.updateVehicle>[1]) => Promise<void>;
  deleteVehicle: (id: number) => Promise<void>;
  fetchTrips: (vehicleId: number) => Promise<void>;
  createTrip: (vehicleId: number, data: Parameters<typeof logApi.createTrip>[1]) => Promise<void>;

  // Coordination actions
  fetchCoordination: () => Promise<void>;
  createCoordination: (data: Parameters<typeof logApi.createCoordination>[0]) => Promise<void>;
  updateCoordination: (id: number, data: Parameters<typeof logApi.updateCoordination>[1]) => Promise<void>;
  deleteCoordination: (id: number) => Promise<void>;

  // Stats & utility
  fetchStats: () => Promise<void>;
  setDeliveryFilter: (key: string, value: unknown) => void;
  setEquipmentFilter: (key: string, value: unknown) => void;
  setVehicleFilter: (key: string, value: unknown) => void;
  setCoordinationFilter: (key: string, value: unknown) => void;
  clearError: () => void;
  clearSelection: () => void;
}

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { detail?: string } } }).response;
    if (resp?.data?.detail) return resp.data.detail;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export const useLogistiqueStore = create<LogistiqueState>((set, get) => ({
  deliveries: [],
  deliveriesTotal: 0,
  equipment: [],
  equipmentTotal: 0,
  vehicles: [],
  vehiclesTotal: 0,
  coordination: [],
  coordinationTotal: 0,
  selectedDelivery: null,
  selectedEquipment: null,
  reservations: [],
  trips: [],
  stats: null,
  isLoading: false,
  detailLoading: false,
  error: null,
  deliveryFilters: { page: 1, perPage: 25, statut: '' },
  equipmentFilters: { page: 1, perPage: 25, categorie: '', statut: '' },
  vehicleFilters: { statut: '' },
  coordinationFilters: { page: 1, perPage: 25, statut: '' },

  // ── Deliveries ──────────────────────────────────────

  fetchDeliveries: async () => {
    set({ isLoading: true, error: null });
    try {
      const { deliveryFilters: f } = get();
      const res = await logApi.listDeliveries({
        page: f.page, perPage: f.perPage,
        statut: f.statut || undefined,
      });
      set({ deliveries: res.items ?? [], deliveriesTotal: res.total ?? 0, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement livraisons') });
    }
  },

  selectDelivery: async (id) => {
    set({ detailLoading: true, error: null });
    try {
      const d = await logApi.getDelivery(id);
      set({ selectedDelivery: d, detailLoading: false });
    } catch (err) {
      set({ detailLoading: false, error: extractError(err, 'Erreur chargement livraison') });
    }
  },

  createDelivery: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await logApi.createDelivery(data);
      await get().fetchDeliveries();
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur création livraison') });
      throw err;
    }
  },

  updateDelivery: async (id, data) => {
    set({ error: null });
    try {
      await logApi.updateDelivery(id, data);
      await get().fetchDeliveries();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour livraison') });
      throw err;
    }
  },

  deleteDelivery: async (id) => {
    set({ error: null });
    try {
      await logApi.deleteDelivery(id);
      set({ selectedDelivery: null });
      await get().fetchDeliveries();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression livraison') });
      throw err;
    }
  },

  addDeliveryItem: async (deliveryId, data) => {
    set({ error: null });
    try {
      await logApi.addDeliveryItem(deliveryId, data);
      await get().selectDelivery(deliveryId);
    } catch (err) {
      set({ error: extractError(err, 'Erreur ajout article') });
      throw err;
    }
  },

  deleteDeliveryItem: async (deliveryId, itemId) => {
    set({ error: null });
    try {
      await logApi.deleteDeliveryItem(deliveryId, itemId);
      await get().selectDelivery(deliveryId);
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression article') });
      throw err;
    }
  },

  // ── Equipment ──────────────────────────────────────

  fetchEquipment: async () => {
    set({ isLoading: true, error: null });
    try {
      const { equipmentFilters: f } = get();
      const res = await logApi.listEquipment({
        page: f.page, perPage: f.perPage,
        categorie: f.categorie || undefined,
        statut: f.statut || undefined,
      });
      set({ equipment: res.items ?? [], equipmentTotal: res.total ?? 0, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement equipements') });
    }
  },

  createEquipment: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await logApi.createEquipment(data);
      await get().fetchEquipment();
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur creation equipement') });
      throw err;
    }
  },

  updateEquipment: async (id, data) => {
    set({ error: null });
    try {
      await logApi.updateEquipment(id, data);
      await get().fetchEquipment();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour équipement') });
      throw err;
    }
  },

  deleteEquipment: async (id) => {
    set({ error: null });
    try {
      await logApi.deleteEquipment(id);
      set({ selectedEquipment: null, reservations: [] });
      await get().fetchEquipment();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression equipement') });
      throw err;
    }
  },

  fetchReservations: async (equipmentId) => {
    try {
      const res = await logApi.listReservations(equipmentId);
      set({ reservations: Array.isArray(res) ? res : [] });
    } catch {
      set({ reservations: [] });
    }
  },

  createReservation: async (equipmentId, data) => {
    set({ error: null });
    try {
      await logApi.createReservation(equipmentId, data);
      await get().fetchReservations(equipmentId);
    } catch (err) {
      set({ error: extractError(err, 'Erreur reservation equipement') });
      throw err;
    }
  },

  // ── Vehicles ──────────────────────────────────────

  fetchVehicles: async () => {
    set({ isLoading: true, error: null });
    try {
      const { vehicleFilters: f } = get();
      const res = await logApi.listVehicles({ statut: f.statut || undefined });
      set({ vehicles: res.items ?? [], vehiclesTotal: res.total ?? (res.items?.length ?? 0), isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement vehicules') });
    }
  },

  createVehicle: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await logApi.createVehicle(data);
      await get().fetchVehicles();
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur creation vehicule') });
      throw err;
    }
  },

  updateVehicle: async (id, data) => {
    set({ error: null });
    try {
      await logApi.updateVehicle(id, data);
      await get().fetchVehicles();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour véhicule') });
      throw err;
    }
  },

  deleteVehicle: async (id) => {
    set({ error: null });
    try {
      await logApi.deleteVehicle(id);
      set({ trips: [] });
      await get().fetchVehicles();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression vehicule') });
      throw err;
    }
  },

  fetchTrips: async (vehicleId) => {
    try {
      const res = await logApi.listTrips(vehicleId);
      set({ trips: Array.isArray(res) ? res : [] });
    } catch {
      set({ trips: [] });
    }
  },

  createTrip: async (vehicleId, data) => {
    set({ error: null });
    try {
      await logApi.createTrip(vehicleId, data);
      await get().fetchTrips(vehicleId);
    } catch (err) {
      set({ error: extractError(err, 'Erreur enregistrement deplacement') });
      throw err;
    }
  },

  // ── Coordination ──────────────────────────────────────

  fetchCoordination: async () => {
    set({ isLoading: true, error: null });
    try {
      const { coordinationFilters: f } = get();
      const res = await logApi.listCoordination({
        page: f.page, perPage: f.perPage,
        statut: f.statut || undefined,
      });
      set({ coordination: res.items ?? [], coordinationTotal: res.total ?? 0, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement coordination') });
    }
  },

  createCoordination: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await logApi.createCoordination(data);
      await get().fetchCoordination();
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur creation activite') });
      throw err;
    }
  },

  updateCoordination: async (id, data) => {
    set({ error: null });
    try {
      await logApi.updateCoordination(id, data);
      await get().fetchCoordination();
    } catch (err) {
      set({ error: extractError(err, 'Erreur mise à jour activité') });
      throw err;
    }
  },

  deleteCoordination: async (id) => {
    set({ error: null });
    try {
      await logApi.deleteCoordination(id);
      await get().fetchCoordination();
    } catch (err) {
      set({ error: extractError(err, 'Erreur suppression activite') });
      throw err;
    }
  },

  // ── Stats & utility ──────────────────────────────────────

  fetchStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await logApi.getLogisticsStats();
      set({ stats: res, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: extractError(err, 'Erreur chargement statistiques') });
    }
  },

  setDeliveryFilter: (key, value) => {
    set((s) => ({
      deliveryFilters: {
        ...s.deliveryFilters,
        [key]: value,
        ...(key !== 'page' ? { page: 1 } : {}),
      },
    }));
  },

  setEquipmentFilter: (key, value) => {
    set((s) => ({
      equipmentFilters: {
        ...s.equipmentFilters,
        [key]: value,
        ...(key !== 'page' ? { page: 1 } : {}),
      },
    }));
  },

  setVehicleFilter: (key, value) => {
    set((s) => ({
      vehicleFilters: { ...s.vehicleFilters, [key]: value },
    }));
  },

  setCoordinationFilter: (key, value) => {
    set((s) => ({
      coordinationFilters: {
        ...s.coordinationFilters,
        [key]: value,
        ...(key !== 'page' ? { page: 1 } : {}),
      },
    }));
  },

  clearError: () => set({ error: null }),
  clearSelection: () => set({ selectedDelivery: null, selectedEquipment: null, reservations: [], trips: [] }),
}));
