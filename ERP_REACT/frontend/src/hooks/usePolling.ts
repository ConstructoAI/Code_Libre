/**
 * ERP React Frontend - Generic Polling Hook
 * Calls a callback immediately then on a fixed interval.
 */

import { useEffect, useRef } from 'react';

export function usePolling(callback: () => void, intervalMs: number, enabled = true) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    savedCallback.current(); // Run immediately
    const id = setInterval(() => savedCallback.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}
