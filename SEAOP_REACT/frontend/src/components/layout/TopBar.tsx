/**
 * SEAOP React Frontend - Top Navigation Bar
 * D365-style navy topbar (#002050) matching ERP React visual identity.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
  Menu,
  Sun,
  Moon,
  LogOut,
  User,
  ChevronDown,
  LogIn,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useThemeStore } from '@/store/useThemeStore';
import { usePageTitle } from '@/hooks/usePageTitle';
import NotificationBell from '@/components/notifications/NotificationBell';

// ============ Route titles ============

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Accueil',
  '/nouveau-projet': 'Déposer un projet',
  '/appels-offres': 'Appels d\u2019offres',
  '/mes-projets': 'Mes projets',
  '/chat-room': 'Chat Room',
  '/notifications': 'Notifications',
  '/services/estimation': 'Demande d\'estimation',
  '/administration': 'Administration',
  '/login': 'Connexion',
  '/register': 'Inscription entrepreneur',
};

function getPageTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const prefix = Object.keys(ROUTE_TITLES)
    .filter((k) => k !== '/' && pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? ROUTE_TITLES[prefix] : 'SEAOP';
}

// ============ Component ============

export default function TopBar() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const location = useLocation();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleSidebar = useCallback(() => {
    window.dispatchEvent(new Event('toggle-sidebar'));
  }, []);

  const handleLogout = useCallback(async () => {
    setUserMenuOpen(false);
    await logout();
  }, [logout]);

  const pageTitle = getPageTitle(location.pathname);

  // Sync the browser tab title with the current page
  usePageTitle(pageTitle === 'SEAOP' ? null : pageTitle);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 sm:gap-4 bg-[#002050] text-white px-3 sm:px-6 w-full min-w-0">
      {/* Left: Hamburger (mobile only) */}
      <button
        type="button"
        onClick={toggleSidebar}
        className="shrink-0 rounded-md p-2 text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
        aria-label="Ouvrir le menu"
      >
        <Menu size={20} />
      </button>

      {/* Center: Page title */}
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
        {pageTitle}
      </h2>

      {/* Right section */}
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        {/* Notification bell */}
        <NotificationBell />

        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md p-2 text-white/60 hover:bg-white/10 hover:text-white"
          aria-label={isDark ? 'Activer le mode clair' : 'Activer le mode sombre'}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* User menu / Login button */}
        {isAuthenticated && user ? (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setUserMenuOpen((o) => !o)}
              className={clsx(
                'flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                userMenuOpen
                  ? 'bg-white/15 text-white'
                  : 'text-white/80 hover:bg-white/10 hover:text-white',
              )}
            >
              <User size={16} />
              <span className="hidden sm:inline max-w-[140px] truncate">
                {user.displayName}
              </span>
              <ChevronDown
                size={14}
                className={clsx(
                  'transition-transform',
                  userMenuOpen && 'rotate-180',
                )}
              />
            </button>

            {/* Dropdown */}
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 origin-top-right rounded border border-[#edebe9] bg-white shadow-lg dark:border-[#3b3a39] dark:bg-[#292827]">
                <div className="border-b border-[#f3f2f1] dark:border-[#3b3a39] px-4 py-3">
                  <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1] truncate">
                    {user.displayName}
                  </p>
                  <p className="text-xs text-[#605e5c] dark:text-[#a19f9d] truncate">
                    {user.email}
                  </p>
                </div>
                <div className="py-1">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <LogOut size={16} />
                    Se déconnecter
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Link
            to="/login"
            className="flex shrink-0 items-center gap-2 rounded bg-white/15 px-3 sm:px-4 py-1.5 text-sm font-medium text-white hover:bg-white/25 transition-colors"
            aria-label="Connexion"
          >
            <LogIn size={16} />
            <span className="hidden sm:inline">Connexion</span>
          </Link>
        )}
      </div>
    </header>
  );
}
