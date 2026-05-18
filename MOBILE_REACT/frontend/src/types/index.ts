/**
 * Mobile React Frontend - TypeScript Types
 * Core interfaces for the Mobile application.
 *
 * All entity field names use camelCase (TypeScript convention).
 * The Axios interceptor handles snake_case <-> camelCase conversion
 * when communicating with the FastAPI backend at /api/mobile/v1.
 */

// ============================================================
// AUTH
// ============================================================

export interface EmployeeInfo {
  id: number;
  prenom: string;
  nom: string;
  poste: string | null;
}

export interface TenantLoginResponse {
  tenantId: number;
  tenantNom: string;
  schemaName: string;
  employees: EmployeeInfo[];
}

export interface PinLoginResponse {
  token: string;
  employee: EmployeeInfo;
  tenantNom: string;
  /** Role RBAC du JWT (ADMIN | MANAGER | EMPLOYE | APPRENTI). Optionnel pour
   * compatibilite avec JWT legacy sans champ role. */
  role?: string;
}

/** Reponse de GET /me - refresh du role apres login (UI cache buttons). */
export interface MeResponse {
  employeeId: number;
  employeeName: string;
  role: string;
  tenantSchema: string;
}

// ============================================================
// ATTACHMENTS POLYMORPHIQUES
// ============================================================

export type AttachmentParentType =
  | 'dossier' | 'devis' | 'facture' | 'bon_travail' | 'bon_commande' | 'bon_achat';

export type AttachmentCategory =
  | 'PLAN' | 'PHOTO' | 'CONTRAT' | 'FACTURE' | 'DEVIS'
  | 'BON_LIVRAISON' | 'BON_TRAVAIL' | 'RAPPORT' | 'AUTRE';

export interface Attachment {
  id: number;
  parentType: AttachmentParentType;
  parentId: number;
  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  category: AttachmentCategory;
  uploadedBy: number;
  uploadedByName: string | null;
  uploadedAt: string;
}

export interface AttachmentDetail extends Attachment {
  description: string | null;
  exifData: Record<string, unknown> | null;
  fileHash: string | null;
}

export interface AttachmentUploadResult {
  id: number;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  message: string;
}

export interface MobileUser {
  employeeId: number;
  employeeName: string;
  tenantSchema: string;
}

export interface TenantInfo {
  tenantId: number;
  tenantNom: string;
  schemaName: string;
}

// ============================================================
// WORK ORDERS
// ============================================================

export interface WorkOrderOperation {
  id: number;
  nom: string;
  statut: string;
}

export interface WorkOrder {
  id: number;
  numeroDocument: string;
  description: string | null;
  statut: string;
  priorite: string | null;
  projectNom: string | null;
  projectId: number | null;
  dateDebut: string | null;
  dateFin: string | null;
  clientNom: string | null;
  adresseChantier: string | null;
  villeChantier: string | null;
  poClient: string | null;
  heuresEstimees: number | null;
  heuresRealisees: number | null;
  operations: WorkOrderOperation[];
}

// ============================================================
// TIME TRACKING
// ============================================================

/**
 * Snapshot météo capturé au moment du punch-in ou punch-out.
 * Toutes les valeurs sont optionnelles — le backend retourne `null` quand
 * Open-Meteo a échoué ou quand aucune coordonnée GPS n'a été fournie.
 *
 * `icon` est un hint string mappé sur une icône Lucide par WeatherBadge:
 *   "sun" | "sun-cloud" | "cloud-sun" | "cloud" | "fog" | "drizzle"
 *   | "rain" | "snow" | "lightning"
 */
export interface WeatherSnapshot {
  temperatureC: number | null;
  feelsLikeC: number | null;
  humidity: number | null;
  windKmh: number | null;
  windDirection: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  condition: string | null;
  icon: string | null;
  isDay: boolean | null;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
  /**
   * Origine des coordonnées utilisées pour la météo:
   *  - "gps"      : position GPS de l'employé (la plus précise)
   *  - "chantier" : géocodé depuis l'adresse du chantier (fallback quand pas de GPS)
   *  - null/undefined : non spécifié (compat anciens snapshots)
   */
  locationSource?: 'gps' | 'chantier' | null;
}

export interface TimeEntry {
  id: number;
  employeeId: number;
  formulaireBtId: number;
  operationId: number | null;
  operationNom: string | null;
  numeroBt: string | null;
  projectId: number | null;
  projectNom: string | null;
  punchIn: string;
  punchOut: string | null;
  totalHours: number | null;
  validated: boolean;
  validatedBy: string | null;
  validatedAt: string | null;
  notes: string | null;
  billable?: boolean;
  isBilled?: boolean;
  weatherIn?: WeatherSnapshot | null;
  weatherOut?: WeatherSnapshot | null;
}

