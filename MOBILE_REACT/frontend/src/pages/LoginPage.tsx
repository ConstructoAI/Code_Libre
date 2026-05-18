/**
 * Mobile React Frontend - Login Page
 * Multi-step mobile login: 1) Tenant email+password  2) Employee select  3) PIN entry
 * Visual style aligned with ERP React (D365 Fluent UI inspired).
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, User } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

export default function LoginPage() {
  const navigate = useNavigate();
  const {
    loginStep,
    employees,
    selectedEmployee,
    tenant,
    isLoading,
    error,
    loginTenant,
    selectEmployee,
    loginPin,
    resetLoginStep,
    clearError,
  } = useAuthStore();

  // Step 1 form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Step 3 PIN state
  const [pin, setPin] = useState<string[]>(['', '', '', '']);
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Navigate on successful login
  useEffect(() => {
    if (loginStep === 'done') {
      navigate('/', { replace: true });
    }
  }, [loginStep, navigate]);

  // Auto-focus first PIN input when entering PIN step
  useEffect(() => {
    if (loginStep === 'pin') {
      setPin(['', '', '', '']);
      setTimeout(() => pinRefs.current[0]?.focus(), 50);
    }
  }, [loginStep]);

  // ── Step 1: Tenant login ──────────────────────────────────

  const handleTenantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await loginTenant(email, password);
  };

  // ── Step 2: Employee select ───────────────────────────────

  const handleSelectEmployee = (emp: (typeof employees)[number]) => {
    clearError();
    selectEmployee(emp);
  };

  const handleBackToTenant = () => {
    clearError();
    resetLoginStep();
  };

  // ── Step 3: PIN entry ─────────────────────────────────────

  const handlePinChange = useCallback(
    (index: number, value: string) => {
      // Only accept digits
      const digit = value.replace(/\D/g, '').slice(-1);
      setPin((prev) => {
        const next = [...prev];
        next[index] = digit;

        // Auto-focus next input
        if (digit && index < 3) {
          setTimeout(() => pinRefs.current[index + 1]?.focus(), 0);
        }

        // Auto-submit when all 4 digits are entered
        if (digit && index === 3) {
          const fullPin = next.join('');
          if (fullPin.length === 4) {
            setTimeout(() => loginPin(fullPin), 0);
          }
        }

        return next;
      });
    },
    [loginPin],
  );

  const handlePinKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !pin[index] && index > 0) {
        pinRefs.current[index - 1]?.focus();
      }
    },
    [pin],
  );

  const handleBackToEmployees = () => {
    clearError();
    setPin(['', '', '', '']);
    useAuthStore.setState({ loginStep: 'employee', selectedEmployee: null, error: null });
  };

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navy top bar - matches ERP TopBar #002050 */}
      <div className="bg-[#002050] px-6 pt-[env(safe-area-inset-top)] pb-8 flex flex-col items-center">
        <div className="pt-8 pb-2 flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Constructo AI"
            className="h-10 w-10 object-contain brightness-0 invert opacity-90"
          />
          <div>
            <h1 className="text-xl font-bold text-white">Constructo AI</h1>
            <p className="text-xs text-white/50">Application mobile</p>
          </div>
        </div>
      </div>

      {/* Form area - matches ERP login right panel */}
      <div className="flex-1 flex flex-col items-center px-5 pt-6 pb-6">
        <div className="w-full max-w-sm">
          <div className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] shadow-sm p-6 animate-slide-in-up">
          {/* Error display */}
          {error && (
            <div className="mb-5">
              <Alert type="error" onDismiss={clearError}>
                {error}
              </Alert>
            </div>
          )}

          {/* ── STEP 1: Tenant ─────────────────────────── */}
          {loginStep === 'tenant' && (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                  Connexion entreprise
                </h2>
                <p className="text-xs text-[#605e5c] mt-1">
                  Entrez les identifiants de votre organisation
                </p>
              </div>

              <form onSubmit={handleTenantSubmit} className="space-y-4">
                <Input
                  label="Courriel de l'entreprise"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@monentreprise.ca"
                  required
                  autoFocus
                  autoComplete="email"
                />
                <Input
                  label="Mot de passe"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <Button
                  type="submit"
                  isLoading={isLoading}
                  className="w-full"
                  size="lg"
                >
                  Continuer
                </Button>
              </form>
            </>
          )}

          {/* ── STEP 2: Employee select ────────────────── */}
          {loginStep === 'employee' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <button
                  onClick={handleBackToTenant}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39] transition-colors"
                  aria-label="Retour"
                >
                  <ChevronLeft className="w-5 h-5 text-[#605e5c]" />
                </button>
                <div>
                  <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                    Qui êtes-vous?
                  </h2>
                  {tenant && (
                    <p className="text-sm text-[#605e5c] mt-0.5">
                      {tenant.tenantNom}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2 max-h-[50vh] overflow-y-auto -mx-1 px-1">
                {employees.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => handleSelectEmployee(emp)}
                    className="w-full flex items-center gap-3 p-3 rounded border border-[#edebe9] dark:border-[#3b3a39] bg-white dark:bg-[#292827] hover:border-[#0078D4]/40 hover:bg-[#f3f9fd] dark:hover:bg-[#0078D4]/10 active:scale-[0.98] transition-all min-h-[44px] text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-[#deecf9] dark:bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-[#0078D4] dark:text-[#6cb8f6]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#323130] dark:text-[#f3f2f1] truncate">
                        {emp.prenom} {emp.nom}
                      </p>
                      {emp.poste && (
                        <p className="text-sm text-[#605e5c] truncate">
                          {emp.poste}
                        </p>
                      )}
                    </div>
                  </button>
                ))}

                {employees.length === 0 && (
                  <p className="text-center text-[#605e5c] py-8">
                    Aucun employé trouvé.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── STEP 3: PIN entry ──────────────────────── */}
          {loginStep === 'pin' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <button
                  onClick={handleBackToEmployees}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-[#f3f2f1] dark:hover:bg-[#3b3a39] transition-colors"
                  aria-label="Retour"
                >
                  <ChevronLeft className="w-5 h-5 text-[#605e5c]" />
                </button>
                <div>
                  <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1]">
                    Code NIP
                  </h2>
                  {selectedEmployee && (
                    <p className="text-sm text-[#605e5c] mt-0.5">
                      {selectedEmployee.prenom} {selectedEmployee.nom}
                    </p>
                  )}
                </div>
              </div>

              <p className="text-center text-sm text-[#605e5c] dark:text-[#a19f9d] mb-6">
                Entrez votre code NIP à 4 chiffres
              </p>

              <div className="flex justify-center gap-3 mb-6">
                {pin.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      pinRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handlePinKeyDown(i, e)}
                    className="w-14 h-16 text-center text-2xl font-bold rounded border-2 border-[#8a8886] dark:border-[#605e5c] bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:outline-none focus:ring-1 focus:ring-[#0078D4] focus:border-[#0078D4] dark:focus:ring-[#6cb8f6] dark:focus:border-[#6cb8f6] transition-colors"
                    autoComplete="off"
                    disabled={isLoading}
                  />
                ))}
              </div>

              {isLoading && (
                <div className="flex justify-center">
                  <div className="w-8 h-8 border-[3px] border-[#deecf9] border-t-[#0078D4] rounded-full animate-spin" />
                </div>
              )}

              <Button
                variant="ghost"
                className="w-full"
                onClick={handleBackToEmployees}
                disabled={isLoading}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Retour
              </Button>
            </>
          )}
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-[#a19f9d] mt-6">
            Constructo AI Mobile v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
