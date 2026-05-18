import React from 'react';
import clsx from 'clsx';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

export interface AlertModalProps {
  isOpen: boolean;
  title?: string;
  message: React.ReactNode;
  type?: AlertType;
  okLabel?: string;
  onClose: () => void;
}

const TYPE_CONFIG: Record<AlertType, { Icon: React.ElementType; color: string; bg: string }> = {
  info: { Icon: Info, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  success: { Icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20' },
  warning: { Icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  error: { Icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
};

const DEFAULT_TITLES: Record<AlertType, string> = {
  info: 'Information',
  success: 'Succes',
  warning: 'Attention',
  error: 'Erreur',
};

const AlertModal: React.FC<AlertModalProps> = ({
  isOpen,
  title,
  message,
  type = 'info',
  okLabel = 'OK',
  onClose,
}) => {
  const { Icon, color, bg } = TYPE_CONFIG[type];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || DEFAULT_TITLES[type]}>
      <div className="space-y-4">
        <div className={clsx('flex items-start gap-3 rounded-lg p-3', bg)}>
          <Icon className={clsx('h-5 w-5 flex-shrink-0 mt-0.5', color)} aria-hidden="true" />
          <div className="text-sm text-gray-700 dark:text-gray-300">{message}</div>
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className={clsx(
              'min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium text-white',
              'bg-seaop-primary-600 hover:bg-seaop-primary-700',
            )}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};

AlertModal.displayName = 'AlertModal';

export { AlertModal };