export interface PunchStatus {
  isPunchedIn: boolean;
  activeEntry: TimeEntry | null;
  elapsedMinutes: number | null;
}

export interface DailySummary {
  date: string;
  jour: string;
  totalHours: number;
  entriesCount: number;
  isOvertime: boolean;
}

export interface WeeklySummary {
  semaineDu: string;
  semaineAu: string;
  totalHours: number;
  jours: DailySummary[];
  overtimeHours: number;
  isOvertimeWeek: boolean;
}

// ============================================================
// CREW
// ============================================================

export interface CrewMember {
  employeeId: number;
  prenom: string;
  nom: string;
  poste: string | null;
  isPunchedIn: boolean;
  punchIn: string | null;
  punchOut: string | null;
  elapsedMinutes: number | null;
  totalHours: number | null;
  numeroBt: string | null;
  projectNom: string | null;
  timeEntryId: number | null;
  validated: boolean;
}

export interface CrewProject {
  projectId: number;
  projectNom: string;
  totalOnSite: number;
  totalAssigned: number;
  canApprove: boolean;
  members: CrewMember[];
}

// ============================================================
// MESSAGING - CHANNELS
// ============================================================

export interface Channel {
  id: number;
  name: string;
  description: string | null;
  channelType: string;
  icon: string | null;
  isPrivate: boolean;
  memberCount: number;
  messageCount: number;
  unreadCount: number;
  createdAt: string;
}

export interface ChannelMessage {
  id: number;
  channelId: number;
  userId: number;
  userName: string;
  messageText: string;
  parentMessageId: number | null;
  hasAttachments: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  reactionCount: number;
  replyCount: number;
  reactions: Record<string, number> | null;
  createdAt: string;
  editedAt: string | null;
}

export interface ChannelMember {
  employeeId: number;
  prenom: string;
  nom: string;
  poste: string | null;
  role: string;
}

// ============================================================
// DIRECT MESSAGING
// ============================================================

export interface DirectMessage {
  id: number;
  senderType: string;
  senderName: string;
  senderUserId: number;
  recipientType: string;
  recipientUserId: number;
  recipientUsername: string | null;
  subject: string | null;
  message: string;
  messageType: string;
  conversationId: string;
  parentMessageId: number | null;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
}

export interface ConversationSummary {
  conversationId: string;
  otherPartyName: string;
  lastMessage: string;
  lastMessageAt: string;
  totalMessages: number;
  unreadCount: number;
}

export interface UnreadCount {
  conferenceUnread: number;
  directUnread: number;
  totalUnread: number;
}

// ============================================================
// DOSSIERS
// ============================================================

export interface DossierListItem {
  id: number;
  numeroDossier: string;
  titre: string;
  statut: string;
  priorite: string | null;
  typeDossier: string | null;
  projectNom: string | null;
  clientNom: string | null;
  dateOuverture: string | null;
  dateEcheance: string | null;
  documentsCount: number;
  etapesTotal: number;
  etapesDone: number;
}

export interface DossierEtape {
  id: number;
  titre: string;
  description: string | null;
  ordre: number;
  statut: string;
  datePrevue: string | null;
  dateRealisee: string | null;
}

export interface DossierDocument {
  id: number;
  titre: string;
  description: string | null;
  categorie: string | null;
  fichierNom: string;
  fichierType: string;
  fichierTaille: number;
  uploadedBy: string | null;
  uploadedAt: string;
  source?: string;
}

export interface NotePhoto {
  id: number;
  noteId: number;
  fichierNom: string;
  fichierType: string;
  fichierTaille: number;
  photoUrl: string;
  uploadedAt: string;
}

export interface NoteAttachment {
  nom: string;
  type: string | null;
  taille: number | null;
}

export interface DossierNote {
  id: number;
  contenu: string;
  isPinned: boolean;
  categorie: string | null;
  createdAt: string;
  photos: NotePhoto[];
  attachments: NoteAttachment[];
}

