/**
 * SEAOP React Frontend - Sidebar Navigation
 * D365 Fluent-aligned sidebar matching ERP React visual identity.
 * Responsive: full-width overlay on mobile, fixed panel on desktop.
 */

import { useState, useCallback, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
  Home,
  FilePlus,
  FolderOpen,
  Search,
  MessageSquare,
  DollarSign,
  Settings,
  ChevronDown,
  ChevronRight,
  X,
  Landmark,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

// ============ Nav item type ============

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  roles?: Array<'entrepreneur' | 'client' | 'admin' | 'super_admin'>;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

// ============ Navigation config ============

const mainItems: NavItem[] = [
  { label: 'Accueil', to: '/', icon: <Home size={18} /> },
  { label: 'Déposer un projet', to: '/nouveau-projet', icon: <FilePlus size={18} /> },
  { label: 'Appels d\u2019offres', to: '/appels-offres', icon: <Search size={18} /> },
  { label: 'Mes projets', to: '/mes-projets', icon: <FolderOpen size={18} />, roles: ['client'] },
  { label: 'Chat Room', to: '/chat-room', icon: <MessageSquare size={18} /> },
];

const servicesSection: NavSection = {
  heading: 'Services',
  items: [
    { label: 'Estimation', to: '/services/estimation', icon: <DollarSign size={18} /> },
  ],
};

const adminItem: NavItem = {
  label: 'Administration',
  to: '/administration',
  icon: <Settings size={18} />,
  roles: ['admin', 'super_admin'],
};

// ============ Component ============

export default function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [servicesOpen, setServicesOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    const handler = () => setMobileOpen((prev) => !prev);
    window.addEventListener('toggle-sidebar', handler);
    return () => window.removeEventListener('toggle-sidebar', handler);
  }, []);

  // Auto-close mobile sidebar on route change (handles browser back/forward)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const hasAccess = (item: NavItem): boolean => {
    if (!item.roles) return true;
    if (!user) return false;
    return item.roles.includes(user.userType);
  };

  /** D365-style link sur fond navy : active = bordure bleu clair + bg white/15 */
  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center gap-3 px-3.5 py-[7px] text-[13px] font-normal transition-colors rounded-none border-l-[3px]',
      isActive
        ? 'border-l-[#50a9ff] bg-white/15 text-white font-semibold'
        : 'border-l-transparent text-white/80 hover:bg-white/10 hover:text-white',
    );

  const sidebarContent = (
    <>
      {/* Brand / Logo */}
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <Landmark className="h-7 w-7 text-[#6cb8f6]" />
        <div>
          <h1 className="text-base font-bold text-white">
            SEAOP
          </h1>
          <p className="text-[11px] text-white/60">Appels d&rsquo;offres</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {/* Main items */}
        {mainItems.filter(hasAccess).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={linkClasses} onClick={closeMobile}>
            <span className="opacity-80">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}

        {/* Services section */}
        <div className="pt-3">
          <button
            type="button"
            onClick={() => setServicesOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/60 hover:text-white/80"
          >
            {servicesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {servicesSection.heading}
          </button>

          {servicesOpen && (
            <div className="space-y-0.5">
              {servicesSection.items.map((item) => (
                <NavLink key={item.to} to={item.to} className={linkClasses} onClick={closeMobile}>
                  <span className="opacity-80">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>

        {/* Admin item */}
        {hasAccess(adminItem) && (
          <div className="pt-3 border-t border-white/10 mt-3">
            <NavLink to={adminItem.to} className={linkClasses} onClick={closeMobile}>
              <span className="opacity-80">{adminItem.icon}</span>
              <span>{adminItem.label}</span>
            </NavLink>
          </div>
        )}
      </nav>

      {/* Bottom branding */}
      <div className="border-t border-white/10 px-5 py-3">
        <p className="text-[11px] text-white/50">Constructo AI &copy; 2026</p>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar — D365 navy gradient (aligne sur ERP) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:shrink-0 seaop-sidebar">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={closeMobile}
            aria-hidden="true"
          />

          {/* Sidebar panel */}
          <aside className="relative flex w-[85vw] max-w-[280px] flex-col seaop-sidebar h-full shadow-xl">
            {/* Close button */}
            <button
              type="button"
              onClick={closeMobile}
              className="absolute right-3 top-4 rounded-md p-1 text-white/60 hover:text-white hover:bg-white/10"
              aria-label="Fermer le menu"
            >
              <X size={20} />
            </button>

            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
