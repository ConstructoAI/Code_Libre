/**
 * SEAOP React Frontend - 404 Not Found Page
 * D365-themed design with helpful navigation suggestions.
 */

import { Link } from 'react-router-dom';
import { Home, Briefcase, HardHat, ArrowLeft } from 'lucide-react';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function NotFoundPage() {
  usePageTitle('Page non trouvée');
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      {/* Large 404 indicator */}
      <div className="relative mb-6">
        <h1 className="text-8xl md:text-9xl font-extrabold text-seaop-primary-100 dark:text-seaop-primary-900/40 select-none">
          404
        </h1>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-seaop-primary-600 dark:text-seaop-primary-400">
            Page non trouvée
          </span>
        </div>
      </div>

      <p className="max-w-md text-gray-600 dark:text-gray-400 mb-8">
        La page que vous cherchez n&apos;existe pas ou a été déplacée.
        Voici quelques liens utiles pour vous aider :
      </p>

      {/* Suggestion cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl mb-8">
        <Link
          to="/"
          className="flex flex-col items-center gap-2 p-5 rounded-xl border border-gray-200 bg-white shadow-sm hover:border-seaop-primary-400 hover:shadow-md transition-all duration-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-seaop-primary-500"
        >
          <Home className="h-6 w-6 text-seaop-primary-600 dark:text-seaop-primary-400" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Accueil</span>
        </Link>
        <Link
          to="/nouveau-projet"
          className="flex flex-col items-center gap-2 p-5 rounded-xl border border-gray-200 bg-white shadow-sm hover:border-seaop-primary-400 hover:shadow-md transition-all duration-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-seaop-primary-500"
        >
          <Briefcase className="h-6 w-6 text-seaop-primary-600 dark:text-seaop-primary-400" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Déposer un projet</span>
        </Link>
        <Link
          to="/appels-offres"
          className="flex flex-col items-center gap-2 p-5 rounded-xl border border-gray-200 bg-white shadow-sm hover:border-seaop-primary-400 hover:shadow-md transition-all duration-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-seaop-primary-500"
        >
          <HardHat className="h-6 w-6 text-seaop-primary-600 dark:text-seaop-primary-400" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Appels d'offres</span>
        </Link>
      </div>

      {/* Back link */}
      <button
        type="button"
        onClick={() => window.history.back()}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-seaop-primary-600 dark:text-gray-400 dark:hover:text-seaop-primary-400 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour à la page précédente
      </button>
    </div>
  );
}
