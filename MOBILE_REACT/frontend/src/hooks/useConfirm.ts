import React, { useCallback, useState } from 'react';
import { ConfirmModal, type ConfirmModalProps } from '@/components/ui/ConfirmModal';

type ConfirmOptions = Omit<ConfirmModalProps, 'isOpen' | 'onConfirm' | 'onCancel'>;

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Hook qui remplace `window.confirm()` par une modale UI custom.
 *
 * Usage:
 *   const { confirm, element } = useConfirm();
 *   const ok = await confirm({ message: 'Supprimer ?', variant: 'danger' });
 *   if (!ok) return;
 *   // ... rendu : <>{element}</> dans le JSX
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const handleConfirm = useCallback(() => {
    if (pending) {
      pending.resolve(true);
      setPending(null);
    }
  }, [pending]);

  const handleCancel = useCallback(() => {
    if (pending) {
      pending.resolve(false);
      setPending(null);
    }
  }, [pending]);

  const element = pending
    ? React.createElement(ConfirmModal, {
        ...pending,
        isOpen: true,
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      })
    : null;

  return { confirm, element };
}
