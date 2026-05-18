/**
 * SEAOP React Frontend - Register Page
 * Simple wrapper around the RegisterForm component.
 */

import { RegisterForm } from '@/components/auth/RegisterForm';

export default function RegisterPage() {
  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="w-full max-w-lg">
        <RegisterForm />
      </div>
    </div>
  );
}
