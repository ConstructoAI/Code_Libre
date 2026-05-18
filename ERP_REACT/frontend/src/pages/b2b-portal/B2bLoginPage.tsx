/**
 * B2B Client Portal - Login Page
 * Two-step login: 1) Tenant company email → 2) Client credentials.
 */

import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { ArrowLeft, Building2, ShoppingBag } from 'lucide-react';
import { useB2bAuthStore } from '@/store/useB2bAuthStore';

export default function B2bLoginPage() {
  const navigate = useNavigate();
  const {
    isAuthenticated, tenant, loginStep, isLoading, error,
    lookupTenant, loginClient, clearError, resetLoginStep,
  } = useB2bAuthStore();

  const [tenantEmail, setTenantEmail] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');

  if (isAuthenticated) {
    return <Navigate to="/b2b-portal/dashboard" replace />;
  }

  const handleTenantLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    await lookupTenant(tenantEmail);
  };

  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await loginClient(clientEmail, clientPassword);
    const state = useB2bAuthStore.getState();
    if (state.isAuthenticated) {
      navigate('/b2b-portal/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden md:flex md:w-[420px] bg-[#002050] flex-col justify-between p-10 text-white">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <ShoppingBag size={32} className="text-white/80" />
            <div>
              <h1 className="text-xl font-bold">Portail B2B / C2B</h1>
              <p className="text-xs text-white/50">Constructo AI</p>
            </div>
          </div>
          <h2 className="text-3xl font-bold leading-tight mb-4">
            Portail Client
          </h2>
          <p className="text-white/60 text-sm leading-relaxed">
            Parcourez le catalogue, passez des commandes,
            soumettez des demandes de soumission et suivez vos projets.
          </p>
        </div>
        <div className="text-white/30 text-xs text-center">
          <p>Constructo AI B2B v1.0</p>
          <p className="mt-1">
            <a href="mailto:info@constructoai.ca" className="hover:text-white/50">info@constructoai.ca</a>
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="md:hidden text-center mb-8">
            <ShoppingBag size={40} className="mx-auto mb-3 text-[#0078D4]" />
            <h1 className="text-xl font-bold text-[#323130] dark:text-[#f3f2f1]">Portail B2B / C2B</h1>
          </div>

          <div className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] shadow-sm p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300 flex justify-between items-start">
                <span>{error}</span>
                <button onClick={clearError} className="ml-2 text-red-400 hover:text-red-600">&times;</button>
              </div>
            )}

            {/* Step 1: Tenant identification */}
            {loginStep === 'tenant' && (
              <>
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                    Connexion Client B2B
                  </h2>
                  <p className="text-xs text-[#605e5c] mt-1">
                    Entrez l'email de votre fournisseur pour l'identifier
                  </p>
                </div>
                <form onSubmit={handleTenantLookup} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Email du fournisseur
                    </label>
                    <input
                      type="email"
                      value={tenantEmail}
                      onChange={(e) => setTenantEmail(e.target.value)}
                      placeholder="info@fournisseur.ca"
                      required
                      autoFocus
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2 px-4 bg-[#0078D4] hover:bg-[#106EBE] text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                  >
                    {isLoading ? 'Recherche...' : 'Continuer'}
                  </button>
                </form>
                <div className="mt-4 pt-4 border-t border-[#edebe9] dark:border-[#3b3a39] space-y-2">
                  <button
                    onClick={() => navigate('/b2b-portal/register')}
                    className="w-full text-center text-sm text-[#0078D4] hover:underline font-medium"
                  >
                    Pas de compte? Créer un compte
                  </button>
                  <button
                    onClick={() => navigate('/login')}
                    className="w-full text-center text-sm text-[#605e5c] hover:text-[#323130] transition-colors"
                  >
                    Connexion ERP
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Client credentials */}
            {loginStep === 'credentials' && tenant && (
              <>
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={resetLoginStep} className="p-1 rounded hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39]">
                    <ArrowLeft size={18} className="text-[#605e5c]" />
                  </button>
                  <div>
                    <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                      Connexion Client
                    </h2>
                    <p className="text-xs text-[#605e5c] mt-0.5 flex items-center gap-1">
                      <Building2 size={12} />
                      {tenant.entrepriseNom}
                    </p>
                  </div>
                </div>
                <form onSubmit={handleClientLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Votre email
                    </label>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder="votre@email.ca"
                      required
                      autoFocus
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Mot de passe
                    </label>
                    <input
                      type="password"
                      value={clientPassword}
                      onChange={(e) => setClientPassword(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2 px-4 bg-[#0078D4] hover:bg-[#106EBE] text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                  >
                    {isLoading ? 'Connexion...' : 'Se connecter'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
