/**
 * Hook partage pour verrouiller le scroll du body avec ref-counting.
 *
 * Permet a plusieurs overlays (Modal, DocumentViewer, etc.) de coexister
 * sans desyncronisation: le body n'est libere que lorsque le DERNIER
 * consommateur appelle unlock.
 *
 * Sans ce ref-counting, fermer un overlay alors qu'un autre est encore
 * ouvert relacherait body.overflow et le contenu derriere deviendrait
 * scrollable -- ou pire, fermer le second restaurerait une valeur stale.
 */

import { useEffect } from 'react';

let scrollLockCount = 0;
let originalOverflow: string | null = null;

export function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    // Capturer la valeur courante au 1er lock pour la restaurer au dernier
    // unlock (au cas ou l'app aurait set body.overflow ailleurs).
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

export function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = originalOverflow ?? '';
    originalOverflow = null;
  }
}

/**
 * Hook React: verrouille le body au montage si active=true, libere
 * automatiquement a l'unmount ou quand active passe a false.
 */
export function useScrollLock(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [active]);
}
