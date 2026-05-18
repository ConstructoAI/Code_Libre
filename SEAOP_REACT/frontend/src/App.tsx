/**
 * SEAOP React Frontend - Root App Component
 * Defines all routes using React Router v6.
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import { useThemeStore } from '@/store/useThemeStore';

// Pages
import AccueilPage from '@/pages/AccueilPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import NouveauProjetPage from '@/pages/NouveauProjetPage';
import MesProjetsPage from '@/pages/MesProjetsPage';
import EspaceEntrepreneurPage from '@/pages/EspaceEntrepreneurPage';
import LeadDetailPage from '@/pages/LeadDetailPage';
import NotFoundPage from '@/pages/NotFoundPage';
import NotificationsPage from '@/pages/NotificationsPage';
import ChatRoomPage from '@/pages/ChatRoomPage';

// Phase 4 Pages
import ServiceEstimationPage from '@/pages/ServiceEstimationPage';
import AdminPage from '@/pages/AdminPage';

export default function App() {
  const isDark = useThemeStore((s) => s.isDark);
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Toaster
          position="top-right"
          theme={isDark ? 'dark' : 'light'}
          richColors
          closeButton
          toastOptions={{
            className: 'font-sans',
            duration: 4000,
          }}
        />
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<AccueilPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="nouveau-projet" element={<NouveauProjetPage />} />
            <Route
              path="mes-projets"
              element={
                <ProtectedRoute roles={['client']}>
                  <MesProjetsPage />
                </ProtectedRoute>
              }
            />
            <Route path="appels-offres" element={<EspaceEntrepreneurPage />} />
            <Route path="projet/:id" element={<LeadDetailPage />} />

            {/* Phase 3 routes */}
            <Route path="chat-room" element={<ChatRoomPage />} />
            <Route
              path="notifications"
              element={
                <ProtectedRoute>
                  <NotificationsPage />
                </ProtectedRoute>
              }
            />
            <Route path="services/estimation" element={<ServiceEstimationPage />} />
            <Route
              path="administration"
              element={
                <ProtectedRoute roles={['admin', 'super_admin']}>
                  <ErrorBoundary>
                    <AdminPage />
                  </ErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Catch-all */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
