/**
 * ERP React Frontend - Protected Route Guard
 */

import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { Spinner } from '@/components/ui/Spinner';

interface Props {
  children: React.ReactNode;
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

  if (roles && user) {
    const userRole = user.role || user.userType;
    if (!roles.includes(userRole)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
