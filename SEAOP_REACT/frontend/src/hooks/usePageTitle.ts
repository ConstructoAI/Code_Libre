import { useEffect } from 'react';

const SUFFIX = 'SEAOP';

/**
 * Sets the browser tab title dynamically.
 * Pattern: "<pageTitle> — SEAOP"
 * Pass an empty/null value to keep the default site title.
 */
export function usePageTitle(pageTitle?: string | null) {
  useEffect(() => {
    const previous = document.title;
    const next = pageTitle ? `${pageTitle} — ${SUFFIX}` : SUFFIX;
    document.title = next;
    return () => {
      document.title = previous;
    };
  }, [pageTitle]);
}
