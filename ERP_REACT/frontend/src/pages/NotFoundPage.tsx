/**
 * ERP React Frontend - 404 Page
 */

import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <p className="text-7xl font-bold text-gray-200 dark:text-gray-700">404</p>
      <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
        Page non trouvée
      </h2>
      <p className="mt-2 text-gray-500 dark:text-gray-400">
        La page que vous cherchez n'existe pas ou a été déplacée.
      </p>
      <Button
        className="mt-6"
        leftIcon={<Home size={16} />}
        onClick={() => navigate('/dashboard')}
      >
        Retour au tableau de bord
      </Button>
    </div>
  );
}
