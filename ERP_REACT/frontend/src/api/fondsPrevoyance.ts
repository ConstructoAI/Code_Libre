/**
 * ERP React - Fonds de Prevoyance (Loi 16) API Client
 *
 * Gestion complete des fonds de prevoyance pour coproprietes:
 * - Coproprietes
 * - Composantes du batiment
 * - Etudes (25 ans)
 * - Projections financieres (3 scenarios)
 * - Carnet d'entretien
 * - Attestations de vente
 * - Assistant IA (Claude)
 */
import api from './client';

// ============================================================================
// Reference Data
// ============================================================================

export interface OrdreProfessionnel {
  code: string;
  nom: string;
}

export interface FrequenceEntretien {
  code: string;
  nom: string;
}

export interface FpReferenceData {
  etatsComposante: string[];
  typesBatiment: string[];
  typesStructure: string[];
  qualitesConstruction: string[];
  unitesMesure: string[];
  typesIntervention: string[];
  priorites: string[];
  statutsEntretien: string[];
  statutsAttestation: string[];
  scenariosProjection: string[];
  ordresProfessionnels: OrdreProfessionnel[];
  frequencesEntretien: FrequenceEntretien[];
  categoriesComposantes: Record<string, string[]>;
}

// ============================================================================
// Entities
// ============================================================================

export interface Copropriete {
  id: number;
  nom_copropriete: string;
  adresse_complete: string;
  ville: string | null;
  code_postal: string | null;
  annee_construction: number | null;
  nombre_unites: number | null;
  superficie_totale_pc: number | null;
  valeur_reconstruction: number | null;
  type_batiment: string | null;
  nombre_etages: number | null;
  type_structure: string | null;
  qualite_construction: string | null;
  notes: string | null;
  date_creation: string | null;
  derniere_maj: string | null;
  // Aggregates (list endpoint only)
  nb_composantes?: number;
  nb_etudes?: number;
}

export interface Composante {
  id: number;
  id_copropriete: number;
  categorie: string;
  sous_categorie: string | null;
  description_detaillee: string | null;
  quantite: number | null;
  unite_mesure: string | null;
  annee_installation: number | null;
  duree_vie_theorique: number | null;
  duree_vie_restante: number | null;
  etat_actuel: string | null;
  cout_remplacement_unitaire: number | null;
  cout_remplacement_total: number | null;
  date_derniere_inspection: string | null;
  notes_inspection: string | null;
  priorite: string | null;
  photo_url: string | null;
  date_creation: string | null;
  derniere_maj: string | null;
}

export interface Etude {
  id: number;
  id_copropriete: number;
  date_etude: string;
  professionnel_responsable: string;
  ordre_professionnel: string | null;
  numero_permis: string | null;
  periode_couverte: number;
  periode_debut: number | null;
  periode_fin: number | null;
  montant_fonds_actuel: number | null;
  montant_recommande_debut_annee: number | null;
  contribution_annuelle_recommandee: number | null;
  methodologie_calcul: string | null;
  taux_inflation_suppose: number | null;
  taux_rendement_suppose: number | null;
  contingence_pourcentage: number | null;
  date_prochaine_revision: string | null;
  statut_conformite: boolean;
  notes: string | null;
  date_creation: string | null;
  derniere_maj: string | null;
}

export interface Projection {
  id: number;
  id_etude: number;
  annee_projection: number;
  scenario: string | null;
  travaux_prevus: string | null;
  couts_estimes: number | null;
  inflation_cumulee: number | null;
  solde_debut_annee: number | null;
  contributions_annee: number | null;
  rendements_annee: number | null;
  depenses_annee: number | null;
  solde_fin_annee: number | null;
  deficit_surplus: number | null;
  notes: string | null;
}

export interface Entretien {
  id: number;
  id_copropriete: number;
  id_composante: number | null;
  type_intervention: string | null;
  description_travaux: string;
  date_prevue: string | null;
  date_realisee: string | null;
  frequence: string | null;
  cout_prevu: number | null;
  cout_reel: number | null;
  entrepreneur: string | null;
  numero_contrat: string | null;
  garantie_duree: number | null;
  garantie_expiration: string | null;
  statut: string | null;
  documents_joints: string | null;
  notes: string | null;
  date_creation: string | null;
  derniere_maj: string | null;
}

export interface Attestation {
  id: number;
  id_copropriete: number;
  numero_unite: string | null;
  nom_vendeur: string | null;
  nom_acheteur: string | null;
  date_demande: string;
  date_emission: string | null;
  montant_fonds_prevoyance: number | null;
  montant_recommande: number | null;
  contributions_arrieres: number | null;
  travaux_votes_montant: number | null;
  travaux_votes_description: string | null;
  restrictions_declarations: string | null;
  date_validite: string | null;
  emise_par: string | null;
  statut: string | null;
  document_pdf_url: string | null;
  notes: string | null;
  date_creation: string | null;
}

// ============================================================================
// Stats / Projections / IA
// ============================================================================

