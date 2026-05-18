/**
 * ERP React Frontend - GPS Zustand Store
 */

import { create } from 'zustand';
import * as gpsApi from '@/api/gps';
import type {
  GpsVehicle, GpsTrackingPoint, GpsLocation, GpsLocationCreate,
  GpsGeofence, GpsGeofenceCreate, GpsRoute,
} from '@/api/gps';

interface GpsState {
  vehicles: GpsVehicle[];
  vehicleHistory: GpsTrackingPoint[];
  locations: GpsLocation[];
  geofences: GpsGeofence[];
  routes: GpsRoute[];
  isLoading: boolean;
  error: string | null;

  fetchVehicles: () => Promise<void>;
  fetchVehicleHistory: (vehicleId: number, hours?: number) => Promise<void>;
  fetchLocations: () => Promise<void>;
  createLocation: (data: GpsLocationCreate) => Promise<void>;
  fetchGeofences: () => Promise<void>;
  createGeofence: (data: GpsGeofenceCreate) => Promise<void>;
  fetchRoutes: (date?: string) => Promise<void>;
  clearError: () => void;
}

export const useGpsStore = create<GpsState>((set, get) => ({
  vehicles: [],
  vehicleHistory: [],
  locations: [],
  geofences: [],
  routes: [],
  isLoading: false,
  error: null,

  fetchVehicles: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await gpsApi.listVehicles();
      set({ vehicles: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Erreur' });
    }
  },

  fetchVehicleHistory: async (vehicleId, hours) => {
    set({ isLoading: true, error: null });
    try {
      const res = await gpsApi.getVehicleHistory(vehicleId, hours);
      set({ vehicleHistory: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Erreur' });
    }
  },

  fetchLocations: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await gpsApi.listLocations();
      set({ locations: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Erreur' });
    }
  },

  createLocation: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await gpsApi.createLocation(data);
      await get().fetchLocations();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Erreur' });
      throw err;
    }
  },

  fetchGeofences: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await gpsApi.listGeofences();
      set({ geofences: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Erreur' });
    }
  },

  createGeofence: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await gpsApi.createGeofence(data);
      await get().fetchGeofences();
      set({ isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Erreur' });
      throw err;
    }
  },

  fetchRoutes: async (date) => {
    set({ isLoading: true, error: null });
    try {
      const res = await gpsApi.listRoutes(date);
      set({ routes: res.items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Erreur' });
    }
  },

  clearError: () => set({ error: null }),
}));
