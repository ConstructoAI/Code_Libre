/**
 * ERP React Frontend - Location (Equipment Rental) API Module
 * Items catalog, rental contracts, contract lines, returns,
 * employee rental, statistics, and IA helpers.
 */

import api from './client';
import type {
  RentalItem,
  RentalContract,
  RentalContratLigne,
  RentalRetour,
  RentalEmployee,
  RentalEmployeeContract,
  RentalEmployeeStats,
  RentalStats,
} from '@/types';

// ============ IA-specific response types ============

export interface LocationIaUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

export interface LocationIaChatResponse {
  response: string;
  usage: LocationIaUsage;
}

export interface LocationIaJsonResponse {
  recommendation?: unknown;
  analysis?: unknown;
  checklist?: string;
  usage: LocationIaUsage;
}

// ============ Items / Catalogue ============

export async function listItems(params?: {
  page?: number;
  perPage?: number;
  categorie?: string;
  etat?: string;
  disponible?: boolean;
}): Promise<{ items: RentalItem[]; total: number }> {
  const { data } = await api.get('/rental/items', { params });
  return { items: data.items ?? data, total: data.total ?? (data.items ?? data).length };
}

export async function createItem(body: {
  nom: string;
  description?: string;
  categorie?: string;
  numeroSerie?: string;
  marque?: string;
  modele?: string;
  anneeFabrication?: number;
  etat?: string;
  quantiteTotale?: number;
  valeurAchat?: number;
  valeurRemplacement?: number;
  tarifJournalier?: number;
  tarifHebdomadaire?: number;
  tarifMensuel?: number;
  cautionRequise?: number;
  assuranceRequise?: boolean;
  conditionsLocation?: string;
  notes?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/rental/items', body);
  return data;
}

export async function updateItem(id: number, body: {
  nom?: string;
  description?: string;
  categorie?: string;
  numeroSerie?: string;
  marque?: string;
  modele?: string;
  anneeFabrication?: number;
  etat?: string;
  quantiteTotale?: number;
  valeurAchat?: number;
  valeurRemplacement?: number;
  tarifJournalier?: number;
  tarifHebdomadaire?: number;
  tarifMensuel?: number;
  cautionRequise?: number;
  assuranceRequise?: boolean;
  conditionsLocation?: string;
  notes?: string;
  actif?: boolean;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/rental/items/${id}`, body);
  return data;
}

export async function deleteItem(id: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/rental/items/${id}`);
  return data;
}

// ============ Contracts ============

export async function listContracts(params?: {
  statut?: string;
  page?: number;
  perPage?: number;
}): Promise<{ items: RentalContract[] }> {
  const { data } = await api.get('/rental/contracts', { params });
  return { items: data.items ?? data };
}

export async function getContract(id: number): Promise<{
  contrat: RentalContract;
  lignes: RentalContratLigne[];
}> {
  const { data } = await api.get(`/rental/contracts/${id}`);
  return data;
}

export async function createContract(body: {
  clientNomCache: string;
  clientType?: string;
  clientCompanyId?: number;
  clientContactId?: number;
  projectId?: number;
  responsableId?: number;
  dateDebut: string;
  dateFinPrevue?: string;
  dureeType?: string;
  dureeNombre?: number;
  cautionMontant?: number;
  conditionsParticulieres?: string;
  lieuLivraison?: string;
  lieuRetour?: string;
  notes?: string;
}): Promise<{ id: number; numeroContrat: string; message: string }> {
  const { data } = await api.post('/rental/contracts', body);
  return data;
}

export async function updateContract(id: number, body: {
  statut?: string;
  clientNomCache?: string;
  dateDebut?: string;
  dateFinPrevue?: string;
  dateFinReelle?: string;
  dureeType?: string;
  dureeNombre?: number;
  cautionMontant?: number;
  cautionRecue?: boolean;
  conditionsParticulieres?: string;
  lieuLivraison?: string;
  lieuRetour?: string;
  notes?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/rental/contracts/${id}`, body);
  return data;
}

export async function deleteContract(id: number): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/rental/contracts/${id}`);
  return data;
}

// ============ Contract Lines ============

export async function addContractLine(contractId: number, body: {
  locationItemId: number;
  quantite?: number;
  tarifUnitaire: number;
  tarifType?: string;
  remisePourcent?: number;
  dateSortie?: string;
  dateRetourPrevue?: string;
  etatSortie?: string;
  notesSortie?: string;
}): Promise<{ id: number; montantLigne: number; message: string }> {
  const { data } = await api.post(`/rental/contracts/${contractId}/lignes`, body);
  return data;
}

export async function updateContractLine(contractId: number, ligneId: number, body: {
  quantite?: number;
  tarifUnitaire?: number;
  tarifType?: string;
  remisePourcent?: number;
  dateSortie?: string;
  dateRetourPrevue?: string;
  dateRetourReelle?: string;
  etatSortie?: string;
  etatRetour?: string;
  notesSortie?: string;
  notesRetour?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/rental/contracts/${contractId}/lignes/${ligneId}`, body);
  return data;
}

export async function deleteContractLine(
  contractId: number,
  ligneId: number,
): Promise<{ id: number; message: string }> {
  const { data } = await api.delete(`/rental/contracts/${contractId}/lignes/${ligneId}`);
  return data;
}

// ============ Returns ============

export async function listReturns(contratId?: number): Promise<RentalRetour[]> {
  const { data } = await api.get('/rental/returns', {
    params: contratId ? { contratId } : undefined,
  });
  return data.items ?? data;
}

export async function createReturn(body: {
  contratId: number;
  ligneId: number;
  locationItemId: number;
  dateRetour?: string;
  etatAvant?: string;
  etatApres?: string;
  dommagesConstates?: string;
  fraisReparation?: number;
  fraisNettoyage?: number;
  fraisRetard?: number;
  commentaires?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/rental/returns', body);
  return data;
}

// ============ Employees (rental workforce) ============

export async function listRentalEmployees(params?: {
  disponibleOnly?: boolean;
  metier?: string;
}): Promise<RentalEmployee[]> {
  const { data } = await api.get('/rental/employees', { params });
  return data.items ?? data;
}

export async function updateEmployeeConfig(employeeId: number, body: {
  disponibleLocation?: boolean;
  statutLocation?: string;
  metierPrincipal?: string;
  tauxHoraireLocation?: number;
  tauxJournalierLocation?: number;
  certificationsJson?: string;
  notesLocation?: string;
}): Promise<{ employeeId: number; message: string }> {
  const { data } = await api.put(`/rental/employees/${employeeId}/config`, body);
  return data;
}

export async function listEmployeeContracts(params?: {
  statut?: string;
  employeeId?: number;
}): Promise<RentalEmployeeContract[]> {
  const { data } = await api.get('/rental/employees/contracts', { params });
  return data.items ?? data;
}

export async function createEmployeeContract(body: {
  employeeId: number;
  clientCompanyId?: number;
  projectId?: number;
  dateDebut: string;
  dateFinPrevue: string;
  tarifType?: string;
  tarifUnitaire?: number;
  heuresPrevues?: number;
  lieuTravail?: string;
  descriptionMission?: string;
  notes?: string;
}): Promise<{ id: number; numeroContrat: string; message: string }> {
  const { data } = await api.post('/rental/employees/contracts', body);
  return data;
}

export async function updateEmployeeContract(id: number, body: {
  statut?: string;
  dateFinPrevue?: string;
  dateFinReelle?: string;
  tarifType?: string;
  tarifUnitaire?: number;
  heuresPrevues?: number;
  lieuTravail?: string;
  descriptionMission?: string;
  notes?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.put(`/rental/employees/contracts/${id}`, body);
  return data;
}

export async function recordEmployeeHours(contractId: number, body: {
  dateTravail: string;
  heuresNormales?: number;
  heuresSupplementaires?: number;
  notes?: string;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post(`/rental/employees/contracts/${contractId}/heures`, body);
  return data;
}

export async function getEmployeeStats(): Promise<RentalEmployeeStats> {
  const { data } = await api.get('/rental/employees/stats');
  return data;
}

// ============ Statistics ============

export async function getStats(): Promise<RentalStats> {
  const { data } = await api.get('/rental/statistics');
  return data;
}

// ============ IA Helpers ============

export async function iaChat(body: {
  question: string;
  context?: string;
}): Promise<LocationIaChatResponse> {
  const { data } = await api.post('/rental/ia/chat', body);
  return data;
}

export async function iaRecommander(body: {
  descriptionProjet: string;
  budget?: number;
  dureeJours?: number;
}): Promise<LocationIaJsonResponse> {
  const { data } = await api.post('/rental/ia/recommander', body);
  return data;
}

export async function iaAnalyserContrat(body: {
  contratId: number;
}): Promise<LocationIaJsonResponse> {
  const { data } = await api.post('/rental/ia/analyser-contrat', body);
  return data;
}

export async function iaChecklist(body: {
  equipementType: string;
  dureeLocation: string;
}): Promise<LocationIaJsonResponse> {
  const { data } = await api.post('/rental/ia/checklist', body);
  return data;
}

export async function iaLocationVsAchat(body: {
  equipement: string;
  prixAchat: number;
  tarifLocationJour: number;
  utilisationJoursAn: number;
}): Promise<LocationIaJsonResponse> {
  const { data } = await api.post('/rental/ia/location-vs-achat', body);
  return data;
}
