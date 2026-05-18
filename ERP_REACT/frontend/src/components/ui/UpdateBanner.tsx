/**
 * ERP React Frontend - Update Banner
 *
 * Bannière discrète affichée en haut de l'AppLayout quand une nouvelle
 * version de l'app a été déployée. L'utilisateur peut :
 *  - cliquer "Recharger maintenant" pour appliquer immédiatement
 *  - cliquer "X" pour masquer la bannière (l'auto-reload reste actif)
 *
 * En complément, useIdleReload déclenche un reload silencieux après 5 min
 * d'inactivité (avec protection champ focused) ou quand l'onglet passe en
 * arrière-plan.
 */

import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useVersionChecker } from '@/hooks/useVersionChecker';
import { useIdleReload } from '@/hooks/useIdleReload';

export function UpdateBanner() {
  const { newVersionAvailable } = useVersionChecker();
  const [dismissed, setDismissed] = useState(false);

  // Auto-reload pendant inactivité reste actif même si l'utilisateur a
  // masqué la bannière (il sera bien servi lors de sa prochaine pause).
  useIdleReload(newVersionAvailable);

  if (!newVersionAvailable || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-[#0078D4] text-white shadow-md dark:bg-[#005ea2]"
    >
      <div className="mx-auto flex flex-wrap items-center justify-center gap-2 px-4 py-2 sm:gap-3">
        <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">
          Une mise à jour vient d'être déployée. Veuillez recharger la page.
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="ml-2 rounded bg-white/25 px-3 py-1 text-sm font-medium transition-colors hover:bg-white/35 focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          Recharger maintenant
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-1 rounded p-1 transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
          aria-label="Masquer la bannière"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
