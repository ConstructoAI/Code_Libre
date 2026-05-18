import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import clsx from 'clsx';
import { Building2, User, ShieldCheck, HelpCircle, Mail } from 'lucide-react';

import { useAuthStore } from '@/store/useAuthStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { validateEmail } from '@/utils/validation';

// The shared-password "admin" role is retained in the backend as break-glass
// access but is no longer exposed in the UI. All admin access is now through
// individual accounts in `public.super_admins` (see /auth/super-admin/login).
type TabKey = 'client' | 'entrepreneur' | 'super_admin';

interface TabConfig {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}

// Dev mode flag - in dev mode, only the Administration tab is shown
const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';

const ALL_TABS: TabConfig[] = [
  { key: 'client', label: 'Donneur d\u2019ouvrage', icon: <User className="h-4 w-4" /> },
  { key: 'entrepreneur', label: 'Entrepreneur', icon: <Building2 className="h-4 w-4" /> },
  { key: 'super_admin', label: 'Administration', icon: <ShieldCheck className="h-4 w-4" /> },
];

const TABS: TabConfig[] = DEV_MODE
  ? ALL_TABS.filter((t) => t.key === 'super_admin')
  : ALL_TABS;

const LoginForm: React.FC = () => {
  const navigate = useNavigate();
  const { loginClient, loginEntrepreneur, loginSuperAdmin, isLoading, error, clearError } =
    useAuthStore();

  const [activeTab, setActiveTab] = useState<TabKey>(DEV_MODE ? 'super_admin' : 'client');

  // Client fields
  const [clientEmail, setClientEmail] = useState('');
  const [clientEmailError, setClientEmailError] = useState('');
  const [clientRefNumber, setClientRefNumber] = useState('');
  const [clientRefError, setClientRefError] = useState('');
  const [showClientHelp, setShowClientHelp] = useState(false);

  // Entrepreneur fields
  const [entEmail, setEntEmail] = useState('');
  const [entPassword, setEntPassword] = useState('');
  const [entEmailError, setEntEmailError] = useState('');
  const [entPasswordError, setEntPasswordError] = useState('');

  // Administration fields (super_admin role, individual accounts)
  const [saUsername, setSaUsername] = useState('');
  const [saPassword, setSaPassword] = useState('');
  const [saUsernameError, setSaUsernameError] = useState('');
  const [saPasswordError, setSaPasswordError] = useState('');

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab);
    clearError();
    // Reset field-level errors on tab switch
    setClientEmailError('');
    setClientRefError('');
    setEntEmailError('');
    setEntPasswordError('');
    setSaUsernameError('');
    setSaPasswordError('');
  }

  // ---- Client Submit ----
  async function handleClientSubmit(e: React.FormEvent) {
    e.preventDefault();
    setClientEmailError('');
    setClientRefError('');

    let valid = true;
    if (!clientEmail.trim()) {
      setClientEmailError('Le courriel est requis.');
      valid = false;
    } else if (!validateEmail(clientEmail)) {
      setClientEmailError('Veuillez entrer un courriel valide.');
      valid = false;
    }
    if (!clientRefNumber.trim()) {
      setClientRefError('Veuillez entrer votre numéro de référence');
      valid = false;
    }
    if (!valid) return;

    await loginClient(clientEmail, clientRefNumber);
    // Navigate on success (check store for auth state)
    const { isAuthenticated } = useAuthStore.getState();
    if (isAuthenticated) {
      navigate('/mes-projets');
    }
  }

  // ---- Entrepreneur Submit ----
  async function handleEntrepreneurSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEntEmailError('');
    setEntPasswordError('');

    let valid = true;
    if (!entEmail.trim()) {
      setEntEmailError('Le courriel est requis.');
      valid = false;
    } else if (!validateEmail(entEmail)) {
      setEntEmailError('Veuillez entrer un courriel valide.');
      valid = false;
    }
    if (!entPassword) {
      setEntPasswordError('Le mot de passe est requis.');
      valid = false;
    }
    if (!valid) return;

    await loginEntrepreneur(entEmail, entPassword);
    const { isAuthenticated } = useAuthStore.getState();
    if (isAuthenticated) {
      navigate('/appels-offres');
    }
  }

  // ---- Administration Submit (super_admin role) ----
  async function handleSuperAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaUsernameError('');
    setSaPasswordError('');

    let valid = true;
    if (!saUsername.trim()) {
      setSaUsernameError("Le nom d'utilisateur est requis.");
      valid = false;
    }
    if (!saPassword) {
      setSaPasswordError('Le mot de passe est requis.');
      valid = false;
    }
    if (!valid) return;

    await loginSuperAdmin(saUsername, saPassword);
    const { isAuthenticated } = useAuthStore.getState();
    if (isAuthenticated) {
      navigate('/administration');
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Connexion SEAOP
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Plateforme de soumissions publiques du Québec
        </p>
      </div>

      {/* Tab Buttons */}
      <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTabChange(tab.key)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150',
              activeTab === tab.key
                ? 'bg-white dark:bg-gray-700 text-seaop-primary-600 dark:text-seaop-primary-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
            )}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-4">
          <Alert type="error" onClose={clearError}>
            {error}
          </Alert>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="flex justify-center mb-4">
          <Spinner size="md" />
        </div>
      )}

      {/* ========= Client Tab ========= */}
      {activeTab === 'client' && (
        <form onSubmit={handleClientSubmit} className="space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-2">
            <p>
              <strong>Vous avez publié un projet ?</strong> Entrez le courriel et le numéro de référence reçu par courriel pour suivre vos soumissions.
            </p>
            <p className="text-xs">
              Pas encore de projet ?{' '}
              <Link
                to="/nouveau-projet"
                className="font-medium text-seaop-primary-600 hover:text-seaop-primary-500 dark:text-seaop-primary-400"
              >
                Déposer un appel d&apos;offres →
              </Link>
            </p>
          </div>

          <Input
            label="Courriel du projet"
            type="email"
            placeholder="votre@courriel.com"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            error={clientEmailError}
            disabled={isLoading}
            autoComplete="email"
            helperText="Le courriel utilisé lors de la publication"
          />

          <div>
            <Input
              label="Numéro de référence"
              type="text"
              placeholder="SEAOP-AAAAMMJJ-XXXXXXXX"
              value={clientRefNumber}
              onChange={(e) => setClientRefNumber(e.target.value)}
              error={clientRefError}
              disabled={isLoading}
              helperText="Format : SEAOP-20260101-ABC12345"
            />
            <button
              type="button"
              onClick={() => setShowClientHelp(true)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-seaop-primary-600 dark:text-seaop-primary-400 hover:underline focus:outline-none focus-visible:underline"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Je n&apos;ai pas reçu/je ne trouve plus mon numéro
            </button>
          </div>

          <Button
            type="submit"
            variant="primary"
            isLoading={isLoading}
            className="w-full"
          >
            Accéder à mes soumissions
          </Button>
        </form>
      )}

      {/* Client Help Modal — uses shared Modal (handles ESC, backdrop, focus, a11y) */}
      <Modal
        isOpen={showClientHelp}
        onClose={() => setShowClientHelp(false)}
        title="Retrouver votre numéro de référence"
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
              <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <p>
                <strong>1.</strong> Vérifiez votre boîte de courriel (y compris les
                spams) pour un message de <em>Constructo AI SEAOP</em>.
              </p>
              <p>
                <strong>2.</strong> Le numéro commence par{' '}
                <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">SEAOP-</code>{' '}
                suivi de la date et d&apos;un code unique.
              </p>
              <p>
                <strong>3.</strong> Si vous ne le trouvez toujours pas, contactez-nous à{' '}
                <a
                  href="mailto:support@constructoai.ca"
                  className="font-medium text-seaop-primary-600 dark:text-seaop-primary-400 hover:underline"
                >
                  support@constructoai.ca
                </a>{' '}
                avec votre adresse courriel et nous le retrouverons.
              </p>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="primary" onClick={() => setShowClientHelp(false)}>
              Compris
            </Button>
          </div>
        </div>
      </Modal>

      {/* ========= Entrepreneur Tab ========= */}
      {activeTab === 'entrepreneur' && (
        <form onSubmit={handleEntrepreneurSubmit} className="space-y-4">
          <Input
            label="Courriel"
            type="email"
            placeholder="votre@courriel.com"
            value={entEmail}
            onChange={(e) => setEntEmail(e.target.value)}
            error={entEmailError}
            disabled={isLoading}
            autoComplete="email"
          />

          <Input
            label="Mot de passe"
            type="password"
            placeholder="Votre mot de passe"
            value={entPassword}
            onChange={(e) => setEntPassword(e.target.value)}
            error={entPasswordError}
            disabled={isLoading}
            autoComplete="current-password"
          />

          <Button
            type="submit"
            variant="primary"
            isLoading={isLoading}
            className="w-full"
          >
            Se connecter
          </Button>

          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Pas encore de compte?{' '}
            <Link
              to="/register"
              className="font-medium text-seaop-primary-600 hover:text-seaop-primary-500 dark:text-seaop-primary-400 dark:hover:text-seaop-primary-300"
            >
              Créer un compte entrepreneur
            </Link>
          </p>
        </form>
      )}

      {/* ========= Administration Tab (super_admin role) ========= */}
      {activeTab === 'super_admin' && (
        <form onSubmit={handleSuperAdminSubmit} className="space-y-4">
          <Input
            label="Nom d'utilisateur"
            type="text"
            placeholder="Nom d'utilisateur"
            value={saUsername}
            onChange={(e) => setSaUsername(e.target.value)}
            error={saUsernameError}
            disabled={isLoading}
            autoComplete="username"
          />

          <Input
            label="Mot de passe"
            type="password"
            placeholder="Mot de passe"
            value={saPassword}
            onChange={(e) => setSaPassword(e.target.value)}
            error={saPasswordError}
            disabled={isLoading}
            autoComplete="current-password"
          />

          <Button
            type="submit"
            variant="accent"
            isLoading={isLoading}
            className="w-full"
            leftIcon={<ShieldCheck className="h-4 w-4" />}
          >
            Connexion administration
          </Button>
        </form>
      )}
    </div>
  );
};

LoginForm.displayName = 'LoginForm';

export { LoginForm };
