/**
 * SEAOP React Frontend - Accueil (Home) Page
 * Landing page mirroring the Streamlit page_accueil().
 * Hero section, stats row, recent projects grid.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Briefcase,
  HardHat,
  FileText,
  ShieldCheck,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';

import { useLeadStore } from '@/store/useLeadStore';
import { LeadCard } from '@/components/leads/LeadCard';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import StatCard from '@/components/common/StatCard';

const MAX_RECENT_LEADS = 6;

export default function AccueilPage() {
  const { leads, isLoading, fetchLeads } = useLeadStore();
  const location = useLocation();
  const [successMsg, setSuccessMsg] = useState<string | null>(
    (location.state as { successMessage?: string } | null)?.successMessage ?? null,
  );

  useEffect(() => {
    fetchLeads(1);
  }, [fetchLeads]);

  // Clear router state so message doesn't persist on refresh
  useEffect(() => {
    if (successMsg) {
      window.history.replaceState({}, document.title);
    }
  }, [successMsg]);

  const recentLeads = leads.slice(0, MAX_RECENT_LEADS);

  return (
    <div className="space-y-12">
      {successMsg && (
        <Alert type="success" onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}
      {/* ===== Hero Section ===== */}
      <section className="text-center py-8 sm:py-12 px-2 sm:px-4">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          SEAOP
        </h1>
        <p className="mt-3 text-base sm:text-lg md:text-xl font-medium text-seaop-primary-600 dark:text-seaop-primary-400 break-words">
          Système Électronique d&apos;Appel d&apos;Offres Public
        </p>
        <p className="mt-4 max-w-2xl mx-auto text-sm sm:text-base text-gray-600 dark:text-gray-400">
          Plateforme gratuite de mise en relation entre donneurs d&apos;ouvrage
          et entrepreneurs de la construction au Québec
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 max-w-md sm:max-w-none mx-auto">
          <Link
            to="/nouveau-projet"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-seaop-primary-600 text-white font-medium hover:bg-seaop-primary-700 transition-colors duration-200 dark:bg-seaop-primary-500 dark:hover:bg-seaop-primary-600"
          >
            <Briefcase className="h-5 w-5" />
            Déposer un projet
          </Link>
          <Link
            to="/appels-offres"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-100 transition-colors duration-200 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <FileText className="h-5 w-5" />
            Voir les appels d&apos;offres
          </Link>
        </div>
      </section>

      {/* ===== Stats Row ===== */}
      <section>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Projets actifs"
            value={isLoading ? '...' : leads.length}
            icon={<Briefcase className="h-5 w-5" />}
          />
          <StatCard
            label="Entrepreneurs"
            value="Nouveau"
            icon={<HardHat className="h-5 w-5" />}
          />
          <StatCard
            label="Soumissions"
            value="Nouveau"
            icon={<FileText className="h-5 w-5" />}
          />
          <StatCard
            label="Taux conformité"
            value="Nouveau"
            icon={<ShieldCheck className="h-5 w-5" />}
          />
        </div>
      </section>

      {/* ===== Recent Projects Section ===== */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Projets récents
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : recentLeads.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {recentLeads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
              Aucun projet publié pour le moment
            </p>
            <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
              Soyez le premier à publier un appel d&apos;offres!
            </p>
            <Link
              to="/nouveau-projet"
              className="mt-4 inline-flex items-center gap-2 text-seaop-primary-600 hover:underline dark:text-seaop-primary-400"
            >
              <Briefcase className="h-4 w-4" />
              Déposer un projet
            </Link>
          </div>
        )}

        {/* "Voir tous les projets" link */}
        {recentLeads.length > 0 && (
          <div className="mt-8 text-center">
            <Link
              to="/appels-offres"
              className="inline-flex items-center gap-2 text-seaop-primary-600 font-medium hover:underline dark:text-seaop-primary-400"
            >
              Voir tous les appels d&apos;offres
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
