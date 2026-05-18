import React, { useCallback, useState } from 'react';
import { AlertModal, type AlertModalProps } from '@/components/ui/AlertModal';

type AlertOptions = Omit<AlertModalProps, 'isOpen' | 'onClose'>;

interface PendingAlert extends AlertOptions {
  resolve: () => void;
}

/**
 * Hook qui remplace `window.alert()` par une modale UI custom (asynchrone).
 *
 * Usage:
 *   const { alert: showAlert, element } = useAlert();
 *   await showAlert({ message: 'Le nom est requis', type: 'warning' });
 *   // rendu : <>{element}</> dans le JSX
 */
export function useAlert() {
  const [pending, setPending] = useState<PendingAlert | null>(null);

  const alert = useCallback(
    (opts: AlertOptions): Promise<void> =>
      new Promise<void>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const handleClose = useCallback(() => {
    if (pending) {
      pending.resolve();
      setPending(null);
    }
  }, [pending]);

  const element = pending
    ? React.createElement(AlertModal, {
        ...pending,
        isOpen: true,
        onClose: handleClose,
      })
    : null;

  return { alert, element };
}
