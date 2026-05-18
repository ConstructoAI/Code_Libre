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

// Palette pastel harmonisee avec ERP Suivi
const typeStyles: Record<AlertType, string> = {
  info: 'bg-[#7BAFD4]/10 border-[#7BAFD4] text-[#4A7FA8] dark:bg-[#7BAFD4]/15 dark:border-[#7BAFD4]/60 dark:text-[#9BC8E4]',
  success:
    'bg-[#7DC4A5]/10 border-[#7DC4A5] text-[#4A9475] dark:bg-[#7DC4A5]/15 dark:border-[#7DC4A5]/60 dark:text-[#9DD4B5]',
  warning:
    'bg-[#F6C87A]/10 border-[#F6C87A] text-[#9E7B1E] dark:bg-[#F6C87A]/15 dark:border-[#F6C87A]/60 dark:text-[#F6D89A]',
  error:
    'bg-[#E8919A]/10 border-[#E8919A] text-[#B8616A] dark:bg-[#E8919A]/15 dark:border-[#E8919A]/60 dark:text-[#E8A1AA]',
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
