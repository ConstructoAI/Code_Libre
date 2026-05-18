/**
 * ERP React Frontend - B2B / C2B Portal API Module
 * Complete B2B: clients, demandes, soumissions, contrats, commandes,
 * catalogue, panier, favoris, messages, notifications, stats, categories.
 */

import api from './client';

// ============ Interfaces ============

export interface B2bClient {
  id: number;
  nom: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  contactNom?: string;
  secteur?: string;
  active?: boolean;
  nombreDemandes?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface B2bClientCreate {
  nom: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  contactNom?: string;
  secteur?: string;
}

export interface B2bClientUpdate {
  nom?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  contactNom?: string;
  secteur?: string;
  active?: boolean;
}

export interface B2bDemande {
  id: number;
  clientId?: number;
  clientNom?: string;
  clientEmail?: string;
  clientTelephone?: string;
  titre: string;
  description?: string;
  categorie?: string;
  budgetEstime?: number;
  dateLimite?: string;
  statut: string;
  priorite?: string;
  adresseChantier?: string;
  villeChantier?: string;
  notesInternes?: string;
  nombreSoumissions?: number;
  nombreMessages?: number;
  soumissions?: B2bSoumission[];
  createdAt?: string;
  updatedAt?: string;
}

export interface B2bDemandeCreate {
  clientId: number;
  titre: string;
  description?: string;
  categorie?: string;
  budgetEstime?: number;
  dateLimite?: string;
  priorite?: string;
  adresseChantier?: string;
  villeChantier?: string;
}

export interface B2bDemandeUpdate {
  titre?: string;
  description?: string;
  categorie?: string;
  budgetEstime?: number;
  dateLimite?: string;
  statut?: string;
  priorite?: string;
  notesInternes?: string;
}

export interface B2bSoumission {
  id: number;
  demandeId: number;
  demandeTitre?: string;
  clientNom?: string;
  montantTotal?: number;
  montantHt?: number;
  montantTaxes?: number;
  description?: string;
  delaiExecutionJours?: number;
  conditionsPaiement?: string;
  garanties?: string;
  notes?: string;
  statut: string;
  validiteJours?: number;
  dateExpiration?: string;
  noteEvaluation?: number;
  commentairesEvaluation?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface B2bSoumissionCreate {
  demandeId: number;
  montantTotal?: number;
  montantHt?: number;
  description?: string;
  delaiExecutionJours?: number;
  conditionsPaiement?: string;
  garanties?: string;
  notes?: string;
  validiteJours?: number;
}

export interface B2bSoumissionUpdate {
  montantTotal?: number;
  montantHt?: number;
  description?: string;
  delaiExecutionJours?: number;
  conditionsPaiement?: string;
  garanties?: string;
  notes?: string;
  statut?: string;
  noteEvaluation?: number;
  commentairesEvaluation?: string;
}

export interface B2bContrat {
  id: number;
  soumissionId?: number;
  demandeId?: number;
  clientCompanyId?: number;
  clientNom?: string;
  clientEmail?: string;
  demandeTitre?: string;
  numeroContrat?: string;
  titre?: string;
  montant?: number;
  montantPaye?: number;
  statut: string;
  dateDebut?: string;
  dateFinPrevue?: string;
  dateFinReelle?: string;
  dateSignature?: string;
  conditionsPaiement?: string;
  avancementPourcentage?: number;
  notesInternes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface B2bContratUpdate {
  titre?: string;
  statut?: string;
  conditionsPaiement?: string;
  dateDebut?: string;
  dateFinPrevue?: string;
  dateFinReelle?: string;
  avancementPourcentage?: number;
  montantPaye?: number;
  notesInternes?: string;
}

export interface B2bCommande {
  id: number;
  numero?: string;
  sousTotal?: number;
  tps?: number;
  tvq?: number;
  totalTtc?: number;
  statut: string;
  statutPaiement?: string;
  adresseLivraison?: string;
  villeLivraison?: string;
  notesClient?: string;
  dateCommande?: string;
  dateLivraisonEstimee?: string;
  lignes?: B2bCommandeLigne[];
  createdAt?: string;
}

export interface B2bCommandeLigne {
  id: number;
  produitId?: number;
  codeProduit?: string;
  nomProduit?: string;
  description?: string;
  quantite: number;
  unite?: string;
  prixUnitaire?: number;
  montantLigne?: number;
}

export interface B2bProduit {
  id: number;
  codeProduit?: string;
  nom: string;
  description?: string;
  categorie?: string;
  unite?: string;
  prixUnitaire: number;
  stockDisponible?: number;
}

export interface B2bPanierItem {
  id: number;
  produitId: number;
  produitNom?: string;
  codeProduit?: string;
  unite?: string;
  quantite: number;
  prix: number;
  montantLigne: number;
}

export interface B2bPanier {
  panierId: number;
  items: B2bPanierItem[];
  sousTotal: number;
  tps: number;
  tvq: number;
  totalTtc: number;
  nombreItems: number;
}

export interface B2bMessage {
  id: number;
  demandeId?: number;
  contratId?: number;
  senderUserId?: number;
  message: string;
  sujet?: string;
  lu?: boolean;
  createdAt?: string;
}

export interface B2bMessageCreate {
  demandeId?: number;
  contratId?: number;
  message: string;
  sujet?: string;
}

export interface B2bNotification {
  id: number;
  type?: string;
  titre?: string;
  message?: string;
  lienId?: number;
  lu: boolean;
  createdAt?: string;
}

export interface B2bStats {
  clientsTotal: number;
  clientsActifs: number;
  demandesTotal: number;
  demandesNouvelles: number;
  demandesEnCours: number;
  soumissionsTotal: number;
  soumissionsAcceptees: number;
  contratsTotal: number;
  contratsActifs: number;
  contratsValeur: number;
  commandesTotal: number;
  commandesEnAttente: number;
  messagesNonLus: number;
  demandesParStatut: { statut: string; c: number }[];
  activiteRecente: { type: string; label: string; statut: string; createdAt: string }[];
}

export interface C2bCategory {
  name: string;
  items: { id: string; title: string; description: string }[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

// ============ Stats ============

export async function getStats(): Promise<B2bStats> {
  const { data } = await api.get('/b2b/stats');
  return data;
}

// ============ Clients ============

export async function listClients(params: {
  page?: number; perPage?: number; search?: string; active?: boolean;
} = {}): Promise<PaginatedResponse<B2bClient>> {
  const { data } = await api.get('/b2b/clients', { params });
  return data;
}

export async function getClient(id: number): Promise<B2bClient> {
  const { data } = await api.get(`/b2b/clients/${id}`);
  return data;
}

export async function createClient(body: B2bClientCreate): Promise<{ id: number }> {
  const { data } = await api.post('/b2b/clients', body);
  return data;
}

export async function updateClient(id: number, body: B2bClientUpdate): Promise<void> {
  await api.put(`/b2b/clients/${id}`, body);
}

export async function deactivateClient(id: number): Promise<void> {
  await api.delete(`/b2b/clients/${id}`);
}

// ============ Demandes ============

export async function listDemandes(params: {
  page?: number; perPage?: number; clientId?: number; statut?: string;
  priorite?: string; search?: string;
} = {}): Promise<PaginatedResponse<B2bDemande>> {
  const { data } = await api.get('/b2b/demandes', { params });
  return data;
}

export async function getDemande(id: number): Promise<B2bDemande> {
  const { data } = await api.get(`/b2b/demandes/${id}`);
  return data;
}

export async function createDemande(body: B2bDemandeCreate): Promise<{ id: number }> {
  const { data } = await api.post('/b2b/demandes', body);
  return data;
}

export async function updateDemande(id: number, body: B2bDemandeUpdate): Promise<void> {
  await api.put(`/b2b/demandes/${id}`, body);
}

// ============ Soumissions ============

export async function listSoumissions(params: {
  page?: number; perPage?: number; demandeId?: number; statut?: string;
} = {}): Promise<PaginatedResponse<B2bSoumission>> {
  const { data } = await api.get('/b2b/soumissions', { params });
  return data;
}

export async function createSoumission(body: B2bSoumissionCreate): Promise<{ id: number }> {
  const { data } = await api.post('/b2b/soumissions', body);
  return data;
}

export async function updateSoumission(id: number, body: B2bSoumissionUpdate): Promise<void> {
  await api.put(`/b2b/soumissions/${id}`, body);
}

export async function acceptSoumission(id: number): Promise<{ contratId: number; numeroContrat: string }> {
  const { data } = await api.put(`/b2b/soumissions/${id}/accepter`);
  return data;
}

export async function refuseSoumission(id: number): Promise<void> {
  await api.put(`/b2b/soumissions/${id}/refuser`);
}

// ============ Contrats ============

export async function listContrats(params: {
  page?: number; perPage?: number; statut?: string;
} = {}): Promise<PaginatedResponse<B2bContrat>> {
  const { data } = await api.get('/b2b/contrats', { params });
  return data;
}

export async function getContrat(id: number): Promise<B2bContrat> {
  const { data } = await api.get(`/b2b/contrats/${id}`);
  return data;
}

export async function updateContrat(id: number, body: B2bContratUpdate): Promise<void> {
  await api.put(`/b2b/contrats/${id}`, body);
}

// ============ Commandes ============

export async function listCommandes(params: {
  page?: number; perPage?: number; statut?: string;
} = {}): Promise<PaginatedResponse<B2bCommande>> {
  const { data } = await api.get('/b2b/commandes', { params });
  return data;
}

export async function getCommande(id: number): Promise<B2bCommande> {
  const { data } = await api.get(`/b2b/commandes/${id}`);
  return data;
}

export async function updateCommandeStatut(id: number, statut: string): Promise<void> {
  await api.put(`/b2b/commandes/${id}/statut`, null, { params: { statut } });
}

// ============ Catalogue ============

export async function listCatalogue(params: {
  page?: number; perPage?: number; categorie?: string; search?: string;
} = {}): Promise<PaginatedResponse<B2bProduit> & { categories: string[] }> {
  const { data } = await api.get('/b2b/catalogue', { params });
  return data;
}

// ============ Panier ============

export async function getPanier(): Promise<B2bPanier> {
  const { data } = await api.get('/b2b/panier');
  return data;
}

export async function addToPanier(produitId: number, quantite: number = 1): Promise<void> {
  await api.post('/b2b/panier/items', { produitId, quantite });
}

export async function removeFromPanier(itemId: number): Promise<void> {
  await api.delete(`/b2b/panier/items/${itemId}`);
}

export async function commanderPanier(body: {
  adresseLivraison?: string; villeLivraison?: string;
  provinceLivraison?: string; codePostalLivraison?: string; notesClient?: string;
}): Promise<{ id: number; numero: string; totalTtc: number }> {
  const { data } = await api.post('/b2b/panier/commander', body);
  return data;
}

// ============ Favoris ============

export async function listFavoris(): Promise<{ items: (B2bProduit & { id: number; produitId: number })[] }> {
  const { data } = await api.get('/b2b/favoris');
  return data;
}

export async function addFavori(produitId: number): Promise<void> {
  await api.post(`/b2b/favoris/${produitId}`);
}

export async function removeFavori(produitId: number): Promise<void> {
  await api.delete(`/b2b/favoris/${produitId}`);
}

// ============ Messages ============

export async function listMessages(params: {
  demandeId?: number; contratId?: number; page?: number; perPage?: number;
}): Promise<PaginatedResponse<B2bMessage>> {
  const { data } = await api.get('/b2b/messages', { params });
  return data;
}

export async function sendMessage(body: B2bMessageCreate): Promise<{ id: number }> {
  const { data } = await api.post('/b2b/messages', body);
  return data;
}

// ============ Notifications ============

export async function listNotifications(nonLues?: boolean): Promise<{ items: B2bNotification[] }> {
  const { data } = await api.get('/b2b/notifications', { params: nonLues ? { nonLues: true } : {} });
  return data;
}

export async function markNotificationRead(id: number): Promise<void> {
  await api.put(`/b2b/notifications/${id}/read`);
}

// ============ Categories C2B ============

export async function listCategories(): Promise<{ categories: Record<string, C2bCategory> }> {
  const { data } = await api.get('/b2b/categories');
  return data;
}

// ============ B2B Client Users (admin approval flow) ============

export interface B2bClientUserPending {
  id: number;
  clientId: number;
  email: string;
  nom: string | null;
  telephone: string | null;
  active: boolean;
  lastLogin: string | null;
  createdAt: string;
  clientNom: string;
  clientTelephone: string | null;
  clientAdresse: string | null;
  clientVille: string | null;
}

export async function listClientUsers(params?: {
  clientId?: number;
  active?: boolean;
}): Promise<{ items: B2bClientUserPending[] }> {
  const { data } = await api.get('/b2b/client-users', { params });
  return data;
}

export async function approveClientUser(userId: number): Promise<{
  id: number;
  email: string;
  active: boolean;
  message: string;
}> {
  const { data } = await api.put(`/b2b/client-users/${userId}/approve`);
  return data;
}

export async function rejectClientUser(userId: number): Promise<{
  id: number;
  email: string;
  deleted: boolean;
  message: string;
}> {
  const { data } = await api.put(`/b2b/client-users/${userId}/reject`);
  return data;
}
