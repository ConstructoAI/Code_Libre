/**
 * ERP React Frontend - Sidebar
 * D365-style collapsible navigation: icons-only ↔ expanded.
 */

import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  LayoutDashboard, BarChart3, Kanban, FolderOpen, Building2,
  Users, TrendingUp, FileText, Briefcase, ShoppingCart,
  UserCheck, ClipboardList, Clock, CloudSun, Calculator,
  Shield, Landmark, Building, Truck, Wrench, PenTool,
  MessageSquare, Bot, Settings, ChevronDown,
  X, HardHat, ChevronsLeft, ChevronsRight,
  Video, BookOpen, ExternalLink, Mail, Globe,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
  collapsible?: boolean;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { label: 'Tableau de Bord', path: '/dashboard', icon: <LayoutDashboard size={18} /> },
      { label: 'Analyses', path: '/analyses', icon: <BarChart3 size={18} /> },
      { label: 'Suivi', path: '/suivi', icon: <Kanban size={18} /> },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { label: 'Entreprises', path: '/entreprises', icon: <Building2 size={18} /> },
      { label: 'Contacts', path: '/contacts', icon: <Users size={18} /> },
      { label: 'Ventes', path: '/ventes', icon: <TrendingUp size={18} /> },
      { label: 'Dossiers', path: '/dossiers', icon: <FolderOpen size={18} /> },
      { label: 'Soumissions', path: '/devis', icon: <FileText size={18} /> },
      { label: 'Projets', path: '/projets', icon: <Briefcase size={18} /> },
    ],
  },
  {
    label: 'Opérations',
    collapsible: true,
    items: [
      { label: 'Magasin', path: '/magasin', icon: <ShoppingCart size={18} /> },
      { label: 'Employés', path: '/employes', icon: <UserCheck size={18} /> },
      { label: 'Bons de Travail', path: '/bons-travail', icon: <ClipboardList size={18} /> },
      { label: 'Pointage', path: '/pointage', icon: <Clock size={18} /> },
      { label: 'Comptabilité', path: '/comptabilite', icon: <Calculator size={18} /> },
    ],
  },
  {
    label: 'Terrain',
    collapsible: true,
    items: [
      { label: 'Météo Chantier', path: '/meteo', icon: <CloudSun size={18} /> },
      { label: 'Conformité RBQ/CCQ', path: '/conformite', icon: <Shield size={18} /> },
      { label: 'Subventions', path: '/subventions', icon: <Landmark size={18} /> },
      { label: 'Immobilier', path: '/immobilier', icon: <Building size={18} /> },
      { label: 'Logistique', path: '/logistique', icon: <Truck size={18} /> },
      { label: 'Location', path: '/location', icon: <HardHat size={18} /> },
      { label: 'Maintenance', path: '/maintenance', icon: <Wrench size={18} /> },
    ],
  },
  {
    label: 'Communication',
    collapsible: true,
    items: [
      { label: 'Emails', path: '/emails', icon: <Mail size={18} /> },
      { label: 'Messagerie', path: '/messagerie', icon: <MessageSquare size={18} /> },
      { label: 'Assistant IA', path: '/assistant-ia', icon: <Bot size={18} /> },
    ],
  },
  {
    label: 'Outils',
    collapsible: true,
    items: [
      { label: 'Calculateurs', path: '/calculateurs', icon: <PenTool size={18} /> },
      { label: 'Web', path: '/web', icon: <Globe size={18} /> },
      { label: 'Configuration', path: '/configuration', icon: <Settings size={18} /> },
    ],
  },
];

