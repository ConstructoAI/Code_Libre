/**
 * ERP React Frontend - Logistics API Module
 * Deliveries, Equipment, Vehicles, Coordination.
 */

import api from './client';
import type {
  Delivery,
  DeliveryItem,
  LogisticsEquipment,
  EquipmentReservation,
  Vehicle,
  VehicleTrip,
  SiteCoordination,
  LogisticsStats,
  PaginatedResponse,
} from '@/types';

// ============ Deliveries ============

export async function listDeliveries(params?: {
  page?: number; perPage?: number; statut?: string; projectId?: number;
}): Promise<PaginatedResponse<Delivery>> {
  const { data } = await api.get('/logistics/deliveries', { params });
  return data;
}

export async function getDelivery(id: number): Promise<Delivery & { items: DeliveryItem[] }> {
  const { data } = await api.get(`/logistics/deliveries/${id}`);
  return data;
}

export async function createDelivery(body: {
  datePrevue: string;
  projectId?: number;
  fournisseurId?: number;
  typeLivraison?: string;
  zoneStockage?: string;
  heurePrevue?: string;
  notes?: string;
}): Promise<{ id: number; reference: string }> {
  const { data } = await api.post('/logistics/deliveries', body);
  return data;
}

export async function updateDelivery(id: number, body: {
  statut?: string;
  datePrevue?: string;
  dateEffective?: string;
  typeLivraison?: string;
  zoneStockage?: string;
  notes?: string;
}): Promise<{ id: number }> {
  const { data } = await api.put(`/logistics/deliveries/${id}`, body);
  return data;
}

export async function deleteDelivery(id: number): Promise<void> {
  await api.delete(`/logistics/deliveries/${id}`);
}

// ============ Delivery Items ============

export async function addDeliveryItem(deliveryId: number, body: {
  description: string;
  quantitePrevue?: number;
  unite?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/logistics/deliveries/${deliveryId}/items`, body);
  return data;
}

export async function deleteDeliveryItem(deliveryId: number, itemId: number): Promise<void> {
  await api.delete(`/logistics/deliveries/${deliveryId}/items/${itemId}`);
}

// ============ Equipment ============

export async function listEquipment(params?: {
  page?: number; perPage?: number; categorie?: string; statut?: string;
}): Promise<PaginatedResponse<LogisticsEquipment>> {
  const { data } = await api.get('/logistics/equipment', { params });
  return data;
}

export async function getEquipment(id: number): Promise<LogisticsEquipment> {
  const { data } = await api.get(`/logistics/equipment/${id}`);
  return data;
}

export async function createEquipment(body: {
  nom: string;
  categorie?: string;
  typePossession?: string;
  coutJournalier?: number;
  coutMensuel?: number;
  statut?: string;
  localisationActuelle?: string;
  notes?: string;
}): Promise<{ id: number; code: string }> {
  const { data } = await api.post('/logistics/equipment', body);
  return data;
}

export async function updateEquipment(id: number, body: {
  nom?: string;
  categorie?: string;
  statut?: string;
  localisationActuelle?: string;
  notes?: string;
}): Promise<{ id: number }> {
  const { data } = await api.put(`/logistics/equipment/${id}`, body);
  return data;
}

export async function deleteEquipment(id: number): Promise<void> {
  await api.delete(`/logistics/equipment/${id}`);
}

// ============ Equipment Reservations ============

export async function listReservations(equipmentId: number): Promise<EquipmentReservation[]> {
  const { data } = await api.get(`/logistics/equipment/${equipmentId}/reservations`);
  return data.items ?? data;
}

export async function createReservation(equipmentId: number, body: {
  projectId?: number;
  dateDebut: string;
  dateFin?: string;
  responsable?: string;
  notes?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/logistics/equipment/${equipmentId}/reservations`, body);
  return data;
}

// ============ Vehicles ============

export async function listVehicles(params?: {
  statut?: string;
}): Promise<PaginatedResponse<Vehicle>> {
  const { data } = await api.get('/logistics/vehicles', { params });
  return data;
}

