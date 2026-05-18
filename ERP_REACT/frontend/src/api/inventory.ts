/**
 * ERP React Frontend - Inventory & Products API Module
 */

import api from './client';

export interface Product {
  id: number;
  codeProduit?: string;
  nom: string;
  description?: string;
  categorie?: string;
  materiau?: string;
  uniteVente: string;
  coutRevient?: number;
  prixUnitaire?: number;
  fournisseurPrincipal?: string;
  stockDisponible: number;
  stockMinimum: number;
  emplacementStock?: string;
  notesTechniques?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  mouvements?: StockMovement[];
}

export interface StockMovement {
  id: number;
  produitId: number;
  typeMouvement: string;
  quantite: number;
  referenceDocument?: string;
  motif?: string;
  createdAt?: string;
  produitNom?: string;
}

export interface InventoryStats {
  totalProduits: number;
  alertesStock: number;
  valeurInventaire: number;
  nbCategories: number;
}

export async function listProducts(params: {
  page?: number; perPage?: number; search?: string; categorie?: string; lowStock?: boolean;
} = {}): Promise<{ items: Product[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/products', { params });
  return data;
}

export async function getProductCategories(): Promise<{ categories: string[] }> {
  const { data } = await api.get('/products/categories');
  return data;
}

export async function getProduct(id: number): Promise<Product> {
  const { data } = await api.get(`/products/${id}`);
  return data;
}

export async function createProduct(body: Partial<Product>): Promise<{ id: number }> {
  const { data } = await api.post('/products', body);
  return data;
}

export async function updateProduct(id: number, body: Partial<Product>): Promise<void> {
  await api.put(`/products/${id}`, body);
}

export async function createStockMovement(body: {
  produitId: number; typeMouvement: string; quantite: number;
  reference?: string; motif?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post('/stock-movements', body);
  return data;
}

export async function listStockMovements(params?: {
  produitId?: number; page?: number; perPage?: number;
}): Promise<{ items: StockMovement[]; total: number }> {
  const { data } = await api.get('/stock-movements', { params });
  return data;
}

export async function getInventoryStats(): Promise<InventoryStats> {
  const { data } = await api.get('/inventory/stats');
  return data;
}

// ============ BOM — Composants (Parent-Enfant) ============

export interface BOMComposant {
  id: number;
  parentProduitId: number;
  enfantProduitId: number;
  quantite: number;
  unite?: string;
  notes?: string;
  enfantNom?: string;
  enfantCode?: string;
  uniteVente?: string;
  prixUnitaire?: number;
  stockDisponible?: number;
}

export interface BOMParent {
  id: number;
  parentProduitId: number;
  quantite: number;
  unite?: string;
  parentNom?: string;
  parentCode?: string;
}

export async function listComposants(productId: number): Promise<{ composants: BOMComposant[]; utiliseDans: BOMParent[] }> {
  const { data } = await api.get(`/products/${productId}/composants`);
  return data;
}

export async function addComposant(productId: number, body: {
  enfantProduitId: number; quantite?: number; unite?: string; notes?: string;
}): Promise<{ id: number }> {
  const { data } = await api.post(`/products/${productId}/composants`, body);
  return data;
}

export async function updateComposant(productId: number, composantId: number, body: {
  quantite?: number; unite?: string; notes?: string;
}): Promise<void> {
  await api.put(`/products/${productId}/composants/${composantId}`, body);
}

export async function deleteComposant(productId: number, composantId: number): Promise<void> {
  await api.delete(`/products/${productId}/composants/${composantId}`);
}
