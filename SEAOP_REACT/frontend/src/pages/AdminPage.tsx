/**
 * SEAOP React Frontend - Admin Dashboard Page
 * Tabbed interface: Overview | Entrepreneurs | Soumissions | Services
 */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { LayoutDashboard, Users, FileText, Wrench } from 'lucide-react';
import DashboardStats from '@/components/admin/DashboardStats';
import EntrepreneurTable from '@/components/admin/EntrepreneurTable';
import SoumissionTable from '@/components/admin/SoumissionTable';
import ServiceTabs from '@/components/admin/ServiceTabs';

// ============ Tab Configuration ============

interface TabConfig {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabConfig[] = [
  { key: 'overview', label: "Vue d'ensemble", icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'entrepreneurs', label: 'Entrepreneurs', icon: <Users className="h-4 w-4" /> },
  { key: 'soumissions', label: 'Soumissions', icon: <FileText className="h-4 w-4" /> },
  { key: 'services', label: 'Services', icon: <Wrench className="h-4 w-4" /> },
];

// ============ Component ============

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(
    () => new Set(['overview']),
  );

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.key === activeTab);
    if (idx < 0) return;
    const next =
      e.key === 'ArrowRight'
        ? TABS[(idx + 1) % TABS.length]
        : TABS[(idx - 1 + TABS.length) % TABS.length];
    setActiveTab(next.key);
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Administration
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Tableau de bord et gestion de la plateforme SEAOP
        </p>
      </div>

      {/* Tab Navigation */}
      <div
        role="tablist"
        aria-label="Onglets du tableau de bord administratif"
        className={clsx(
          'flex border-b overflow-x-auto snap-x snap-mandatory scrollbar-hide',
          'border-gray-200 dark:border-gray-700',
        )}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              type="button"
              id={`tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={handleTabKeyDown}
              className={clsx(
                'flex items-center gap-2 px-4 sm:px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 snap-start shrink-0',
                '-mb-px border-b-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-seaop-primary-500 focus-visible:ring-inset',
                isActive
                  ? 'border-seaop-primary-500 text-seaop-primary-600 dark:text-seaop-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content — lazy mount + preserve state via hidden */}
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        if (!visitedTabs.has(tab.key)) return null;
        return (
          <div
            key={tab.key}
            role="tabpanel"
            id={`tabpanel-${tab.key}`}
            aria-labelledby={`tab-${tab.key}`}
            hidden={!isActive}
          >
            {tab.key === 'overview' && <DashboardStats />}
            {tab.key === 'entrepreneurs' && <EntrepreneurTable />}
            {tab.key === 'soumissions' && <SoumissionTable />}
            {tab.key === 'services' && <ServiceTabs />}
          </div>
        );
      })}
    </div>
  );
}
