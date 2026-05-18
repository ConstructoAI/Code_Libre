import React from 'react';
import clsx from 'clsx';
import { Info, CheckCircle, AlertTriangle, XCircle, X } from 'lucide-react';

type AlertType = 'info' | 'success' | 'warning' | 'error';

interface AlertProps {
  type: AlertType;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
}

const typeStyles: Record<AlertType, string> = {
  info: 'bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300',
  success:
    'bg-green-50 border-green-300 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300',
  warning:
    'bg-yellow-50 border-yellow-300 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-yellow-300',
  error:
    'bg-red-50 border-red-300 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300',
};

const iconMap: Record<AlertType, React.FC<React.SVGProps<SVGSVGElement>>> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
};

const Alert: React.FC<AlertProps> = ({ type, title, children, onClose }) => {
  const IconComponent = iconMap[type];

  return (
    <div
      className={clsx(
        'flex items-start gap-3 rounded-lg border p-4',
        typeStyles[type],
      )}
      role="alert"
    >
      <IconComponent className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />

      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold mb-1">{title}</p>}
        <div className="text-sm">{children}</div>
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className={clsx(
            'shrink-0 rounded-lg p-1 transition-colors duration-150',
            'hover:bg-black/10 dark:hover:bg-white/10',
            'focus:outline-none focus:ring-2 focus:ring-current',
          )}
          aria-label="Dismiss alert"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

Alert.displayName = 'Alert';

export { Alert };
export type { AlertProps, AlertType };