export default function Sidebar() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handler = () => setMobileOpen((v) => !v);
    window.addEventListener('toggle-sidebar', handler);
    return () => window.removeEventListener('toggle-sidebar', handler);
  }, []);

  // Broadcast collapse state for layout to adjust
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sidebar-collapse', { detail: sidebarCollapsed }));
  }, [sidebarCollapsed]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const toggleGroup = (label: string) => {
    setGroupCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // ── Shared nav renderer ──────────────────────────────────
  const renderNav = (mode: 'expanded' | 'collapsed' | 'mobile') => {
    const isCollapsedMode = mode === 'collapsed';
    const isMobile = mode === 'mobile';

    return (
      <nav className={clsx('flex-1 overflow-y-auto overscroll-contain', isMobile ? 'mobile-nav py-1' : 'py-2')}>
        {NAV_GROUPS.map((group, gi) => {
          const isGroupCollapsed = groupCollapsed[group.label] ?? false;

          return (
            <div key={group.label}>
              {/* Divider */}
              {gi > 0 && (
                <div className={clsx(
                  'border-t border-white/10',
                  isCollapsedMode ? 'my-1.5 mx-2' : isMobile ? 'my-1.5 mx-3' : 'my-2 mx-3',
                )} />
              )}

              {/* Group header — hidden in collapsed mode */}
              {!isCollapsedMode && (
                group.collapsible ? (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className={clsx(
                      'flex items-center justify-between w-full px-4 text-[11px] font-semibold uppercase tracking-wider text-white/60 hover:text-white/80',
                      isMobile ? 'py-1.5' : 'py-2',
                    )}
                  >
                    {group.label}
                    <ChevronDown
                      size={12}
                      className={clsx('transition-transform duration-200', isGroupCollapsed && '-rotate-90')}
                    />
                  </button>
                ) : (
                  <div className={clsx(
                    'px-4 text-[11px] font-semibold uppercase tracking-wider text-white/60',
                    isMobile ? 'py-1.5' : 'py-2',
                  )}>
                    {group.label}
                  </div>
                )
              )}

              {/* Nav items */}
              {(!group.collapsible || !isGroupCollapsed || isCollapsedMode) && (
                <div>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      title={isCollapsedMode ? item.label : undefined}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center font-normal transition-all duration-100 border-l-[3px]',
                          isCollapsedMode
                            ? 'justify-center px-0 py-2 mx-1 rounded text-[13px]'
                            : isMobile
                              ? 'gap-2.5 px-3 py-2.5 text-sm min-h-[44px]'
                              : 'gap-2.5 px-3.5 py-[7px] text-[13px]',
                          isActive
                            ? isCollapsedMode
                              ? 'border-l-[#50a9ff] bg-white/15 text-white'
                              : 'border-l-[#50a9ff] bg-white/15 text-white font-semibold'
                            : isCollapsedMode
                              ? 'border-l-transparent text-white/70 hover:bg-white/10 hover:text-white'
                              : 'border-l-transparent text-white/80 hover:bg-white/10 hover:text-white',
                        )
                      }
                    >
                      <span className={clsx('shrink-0 flex items-center justify-center', isCollapsedMode ? 'w-6' : 'w-5 opacity-80')}>
                        {item.icon}
                      </span>
                      {!isCollapsedMode && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Aide & Ressources — external links */}
        <div className={clsx('border-t border-white/10', isCollapsedMode ? 'my-1.5 mx-2' : isMobile ? 'my-1.5 mx-3' : 'my-2 mx-3')} />
        {!isCollapsedMode && (
          <div className={clsx('px-4 text-[11px] font-semibold uppercase tracking-wider text-white/60', isMobile ? 'py-1.5' : 'py-2')}>
            Aide & Ressources
          </div>
        )}
        {[
          { label: 'Vidéos', href: 'https://www.youtube.com/channel/UC3EGXYQNj5UYGiyNfiiom_A', icon: <Video size={18} /> },
          { label: 'Manuel', href: 'https://github.com/ConstructoAI/Documents/blob/main/README.md', icon: <BookOpen size={18} /> },
          { label: 'Liens utiles', href: 'https://github.com/ConstructoAI/Documents/blob/main/liens-utiles.md', icon: <ExternalLink size={18} /> },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            title={isCollapsedMode ? link.label : undefined}
            className={clsx(
              'flex items-center font-normal transition-all duration-100 border-l-[3px] border-l-transparent',
              isCollapsedMode
                ? 'justify-center px-0 py-2 mx-1 rounded text-[13px]'
                : isMobile
                  ? 'gap-2.5 px-3 py-2.5 text-sm min-h-[44px]'
                  : 'gap-2.5 px-3.5 py-[7px] text-[13px]',
              'text-white/80 hover:bg-white/10 hover:text-white',
            )}
          >
            <span className={clsx('shrink-0 flex items-center justify-center', isCollapsedMode ? 'w-6' : 'w-5 opacity-70')}>
              {link.icon}
            </span>
            {!isCollapsedMode && (
              <>
                <span className="truncate flex-1">{link.label}</span>
                <ExternalLink size={10} className="shrink-0 opacity-40" />
              </>
            )}
          </a>
        ))}

        {/* Admin section */}
        {user?.userType === 'super_admin' && (
          <div className={clsx('border-t border-white/10', 'mt-2 pt-2')}>
            {!isCollapsedMode && (
              <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-red-300/80">
                Administration
              </div>
            )}
            <NavLink
              to="/admin"
              title={isCollapsedMode ? 'Super-Admin' : undefined}
              className={({ isActive }) =>
                clsx(
                  'flex items-center text-[13px] font-normal transition-all duration-100 border-l-[3px]',
                  isCollapsedMode
                    ? 'justify-center px-0 py-2 mx-1 rounded'
                    : 'gap-2.5 px-3.5 py-[7px]',
                  isActive
                    ? 'border-l-red-400 bg-red-500/15 text-red-200 font-semibold'
                    : 'border-l-transparent text-white/80 hover:bg-white/10 hover:text-white',
                )
              }
            >
              <span className={clsx('shrink-0 flex items-center justify-center', isCollapsedMode ? 'w-6' : 'w-5 opacity-70')}>
                <Shield size={18} />
              </span>
              {!isCollapsedMode && <span>Super-Admin</span>}
            </NavLink>
          </div>
        )}
      </nav>
    );
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'hidden lg:flex lg:flex-col erp-sidebar h-screen sticky top-0 transition-all duration-200',
          sidebarCollapsed ? 'lg:w-14' : 'lg:w-56',
        )}
      >
        {renderNav(sidebarCollapsed ? 'collapsed' : 'expanded')}

        {/* Collapse toggle button */}
        <div className="border-t border-white/10">
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="flex items-center justify-center w-full py-2.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            title={sidebarCollapsed ? 'Agrandir le menu' : 'Réduire le menu'}
          >
            {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="erp-sidebar absolute left-0 top-0 bottom-0 w-[85vw] max-w-[280px] flex flex-col shadow-2xl animate-slide-in-left">
            {/* Header with brand */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Constructo AI" className="h-7 w-7 object-contain brightness-0 invert opacity-90" />
                <div>
                  <span className="text-sm font-semibold text-white">Constructo AI</span>
                  <span className="block text-[10px] text-white/60">ERP AI Construction</span>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X size={20} />
              </button>
            </div>
            {renderNav('mobile')}
            {/* Version footer */}
            <div className="px-4 py-2 border-t border-white/10 text-[10px] text-white/60">
              <p>Constructo AI ERP AI v1.0</p>
              <p className="mt-0.5">
                <a href="mailto:info@constructoai.ca" className="hover:text-white">info@constructoai.ca</a>
                {' | '}
                <a href="tel:+15148201972" className="hover:text-white">(514) 820-1972</a>
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
