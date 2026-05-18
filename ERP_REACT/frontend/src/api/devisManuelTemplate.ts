/**
 * ERP React Frontend - Devis Manuel Template API Module
 *
 * Catalogue personnalisable du sous-module Manuel: sections + lignes persistees en BD par tenant.
 * Les sections fixes (0.0 a 8.0) restent dans constructionItems.ts; ce module gere uniquement le perso.
 */

import api from './client';

export interface CustomSection {
  id: number;
  nom: string;
  sequence: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomLigne {
  id: number;
  sectionCode?: string | null; // "1.0" .. "8.0" si attachee a section fixe
  sectionId?: number | null; // id si attachee a section perso
  titre: string;
  description: string;
  unite: string;
  prixUnitaire: number;
  quantiteDefault: number;
  categorie?: string | null;
  sequence: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SectionCreatePayload {
  nom: string;
  sequence?: number;
}

export interface SectionUpdatePayload {
  nom?: string;
  sequence?: number;
}

export interface LigneCreatePayload {
  sectionCode?: string | null;
  sectionId?: number | null;
  titre: string;
  description?: string;
  unite?: string;
  prixUnitaire?: number;
  quantiteDefault?: number;
  categorie?: string | null;
  sequence?: number;
}

export interface LigneUpdatePayload {
  titre?: string;
  description?: string;
  unite?: string;
  prixUnitaire?: number;
  quantiteDefault?: number;
  categorie?: string | null;
  sequence?: number;
}

// ============== SECTIONS ==============

export async function listCustomSections(): Promise<CustomSection[]> {
  const { data } = await api.get('/devis/manuel-template/sections');
  return data.items || [];
}

export async function createCustomSection(payload: SectionCreatePayload): Promise<CustomSection> {
  const { data } = await api.post('/devis/manuel-template/sections', payload);
  return data;
}

export async function updateCustomSection(id: number, payload: SectionUpdatePayload): Promise<CustomSection> {
  const { data } = await api.put(`/devis/manuel-template/sections/${id}`, payload);
  return data;
}

export async function deleteCustomSection(id: number): Promise<void> {
  await api.delete(`/devis/manuel-template/sections/${id}`);
}

// ============== LIGNES ==============

export async function listCustomLignes(): Promise<CustomLigne[]> {
  const { data } = await api.get('/devis/manuel-template/lignes');
  return data.items || [];
}

export async function createCustomLigne(payload: LigneCreatePayload): Promise<CustomLigne> {
  const { data } = await api.post('/devis/manuel-template/lignes', payload);
  return data;
}

export async function updateCustomLigne(id: number, payload: LigneUpdatePayload): Promise<CustomLigne> {
  const { data } = await api.put(`/devis/manuel-template/lignes/${id}`, payload);
  return data;
}

export async function deleteCustomLigne(id: number): Promise<void> {
  await api.delete(`/devis/manuel-template/lignes/${id}`);
}
