/**
 * SEAOP React Frontend - Appels d'offres Page
 * Public listing of available projects. Accessible to everyone.
 * Entrepreneurs get additional tabs (soumissions, profil) when logged in.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Briefcase,
  FileText,
  Star,
  FolderOpen,
  User,
  CheckCircle,
  FilePlus,
} from 'lucide-react';

import { useAuthStore } from '@/store/useAuthStore';
import { useLeadStore } from '@/store/useLeadStore';
import { useSoumissionStore } from '@/store/useSoumissionStore';
import { LeadCard } from '@/components/leads/LeadCard';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { SoumissionList } from '@/components/soumissions/SoumissionList';
import { SoumissionForm } from '@/components/soumissions/SoumissionForm';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import StatCard from '@/components/common/StatCard';
import type { SoumissionCreate } from '@/types';

type TabKey = 'projets' | 'soumissions' | 'profil';

interface TabConfig {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}

const ALL_TABS: TabConfig[] = [
  { key: 'projets', label: 'Appels d’offres', icon: <Briefcase className="h-4 w-4" /> },
  { key: 'soumissions', label: 'Mes soumissions', icon: <FileText className="h-4 w-4" /> },
  { key: 'profil', label: 'Mon profil', icon: <User className="h-4 w-4" /> },
];

export default function EspaceEntrepreneurPage() {
  const { isAuthenticated, user, entrepreneur } = useAuthStore();
  const isEntrepreneur = isAuthenticated && user?.userType === 'entrepreneur';
  const { leads, isLoading, filters, fetchLeads, setFilter } = useLeadStore();
  const {
    mySoumissions,
    isLoadingMySoumissions,
    fetchMySoumissions,
    submitSoumission,
    error: soumissionError,
  } = useSoumissionStore();
  const [activeTab, setActiveTab] = useState<TabKey>('projets');
  const [bidLeadId, setBidLeadId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bidSuccess, setBidSuccess] = useState(false);

  // Tabs: entrepreneurs see all 3 tabs, everyone else sees only "Appels d'offres"
  const visibleTabs = isEntrepreneur ? ALL_TABS : ALL_TABS.filter((t) => t.key === 'projets');

  // Apply client-side "Mes zones" filter when region sentinel is active.
  // Exact FSA-based mapping: first 1-3 chars of a Québec postal code identify the
  // region unambiguously. We build the set of FSA prefixes that match the
  // entrepreneur's declared zones (accent-insensitive) and filter leads whose
  // postal code starts with *any* matching prefix, using longest-match-first so
  // narrower prefixes (e.g. "j1" for Sherbrooke) win over broader ones ("j").
  const displayedLeads = useMemo(() => {
    if (filters.region !== '__mine__' || !entrepreneur?.zonesDesservies) return leads;

    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const zoneText = normalize(entrepreneur.zonesDesservies);

    // Québec FSA prefix → region-keyword mapping. Prefixes are mutually exclusive
    // when matched with longest-first semantics (J1 wins over J).
    const POSTAL_TO_REGIONS: { prefix: string; keywords: string[] }[] = [
      { prefix: 'h', keywords: ['montreal', 'laval'] },
      // Sherbrooke / Estrie : narrower prefix, must be tried BEFORE 'j'.
      { prefix: 'j1', keywords: ['sherbrooke', 'estrie', 'cantons'] },
      { prefix: 'j', keywords: ['monteregie', 'laurentides', 'lanaudiere', 'rive-sud', 'longueuil'] },
      // Outaouais/Gatineau : Québec side starts with J8-J9, Ontario side with K.
      { prefix: 'j8', keywords: ['outaouais', 'gatineau'] },
      { prefix: 'j9', keywords: ['outaouais', 'gatineau'] },
      { prefix: 'k', keywords: ['outaouais', 'gatineau'] },
      { prefix: 'g', keywords: ['quebec', 'mauricie', 'saguenay', 'lac-saint-jean', 'bas-saint-laurent', 'gaspesie', 'cote-nord', 'chaudiere', 'appalaches', 'trois-rivieres'] },
    ];

    const matchingPrefixes = POSTAL_TO_REGIONS.filter((entry) =>
      entry.keywords.some((kw) => zoneText.includes(kw)),
    ).map((entry) => entry.prefix);

    if (matchingPrefixes.length === 0) {
      // No known region keyword detected → show all leads (avoid emptying the list).
      return leads;
    }

    // Longest prefix first so that a lead in Sherbrooke (J1H) is attributed to
    // the 'j1' bucket rather than the broader 'j' (Montérégie) bucket.
    const sortedPrefixes = [...matchingPrefixes].sort((a, b) => b.length - a.length);

    return leads.filter((lead) => {
      if (!lead.codePostal) return false;
      const cp = normalize(lead.codePostal).replace(/\s/g, '');

      // Find the longest prefix in our whole map that matches this CP.
      const allPrefixesLongestFirst = POSTAL_TO_REGIONS
        .map((e) => e.prefix)
        .sort((a, b) => b.length - a.length);
      const winningPrefix = allPrefixesLongestFirst.find((p) => cp.startsWith(p));

      // Include the lead only if the winning prefix is one of the entrepreneur's
      // declared prefixes (i.e. the lead genuinely belongs to one of his regions).
      return !!winningPrefix && sortedPrefixes.includes(winningPrefix);
    });
  }, [leads, filters.region, entrepreneur?.zonesDesservies]);

  // Always fetch leads when on the "projets" tab (public)
  useEffect(() => {
    if (activeTab === 'projets') {
      fetchLeads(1);
    }
  }, [activeTab, fetchLeads]);

  // Fetch soumissions only for entrepreneurs
  useEffect(() => {
    if (isEntrepreneur && activeTab === 'soumissions') {
      fetchMySoumissions();
    }
  }, [isEntrepreneur, activeTab, fetchMySoumissions]);

  // Handle bid submission
  async function handleSubmitBid(data: SoumissionCreate) {
    setIsSubmitting(true);
    try {
      await submitSoumission(data);
      setBidSuccess(true);
      toast.success('Soumission envoyée', {
        description: 'Le client a été notifié. Vous recevrez une réponse sur cette plateforme.',
      });
      try {
        localStorage.removeItem(`seaop_soumission_draft_${data.leadId}`);
      } catch {
        // ignore
      }
      // Show success message for 2 seconds, then close the modal
      setTimeout(() => {
        setBidSuccess(false);
        setBidLeadId(null);
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\u2019envoi';
      toast.error('Soumission impossible', { description: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Close modal handler — also resets success state
  function handleCloseModal() {
    setBidSuccess(false);
    setBidLeadId(null);
  }

  // Find the lead being bid on (for the modal title)
  const bidLead = bidLeadId !== null ? leads.find((l) => l.id === bidLeadId) : null;

  const nomEntreprise = entrepreneur?.nomEntreprise ?? user?.displayName;
  const evaluationsMoyenne = entrepreneur?.evaluationsMoyenne ?? null;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {isEntrepreneur ? `Bienvenue, ${nomEntreprise}` : 'Appels d’offres'}
          </h1>
          {!isEntrepreneur && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Parcourez les projets de construction publiés au Québec
            </p>
          )}
        </div>
        {!isAuthenticated && (
          <Link
            to="/nouveau-projet"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-seaop-primary-600 text-white text-sm font-medium hover:bg-seaop-primary-700 transition-colors dark:bg-seaop-primary-500 dark:hover:bg-seaop-primary-600"
          >
            <FilePlus className="h-4 w-4" />
            Déposer un projet
          </Link>
        )}
      </div>

      {/* Stats Row — entrepreneurs only */}
      {isEntrepreneur && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard
            label="Projets disponibles"
            value={leads.length || '--'}
            icon={<Briefcase className="h-5 w-5" />}
          />
          <StatCard
            label="Mes soumissions"
            value={mySoumissions.length || '--'}
            icon={<FileText className="h-5 w-5" />}
          />
          <StatCard
            label="Évaluation moyenne"
            value={evaluationsMoyenne !== null ? `${(evaluationsMoyenne ?? 0).toFixed(1)} / 5` : '--'}
            icon={<Star className="h-5 w-5" />}
          />
        </div>
      )}

      {/* Tab Navigation — show tabs only when entrepreneur has multiple tabs */}
      {visibleTabs.length > 1 && (
      <div className="flex overflow-x-auto sm:flex-wrap gap-2 pb-2 sm:pb-0 scrollbar-hide rounded-lg bg-gray-100 dark:bg-gray-800 p-1 snap-x snap-mandatory">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap flex-shrink-0 sm:flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 snap-start min-h-[44px] ${
              activeTab === tab.key
                ? 'bg-white dark:bg-gray-700 text-seaop-primary-600 dark:text-seaop-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      )}

      {/* ===== Tab: Appels d'offres (public) ===== */}
      {activeTab === 'projets' && (
        <div className="space-y-6">
          {/* Filters */}
          <LeadFilters
            filters={filters}
            entrepreneurZones={entrepreneur?.zonesDesservies ?? null}
            onFilterChange={(key, value) => setFilter(key as 'typeProjet' | 'recherche' | 'trierPar' | 'region', value)}
          />

          {/* Loading */}
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : displayedLeads.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {displayedLeads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  showBidButton={isEntrepreneur}
                  onSubmitBid={(id) => setBidLeadId(id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FolderOpen className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
              {filters.region === '__mine__' && leads.length > 0 ? (
                // "Mes zones" is active and filtered everything out — help the user.
                <>
                  <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
                    Aucun projet dans vos zones desservies
                  </p>
                  <p className="mt-2 text-sm text-gray-400 dark:text-gray-500 max-w-md">
                    Il y a {leads.length} projet{leads.length > 1 ? 's' : ''} disponible{leads.length > 1 ? 's' : ''} hors de vos zones.
                    Désactivez le filtre <strong>&laquo;&nbsp;Mes zones desservies&nbsp;&raquo;</strong> pour les voir,
                    ou élargissez vos zones dans votre profil.
                  </p>
                  <button
                    type="button"
                    onClick={() => setFilter('region', '')}
                    className="mt-4 inline-flex items-center gap-2 rounded-md bg-seaop-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-seaop-primary-700 dark:bg-seaop-primary-500 dark:hover:bg-seaop-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-seaop-primary-500"
                  >
                    Afficher tous les projets
                  </button>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
                    Aucun projet disponible pour le moment
                  </p>
                  <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
                    Revenez bientôt pour découvrir de nouveaux appels d&apos;offres.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== Tab: Mes soumissions ===== */}
      {activeTab === 'soumissions' && (
        <div className="space-y-4">
          {soumissionError && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
              {soumissionError}
            </div>
          )}
          <SoumissionList
            soumissions={mySoumissions}
            isLoading={isLoadingMySoumissions}
          />
        </div>
      )}

      {/* ===== Tab: Mon profil ===== */}
      {activeTab === 'profil' && (
        <div className="max-w-2xl w-full">
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Profil entrepreneur
            </h2>

            {entrepreneur ? (
              <dl className="space-y-3">
                <ProfileField label="Entreprise" value={entrepreneur.nomEntreprise} />
                <ProfileField label="Contact" value={entrepreneur.nomContact} />
                <ProfileField label="Courriel" value={entrepreneur.email} />
                <ProfileField label="Téléphone" value={entrepreneur.telephone} />
                <ProfileField label="Numéro RBQ" value={entrepreneur.numeroRbq} />
                <ProfileField label="Zones desservies" value={entrepreneur.zonesDesservies} />
                <ProfileField label="Types de projets" value={entrepreneur.typesProjets} />
                <ProfileField label="Certifications" value={entrepreneur.certifications} />
                <ProfileField label="Abonnement" value={entrepreneur.abonnement} />
                <ProfileField label="Statut" value={entrepreneur.statut} />
                <ProfileField
                  label="Évaluation"
                  value={
                    entrepreneur.evaluationsMoyenne !== null
                      ? `${(entrepreneur.evaluationsMoyenne ?? 0).toFixed(1)} / 5 (${entrepreneur.nombreEvaluations ?? 0} avis)`
                      : null
                  }
                />
                <ProfileField
                  label="Date d'inscription"
                  value={entrepreneur.dateInscription}
                />
              </dl>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">
                Informations de profil non disponibles.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ===== Bid Form Modal ===== */}
      <Modal
        isOpen={bidLeadId !== null}
        onClose={handleCloseModal}
        title={
          bidLead
            ? `Soumettre une proposition — ${bidLead.typeProjet}${bidLead.numeroReference ? ` (${bidLead.numeroReference})` : ''}`
            : 'Soumettre une proposition'
        }
        size="xl"
      >
        {bidSuccess ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <Alert type="success" title="Soumission envoyée avec succès!">
              Votre proposition a été soumise. Vous pouvez suivre son statut dans l&apos;onglet
              «&nbsp;Mes soumissions&nbsp;».
            </Alert>
          </div>
        ) : bidLeadId !== null ? (
          <SoumissionForm
            leadId={bidLeadId}
            onSubmit={handleSubmitBid}
            isLoading={isSubmitting}
          />
        ) : null}
      </Modal>
    </div>
  );
}

/** Read-only profile field */
function ProfileField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 sm:w-40 shrink-0">
        {label}
      </dt>
      <dd className="text-sm text-gray-900 dark:text-gray-100">
        {value || <span className="text-gray-400 dark:text-gray-500">--</span>}
      </dd>
    </div>
  );
}
