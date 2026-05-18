import React from 'react';
import clsx from 'clsx';
import { Modal } from './Modal';

export interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title = 'Confirmer',
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'default',
  onConfirm,
  onCancel,
  loading = false,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-gray-700 dark:text-gray-300">{message}</div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className={clsx(
              'min-h-[44px] rounded-lg border px-4 py-2 text-sm font-medium',
              'border-gray-300 dark:border-gray-600',
              'bg-white dark:bg-gray-800',
              'text-gray-700 dark:text-gray-300',
              'hover:bg-gray-50 dark:hover:bg-gray-700',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={clsx(
              'min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium text-white',
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-seaop-primary-600 hover:bg-seaop-primary-700',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loading ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};

ConfirmModal.displayName = 'ConfirmModal';

export { ConfirmModal };
