/**
 * ERP React Frontend - Secondary Modules Zustand Store
 * Logistics, Rental, Maintenance, Weather, Subsidies, Real Estate.
 * (Conformite RBQ/CCQ has been migrated to useConformiteStore.)
 */

import { create } from 'zustand';
import * as secondaryApi from '@/api/secondary';
import type {
  Delivery,
  Vehicle,
  RentalItem,
  RentalContract,
  MaintenanceRequest,
  WeatherForecast,
  Subsidy,
  Property,
} from '@/types';

interface SecondaryState {
  // Logistics
  deliveries: Delivery[];
  vehicles: Vehicle[];
  // Rental
  rentalItems: RentalItem[];
  rentalContracts: RentalContract[];
  // Maintenance
  maintenanceRequests: MaintenanceRequest[];
  // Weather
  weatherStations: WeatherForecast[];
  weatherForecast: WeatherForecast | null;
  // Subsidies
  subsidyCategories: Subsidy[];
  // Real Estate
  realestateProjects: Property[];

  isLoading: boolean;
  error: string | null;

  // Logistics actions
  fetchDeliveries: (statut?: string) => Promise<void>;
  fetchVehicles: () => Promise<void>;

  // Rental actions
  fetchRentalItems: () => Promise<void>;
  fetchRentalContracts: (statut?: string) => Promise<void>;

  // Maintenance actions
  fetchMaintenanceRequests: (statut?: string) => Promise<void>;

  // Weather actions
  fetchWeatherStations: () => Promise<void>;
  fetchWeatherForecast: (lat?: number, lon?: number) => Promise<void>;

  // Subsidies actions
  fetchSubsidyCategories: () => Promise<void>;

  // Real Estate actions
  fetchRealestateProjects: () => Promise<void>;

  clearError: () => void;
}

export const useSecondaryStore = create<SecondaryState>((set) => ({
  deliveries: [],
  vehicles: [],
  rentalItems: [],
  rentalContracts: [],
  maintenanceRequests: [],
  weatherStations: [],
  weatherForecast: null,
  subsidyCategories: [],
  realestateProjects: [],
  isLoading: false,
  error: null,

  // ---- Logistics ----
  fetchDeliveries: async (statut) => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.listDeliveries({ statut });
      set({ deliveries: res.items ?? res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des livraisons';
      set({ isLoading: false, error: message });
    }
  },

  fetchVehicles: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.listVehicles();
      set({ vehicles: (res as unknown as { items?: Vehicle[] }).items ?? res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des véhicules';
      set({ isLoading: false, error: message });
    }
  },

  // ---- Rental ----
  fetchRentalItems: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.listRentalItems();
      set({ rentalItems: (res as unknown as { items?: RentalItem[] }).items ?? res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des items de location';
      set({ isLoading: false, error: message });
    }
  },

  fetchRentalContracts: async (statut) => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.listRentalContracts(statut);
      set({ rentalContracts: (res as unknown as { items?: RentalContract[] }).items ?? res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des contrats';
      set({ isLoading: false, error: message });
    }
  },

  // ---- Maintenance ----
  fetchMaintenanceRequests: async (statut) => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.listMaintenanceRequests(statut);
      const items = (res as unknown as { items?: MaintenanceRequest[] }).items ?? (Array.isArray(res) ? res : []);
      set({ maintenanceRequests: items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des demandes de maintenance';
      set({ isLoading: false, error: message });
    }
  },

  // ---- Weather ----
  fetchWeatherStations: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.listWeatherStations();
      set({ weatherStations: (res as unknown as { items?: WeatherForecast[] }).items ?? res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des stations météo';
      set({ isLoading: false, error: message });
    }
  },

  fetchWeatherForecast: async (lat, lon) => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.getWeatherForecast(lat, lon);
      set({ weatherForecast: res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des prévisions';
      set({ isLoading: false, error: message });
    }
  },

  // ---- Subsidies ----
  fetchSubsidyCategories: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.listSubsidyCategories();
      set({ subsidyCategories: (res as unknown as { items?: Subsidy[] }).items ?? res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des subventions';
      set({ isLoading: false, error: message });
    }
  },

  // ---- Real Estate ----
  fetchRealestateProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await secondaryApi.listRealestateProjects();
      set({ realestateProjects: (res as unknown as { items?: Property[] }).items ?? res, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des projets immobiliers';
      set({ isLoading: false, error: message });
    }
  },

  clearError: () => set({ error: null }),
}));
