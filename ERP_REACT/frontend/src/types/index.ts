/**
 * ERP React Frontend - TypeScript Types
 * Core interfaces for the ERP application.
 *
 * All entity field names use camelCase (TypeScript convention).
 * The Axios interceptor handles snake_case <-> camelCase conversion
 * when communicating with the Python/PostgreSQL backend.
 */

// ============================================================
// GENERIC UTILITY TYPES
// ============================================================

/** Paginated list response returned by all /list endpoints. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

// ============================================================
// AUTH
// ============================================================

export interface ErpUser {
  userType: 'user' | 'super_admin';
  userId: number;
  email: string;
  displayName: string;
  schemaName?: string;
  role?: string;
}

export interface TenantInfo {
  entrepriseId: number;
  entrepriseNom: string;
  schemaName: string;
}

/** Response from /auth/tenant-login */
export interface TenantLoginResponse {
  entrepriseId: number;
  entrepriseNom: string;
  schemaName: string;
}

/** Response from /auth/user-login (JWT flow) */
export interface UserLoginResponse {
  accessToken: string;
  tokenType: string;
  user: ErpUser;
}

/** Response from /auth/super-admin-login (session flow) */
export interface SessionLoginResponse {
  sessionToken: string;
  user: ErpUser;
}

/**
 * Unified auth response — covers both JWT and session-based flows.
 * SEAOP lesson #8: optional tokens so a single type works for
 * both /user-login (accessToken) and /super-admin-login (sessionToken).
 */
export interface AuthResponse {
  accessToken?: string;
  sessionToken?: string;
  tokenType?: string;
  user: ErpUser;
}

/** Response from /auth/me */
export interface MeResponse {
  userType: string;
  userId: number;
  email: string;
  displayName: string;
  schemaName?: string;
  role?: string;
  entrepriseNom?: string;
}

// ============================================================
// DASHBOARD
// ============================================================

export interface DashboardStats {
  projectsTotal: number;
  projectsEnCours: number;
  projectsTermines: number;
  companiesTotal: number;
  employesActifs: number;
  devisTotal: number;
  devisBrouillon: number;
  devisAcceptes: number;
  facturesTotal: number;
  facturesSoldeDu: number;
  produitsTotal: number;
  fournisseursTotal: number;
  btTotal: number;
  btEnCours: number;

  // Ventes/CRM
  clientsActifs: number;
  contactsTotal: number;
  opportunitesOuvertes: number;
  pipelineValue: number;

  // Devis extra
  devisEnAttente: number;
  devisTauxConversion: number;
  devisMontantTotal: number;

  // Projets extra
  projectsActifs: number;
  projectsTauxCompletion: number;
  projectsCaTotal: number;

  // Inventaire
  inventaireTotalArticles: number;
  inventaireQuantiteTotale: number;
  inventaireValeurStock: number;
  inventaireStockCritique: number;
  inventaireCategories: number;

  // RH extra
  employesTotal: number;
  employesSalaireMoyen: number;
  employesSurcharges: number;

  // Travaux extra
  btUrgents: number;
  btTermines: number;
}

export interface DashboardAlert {
  type: 'danger' | 'warning' | 'info';
  title: string;
  message: string;
  referenceId?: string;
  referenceType?: string;
}

export interface DashboardResponse {
  stats: DashboardStats;
  alerts: DashboardAlert[];
}

// ============================================================
// ENTREPRISE (Admin)
// ============================================================

export interface EntrepriseAdmin {
  id: number;
  nom: string;
  slug?: string;
  email?: string;
  representant?: string;
  telephone?: string;
  adresse?: string;
  subscriptionStatus?: string;
  planType?: string;
  trialEndDate?: string;
  createdAt?: string;
  active: boolean;
  userCount: number;
}

// ============================================================
// SIDEBAR NAVIGATION
// ============================================================

// Note: Sidebar.tsx defines its own NavItem with icon: React.ReactNode
// This type is for serializable navigation configuration only
export interface NavItemConfig {
  label: string;
  path: string;
  iconName: string;
  roles?: string[];
  children?: NavItemConfig[];
}

