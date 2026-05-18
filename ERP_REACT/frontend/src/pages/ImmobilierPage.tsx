/**
 * ERP React - Immobilier Page
 * Comprehensive Real Estate module dashboard with 13 tabs.
 * Power BI-inspired layout with KPI cards, CRUD tables, modals, and calculators.
 * Includes Fonds de Prevoyance (Loi 16) sub-module.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Building, Plus, BarChart3, MapPin, Landmark, DollarSign,
  Home, Calculator, Pencil, Trash2, HardHat, Megaphone, Key,
  ClipboardCheck, CreditCard, FolderOpen, Search, Shield,
} from 'lucide-react';
import FondsPrevoyanceTab from '@/components/fondsPrevoyance/FondsPrevoyanceTab';
import * as immoApi from '@/api/immobilier';
import type {
  Terrain, ProjetImmo, Financement, Unite, Deblocage, PhaseConstruction,
  Commercialisation, Livraison, DocumentImmo, Inspection, Paiement,
  ImmoDashboard, MensualiteResult, AmortissementResult,
  InteretsIntercalairesResult, PrimeSCHLResult, RoiResult, CoutTotalResult,
} from '@/api/immobilier';
import { Badge } from '@/components/ui/Badge';
import type { BadgeColor } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { CommandBar } from '@/components/ui/CommandBar';
import { Select } from '@/components/ui/Select';
import StatCard from '@/components/dashboard/StatCard';
import { formatCurrency } from '@/utils/format';

// ============ CONSTANTS ============

type ImmoTab = 'dashboard' | 'terrains' | 'projets' | 'financement' | 'construction'
  | 'unites' | 'commercialisation' | 'livraison' | 'inspections' | 'paiements'
  | 'documents' | 'calculateur' | 'fondsPrevoyance';

const TABS: { key: ImmoTab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Tableau de bord', shortLabel: 'Dashboard', icon: <BarChart3 size={16} /> },
  { key: 'terrains', label: 'Terrains', shortLabel: 'Terrains', icon: <MapPin size={16} /> },
  { key: 'projets', label: 'Projets', shortLabel: 'Projets', icon: <Building size={16} /> },
  { key: 'financement', label: 'Financement', shortLabel: 'Finance', icon: <Landmark size={16} /> },
  { key: 'construction', label: 'Construction', shortLabel: 'Constr.', icon: <HardHat size={16} /> },
  { key: 'unites', label: 'Unites', shortLabel: 'Unites', icon: <Home size={16} /> },
  { key: 'commercialisation', label: 'Commercialisation', shortLabel: 'Comm.', icon: <Megaphone size={16} /> },
  { key: 'livraison', label: 'Livraison', shortLabel: 'Livr.', icon: <Key size={16} /> },
  { key: 'inspections', label: 'Inspections', shortLabel: 'Insp.', icon: <ClipboardCheck size={16} /> },
  { key: 'paiements', label: 'Paiements', shortLabel: 'Paie.', icon: <CreditCard size={16} /> },
  { key: 'documents', label: 'Documents', shortLabel: 'Docs', icon: <FolderOpen size={16} /> },
  { key: 'calculateur', label: 'Calculateurs', shortLabel: 'Calcul', icon: <Calculator size={16} /> },
  { key: 'fondsPrevoyance', label: 'Fonds Prévoyance', shortLabel: 'Loi 16', icon: <Shield size={16} /> },
];

const TERRAIN_STATUTS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'Prospection', label: 'Prospection' },
  { value: 'Offre en cours', label: 'Offre en cours' },
  { value: 'Acquis', label: 'Acquis' },
  { value: 'En développement', label: 'En développement' },
  { value: 'Rejeté', label: 'Rejeté' },
];

const ZONAGE_OPTIONS = [
  { value: 'Residentiel', label: 'Residentiel' },
  { value: 'Commercial', label: 'Commercial' },
  { value: 'Mixte', label: 'Mixte' },
  { value: 'Industriel', label: 'Industriel' },
];

const PROJET_STATUTS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'Planification', label: 'Planification' },
  { value: 'En cours', label: 'En cours' },
  { value: 'Construction', label: 'Construction' },
  { value: 'Termine', label: 'Termine' },
  { value: 'Annule', label: 'Annule' },
];

const TYPE_PROJET_OPTIONS = [
  { value: 'Condos', label: 'Condos' },
  { value: 'Locatif', label: 'Locatif' },
  { value: 'Mixte', label: 'Mixte' },
  { value: 'Commercial', label: 'Commercial' },
  { value: 'Maisons', label: 'Maisons' },
];

const TYPE_PRET_OPTIONS = [
  { value: 'Hypothecaire', label: 'Hypothecaire' },
  { value: 'Construction', label: 'Construction' },
  { value: 'Pont', label: 'Pont' },
  { value: 'Marge de credit', label: 'Marge de credit' },
];

const TYPE_UNITE_OPTIONS = [
  { value: 'Condo', label: 'Condo' },
  { value: 'Appartement', label: 'Appartement' },
  { value: 'Commerce', label: 'Commerce' },
  { value: 'Maison', label: 'Maison' },
  { value: 'Penthouse', label: 'Penthouse' },
];

const PHASE_STATUTS = [
  { value: '', label: 'Tous' },
  { value: 'A venir', label: 'A venir' },
  { value: 'En cours', label: 'En cours' },
  { value: 'En retard', label: 'En retard' },
  { value: 'Completee', label: 'Completee' },
  { value: 'Suspendue', label: 'Suspendue' },
];

const DEBLOCAGE_STATUTS = [
  { value: '', label: 'Tous' },
  { value: 'Planifie', label: 'Planifie' },
  { value: 'En cours', label: 'En cours' },
  { value: 'Approuve', label: 'Approuve' },
  { value: 'Debloque', label: 'Debloque' },
];

const INSPECTION_STATUTS = [
  { value: '', label: 'Tous' },
  { value: 'Planifiee', label: 'Planifiee' },
  { value: 'En cours', label: 'En cours' },
  { value: 'Reussie', label: 'Reussie' },
  { value: 'Echouee', label: 'Echouee' },
  { value: 'A reprendre', label: 'A reprendre' },
];

const UNITE_SOUS_TYPES = [
  { value: 'Studio', label: 'Studio' },
  { value: '3½', label: '3½' },
  { value: '4½', label: '4½' },
  { value: '5½', label: '5½' },
  { value: '6½', label: '6½' },
  { value: 'Penthouse', label: 'Penthouse' },
  { value: 'Local commercial', label: 'Local commercial' },
  { value: 'Bureau', label: 'Bureau' },
];

const ORIENTATIONS = [
  { value: 'Nord', label: 'Nord' }, { value: 'Sud', label: 'Sud' },
  { value: 'Est', label: 'Est' }, { value: 'Ouest', label: 'Ouest' },
  { value: 'Nord-Est', label: 'Nord-Est' }, { value: 'Nord-Ouest', label: 'Nord-Ouest' },
  { value: 'Sud-Est', label: 'Sud-Est' }, { value: 'Sud-Ouest', label: 'Sud-Ouest' },
];

const DOC_CATEGORIES = [
  { value: '', label: 'Toutes' },
  { value: 'Contrats', label: 'Contrats' },
  { value: 'Permis', label: 'Permis' },
  { value: 'Plans et dessins', label: 'Plans et dessins' },
  { value: 'Etudes techniques', label: 'Etudes techniques' },
  { value: 'Financement', label: 'Financement' },
  { value: 'Assurances', label: 'Assurances' },
  { value: 'Correspondance', label: 'Correspondance' },
  { value: 'Rapports inspection', label: 'Rapports inspection' },
  { value: 'Photos', label: 'Photos' },
  { value: 'Autre', label: 'Autre' },
];

const CALC_TABS = ['mensualite', 'amortissement', 'intercalaires', 'schl', 'roi', 'cout_total'] as const;

// ============ STATUS COLOR HELPER ============

function statusColor(statut: string): BadgeColor {
  const s = statut?.toLowerCase() || '';
  if (['acquis', 'termine', 'approuve', 'vendu', 'payee', 'conforme', 'completee', 'reussie', 'debloque'].some(x => s.includes(x))) return 'green';
  if (['en cours', 'construction', 'en preparation', 'loue'].some(x => s.includes(x))) return 'blue';
  if (['planification', 'prospection', 'planifiee', 'prevu', 'disponible', 'a venir', 'planifie'].some(x => s.includes(x))) return 'yellow';
  if (['rejete', 'annule', 'retard', 'non-conforme', 'echouee', 'suspendue', 'a reprendre'].some(x => s.includes(x))) return 'red';
  return 'gray';
}

// ============ KPI CARD ============
// Thin wrapper around the shared StatCard (harmonise avec le module Suivi).
// Maps the local "amber" and "gray" colors to StatCard's "yellow" and "teal".

function KpiCard({ label, value, icon, color = 'blue' }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'purple' | 'amber' | 'teal' | 'gray';
}) {
  const statCardColor: 'blue' | 'green' | 'purple' | 'yellow' | 'teal' =
    color === 'amber' ? 'yellow' : color === 'gray' ? 'teal' : color;
  return <StatCard label={label} value={value} icon={icon} color={statCardColor} />;
}

// ============ EMPTY FORM FACTORIES ============

const emptyTerrainForm = () => ({
  adresse: '', ville: '', codePostal: '', superficieM2: '', zonage: 'Residentiel',
  proprietaireNom: '', prixDemande: '', notes: '',
});

const emptyProjetForm = () => ({
  nomProjet: '', typeProjet: 'Condos', nombreLogements: '', budgetTotal: '',
  coutTerrain: '', coutConstruction: '', revenusVentesEstimes: '',
  dateDebutPlanifiee: '', dateFinPlanifiee: '', description: '', notes: '',
});

const emptyFinancementForm = () => ({
  projetId: '', banque: '', typePret: 'Hypothecaire', montantDemande: '',
  tauxInteretAnnuel: '', dureeAmortissementAnnees: '', miseDeFondsPct: '', notes: '',
});

const emptyUniteForm = () => ({
  numeroUnite: '', typeUnite: 'Condo', superficieM2: '', nombreChambres: '',
  nombreSallesBain: '', etage: '', prixVente: '', loyerMensuel: '', notes: '',
});

const emptyPhaseForm = () => ({
  nomPhase: '', numeroPhase: '1', statut: 'A venir', pourcentageCompletion: '0',
  dateDebutPrevue: '', dateFinPrevue: '', budgetPrevu: '', inspectionRequise: true,
  conformeCnb: false, materiauxCommandes: false, materiauxRecus: false,
  retardsJours: '0', raisonRetard: '', notes: '',
});

const emptyCommercialisationForm = () => ({
  strategieVente: 'Pre-vente', prixMoyenVente: '', loyerMoyen: '',
  objectifPreVentesPct: '50', budgetMarketing: '', siteWeb: '',
  courtierNom: '', commissionCourtierPct: '', dateLancement: '',
  brochurePrete: false, plansVentePrets: false, maquette3d: false, notes: '',
});

const emptyLivraisonForm = () => ({
  uniteId: '', beneficiaireNom: '', beneficiaireType: 'Acheteur',
  dateLivraisonPrevue: '', inspectionPreLivraison: false,
  listeDeficiences: '', deficiencesCorrigees: false,
  clesRemises: false, acteVenteSigne: false, bailSigne: false,
  manuelCopropriete: false, plansConformes: false, certificatConformite: false,
  garantieLegaleViceCache: true, garantieGcr: false,
  dureeGarantieMois: '12', noteSatisfaction: '', commentairesClient: '', notes: '',
});

const emptyDocumentForm = () => ({
  nomDocument: '', categorie: 'Contrats', typeFichier: 'PDF',
  description: '', cheminFichier: '', confidentiel: false,
  dateDocument: '', dateExpiration: '', notes: '',
});

// ============ MAIN COMPONENT ============

export default function ImmobilierPage() {
  const [activeTab, setActiveTab] = useState<ImmoTab>('dashboard');

  // Dashboard
  const [dashboard, setDashboard] = useState<ImmoDashboard | null>(null);
  const [dashLoading, setDashLoading] = useState(false);

  // Quick calculator on dashboard
  const [quickCalc, setQuickCalc] = useState({ capital: '', taux: '', duree: '' });
  const [quickResult, setQuickResult] = useState<MensualiteResult | null>(null);
  const [quickCalcLoading, setQuickCalcLoading] = useState(false);

  // Terrains
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [terrainsLoading, setTerrainsLoading] = useState(false);
  const [terrainSearch, setTerrainSearch] = useState('');
  const [terrainStatut, setTerrainStatut] = useState('');
  const [showTerrainModal, setShowTerrainModal] = useState(false);
  const [editTerrain, setEditTerrain] = useState<Terrain | null>(null);
  const [terrainForm, setTerrainForm] = useState(emptyTerrainForm());

  // Projets
  const [projets, setProjets] = useState<ProjetImmo[]>([]);
  const [projetsLoading, setProjetsLoading] = useState(false);
  const [projetSearch, setProjetSearch] = useState('');
  const [projetStatut, setProjetStatut] = useState('');
  const [showProjetModal, setShowProjetModal] = useState(false);
  const [editProjet, setEditProjet] = useState<ProjetImmo | null>(null);
  const [projetForm, setProjetForm] = useState(emptyProjetForm());

  // Financement
  const [financements, setFinancements] = useState<Financement[]>([]);
  const [financementsLoading, setFinancementsLoading] = useState(false);
  const [finProjetFilter, setFinProjetFilter] = useState('');
  const [showFinModal, setShowFinModal] = useState(false);
  const [editFin, setEditFin] = useState<Financement | null>(null);
  const [finForm, setFinForm] = useState(emptyFinancementForm());

  // Unites
  const [unites, setUnites] = useState<Unite[]>([]);
  const [unitesLoading, setUnitesLoading] = useState(false);
  const [uniteProjetId, setUniteProjetId] = useState('');
  const [showUniteModal, setShowUniteModal] = useState(false);
  const [editUnite, setEditUnite] = useState<Unite | null>(null);
  const [uniteForm, setUniteForm] = useState(emptyUniteForm());

  // Calculateur (mensualite tab)
  const [calcForm, setCalcForm] = useState({ capital: '', taux: '', duree: '' });
  const [calcResult, setCalcResult] = useState<MensualiteResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  // Construction (phases)
  const [phases, setPhases] = useState<PhaseConstruction[]>([]);
  const [phasesLoading, setPhasesLoading] = useState(false);
  const [phaseProjetId, setPhaseProjetId] = useState<number | null>(null);
  const [showPhaseModal, setShowPhaseModal] = useState(false);
  const [editPhase, setEditPhase] = useState<PhaseConstruction | null>(null);
  const [phaseForm, setPhaseForm] = useState(emptyPhaseForm());
  const [standardPhases, setStandardPhases] = useState<string[]>([]);

  // Commercialisation
  const [commercialisations, setCommercialisations] = useState<Commercialisation[]>([]);
  const [commLoading, setCommLoading] = useState(false);
  const [commProjetId, setCommProjetId] = useState<number | null>(null);
  const [showCommModal, setShowCommModal] = useState(false);
  const [editComm, setEditComm] = useState<Commercialisation | null>(null);
  const [commForm, setCommForm] = useState(emptyCommercialisationForm());

  // Livraison
  const [livraisons, setLivraisons] = useState<Livraison[]>([]);
  const [livraisonsLoading, setLivraisonsLoading] = useState(false);
  const [livraisonProjetId, setLivraisonProjetId] = useState<number | null>(null);
  const [showLivraisonModal, setShowLivraisonModal] = useState(false);
  const [editLivraison, setEditLivraison] = useState<Livraison | null>(null);
  const [livraisonForm, setLivraisonForm] = useState(emptyLivraisonForm());

  // Inspections (enriched)
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [inspectionsLoading, setInspectionsLoading] = useState(false);
  const [inspectionProjetId, setInspectionProjetId] = useState<number | null>(null);

  // Paiements
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [paiementsLoading, setPaiementsLoading] = useState(false);
  const [paiementProjetId, setPaiementProjetId] = useState<number | null>(null);

  // Documents
  const [documents, setDocuments] = useState<DocumentImmo[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [docProjetId, setDocProjetId] = useState<number | null>(null);
  const [docCatFilter, setDocCatFilter] = useState('');
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState(emptyDocumentForm());

  // Calculators (sub-tabs)
  const [calcTab, setCalcTab] = useState<typeof CALC_TABS[number]>('mensualite');
  const [amortResult, setAmortResult] = useState<AmortissementResult | null>(null);
  const [intercalairesResult, setIntercalairesResult] = useState<InteretsIntercalairesResult | null>(null);
  const [schlResult, setSchlResult] = useState<PrimeSCHLResult | null>(null);
  const [roiResult, setRoiResult] = useState<RoiResult | null>(null);
  const [coutTotalResult, setCoutTotalResult] = useState<CoutTotalResult | null>(null);
  const [amortForm, setAmortForm] = useState({ capital: '', tauxAnnuel: '', dureeAnnees: '', frequence: 'Mensuel' });
  const [intercForm, setIntercForm] = useState({ montantEmprunte: '', tauxAnnuel: '', dureeConstructionMois: '' });
  const [schlForm, setSchlForm] = useState({ montantPret: '', valeurPropriete: '' });
  const [roiForm, setRoiForm] = useState({ investissementTotal: '', revenusAnnuels: '', depensesAnnuelles: '', dureeAnnees: '5' });
  const [coutForm, setCoutForm] = useState({ capital: '', tauxAnnuel: '', dureeAnnees: '' });

  // ---- Projets list for dropdowns (financement & unites & all new tabs) ----
  const [projetsList, setProjetsList] = useState<ProjetImmo[]>([]);

  const loadProjetsList = useCallback(async () => {
    try {
      const res = await immoApi.listProjets();
      setProjetsList(res.items || []);
    } catch { /* silent */ }
  }, []);

  // ---- LOAD FUNCTIONS ----

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    try {
      const res = await immoApi.getDashboard();
      setDashboard(res);
    } catch { /* silent */ }
    setDashLoading(false);
  }, []);

  const loadTerrains = useCallback(async () => {
    setTerrainsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (terrainSearch) params.search = terrainSearch;
      if (terrainStatut) params.statut = terrainStatut;
      const res = await immoApi.listTerrains(params);
      setTerrains(res.items || []);
    } catch { /* silent */ }
    setTerrainsLoading(false);
  }, [terrainSearch, terrainStatut]);

  const loadProjets = useCallback(async () => {
    setProjetsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (projetSearch) params.search = projetSearch;
      if (projetStatut) params.statut = projetStatut;
      const res = await immoApi.listProjets(params);
      setProjets(res.items || []);
    } catch { /* silent */ }
    setProjetsLoading(false);
  }, [projetSearch, projetStatut]);

  const loadFinancements = useCallback(async () => {
    setFinancementsLoading(true);
    try {
      const params: Record<string, number | undefined> = {};
      if (finProjetFilter) params.projetId = Number(finProjetFilter);
      const res = await immoApi.listFinancements(params);
      setFinancements(res.items || []);
    } catch { /* silent */ }
    setFinancementsLoading(false);
  }, [finProjetFilter]);

  const loadUnites = useCallback(async () => {
    if (!uniteProjetId) { setUnites([]); return; }
    setUnitesLoading(true);
    try {
      const res = await immoApi.listUnites(Number(uniteProjetId));
      setUnites(res.items || []);
    } catch { /* silent */ }
    setUnitesLoading(false);
  }, [uniteProjetId]);

  const loadPhases = useCallback(async () => {
    if (!phaseProjetId) { setPhases([]); return; }
    setPhasesLoading(true);
    try {
      const res = await immoApi.listPhases({ projetId: phaseProjetId });
      setPhases(res.items || []);
    } catch { /* silent */ }
    setPhasesLoading(false);
  }, [phaseProjetId]);

  const loadStandardPhases = useCallback(async () => {
    try {
      const res = await immoApi.listPhaseTypes();
      setStandardPhases(res.phases || []);
    } catch { /* silent */ }
  }, []);

  const loadCommercialisations = useCallback(async () => {
    if (!commProjetId) { setCommercialisations([]); return; }
    setCommLoading(true);
    try {
      const res = await immoApi.listCommercialisations({ projetId: commProjetId });
      setCommercialisations(res.items || []);
    } catch { /* silent */ }
    setCommLoading(false);
  }, [commProjetId]);

  const loadLivraisons = useCallback(async () => {
    if (!livraisonProjetId) { setLivraisons([]); return; }
    setLivraisonsLoading(true);
    try {
      const res = await immoApi.listLivraisons({ projetId: livraisonProjetId });
      setLivraisons(res.items || []);
    } catch { /* silent */ }
    setLivraisonsLoading(false);
  }, [livraisonProjetId]);

  const loadInspections = useCallback(async () => {
    if (!inspectionProjetId) { setInspections([]); return; }
    setInspectionsLoading(true);
    try {
      const res = await immoApi.listInspections({ projetId: inspectionProjetId });
      setInspections(res.items || []);
    } catch { /* silent */ }
    setInspectionsLoading(false);
  }, [inspectionProjetId]);

  const loadPaiements = useCallback(async () => {
    if (!paiementProjetId) { setPaiements([]); return; }
    setPaiementsLoading(true);
    try {
      const res = await immoApi.listPaiements(paiementProjetId);
      setPaiements(res.items || []);
    } catch { /* silent */ }
    setPaiementsLoading(false);
  }, [paiementProjetId]);

  const loadDocuments = useCallback(async () => {
    if (!docProjetId) { setDocuments([]); return; }
    setDocumentsLoading(true);
    try {
      const params: Record<string, number | string> = { projetId: docProjetId };
      if (docCatFilter) params.search = docCatFilter;
      const res = await immoApi.listDocuments(params);
      setDocuments(res.items || []);
    } catch { /* silent */ }
    setDocumentsLoading(false);
  }, [docProjetId, docCatFilter]);

  // ---- EFFECTS ----

  useEffect(() => {
    if (activeTab === 'dashboard') loadDashboard();
  }, [activeTab, loadDashboard]);

  useEffect(() => {
    if (activeTab === 'terrains') loadTerrains();
  }, [activeTab, loadTerrains]);

  useEffect(() => {
    if (activeTab === 'projets') loadProjets();
  }, [activeTab, loadProjets]);

  useEffect(() => {
    if (activeTab === 'financement') { loadFinancements(); loadProjetsList(); }
  }, [activeTab, loadFinancements, loadProjetsList]);

  useEffect(() => {
    if (activeTab === 'unites') { loadUnites(); loadProjetsList(); }
  }, [activeTab, loadUnites, loadProjetsList]);

  useEffect(() => {
    if (activeTab === 'construction') { loadPhases(); loadProjetsList(); loadStandardPhases(); }
  }, [activeTab, loadPhases, loadProjetsList, loadStandardPhases]);

  useEffect(() => {
    if (activeTab === 'commercialisation') { loadCommercialisations(); loadProjetsList(); }
  }, [activeTab, loadCommercialisations, loadProjetsList]);

  useEffect(() => {
    if (activeTab === 'livraison') { loadLivraisons(); loadProjetsList(); }
  }, [activeTab, loadLivraisons, loadProjetsList]);

  useEffect(() => {
    if (activeTab === 'inspections') { loadInspections(); loadProjetsList(); }
  }, [activeTab, loadInspections, loadProjetsList]);

  useEffect(() => {
    if (activeTab === 'paiements') { loadPaiements(); loadProjetsList(); }
  }, [activeTab, loadPaiements, loadProjetsList]);

  useEffect(() => {
    if (activeTab === 'documents') { loadDocuments(); loadProjetsList(); }
  }, [activeTab, loadDocuments, loadProjetsList]);

  // ---- TERRAIN CRUD ----

  const openTerrainCreate = () => {
    setEditTerrain(null);
    setTerrainForm(emptyTerrainForm());
    setShowTerrainModal(true);
  };

  const openTerrainEdit = (t: Terrain) => {
    setEditTerrain(t);
    setTerrainForm({
      adresse: t.adresse || '', ville: t.ville || '', codePostal: t.codePostal || '',
      superficieM2: t.superficieM2 ? String(t.superficieM2) : '',
      zonage: t.zonage || 'Residentiel', proprietaireNom: t.proprietaireNom || '',
      prixDemande: t.prixDemande ? String(t.prixDemande) : '', notes: t.notes || '',
    });
    setShowTerrainModal(true);
  };

  const handleTerrainSave = async () => {
    if (!terrainForm.adresse.trim() || !terrainForm.ville.trim()) return;
    const body: Partial<Terrain> = {
      adresse: terrainForm.adresse,
      ville: terrainForm.ville,
      codePostal: terrainForm.codePostal || undefined,
      superficieM2: terrainForm.superficieM2 ? parseFloat(terrainForm.superficieM2) : undefined,
      zonage: terrainForm.zonage || undefined,
      proprietaireNom: terrainForm.proprietaireNom || undefined,
      prixDemande: terrainForm.prixDemande ? parseFloat(terrainForm.prixDemande) : undefined,
      notes: terrainForm.notes || undefined,
    };
    try {
      if (editTerrain) {
        await immoApi.updateTerrain(editTerrain.id, body);
      } else {
        await immoApi.createTerrain(body);
      }
      setShowTerrainModal(false);
      loadTerrains();
    } catch { /* handled by interceptor */ }
  };

  const handleTerrainDelete = async (id: number) => {
    if (!window.confirm('Supprimer ce terrain ?')) return;
    try {
      await immoApi.deleteTerrain(id);
      loadTerrains();
    } catch { /* handled by interceptor */ }
  };

  // ---- PROJET CRUD ----

  const openProjetCreate = () => {
    setEditProjet(null);
    setProjetForm(emptyProjetForm());
    setShowProjetModal(true);
  };

  const openProjetEdit = (p: ProjetImmo) => {
    setEditProjet(p);
    setProjetForm({
      nomProjet: p.nomProjet || '', typeProjet: p.typeProjet || 'Condos',
      nombreLogements: p.nombreLogements ? String(p.nombreLogements) : '',
      budgetTotal: p.budgetTotal ? String(p.budgetTotal) : '',
      coutTerrain: p.coutTerrain ? String(p.coutTerrain) : '',
      coutConstruction: p.coutConstruction ? String(p.coutConstruction) : '',
      revenusVentesEstimes: p.revenusVentesEstimes ? String(p.revenusVentesEstimes) : '',
      dateDebutPlanifiee: p.dateDebutPlanifiee?.split('T')[0] || '',
      dateFinPlanifiee: p.dateFinPlanifiee?.split('T')[0] || '',
      description: p.description || '', notes: p.notes || '',
    });
    setShowProjetModal(true);
  };

  const handleProjetSave = async () => {
    if (!projetForm.nomProjet.trim()) return;
    const body: Partial<ProjetImmo> = {
      nomProjet: projetForm.nomProjet,
      typeProjet: projetForm.typeProjet || undefined,
      nombreLogements: projetForm.nombreLogements ? parseInt(projetForm.nombreLogements) : undefined,
      budgetTotal: projetForm.budgetTotal ? parseFloat(projetForm.budgetTotal) : undefined,
      coutTerrain: projetForm.coutTerrain ? parseFloat(projetForm.coutTerrain) : undefined,
      coutConstruction: projetForm.coutConstruction ? parseFloat(projetForm.coutConstruction) : undefined,
      revenusVentesEstimes: projetForm.revenusVentesEstimes ? parseFloat(projetForm.revenusVentesEstimes) : undefined,
      dateDebutPlanifiee: projetForm.dateDebutPlanifiee || undefined,
      dateFinPlanifiee: projetForm.dateFinPlanifiee || undefined,
      description: projetForm.description || undefined,
      notes: projetForm.notes || undefined,
    };
    try {
      if (editProjet) {
        await immoApi.updateProjet(editProjet.id, body);
      } else {
        await immoApi.createProjet(body);
      }
      setShowProjetModal(false);
      loadProjets();
    } catch { /* handled by interceptor */ }
  };

  const handleProjetDelete = async (id: number) => {
    if (!window.confirm('Supprimer ce projet ?')) return;
    try {
      await immoApi.deleteProjet(id);
      loadProjets();
    } catch { /* handled by interceptor */ }
  };

  // ---- FINANCEMENT CRUD ----

  const openFinCreate = () => {
    setEditFin(null);
    setFinForm(emptyFinancementForm());
    setShowFinModal(true);
  };

  const openFinEdit = (f: Financement) => {
    setEditFin(f);
    setFinForm({
      projetId: f.projetId ? String(f.projetId) : '',
      banque: f.banque || '', typePret: f.typePret || 'Hypothecaire',
      montantDemande: f.montantDemande ? String(f.montantDemande) : '',
      tauxInteretAnnuel: f.tauxInteretAnnuel ? String(f.tauxInteretAnnuel) : '',
      dureeAmortissementAnnees: f.dureeAmortissementAnnees ? String(f.dureeAmortissementAnnees) : '',
      miseDeFondsPct: f.miseDeFondsPct ? String(f.miseDeFondsPct) : '',
      notes: f.notes || '',
    });
    setShowFinModal(true);
  };

  const handleFinSave = async () => {
    if (!finForm.banque.trim()) return;
    const body: Partial<Financement> = {
      projetId: finForm.projetId ? parseInt(finForm.projetId) : undefined,
      banque: finForm.banque,
      typePret: finForm.typePret || undefined,
      montantDemande: finForm.montantDemande ? parseFloat(finForm.montantDemande) : undefined,
      tauxInteretAnnuel: finForm.tauxInteretAnnuel ? parseFloat(finForm.tauxInteretAnnuel) : undefined,
      dureeAmortissementAnnees: finForm.dureeAmortissementAnnees ? parseInt(finForm.dureeAmortissementAnnees) : undefined,
      miseDeFondsPct: finForm.miseDeFondsPct ? parseFloat(finForm.miseDeFondsPct) : undefined,
      notes: finForm.notes || undefined,
    };
    try {
      if (editFin) {
        await immoApi.updateFinancement(editFin.id, body);
      } else {
        await immoApi.createFinancement(body);
      }
      setShowFinModal(false);
      loadFinancements();
    } catch { /* handled by interceptor */ }
  };

  const handleFinDelete = async (id: number) => {
    if (!window.confirm('Supprimer ce financement ?')) return;
    try {
      await immoApi.deleteFinancement(id);
      loadFinancements();
    } catch { /* handled by interceptor */ }
  };

  // ---- UNITE CRUD ----

  const openUniteCreate = () => {
    setEditUnite(null);
    setUniteForm(emptyUniteForm());
    setShowUniteModal(true);
  };

  const openUniteEdit = (u: Unite) => {
    setEditUnite(u);
    setUniteForm({
      numeroUnite: u.numeroUnite || '', typeUnite: u.typeUnite || 'Condo',
      superficieM2: u.superficieM2 ? String(u.superficieM2) : '',
      nombreChambres: u.nombreChambres ? String(u.nombreChambres) : '',
      nombreSallesBain: u.nombreSallesBain ? String(u.nombreSallesBain) : '',
      etage: u.etage ? String(u.etage) : '',
      prixVente: u.prixVente ? String(u.prixVente) : '',
      loyerMensuel: u.loyerMensuel ? String(u.loyerMensuel) : '',
      notes: u.notes || '',
    });
    setShowUniteModal(true);
  };

  const handleUniteSave = async () => {
    if (!uniteForm.numeroUnite.trim() || !uniteProjetId) return;
    const body: Partial<Unite> = {
      projetId: parseInt(uniteProjetId),
      numeroUnite: uniteForm.numeroUnite,
      typeUnite: uniteForm.typeUnite || undefined,
      superficieM2: uniteForm.superficieM2 ? parseFloat(uniteForm.superficieM2) : undefined,
      nombreChambres: uniteForm.nombreChambres ? parseInt(uniteForm.nombreChambres) : undefined,
      nombreSallesBain: uniteForm.nombreSallesBain ? parseInt(uniteForm.nombreSallesBain) : undefined,
      etage: uniteForm.etage ? parseInt(uniteForm.etage) : undefined,
      prixVente: uniteForm.prixVente ? parseFloat(uniteForm.prixVente) : undefined,
      loyerMensuel: uniteForm.loyerMensuel ? parseFloat(uniteForm.loyerMensuel) : undefined,
      notes: uniteForm.notes || undefined,
    };
    try {
      if (editUnite) {
        await immoApi.updateUnite(editUnite.id, body);
      } else {
        await immoApi.createUnite(body);
      }
      setShowUniteModal(false);
      loadUnites();
    } catch { /* handled by interceptor */ }
  };

  const handleUniteDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette unite ?')) return;
    try {
      await immoApi.deleteUnite(id);
      loadUnites();
    } catch { /* handled by interceptor */ }
  };

  // ---- PHASE CRUD ----

  const openPhaseCreate = () => {
    setEditPhase(null);
    setPhaseForm(emptyPhaseForm());
    setShowPhaseModal(true);
  };

  const openPhaseEdit = (p: PhaseConstruction) => {
    setEditPhase(p);
    setPhaseForm({
      nomPhase: p.nomPhase || '',
      numeroPhase: p.numeroPhase ? String(p.numeroPhase) : '1',
      statut: p.statut || 'A venir',
      pourcentageCompletion: p.pourcentageCompletion != null ? String(p.pourcentageCompletion) : '0',
      dateDebutPrevue: p.dateDebutPrevue?.split('T')[0] || '',
      dateFinPrevue: p.dateFinPrevue?.split('T')[0] || '',
      budgetPrevu: p.budgetPrevu ? String(p.budgetPrevu) : '',
      inspectionRequise: p.inspectionRequise ?? true,
      conformeCnb: p.conformeCnb ?? false,
      materiauxCommandes: p.materiauxCommandes ?? false,
      materiauxRecus: p.materiauxRecus ?? false,
      retardsJours: p.retardsJours ? String(p.retardsJours) : '0',
      raisonRetard: p.raisonRetard || '',
      notes: p.notes || '',
    });
    setShowPhaseModal(true);
  };

  const handlePhaseSave = async () => {
    if (!phaseForm.nomPhase.trim() || !phaseProjetId) return;
    const body: Partial<PhaseConstruction> = {
      projetId: phaseProjetId,
      nomPhase: phaseForm.nomPhase,
      numeroPhase: phaseForm.numeroPhase ? parseInt(phaseForm.numeroPhase) : undefined,
      statut: phaseForm.statut || undefined,
      pourcentageCompletion: phaseForm.pourcentageCompletion ? parseFloat(phaseForm.pourcentageCompletion) : undefined,
      dateDebutPrevue: phaseForm.dateDebutPrevue || undefined,
      dateFinPrevue: phaseForm.dateFinPrevue || undefined,
      budgetPrevu: phaseForm.budgetPrevu ? parseFloat(phaseForm.budgetPrevu) : undefined,
      inspectionRequise: phaseForm.inspectionRequise,
      conformeCnb: phaseForm.conformeCnb,
      materiauxCommandes: phaseForm.materiauxCommandes,
      materiauxRecus: phaseForm.materiauxRecus,
      retardsJours: phaseForm.retardsJours ? parseInt(phaseForm.retardsJours) : undefined,
      raisonRetard: phaseForm.raisonRetard || undefined,
      notes: phaseForm.notes || undefined,
    };
    try {
      if (editPhase) {
        await immoApi.updatePhase(editPhase.id, body);
      } else {
        await immoApi.createPhase(body);
      }
      setShowPhaseModal(false);
      loadPhases();
    } catch { /* handled by interceptor */ }
  };

  const handlePhaseDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette phase ?')) return;
    try {
      await immoApi.deletePhase(id);
      loadPhases();
    } catch { /* handled by interceptor */ }
  };

  // ---- COMMERCIALISATION CRUD ----

  const openCommCreate = () => {
    setEditComm(null);
    setCommForm(emptyCommercialisationForm());
    setShowCommModal(true);
  };

  const openCommEdit = (c: Commercialisation) => {
    setEditComm(c);
    setCommForm({
      strategieVente: c.strategieVente || 'Pre-vente',
      prixMoyenVente: c.prixMoyenVente ? String(c.prixMoyenVente) : '',
      loyerMoyen: c.loyerMoyen ? String(c.loyerMoyen) : '',
      objectifPreVentesPct: c.objectifPreVentesPct ? String(c.objectifPreVentesPct) : '50',
      budgetMarketing: c.budgetMarketing ? String(c.budgetMarketing) : '',
      siteWeb: c.siteWeb || '',
      courtierNom: c.courtierNom || '',
      commissionCourtierPct: c.commissionCourtierPct ? String(c.commissionCourtierPct) : '',
      dateLancement: c.dateLancement?.split('T')[0] || '',
      brochurePrete: c.brochurePrete ?? false,
      plansVentePrets: c.plansVentePrets ?? false,
      maquette3d: c.maquette3d ?? false,
      notes: c.notes || '',
    });
    setShowCommModal(true);
  };

  const handleCommSave = async () => {
    if (!commProjetId) return;
    const body: Partial<Commercialisation> = {
      projetId: commProjetId,
      strategieVente: commForm.strategieVente || undefined,
      prixMoyenVente: commForm.prixMoyenVente ? parseFloat(commForm.prixMoyenVente) : undefined,
      loyerMoyen: commForm.loyerMoyen ? parseFloat(commForm.loyerMoyen) : undefined,
      objectifPreVentesPct: commForm.objectifPreVentesPct ? parseFloat(commForm.objectifPreVentesPct) : undefined,
      budgetMarketing: commForm.budgetMarketing ? parseFloat(commForm.budgetMarketing) : undefined,
      siteWeb: commForm.siteWeb || undefined,
      courtierNom: commForm.courtierNom || undefined,
      commissionCourtierPct: commForm.commissionCourtierPct ? parseFloat(commForm.commissionCourtierPct) : undefined,
      dateLancement: commForm.dateLancement || undefined,
      brochurePrete: commForm.brochurePrete,
      plansVentePrets: commForm.plansVentePrets,
      maquette3d: commForm.maquette3d,
      notes: commForm.notes || undefined,
    };
    try {
      if (editComm) {
        await immoApi.updateCommercialisation(editComm.id, body);
      } else {
        await immoApi.createCommercialisation(body);
      }
      setShowCommModal(false);
      loadCommercialisations();
    } catch { /* handled by interceptor */ }
  };

  const handleCommDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette commercialisation ?')) return;
    try {
      await immoApi.deleteCommercialisation(id);
      loadCommercialisations();
    } catch { /* handled by interceptor */ }
  };

  // ---- LIVRAISON CRUD ----

  const openLivraisonCreate = () => {
    setEditLivraison(null);
    setLivraisonForm(emptyLivraisonForm());
    setShowLivraisonModal(true);
  };

  const openLivraisonEdit = (l: Livraison) => {
    setEditLivraison(l);
    setLivraisonForm({
      uniteId: l.uniteId ? String(l.uniteId) : '',
      beneficiaireNom: l.beneficiaireNom || '',
      beneficiaireType: l.beneficiaireType || 'Acheteur',
      dateLivraisonPrevue: l.dateLivraisonPrevue?.split('T')[0] || '',
      inspectionPreLivraison: l.inspectionPreLivraison ?? false,
      listeDeficiences: l.listeDeficiences || '',
      deficiencesCorrigees: l.deficiencesCorrigees ?? false,
      clesRemises: l.clesRemises ?? false,
      acteVenteSigne: l.acteVenteSigne ?? false,
      bailSigne: l.bailSigne ?? false,
      manuelCopropriete: l.manuelCopropriete ?? false,
      plansConformes: l.plansConformes ?? false,
      certificatConformite: l.certificatConformite ?? false,
      garantieLegaleViceCache: l.garantieLegaleViceCache ?? true,
      garantieGcr: l.garantieGcr ?? false,
      dureeGarantieMois: l.dureeGarantieMois ? String(l.dureeGarantieMois) : '12',
      noteSatisfaction: l.noteSatisfaction ? String(l.noteSatisfaction) : '',
      commentairesClient: l.commentairesClient || '',
      notes: l.notes || '',
    });
    setShowLivraisonModal(true);
  };

  const handleLivraisonSave = async () => {
    if (!livraisonProjetId) return;
    const body: Partial<Livraison> = {
      projetId: livraisonProjetId,
      uniteId: livraisonForm.uniteId ? parseInt(livraisonForm.uniteId) : undefined,
      beneficiaireNom: livraisonForm.beneficiaireNom || undefined,
      beneficiaireType: livraisonForm.beneficiaireType || undefined,
      dateLivraisonPrevue: livraisonForm.dateLivraisonPrevue || undefined,
      inspectionPreLivraison: livraisonForm.inspectionPreLivraison,
      listeDeficiences: livraisonForm.listeDeficiences || undefined,
      deficiencesCorrigees: livraisonForm.deficiencesCorrigees,
      clesRemises: livraisonForm.clesRemises,
      acteVenteSigne: livraisonForm.acteVenteSigne,
      bailSigne: livraisonForm.bailSigne,
      manuelCopropriete: livraisonForm.manuelCopropriete,
      plansConformes: livraisonForm.plansConformes,
      certificatConformite: livraisonForm.certificatConformite,
      garantieLegaleViceCache: livraisonForm.garantieLegaleViceCache,
      garantieGcr: livraisonForm.garantieGcr,
      dureeGarantieMois: livraisonForm.dureeGarantieMois ? parseInt(livraisonForm.dureeGarantieMois) : undefined,
      noteSatisfaction: livraisonForm.noteSatisfaction ? parseInt(livraisonForm.noteSatisfaction) : undefined,
      commentairesClient: livraisonForm.commentairesClient || undefined,
      notes: livraisonForm.notes || undefined,
    };
    try {
      if (editLivraison) {
        await immoApi.updateLivraison(editLivraison.id, body);
      } else {
        await immoApi.createLivraison(body);
      }
      setShowLivraisonModal(false);
      loadLivraisons();
    } catch { /* handled by interceptor */ }
  };

  const handleLivraisonDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette livraison ?')) return;
    try {
      await immoApi.deleteLivraison(id);
      loadLivraisons();
    } catch { /* handled by interceptor */ }
  };

  // ---- DOCUMENT CRUD ----

  const openDocCreate = () => {
    setDocForm(emptyDocumentForm());
    setShowDocModal(true);
  };

  const handleDocSave = async () => {
    if (!docForm.nomDocument.trim() || !docProjetId) return;
    const body: Partial<DocumentImmo> = {
      projetId: docProjetId,
      nomDocument: docForm.nomDocument,
      categorie: docForm.categorie || undefined,
      typeFichier: docForm.typeFichier || undefined,
      description: docForm.description || undefined,
      cheminFichier: docForm.cheminFichier || undefined,
      confidentiel: docForm.confidentiel,
      dateDocument: docForm.dateDocument || undefined,
      dateExpiration: docForm.dateExpiration || undefined,
    };
    try {
      await immoApi.createDocument(body);
      setShowDocModal(false);
      loadDocuments();
    } catch { /* handled by interceptor */ }
  };

  const handleDocDelete = async (id: number) => {
    if (!window.confirm('Supprimer ce document ?')) return;
    try {
      await immoApi.deleteDocument(id);
      loadDocuments();
    } catch { /* handled by interceptor */ }
  };

  // ---- QUICK CALCULATOR (dashboard) ----

  const handleQuickCalc = async () => {
    const capital = parseFloat(quickCalc.capital);
    const taux = parseFloat(quickCalc.taux);
    const duree = parseInt(quickCalc.duree);
    if (!capital || !taux || !duree) return;
    setQuickCalcLoading(true);
    try {
      const res = await immoApi.calculerMensualite({ capital, tauxAnnuel: taux, dureeAnnees: duree });
      setQuickResult(res);
    } catch { /* silent */ }
    setQuickCalcLoading(false);
  };

  // ---- FULL CALCULATOR (mensualite sub-tab) ----

  const handleCalc = async () => {
    const capital = parseFloat(calcForm.capital);
    const taux = parseFloat(calcForm.taux);
    const duree = parseInt(calcForm.duree);
    if (!capital || !taux || !duree) return;
    setCalcLoading(true);
    try {
      const res = await immoApi.calculerMensualite({ capital, tauxAnnuel: taux, dureeAnnees: duree });
      setCalcResult(res);
    } catch { /* silent */ }
    setCalcLoading(false);
  };

  // ---- AMORTISSEMENT CALCULATOR ----

  const handleAmortCalc = async () => {
    const capital = parseFloat(amortForm.capital);
    const taux = parseFloat(amortForm.tauxAnnuel);
    const duree = parseInt(amortForm.dureeAnnees);
    if (!capital || !taux || !duree) return;
    setCalcLoading(true);
    try {
      const res = await immoApi.calculerAmortissement({
        capital, tauxAnnuel: taux, dureeAnnees: duree,
        frequence: amortForm.frequence || undefined,
      });
      setAmortResult(res);
    } catch { /* silent */ }
    setCalcLoading(false);
  };

  // ---- INTERETS INTERCALAIRES CALCULATOR ----

  const handleIntercCalc = async () => {
    const montant = parseFloat(intercForm.montantEmprunte);
    const taux = parseFloat(intercForm.tauxAnnuel);
    const duree = parseInt(intercForm.dureeConstructionMois);
    if (!montant || !taux || !duree) return;
    setCalcLoading(true);
    try {
      const res = await immoApi.calculerInteretsIntercalaires({
        montantEmprunte: montant, tauxAnnuel: taux, dureeConstructionMois: duree,
      });
      setIntercalairesResult(res);
    } catch { /* silent */ }
    setCalcLoading(false);
  };

  // ---- PRIME SCHL CALCULATOR ----

  const handleSchlCalc = async () => {
    const pret = parseFloat(schlForm.montantPret);
    const valeur = parseFloat(schlForm.valeurPropriete);
    if (!pret || !valeur) return;
    setCalcLoading(true);
    try {
      const res = await immoApi.calculerPrimeSCHL({ montantPret: pret, valeurPropriete: valeur });
      setSchlResult(res);
    } catch { /* silent */ }
    setCalcLoading(false);
  };

  // ---- ROI CALCULATOR ----

  const handleRoiCalc = async () => {
    const invest = parseFloat(roiForm.investissementTotal);
    const revenus = parseFloat(roiForm.revenusAnnuels);
    const depenses = parseFloat(roiForm.depensesAnnuelles);
    if (!invest || !revenus) return;
    setCalcLoading(true);
    try {
      const res = await immoApi.calculerRoi({
        investissementTotal: invest, revenusAnnuels: revenus,
        depensesAnnuelles: depenses || 0,
        dureeAnnees: roiForm.dureeAnnees ? parseInt(roiForm.dureeAnnees) : undefined,
      });
      setRoiResult(res);
    } catch { /* silent */ }
    setCalcLoading(false);
  };

  // ---- COUT TOTAL CALCULATOR ----

  const handleCoutTotalCalc = async () => {
    const capital = parseFloat(coutForm.capital);
    const taux = parseFloat(coutForm.tauxAnnuel);
    const duree = parseInt(coutForm.dureeAnnees);
    if (!capital || !taux || !duree) return;
    setCalcLoading(true);
    try {
      const res = await immoApi.calculerCoutTotal({ capital, tauxAnnuel: taux, dureeAnnees: duree });
      setCoutTotalResult(res);
    } catch { /* silent */ }
    setCalcLoading(false);
  };

  // ---- Projet dropdown options ----
  const projetsDropdown = projetsList.map(p => ({ value: String(p.id), label: p.nomProjet || p.numeroProjet }));

  // ============ RENDER ============

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Header */}
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Immobilier</h2>

      {/* Tab bar */}
      <div className="flex gap-0 overflow-x-auto border-b border-gray-200 dark:border-gray-700 scrollbar-none">
        {TABS.map(({ key, label, shortLabel, icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1 px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === key
                ? 'border-seaop-primary-600 text-seaop-primary-600 dark:border-seaop-primary-400 dark:text-seaop-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span className="md:hidden">{icon}</span>
            <span className="hidden md:inline">{label}</span>
            <span className="md:hidden">{shortLabel}</span>
          </button>
        ))}
      </div>

      {/* Command bar for tabs that support create */}
      {(activeTab === 'terrains' || activeTab === 'projets' || activeTab === 'financement'
        || (activeTab === 'unites' && uniteProjetId)
        || (activeTab === 'construction' && phaseProjetId)
        || (activeTab === 'commercialisation' && commProjetId)
        || (activeTab === 'livraison' && livraisonProjetId)
        || (activeTab === 'documents' && docProjetId)
      ) && (
        <CommandBar
          actions={[
            ...(activeTab === 'terrains' ? [{ label: 'Nouveau terrain', icon: <Plus size={16} />, onClick: openTerrainCreate, variant: 'primary' as const }] : []),
            ...(activeTab === 'projets' ? [{ label: 'Nouveau projet', icon: <Plus size={16} />, onClick: openProjetCreate, variant: 'primary' as const }] : []),
            ...(activeTab === 'financement' ? [{ label: 'Nouveau financement', icon: <Plus size={16} />, onClick: openFinCreate, variant: 'primary' as const }] : []),
            ...(activeTab === 'unites' && uniteProjetId ? [{ label: 'Nouvelle unite', icon: <Plus size={16} />, onClick: openUniteCreate, variant: 'primary' as const }] : []),
            ...(activeTab === 'construction' && phaseProjetId ? [{ label: 'Nouvelle phase', icon: <Plus size={16} />, onClick: openPhaseCreate, variant: 'primary' as const }] : []),
            ...(activeTab === 'commercialisation' && commProjetId ? [{ label: 'Nouvelle commercialisation', icon: <Plus size={16} />, onClick: openCommCreate, variant: 'primary' as const }] : []),
            ...(activeTab === 'livraison' && livraisonProjetId ? [{ label: 'Nouvelle livraison', icon: <Plus size={16} />, onClick: openLivraisonCreate, variant: 'primary' as const }] : []),
            ...(activeTab === 'documents' && docProjetId ? [{ label: 'Nouveau document', icon: <Plus size={16} />, onClick: openDocCreate, variant: 'primary' as const }] : []),
          ]}
          right={
            activeTab === 'terrains' ? (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-none">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={terrainSearch} onChange={e => setTerrainSearch(e.target.value)}
                    placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
                </div>
                <div className="w-32 sm:w-40 shrink-0">
                  <Select options={TERRAIN_STATUTS} value={terrainStatut}
                    onChange={e => setTerrainStatut(e.target.value)} placeholder="Statut" />
                </div>
              </div>
            ) : activeTab === 'projets' ? (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-none">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={projetSearch} onChange={e => setProjetSearch(e.target.value)}
                    placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
                </div>
                <div className="w-32 sm:w-40 shrink-0">
                  <Select options={PROJET_STATUTS} value={projetStatut}
                    onChange={e => setProjetStatut(e.target.value)} placeholder="Statut" />
                </div>
              </div>
            ) : undefined
          }
        />
      )}

      {/* ================================================================ */}
      {/* TAB 1: DASHBOARD                                                 */}
      {/* ================================================================ */}
      {activeTab === 'dashboard' && (
        <div className="space-y-5">
          {dashLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <KpiCard
              label="Terrains total"
              value={dashboard?.totalTerrains ?? '--'}
              icon={<MapPin size={20} />}
              color="blue"
            />
            <KpiCard
              label="Projets total"
              value={dashboard?.totalProjets ?? '--'}
              icon={<Building size={20} />}
              color="purple"
            />
            <KpiCard
              label="Financement approuvé"
              value={dashboard?.totalFinancementApprouve != null ? formatCurrency(dashboard.totalFinancementApprouve) : '--'}
              icon={<DollarSign size={20} />}
              color="green"
            />
            <KpiCard
              label="Unités vendues"
              value={dashboard?.unitesVendues ?? '--'}
              icon={<Home size={20} />}
              color="amber"
            />
          </div>

          {/* Terrains par statut + Projets par statut */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Terrains par statut */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-5">
              <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white mb-4">Terrains par statut</h3>
              {dashboard?.terrainsByStatus && dashboard.terrainsByStatus.length > 0 ? (
                <ul className="space-y-2">
                  {dashboard.terrainsByStatus.map((item, idx) => (
                    <li key={idx} className="flex items-center justify-between">
                      <Badge color={statusColor(item.statut)} size="sm">{item.statut}</Badge>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{item.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Aucune donnee</p>
              )}
            </div>

            {/* Projets par statut */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-5">
              <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white mb-4">Projets par statut</h3>
              {dashboard?.projetsByStatus && dashboard.projetsByStatus.length > 0 ? (
                <ul className="space-y-2">
                  {dashboard.projetsByStatus.map((item, idx) => (
                    <li key={idx} className="flex items-center justify-between">
                      <Badge color={statusColor(item.statut)} size="sm">{item.statut}</Badge>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{item.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Aucune donnee</p>
              )}
            </div>
          </div>

          {/* Quick Calculator */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-5">
            <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white mb-4">Calculateur rapide</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Capital ($)"
                type="number"
                value={quickCalc.capital}
                onChange={e => setQuickCalc({ ...quickCalc, capital: e.target.value })}
                placeholder="250000"
              />
              <Input
                label="Taux annuel (%)"
                type="number"
                value={quickCalc.taux}
                onChange={e => setQuickCalc({ ...quickCalc, taux: e.target.value })}
                placeholder="5.5"
              />
              <Input
                label="Durée (années)"
                type="number"
                value={quickCalc.duree}
                onChange={e => setQuickCalc({ ...quickCalc, duree: e.target.value })}
                placeholder="25"
              />
            </div>
            <div className="mt-3">
              <Button size="sm" onClick={handleQuickCalc} isLoading={quickCalcLoading} leftIcon={<Calculator size={14} />}>
                Calculer
              </Button>
            </div>
            {quickResult && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <div className="bg-[#7BAFD4]/10 dark:bg-[#7BAFD4]/20 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Mensualite</p>
                  <p className="text-lg font-bold text-[#4A7FA8] dark:text-[#9BC8E4]">{formatCurrency(quickResult.mensualite)}</p>
                </div>
                <div className="bg-[#7DC4A5]/10 dark:bg-[#7DC4A5]/20 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Coût total</p>
                  <p className="text-lg font-bold text-[#4A9475] dark:text-[#9DD4B5]">{formatCurrency(quickResult.coutTotal)}</p>
                </div>
                <div className="bg-[#E8C17A]/10 dark:bg-[#E8C17A]/20 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Interets totaux</p>
                  <p className="text-lg font-bold text-[#9E7B1E] dark:text-[#E8D19A]">{formatCurrency(quickResult.interetsTotaux)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 2: TERRAINS                                                  */}
      {/* ================================================================ */}
      {activeTab === 'terrains' && (
        <div className="space-y-4">
          {terrainsLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Numéro</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Adresse</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Ville</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Superficie</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Zonage</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Prix demande</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Statut</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {terrains.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{t.numeroDossier || '--'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{t.adresse || '--'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{t.ville || '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{t.superficieM2 ? `${t.superficieM2} m2` : '--'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{t.zonage || '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{t.prixDemande ? formatCurrency(t.prixDemande) : '--'}</td>
                      <td className="px-4 py-3 text-center"><Badge color={statusColor(t.statut)} size="sm">{t.statut || '--'}</Badge></td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openTerrainEdit(t)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] hover:bg-[#7BAFD4]/10 dark:hover:bg-[#7BAFD4]/20 transition-colors" title="Modifier">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleTerrainDelete(t.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 transition-colors" title="Supprimer">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!terrainsLoading && terrains.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun terrain trouve</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {terrains.map(t => (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{t.adresse || '--'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.ville || '--'} - {t.zonage || '--'}</p>
                  </div>
                  <Badge color={statusColor(t.statut)} size="sm">{t.statut || '--'}</Badge>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    {t.superficieM2 ? `${t.superficieM2} m2` : '--'} | {t.prixDemande ? formatCurrency(t.prixDemande) : '--'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openTerrainEdit(t)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] transition-colors"><Pencil size={14} /></button>
                    <button onClick={() => handleTerrainDelete(t.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
            {!terrainsLoading && terrains.length === 0 && (
              <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun terrain trouve</p>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 3: PROJETS                                                   */}
      {/* ================================================================ */}
      {activeTab === 'projets' && (
        <div className="space-y-4">
          {projetsLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Numéro</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Nom</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Logements</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Budget</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">ROI %</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Statut</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {projets.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.numeroProjet || '--'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.nomProjet || '--'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.typeProjet || '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{p.nombreLogements ?? '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{p.budgetTotal ? formatCurrency(p.budgetTotal) : '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{p.roiEstimePct != null ? `${(p.roiEstimePct ?? 0).toFixed(1)}%` : '--'}</td>
                      <td className="px-4 py-3 text-center"><Badge color={statusColor(p.statut)} size="sm">{p.statut || '--'}</Badge></td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openProjetEdit(p)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] hover:bg-[#7BAFD4]/10 dark:hover:bg-[#7BAFD4]/20 transition-colors" title="Modifier">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleProjetDelete(p.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 transition-colors" title="Supprimer">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!projetsLoading && projets.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun projet trouve</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {projets.map(p => (
              <div key={p.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{p.nomProjet || '--'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.typeProjet || '--'} - {p.nombreLogements ?? 0} logements</p>
                  </div>
                  <Badge color={statusColor(p.statut)} size="sm">{p.statut || '--'}</Badge>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    Budget: <span className="font-medium text-gray-900 dark:text-white">{p.budgetTotal ? formatCurrency(p.budgetTotal) : '--'}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openProjetEdit(p)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] transition-colors"><Pencil size={14} /></button>
                    <button onClick={() => handleProjetDelete(p.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
            {!projetsLoading && projets.length === 0 && (
              <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun projet trouve</p>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 4: FINANCEMENT                                               */}
      {/* ================================================================ */}
      {activeTab === 'financement' && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-64">
              <Select
                label="Filtrer par projet"
                options={[{ value: '', label: 'Tous les projets' }, ...projetsDropdown]}
                value={finProjetFilter}
                onChange={e => setFinProjetFilter(e.target.value)}
              />
            </div>
          </div>

          {financementsLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Numéro</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Banque</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type pret</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Montant demande</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Montant approuve</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Taux %</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Statut</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {financements.map(f => (
                    <tr key={f.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{f.numeroFinancement || '--'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{f.banque || '--'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{f.typePret || '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{f.montantDemande ? formatCurrency(f.montantDemande) : '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{f.montantApprouve ? formatCurrency(f.montantApprouve) : '--'}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{f.tauxInteretAnnuel != null ? `${f.tauxInteretAnnuel}%` : '--'}</td>
                      <td className="px-4 py-3 text-center"><Badge color={statusColor(f.statut)} size="sm">{f.statut || '--'}</Badge></td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openFinEdit(f)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] hover:bg-[#7BAFD4]/10 dark:hover:bg-[#7BAFD4]/20 transition-colors" title="Modifier">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleFinDelete(f.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 transition-colors" title="Supprimer">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!financementsLoading && financements.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun financement trouve</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {financements.map(f => (
              <div key={f.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{f.banque || '--'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{f.typePret || '--'} - {f.numeroFinancement || '--'}</p>
                  </div>
                  <Badge color={statusColor(f.statut)} size="sm">{f.statut || '--'}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Demande</p>
                    <p className="font-medium text-gray-900 dark:text-white">{f.montantDemande ? formatCurrency(f.montantDemande) : '--'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Approuvé</p>
                    <p className="font-medium text-gray-900 dark:text-white">{f.montantApprouve ? formatCurrency(f.montantApprouve) : '--'}</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 mt-2">
                  <button onClick={() => openFinEdit(f)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => handleFinDelete(f.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {!financementsLoading && financements.length === 0 && (
              <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun financement trouve</p>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 5: CONSTRUCTION (Phases)                                     */}
      {/* ================================================================ */}
      {activeTab === 'construction' && (
        <div className="space-y-4">
          {/* Projet selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-72">
              <Select
                label="Sélectionner un projet"
                options={[{ value: '', label: '-- Choisir un projet --' }, ...projetsDropdown]}
                value={phaseProjetId ? String(phaseProjetId) : ''}
                onChange={e => setPhaseProjetId(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>

          {!phaseProjetId && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <HardHat size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Sélectionnez un projet pour voir ses phases de construction</p>
            </div>
          )}

          {phaseProjetId && phasesLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          {phaseProjetId && (
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Phase</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Statut</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Completion</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Budget prevu</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Coût réel</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Retard (j)</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {phases.map(ph => (
                      <tr key={ph.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{ph.numeroPhase}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{ph.nomPhase || '--'}</td>
                        <td className="px-4 py-3 text-center"><Badge color={statusColor(ph.statut)} size="sm">{ph.statut || '--'}</Badge></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-[#7BAFD4] h-2 rounded-full transition-all"
                                style={{ width: `${Math.min(ph.pourcentageCompletion || 0, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400 w-10 text-right">{ph.pourcentageCompletion || 0}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{ph.budgetPrevu ? formatCurrency(ph.budgetPrevu) : '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{ph.coutReel ? formatCurrency(ph.coutReel) : '--'}</td>
                        <td className="px-4 py-3 text-right">
                          {ph.retardsJours > 0 ? (
                            <span className="text-[#B8616A] dark:text-[#E8A1AA] font-medium">{ph.retardsJours}j</span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => openPhaseEdit(ph)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] hover:bg-[#7BAFD4]/10 dark:hover:bg-[#7BAFD4]/20 transition-colors" title="Modifier">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handlePhaseDelete(ph.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 transition-colors" title="Supprimer">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!phasesLoading && phases.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune phase trouvee pour ce projet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mobile cards */}
          {phaseProjetId && (
            <div className="md:hidden space-y-3">
              {phases.map(ph => (
                <div key={ph.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white truncate">#{ph.numeroPhase} - {ph.nomPhase || '--'}</p>
                    </div>
                    <Badge color={statusColor(ph.statut)} size="sm">{ph.statut || '--'}</Badge>
                  </div>
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div className="bg-[#7BAFD4] h-2 rounded-full" style={{ width: `${Math.min(ph.pourcentageCompletion || 0, 100)}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{ph.pourcentageCompletion || 0}%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">
                      Budget: {ph.budgetPrevu ? formatCurrency(ph.budgetPrevu) : '--'}
                      {ph.retardsJours > 0 && <span className="text-[#E8919A] ml-2">+{ph.retardsJours}j retard</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openPhaseEdit(ph)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => handlePhaseDelete(ph.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
              {!phasesLoading && phases.length === 0 && (
                <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune phase trouvee pour ce projet</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 6: UNITES                                                    */}
      {/* ================================================================ */}
      {activeTab === 'unites' && (
        <div className="space-y-4">
          {/* Projet selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-72">
              <Select
                label="Sélectionner un projet"
                options={[{ value: '', label: '-- Choisir un projet --' }, ...projetsDropdown]}
                value={uniteProjetId}
                onChange={e => setUniteProjetId(e.target.value)}
              />
            </div>
          </div>

          {!uniteProjetId && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <Home size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Sélectionnez un projet pour voir ses unités</p>
            </div>
          )}

          {uniteProjetId && unitesLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          {uniteProjetId && (
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Numéro</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Superficie</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Chambres</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">SdB</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Etage</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Prix vente</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Statut</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {unites.map(u => (
                      <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{u.numeroUnite || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.typeUnite || '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{u.superficieM2 ? `${u.superficieM2} m2` : '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{u.nombreChambres ?? '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{u.nombreSallesBain ?? '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{u.etage ?? '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{u.prixVente ? formatCurrency(u.prixVente) : '--'}</td>
                        <td className="px-4 py-3 text-center"><Badge color={statusColor(u.statut)} size="sm">{u.statut || '--'}</Badge></td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => openUniteEdit(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] hover:bg-[#7BAFD4]/10 dark:hover:bg-[#7BAFD4]/20 transition-colors" title="Modifier">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleUniteDelete(u.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 transition-colors" title="Supprimer">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!unitesLoading && unites.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune unite trouvee pour ce projet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mobile cards */}
          {uniteProjetId && (
            <div className="md:hidden space-y-3">
              {unites.map(u => (
                <div key={u.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{u.numeroUnite || '--'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{u.typeUnite || '--'} - {u.superficieM2 ? `${u.superficieM2} m2` : '--'}</p>
                    </div>
                    <Badge color={statusColor(u.statut)} size="sm">{u.statut || '--'}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
                    <div><span className="block text-gray-400">Ch.</span>{u.nombreChambres ?? '--'}</div>
                    <div><span className="block text-gray-400">SdB</span>{u.nombreSallesBain ?? '--'}</div>
                    <div><span className="block text-gray-400">Etage</span>{u.etage ?? '--'}</div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                    <span className="font-medium text-gray-900 dark:text-white">{u.prixVente ? formatCurrency(u.prixVente) : '--'}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openUniteEdit(u)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => handleUniteDelete(u.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
              {!unitesLoading && unites.length === 0 && (
                <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune unite trouvee pour ce projet</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 7: COMMERCIALISATION                                         */}
      {/* ================================================================ */}
      {activeTab === 'commercialisation' && (
        <div className="space-y-4">
          {/* Projet selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-72">
              <Select
                label="Sélectionner un projet"
                options={[{ value: '', label: '-- Choisir un projet --' }, ...projetsDropdown]}
                value={commProjetId ? String(commProjetId) : ''}
                onChange={e => setCommProjetId(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>

          {!commProjetId && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <Megaphone size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Sélectionnez un projet pour voir sa commercialisation</p>
            </div>
          )}

          {commProjetId && commLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* KPI cards for commercialisation */}
          {commProjetId && commercialisations.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              <KpiCard label="Unités vendues" value={commercialisations[0]?.nombreUnitesVendues ?? 0} icon={<Home size={20} />} color="green" />
              <KpiCard label="Unités louées" value={commercialisations[0]?.nombreUnitesLouees ?? 0} icon={<Key size={20} />} color="blue" />
              <KpiCard label="Prix moyen vente" value={commercialisations[0]?.prixMoyenVente ? formatCurrency(commercialisations[0].prixMoyenVente) : '--'} icon={<DollarSign size={20} />} color="amber" />
              <KpiCard label="Taux pre-ventes" value={`${commercialisations[0]?.tauxPreVentesActuelPct ?? 0}%`} icon={<BarChart3 size={20} />} color="purple" />
            </div>
          )}

          {/* Desktop table */}
          {commProjetId && (
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Strategie</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Prix moyen</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Loyer moyen</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Objectif pre-ventes</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Budget marketing</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Courtier</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Lancement</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {commercialisations.map(c => (
                      <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{c.strategieVente || '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{c.prixMoyenVente ? formatCurrency(c.prixMoyenVente) : '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{c.loyerMoyen ? formatCurrency(c.loyerMoyen) : '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{c.objectifPreVentesPct != null ? `${c.objectifPreVentesPct}%` : '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{c.budgetMarketing ? formatCurrency(c.budgetMarketing) : '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.courtierNom || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.dateLancement?.split('T')[0] || '--'}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => openCommEdit(c)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] hover:bg-[#7BAFD4]/10 dark:hover:bg-[#7BAFD4]/20 transition-colors" title="Modifier">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleCommDelete(c.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 transition-colors" title="Supprimer">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!commLoading && commercialisations.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune commercialisation trouvee</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mobile cards */}
          {commProjetId && (
            <div className="md:hidden space-y-3">
              {commercialisations.map(c => (
                <div key={c.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{c.strategieVente || '--'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Courtier: {c.courtierNom || '--'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Prix moyen</p>
                      <p className="font-medium text-gray-900 dark:text-white">{c.prixMoyenVente ? formatCurrency(c.prixMoyenVente) : '--'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Budget mktg</p>
                      <p className="font-medium text-gray-900 dark:text-white">{c.budgetMarketing ? formatCurrency(c.budgetMarketing) : '--'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1 mt-2">
                    <button onClick={() => openCommEdit(c)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] transition-colors"><Pencil size={14} /></button>
                    <button onClick={() => handleCommDelete(c.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {!commLoading && commercialisations.length === 0 && (
                <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune commercialisation trouvee</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 8: LIVRAISON                                                 */}
      {/* ================================================================ */}
      {activeTab === 'livraison' && (
        <div className="space-y-4">
          {/* Projet selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-72">
              <Select
                label="Sélectionner un projet"
                options={[{ value: '', label: '-- Choisir un projet --' }, ...projetsDropdown]}
                value={livraisonProjetId ? String(livraisonProjetId) : ''}
                onChange={e => setLivraisonProjetId(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>

          {!livraisonProjetId && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <Key size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Sélectionnez un projet pour voir ses livraisons</p>
            </div>
          )}

          {livraisonProjetId && livraisonsLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          {livraisonProjetId && (
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Unité</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Beneficiaire</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Date livraison</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Cles</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Satisfaction</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Reclamations</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {livraisons.map(l => (
                      <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{l.uniteId || '--'}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{l.beneficiaireNom || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{l.beneficiaireType || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{l.dateLivraisonPrevue?.split('T')[0] || l.dateLivraisonReelle?.split('T')[0] || '--'}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge color={l.clesRemises ? 'green' : 'yellow'} size="sm">{l.clesRemises ? 'Oui' : 'Non'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{l.noteSatisfaction ? `${l.noteSatisfaction}/10` : '--'}</td>
                        <td className="px-4 py-3 text-right">
                          {l.reclamationsOuvertes > 0 ? (
                            <span className="text-[#B8616A] dark:text-[#E8A1AA] font-medium">{l.reclamationsOuvertes}</span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => openLivraisonEdit(l)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] hover:bg-[#7BAFD4]/10 dark:hover:bg-[#7BAFD4]/20 transition-colors" title="Modifier">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleLivraisonDelete(l.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 transition-colors" title="Supprimer">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!livraisonsLoading && livraisons.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune livraison trouvee</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mobile cards */}
          {livraisonProjetId && (
            <div className="md:hidden space-y-3">
              {livraisons.map(l => (
                <div key={l.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{l.beneficiaireNom || '--'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Unité #{l.uniteId} - {l.beneficiaireType || '--'}</p>
                    </div>
                    <Badge color={l.clesRemises ? 'green' : 'yellow'} size="sm">{l.clesRemises ? 'Livre' : 'En attente'}</Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">
                      {l.dateLivraisonPrevue?.split('T')[0] || '--'} | Note: {l.noteSatisfaction ? `${l.noteSatisfaction}/10` : '--'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openLivraisonEdit(l)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#4A7FA8] transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => handleLivraisonDelete(l.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
              {!livraisonsLoading && livraisons.length === 0 && (
                <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune livraison trouvee</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 9: INSPECTIONS                                               */}
      {/* ================================================================ */}
      {activeTab === 'inspections' && (
        <div className="space-y-4">
          {/* Projet selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-72">
              <Select
                label="Sélectionner un projet"
                options={[{ value: '', label: '-- Choisir un projet --' }, ...projetsDropdown]}
                value={inspectionProjetId ? String(inspectionProjetId) : ''}
                onChange={e => setInspectionProjetId(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>

          {!inspectionProjetId && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <ClipboardCheck size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Sélectionnez un projet pour voir ses inspections</p>
            </div>
          )}

          {inspectionProjetId && inspectionsLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          {inspectionProjetId && (
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Catégorie</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Inspecteur</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Score</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Deficiences</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Statut</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Conformite</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {inspections.map(insp => (
                      <tr key={insp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{insp.typeInspection || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{insp.categorie || '--'}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{insp.inspecteurNom || '--'}</td>
                        <td className="px-4 py-3">
                          {insp.scoreConformite != null ? (
                            <div className="flex items-center gap-2 justify-center">
                              <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${insp.scoreConformite >= 80 ? 'bg-[#7DC4A5]' : insp.scoreConformite >= 50 ? 'bg-[#F6C87A]' : 'bg-[#E8919A]'}`}
                                  style={{ width: `${Math.min(insp.scoreConformite, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs">{insp.scoreConformite}%</span>
                            </div>
                          ) : '--'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{insp.nombreDeficiences ?? 0}</td>
                        <td className="px-4 py-3 text-center"><Badge color={statusColor(insp.statut)} size="sm">{insp.statut || '--'}</Badge></td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {insp.conformeCnb && <Badge color="green" size="sm">CNB</Badge>}
                            {insp.conformeCce && <Badge color="green" size="sm">CCE</Badge>}
                            {insp.conformeCsst && <Badge color="green" size="sm">CSST</Badge>}
                            {!insp.conformeCnb && !insp.conformeCce && !insp.conformeCsst && <span className="text-gray-400">--</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{insp.datePlanifiee?.split('T')[0] || insp.dateRealisee?.split('T')[0] || '--'}</td>
                      </tr>
                    ))}
                    {!inspectionsLoading && inspections.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune inspection trouvee</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mobile cards */}
          {inspectionProjetId && (
            <div className="md:hidden space-y-3">
              {inspections.map(insp => (
                <div key={insp.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{insp.typeInspection || '--'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{insp.inspecteurNom || '--'} - {insp.categorie || '--'}</p>
                    </div>
                    <Badge color={statusColor(insp.statut)} size="sm">{insp.statut || '--'}</Badge>
                  </div>
                  {insp.scoreConformite != null && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${insp.scoreConformite >= 80 ? 'bg-[#7DC4A5]' : insp.scoreConformite >= 50 ? 'bg-[#F6C87A]' : 'bg-[#E8919A]'}`}
                          style={{ width: `${Math.min(insp.scoreConformite, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{insp.scoreConformite}%</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                    <div className="flex items-center gap-1">
                      {insp.conformeCnb && <Badge color="green" size="sm">CNB</Badge>}
                      {insp.conformeCce && <Badge color="green" size="sm">CCE</Badge>}
                      {insp.conformeCsst && <Badge color="green" size="sm">CSST</Badge>}
                    </div>
                    <span className="text-gray-500 dark:text-gray-400 text-xs">Def: {insp.nombreDeficiences ?? 0}</span>
                  </div>
                </div>
              ))}
              {!inspectionsLoading && inspections.length === 0 && (
                <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucune inspection trouvee</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 10: PAIEMENTS                                                */}
      {/* ================================================================ */}
      {activeTab === 'paiements' && (
        <div className="space-y-4">
          {/* Projet selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-72">
              <Select
                label="Sélectionner un projet"
                options={[{ value: '', label: '-- Choisir un projet --' }, ...projetsDropdown]}
                value={paiementProjetId ? String(paiementProjetId) : ''}
                onChange={e => setPaiementProjetId(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>

          {!paiementProjetId && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <CreditCard size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Sélectionnez un projet pour voir ses paiements</p>
            </div>
          )}

          {paiementProjetId && paiementsLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          {paiementProjetId && (
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Catégorie</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Montant</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Beneficiaire</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Description</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Date</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {paiements.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.typePaiement || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.categorie || '--'}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{p.montant ? formatCurrency(p.montant) : '--'}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.beneficiaire || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-xs truncate">{p.description || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.datePaiement?.split('T')[0] || '--'}</td>
                        <td className="px-4 py-3 text-center"><Badge color={statusColor(p.statut)} size="sm">{p.statut || '--'}</Badge></td>
                      </tr>
                    ))}
                    {!paiementsLoading && paiements.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun paiement trouve</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mobile cards */}
          {paiementProjetId && (
            <div className="md:hidden space-y-3">
              {paiements.map(p => (
                <div key={p.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{p.typePaiement || '--'} - {p.categorie || '--'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.beneficiaire || '--'}</p>
                    </div>
                    <Badge color={statusColor(p.statut)} size="sm">{p.statut || '--'}</Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                    <span className="font-medium text-gray-900 dark:text-white">{p.montant ? formatCurrency(p.montant) : '--'}</span>
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{p.datePaiement?.split('T')[0] || '--'}</span>
                  </div>
                </div>
              ))}
              {!paiementsLoading && paiements.length === 0 && (
                <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun paiement trouve</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 11: DOCUMENTS                                                */}
      {/* ================================================================ */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          {/* Projet selector + category filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-72">
              <Select
                label="Sélectionner un projet"
                options={[{ value: '', label: '-- Choisir un projet --' }, ...projetsDropdown]}
                value={docProjetId ? String(docProjetId) : ''}
                onChange={e => setDocProjetId(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            {docProjetId && (
              <div className="w-full sm:w-48">
                <Select
                  label="Catégorie"
                  options={DOC_CATEGORIES}
                  value={docCatFilter}
                  onChange={e => setDocCatFilter(e.target.value)}
                />
              </div>
            )}
          </div>

          {!docProjetId && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <FolderOpen size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Sélectionnez un projet pour voir ses documents</p>
            </div>
          )}

          {docProjetId && documentsLoading && <p className="text-sm text-gray-400 dark:text-gray-500">Chargement...</p>}

          {/* Desktop table */}
          {docProjetId && (
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Nom</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Catégorie</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type fichier</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Date document</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Confidentiel</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Statut</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {documents.map(d => (
                      <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{d.nomDocument || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{d.categorie || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{d.typeFichier || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{d.dateDocument?.split('T')[0] || '--'}</td>
                        <td className="px-4 py-3 text-center">
                          {d.confidentiel ? <Badge color="red" size="sm">Confidentiel</Badge> : <span className="text-gray-400">--</span>}
                        </td>
                        <td className="px-4 py-3 text-center"><Badge color={statusColor(d.statut)} size="sm">{d.statut || '--'}</Badge></td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => handleDocDelete(d.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] hover:bg-[#E8919A]/10 dark:hover:bg-[#E8919A]/20 transition-colors" title="Supprimer">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!documentsLoading && documents.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun document trouve</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mobile cards */}
          {docProjetId && (
            <div className="md:hidden space-y-3">
              {documents.map(d => (
                <div key={d.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white truncate">{d.nomDocument || '--'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{d.categorie || '--'} - {d.typeFichier || '--'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {d.confidentiel && <Badge color="red" size="sm">Conf.</Badge>}
                      <Badge color={statusColor(d.statut)} size="sm">{d.statut || '--'}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{d.dateDocument?.split('T')[0] || '--'}</span>
                    <button onClick={() => handleDocDelete(d.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-[#B8616A] transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {!documentsLoading && documents.length === 0 && (
                <p className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">Aucun document trouve</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 12: CALCULATEURS (6 sub-tabs)                                */}
      {/* ================================================================ */}
      {activeTab === 'calculateur' && (
        <div className="space-y-5">
          {/* Sub-tab navigation */}
          <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
            {([
              { key: 'mensualite', label: 'Mensualite' },
              { key: 'amortissement', label: 'Amortissement' },
              { key: 'intercalaires', label: 'Interets intercalaires' },
              { key: 'schl', label: 'Prime SCHL' },
              { key: 'roi', label: 'ROI' },
              { key: 'cout_total', label: 'Coût total' },
            ] as { key: typeof CALC_TABS[number]; label: string }[]).map(ct => (
              <button
                key={ct.key}
                onClick={() => setCalcTab(ct.key)}
                className={`px-3 py-2 text-xs md:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  calcTab === ct.key
                    ? 'border-seaop-primary-600 text-seaop-primary-600 dark:border-seaop-primary-400 dark:text-seaop-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {ct.label}
              </button>
            ))}
          </div>

          {/* Mensualite sub-tab */}
          {calcTab === 'mensualite' && (
            <>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white mb-5">Calculateur de mensualite hypothecaire</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Input label="Capital ($)" type="number" value={calcForm.capital} onChange={e => setCalcForm({ ...calcForm, capital: e.target.value })} placeholder="500000" />
                  <Input label="Taux annuel (%)" type="number" value={calcForm.taux} onChange={e => setCalcForm({ ...calcForm, taux: e.target.value })} placeholder="5.5" />
                  <Input label="Durée (années)" type="number" value={calcForm.duree} onChange={e => setCalcForm({ ...calcForm, duree: e.target.value })} placeholder="25" />
                </div>
                <div className="mt-4">
                  <Button onClick={handleCalc} isLoading={calcLoading} leftIcon={<Calculator size={16} />}>Calculer la mensualite</Button>
                </div>
              </div>
              {calcResult && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 border-l-4 border-l-blue-500 p-4 md:p-5 text-center">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Mensualite</p>
                    <p className="text-2xl md:text-3xl font-bold text-[#4A7FA8] dark:text-[#9BC8E4] mt-1">{formatCurrency(calcResult.mensualite)}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 border-l-4 border-l-emerald-500 p-4 md:p-5 text-center">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Coût total du crédit</p>
                    <p className="text-2xl md:text-3xl font-bold text-[#4A9475] dark:text-[#9DD4B5] mt-1">{formatCurrency(calcResult.coutTotal)}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 border-l-4 border-l-amber-500 p-4 md:p-5 text-center">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Interets totaux</p>
                    <p className="text-2xl md:text-3xl font-bold text-[#9E7B1E] dark:text-[#E8D19A] mt-1">{formatCurrency(calcResult.interetsTotaux)}</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Amortissement sub-tab */}
          {calcTab === 'amortissement' && (
            <>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white mb-5">Tableau d'amortissement</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <Input label="Capital ($)" type="number" value={amortForm.capital} onChange={e => setAmortForm({ ...amortForm, capital: e.target.value })} placeholder="500000" />
                  <Input label="Taux annuel (%)" type="number" value={amortForm.tauxAnnuel} onChange={e => setAmortForm({ ...amortForm, tauxAnnuel: e.target.value })} placeholder="5.5" />
                  <Input label="Durée (années)" type="number" value={amortForm.dureeAnnees} onChange={e => setAmortForm({ ...amortForm, dureeAnnees: e.target.value })} placeholder="25" />
                  <Select label="Frequence" options={[{ value: 'Mensuel', label: 'Mensuel' }, { value: 'Bi-hebdomadaire', label: 'Bi-hebdomadaire' }, { value: 'Hebdomadaire', label: 'Hebdomadaire' }]} value={amortForm.frequence} onChange={e => setAmortForm({ ...amortForm, frequence: e.target.value })} />
                </div>
                <div className="mt-4">
                  <Button onClick={handleAmortCalc} isLoading={calcLoading} leftIcon={<Calculator size={16} />}>Calculer l'amortissement</Button>
                </div>
              </div>
              {amortResult && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <KpiCard label="Mensualite" value={formatCurrency(amortResult.resume.mensualite)} icon={<DollarSign size={20} />} color="blue" />
                    <KpiCard label="Total interets" value={formatCurrency(amortResult.resume.totalInterets)} icon={<BarChart3 size={20} />} color="amber" />
                    <KpiCard label="Coût total" value={formatCurrency(amortResult.resume.coutTotal)} icon={<Calculator size={20} />} color="green" />
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0">
                          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Periode</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Paiement</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Capital</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Interet</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Solde</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {amortResult.tableau.slice(0, 24).map(row => (
                            <tr key={row.periode} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                              <td className="px-4 py-2 text-gray-900 dark:text-white">{row.periode}</td>
                              <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.paiement)}</td>
                              <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.capital)}</td>
                              <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">{formatCurrency(row.interet)}</td>
                              <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.solde)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {amortResult.tableau.length > 24 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 p-3 text-center">Affichage des 24 premieres periodes sur {amortResult.tableau.length}</p>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* Interets intercalaires sub-tab */}
          {calcTab === 'intercalaires' && (
            <>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white mb-5">Interets intercalaires</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Input label="Montant emprunte ($)" type="number" value={intercForm.montantEmprunte} onChange={e => setIntercForm({ ...intercForm, montantEmprunte: e.target.value })} placeholder="2000000" />
                  <Input label="Taux annuel (%)" type="number" value={intercForm.tauxAnnuel} onChange={e => setIntercForm({ ...intercForm, tauxAnnuel: e.target.value })} placeholder="6.0" />
                  <Input label="Durée construction (mois)" type="number" value={intercForm.dureeConstructionMois} onChange={e => setIntercForm({ ...intercForm, dureeConstructionMois: e.target.value })} placeholder="18" />
                </div>
                <div className="mt-4">
                  <Button onClick={handleIntercCalc} isLoading={calcLoading} leftIcon={<Calculator size={16} />}>Calculer les interets</Button>
                </div>
              </div>
              {intercalairesResult && (
                <>
                  <KpiCard label="Total interets intercalaires" value={formatCurrency(intercalairesResult.totalInterets)} icon={<DollarSign size={20} />} color="amber" />
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Mois</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Deblocage</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Solde cumule</th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Interet</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {intercalairesResult.detail.map(row => (
                            <tr key={row.mois} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                              <td className="px-4 py-2 text-gray-900 dark:text-white">{row.mois}</td>
                              <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.deblocage)}</td>
                              <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.soldeCumule)}</td>
                              <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">{formatCurrency(row.interet)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Prime SCHL sub-tab */}
          {calcTab === 'schl' && (
            <>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white mb-5">Calculateur de prime SCHL</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Montant du pret ($)" type="number" value={schlForm.montantPret} onChange={e => setSchlForm({ ...schlForm, montantPret: e.target.value })} placeholder="400000" />
                  <Input label="Valeur de la propriété ($)" type="number" value={schlForm.valeurPropriete} onChange={e => setSchlForm({ ...schlForm, valeurPropriete: e.target.value })} placeholder="500000" />
                </div>
                <div className="mt-4">
                  <Button onClick={handleSchlCalc} isLoading={calcLoading} leftIcon={<Calculator size={16} />}>Calculer la prime</Button>
                </div>
              </div>
              {schlResult && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard label="Ratio LTV" value={`${(schlResult.ratioLtv ?? 0).toFixed(1)}%`} icon={<BarChart3 size={20} />} color="blue" />
                  <KpiCard label="Prime %" value={`${(schlResult.primePct ?? 0).toFixed(2)}%`} icon={<DollarSign size={20} />} color="purple" />
                  <KpiCard label="Prime montant" value={formatCurrency(schlResult.primeMontant)} icon={<DollarSign size={20} />} color="amber" />
                  <KpiCard label="Pret total" value={formatCurrency(schlResult.pretTotal)} icon={<Landmark size={20} />} color="green" />
                </div>
              )}
            </>
          )}

          {/* ROI sub-tab */}
          {calcTab === 'roi' && (
            <>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white mb-5">Calculateur de ROI</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <Input label="Investissement total ($)" type="number" value={roiForm.investissementTotal} onChange={e => setRoiForm({ ...roiForm, investissementTotal: e.target.value })} placeholder="1000000" />
                  <Input label="Revenus annuels ($)" type="number" value={roiForm.revenusAnnuels} onChange={e => setRoiForm({ ...roiForm, revenusAnnuels: e.target.value })} placeholder="150000" />
                  <Input label="Depenses annuelles ($)" type="number" value={roiForm.depensesAnnuelles} onChange={e => setRoiForm({ ...roiForm, depensesAnnuelles: e.target.value })} placeholder="50000" />
                  <Input label="Durée (années)" type="number" value={roiForm.dureeAnnees} onChange={e => setRoiForm({ ...roiForm, dureeAnnees: e.target.value })} placeholder="5" />
                </div>
                <div className="mt-4">
                  <Button onClick={handleRoiCalc} isLoading={calcLoading} leftIcon={<Calculator size={16} />}>Calculer le ROI</Button>
                </div>
              </div>
              {roiResult && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <KpiCard label="ROI" value={`${(roiResult.roiPct ?? 0).toFixed(1)}%`} icon={<BarChart3 size={20} />} color="green" />
                  <KpiCard label="Benefice net annuel" value={formatCurrency(roiResult.beneficeNetAnnuel)} icon={<DollarSign size={20} />} color="blue" />
                  <KpiCard label="Période de récupération" value={roiResult.periodeRecuperation != null ? `${(roiResult.periodeRecuperation ?? 0).toFixed(1)} ans` : 'N/A'} icon={<Calculator size={20} />} color="amber" />
                </div>
              )}
            </>
          )}

          {/* Cout total sub-tab */}
          {calcTab === 'cout_total' && (
            <>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white mb-5">Calculateur de cout total</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Input label="Capital ($)" type="number" value={coutForm.capital} onChange={e => setCoutForm({ ...coutForm, capital: e.target.value })} placeholder="500000" />
                  <Input label="Taux annuel (%)" type="number" value={coutForm.tauxAnnuel} onChange={e => setCoutForm({ ...coutForm, tauxAnnuel: e.target.value })} placeholder="5.5" />
                  <Input label="Durée (années)" type="number" value={coutForm.dureeAnnees} onChange={e => setCoutForm({ ...coutForm, dureeAnnees: e.target.value })} placeholder="25" />
                </div>
                <div className="mt-4">
                  <Button onClick={handleCoutTotalCalc} isLoading={calcLoading} leftIcon={<Calculator size={16} />}>Calculer le cout total</Button>
                </div>
              </div>
              {coutTotalResult && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard label="Mensualite" value={formatCurrency(coutTotalResult.mensualite)} icon={<DollarSign size={20} />} color="blue" />
                  <KpiCard label="Coût total" value={formatCurrency(coutTotalResult.coutTotal)} icon={<Calculator size={20} />} color="green" />
                  <KpiCard label="Interets totaux" value={formatCurrency(coutTotalResult.interetsTotaux)} icon={<BarChart3 size={20} />} color="amber" />
                  <KpiCard label="Capital" value={formatCurrency(coutTotalResult.capital)} icon={<Landmark size={20} />} color="purple" />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* FONDS DE PREVOYANCE (Loi 16)                                     */}
      {/* ================================================================ */}
      {activeTab === 'fondsPrevoyance' && <FondsPrevoyanceTab />}

      {/* ================================================================ */}
      {/* MODALS                                                           */}
      {/* ================================================================ */}

      {/* Terrain Modal */}
      <Modal isOpen={showTerrainModal} onClose={() => setShowTerrainModal(false)} title={editTerrain ? 'Modifier le terrain' : 'Nouveau terrain'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Adresse *" value={terrainForm.adresse} onChange={e => setTerrainForm({ ...terrainForm, adresse: e.target.value })} required />
            <Input label="Ville *" value={terrainForm.ville} onChange={e => setTerrainForm({ ...terrainForm, ville: e.target.value })} required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Code postal" value={terrainForm.codePostal} onChange={e => setTerrainForm({ ...terrainForm, codePostal: e.target.value })} />
            <Input label="Superficie (m2)" type="number" value={terrainForm.superficieM2} onChange={e => setTerrainForm({ ...terrainForm, superficieM2: e.target.value })} />
            <Select label="Zonage" options={ZONAGE_OPTIONS} value={terrainForm.zonage} onChange={e => setTerrainForm({ ...terrainForm, zonage: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Proprietaire nom" value={terrainForm.proprietaireNom} onChange={e => setTerrainForm({ ...terrainForm, proprietaireNom: e.target.value })} />
            <Input label="Prix demande ($)" type="number" value={terrainForm.prixDemande} onChange={e => setTerrainForm({ ...terrainForm, prixDemande: e.target.value })} />
          </div>
          <Input label="Notes" value={terrainForm.notes} onChange={e => setTerrainForm({ ...terrainForm, notes: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowTerrainModal(false)}>Annuler</Button>
            <Button onClick={handleTerrainSave} disabled={!terrainForm.adresse.trim() || !terrainForm.ville.trim()}>
              {editTerrain ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Projet Modal */}
      <Modal isOpen={showProjetModal} onClose={() => setShowProjetModal(false)} title={editProjet ? 'Modifier le projet' : 'Nouveau projet immobilier'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Nom du projet *" value={projetForm.nomProjet} onChange={e => setProjetForm({ ...projetForm, nomProjet: e.target.value })} required />
            <Select label="Type de projet" options={TYPE_PROJET_OPTIONS} value={projetForm.typeProjet} onChange={e => setProjetForm({ ...projetForm, typeProjet: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Nombre de logements" type="number" value={projetForm.nombreLogements} onChange={e => setProjetForm({ ...projetForm, nombreLogements: e.target.value })} />
            <Input label="Budget total ($)" type="number" value={projetForm.budgetTotal} onChange={e => setProjetForm({ ...projetForm, budgetTotal: e.target.value })} />
            <Input label="Coût terrain ($)" type="number" value={projetForm.coutTerrain} onChange={e => setProjetForm({ ...projetForm, coutTerrain: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Coût construction ($)" type="number" value={projetForm.coutConstruction} onChange={e => setProjetForm({ ...projetForm, coutConstruction: e.target.value })} />
            <Input label="Revenus ventes estimés ($)" type="number" value={projetForm.revenusVentesEstimes} onChange={e => setProjetForm({ ...projetForm, revenusVentesEstimes: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Date début" type="date" value={projetForm.dateDebutPlanifiee} onChange={e => setProjetForm({ ...projetForm, dateDebutPlanifiee: e.target.value })} />
            <Input label="Date fin" type="date" value={projetForm.dateFinPlanifiee} onChange={e => setProjetForm({ ...projetForm, dateFinPlanifiee: e.target.value })} />
          </div>
          <Input label="Description" value={projetForm.description} onChange={e => setProjetForm({ ...projetForm, description: e.target.value })} />
          <Input label="Notes" value={projetForm.notes} onChange={e => setProjetForm({ ...projetForm, notes: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowProjetModal(false)}>Annuler</Button>
            <Button onClick={handleProjetSave} disabled={!projetForm.nomProjet.trim()}>
              {editProjet ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Financement Modal */}
      <Modal isOpen={showFinModal} onClose={() => setShowFinModal(false)} title={editFin ? 'Modifier le financement' : 'Nouveau financement'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Projet" options={[{ value: '', label: '-- Choisir un projet --' }, ...projetsDropdown]} value={finForm.projetId} onChange={e => setFinForm({ ...finForm, projetId: e.target.value })} />
            <Input label="Banque *" value={finForm.banque} onChange={e => setFinForm({ ...finForm, banque: e.target.value })} required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Type de prêt" options={TYPE_PRET_OPTIONS} value={finForm.typePret} onChange={e => setFinForm({ ...finForm, typePret: e.target.value })} />
            <Input label="Montant demandé ($)" type="number" value={finForm.montantDemande} onChange={e => setFinForm({ ...finForm, montantDemande: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Taux intérêt annuel (%)" type="number" value={finForm.tauxInteretAnnuel} onChange={e => setFinForm({ ...finForm, tauxInteretAnnuel: e.target.value })} />
            <Input label="Durée amortissement (ans)" type="number" value={finForm.dureeAmortissementAnnees} onChange={e => setFinForm({ ...finForm, dureeAmortissementAnnees: e.target.value })} />
            <Input label="Mise de fonds (%)" type="number" value={finForm.miseDeFondsPct} onChange={e => setFinForm({ ...finForm, miseDeFondsPct: e.target.value })} />
          </div>
          <Input label="Notes" value={finForm.notes} onChange={e => setFinForm({ ...finForm, notes: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowFinModal(false)}>Annuler</Button>
            <Button onClick={handleFinSave} disabled={!finForm.banque.trim()}>
              {editFin ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Unite Modal */}
      <Modal isOpen={showUniteModal} onClose={() => setShowUniteModal(false)} title={editUnite ? 'Modifier l\'unité' : 'Nouvelle unité'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Numéro unité *" value={uniteForm.numeroUnite} onChange={e => setUniteForm({ ...uniteForm, numeroUnite: e.target.value })} required />
            <Select label="Type" options={TYPE_UNITE_OPTIONS} value={uniteForm.typeUnite} onChange={e => setUniteForm({ ...uniteForm, typeUnite: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Superficie (m2)" type="number" value={uniteForm.superficieM2} onChange={e => setUniteForm({ ...uniteForm, superficieM2: e.target.value })} />
            <Input label="Chambres" type="number" value={uniteForm.nombreChambres} onChange={e => setUniteForm({ ...uniteForm, nombreChambres: e.target.value })} />
            <Input label="Salles de bain" type="number" value={uniteForm.nombreSallesBain} onChange={e => setUniteForm({ ...uniteForm, nombreSallesBain: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Étage" type="number" value={uniteForm.etage} onChange={e => setUniteForm({ ...uniteForm, etage: e.target.value })} />
            <Input label="Prix vente ($)" type="number" value={uniteForm.prixVente} onChange={e => setUniteForm({ ...uniteForm, prixVente: e.target.value })} />
            <Input label="Loyer mensuel ($)" type="number" value={uniteForm.loyerMensuel} onChange={e => setUniteForm({ ...uniteForm, loyerMensuel: e.target.value })} />
          </div>
          <Input label="Notes" value={uniteForm.notes} onChange={e => setUniteForm({ ...uniteForm, notes: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowUniteModal(false)}>Annuler</Button>
            <Button onClick={handleUniteSave} disabled={!uniteForm.numeroUnite.trim()}>
              {editUnite ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Phase Modal */}
      <Modal isOpen={showPhaseModal} onClose={() => setShowPhaseModal(false)} title={editPhase ? 'Modifier la phase' : 'Nouvelle phase de construction'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {standardPhases.length > 0 ? (
              <Select
                label="Nom de la phase *"
                options={standardPhases.map(sp => ({ value: sp, label: sp }))}
                value={phaseForm.nomPhase}
                onChange={e => setPhaseForm({ ...phaseForm, nomPhase: e.target.value })}
              />
            ) : (
              <Input label="Nom de la phase *" value={phaseForm.nomPhase} onChange={e => setPhaseForm({ ...phaseForm, nomPhase: e.target.value })} required />
            )}
            <Input label="Numéro de phase" type="number" value={phaseForm.numeroPhase} onChange={e => setPhaseForm({ ...phaseForm, numeroPhase: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select label="Statut" options={PHASE_STATUTS.filter(s => s.value !== '')} value={phaseForm.statut} onChange={e => setPhaseForm({ ...phaseForm, statut: e.target.value })} />
            <Input label="Completion (%)" type="number" value={phaseForm.pourcentageCompletion} onChange={e => setPhaseForm({ ...phaseForm, pourcentageCompletion: e.target.value })} />
            <Input label="Budget prévu ($)" type="number" value={phaseForm.budgetPrevu} onChange={e => setPhaseForm({ ...phaseForm, budgetPrevu: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Date début prévue" type="date" value={phaseForm.dateDebutPrevue} onChange={e => setPhaseForm({ ...phaseForm, dateDebutPrevue: e.target.value })} />
            <Input label="Date fin prévue" type="date" value={phaseForm.dateFinPrevue} onChange={e => setPhaseForm({ ...phaseForm, dateFinPrevue: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Retard (jours)" type="number" value={phaseForm.retardsJours} onChange={e => setPhaseForm({ ...phaseForm, retardsJours: e.target.value })} />
            <Input label="Raison retard" value={phaseForm.raisonRetard} onChange={e => setPhaseForm({ ...phaseForm, raisonRetard: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={phaseForm.inspectionRequise} onChange={e => setPhaseForm({ ...phaseForm, inspectionRequise: e.target.checked })} className="rounded border-gray-300" />
              Inspection requise
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={phaseForm.conformeCnb} onChange={e => setPhaseForm({ ...phaseForm, conformeCnb: e.target.checked })} className="rounded border-gray-300" />
              Conforme CNB
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={phaseForm.materiauxCommandes} onChange={e => setPhaseForm({ ...phaseForm, materiauxCommandes: e.target.checked })} className="rounded border-gray-300" />
              Materiaux commandes
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={phaseForm.materiauxRecus} onChange={e => setPhaseForm({ ...phaseForm, materiauxRecus: e.target.checked })} className="rounded border-gray-300" />
              Materiaux recus
            </label>
          </div>
          <Input label="Notes" value={phaseForm.notes} onChange={e => setPhaseForm({ ...phaseForm, notes: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowPhaseModal(false)}>Annuler</Button>
            <Button onClick={handlePhaseSave} disabled={!phaseForm.nomPhase.trim()}>
              {editPhase ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Commercialisation Modal */}
      <Modal isOpen={showCommModal} onClose={() => setShowCommModal(false)} title={editComm ? 'Modifier la commercialisation' : 'Nouvelle commercialisation'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Strategie de vente" options={[{ value: 'Pre-vente', label: 'Pre-vente' }, { value: 'Vente directe', label: 'Vente directe' }, { value: 'Location', label: 'Location' }, { value: 'Mixte', label: 'Mixte' }]} value={commForm.strategieVente} onChange={e => setCommForm({ ...commForm, strategieVente: e.target.value })} />
            <Input label="Date de lancement" type="date" value={commForm.dateLancement} onChange={e => setCommForm({ ...commForm, dateLancement: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Prix moyen vente ($)" type="number" value={commForm.prixMoyenVente} onChange={e => setCommForm({ ...commForm, prixMoyenVente: e.target.value })} />
            <Input label="Loyer moyen ($)" type="number" value={commForm.loyerMoyen} onChange={e => setCommForm({ ...commForm, loyerMoyen: e.target.value })} />
            <Input label="Objectif pre-ventes (%)" type="number" value={commForm.objectifPreVentesPct} onChange={e => setCommForm({ ...commForm, objectifPreVentesPct: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Budget marketing ($)" type="number" value={commForm.budgetMarketing} onChange={e => setCommForm({ ...commForm, budgetMarketing: e.target.value })} />
            <Input label="Site web" value={commForm.siteWeb} onChange={e => setCommForm({ ...commForm, siteWeb: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Courtier nom" value={commForm.courtierNom} onChange={e => setCommForm({ ...commForm, courtierNom: e.target.value })} />
            <Input label="Commission courtier (%)" type="number" value={commForm.commissionCourtierPct} onChange={e => setCommForm({ ...commForm, commissionCourtierPct: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={commForm.brochurePrete} onChange={e => setCommForm({ ...commForm, brochurePrete: e.target.checked })} className="rounded border-gray-300" />
              Brochure prete
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={commForm.plansVentePrets} onChange={e => setCommForm({ ...commForm, plansVentePrets: e.target.checked })} className="rounded border-gray-300" />
              Plans de vente prets
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={commForm.maquette3d} onChange={e => setCommForm({ ...commForm, maquette3d: e.target.checked })} className="rounded border-gray-300" />
              Maquette 3D
            </label>
          </div>
          <Input label="Notes" value={commForm.notes} onChange={e => setCommForm({ ...commForm, notes: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCommModal(false)}>Annuler</Button>
            <Button onClick={handleCommSave}>
              {editComm ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Livraison Modal */}
      <Modal isOpen={showLivraisonModal} onClose={() => setShowLivraisonModal(false)} title={editLivraison ? 'Modifier la livraison' : 'Nouvelle livraison'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="ID Unite" type="number" value={livraisonForm.uniteId} onChange={e => setLivraisonForm({ ...livraisonForm, uniteId: e.target.value })} />
            <Input label="Nom du beneficiaire" value={livraisonForm.beneficiaireNom} onChange={e => setLivraisonForm({ ...livraisonForm, beneficiaireNom: e.target.value })} />
            <Select label="Type beneficiaire" options={[{ value: 'Acheteur', label: 'Acheteur' }, { value: 'Locataire', label: 'Locataire' }]} value={livraisonForm.beneficiaireType} onChange={e => setLivraisonForm({ ...livraisonForm, beneficiaireType: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Date livraison prevue" type="date" value={livraisonForm.dateLivraisonPrevue} onChange={e => setLivraisonForm({ ...livraisonForm, dateLivraisonPrevue: e.target.value })} />
            <Input label="Durée garantie (mois)" type="number" value={livraisonForm.dureeGarantieMois} onChange={e => setLivraisonForm({ ...livraisonForm, dureeGarantieMois: e.target.value })} />
          </div>
          <Input label="Liste des deficiences" value={livraisonForm.listeDeficiences} onChange={e => setLivraisonForm({ ...livraisonForm, listeDeficiences: e.target.value })} />

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Documents remis</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.clesRemises} onChange={e => setLivraisonForm({ ...livraisonForm, clesRemises: e.target.checked })} className="rounded border-gray-300" />
                Cles remises
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.acteVenteSigne} onChange={e => setLivraisonForm({ ...livraisonForm, acteVenteSigne: e.target.checked })} className="rounded border-gray-300" />
                Acte vente signe
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.bailSigne} onChange={e => setLivraisonForm({ ...livraisonForm, bailSigne: e.target.checked })} className="rounded border-gray-300" />
                Bail signe
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.manuelCopropriete} onChange={e => setLivraisonForm({ ...livraisonForm, manuelCopropriete: e.target.checked })} className="rounded border-gray-300" />
                Manuel copropriete
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.plansConformes} onChange={e => setLivraisonForm({ ...livraisonForm, plansConformes: e.target.checked })} className="rounded border-gray-300" />
                Plans conformes
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.certificatConformite} onChange={e => setLivraisonForm({ ...livraisonForm, certificatConformite: e.target.checked })} className="rounded border-gray-300" />
                Certificat conformite
              </label>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Garanties</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.inspectionPreLivraison} onChange={e => setLivraisonForm({ ...livraisonForm, inspectionPreLivraison: e.target.checked })} className="rounded border-gray-300" />
                Inspection pre-livraison
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.deficiencesCorrigees} onChange={e => setLivraisonForm({ ...livraisonForm, deficiencesCorrigees: e.target.checked })} className="rounded border-gray-300" />
                Deficiences corrigees
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.garantieLegaleViceCache} onChange={e => setLivraisonForm({ ...livraisonForm, garantieLegaleViceCache: e.target.checked })} className="rounded border-gray-300" />
                Garantie legale vice cache
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={livraisonForm.garantieGcr} onChange={e => setLivraisonForm({ ...livraisonForm, garantieGcr: e.target.checked })} className="rounded border-gray-300" />
                Garantie GCR
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Note satisfaction (1-10)" type="number" value={livraisonForm.noteSatisfaction} onChange={e => setLivraisonForm({ ...livraisonForm, noteSatisfaction: e.target.value })} />
            <Input label="Commentaires client" value={livraisonForm.commentairesClient} onChange={e => setLivraisonForm({ ...livraisonForm, commentairesClient: e.target.value })} />
          </div>
          <Input label="Notes" value={livraisonForm.notes} onChange={e => setLivraisonForm({ ...livraisonForm, notes: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowLivraisonModal(false)}>Annuler</Button>
            <Button onClick={handleLivraisonSave}>
              {editLivraison ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Document Modal */}
      <Modal isOpen={showDocModal} onClose={() => setShowDocModal(false)} title="Nouveau document" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Nom du document *" value={docForm.nomDocument} onChange={e => setDocForm({ ...docForm, nomDocument: e.target.value })} required />
            <Select label="Catégorie" options={DOC_CATEGORIES.filter(c => c.value !== '')} value={docForm.categorie} onChange={e => setDocForm({ ...docForm, categorie: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Type de fichier" options={[{ value: 'PDF', label: 'PDF' }, { value: 'Image', label: 'Image' }, { value: 'Word', label: 'Word' }, { value: 'Excel', label: 'Excel' }, { value: 'CAD', label: 'CAD' }, { value: 'Autre', label: 'Autre' }]} value={docForm.typeFichier} onChange={e => setDocForm({ ...docForm, typeFichier: e.target.value })} />
            <Input label="Chemin du fichier" value={docForm.cheminFichier} onChange={e => setDocForm({ ...docForm, cheminFichier: e.target.value })} />
          </div>
          <Input label="Description" value={docForm.description} onChange={e => setDocForm({ ...docForm, description: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Date document" type="date" value={docForm.dateDocument} onChange={e => setDocForm({ ...docForm, dateDocument: e.target.value })} />
            <Input label="Date expiration" type="date" value={docForm.dateExpiration} onChange={e => setDocForm({ ...docForm, dateExpiration: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={docForm.confidentiel} onChange={e => setDocForm({ ...docForm, confidentiel: e.target.checked })} className="rounded border-gray-300" />
            Confidentiel
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowDocModal(false)}>Annuler</Button>
            <Button onClick={handleDocSave} disabled={!docForm.nomDocument.trim()}>
              Creer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
