/**
 * Mobile React Frontend - Root App Component
 * Routing and auth initialization.
 */

import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { useThemeStore } from '@/store/useThemeStore';
import { MobileLayout } from '@/components/layout/MobileLayout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Pages
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import PunchPage from '@/pages/PunchPage';
import CrewPage from '@/pages/CrewPage';
import MessagesPage from '@/pages/MessagesPage';
import ChannelChatPage from '@/pages/ChannelChatPage';
import DmChatPage from '@/pages/DmChatPage';
import DossiersPage from '@/pages/DossiersPage';
import DossierDetailPage from '@/pages/DossierDetailPage';
import AiAssistantPage from '@/pages/AiAssistantPage';
import MeteoPage from '@/pages/MeteoPage';
import PhotoUploadPage from '@/pages/PhotoUploadPage';
import DocumentsHubPage from '@/pages/DocumentsHubPage';
import DocumentListPage from '@/pages/DocumentListPage';
import DocumentDetailPage from '@/pages/DocumentDetailPage';
import DocumentFormPage from '@/pages/DocumentFormPage';
import CalculatricePage from '@/pages/CalculatricePage';
import RemindersPage from '@/pages/RemindersPage';
import AuditLogPage from '@/pages/AuditLogPage';

export default function App() {
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const initTheme = useThemeStore((s) => s.init);

  useEffect(() => {
    initTheme();
    checkAuth();
  }, [checkAuth, initTheme]);

  return (
    // ErrorBoundary externe = filet de securite si MobileLayout lui-meme
    // crash (le boundary INTERNE de MobileLayout ne se catch pas lui-meme).
    <ErrorBoundary>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected - Mobile Layout */}
        <Route
          element={
            <ProtectedRoute>
              <MobileLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/pointage" element={<PunchPage />} />
          <Route path="/equipe" element={<CrewPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/channel/:channelId" element={<ChannelChatPage />} />
          <Route path="/messages/dm/:conversationId" element={<DmChatPage />} />
          <Route path="/dossiers" element={<DossiersPage />} />
          <Route path="/dossiers/:dossierId" element={<DossierDetailPage />} />
          <Route path="/documents" element={<DocumentsHubPage />} />
          <Route path="/documents/:docType" element={<DocumentListPage />} />
          <Route path="/documents/:docType/nouveau" element={<DocumentFormPage />} />
          <Route path="/documents/:docType/:docId" element={<DocumentDetailPage />} />
          <Route path="/documents/:docType/:docId/modifier" element={<DocumentFormPage />} />
          <Route path="/assistant" element={<AiAssistantPage />} />
          <Route path="/meteo" element={<MeteoPage />} />
          <Route path="/photo" element={<PhotoUploadPage />} />
          <Route path="/calculatrice" element={<CalculatricePage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
