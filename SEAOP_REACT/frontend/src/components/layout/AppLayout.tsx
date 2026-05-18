/**
 * SEAOP React Frontend - Main Application Layout
 * D365-aligned layout with breathing gradient background matching ERP React.
 */

import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useThemeStore } from '@/store/useThemeStore';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Footer from './Footer';

export default function AppLayout() {
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const isDark = useThemeStore((s) => s.isDark);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <div className="flex min-h-screen">
      {/* Background is handled by body CSS (breathing gradient) */}
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />
        <main className="flex-1 p-4 sm:p-6 overflow-x-hidden">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}