// ============================================================
// COMPANIES & CONTACTS
// ============================================================

export interface Company {
  id: number;
  nom: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  telephone?: string;
  email?: string;
  siteWeb?: string;
  typeCompany?: string;
  secteurActivite?: string;
  notes?: string;
  numeroTps?: string;
  numeroTvq?: string;
  contactPrincipalId?: number;
  paymentTerms?: string;
  creditLimit?: number;
  statut?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  contacts?: Contact[];
}

export interface Contact {
  id: number;
  companyId: number;
  prenom: string;
  nomFamille: string;
  nom?: string;
  rolePoste?: string;
  telephone?: string;
  email?: string;
  estPrincipal: boolean;
  notes?: string;
  createdAt?: string;
  companyNom?: string;
}

export interface CompanyCreate {
  nom: string;
  typeCompany?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  siteWeb?: string;
  contactPrincipalId?: number;
  numeroTps?: string;
  numeroTvq?: string;
  paymentTerms?: string;
  creditLimit?: number;
  notes?: string;
}

export interface ContactCreate {
  companyId: number;
  prenom: string;
  nomFamille: string;
  email?: string;
  telephone?: string;
  rolePoste?: string;
  estPrincipal?: boolean;
  notes?: string;
}

// ============================================================
// PROJECTS
// ============================================================

export interface Project {
  id: number;
  nomProjet: string;
  clientCompanyId?: number;
  clientContactId?: number;
  clientNomCache?: string;
  clientNom?: string;
  description?: string;
  statut: string;
  priorite: string;
  dateDebutReel?: string;
  dateFinReel?: string;
  budgetTotal?: number;
  adresseChantier?: string;
  villeChantier?: string;
  typeProjet?: string;
  tache?: string;
  poClient?: string;
  prixEstime?: number;
  devisId?: number;
  createdAt?: string;
  updatedAt?: string;
  phases?: ProjectPhase[];
  assignments?: ProjectAssignment[];
}

export interface ProjectPhase {
  id: number;
  projectId?: string;
  nom: string;
  description?: string;
  ordre: number;
  statut: string;
  dateDebut?: string;
  dateFin?: string;
  progression: number;
}

export interface ProjectAssignment {
  id: number;
  employeeId: number;
  roleProjet: string;
  employeNom: string;
}

// ============================================================
// DEVIS (Quotes)
// ============================================================

export interface Devis {
  id: number;
  numeroDevis: string;
  nomProjet: string;
  description?: string;
  clientCompanyId?: number;
  clientContactId?: number;
  clientNom?: string;
  projectId?: number;
  totalTravaux?: number;
  totalAvantTaxes?: number;
  tps?: number;
  tvq?: number;
  investissementTotal?: number;
  statut: string;
  createdAt?: string;
  datePrevu?: string;
  dateSoumis?: string;
  notes?: string;
  lignes?: DevisLigne[];
}

export interface DevisLigne {
  id: number;
  devisId?: number;
  description: string;
  quantite: number;
  unite: string;
  prixUnitaire: number;
  montantLigne: number;
  sequenceLigne: number;
  categorie?: string;
  notesLigne?: string;
  codeArticle?: string;
}

// ============================================================
// INVOICES (Factures)
// ============================================================

export interface Invoice {
  id: number;
  numero?: string;
  numeroFacture?: string;
  clientCompanyId?: number;
  clientNom?: string;
  projectId?: string;
  dateFacture?: string;
  dateEcheance?: string;
  montantHt?: number;
  tauxTps?: number;
  tps?: number;
  montantTps?: number;
  tauxTvq?: number;
  tvq?: number;
  montantTvq?: number;
  montantTtc?: number;
  montantTotal?: number;
  montantPaye?: number;
  soldeDu?: number;
  statut: string;
  conditionsPaiement?: string;
  notes?: string;
  createdAt?: string;
}

