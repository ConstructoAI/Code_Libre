/**
 * ERP React Frontend - Registration Page
 * New company signup → Stripe Checkout for payment → account creation via webhook.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { register, fetchPublicRepresentants } from '@/api/auth';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [representants, setRepresentants] = useState<{id: number; nom: string}[]>([]);
  const [representant, setRepresentant] = useState('');

  const checkoutCanceled = searchParams.get('checkout') === 'cancel';

  useEffect(() => {
    fetchPublicRepresentants().then(res => setRepresentants(res.items)).catch(() => {});
  }, []);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    setIsLoading(true);
    try {
      const result = await register(companyName, email, password, 'pro', representant);
      // Redirect to Stripe Checkout
      window.location.href = result.checkoutUrl;
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string }; status?: number } };
      if (axiosErr.response?.status === 409) {
        setError('Cet email est déjà utilisé. Essayez de vous connecter.');
      } else if (axiosErr.response?.data?.detail) {
        setError(axiosErr.response.data.detail);
      } else {
        setError('Erreur lors de l\'inscription. Veuillez réessayer.');
      }
      setIsLoading(false);
    }
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
          <h2 className="text-3xl font-bold leading-tight mb-4">Démarrez votre essai</h2>
          <p className="text-white/60 text-sm leading-relaxed mb-8">
            Créez votre compte entreprise en quelques minutes.
            Gérez vos soumissions, projets, employés et comptabilité
            — propulsé par l'intelligence artificielle.
          </p>
          <ul className="space-y-3 text-white/50 text-sm">
            <li className="flex items-center gap-2">
              <ArrowRight size={14} className="text-white/30" />
              Soumissions et devis professionnels
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight size={14} className="text-white/30" />
              Gestion de projets de construction
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight size={14} className="text-white/30" />
              Comptabilité et facturation intégrées
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight size={14} className="text-white/30" />
              Estimation IA et métré PDF
            </li>
          </ul>
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

      {/* Right panel — registration form */}
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
            {checkoutCanceled && (
              <Alert type="warning" onClose={() => navigate('/register', { replace: true })}>
                Paiement annulé. Vous pouvez réessayer.
              </Alert>
            )}

            {error && (
              <Alert type="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <div className="mb-6">
              <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                Créer un compte
              </h2>
              <p className="text-xs text-[#605e5c] mt-1">
                Inscrivez votre entreprise pour commencer
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Nom de l'entreprise"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Construction ABC Inc."
                required
                autoFocus
              />
              <Input
                label="Email de l'entreprise"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="info@monentreprise.ca"
                required
              />
              <Input
                label="Mot de passe"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 caractères"
                required
              />
              <Input
                label="Confirmer le mot de passe"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />

              {representants.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-[#323130] dark:text-[#f3f2f1] mb-1">
                    Représentant (optionnel)
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4]"
                    value={representant}
                    onChange={(e) => setRepresentant(e.target.value)}
                  >
                    <option value="">-- Aucun --</option>
                    {representants.map(r => (
                      <option key={r.id} value={r.nom}>{r.nom}</option>
                    ))}
                  </select>
                </div>
              )}

              <Button type="submit" isLoading={isLoading} className="w-full">
                Continuer vers le paiement
              </Button>
            </form>

            <div className="mt-4 pt-4 border-t border-[#edebe9] dark:border-[#3b3a39]">
              <button
                onClick={() => navigate('/login')}
                className="w-full text-center text-xs text-[#a19f9d] hover:text-[#0078D4] transition-colors"
              >
                Déjà un compte ? Se connecter
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
