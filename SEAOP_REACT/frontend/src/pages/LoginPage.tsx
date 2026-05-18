/**
 * SEAOP React Frontend - Login Page
 * D365-aligned login matching ERP React visual identity.
 */

import { LoginForm } from '@/components/auth/LoginForm';

const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="w-full max-w-md">
        {DEV_MODE && (
          <div className="mb-6 rounded border border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/30 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Mode développement
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
              Seul l&apos;administration peut se connecter.
            </p>
          </div>
        )}
        <LoginForm />
      </div>
    </div>
  );
}
