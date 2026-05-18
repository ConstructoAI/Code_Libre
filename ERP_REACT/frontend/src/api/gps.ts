/**
 * ERP React Frontend - GPS API Module
 * Vehicle tracking, locations, geofences, routes.
 */

import api from './client';

// ============ Interfaces ============

export interface GpsVehicle {
  id: number;
  marque: string;
  modele: string;
  immatriculation: string;
  statut: string;
  kmActuel?: number;
  latitude?: number;
  longitude?: number;
  vitesse?: number;
  cap?: number;
  dernierePosition?: string;
}

export interface GpsTrackingPoint {
  id: number;
  latitude: number;
  longitude: number;
  vitesse?: number;
  cap?: number;
  altitude?: number;
  timestamp: string;
}

export interface GpsLocation {
  id: number;
  nom: string;
  typeLieu: string;
  latitude: number;
  longitude: number;
  adresse?: string;
  ville?: string;
  rayonMetres?: number;
  notes?: string;
  createdAt?: string;
}

export interface GpsLocationCreate {
  nom: string;
  typeLieu?: string;
  latitude: number;
  longitude: number;
  adresse?: string;
  ville?: string;
  rayonMetres?: number;
  notes?: string;
}

export interface GpsGeofence {
  id: number;
  nom: string;
  typeZone: string;
  latitudeCentre: number;
  longitudeCentre: number;
  rayonMetres: number;
  alerteEntree: boolean;
  alerteSortie: boolean;
  notes?: string;
  createdAt?: string;
}

export interface GpsGeofenceCreate {
  nom: string;
  typeZone?: string;
  latitudeCentre: number;
  longitudeCentre: number;
  rayonMetres?: number;
  alerteEntree?: boolean;
  alerteSortie?: boolean;
  notes?: string;
}

export interface GpsRoute {
  id: number;
  vehicleId: number;
  marque?: string;
  modele?: string;
  immatriculation?: string;
  origine?: string;
  destination?: string;
  dateDepart?: string;
  dateArrivee?: string;
  distanceKm?: number;
  statut?: string;
}

// ============ Vehicles ============

export async function listVehicles(): Promise<{ items: GpsVehicle[] }> {
  const { data } = await api.get('/gps/vehicles');
  return data;
}

export async function getVehicleHistory(vehicleId: number, hours?: number): Promise<{
  items: GpsTrackingPoint[]; vehicleId: number; hours: number;
}> {
  const { data } = await api.get(`/gps/vehicles/${vehicleId}/history`, {
    params: hours ? { hours } : undefined,
  });
  return data;
}

// ============ Locations ============

export async function listLocations(): Promise<{ items: GpsLocation[] }> {
  const { data } = await api.get('/gps/locations');
  return data;
}

export async function createLocation(body: GpsLocationCreate): Promise<{ id: number }> {
  const { data } = await api.post('/gps/locations', body);
  return data;
}

// ============ Geofences ============

export async function listGeofences(): Promise<{ items: GpsGeofence[] }> {
  const { data } = await api.get('/gps/geofences');
  return data;
}

export async function createGeofence(body: GpsGeofenceCreate): Promise<{ id: number }> {
  const { data } = await api.post('/gps/geofences', body);
  return data;
}

// ============ Routes ============

export async function listRoutes(date?: string): Promise<{ items: GpsRoute[] }> {
  const { data } = await api.get('/gps/routes', { params: date ? { date } : undefined });
  return data;
}
