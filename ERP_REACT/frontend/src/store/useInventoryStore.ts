/**
 * ERP React Frontend - Inventory & Products Zustand Store
 */

import { create } from 'zustand';
import * as inventoryApi from '@/api/inventory';
import type { Product, StockMovement, InventoryStats } from '@/api/inventory';

// Helper extractError (lecon #45): preserver le message backend `detail` au
// lieu de masquer avec un message generique. L'utilisateur voit la vraie
// raison de l'erreur (ex: "Stock insuffisant: demande 10, disponible 3").
const extractError = (err: unknown, fallback: string): string => {
  const e = err as any;
  return (
    e?.response?.data?.detail
    || e?.response?.data?.message
    || (err instanceof Error ? err.message : null)
    || fallback
  );
};

interface InventoryState {
  items: Product[];
  current: Product | null;
  movements: StockMovement[];
  stats: InventoryStats | null;
  categories: string[];
  isLoading: boolean;
  error: string | null;
  filters: { search: string; categorie: string; lowStock: boolean; page: number; perPage: number };
  total: number;

  // Actions
  fetchAll: () => Promise<void>;
  fetchOne: (id: number) => Promise<void>;
  create: (data: Partial<Product>) => Promise<Product>;
  update: (id: number, data: Partial<Product>) => Promise<void>;
  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;

  // Stock
  fetchMovements: (produitId?: number) => Promise<void>;
  createMovement: (data: {
    produitId: number; typeMouvement: string; quantite: number;
    reference?: string; motif?: string;
  }) => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchCategories: () => Promise<void>;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  items: [],
  current: null,
  movements: [],
  stats: null,
  categories: [],
  isLoading: false,
  error: null,
  filters: { search: '', categorie: '', lowStock: false, page: 1, perPage: 25 },
  total: 0,

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await inventoryApi.listProducts(filters);
      set({ items: res.items, total: res.total, isLoading: false });
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement des produits');
      set({ isLoading: false, error: message });
    }
  },

  fetchOne: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const product = await inventoryApi.getProduct(id);
      set({ current: product, isLoading: false });
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement');
      set({ isLoading: false, error: message });
    }
  },

  create: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await inventoryApi.createProduct(data);
      const product = await inventoryApi.getProduct(res.id);
      set((s) => ({ items: [product, ...s.items], isLoading: false }));
      return product;
    } catch (err) {
      const message = extractError(err, 'Erreur lors de la création');
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  update: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await inventoryApi.updateProduct(id, data);
      const updated = await inventoryApi.getProduct(id);
      set((s) => ({
        items: s.items.map((p) => (p.id === id ? updated : p)),
        current: s.current?.id === id ? updated : s.current,
        isLoading: false,
      }));
    } catch (err) {
      const message = extractError(err, 'Erreur lors de la mise à jour');
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value, page: key === 'page' ? (value as number) : 1 } }));
  },

  clearError: () => set({ error: null }),

  // ---- Stock Movements ----
  fetchMovements: async (produitId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await inventoryApi.listStockMovements({ produitId });
      set({ movements: res.items, isLoading: false });
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement des mouvements');
      set({ isLoading: false, error: message });
    }
  },

  createMovement: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await inventoryApi.createStockMovement(data);
      // Refresh movements and product
      const [movRes, product] = await Promise.all([
        inventoryApi.listStockMovements({ produitId: data.produitId }),
        inventoryApi.getProduct(data.produitId),
      ]);
      set((s) => ({
        movements: movRes.items,
        items: s.items.map((p) => (p.id === data.produitId ? product : p)),
        current: s.current?.id === data.produitId ? product : s.current,
        isLoading: false,
      }));
    } catch (err) {
      const message = extractError(err, 'Erreur lors du mouvement de stock');
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  fetchStats: async () => {
    set({ isLoading: true, error: null });
    try {
      const stats = await inventoryApi.getInventoryStats();
      set({ stats, isLoading: false });
    } catch (err) {
      const message = extractError(err, 'Erreur lors du chargement des statistiques');
      set({ isLoading: false, error: message });
    }
  },

  fetchCategories: async () => {
    try {
      const res = await inventoryApi.getProductCategories();
      set({ categories: res.categories });
    } catch {
      // Non-blocking — categories are supplementary
    }
  },
}));