export interface DossierLien {
  id: number;
  dossierId: number;
  url: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// Fiche 360 types
export interface Dossier360Projet {
  id: number;
  nomProjet: string | null;
  statut: string | null;
  priorite: string | null;
  budgetTotal: number | null;
  dateDebutReel: string | null;
  dateFinReel: string | null;
  datePrevu: string | null;
}

export interface Dossier360Devis {
  id: number;
  numeroDevis: string | null;
  nomProjet: string | null;
  statut: string | null;
  totalTravaux: number | null;
  investissementTotal: number | null;
  createdAt: string | null;
}

export interface Dossier360Formulaire {
  id: number;
  numeroDocument: string | null;
  nom: string | null;
  statut: string | null;
  priorite: string | null;
  montantTotal: number | null;
  dateEcheance: string | null;
  createdAt: string | null;
}

export interface Dossier360Facture {
  id: number;
  numeroFacture: string | null;
  clientNom: string | null;
  statut: string | null;
  montantHt: number | null;
  montantTtc: number | null;
  montantPaye: number | null;
  soldeDu: number | null;
  dateFacture: string | null;
  dateEcheance: string | null;
}

export interface Dossier360BonCommande {
  id: number;
  numero: string | null;
  statut: string | null;
  montantTotal: number | null;
  dateCommande: string | null;
  dateLivraisonPrevue: string | null;
}

export interface Dossier360Pointage {
  id: number;
  employeeId: number | null;
  projectId: number | null;
  punchIn: string | null;
  punchOut: string | null;
  totalHours: number | null;
  notes: string | null;
  validated: boolean | null;
  prenom: string | null;
  nom: string | null;
}

export interface Dossier360Comptabilite {
  budgetTotal: number;
  totalDevis: number;
  totalFacture: number;
  totalPaye: number;
  totalSoldeDu: number;
  totalHeures: number;
  totalAchats: number;
  totalCouts: number;
  margeEstimee: number;
  nbFactures: number;
  nbFacturesPayees: number;
  nbFacturesEnRetard: number;
  nbBonsCommande: number;
  nbBonsTravail: number;
  nbDevis: number;
}

export interface DossierDetail extends DossierListItem {
  description: string | null;
  responsableNom: string | null;
  dateFermeture: string | null;
  tags: string | null;
  etapes: DossierEtape[];
  documents: DossierDocument[];
  notes: DossierNote[];
  // Fiche 360
  projets: Dossier360Projet[];
  devis: Dossier360Devis[];
  bonsTravail: Dossier360Formulaire[];
  factures: Dossier360Facture[];
  bonsCommande: Dossier360BonCommande[];
  demandesPrix: Dossier360Formulaire[];
  pointage: Dossier360Pointage[];
  comptabilite: Dossier360Comptabilite | null;
}

// ============================================================
// AI ASSISTANT
// ============================================================

export interface AiExpertProfile {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface AiConversation {
  id: number;
  name: string;
  createdAt: string;
  lastUpdatedAt: string;
  messageCount: number;
}

export interface AiConversationDetail {
  id: number;
  name: string;
  messages: AiChatMessage[];
  createdAt: string;
  lastUpdatedAt: string;
}

export interface AiPendingAction {
  id: number;
  actionType: 'INSERT' | 'UPDATE' | 'DELETE';
  targetTable: string;
  summary: string;
  /**
   * Etat de la pending action.
   * - 'pending'    : creee, en attente de l'utilisateur
   * - 'executing'  : POST /confirm en cours
   * - 'cancelling' : POST /cancel en cours
   * - 'executed'   : SQL executee avec succes
   * - 'cancelled'  : annulee par l'utilisateur
   * - 'failed'     : echec d'execution (erreur SQL, contrainte, etc.)
   * - 'expired'    : delai 30 minutes depasse sans confirmation
   * - 'rejected'   : revalidation SQL au moment du confirm a echoue
   */
  status?:
    | 'pending'
    | 'executing'
    | 'cancelling'
    | 'executed'
    | 'cancelled'
    | 'failed'
    | 'expired'
    | 'rejected';
  resultMsg?: string;
}

export interface AiChatMessage {
  role: string;
  content: string;
  pendingActions?: AiPendingAction[];
}

export interface AiChatResponse {
  conversationId: number;
  role: string;
  content: string;
  tokensInput: number;
  tokensOutput: number;
  expertProfile: string | null;
  pendingActions?: AiPendingAction[];
}

export interface AiPendingActionConfirmResponse {
  success: boolean;
  resultMsg: string;
  rowcount?: number | null;
}

export interface AiQuota {
  allowed: boolean;
  prepaidBalance: number;
  monthlyCost: number;
  message: string;
}

// ============================================================
// DOCUMENTS COMMERCIAUX
// ============================================================

export type DocType = 'devis' | 'factures' | 'bons-travail' | 'bons-commande';

export interface DocumentStats {
  total: number;
  brouillon: number;
  enAttente: number;
  envoye: number;
  accepte: number;
  enCours: number;
  termine: number;
  paye: number;
  annule: number;
}

export interface AllDocumentsStats {
  devis: DocumentStats;
  factures: DocumentStats;
  'bons-travail': DocumentStats;
  'bons-commande': DocumentStats;
}

export interface DocumentListItem {
  id: number;
  docType: string;
  numero: string | null;
  nomProjet: string | null;
  clientNom: string | null;
  statut: string;
  priorite: string | null;
  montantTotal: number | null;
  dateCreation: string | null;
  dateEcheance: string | null;
  lignesCount: number;
}

export interface DocumentLine {
  id: number;
  description: string | null;
  quantite: number;
  unite: string | null;
  prixUnitaire: number;
  montantLigne: number;
  codeArticle: string | null;
  notes: string | null;
  sequenceLigne: number;
}

export interface DocumentDetail {
  id: number;
  docType: string;
  numero: string | null;
  nomProjet: string | null;
  description: string | null;
  clientNom: string | null;
  clientCompanyId: number | null;
  projectId: number | null;
  statut: string;
  priorite: string | null;
  montantTotal: number | null;
  totalAvantTaxes: number | null;
  tps: number | null;
  tvq: number | null;
  dateCreation: string | null;
  dateEcheance: string | null;
  notes: string | null;
  lignes: DocumentLine[];
}

export interface CompanyLookup {
  id: number;
  nom: string;
}

export interface ProjectLookup {
  id: number;
  nom: string;
}

// ============================================================
// OCR SCAN RECUS (Phase 4A)
// ============================================================

/**
 * Ligne extraite d'un recu par Claude Vision.
 *
 * Tous les champs sont obligatoires cote backend mais le frontend peut
 * modifier librement dans le formulaire avant creation du Bon de Commande.
 */
export interface OcrReceiptLine {
  description: string;
  quantite: number;
  unite: string;
  prixUnitaire: number;
  montantLigne: number;
}

/**
 * Reponse de POST /ocr/receipt — donnees structurees extraites d'un recu
 * de commerce (Home Depot, Reno-Depot, Patrick Morin, etc.) par Claude
 * Sonnet 4.6 multimodal.
 *
 * Tous les champs scalaires sont nullable car Claude peut ne pas reussir
 * a extraire chaque info d'un recu froisse/illisible. `confidence` est une
 * estimation 0-1 retournee par Claude lui-meme.
 */
export interface OcrReceiptResponse {
  fournisseurNom: string | null;
  fournisseurAdresse: string | null;
  dateAchat: string | null;
  numeroFacture: string | null;
  lignes: OcrReceiptLine[];
  sousTotal: number | null;
  tps: number | null;
  tvq: number | null;
  total: number | null;
  modePaiement: string | null;
  confidence: number;
  rawResponse?: string | null;
}

// ============================================================
// METEO CHANTIER
// ============================================================

export interface WeatherStation {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export interface WeatherForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  windMax: number;
}

// ============================================================
// RELANCES FACTURES IMPAYEES (Phase 4B)
// ============================================================

/** Aging buckets supportes : J30 = 1-30j, J60 = 31-60j, J90 = 61-90j, J90+ = > 90j. */
export type ReminderBucket = 'J30' | 'J60' | 'J90' | 'J90+';

export interface OverdueFactureItem {
  id: number;
  numero: string;
  clientNom: string;
  clientEmail: string | null;
  montantTotal: number;
  soldeDu: number;
  dateEcheance: string | null;
  daysOverdue: number;
  bucket: ReminderBucket;
}

export interface OverdueBucketSummary {
  bucket: ReminderBucket;
  count: number;
  totalSoldeDu: number;
  factures: OverdueFactureItem[];
}

export interface OverdueResponse {
  totalCount: number;
  totalAmount: number;
  buckets: OverdueBucketSummary[];
}

export interface RemindersSendPayload {
  buckets?: ReminderBucket[];
  dryRun?: boolean;
  testEmail?: string;
}

export interface ReminderDetailItem {
  factureId: number;
  numero: string;
  bucket: ReminderBucket;
  clientEmail: string | null;
  sentTo: string | null;
  status: 'sent' | 'skipped' | 'failed' | 'dry_run';
  error: string | null;
}

export interface RemindersSendResponse {
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  dryRun: boolean;
  totalProcessed: number;
  details: ReminderDetailItem[];
}

// ============================================================
// AUDIT LOG POLYMORPHIQUE (Phase 5D - Loi 25 Quebec / GDPR)
// ============================================================

/** Action verb du journal d'audit. La liste est ouverte (string) cote serveur. */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'sign'
  | 'email_sent'
  | 'payment_received'
  | string;

/** Type d'entite audite. Ouverte (string) car polymorphique. */
export type AuditEntityType =
  | 'facture'
  | 'devis'
  | 'bons-travail'
  | 'bons-commande'
  | 'attachment'
  | 'auth'
  | string;

export interface AuditEvent {
  id: number;
  employeeId: number | null;
  employeeName: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: number | null;
  entityLabel: string | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
}

export interface AuditEventsResponse {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditListParams {
  entityType?: string;
  entityId?: number;
  employeeId?: number;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}
