/**
 * ERP React Frontend - TopBar
 * D365-style dark navy header with search, dark mode toggle, user menu.
 */

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Sun, Moon, LogOut, ChevronDown, Search, Bell, Settings } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useThemeStore } from '@/store/useThemeStore';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Tableau de Bord',
  '/analyses': 'Analyses',
  '/suivi': 'Suivi',
  '/dossiers': 'Dossiers',
  '/entreprises': 'Entreprises',
  '/contacts': 'Contacts',
  '/ventes': 'Ventes',
  '/devis': 'Soumissions',
  '/projets': 'Projets',
  '/magasin': 'Magasin',
  '/employes': 'Employés',
  '/bons-travail': 'Bons de Travail',
  '/pointage': 'Pointage',
  '/comptabilite': 'Comptabilité',
  '/meteo': 'Météo Chantier',
  '/conformite': 'Conformité RBQ/CCQ',
  '/subventions': 'Subventions',
  '/immobilier': 'Immobilier',
  '/logistique': 'Logistique',
  '/location': 'Location',
  '/maintenance': 'Maintenance',
  '/emails': 'Emails',
  '/messagerie': 'Messagerie',
  '/assistant-ia': 'Assistant IA',
  '/calculateurs': 'Calculateurs',
  '/web': 'Web',
  '/b2b': 'Portail B2B',
  '/configuration': 'Configuration',
  '/admin': 'Administration',
};

export default function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, tenant, logout } = useAuthStore();
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const pageTitle = ROUTE_TITLES[location.pathname] || 'Constructo AI ERP';

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <header className="erp-topbar text-white sticky top-0 z-30 flex items-center justify-between px-2 sm:px-4 h-12 sm:h-14">
      {/* Left: hamburger + app name + page title */}
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
        <button
          className="lg:hidden p-2.5 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          onClick={() => window.dispatchEvent(new Event('toggle-sidebar'))}
          aria-label="Toggle sidebar"
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <img src="/logo.png" alt="Constructo AI" className="h-6 w-6 object-contain brightness-0 invert opacity-90 shrink-0" />
          <span className="text-sm font-semibold text-white/90 hidden sm:inline shrink-0">Constructo AI</span>
          <span className="text-white/30 hidden sm:inline shrink-0">|</span>
          <span className="text-xs sm:text-sm font-medium text-white/80 truncate">{pageTitle}</span>
        </div>
      </div>

      {/* Right: search + actions + user */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {/* Search (desktop) */}
        <div className="hidden lg:flex items-center bg-white/10 rounded px-2.5 py-1 mr-2 hover:bg-white/15 transition-colors">
          <Search size={14} className="text-white/50 mr-1.5" />
          <input
            type="text"
            placeholder="Rechercher..."
            className="bg-transparent border-none outline-none text-sm text-white/90 placeholder-white/40 w-40 xl:w-56"
          />
        </div>

        {/* Notifications */}
        <button className="p-2.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors relative min-h-[44px] min-w-[44px] flex items-center justify-center">
          <Bell size={18} />
        </button>

        {/* Settings - hidden on very small screens */}
        <button
          onClick={() => navigate('/configuration')}
          className="hidden sm:flex p-2.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Settings size={18} />
        </button>

        {/* Dark mode toggle */}
        <button
          onClick={toggleTheme}
          className="p-2.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label={isDark ? 'Mode clair' : 'Mode sombre'}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* User menu */}
        {isAuthenticated && user ? (
          <div className="relative ml-1">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded text-sm text-white/80 hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-[#0078D4] flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-white/20">
                {user.displayName?.[0]?.toUpperCase() || 'U'}
              </div>
              <span className="hidden lg:inline max-w-[100px] truncate text-white/80">{user.displayName}</span>
              <ChevronDown size={12} className="text-white/50" />
            </button>

            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div className="absolute right-0 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#292827] shadow-lg z-50 py-1">
                  <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {user.displayName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {user.email}
                    </p>
                    {tenant && (
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 truncate">
                        {tenant.entrepriseNom}
                      </p>
                    )}
                    {user.role && (
                      <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] rounded bg-[#deecf9] text-[#005ea2] dark:bg-[#0078D4]/20 dark:text-[#6cb8f6] font-semibold">
                        {user.role}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <LogOut size={14} />
                    Déconnexion
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => navigate('/login')}
            className="ml-2 px-4 py-1.5 text-sm font-semibold text-white bg-[#0078D4] hover:bg-[#005ea2] rounded transition-colors"
          >
            Connexion
          </button>
        )}
      </div>
    </header>
  );
}
