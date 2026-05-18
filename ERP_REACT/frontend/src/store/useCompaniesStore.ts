/**
 * ERP React Frontend - Companies & Contacts Zustand Store
 */

import { create } from 'zustand';
import * as companiesApi from '@/api/companies';
import type { Company, Contact, CompanyCreate, ContactCreate } from '@/api/companies';

interface CompaniesState {
  items: Company[];
  current: Company | null;
  contacts: Contact[];
  isLoading: boolean;
  error: string | null;
  filters: { search: string; typeFilter: string; page: number; perPage: number };
  total: number;

  // Actions
  fetchAll: () => Promise<void>;
  fetchOne: (id: number) => Promise<void>;
  create: (data: CompanyCreate) => Promise<Company>;
  update: (id: number, data: Partial<CompanyCreate>) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setFilter: (key: string, value: unknown) => void;
  clearError: () => void;

  // Contacts
  fetchContacts: (companyId?: number) => Promise<void>;
  createContact: (data: ContactCreate) => Promise<Contact>;
  updateContact: (id: number, data: Partial<ContactCreate>) => Promise<void>;
  removeContact: (id: number) => Promise<void>;
}

export const useCompaniesStore = create<CompaniesState>((set, get) => ({
  items: [],
  current: null,
  contacts: [],
  isLoading: false,
  error: null,
  filters: { search: '', typeFilter: '', page: 1, perPage: 25 },
  total: 0,

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const { filters } = get();
      const res = await companiesApi.listCompanies(filters);
      set({ items: res.items, total: res.total, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des entreprises';
      set({ isLoading: false, error: message });
    }
  },

  fetchOne: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const company = await companiesApi.getCompany(id);
      set({ current: company, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
      set({ isLoading: false, error: message });
    }
  },

  create: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await companiesApi.createCompany(data);
      const company = await companiesApi.getCompany(res.id);
      set((s) => ({ items: [company, ...s.items], isLoading: false }));
      return company;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  update: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await companiesApi.updateCompany(id, data);
      const updated = await companiesApi.getCompany(id);
      set((s) => ({
        items: s.items.map((c) => (c.id === id ? updated : c)),
        current: s.current?.id === id ? updated : s.current,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  remove: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await companiesApi.deleteCompany(id);
      set((s) => ({
        items: s.items.filter((c) => c.id !== id),
        current: s.current?.id === id ? null : s.current,
        total: s.total - 1,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  setFilter: (key, value) => {
    set((s) => ({ filters: { ...s.filters, [key]: value, page: key === 'page' ? (value as number) : 1 } }));
  },

  clearError: () => set({ error: null }),

  // ---- Contacts ----
  fetchContacts: async (companyId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await companiesApi.listContacts({ companyId });
      set({ contacts: res.items, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des contacts';
      set({ isLoading: false, error: message });
    }
  },

  createContact: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await companiesApi.createContact(data);
      const contact: Contact = { ...data, id: res.id, companyId: data.companyId ?? null, estPrincipal: data.estPrincipal ?? false };
      set((s) => ({ contacts: [contact, ...s.contacts], isLoading: false }));
      return contact;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la création du contact';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  updateContact: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      await companiesApi.updateContact(id, data);
      set((s) => ({
        contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...data } : c)),
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour du contact';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  removeContact: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await companiesApi.deleteContact(id);
      set((s) => ({ contacts: s.contacts.filter((c) => c.id !== id), isLoading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la suppression du contact';
      set({ isLoading: false, error: message });
      throw err;
    }
  },
}));
