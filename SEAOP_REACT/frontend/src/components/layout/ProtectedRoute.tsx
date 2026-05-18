/**
 * SEAOP React Frontend - Protected Route Guard
 * Wraps pages that require authentication or specific roles.
 * Shows a spinner while auth is being checked, redirects if unauthorized.
 */

import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { Spinner } from '@/components/ui/Spinner';

interface Props {
  children: React.ReactNode;
  /** If specified, user must have one of these roles to access the route */
  roles?: string[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && user && !roles.includes(user.userType)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
