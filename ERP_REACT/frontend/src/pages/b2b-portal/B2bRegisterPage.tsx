/**
 * B2B Client Portal - Register Page (Self-registration)
 * Two-step: 1) Tenant lookup by email → 2) Client registration form.
 * Flow fidèle au Streamlit legacy: compte créé avec active=FALSE en
 * attente d'approbation du fournisseur.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, ShoppingBag, CheckCircle2 } from 'lucide-react';
import {
  b2bTenantLookup,
  b2bClientRegister,
  type B2bTenantInfo,
} from '@/api/b2b-portal-auth';

type Step = 'tenant' | 'form' | 'success';

export default function B2bRegisterPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('tenant');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<B2bTenantInfo | null>(null);

  // Step 1
  const [tenantEmail, setTenantEmail] = useState('');

  // Step 2
  const [form, setForm] = useState({
    email: '',
    password: '',
    passwordConfirm: '',
    nom: '',
    companyNom: '',
    telephone: '',
    adresse: '',
    ville: '',
    province: 'Quebec',
    codePostal: '',
  });

  const clearError = () => setError(null);

  const handleTenantLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const info = await b2bTenantLookup(tenantEmail.trim());
      setTenant(info);
      setStep('form');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : null;
      setError(msg || 'Fournisseur introuvable. Vérifiez l\'email.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Validation client-side
    if (form.password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères');
      setIsLoading(false);
      return;
    }
    if (form.password !== form.passwordConfirm) {
      setError('Les mots de passe ne correspondent pas');
      setIsLoading(false);
      return;
    }
    if (!tenant) {
      setError('Fournisseur non identifié');
      setIsLoading(false);
      return;
    }

    try {
      await b2bClientRegister({
        schemaName: tenant.schemaName,
        email: form.email.trim(),
        password: form.password,
        nom: form.nom.trim(),
        companyNom: form.companyNom.trim(),
        telephone: form.telephone || undefined,
        adresse: form.adresse || undefined,
        ville: form.ville || undefined,
        province: form.province || undefined,
        codePostal: form.codePostal || undefined,
      });
      setStep('success');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : null;
      setError(msg || 'Erreur lors de la création du compte');
    } finally {
      setIsLoading(false);
    }
  };

  const resetToTenant = () => {
    setStep('tenant');
    setTenant(null);
    setError(null);
    setForm({
      email: '',
      password: '',
      passwordConfirm: '',
      nom: '',
      companyNom: '',
      telephone: '',
      adresse: '',
      ville: '',
      province: 'Quebec',
      codePostal: '',
    });
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
            Créer votre compte
          </h2>
          <p className="text-white/60 text-sm leading-relaxed">
            Inscrivez-vous pour accéder au portail client de votre fournisseur.
            Votre demande sera validée par l'entreprise avant activation.
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
        <div className="w-full max-w-md">
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

            {/* Step 1: Tenant lookup */}
            {step === 'tenant' && (
              <>
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                    Créer un compte client
                  </h2>
                  <p className="text-xs text-[#605e5c] mt-1">
                    Étape 1 sur 2 — Identifier votre fournisseur
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
                    <p className="mt-1 text-xs text-[#605e5c]">
                      Demandez cet email à votre contact chez le fournisseur.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading || !tenantEmail.trim()}
                    className="w-full py-2 px-4 bg-[#0078D4] hover:bg-[#106EBE] text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                  >
                    {isLoading ? 'Recherche...' : 'Continuer'}
                  </button>
                </form>
                <div className="mt-4 pt-4 border-t border-[#edebe9] dark:border-[#3b3a39] text-center">
                  <button
                    onClick={() => navigate('/b2b-portal/login')}
                    className="text-sm text-[#0078D4] hover:underline"
                  >
                    Déjà un compte? Se connecter
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Registration form */}
            {step === 'form' && tenant && (
              <>
                <div className="flex items-center gap-3 mb-6">
                  <button
                    onClick={resetToTenant}
                    className="p-1 rounded hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39]"
                    type="button"
                  >
                    <ArrowLeft size={18} className="text-[#605e5c]" />
                  </button>
                  <div>
                    <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                      Vos informations
                    </h2>
                    <p className="text-xs text-[#605e5c] mt-0.5 flex items-center gap-1">
                      <Building2 size={12} />
                      {tenant.entrepriseNom}
                    </p>
                  </div>
                </div>
                <form onSubmit={handleRegister} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Nom de votre entreprise *
                    </label>
                    <input
                      type="text"
                      value={form.companyNom}
                      onChange={(e) => setForm({ ...form, companyNom: e.target.value })}
                      placeholder="Acme Construction Inc."
                      required
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Votre nom complet *
                    </label>
                    <input
                      type="text"
                      value={form.nom}
                      onChange={(e) => setForm({ ...form, nom: e.target.value })}
                      placeholder="Jean Dupont"
                      required
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Votre email *
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="votre@email.ca"
                      required
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Téléphone
                    </label>
                    <input
                      type="tel"
                      value={form.telephone}
                      onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                      placeholder="(514) 555-0100"
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                        Ville
                      </label>
                      <input
                        type="text"
                        value={form.ville}
                        onChange={(e) => setForm({ ...form, ville: e.target.value })}
                        placeholder="Montréal"
                        className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                        Code postal
                      </label>
                      <input
                        type="text"
                        value={form.codePostal}
                        onChange={(e) => setForm({ ...form, codePostal: e.target.value })}
                        placeholder="H1A 1A1"
                        className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Mot de passe * <span className="text-xs text-[#605e5c]">(min. 6 caractères)</span>
                    </label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required
                      minLength={6}
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                      Confirmer le mot de passe *
                    </label>
                    <input
                      type="password"
                      value={form.passwordConfirm}
                      onChange={(e) => setForm({ ...form, passwordConfirm: e.target.value })}
                      required
                      minLength={6}
                      className="w-full px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] focus:ring-1 focus:ring-[#0078D4] outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2 px-4 bg-[#0078D4] hover:bg-[#106EBE] text-white text-sm font-medium rounded transition-colors disabled:opacity-50 mt-2"
                  >
                    {isLoading ? 'Création en cours...' : 'Créer mon compte'}
                  </button>
                </form>
              </>
            )}

            {/* Step 3: Success */}
            {step === 'success' && tenant && (
              <div className="text-center py-4">
                <div className="mx-auto w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
                  <CheckCircle2 size={32} className="text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1] mb-2">
                  Demande envoyée!
                </h2>
                <p className="text-sm text-[#605e5c] mb-4">
                  Votre demande d'accès a été envoyée à <strong>{tenant.entrepriseNom}</strong>.
                  Vous recevrez un accès dès que le fournisseur aura approuvé votre demande.
                </p>
                <p className="text-xs text-[#605e5c] mb-6">
                  Vous pouvez fermer cette page. Essayez de vous connecter plus tard.
                </p>
                <button
                  onClick={() => navigate('/b2b-portal/login')}
                  className="w-full py-2 px-4 bg-[#0078D4] hover:bg-[#106EBE] text-white text-sm font-medium rounded transition-colors"
                >
                  Retour à la connexion
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
