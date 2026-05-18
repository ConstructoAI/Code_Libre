/**
 * ERP React Frontend - Suppliers Zustand Store
 */

import { create } from 'zustand';
import * as suppliersApi from '@/api/suppliers';
import type { Supplier, PurchaseOrder, SupplierCreate } from '@/api/suppliers';

interface SuppliersState {
  items: Supplier[];
  current: Supplier | null;
  purchaseOrders: PurchaseOrder[];
  isLoading: boolean;
  error: string | null;
  filters: { search: string; categorie: string; actif: boolean | undefined; page: number; perPage: number };
  total: number;

  // Actions
  fetchAll: () => Promise<void>;
  fetchOne: (id: number) => Promise<void>;
  create: (data: SupplierCreate) => Promise<Supplier>;
  update: (id: number, data: Partial<Supplier>) => Promise<void>;
  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;

  // Purchase Orders
  fetchPurchaseOrders: (supplierId: number) => Promise<void>;
  createPurchaseOrder: (supplierId: number, data: {
    dateLivraisonPrevue?: string; notes?: string;
  }) => Promise<{ id: number; numero: string }>;
}

export const useSuppliersStore = create<SuppliersState>((set, get) => ({
  items: [],
  current: null,
  purchaseOrders: [],
  isLoading: false,
  error: null,
  filters: { search: '', categorie: '', actif: undefined, page: 1, perPage: 25 },
  total: 0,

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await suppliersApi.listSuppliers(filters);
      set({ items: res.items, total: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des fournisseurs';
      set({ isLoading: false, error: message });
    }
  },

  fetchOne: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const supplier = await suppliersApi.getSupplier(id);
      set({ current: supplier, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  create: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await suppliersApi.createSupplier(data);
      const supplier = await suppliersApi.getSupplier(res.id);
      set((s) => ({ items: [supplier, ...s.items], isLoading: false }));
      return supplier;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  update: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await suppliersApi.updateSupplier(id, data);
      const updated = await suppliersApi.getSupplier(id);
      set((s) => ({
        items: s.items.map((sup) => (sup.id === id ? updated : sup)),
        current: s.current?.id === id ? updated : s.current,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value, page: key === 'page' ? (value as number) : 1 } }));
  },

  clearError: () => set({ error: null }),

  // ---- Purchase Orders ----
  fetchPurchaseOrders: async (supplierId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await suppliersApi.listPurchaseOrders(supplierId);
      set({ purchaseOrders: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des bons de commande';
      set({ isLoading: false, error: message });
    }
  },

  createPurchaseOrder: async (supplierId, data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await suppliersApi.createPurchaseOrder(supplierId, data);
      // Refresh purchase orders
      const updated = await suppliersApi.listPurchaseOrders(supplierId);
      set({ purchaseOrders: updated.items, isLoading: false });
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création du bon de commande';
      set({ isLoading: false, error: message });
      throw err;
    }
  },
}));
