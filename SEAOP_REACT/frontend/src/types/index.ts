/**
 * SEAOP React Frontend - TypeScript Interfaces
 * Mirrors the backend Pydantic models (seaop_models.py) in camelCase.
 */

// ============ AUTH ============

export interface Entrepreneur {
  id: number;
  nomEntreprise: string;
  nomContact: string;
  email: string;
  telephone: string;
  numeroRbq: string | null;
  zonesDesservies: string | null;
  typesProjets: string | null;
  abonnement: string | null;
  creditsRestants: number | null;
  dateInscription: string | null;
  statut: string | null;
  certifications: string | null;
  evaluationsMoyenne: number | null;
  nombreEvaluations: number | null;
}

export interface SeaopUser {
  userType: 'entrepreneur' | 'client' | 'admin' | 'super_admin';
  userId: number;
  email: string;
  displayName: string;
}

/** Maps to backend UserResponse */
export interface UserResponse {
  id: number;
  email: string;
  nom: string | null;
  nomEntreprise: string | null;
  nomContact: string | null;
  telephone: string | null;
  userType: string;
  numeroRbq: string | null;
  zonesDesservies: string | null;
  typesProjets: string | null;
  abonnement: string | null;
  creditsRestants: number | null;
  certifications: string | null;
  evaluationsMoyenne: number | null;
  nombreEvaluations: number | null;
  statut: string | null;
  dateInscription: string | null;
}

/** Maps to backend AuthResponse */
export interface AuthResponse {
  accessToken?: string;
  tokenType?: string;
  sessionToken?: string;
  user: UserResponse;
}

/** Extended UserResponse with optional profile for /auth/me */
export interface UserResponseWithProfile extends UserResponse {
  profile?: Entrepreneur;
  displayName?: string;
  userId?: number;
}

/** Maps to backend EntrepreneurRegister */
export interface EntrepreneurRegisterPayload {
  nomEntreprise: string;
  nomContact: string;
  email: string;
  telephone: string;
  motDePasse: string;
  numeroRbq?: string;
  categoriesRbq?: string;
  assuranceResponsabilite?: boolean;
  montantAssurance?: number;
  zonesDesservies?: string;
  typesProjets?: string;
  certifications?: string;
}

/** Maps to backend ClientLogin */
export interface ClientLoginPayload {
  email: string;
  numeroReference: string;
}

/** Maps to backend AdminLogin */
export interface AdminLoginPayload {
  username: string;
  password: string;
}

/** Maps to super-admin login endpoint */
export interface SuperAdminLoginPayload {
  username: string;
  motDePasse: string;
}

/** Response from super-admin login (different shape than AuthResponse) */
export interface SuperAdminLoginResponse {
  sessionToken: string;
  user: {
    userType: string;
    userId: number;
    email: string;
    displayName: string;
  };
}

// ============ LEADS ============

export interface Lead {
  id: number;
  nom: string;
  email: string;
  telephone: string;
  codePostal: string;
  typeProjet: string;
  description: string;
  budget: string;
  delaiRealisation: string;
  dateLimiteSoumissions: string | null;
  dateDebutSouhaite: string | null;
  niveauUrgence: string | null;
  photos: string | null;
  plans: string | null;
  documents: string | null;
  dateCreation: string | null;
  statut: string | null;
  numeroReference: string | null;
  visibleEntrepreneurs: boolean | null;
  accepteSoumissions: boolean | null;
  nbSoumissions: number | null;
  // CNESST / Compliance fields
  rbqRequis: boolean | null;
  categoriesRbqRequises: string | null;
  cnesstRequis: boolean | null;
  assuranceRequise: boolean | null;
  montantAssuranceMin: number | null;
  cautionnementRequis: boolean | null;
  pourcentageCautionnement: number | null;
}

export interface LeadCreate {
  nom: string;
  email: string;
  telephone: string;
  codePostal: string;
  typeProjet: string;
  description: string;
  budget: string;
  delaiRealisation: string;
  dateLimiteSoumissions?: string;
  dateDebutSouhaite?: string;
  niveauUrgence?: string;
  photos?: string;
  plans?: string;
  documents?: string;
  // CNESST / Compliance fields
  rbqRequis?: boolean;
  categoriesRbqRequises?: string;
  cnesstRequis?: boolean;
  assuranceRequise?: boolean;
  montantAssuranceMin?: number;
  cautionnementRequis?: boolean;
  pourcentageCautionnement?: number;
}

export interface LeadUpdate {
  nom?: string;
  email?: string;
  telephone?: string;
  codePostal?: string;
  typeProjet?: string;
  description?: string;
  budget?: string;
  delaiRealisation?: string;
  dateLimiteSoumissions?: string;
  dateDebutSouhaite?: string;
  niveauUrgence?: string;
  photos?: string;
  plans?: string;
  documents?: string;
  statut?: string;
  visibleEntrepreneurs?: boolean;
  accepteSoumissions?: boolean;
  // CNESST / Compliance fields
  rbqRequis?: boolean;
  categoriesRbqRequises?: string;
  cnesstRequis?: boolean;
  assuranceRequise?: boolean;
  montantAssuranceMin?: number;
  cautionnementRequis?: boolean;
  pourcentageCautionnement?: number;
}