export interface CoproprieteStatistiques {
  copropriete: Copropriete;
  nb_composantes: number;
  cout_total_remplacement: number;
  etats: Record<string, number>;
  composantes_critiques: Composante[];
  nb_critiques: number;
  derniere_etude: Etude | null;
  nb_etudes: number;
}

export interface ProjectionAnnee {
  annee: number;
  solde_debut: number;
  contribution: number;
  rendement: number;
  depenses: number;
  solde_fin: number;
}

export interface ScenarioBase {
  nom: string;
  description: string;
  contribution_totale: number;
  solde_final: number;
  projections: ProjectionAnnee[];
}

export interface ScenarioUniforme extends ScenarioBase {
  contribution_annuelle: number;
}

export interface ScenarioProgressif extends ScenarioBase {
  contribution_initiale: number;
  contribution_finale: number;
}

export interface ScenarioVariable extends ScenarioBase {
  contribution_moyenne: number;
  contribution_minimale: number;
  contribution_maximale: number;
}

export interface ProjectionsResult {
  uniforme: ScenarioUniforme;
  progressif: ScenarioProgressif;
  variable: ScenarioVariable;
  depenses_prevues: Record<string, number>;
}

export interface IaUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  model: string;
}

export interface FpAnalyseLoi16 {
  etude_a_jour: boolean;
  carnet_requis: boolean;
  prochaine_echeance: string;
}

export interface FpAnalyseResult {
  score_sante?: number;
  niveau_risque?: string;
  resume_situation?: string;
  points_attention?: string[];
  recommandations_immediates?: string[];
  recommandations_moyen_terme?: string[];
  estimation_contribution_adequate?: number;
  conformite_loi16?: FpAnalyseLoi16;
  conseil_expert?: string;
  [key: string]: unknown;
}

export interface IaAnalyzeResponse {
  analysis: FpAnalyseResult | string;
  usage: IaUsage;
}

export interface IaChatResponse {
  response: string;
  usage: IaUsage;
}

export interface IaContributionRecommendation {
  contribution_uniforme?: number;
  contribution_progressive?: {
    annee_1_5?: number;
    annee_6_15?: number;
    annee_16_25?: number;
  };
  contribution_par_unite_mensuelle?: number;
  deficit_estime?: number;
  adequation_actuelle?: number;
  explication?: string;
  avertissement?: string;
  [key: string]: unknown;
}

export interface IaSuggestContributionResponse {
  recommendation: IaContributionRecommendation | string;
  usage: IaUsage;
}

// ============================================================================
// Reference data
// ============================================================================

export async function getReferenceData(): Promise<FpReferenceData> {
  const { data } = await api.get('/fonds-prevoyance/reference');
  return data;
}

// ============================================================================
// Coproprietes CRUD
// ============================================================================

export async function listCoproprietes(
  params?: { page?: number; per_page?: number; search?: string },
): Promise<{ items: Copropriete[]; total: number; page: number; per_page: number }> {
  const { data } = await api.get('/fonds-prevoyance/coproprietes', { params });
  return data;
}

export async function getCopropriete(id: number): Promise<Copropriete> {
  const { data } = await api.get(`/fonds-prevoyance/coproprietes/${id}`);
  return data;
}

export async function createCopropriete(
  body: Partial<Copropriete>,
): Promise<{ id: number }> {
  const { data } = await api.post('/fonds-prevoyance/coproprietes', body);
  return data;
}

export async function updateCopropriete(
  id: number,
  body: Partial<Copropriete>,
): Promise<void> {
  await api.put(`/fonds-prevoyance/coproprietes/${id}`, body);
}

export async function deleteCopropriete(id: number): Promise<void> {
  await api.delete(`/fonds-prevoyance/coproprietes/${id}`);
}

export async function getCoproprieteStatistiques(
  id: number,
): Promise<CoproprieteStatistiques> {
  const { data } = await api.get(`/fonds-prevoyance/coproprietes/${id}/statistiques`);
  return data;
}

// ============================================================================
// Composantes CRUD
// ============================================================================

export async function listComposantes(
  coproId: number,
  groupByCategory = false,
): Promise<{ items: Composante[]; total: number; grouped?: Record<string, Composante[]> }> {
  const { data } = await api.get(
    `/fonds-prevoyance/coproprietes/${coproId}/composantes`,
    { params: { group_by_category: groupByCategory } },
  );
  return data;
}

export async function createComposante(
  body: Partial<Composante> & { id_copropriete: number; categorie: string },
): Promise<{ id: number; duree_vie_restante: number | null; cout_remplacement_total: number | null }> {
  const { data } = await api.post('/fonds-prevoyance/composantes', body);
  return data;
}

export async function updateComposante(
  id: number,
  body: Partial<Composante>,
): Promise<void> {
  await api.put(`/fonds-prevoyance/composantes/${id}`, body);
}

export async function deleteComposante(id: number): Promise<void> {
  await api.delete(`/fonds-prevoyance/composantes/${id}`);
}

// ============================================================================
// Etudes CRUD
// ============================================================================

export async function listEtudes(coproId: number): Promise<{ items: Etude[]; total: number }> {
  const { data } = await api.get(`/fonds-prevoyance/coproprietes/${coproId}/etudes`);
  return data;
}

