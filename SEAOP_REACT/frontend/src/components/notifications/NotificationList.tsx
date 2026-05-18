/**
 * SEAOP React Frontend - Notification List
 * Displays notifications with mark-as-read actions and type icons.
 */

import clsx from 'clsx';
import {
  Bell,
  FileText,
  MessageSquare,
  Star,
  CheckCircle,
  AlertTriangle,
  Info,
} from 'lucide-react';
import type { Notification } from '@/types';
import { Button } from '@/components/ui/Button';

interface Props {
  notifications: Notification[];
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
}

/** Map notification type to an icon */
function getNotificationIcon(type: string) {
  switch (type) {
    case 'soumission':
      return <FileText size={18} className="text-blue-500" />;
    case 'message':
      return <MessageSquare size={18} className="text-green-500" />;
    case 'evaluation':
      return <Star size={18} className="text-yellow-500" />;
    case 'statut':
      return <CheckCircle size={18} className="text-emerald-500" />;
    case 'alerte':
      return <AlertTriangle size={18} className="text-orange-500" />;
    case 'info':
      return <Info size={18} className="text-cyan-500" />;
    default:
      return <Bell size={18} className="text-gray-400" />;
  }
}

/** Format a date string to relative time in French */
function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  return new Date(dateStr).toLocaleDateString('fr-CA');
}

export default function NotificationList({ notifications, onMarkRead, onMarkAllRead }: Props) {
  const hasUnread = notifications.some((n) => !n.lu);

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
        <Bell size={48} className="mb-4 opacity-50" />
        <p className="text-lg font-medium">Aucune notification</p>
        <p className="text-sm mt-1">Vous serez notifié des nouvelles activités</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header actions */}
      {hasUnread && (
        <div className="flex justify-end px-1 sm:px-0">
          <Button variant="ghost" size="sm" onClick={onMarkAllRead} className="w-full sm:w-auto min-h-[44px]">
            Tout marquer comme lu
          </Button>
        </div>
      )}

      {/* Notification items */}
      <ul className="space-y-2">
        {notifications.map((notif) => (
          <li
            key={notif.id}
            onClick={() => {
              if (!notif.lu) onMarkRead(notif.id);
            }}
            className={clsx(
              'flex items-start gap-3 rounded-lg border px-3 sm:px-4 py-3 transition-colors cursor-pointer min-h-[44px]',
              notif.lu
                ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                : 'border-seaop-primary-200 dark:border-seaop-primary-800 bg-seaop-primary-50 dark:bg-seaop-primary-900/20',
              'hover:bg-gray-50 dark:hover:bg-gray-800',
            )}
          >
            {/* Unread indicator */}
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              {!notif.lu && (
                <span className="h-2.5 w-2.5 rounded-full bg-seaop-primary-500" />
              )}
              {notif.lu && <span className="h-2.5 w-2.5" />}
              {getNotificationIcon(notif.typeNotification)}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p
                className={clsx(
                  'text-sm font-medium break-words',
                  notif.lu
                    ? 'text-gray-700 dark:text-gray-300'
                    : 'text-gray-900 dark:text-gray-100',
                )}
              >
                {notif.titre}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-3 sm:line-clamp-2">
                {notif.message}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {relativeTime(notif.dateCreation)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
