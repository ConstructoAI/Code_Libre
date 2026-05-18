/**
 * ERP React Frontend - Suppliers API Module
 */

import api from './client';

export interface Supplier {
  id: number;
  companyId?: number;
  codeFournisseur?: string;
  nom: string;
  nomFournisseur?: string;
  companyNom?: string;
  contactNom?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  categorie?: string;
  categorieProduits?: string;
  conditionsPaiement?: string;
  delaiLivraisonMoyen?: number;
  contactCommercial?: string;
  contactTechnique?: string;
  evaluationQualite?: number;
  evaluation?: number;
  certifications?: string;
  notes?: string;
  notesEvaluation?: string;
  actif: boolean;
  estActif?: boolean;
  createdAt?: string;
  bonsCommande?: PurchaseOrder[];
}

export interface SupplierCreate {
  companyId: number;
  nomFournisseur?: string;
  codeFournisseur?: string;
  conditionsPaiement?: string;
  categorieProduits?: string;
  contactCommercial?: string;
  contactTechnique?: string;
  delaiLivraisonMoyen?: number;
  evaluationQualite?: number;
  certifications?: string;
  notes?: string;
  notesEvaluation?: string;
}

export interface PurchaseOrder {
  id: number;
  numero: string;
  fournisseurId?: number;
  projectId?: number;
  dateCommande?: string;
  dateLivraisonPrevue?: string;
  statut: string;
  montantTotal?: number;
  notes?: string;
  createdAt?: string;
  fournisseurNom?: string;
  nomProjet?: string;
}

export async function listSuppliers(params: {
  page?: number; perPage?: number; search?: string; categorie?: string; actif?: boolean;
} = {}): Promise<{ items: Supplier[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/suppliers', { params });
  return data;
}

export async function getSupplier(id: number): Promise<Supplier> {
  const { data } = await api.get(`/suppliers/${id}`);
  return data;
}

export async function createSupplier(body: SupplierCreate): Promise<{ id: number }> {
  const { data } = await api.post('/suppliers', body);
  return data;
}

export async function updateSupplier(id: number, body: Partial<Supplier>): Promise<void> {
  await api.put(`/suppliers/${id}`, body);
}

export async function listAllPurchaseOrders(params?: {
  page?: number; perPage?: number; statut?: string; projectId?: number;
}): Promise<{ items: PurchaseOrder[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/suppliers/purchase-orders', { params });
  return data;
}

export async function listPurchaseOrders(supplierId: number, params?: {
  page?: number; perPage?: number;
}): Promise<{ items: PurchaseOrder[]; total: number }> {
  const { data } = await api.get(`/suppliers/${supplierId}/orders`, { params });
  return data;
}

export async function createPurchaseOrder(supplierId: number, body: {
  projectId?: number; dateLivraisonPrevue?: string; notes?: string;
}): Promise<{ id: number; numero: string }> {
  const { data } = await api.post(`/suppliers/${supplierId}/orders`, body);
  return data;
}

export async function updatePurchaseOrderStatus(bcId: number, statut: string) {
  const { data } = await api.put(`/suppliers/purchase-orders/${bcId}/status`, { statut });
  return data;
}

export async function updatePurchaseOrderDates(bcId: number, body: { dateCommande?: string; dateLivraisonPrevue?: string }): Promise<void> {
  await api.put(`/suppliers/purchase-orders/${bcId}/dates`, body);
}

// ============ BC Lines (Lignes de bon de commande) ============

export interface BCLine {
  id: number;
  bonCommandeId: number;
  produitId?: number;
  produitNom?: string;
  codeProduit?: string;
  description: string;
  quantite: number;
  unite?: string;
  prixUnitaire: number;
  montant: number;
}

export async function listBCLines(bcId: number): Promise<{ items: BCLine[] }> {
  const { data } = await api.get(`/suppliers/orders/${bcId}/lines`);
  return data;
}

export async function addBCLine(bcId: number, body: {
  produitId?: number; description: string; quantite?: number;
  unite?: string; prixUnitaire?: number;
}): Promise<{ id: number; montant: number }> {
  const { data } = await api.post(`/suppliers/orders/${bcId}/lines`, body);
  return data;
}

export async function deleteBCLine(bcId: number, lineId: number): Promise<void> {
  await api.delete(`/suppliers/orders/${bcId}/lines/${lineId}`);
}

// ============ BC HTML Generation ============

export interface GenerateBCHtmlResponse {
  html: string;
  bcId: number;
  numero: string;
}

export async function generateBCHtml(bcId: number): Promise<GenerateBCHtmlResponse> {
  const { data } = await api.post(`/suppliers/orders/${bcId}/generate-html`);
  return data;
}

export async function deletePurchaseOrder(bcId: number): Promise<void> {
  await api.delete(`/suppliers/purchase-orders/${bcId}`);
}
