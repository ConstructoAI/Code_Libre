/**
 * B2B Client Portal - Layout
 * Simplified layout for B2B clients: top nav with tabs, no ERP sidebar.
 */

import { useEffect, useState, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, ShoppingCart, Package,
  FileText, MessageSquare, LogOut, Menu, X, ChevronDown,
} from 'lucide-react';
import { useB2bAuthStore } from '@/store/useB2bAuthStore';
import { useB2bPortalStore } from '@/store/useB2bPortalStore';

const NAV_ITEMS = [
  { to: '/b2b-portal/dashboard', label: 'Accueil', icon: LayoutDashboard },
  { to: '/b2b-portal/catalogue', label: 'Catalogue', icon: ShoppingBag },
  { to: '/b2b-portal/panier', label: 'Panier', icon: ShoppingCart },
  { to: '/b2b-portal/commandes', label: 'Commandes', icon: Package },
  { to: '/b2b-portal/demandes', label: 'Demandes', icon: FileText },
  { to: '/b2b-portal/messages', label: 'Messages', icon: MessageSquare },
];

export default function B2bPortalLayout() {
  const { clientUser, logout } = useB2bAuthStore();
  const { panier, fetchPanier } = useB2bPortalStore();
  const { checkAuth } = useB2bAuthStore();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => { fetchPanier(); }, [fetchPanier]);

  // Close user menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/b2b-portal/login');
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
      isActive
        ? 'bg-[#0078D4] text-white'
        : 'text-white/70 hover:bg-white/10 hover:text-white'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-[#faf9f8] dark:bg-[#1b1a19]">
      {/* Header */}
      <header className="erp-topbar sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 rounded hover:bg-white/10 text-white/70"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Brand */}
          <div className="flex items-center gap-2">
            <ShoppingBag size={22} className="text-white/80" />
            <div>
              <p className="text-sm font-bold leading-tight">Portail B2B</p>
              {clientUser && (
                <p className="text-[10px] text-white/60 leading-tight">{clientUser.companyNom}</p>
              )}
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1 flex-1 ml-6">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                <item.icon size={16} />
                <span>{item.label}</span>
                {item.label === 'Panier' && panier && panier.nbItems > 0 && (
                  <span className="ml-1 bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full">
                    {panier.nbItems}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* User menu */}
          {clientUser && (
            <div className="relative ml-auto" ref={menuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-white/80 hover:bg-white/10"
              >
                <span className="hidden sm:inline max-w-[120px] truncate">{clientUser.displayName || clientUser.email}</span>
                <ChevronDown size={14} className={userMenuOpen ? 'rotate-180' : ''} />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] shadow-lg">
                  <div className="px-4 py-3 border-b border-[#f3f2f1] dark:border-[#3b3a39]">
                    <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1] truncate">{clientUser.displayName}</p>
                    <p className="text-xs text-[#605e5c] truncate">{clientUser.email}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <LogOut size={16} />
                    Se déconnecter
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile nav dropdown */}
        {mobileOpen && (
          <nav className="lg:hidden border-t border-white/10 px-4 py-2 space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={linkClass}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
                {item.label === 'Panier' && panier && panier.nbItems > 0 && (
                  <span className="ml-1 bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full">{panier.nbItems}</span>
                )}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-[#edebe9] dark:border-[#3b3a39] py-4 text-center">
        <p className="text-xs text-[#a19f9d]">Constructo AI &mdash; Portail Client B2B &copy; 2026</p>
      </footer>
    </div>
  );
}
