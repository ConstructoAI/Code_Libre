/**
 * SEAOP React Frontend - Notifications Page
 * Full page view of user notifications.
 */

import { useEffect } from 'react';
import { useNotificationStore } from '@/store/useNotificationStore';
import NotificationList from '@/components/notifications/NotificationList';
import { Spinner } from '@/components/ui/Spinner';

export default function NotificationsPage() {
  const { notifications, isLoading, fetchNotifications, markRead, markAllRead } =
    useNotificationStore();

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return (
    <div className="mx-auto max-w-3xl px-2 sm:px-4 py-4 sm:py-6">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 mb-4 sm:mb-6 px-2 sm:px-0">
        Notifications
      </h1>

      {isLoading && notifications.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : (
        <NotificationList
          notifications={notifications}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
        />
      )}
    </div>
  );
}
