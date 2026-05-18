/**
 * B2B Client Portal - Protected Route Guard
 * Redirects unauthenticated B2B clients to /b2b-portal/login.
 */

import { Navigate } from 'react-router-dom';
import { useB2bAuthStore } from '@/store/useB2bAuthStore';

export default function B2bProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useB2bAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/b2b-portal/login" replace />;
  }

  return <>{children}</>;
}