/** Alias for Invoice — French-named reference. */
export type Facture = Invoice;

// ============================================================
// EMPLOYEES
// ============================================================

export interface Employee {
  id: number;
  prenom: string;
  nom: string;
  email?: string;
  telephone?: string;
  poste?: string;
  departement?: string;
  statut: string;
  typeContrat?: string;
  dateEmbauche?: string;
  salaire?: number;
  tauxHoraire?: number;
  managerId?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  competences?: EmployeeCompetence[];
  timeEntries?: TimeEntry[];
}

export interface EmployeeCompetence {
  id: number;
  employeeId?: number;
  nomCompetence: string;
  niveau: string;
  dateObtention?: string;
  certifie: boolean;
}

/** Alias for EmployeeCompetence — matches shorter name used in API modules. */
export type Competence = EmployeeCompetence;

export interface TimeEntry {
  id: number;
  employeeId: number;
  projectId?: string;
  punchIn?: string;
  punchOut?: string;
  totalHours?: number;
  hourlyRate?: number;
  totalCost?: number;
  notes?: string;
  typeTravail?: string;
  validated?: boolean;
  billable?: boolean;
  employeNom?: string;
  nomProjet?: string;
}

export interface PayrollItem {
  id: number;
  employe: string;
  poste?: string;
  departement?: string;
  heuresTotales: number;
  taux: number;
  salaireBrut: number;
  deductions: number;
  salaireNet: number;
}

// ============================================================
// PRODUCTS & INVENTORY
// ============================================================

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
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  mouvements?: StockMovement[];
}

/** Alias for Product — French-named reference. */
export type Produit = Product;

export interface StockMovement {
  id: number;
  produitId: number;
  typeMouvement: string;
  quantite: number;
  referenceDocument?: string;
  motif?: string;
  employeeId?: number;
  createdAt?: string;
  produitNom?: string;
}

export interface InventoryStats {
  totalProduits: number;
  alertesStock: number;
  valeurInventaire: number;
  nbCategories: number;
}

// ============================================================
// SUPPLIERS (Fournisseurs)
// ============================================================

export interface Supplier {
  id: number;
  codeFournisseur?: string;
  nom: string;
  contactNom?: string;
  telephone?: string;
  email?: string;
  adresse?: string;
  ville?: string;
  province?: string;
  codePostal?: string;
  siteWeb?: string;
  categorie?: string;
  conditionsPaiement?: string;
  evaluation?: number;
  actif: boolean;
  notes?: string;
  numeroTps?: string;
  numeroTvq?: string;
  createdAt?: string;
  bonsCommande?: PurchaseOrder[];
}

/** Alias for Supplier — French-named reference. */
export type Fournisseur = Supplier;

// ============================================================
// PURCHASE ORDERS (Bons de Commande)
// ============================================================

export interface PurchaseOrder {
  id: number;
  numero: string;
  fournisseurId?: number;
  dateCommande?: string;
  dateLivraisonPrevue?: string;
  statut: string;
  montantTotal?: number;
  notes?: string;
  createdAt?: string;
}

/** Alias for PurchaseOrder — French-named reference. */
export type BonCommande = PurchaseOrder;

// ============================================================
// WORK ORDERS (Bons de Travail) / PRODUCTION
// ============================================================