export interface LeadListResponse {
  items: Lead[];
  total: number;
  page: number;
  perPage: number;
}

// ============ SOUMISSIONS ============

export interface Soumission {
  id: number;
  leadId: number;
  entrepreneurId: number;
  montant: number;
  descriptionTravaux: string;
  delaiExecution: string;
  validiteOffre: string;
  inclusions: string | null;
  exclusions: string | null;
  conditions: string | null;
  documents: string | null;
  statut: string | null;
  dateCreation: string | null;
  dateModification: string | null;
  vueParClient: boolean | null;
  notesClient: string | null;
  notesEntrepreneur: string | null;
  // Bid bond / cautionnement fields
  cautionnementInclus?: boolean | null;
  montantCautionnement?: number | null;
  typeCautionnement?: string | null;
  // Joined entrepreneur info (populated in list views)
  nomEntreprise?: string | null;
  nomContact?: string | null;
  entrepreneurEmail?: string | null;
  entrepreneurTelephone?: string | null;
  evaluationsMoyenne?: number | null;
  // RBQ verification fields (joined from entrepreneur)
  numeroRbq?: string | null;
  rbqVerifie?: boolean | null;
  assuranceResponsabilite?: boolean | null;
  // Joined lead info (populated in entrepreneur's /mes-soumissions view)
  leadNom?: string | null;
  leadTypeProjet?: string | null;
  leadNumeroReference?: string | null;
}

export interface SoumissionCreate {
  leadId: number;
  montant: number;
  descriptionTravaux: string;
  delaiExecution: string;
  validiteOffre: string;
  inclusions?: string;
  exclusions?: string;
  conditions?: string;
  documents?: string;
  // Bid bond / cautionnement fields
  cautionnementInclus?: boolean;
  montantCautionnement?: number;
  typeCautionnement?: string;
}

export interface SoumissionStatusUpdate {
  statut: string;
}

// ============ MESSAGES ============

export interface Message {
  id: number;
  leadId: number;
  entrepreneurId: number | null;
  expediteurType: string;
  expediteurId: number;
  destinataireId: number;
  message: string;
  piecesJointes: string | null;
  dateEnvoi: string | null;
  lu: boolean | null;
}

export interface MessageCreate {
  leadId: number;
  entrepreneurId?: number;
  destinataireId: number;
  message: string;
  piecesJointes?: string;
}

export interface ConversationSummary {
  leadId: number;
  entrepreneurId: number | null;
  otherPartyName: string | null;
  otherPartyEmail: string | null;
  lastMessage: string | null;
  lastMessageDate: string | null;
  unreadCount: number;
  leadTypeProjet: string | null;
  leadNumeroReference: string | null;
}

// ============ NOTIFICATIONS ============

export interface Notification {
  id: number;
  utilisateurType: string;
  userId: number;
  typeNotification: string;
  titre: string;
  message: string;
  lienId: number | null;
  lu: boolean | null;
  dateCreation: string | null;
}

export interface NotificationCountResponse {
  unread: number;
  total: number;
}

// ============ EVALUATIONS ============

export interface EvaluationCreate {
  soumissionId: number;
  note: number;
  commentaire?: string;
}

export interface Evaluation {
  id: number;
  soumissionId: number;
  evaluateurType: string;
  note: number;
  commentaire: string | null;
  dateEvaluation: string | null;
}

// ============ CHAT ROOM ============

export interface ChatMessage {
  id: number;
  userType: string;
  userName: string;
  userEmail: string;
  userId: number | null;
  message: string;
  parentId: number | null;
  likes: number;
  isPinned: boolean;
  isDeleted: boolean;
  edited: boolean;
  editedAt: string | null;
  createdAt: string | null;
  userBadge: string | null;
  likedByMe?: boolean;
}

export interface OnlineUser {
  userType: string;
  userName: string;
  userEmail: string;
  lastSeen: string;
  isTyping: boolean;
}

// ============ ADDENDA ============

export interface Addendum {
  id: number;
  leadId: number;
  numero: number;
  titre: string;
  description: string;
  dateCreation: string | null;
  auteurEmail: string | null;
}

export interface AddendumCreate {
  titre: string;
  description: string;
}

// ============ COMMON / ENUMS ============

export type UrgencyLevel = 'faible' | 'normal' | 'eleve' | 'critique';
export type ProjectStatus = 'nouveau' | 'en_cours' | 'ferme' | 'attribue' | 'annule';
export type SoumissionStatus = 'envoyee' | 'vue' | 'en_evaluation' | 'acceptee' | 'refusee';

// ============ GENERIC API RESPONSES ============

export interface SuccessResponse {
  success: boolean;
  message: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}
