/**
 * ERP React Frontend - Main Application Layout
 * Wraps all authenticated pages with Sidebar, TopBar, and Footer.
 */

import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useThemeStore } from '@/store/useThemeStore';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Footer from './Footer';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { UpdateBanner } from '@/components/ui/UpdateBanner';

export default function AppLayout() {
  const isDark = useThemeStore((s) => s.isDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <div className="flex min-h-screen flex-col">
      <UpdateBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar />
          <main className="flex-1 p-3 sm:p-4 lg:p-6">
            <Breadcrumbs />
            <Outlet />
          </main>
          <Footer />
        </div>
      </div>
    </div>
  );
}
