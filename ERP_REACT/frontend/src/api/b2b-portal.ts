/**
 * B2B Client Portal - API module
 * Client-facing endpoints for catalogue, panier, commandes, demandes, messages, favoris.
 */

import { b2bApi } from './b2b-portal-auth';

// ============ Types ============

export interface B2bProduct {
  id: number;
  nom: string;
  codeProduit: string | null;
  description: string | null;
  categorie: string | null;
  unite: string | null;
  prixUnitaire: number | null;
  stockDisponible: number | null;
}

export interface B2bPanierItem {
  id: number;
  produitId: number;
  quantite: number;
  prixUnitaire: number;
  produitNom: string | null;
  codeProduit: string | null;
  unite: string | null;
}

export interface B2bPanier {
  panierId: number;
  items: B2bPanierItem[];
  sousTotal: number;
  tps: number;
  tvq: number;
  totalTtc: number;
  nbItems: number;
}

export interface B2bCommande {
  id: number;
  numero: string;
  sousTotal: number;
  tps: number;
  tvq: number;
  totalTtc: number;
  statut: string;
  statutPaiement: string;
  notesClient: string | null;
  dateCommande: string;
  dateLivraisonEstimee: string | null;
  createdAt: string;
  lignes?: B2bCommandeLigne[];
}

export interface B2bCommandeLigne {
  id: number;
  produitId: number;
  codeProduit: string | null;
  nomProduit: string | null;
  quantite: number;
  prixUnitaire: number;
  montantLigne: number;
}

export interface B2bDemande {
  id: number;
  clientId: number;
  titre: string;
  description: string | null;
  categorie: string | null;
  budgetEstime: number | null;
  dateLimite: string | null;
  statut: string;
  priorite: string;
  nombreSoumissions: number;
  createdAt: string;
  soumissions?: B2bSoumissionPreview[];
}

export interface B2bSoumissionPreview {
  id: number;
  montantTotal: number | null;
  montantHt: number | null;
  description: string | null;
  delaiExecutionJours: number | null;
  statut: string;
  createdAt: string;
}

export interface B2bContrat {
  id: number;
  numeroContrat: string | null;
  titre: string | null;
  montant: number | null;
  montantPaye: number | null;
  statut: string;
  dateDebut: string | null;
  dateFinPrevue: string | null;
  avancementPourcentage: number;
  createdAt: string;
}

export interface B2bMessage {
  id: number;
  demandeId: number | null;
  contratId: number | null;
  senderUserId: number | null;
  senderCompanyId: number | null;
  message: string;
  sujet: string | null;
  lu: boolean;
  createdAt: string;
}

export interface B2bFavori {
  id: number;
  produitId: number;
  nom: string | null;
  codeProduit: string | null;
  prixUnitaire: number | null;
  categorie: string | null;
  createdAt: string;
}

export interface B2bDashboard {
  commandesActives: number;
  demandesEnCours: number;
  contratsActifs: number;
  messagesNonLus: number;
}

// ============ API Functions ============

export async function fetchDashboard(): Promise<B2bDashboard> {
  const { data } = await b2bApi.get('/b2b-portal/dashboard');
  return data;
}

export async function fetchCatalogue(params?: {
  search?: string; categorie?: string; page?: number; perPage?: number;
}): Promise<{ items: B2bProduct[]; total: number; categories: string[] }> {
  const { data } = await b2bApi.get('/b2b-portal/catalogue', { params });
  return data;
}

export async function fetchPanier(): Promise<B2bPanier> {
  const { data } = await b2bApi.get('/b2b-portal/panier');
  return data;
}

export async function addToPanier(produitId: number, quantite = 1): Promise<void> {
  await b2bApi.post('/b2b-portal/panier/items', { produitId, quantite });
}

export async function updatePanierItem(itemId: number, quantite: number): Promise<void> {
  await b2bApi.put(`/b2b-portal/panier/items/${itemId}`, { quantite });
}

export async function removeFromPanier(itemId: number): Promise<void> {
  await b2bApi.delete(`/b2b-portal/panier/items/${itemId}`);
}

export async function commander(data: {
  adresseLivraison?: string; villeLivraison?: string;
  provinceLivraison?: string; codePostalLivraison?: string; notesClient?: string;
}): Promise<{ commandeId: number; numero: string; totalTtc: number }> {
  const { data: res } = await b2bApi.post('/b2b-portal/panier/commander', data);
  return res;
}

export async function fetchCommandes(): Promise<{ items: B2bCommande[]; total: number }> {
  const { data } = await b2bApi.get('/b2b-portal/commandes');
  return data;
}

export async function fetchCommande(id: number): Promise<B2bCommande> {
  const { data } = await b2bApi.get(`/b2b-portal/commandes/${id}`);
  return data;
}

export async function fetchDemandes(): Promise<{ items: B2bDemande[]; total: number }> {
  const { data } = await b2bApi.get('/b2b-portal/demandes');
  return data;
}

export async function createDemande(body: {
  titre: string; description?: string; categorie?: string;
  budgetEstime?: number; dateLimite?: string; priorite?: string;
  adresseChantier?: string; villeChantier?: string;
}): Promise<{ id: number; titre: string }> {
  const { data } = await b2bApi.post('/b2b-portal/demandes', body);
  return data;
}

export async function fetchDemande(id: number): Promise<B2bDemande> {
  const { data } = await b2bApi.get(`/b2b-portal/demandes/${id}`);
  return data;
}

export async function fetchContrats(): Promise<{ items: B2bContrat[]; total: number }> {
  const { data } = await b2bApi.get('/b2b-portal/contrats');
  return data;
}

export async function fetchContrat(id: number): Promise<B2bContrat> {
  const { data } = await b2bApi.get(`/b2b-portal/contrats/${id}`);
  return data;
}

export async function fetchMessages(params?: {
  demandeId?: number; contratId?: number;
}): Promise<{ items: B2bMessage[]; total: number }> {
  const { data } = await b2bApi.get('/b2b-portal/messages', { params });
  return data;
}

export async function sendMessage(body: {
  message: string; sujet?: string; demandeId?: number; contratId?: number;
}): Promise<{ id: number }> {
  const { data } = await b2bApi.post('/b2b-portal/messages', body);
  return data;
}

export async function fetchFavoris(): Promise<{ items: B2bFavori[] }> {
  const { data } = await b2bApi.get('/b2b-portal/favoris');
  return data;
}

export async function addFavori(produitId: number): Promise<void> {
  await b2bApi.post(`/b2b-portal/favoris/${produitId}`);
}

export async function removeFavori(produitId: number): Promise<void> {
  await b2bApi.delete(`/b2b-portal/favoris/${produitId}`);
}