export async function getEtude(id: number): Promise<Etude> {
  const { data } = await api.get(`/fonds-prevoyance/etudes/${id}`);
  return data;
}

export async function createEtude(
  body: Partial<Etude> & {
    id_copropriete: number;
    date_etude: string;
    professionnel_responsable: string;
  },
): Promise<{ id: number }> {
  const { data } = await api.post('/fonds-prevoyance/etudes', body);
  return data;
}

export async function updateEtude(id: number, body: Partial<Etude>): Promise<void> {
  await api.put(`/fonds-prevoyance/etudes/${id}`, body);
}

export async function deleteEtude(id: number): Promise<void> {
  await api.delete(`/fonds-prevoyance/etudes/${id}`);
}

// ============================================================================
// Projections
// ============================================================================

export interface GenerateProjectionsBody {
  id_copropriete: number;
  solde_initial?: number;
  taux_inflation?: number;
  taux_rendement?: number;
  contingence_pct?: number;
}

export async function generateProjections(
  etudeId: number,
  body: GenerateProjectionsBody,
  options?: { save?: boolean; scenario?: 'uniforme' | 'progressif' | 'variable' },
): Promise<ProjectionsResult> {
  const { data } = await api.post(
    `/fonds-prevoyance/etudes/${etudeId}/generer-projections`,
    body,
    { params: options },
  );
  return data;
}

export async function listProjections(
  etudeId: number,
  scenario?: string,
): Promise<{ items: Projection[]; total: number }> {
  const { data } = await api.get(
    `/fonds-prevoyance/etudes/${etudeId}/projections`,
    { params: scenario ? { scenario } : undefined },
  );
  return data;
}

// ============================================================================
// Carnet d'entretien
// ============================================================================

export async function listEntretiens(
  coproId: number,
  statut?: string,
): Promise<{ items: Entretien[]; total: number }> {
  const { data } = await api.get(
    `/fonds-prevoyance/coproprietes/${coproId}/entretiens`,
    { params: statut ? { statut } : undefined },
  );
  return data;
}

export async function createEntretien(
  body: Partial<Entretien> & { id_copropriete: number; description_travaux: string },
): Promise<{ id: number }> {
  const { data } = await api.post('/fonds-prevoyance/entretiens', body);
  return data;
}

export async function updateEntretien(id: number, body: Partial<Entretien>): Promise<void> {
  await api.put(`/fonds-prevoyance/entretiens/${id}`, body);
}

export async function deleteEntretien(id: number): Promise<void> {
  await api.delete(`/fonds-prevoyance/entretiens/${id}`);
}

// ============================================================================
// Attestations de vente
// ============================================================================

export async function listAttestations(
  coproId: number,
  statut?: string,
): Promise<{ items: Attestation[]; total: number }> {
  const { data } = await api.get(
    `/fonds-prevoyance/coproprietes/${coproId}/attestations`,
    { params: statut ? { statut } : undefined },
  );
  return data;
}

export async function createAttestation(
  body: Partial<Attestation> & { id_copropriete: number; date_demande: string },
): Promise<{ id: number }> {
  const { data } = await api.post('/fonds-prevoyance/attestations', body);
  return data;
}

export async function updateAttestation(
  id: number,
  body: Partial<Attestation>,
): Promise<void> {
  await api.put(`/fonds-prevoyance/attestations/${id}`, body);
}

export async function deleteAttestation(id: number): Promise<void> {
  await api.delete(`/fonds-prevoyance/attestations/${id}`);
}

// ============================================================================
// IA
// ============================================================================

export async function analyzeCopropriete(coproId: number): Promise<IaAnalyzeResponse> {
  const { data } = await api.post('/fonds-prevoyance/ia/analyze-copropriete', {
    id_copropriete: coproId,
  });
  return data;
}

export async function chatFp(
  question: string,
  options?: { id_copropriete?: number; context?: string },
): Promise<IaChatResponse> {
  const { data } = await api.post('/fonds-prevoyance/ia/chat', {
    question,
    ...options,
  });
  return data;
}

export async function suggestContribution(body: {
  cout_total_remplacement: number;
  nombre_unites: number;
  horizon_annees?: number;
  solde_actuel?: number;
}): Promise<IaSuggestContributionResponse> {
  const { data } = await api.post('/fonds-prevoyance/ia/suggest-contribution', body);
  return data;
}

export interface IaRapportResponse {
  rapport: string;
  usage: IaUsage;
}

export async function generateRapport(coproId: number): Promise<IaRapportResponse> {
  const { data } = await api.post('/fonds-prevoyance/ia/rapport-recommandations', {
    id_copropriete: coproId,
  });
  return data;
}

export async function calculerValeurReconstruction(body: {
  superficie: number;
  qualite: string;
  type_batiment: string;
  annee_construction: number;
}): Promise<{ valeur_reconstruction: number }> {
  const { data } = await api.post('/fonds-prevoyance/calculer-valeur-reconstruction', body);
  return data;
}
