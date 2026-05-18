/**
 * D365-style Breadcrumbs — shows current route path.
 */

import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Tableau de Bord',
  analyses: 'Analyses',
  suivi: 'Suivi',
  dossiers: 'Dossiers',
  entreprises: 'Entreprises',
  contacts: 'Contacts',
  ventes: 'Ventes',
  devis: 'Soumissions',
  projets: 'Projets',
  magasin: 'Magasin',
  employes: 'Employés',
  'bons-travail': 'Bons de Travail',
  pointage: 'Pointage',
  comptabilite: 'Comptabilité',
  meteo: 'Météo Chantier',
  conformite: 'Conformité RBQ/CCQ',
  subventions: 'Subventions',
  immobilier: 'Immobilier',
  logistique: 'Logistique',
  location: 'Location',
  maintenance: 'Maintenance',
  emails: 'Emails',
  messagerie: 'Messagerie',
  'assistant-ia': 'Assistant IA',
  calculateurs: 'Calculateurs',
  web: 'Web',
  configuration: 'Configuration',
  admin: 'Administration',
  b2b: 'Portail B2B',
};

export function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav className="hidden sm:flex items-center gap-1 text-[12px] text-[#605e5c] dark:text-[#a19f9d] mb-3 overflow-x-auto scrollbar-hide">
      <Link
        to="/dashboard"
        className="flex items-center gap-1 hover:text-[#0078D4] dark:hover:text-[#6cb8f6] transition-colors shrink-0 py-1"
      >
        <Home size={12} />
        <span>Accueil</span>
      </Link>
      {segments.map((segment, i) => {
        const path = '/' + segments.slice(0, i + 1).join('/');
        const label = ROUTE_LABELS[segment] || segment;
        const isLast = i === segments.length - 1;

        return (
          <span key={path} className="flex items-center gap-1 shrink-0">
            <ChevronRight size={11} className="text-[#a19f9d]" />
            {isLast ? (
              <span className="text-[#323130] dark:text-[#f3f2f1] font-semibold">{label}</span>
            ) : (
              <Link to={path} className="hover:text-[#0078D4] dark:hover:text-[#6cb8f6] transition-colors">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
