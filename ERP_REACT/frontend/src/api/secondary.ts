/**
 * ERP React Frontend - Secondary Modules API
 * Logistics, Rental, Maintenance, Weather, Compliance, Subsidies, Real Estate.
 */

import api from './client';
import type {
  Delivery,
  Vehicle,
  RentalItem,
  RentalContract,
  MaintenanceRequest,
  WeatherForecast,
  Subsidy,
  Property,
  PaginatedResponse,
} from '@/types';

// ============ Logistics ============
export async function listDeliveries(params?: { page?: number; perPage?: number; statut?: string }): Promise<PaginatedResponse<Delivery>> {
  const { data } = await api.get('/logistics/deliveries', { params });
  return data;
}
export async function listVehicles(): Promise<Vehicle[]> {
  const { data } = await api.get('/logistics/vehicles');
  return data;
}

// ============ Rental ============
export async function listRentalItems(): Promise<RentalItem[]> {
  const { data } = await api.get('/rental/items');
  return data;
}
export async function listRentalContracts(statut?: string): Promise<RentalContract[]> {
  const { data } = await api.get('/rental/contracts', { params: statut ? { statut } : undefined });
  return data;
}

// ============ Maintenance ============
export async function listMaintenanceRequests(statut?: string): Promise<MaintenanceRequest[]> {
  const { data } = await api.get('/maintenance/requests', { params: statut ? { statut } : undefined });
  return data;
}

// ============ Weather ============
export async function listWeatherStations(): Promise<WeatherForecast[]> {
  const { data } = await api.get('/weather/stations');
  return data;
}
export async function getWeatherForecast(lat?: number, lon?: number): Promise<WeatherForecast> {
  const { data } = await api.get('/weather/forecast', { params: { lat, lon } });
  return data;
}

// ============ Subsidies ============
export async function listSubsidyCategories(): Promise<Subsidy[]> {
  const { data } = await api.get('/subsidies/categories');
  return data;
}

// ============ Real Estate ============
export async function listRealestateProjects(): Promise<Property[]> {
  const { data } = await api.get('/realestate/projects');
  return data;
}
export async function createRealestateProject(body: any) {
  const { data } = await api.post('/realestate/projects', body);
  return data;
}
export async function getRealestateProject(id: number) {
  const { data } = await api.get(`/realestate/projects/${id}`);
  return data;
}
export async function createRealestateUnit(projectId: number, body: any) {
  const { data } = await api.post(`/realestate/projects/${projectId}/units`, body);
  return data;
}
export async function getRealestateStats() {
  const { data } = await api.get('/realestate/statistics');
  return data;
}

// ============ Maintenance CRUD ============
export async function createMaintenanceRequest(body: any) {
  const { data } = await api.post('/maintenance/requests', body);
  return data;
}
export async function updateMaintenanceRequest(id: number, body: any) {
  const { data } = await api.put(`/maintenance/requests/${id}`, body);
  return data;
}
export async function getMaintenanceStats() {
  const { data } = await api.get('/maintenance/statistics');
  return data;
}

// ============ Rental CRUD ============
export async function createRentalContract(body: any) {
  const { data } = await api.post('/rental/contracts', body);
  return data;
}
export async function updateRentalContract(id: number, body: any) {
  const { data } = await api.put(`/rental/contracts/${id}`, body);
  return data;
}
export async function getRentalStats() {
  const { data } = await api.get('/rental/statistics');
  return data;
}

// ============ Logistics CRUD ============
export async function createDelivery(body: any) {
  const { data } = await api.post('/logistics/deliveries', body);
  return data;
}
export async function updateDelivery(id: number, body: any) {
  const { data } = await api.put(`/logistics/deliveries/${id}`, body);
  return data;
}
export async function getLogisticsStats() {
  const { data } = await api.get('/logistics/statistics');
  return data;
}

// ============ Subsidies CRUD ============
export async function createSubsidyApplication(body: any) {
  const { data } = await api.post('/subsidies/applications', body);
  return data;
}
export async function listSubsidyApplications() {
  const { data } = await api.get('/subsidies/applications');
  return data;
}
export async function getSubsidyStats() {
  const { data } = await api.get('/subsidies/statistics');
  return data;
}
