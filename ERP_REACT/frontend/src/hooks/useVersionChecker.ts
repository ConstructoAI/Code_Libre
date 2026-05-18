/**
 * ERP React Frontend - Version Checker Hook
 *
 * Detecte une nouvelle version de l'app deployee sur Render en comparant
 * le hash du chunk principal Vite (ex: /assets/index-BgY5Lj8g.js) vs le
 * hash actuellement charge en memoire.
 *
 * Strategie : capturer le hash au mount via le DOM, puis poll /index.html
 * toutes les N minutes pour comparer. Pas de service worker requis.
 */

import { useEffect, useState, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BUILD_HASH_REGEX = /\/assets\/index-([A-Za-z0-9_-]+)\.js/;

function getCurrentBuildHash(): string | null {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
  );
  for (const s of scripts) {
    const match = s.src.match(BUILD_HASH_REGEX);
    if (match) return match[1];
  }
  return null;
}

async function fetchLatestBuildHash(): Promise<string | null> {
  try {
    const res = await fetch('/index.html', {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(BUILD_HASH_REGEX);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function useVersionChecker(intervalMs: number = DEFAULT_INTERVAL_MS) {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const currentHashRef = useRef<string | null>(null);

  useEffect(() => {
    currentHashRef.current = getCurrentBuildHash();
    // Pas de hash detectable (dev mode HMR ou build atypique) -> hook desactive
    if (!currentHashRef.current) return;

    let cancelled = false;

    const check = async () => {
      const latest = await fetchLatestBuildHash();
      if (cancelled) return;
      if (latest && currentHashRef.current && latest !== currentHashRef.current) {
        setNewVersionAvailable(true);
      }
    };

    check();
    const id = window.setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return { newVersionAvailable };
}
