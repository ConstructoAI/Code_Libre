/**
 * ERP React Frontend - Placeholder Page
 * Used for modules not yet migrated.
 */

import { useLocation, Link } from 'react-router-dom';
import { Construction, ArrowLeft } from 'lucide-react';

const MODULE_NAMES: Record<string, string> = {
  '/suivi': 'Suivi des travaux',
  '/dossiers': 'Dossiers',
  '/contacts': 'Contacts',
  '/ventes': 'Ventes / CRM',
  '/magasin': 'Magasin / Achats',
  '/bons-travail': 'Bons de travail',
  '/pointage': 'Pointage',
  '/meteo': 'Météo chantier',
  '/conformite': 'Conformité RBQ/CCQ',
  '/subventions': 'Subventions',
  '/immobilier': 'Immobilier',
  '/logistique': 'Logistique',
  '/location': 'Location équipement',
  '/maintenance': 'Maintenance',
  '/emails': 'Courriels',
  '/messagerie': 'Messagerie interne',
  '/assistant-ia': 'Assistant IA',
  '/calculateurs': 'Calculateurs construction',
  '/web': 'Outils web',
  '/b2b': 'Portail B2B',
};

export default function PlaceholderPage() {
  const location = useLocation();
  const moduleName =
    MODULE_NAMES[location.pathname] ||
    location.pathname.replace('/', '').replace(/-/g, ' ');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <Construction size={64} className="text-gray-300 dark:text-gray-600 mb-4" />
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white capitalize">
        {moduleName || 'Module'}
      </h2>
      <p className="mt-2 text-gray-500 dark:text-gray-400">
        Ce module sera disponible dans une prochaine phase.
      </p>
      <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
        Phase 2 — En cours de développement
      </p>
      <Link
        to="/dashboard"
        className="mt-6 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
      >
        <ArrowLeft size={14} /> Retour au tableau de bord
      </Link>
    </div>
  );
}