export async function createVehicle(body: {
  immatriculation: string;
  marque?: string;
  modele?: string;
  annee?: number;
  typeVehicule?: string;
  capaciteCharge?: number;
  uniteCapacite?: string;
  kilometrage?: number;
  consommationMoyenne?: number;
  coutKm?: number;
  notes?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post('/logistics/vehicles', body);
  return data;
}

export async function updateVehicle(id: number, body: {
  statut?: string;
  kilometrage?: number;
  notes?: string;
}): Promise<{ id: number }> {
  const { data } = await api.put(`/logistics/vehicles/${id}`, body);
  return data;
}

export async function deleteVehicle(id: number): Promise<void> {
  await api.delete(`/logistics/vehicles/${id}`);
}

// ============ Vehicle Trips ============

export async function listTrips(vehicleId: number): Promise<VehicleTrip[]> {
  const { data } = await api.get(`/logistics/vehicles/${vehicleId}/trips`);
  return data.items ?? data;
}

export async function createTrip(vehicleId: number, body: {
  projectId?: number;
  destination: string;
  motif?: string;
  kmDepart?: number;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/logistics/vehicles/${vehicleId}/trips`, body);
  return data;
}

// ============ Site Coordination ============

export async function listCoordination(params?: {
  page?: number; perPage?: number; projectId?: number; statut?: string;
}): Promise<PaginatedResponse<SiteCoordination>> {
  const { data } = await api.get('/logistics/coordination', { params });
  return data;
}

export async function createCoordination(body: {
  projectId?: number;
  dateCoordination: string;
  typeActivite: string;
  heureDebut?: string;
  heureFin?: string;
  zoneConcernee?: string;
  responsable?: string;
  notes?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post('/logistics/coordination', body);
  return data;
}

export async function updateCoordination(id: number, body: {
  statut?: string;
  notes?: string;
}): Promise<{ id: number }> {
  const { data } = await api.put(`/logistics/coordination/${id}`, body);
  return data;
}

export async function deleteCoordination(id: number): Promise<void> {
  await api.delete(`/logistics/coordination/${id}`);
}

// ============ Statistics ============

export async function getLogisticsStats(): Promise<LogisticsStats> {
  const { data } = await api.get('/logistics/statistics');
  return data;
}

// ============ Maintenance ============

export interface MaintenanceRecord {
  id: number;
  equipmentId: number;
  typeIntervention: string;
  dateIntervention: string;
  description: string;
  cout: number;
  technicien: string;
  prochaineDate: string;
  conforme: boolean;
  documents: string;
  createdAt: string;
}

export interface MaintenanceAlerte {
  id: number;
  code: string;
  nom: string;
  type: string;
  dateEcheance: string;
  urgence: string;
}

export async function listMaintenance(equipmentId: number): Promise<MaintenanceRecord[]> {
  const { data } = await api.get(`/logistics/equipment/${equipmentId}/maintenance`);
  return data.items ?? data;
}

export async function createMaintenance(equipmentId: number, body: {
  typeIntervention?: string;
  dateIntervention: string;
  description?: string;
  cout?: number;
  technicien?: string;
  prochaineDate?: string;
  conforme?: boolean;
  documents?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post(`/logistics/equipment/${equipmentId}/maintenance`, body);
  return data;
}

export async function updateMaintenance(maintenanceId: number, body: {
  typeIntervention?: string;
  description?: string;
  cout?: number;
  technicien?: string;
  prochaineDate?: string;
  conforme?: boolean;
  documents?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/logistics/maintenance/${maintenanceId}`, body);
  return data;
}

export async function deleteMaintenance(maintenanceId: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/logistics/maintenance/${maintenanceId}`);
  return data;
}

export async function getMaintenanceAlertes(): Promise<MaintenanceAlerte[]> {
  const { data } = await api.get('/logistics/maintenance/alertes');
  return data.items ?? data;
}

// ============ Alerts ============

export interface LogisticsAlert {
  id: number;
  typeAlerte: string;
  referenceType: string;
  referenceId: number;
  message: string;
  priorite: string;
  dateAlerte: string;
  dateEcheance: string;
  statut: string;
  traitePar: string;
  dateTraitement: string;
}

export async function listAlerts(params?: {
  statut?: string;
  priorite?: string;
}): Promise<LogisticsAlert[]> {
  const { data } = await api.get('/logistics/alerts', { params });
  return data.items ?? data;
}

export async function updateAlert(alertId: number, body: {
  statut?: string;
  traitePar?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/logistics/alerts/${alertId}`, body);
  return data;
}

export async function generateAlerts(): Promise<{ generated: number; message: string }> {
  const { data } = await api.post('/logistics/alerts/generate');
  return data;
}

// ============ IA ============

export interface IaAnalyseLogistiqueResult {
  analysis: unknown;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; model: string };
}

export interface IaChatLogistiqueResult {
  response: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; model: string };
}

export interface IaRapportLogistiqueResult {
  rapport: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; model: string };
}

export interface IaOptimisationLogistiqueResult {
  recommendation: unknown;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; model: string };
}

export async function analyserLogistique(): Promise<IaAnalyseLogistiqueResult> {
  const { data } = await api.post('/logistics/ia/analyser');
  return data;
}

export async function chatLogistique(body: {
  question: string;
  context?: string;
}): Promise<IaChatLogistiqueResult> {
  const { data } = await api.post('/logistics/ia/chat', body);
  return data;
}

export async function rapportLogistique(): Promise<IaRapportLogistiqueResult> {
  const { data } = await api.post('/logistics/ia/rapport');
  return data;
}

export async function optimiserLogistique(body: {
  besoin: string;
  nombreVehicules?: number;
  nombreEquipements?: number;
  nombreLivraisonsSemaine?: number;
}): Promise<IaOptimisationLogistiqueResult> {
  const { data } = await api.post('/logistics/ia/optimiser', body);
  return data;
}
