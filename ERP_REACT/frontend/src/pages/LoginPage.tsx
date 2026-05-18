/**
 * ERP React Frontend - Login Page
 * Two-step login: 1) Company email + password → 2) User credentials
 * Plus super-admin login option.
 */

import { useState } from 'react';
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Smartphone, ScrollText, Building2 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import SylvainChatWidget from '@/components/login/SylvainChatWidget';

type LoginMode = 'tenant' | 'user' | 'super_admin';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    isAuthenticated,
    loginTenant, loginUser, loginSuperAdmin,
    tenant, loginStep, isLoading, error,
    clearError, resetLoginStep,
  } = useAuthStore();

  const checkoutSuccess = searchParams.get('checkout') === 'success';

  const [mode, setMode] = useState<LoginMode>('tenant');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [isNewAccount, _setIsNewAccount] = useState(checkoutSuccess);

  // Redirect already-authenticated users
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleTenantLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await loginTenant(email, password);
    // Pre-fill username with email and same password for step 2
    const state = useAuthStore.getState();
    if (state.loginStep === 'user') {
      setUsername(email);
      setUserPassword(password);
    }
  };

  const handleUserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await loginUser(username, userPassword);
    // If successful, navigate to dashboard
    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      navigate('/dashboard');
    }
  };

  const handleSuperAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await loginSuperAdmin(username, userPassword);
    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      navigate('/admin');
    }
  };

  const switchToSuperAdmin = () => {
    setMode('super_admin');
    clearError();
    setUsername('');
    setUserPassword('');
  };

  const switchToTenant = () => {
    setMode('tenant');
    clearError();
    resetLoginStep();
    setUsername('');
    setUserPassword('');
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — navy branding */}
      <div className="hidden md:flex md:w-[420px] bg-[#002050] flex-col justify-between p-10 text-white">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <img src="/logo.png" alt="Constructo AI" className="h-10 w-10 object-contain brightness-0 invert opacity-90" />
            <div>
              <h1 className="text-xl font-bold">Constructo AI</h1>
              <p className="text-xs text-white/50">ERP AI Construction</p>
            </div>
          </div>
          <h2 className="text-3xl font-bold leading-tight mb-4">Gérez vos projets de construction</h2>
          <p className="text-white/60 text-sm leading-relaxed">
            Soumissions, projets, employés, comptabilité — tout en un seul endroit.
            Propulsé par l'intelligence artificielle.
          </p>
          <a
            href="https://mobile.constructoai.ca/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 flex items-center gap-3 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-white/80 hover:text-white text-sm group"
          >
            <Smartphone size={20} className="text-white/50 group-hover:text-white/80 flex-shrink-0" />
            <div>
              <p className="font-medium">Pointeur Mobile</p>
              <p className="text-xs text-white/40 group-hover:text-white/50">Pointage, bons de travail, dossiers terrain</p>
            </div>
          </a>
          <a
            href="/b2b-portal/login"
            className="mt-3 flex items-center gap-3 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-white/80 hover:text-white text-sm group"
          >
            <Building2 size={20} className="text-white/50 group-hover:text-white/80 flex-shrink-0" />
            <div>
              <p className="font-medium">B2B / C2B</p>
              <p className="text-xs text-white/40 group-hover:text-white/50">Portail client</p>
            </div>
          </a>
          <a
            href="https://seaop.constructoai.ca/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center gap-3 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-white/80 hover:text-white text-sm group"
          >
            <ScrollText size={20} className="text-white/50 group-hover:text-white/80 flex-shrink-0" />
            <div>
              <p className="font-medium">SEAOP</p>
              <p className="text-xs text-white/40 group-hover:text-white/50">Appels d'offres publics construction</p>
            </div>
          </a>
        </div>
        <div className="text-white/30 text-xs text-center">
          <p>Constructo AI ERP AI v1.0</p>
          <p className="mt-1">
            <a href="mailto:info@constructoai.ca" className="hover:text-white/50">info@constructoai.ca</a>
            {' | '}
            <a href="tel:+15148201972" className="hover:text-white/50">(514) 820-1972</a>
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="md:hidden text-center mb-8">
            <img src="/logo.png" alt="Constructo AI" className="h-12 w-12 object-contain mx-auto mb-3" />
            <h1 className="text-xl font-bold text-[#323130] dark:text-[#f3f2f1]">Constructo AI</h1>
            <p className="text-xs text-[#605e5c] mt-1">ERP AI Construction Québec</p>
          </div>

          {/* Card */}
          <div className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] shadow-sm p-6">
          {checkoutSuccess && (
            <Alert type="success" onClose={() => navigate('/login', { replace: true })}>
              Compte créé avec succès! Connectez-vous avec votre email d'entreprise et votre mot de passe.
            </Alert>
          )}

          {error && (
            <Alert type="error" onClose={clearError}>
              {error}
            </Alert>
          )}

          {/* Super-Admin Login */}
          {mode === 'super_admin' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <button onClick={switchToTenant} className="p-1 rounded hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39]">
                  <ArrowLeft size={18} className="text-[#605e5c]" />
                </button>
                <div>
                  <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">Super-Admin</h2>
                  <p className="text-xs text-[#605e5c] mt-0.5">Accès administrateur global</p>
                </div>
              </div>
              <form onSubmit={handleSuperAdminLogin} className="space-y-4">
                <Input
                  label="Nom d'utilisateur"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                />
                <Input
                  label="Mot de passe"
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  required
                />
                <Button type="submit" isLoading={isLoading} className="w-full" variant="danger">
                  Connexion Super-Admin
                </Button>
              </form>
            </>
          )}

          {/* Step 1: Tenant Login */}
          {mode === 'tenant' && loginStep === 'tenant' && (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                  Connexion Entreprise
                </h2>
                <p className="text-xs text-[#605e5c] mt-1">Entrez les identifiants de votre organisation</p>
              </div>
              <form onSubmit={handleTenantLogin} className="space-y-4">
                <Input
                  label="Email de l'entreprise"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@monentreprise.ca"
                  required
                  autoFocus
                />
                <Input
                  label="Mot de passe entreprise"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Button type="submit" isLoading={isLoading} className="w-full">
                  Continuer
                </Button>
              </form>
              <div className="mt-4 pt-4 border-t border-[#edebe9] dark:border-[#3b3a39] space-y-2">
                <button
                  onClick={() => navigate('/register')}
                  className="w-full text-center text-sm text-[#0078D4] hover:text-[#106EBE] font-medium transition-colors"
                >
                  Créer un compte
                </button>
                <button
                  onClick={switchToSuperAdmin}
                  className="w-full text-center text-[10px] text-[#d2d0ce] hover:text-[#a19f9d] transition-colors"
                >
                  Admin
                </button>
              </div>
            </>
          )}

          {/* Step 2: User Login */}
          {mode === 'tenant' && loginStep === 'user' && tenant && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <button onClick={switchToTenant} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                  <ArrowLeft size={18} className="text-gray-500" />
                </button>
                <div>
                  <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                    Connexion Utilisateur
                  </h2>
                  <p className="text-xs text-[#605e5c] mt-0.5">{tenant.entrepriseNom}</p>
                </div>
              </div>
              {isNewAccount && username && (
                <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1.5">Vos identifiants sont pré-remplis</p>
                  <div className="text-sm text-blue-700 dark:text-blue-400 space-y-0.5">
                    <p>Utilisez votre <span className="font-semibold">email</span> et le <span className="font-semibold">même mot de passe</span> que votre entreprise</p>
                  </div>
                </div>
              )}
              <form onSubmit={handleUserLogin} className="space-y-4">
                <Input
                  label="Nom d'utilisateur"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                />
                <Input
                  label="Mot de passe"
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  required
                />
                <Button type="submit" isLoading={isLoading} className="w-full">
                  Se connecter
                </Button>
              </form>
            </>
          )}
          </div>

          {/* Mobile module links — visible only on small screens */}
          <div className="md:hidden mt-6 space-y-2">
            <a
              href="https://mobile.constructoai.ca/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#002050] text-white/80 hover:text-white text-sm transition-colors"
            >
              <Smartphone size={18} className="text-white/50 flex-shrink-0" />
              <div>
                <p className="font-medium">Pointeur Mobile</p>
                <p className="text-xs text-white/40">Pointage, bons de travail</p>
              </div>
            </a>
            <a
              href="/b2b-portal/login"
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#002050] text-white/80 hover:text-white text-sm transition-colors"
            >
              <Building2 size={18} className="text-white/50 flex-shrink-0" />
              <div>
                <p className="font-medium">B2B / C2B</p>
                <p className="text-xs text-white/40">Portail client</p>
              </div>
            </a>
            <a
              href="https://seaop.constructoai.ca/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#002050] text-white/80 hover:text-white text-sm transition-colors"
            >
              <ScrollText size={18} className="text-white/50 flex-shrink-0" />
              <div>
                <p className="font-medium">SEAOP</p>
                <p className="text-xs text-white/40">Appels d'offres publics</p>
              </div>
            </a>
          </div>
        </div>
      </div>

      <SylvainChatWidget />
    </div>
  );
}

