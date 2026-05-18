/**
 * ERP React Frontend - Root Application Component
 * Defines all routes for the ERP.
 */

import { useEffect, lazy, Suspense, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import LoginPage from '@/pages/LoginPage';
import { useAuthStore } from '@/store/useAuthStore';
import { Spinner } from '@/components/ui/Spinner';

// ── ErrorBoundary ────────────────────────────────────────────
// Detecte les ChunkLoadError causes par un nouveau deploiement (les hash
// des chunks Vite ont change cote serveur, l'ancien chunk 404) et reload
// silencieusement au lieu d'afficher un plein ecran d'erreur. Pour les
// autres erreurs, affiche un ecran d'erreur classique avec message clair.
function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(error.message) ||
    /Failed to fetch dynamically imported module/i.test(error.message) ||
    /error loading dynamically imported module/i.test(error.message)
  );
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null; reloading: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, reloading: false };
  }
  static getDerivedStateFromError(error: Error) {
    if (isChunkLoadError(error)) {
      // Reload silencieux : nouvelle version deployee, l'ancien chunk est 404.
      // reloading=true fige le rendu (render() retourne null) le temps que
      // window.location.reload() prenne effet, evitant un re-render qui
      // pourrait re-trigger le ChunkLoadError pendant les ~50ms de freeze.
      window.location.reload();
      return { hasError: false, error: null, reloading: true };
    }
    return { hasError: true, error, reloading: false };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!isChunkLoadError(error)) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }
  render() {
    if (this.state.reloading) {
      return null;
    }
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, fontFamily: 'sans-serif' }}>
          <h2 style={{ color: '#a4262c' }}>Une erreur est survenue</h2>
          <p style={{ color: '#323130', marginTop: 8 }}>
            {this.state.error?.message || 'Erreur inattendue.'}
          </p>
          <pre style={{ marginTop: 12, fontSize: 12, color: '#605e5c', whiteSpace: 'pre-wrap', maxWidth: '100%', overflow: 'auto' }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 16px', background: '#0078D4', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const CompaniesPage = lazy(() => import('@/pages/CompaniesPage'));
const ContactsPage = lazy(() => import('@/pages/ContactsPage'));
const MessagingPage = lazy(() => import('@/pages/MessagingPage'));
const MagasinPage = lazy(() => import('@/pages/MagasinPage'));
const DossiersPage = lazy(() => import('@/pages/DossiersPage'));
const ProjectsPage = lazy(() => import('@/pages/ProjectsPage'));
const DevisPage = lazy(() => import('@/pages/DevisPage'));
const SuiviPage = lazy(() => import('@/pages/SuiviPage'));
const ComptabilitePage = lazy(() => import('@/pages/ComptabilitePage'));
const EmployeesPage = lazy(() => import('@/pages/EmployeesPage'));
const PointagePage = lazy(() => import('@/pages/PointagePage'));
const AssistantIAPage = lazy(() => import('@/pages/AssistantIAPage'));
const LogistiquePage = lazy(() => import('@/pages/LogistiquePage'));
const LocationPage = lazy(() => import('@/pages/LocationPage'));
const MaintenancePage = lazy(() => import('@/pages/MaintenancePage'));
const MeteoPage = lazy(() => import('@/pages/MeteoPage'));
const ConformitePage = lazy(() => import('@/pages/ConformitePage'));
const SubventionsPage = lazy(() => import('@/pages/SubventionsPage'));
const ImmobilierPage = lazy(() => import('@/pages/ImmobilierPage'));
const CalculateursPage = lazy(() => import('@/pages/CalculateursPage'));
const EmailsPage = lazy(() => import('@/pages/EmailsPage'));
const VentesPage = lazy(() => import('@/pages/VentesPage'));
const BonsTravailPage = lazy(() => import('@/pages/BonsTravailPage'));
const ConfigurationPage = lazy(() => import('@/pages/ConfigurationPage'));
const B2bPage = lazy(() => import('@/pages/B2bPage'));
const WebPage = lazy(() => import('@/pages/WebPage'));
const DossierDetailPage = lazy(() => import('@/pages/DossierDetailPage'));
const RegisterPage = lazy(() => import('@/pages/RegisterPage'));
const DevisPublicPage = lazy(() => import('@/pages/DevisPublicPage'));
const DossierPublicPage = lazy(() => import('@/pages/DossierPublicPage'));
const IntegrationPage = lazy(() => import('@/pages/IntegrationPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

// B2B Client Portal
const B2bLoginPage = lazy(() => import('@/pages/b2b-portal/B2bLoginPage'));
const B2bRegisterPage = lazy(() => import('@/pages/b2b-portal/B2bRegisterPage'));
const B2bPortalLayout = lazy(() => import('@/components/layout/B2bPortalLayout'));
const B2bDashboardPage = lazy(() => import('@/pages/b2b-portal/B2bDashboardPage'));
const B2bCataloguePage = lazy(() => import('@/pages/b2b-portal/B2bCataloguePage'));
const B2bPanierPage = lazy(() => import('@/pages/b2b-portal/B2bPanierPage'));
const B2bCommandesPage = lazy(() => import('@/pages/b2b-portal/B2bCommandesPage'));
const B2bDemandesPage = lazy(() => import('@/pages/b2b-portal/B2bDemandesPage'));
const B2bMessagesPage = lazy(() => import('@/pages/b2b-portal/B2bMessagesPage'));
import B2bProtectedRoute from '@/components/layout/B2bProtectedRoute';

export default function App() {
  const isLoading = useAuthStore((s) => s.isLoading);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ErrorBoundary>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>}>
        <Routes>
          {/* B2B Client Portal (separate layout, no ERP sidebar) */}
          <Route path="/b2b-portal/login" element={<B2bLoginPage />} />
          <Route path="/b2b-portal/register" element={<B2bRegisterPage />} />
          <Route path="/b2b-portal" element={<B2bPortalLayout />}>
            <Route index element={<Navigate to="/b2b-portal/dashboard" replace />} />
            <Route path="dashboard" element={<B2bProtectedRoute><B2bDashboardPage /></B2bProtectedRoute>} />
            <Route path="catalogue" element={<B2bProtectedRoute><B2bCataloguePage /></B2bProtectedRoute>} />
            <Route path="panier" element={<B2bProtectedRoute><B2bPanierPage /></B2bProtectedRoute>} />
            <Route path="commandes" element={<B2bProtectedRoute><B2bCommandesPage /></B2bProtectedRoute>} />
            <Route path="demandes" element={<B2bProtectedRoute><B2bDemandesPage /></B2bProtectedRoute>} />
            <Route path="messages" element={<B2bProtectedRoute><B2bMessagesPage /></B2bProtectedRoute>} />
          </Route>

          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/devis/public/:token" element={<DevisPublicPage />} />
          <Route path="/dossiers/public/:token" element={<DossierPublicPage />} />

          {/* Protected routes within AppLayout */}
          <Route element={<AppLayout />}>
            {/* Redirect root to dashboard */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />

            {/* Admin (super_admin only) */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={['super_admin']}>
                  <AdminPage />
                </ProtectedRoute>
              }
            />

            {/* Phase 2: Analytics */}
            <Route path="/analyses" element={<ProtectedRoute><AnalyticsPage /></ProtectedRoute>} />
            <Route path="/suivi" element={<ProtectedRoute><SuiviPage /></ProtectedRoute>} />
            <Route path="/dossiers" element={<ProtectedRoute><DossiersPage /></ProtectedRoute>} />
            <Route path="/dossier/:id" element={<ProtectedRoute><DossierDetailPage /></ProtectedRoute>} />
            <Route path="/entreprises" element={<ProtectedRoute><CompaniesPage /></ProtectedRoute>} />
            <Route path="/contacts" element={<ProtectedRoute><ContactsPage /></ProtectedRoute>} />
            <Route path="/ventes" element={<ProtectedRoute><VentesPage /></ProtectedRoute>} />
            <Route path="/devis" element={<ProtectedRoute><DevisPage /></ProtectedRoute>} />
            <Route path="/projets" element={<ProtectedRoute><ProjectsPage /></ProtectedRoute>} />
            <Route path="/magasin" element={<ProtectedRoute><MagasinPage /></ProtectedRoute>} />
            <Route path="/employes" element={<ProtectedRoute><EmployeesPage /></ProtectedRoute>} />
            <Route path="/bons-travail" element={<ProtectedRoute><BonsTravailPage /></ProtectedRoute>} />
            <Route path="/pointage" element={<ProtectedRoute><PointagePage /></ProtectedRoute>} />
            <Route path="/comptabilite" element={<ProtectedRoute><ComptabilitePage /></ProtectedRoute>} />
            <Route path="/meteo" element={<ProtectedRoute><MeteoPage /></ProtectedRoute>} />
            <Route path="/conformite" element={<ProtectedRoute><ConformitePage /></ProtectedRoute>} />
            <Route path="/subventions" element={<ProtectedRoute><SubventionsPage /></ProtectedRoute>} />
            <Route path="/immobilier" element={<ProtectedRoute><ImmobilierPage /></ProtectedRoute>} />
            <Route path="/logistique" element={<ProtectedRoute><LogistiquePage /></ProtectedRoute>} />
            <Route path="/location" element={<ProtectedRoute><LocationPage /></ProtectedRoute>} />
            <Route path="/maintenance" element={<ProtectedRoute><MaintenancePage /></ProtectedRoute>} />
            <Route path="/emails" element={<ProtectedRoute><EmailsPage /></ProtectedRoute>} />
            <Route path="/messagerie" element={<ProtectedRoute><MessagingPage /></ProtectedRoute>} />
            <Route path="/assistant-ia" element={<ProtectedRoute><AssistantIAPage /></ProtectedRoute>} />
            <Route path="/calculateurs" element={<ProtectedRoute><CalculateursPage /></ProtectedRoute>} />
            <Route path="/b2b" element={<ProtectedRoute roles={['admin', 'super_admin']}><B2bPage /></ProtectedRoute>} />
            <Route path="/web" element={<ProtectedRoute><WebPage /></ProtectedRoute>} />
            <Route path="/integration" element={<ProtectedRoute><IntegrationPage /></ProtectedRoute>} />
            <Route path="/configuration" element={<ProtectedRoute><ConfigurationPage /></ProtectedRoute>} />

            {/* 404 */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
