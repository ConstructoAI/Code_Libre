import React, { useMemo, useState } from 'react';
import { Search, RotateCcw, ChevronDown, SlidersHorizontal, MapPin } from 'lucide-react';
import clsx from 'clsx';

import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { TYPES_PROJETS } from '@/utils/constants';
import { useAuthStore } from '@/store/useAuthStore';

interface Props {
  onFilterChange: (key: string, value: string) => void;
  filters: { typeProjet: string; recherche: string; trierPar: string; region: string };
  entrepreneurZones?: string | null;
}

const typeProjetOptions = [
  { value: '', label: 'Tous les types' },
  ...TYPES_PROJETS.map((t) => ({ value: t, label: t })),
];

const REGIONS_QUEBEC = [
  { value: '', label: 'Toutes les régions' },
  { value: 'montreal', label: 'Montréal' },
  { value: 'laval', label: 'Laval' },
  { value: 'longueuil', label: 'Rive-Sud (Longueuil)' },
  { value: 'quebec', label: 'Québec' },
  { value: 'gatineau', label: 'Gatineau / Outaouais' },
  { value: 'sherbrooke', label: 'Sherbrooke / Estrie' },
  { value: 'trois-rivieres', label: 'Trois-Rivières / Mauricie' },
  { value: 'saguenay', label: 'Saguenay / Lac-Saint-Jean' },
  { value: 'laurentides', label: 'Laurentides' },
  { value: 'lanaudiere', label: 'Lanaudière' },
  { value: 'monteregie', label: 'Montérégie' },
  { value: 'chaudiere-appalaches', label: 'Chaudière-Appalaches' },
  { value: 'bas-saint-laurent', label: 'Bas-Saint-Laurent' },
  { value: 'abitibi', label: 'Abitibi-Témiscamingue' },
  { value: 'cote-nord', label: 'Côte-Nord' },
  { value: 'gaspesie', label: 'Gaspésie / Îles-de-la-Madeleine' },
  { value: 'nord-du-quebec', label: 'Nord-du-Québec' },
  { value: 'centre-du-quebec', label: 'Centre-du-Québec' },
];

const trierParOptions = [
  { value: '', label: 'Trier par...' },
  { value: 'date_desc', label: 'Date (récent)' },
  { value: 'date_asc', label: 'Date (ancien)' },
  { value: 'soumissions_desc', label: 'Soumissions (plus)' },
  { value: 'soumissions_asc', label: 'Soumissions (moins)' },
  { value: 'urgence', label: 'Urgence' },
];

