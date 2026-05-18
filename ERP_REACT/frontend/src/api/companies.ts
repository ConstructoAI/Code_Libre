/**
 * ERP React Frontend - Companies & Contacts API Module
 */

import api from './client';

export interface Company {
  id: number;
  nom: string;
  typeCompany?: string;
  secteurActivite?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  pays?: string;
  siteWeb?: string;
  contactPrincipalId?: number;
  statut?: string;
  numeroTps?: string;
  numeroTvq?: string;
  paymentTerms?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  contacts?: Contact[];
}

export interface Contact {
  id: number;
  companyId: number | null;
  prenom: string;
  nomFamille: string;
  nom?: string;
  email?: string;
  telephone?: string;
  mobile?: string;
  rolePoste?: string;
  fonction?: string;
  departement?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  estPrincipal: boolean;
  notes?: string;
  createdAt?: string;
  companyNom?: string;
}

export interface CompanyCreate {
  nom: string;
  typeCompany?: string;
  secteurActivite?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  pays?: string;
  siteWeb?: string;
  contactPrincipalId?: number;
  numeroTps?: string;
  numeroTvq?: string;
  paymentTerms?: string;
  notes?: string;
}

export interface ContactCreate {
  companyId?: number | null;
  prenom: string;
  nomFamille: string;
  email?: string;
  telephone?: string;
  mobile?: string;
  rolePoste?: string;
  fonction?: string;
  departement?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  estPrincipal?: boolean;
  notes?: string;
}

export async function listCompanies(params: {
  page?: number; perPage?: number; search?: string; typeFilter?: string;
} = {}): Promise<{ items: Company[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/companies', { params });
  return data;
}

export async function getCompany(id: number): Promise<Company> {
  const { data } = await api.get(`/companies/${id}`);
  return data;
}

export async function createCompany(body: CompanyCreate): Promise<{ id: number }> {
  const { data } = await api.post('/companies', body);
  return data;
}

export async function updateCompany(id: number, body: Partial<CompanyCreate>): Promise<void> {
  await api.put(`/companies/${id}`, body);
}

export async function deleteCompany(id: number): Promise<void> {
  await api.delete(`/companies/${id}`);
}

export async function listContacts(params: {
  companyId?: number; page?: number; perPage?: number; search?: string;
} = {}): Promise<{ items: Contact[]; total: number; page: number; perPage: number }> {
  const { data } = await api.get('/contacts', { params });
  return data;
}

export async function createContact(body: ContactCreate): Promise<{ id: number }> {
  const { data } = await api.post('/contacts', body);
  return data;
}

export async function updateContact(id: number, body: Partial<ContactCreate>): Promise<void> {
  await api.put(`/contacts/${id}`, body);
}

export async function deleteContact(id: number): Promise<void> {
  await api.delete(`/contacts/${id}`);
}
