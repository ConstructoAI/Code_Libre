/**
 * ERP React Frontend - Idle Reload Hook
 *
 * Quand une nouvelle version est disponible, declenche un reload silencieux
 * pendant les periodes d'inactivite utilisateur :
 *  - apres N minutes sans evenement clavier/souris/scroll/touch
 *  - quand l'onglet est cache (document.hidden via visibilitychange)
 *
 * Resultat UX : l'utilisateur actif voit la banniere ; l'utilisateur en pause
 * retrouve l'app deja a jour sans interruption visible.
 *
 * PROTECTION SAISIE : si un champ input/textarea/contenteditable a le focus,
 * le reload est differe (l'utilisateur est probablement en train de saisir
 * meme sans bouger la souris). Le timer est resched pour retry plus tard.
 */

import { useEffect, useRef } from 'react';

const DEFAULT_IDLE_MS = 5 * 60 * 1000; // 5 minutes
const FOCUSED_RETRY_MS = 60 * 1000; // si champ focused, retry dans 1 min

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousemove',
  'keydown',
  'click',
  'scroll',
  'touchstart',
];

function hasFocusedEditableElement(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.getAttribute('contenteditable') === 'true') return true;
  return false;
}

export function useIdleReload(enabled: boolean, idleMs: number = DEFAULT_IDLE_MS) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const attemptReload = () => {
      // Protection : ne pas reload si l'utilisateur est en train de saisir
      // (champ a le focus, meme sans evenement clavier/souris recent).
      if (hasFocusedEditableElement()) {
        timerRef.current = window.setTimeout(attemptReload, FOCUSED_RETRY_MS);
        return;
      }
      window.location.reload();
    };

    const resetTimer = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(attemptReload, idleMs);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        // Onglet en arriere-plan : reload immediat, l'utilisateur ne le voit pas.
        // Pas de protection focus ici car Alt+Tab volontaire = utilisateur a
        // change de contexte.
        window.location.reload();
      } else {
        resetTimer();
      }
    };

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, resetTimer, { passive: true }),
    );
    document.addEventListener('visibilitychange', onVisibilityChange);

    resetTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer));
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, idleMs]);
}
