import React, { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useMessagesStore } from '@/store/useMessagesStore';
import {
  Home,
  Clock,
  MessageSquare,
  FolderOpen,
  Menu,
  LogOut,
  Moon,
  Sun,
  Bot,
  Users,
  CloudSun,
  Calculator,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import clsx from 'clsx';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const MobileLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const employee = useAuthStore((s) => s.employee);
  const tenant = useAuthStore((s) => s.tenant);
  const role = useAuthStore((s) => s.role);
  const logout = useAuthStore((s) => s.logout);
  // Page de relances reservee aux ADMIN/MANAGER (require_role cote serveur).
  const canAccessReminders = role === 'ADMIN' || role === 'MANAGER';
  // Journal d audit reserve aux ADMIN seulement (Loi 25 Quebec).
  const canAccessAudit = role === 'ADMIN';
  const isDark = useThemeStore((s) => s.isDark);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const unread = useMessagesStore((s) => s.unread);
  const fetchUnread = useMessagesStore((s) => s.fetchUnread);

  const [showMenu, setShowMenu] = React.useState(false);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  const navItems = [
    { path: '/', icon: Home, label: 'Accueil' },
    { path: '/pointage', icon: Clock, label: 'Pointage' },
    { path: '/messages', icon: MessageSquare, label: 'Messages', badge: unread.totalUnread },
    { path: '/dossiers', icon: FolderOpen, label: 'Dossiers' },
    { path: '/menu', icon: Menu, label: 'Plus' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleNavClick = (path: string) => {
    if (path === '/menu') {
      setShowMenu(!showMenu);
      return;
    }
    setShowMenu(false);
    navigate(path);
  };

  return (
    // `fixed inset-0` anchors the shell to the four edges of the visible
    // viewport regardless of iOS Safari's toolbar dance / PWA shell sizing.
    // Replaces the prior `h-[100svh] overflow-hidden` which left an empty
    // strip below the bottom nav whenever the dynamic viewport grew (e.g.
    // when the URL bar collapsed on scroll). With this, the bottom nav is
    // effectively pinned to the bottom of the screen.
    <div className="fixed inset-0 flex flex-col bg-transparent dark:bg-[#1b1a19]">
      {/* Top Bar */}
      <header className="bg-d365-navy text-white px-4 py-1.5 flex items-center justify-between shrink-0 h-12 safe-top">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded bg-seaop-primary flex items-center justify-center text-xs font-bold shrink-0">
            C
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">
              {employee ? `${employee.prenom} ${employee.nom}` : 'Constructo'}
            </p>
            {tenant && (
              <p className="text-[11px] text-blue-200 leading-tight truncate">{tenant.tenantNom}</p>
            )}
          </div>
        </div>
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
          aria-label={isDark ? 'Mode clair' : 'Mode sombre'}
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </header>

      {/* Content Area. `overscroll-contain` stops iOS Safari rubber-band
          scrolling from leaking to the document and momentarily exposing
          the body color below the layout. ErrorBoundary evite qu'un crash
          dans une page (ex: React #185 boucle infinie) demonte tout le
          layout et laisse un screen vide. */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Slide-up Menu */}
      {showMenu && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setShowMenu(false)}
          />
          <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl border-t border-gray-200 dark:border-gray-700 animate-slide-in-up">
            <div className="p-4 space-y-1">
              <button
                onClick={() => { navigate('/equipe'); setShowMenu(false); }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 min-h-[44px]"
              >
                <Users className="h-5 w-5" />
                <span>Équipe</span>
              </button>
              <button
                onClick={() => { navigate('/assistant'); setShowMenu(false); }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 min-h-[44px]"
              >
                <Bot className="h-5 w-5" />
                <span>Assistant IA</span>
              </button>
              <button
                onClick={() => { navigate('/meteo'); setShowMenu(false); }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 min-h-[44px]"
              >
                <CloudSun className="h-5 w-5" />
                <span>Météo Chantier</span>
              </button>
              <button
                onClick={() => { navigate('/calculatrice'); setShowMenu(false); }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 min-h-[44px]"
              >
                <Calculator className="h-5 w-5" />
                <span>Calculatrice</span>
              </button>
              {canAccessReminders && (
                <button
                  onClick={() => { navigate('/reminders'); setShowMenu(false); }}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 min-h-[44px]"
                >
                  <AlertTriangle className="h-5 w-5" />
                  <span>Relances factures</span>
                </button>
              )}
              {canAccessAudit && (
                <button
                  onClick={() => { navigate('/audit'); setShowMenu(false); }}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 min-h-[44px]"
                >
                  <ShieldCheck className="h-5 w-5" />
                  <span>Journal d&apos;audit</span>
                </button>
              )}
              <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
              <button
                onClick={() => { logout(); navigate('/login'); setShowMenu(false); }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 min-h-[44px]"
              >
                <LogOut className="h-5 w-5" />
                <span>Déconnexion</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Bottom Navigation */}
      <nav className="bg-white dark:bg-[#252423] border-t border-gray-200 dark:border-[#3b3a39] shrink-0 safe-bottom">
        <div className="flex items-center justify-around px-2">
          {navItems.map((item) => {
            const active = item.path === '/menu' ? showMenu : isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => handleNavClick(item.path)}
                className={clsx(
                  'flex flex-col items-center justify-center py-2 px-3 min-h-[56px] min-w-[56px] relative transition-colors',
                  active
                    ? 'text-seaop-primary dark:text-seaop-primary-400'
                    : 'text-gray-500 dark:text-gray-400',
                )}
              >
                <div className="relative">
                  <item.icon className="h-5 w-5" />
                  {item.badge && item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] mt-0.5 font-medium">{item.label}</span>
                {active && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-seaop-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export { MobileLayout };