export interface WorkOrder {
  id: number;
  typeFormulaire?: string;
  numeroDocument: string;
  projectId?: number;
  nom: string;
  statut: string;
  priorite: string;
  dateCreation?: string;
  dateEcheance?: string;
  montantTotal?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Alias for WorkOrder — French-named reference. */
export type BonTravail = WorkOrder;

export interface KanbanData {
  projects: {
    id: number;
    nom: string;
    statut: string;
    priorite: string;
    dateFinReel?: string;
    budgetTotal?: number;
  }[];
  devis: {
    id: number;
    numeroDevis: string;
    nom: string;
    statut: string;
    investissementTotal?: number;
    datePrevu?: string;
  }[];
  bonsTravail: {
    id: number;
    numero: string;
    nom: string;
    statut: string;
    priorite: string;
    dateEcheance?: string;
  }[];
}

// ============================================================
// ACCOUNTING
// ============================================================

export interface JournalEntry {
  id: number;
  numeroEcriture: string;
  dateEcriture: string;
  libelle: string;
  typeJournal?: string;
  referenceExterne?: string;
  projetId?: number;
  statut: string;
  montantTotal?: number;
  createdBy?: string;
  validatedBy?: string;
  notes?: string;
  createdAt?: string;
  lines?: JournalLine[];
}

export interface JournalLine {
  id: number;
  journalEntryId?: number;
  compteId: number;
  compteCode?: string;
  libelle?: string;
  debit: number;
  credit: number;
  projetId?: number;
}

export interface PlanComptable {
  id: number;
  code: string;
  nom: string;
  type: string;
  classe?: string;
  sousClasse?: string;
  description?: string;
  parentId?: number;
  niveau: number;
  actif: boolean;
  soldeNormal: string;
}

/** Alias for PlanComptable — English-named reference used in API module. */
export type ChartAccount = PlanComptable;

export interface FinancialSummary {
  totalFactures: number;
  facturesPayees: number;
  facturesRetard: number;
  caTotal: number;
  totalEncaisse: number;
  totalSoldeDu: number;
  totalEcritures: number;
  ecrituresBrouillon: number;
  totalComptes: number;
}

// ============================================================
// MESSAGING — Channels
// ============================================================

export interface Channel {
  id: number;
  name: string;
  description?: string;
  channelType: string;
  createdBy?: number;
  isActive: boolean;
  isPrivate?: boolean;
  createdAt?: string;
  memberCount?: number;
  messageCount?: number;
}

export interface Message {
  id: number;
  channelId: number;
  userId: number;
  messageText: string;
  parentMessageId?: number;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt?: string;
  editedAt?: string;
  username?: string;
  userName?: string;
}

/** Alias for Message — more specific name used in messaging module. */
export type ChannelMessage = Message;

// ============================================================
// MESSAGING — Direct Messages
// ============================================================

export interface DirectMessage {
  id: number;
  senderId: number;
  receiverId: number;
  subject?: string;
  message: string;
  isRead: boolean;
  parentId?: number;
  senderEntrepriseId?: string;
  receiverEntrepriseId?: string;
  createdAt?: string;
}

// ============================================================
// NOTIFICATIONS
// ============================================================

export interface Notification {
  id: number;
  userId?: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link?: string;
  createdAt?: string;
}

// ============================================================
// AI MODULE
// ============================================================

export interface AiProfile {
  id: string;
  name: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface AiChatResponse {
  response: string;
  profile: string;
  tokensUsed: number;
  costUsd: number;
  elapsedSeconds: number;
}

export interface AiUsageStats {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byFeature: {
    feature: string;
    requests: number;
    tokens: number;
    cost: number;
  }[];
}

export interface AiCredits {
  balanceUsd: number;
  monthlyLimitUsd: number;
  monthlyUsedUsd?: number;
  autoRecharge: boolean;
  rechargeAmountUsd: number;
  isExempt: boolean;
}

// ============================================================
// CALCULATORS
// ============================================================

export interface CalculatorInfo {
  id: string;
  name: string;
  description: string;
}

export interface CalculationResult {
  calculatorId: string;
  inputs: Record<string, unknown>;
  results: Record<string, unknown>;
  timestamp?: string;
}

// ============================================================
// SECONDARY MODULES — Logistics
// ============================================================

export interface Delivery {
  id: number;
  reference?: string;
  projectId?: number;
  fournisseurId?: number;
  datePrevue?: string;
  heurePrevue?: string;
  dateEffective?: string;
  heureEffective?: string;
  statut: string;
  typeLivraison?: string;
  zoneStockage?: string;
  notes?: string;
  nomProjet?: string;
  nomFournisseur?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DeliveryItem {
  id: number;
  deliveryId: number;
  description: string;
  quantitePrevue?: number;
  quantiteRecue?: number;
  unite?: string;
  conforme?: boolean;
  notes?: string;
}

export interface LogisticsEquipment {
  id: number;
  code?: string;
  nom: string;
  description?: string;
  categorie?: string;
  typePossession?: string;
  coutJournalier?: number;
  coutMensuel?: number;
  dateAcquisition?: string;
  valeurAchat?: number;
  statut: string;
  localisationActuelle?: string;
  projectIdActuel?: number;
  prochaineMaintenanceDate?: string;
  prochaineInspection?: string;
  heuresUtilisation?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EquipmentReservation {
  id: number;
  equipmentId: number;
  projectId?: number;
  dateDebut: string;
  dateFin?: string;
  responsable?: string;
  statut: string;
  notes?: string;
  nomEquipement?: string;
  nomProjet?: string;
  createdAt?: string;
}

export interface Vehicle {
  id: number;
  immatriculation: string;
  marque?: string;
  modele?: string;
  annee?: number;
  typeVehicule?: string;
  capaciteCharge?: number;
  uniteCapacite?: string;
  kilometrage?: number;
  consommationMoyenne?: number;
  coutKm?: number;
  statut: string;
  conducteurAtritreId?: number;
  dateProchainEntretien?: string;
  dateProchainInspection?: string;
  assuranceExpiration?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface VehicleTrip {
  id: number;
  vehicleId: number;
  projectId?: number;
  conducteurId?: number;
  dateDepart?: string;
  dateRetour?: string;
  kmDepart?: number;
  kmRetour?: number;
  destination?: string;
  motif?: string;
  carburantLitres?: number;
  coutCarburant?: number;
  notes?: string;
  nomVehicule?: string;
  createdAt?: string;
}

export interface SiteCoordination {
  id: number;
  projectId?: number;
  dateCoordination?: string;
  typeActivite?: string;
  heureDebut?: string;
  heureFin?: string;
  zoneConcernee?: string;
  accesRequis?: string;
  contraintes?: string;
  sequenceOrdre?: number;
  statut: string;
  responsable?: string;
  notes?: string;
  nomProjet?: string;
  createdAt?: string;
}

export interface LogisticsStats {
  livraisons: { total: number; planifiees: number; enCours: number; cetteSemaine: number };
  equipements: { total: number; disponibles: number; enUtilisation: number; enMaintenance: number };
  vehicules: { total: number; disponibles: number; enDeplacement: number; kmTotal: number };
  alertes: number;
}

// ============================================================
// SECONDARY MODULES — Rental (Location)
// ============================================================

export interface RentalItem {
  id: number;
  nom: string;
  description?: string;
  categorie?: string;
  numeroSerie?: string;
  marque?: string;
  modele?: string;
  anneeFabrication?: number;
  etat?: string;
  disponible?: boolean;
  quantiteTotale?: number;
  quantiteDisponible?: number;
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
  createdAt?: string;
  updatedAt?: string;
}

export interface RentalContract {
  id: number;
  numeroContrat?: string;
  clientType?: string;
  clientCompanyId?: number;
  clientContactId?: number;
  clientNomCache?: string;
  clientNom?: string;
  projectId?: number;
  responsableId?: number;
  statut: string;
  dateDebut?: string;
  dateFinPrevue?: string;
  dateFinReelle?: string;
  dureeType?: string;
  dureeNombre?: number;
  montantHt?: number;
  tauxTps?: number;
  montantTps?: number;
  tauxTvq?: number;
  montantTvq?: number;
  montantTotal?: number;
  cautionMontant?: number;
  cautionRecue?: boolean;
  conditionsParticulieres?: string;
  lieuLivraison?: string;
  lieuRetour?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  lignes?: RentalContratLigne[];
}

export interface RentalStats {
  total: number;
  actifs: number;
  montantTotal: number;
  equipementsLoues: number;
}

export interface RentalContratLigne {
  id: number;
  contratId: number;
  locationItemId: number;
  itemNom?: string;
  quantite: number;
  tarifUnitaire: number;
  tarifType?: string;
  remisePourcent?: number;
  montantLigne?: number;
  dateSortie?: string;
  dateRetourPrevue?: string;
  dateRetourReelle?: string;
  etatSortie?: string;
  etatRetour?: string;
  notesSortie?: string;
  notesRetour?: string;
  createdAt?: string;
}

export interface RentalRetour {
  id: number;
  contratId: number;
  ligneId: number;
  locationItemId: number;
  itemNom?: string;
  numeroContrat?: string;
  dateRetour?: string;
  etatAvant?: string;
  etatApres?: string;
  dommagesConstates?: string;
  fraisReparation?: number;
  fraisNettoyage?: number;
  fraisRetard?: number;
  commentaires?: string;
  createdAt?: string;
}

export interface RentalEmployee {
  id: number;
  employeeId: number;
  prenom?: string;
  nom?: string;
  poste?: string;
  departement?: string;
  disponibleLocation?: boolean;
  statutLocation?: string;
  metierPrincipal?: string;
  tauxHoraireLocation?: number;
  tauxJournalierLocation?: number;
  certificationsJson?: string;
  notesLocation?: string;
  createdAt?: string;
}

export interface RentalEmployeeContract {
  id: number;
  numeroContrat?: string;
  employeeId: number;
  employeNom?: string;
  clientCompanyId?: number;
  projectId?: number;
  statut: string;
  dateDebut: string;
  dateFinPrevue: string;
  dateFinReelle?: string;
  tarifType?: string;
  tarifUnitaire?: number;
  heuresPrevues?: number;
  heuresReelles?: number;
  montantEstimeHt?: number;
  montantFacture?: number;
  lieuTravail?: string;
  descriptionMission?: string;
  notes?: string;
  createdAt?: string;
}

export interface RentalEmployeeStats {
  totalEmployes: number;
  enLocation: number;
  disponibles: number;
  contratsActifs: number;
  heuresTotales: number;
  montantFacture: number;
}

// ============================================================
// SECONDARY MODULES — Maintenance
// ============================================================

export interface MaintenanceType {
  id: number;
  nom: string;
  description?: string;
  categorie?: string;
  frequenceJours?: number;
  checklistJson?: string;
  dureeEstimeeHeures?: number;
  coutEstime?: number;
  competencesRequises?: string;
  piecesRequisesJson?: string;
  actif?: boolean;
  createdAt?: string;
}

export interface MaintenancePlanification {
  id: number;
  equipementType?: string;
  equipementId?: number;
  maintenanceTypeId?: number;
  typeNom?: string;
  typeCategorie?: string;
  nomPlanification: string;
  description?: string;
  frequenceType?: string;
  frequenceValeur?: number;
  derniereMaintenance?: string;
  prochaineMaintenance?: string;
  seuilAlerteJours?: number;
  priorite?: string;
  responsableId?: number;
  actif?: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Legacy alias for existing code
export type MaintenancePreventive = MaintenancePlanification;

export interface MaintenanceRequest {
  id: number;
  numeroDemande?: string;
  numero?: string;
  equipementType?: string;
  equipementId?: number;
  planificationId?: number;
  titre: string;
  description?: string;
  symptomes?: string;
  typeMaintenance?: string;
  priorite: string;
  statut: string;
  demandeurId?: number;
  dateDemande?: string;
  dateSouhaitee?: string;
  datePlanifiee?: string;
  dateDebut?: string;
  dateFin?: string;
  dateResolution?: string;
  technicienInterneId?: number;
  fournisseurExterneId?: number;
  assigneA?: number;
  coutEstime?: number;
  coutReel?: number;
  tempsEstimeHeures?: number;
  tempsReelHeures?: number;
  causePanne?: string;
  solution?: string;
  piecesUtiliseesJson?: string;
  photosAvant?: string;
  photosApres?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MaintenanceIntervention {
  id: number;
  demandeId: number;
  numeroDemande?: string;
  demandeTitre?: string;
  equipementType?: string;
  equipementId?: number;
  dateIntervention?: string;
  technicienId?: number;
  fournisseurId?: number;
  typeIntervention?: string;
  descriptionTravaux?: string;
  dureeHeures?: number;
  statut?: string;
  observations?: string;
  recommandations?: string;
  signatureTechnicien?: string;
  entrepriseEmettriceId?: number;
  createdAt?: string;
}

export interface MaintenancePiece {
  id: number;
  demandeId?: number;
  interventionId?: number;
  pieceNom: string;
  pieceReference?: string;
  inventoryItemId?: number;
  quantite?: number;
  coutUnitaire?: number;
  coutTotal?: number;
  fournisseurId?: number;
  createdAt?: string;
}

export interface MaintenanceHistoriqueEntry {
  id: number;
  equipementType: string;
  equipementId: number;
  demandeId?: number;
  typeEvenement: string;
  dateEvenement?: string;
  description?: string;
  cout?: number;
  dureeHeures?: number;
  technicien?: string;
  compteurHeures?: number;
  compteurKm?: number;
  notes?: string;
  createdAt?: string;
}

export interface MaintenanceCompteur {
  id: number;
  equipementType: string;
  equipementId: number;
  typeCompteur: string;
  valeurActuelle: number;
  dateReleve?: string;
  releveParId?: number;
  notes?: string;
}

export interface MaintenanceAlerte {
  id: number;
  equipementType: string;
  equipementId: number;
  planificationId?: number;
  typeAlerte: string;
  priorite?: string;
  titre: string;
  message?: string;
  dateAlerte?: string;
  dateEcheance?: string;
  lue?: boolean;
  traitee?: boolean;
  traiteParId?: number;
  dateTraitement?: string;
  createdAt?: string;
}

export interface MaintenanceStats {
  total: number;
  parStatut: Record<string, number>;
  parPriorite: Record<string, number>;
  coutReel: number;
  coutEstime?: number;
  enCours: number;
  enAttente: number;
  terminees_mois?: number;
  termineesMois?: number;
  alertesNonLues?: number;
  planificationsActives?: number;
  planificationsRetard?: number;
  interventionsMois?: number;
}

export interface MaintenanceIaUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

export interface MaintenanceIaChatResponse {
  response: string;
  usage: MaintenanceIaUsage;
}

export interface MaintenanceIaJsonResponse<T = unknown> {
  diagnostic?: T;
  plan?: T;
  analysis?: T;
  estimate?: T;
  usage: MaintenanceIaUsage;
}

export interface MaintenanceIaChecklistResponse {
  checklist: string;
  usage: MaintenanceIaUsage;
}

// ============================================================
// SECONDARY MODULES — Weather
// ============================================================

export interface WeatherForecast {
  date: string;
  temperatureMin?: number;
  temperatureMax?: number;
  conditions?: string;
  precipitations?: number;
  vent?: number;
  humidite?: number;
  alertes?: string[];
}

// ============================================================
// SECONDARY MODULES — Compliance (RBQ / CCQ)
// Moved to dedicated module: @/api/conformite (RbqLicence, CcqCarte, Attestation)
// ============================================================

// ============================================================
// SECONDARY MODULES — Subsidies (Subventions)
// ============================================================

export interface Subsidy {
  id: number;
  nom: string;
  organisme?: string;
  categorie?: string;
  description?: string;
  montantMax?: number;
  dateLimite?: string;
  criteres?: string;
  lienUrl?: string;
  statut?: string;
}

// ============================================================
// SECONDARY MODULES — Real Estate (Immobilier)
// ============================================================

export interface Property {
  id: number;
  nom: string;
  adresse?: string;
  ville?: string;
  type?: string;
  superficie?: number;
  unites?: number;
  valeurEstimee?: number;
  statut: string;
  notes?: string;
  dateAcquisition?: string;
}