const LeadFilters: React.FC<Props> = ({ onFilterChange, filters, entrepreneurZones }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isEntrepreneur = user?.userType === 'entrepreneur';

  // Parse entrepreneur's zones into region slug matches
  const myZoneSlugs = useMemo(() => {
    if (!entrepreneurZones) return [] as string[];
    const text = entrepreneurZones.toLowerCase();
    return REGIONS_QUEBEC
      .filter((r) => r.value !== '')
      .filter((r) => text.includes(r.value) || text.includes(r.label.toLowerCase().split(/[\/\s]/)[0]))
      .map((r) => r.value);
  }, [entrepreneurZones]);

  const myZonesApplied = filters.region === '__mine__';
  const canUseMyZones = isEntrepreneur && myZoneSlugs.length > 0;

  const hasActiveFilters =
    filters.typeProjet !== '' || filters.recherche !== '' || filters.trierPar !== '' || filters.region !== '';

  function handleReset() {
    onFilterChange('typeProjet', '');
    onFilterChange('recherche', '');
    onFilterChange('trierPar', '');
    onFilterChange('region', '');
  }

  function toggleMyZones() {
    if (myZonesApplied) {
      onFilterChange('region', '');
    } else {
      onFilterChange('region', '__mine__');
    }
  }

  return (
    <div>
      {/* Mobile toggle button - visible only below sm */}
      <button
        type="button"
        onClick={() => setMobileOpen((prev) => !prev)}
        className="flex sm:hidden items-center justify-between w-full px-4 py-3 mb-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filtres
          {hasActiveFilters && (
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-seaop-primary-600 text-white text-xs font-bold">
              !
            </span>
          )}
        </span>
        <ChevronDown
          className={clsx(
            'h-4 w-4 transition-transform duration-200',
            mobileOpen && 'rotate-180',
          )}
        />
      </button>

      {/* "Mes zones" quick filter for entrepreneurs */}
      {canUseMyZones && (
        <div
          className={clsx(
            'mb-3 flex items-center gap-2',
            // On sm+ always flex; on mobile toggle with filters
            'sm:flex',
            mobileOpen ? 'flex' : 'hidden sm:flex',
          )}
        >
          <button
            type="button"
            onClick={toggleMyZones}
            className={clsx(
              'inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-colors min-h-[40px]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-seaop-primary-500',
              myZonesApplied
                ? 'bg-seaop-primary-600 text-white hover:bg-seaop-primary-700 dark:bg-seaop-primary-500'
                : 'bg-seaop-primary-50 text-seaop-primary-700 hover:bg-seaop-primary-100 dark:bg-seaop-primary-900/20 dark:text-seaop-primary-300 dark:hover:bg-seaop-primary-900/40',
            )}
          >
            <MapPin className="h-4 w-4" />
            {myZonesApplied ? '✓ Mes zones desservies' : 'Mes zones desservies'}
          </button>
          {myZonesApplied && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {myZoneSlugs.length} région{myZoneSlugs.length > 1 ? 's' : ''} active{myZoneSlugs.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Filter controls - hidden on mobile by default, always visible on sm+ */}
      <div
        className={clsx(
          'flex-wrap items-end gap-3',
          // On sm+ always flex; on mobile toggle
          'sm:flex',
          mobileOpen ? 'flex' : 'hidden',
        )}
      >
        {/* Search Input */}
        <div className="w-full sm:flex-1 sm:min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={filters.recherche}
              onChange={(e) => onFilterChange('recherche', e.target.value)}
              className={
                'block w-full rounded-lg border px-3 py-2 pl-9 text-base sm:text-sm transition-colors duration-150 ' +
                'bg-white dark:bg-gray-800 ' +
                'text-gray-900 dark:text-gray-100 ' +
                'placeholder:text-gray-400 dark:placeholder:text-gray-500 ' +
                'border-gray-300 dark:border-gray-600 ' +
                'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500'
              }
            />
          </div>
        </div>

        {/* Type de Projet */}
        <div className="w-full sm:flex-1 sm:min-w-[200px]">
          <Select
            options={typeProjetOptions}
            value={filters.typeProjet}
            onChange={(e) => onFilterChange('typeProjet', e.target.value)}
            placeholder="Type de projet"
          />
        </div>

        {/* Région */}
        <div className="w-full sm:flex-1 sm:min-w-[200px]">
          <Select
            options={REGIONS_QUEBEC}
            value={myZonesApplied ? '' : filters.region}
            onChange={(e) => onFilterChange('region', e.target.value)}
            placeholder={myZonesApplied ? 'Filtre "Mes zones" actif' : 'Région'}
            disabled={myZonesApplied}
          />
        </div>

        {/* Trier par */}
        <div className="w-full sm:flex-1 sm:min-w-[200px]">
          <Select
            options={trierParOptions}
            value={filters.trierPar}
            onChange={(e) => onFilterChange('trierPar', e.target.value)}
            placeholder="Trier par..."
          />
        </div>

        {/* Reset */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            leftIcon={<RotateCcw className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            Réinitialiser
          </Button>
        )}
      </div>
    </div>
  );
};

LeadFilters.displayName = 'LeadFilters';

export { LeadFilters };
export type { Props as LeadFiltersProps };
