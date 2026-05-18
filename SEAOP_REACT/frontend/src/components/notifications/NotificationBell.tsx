/**
 * SEAOP React Frontend - Notification Bell Icon
 * Displays in the TopBar (navy #002050) with a red badge for unread count.
 * Polls every 60 seconds when authenticated.
 */

import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useNotificationStore } from '@/store/useNotificationStore';
import { usePolling } from '@/hooks/usePolling';
import { useAuthStore } from '@/store/useAuthStore';

export default function NotificationBell() {
  const { unreadCount, fetchUnreadCount } = useNotificationStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const navigate = useNavigate();

  // Poll every 60 seconds when authenticated
  usePolling(fetchUnreadCount, 60000, isAuthenticated);

  return (
    <button
      type="button"
      onClick={() => navigate('/notifications')}
      className="relative rounded-md p-2 text-white/60 hover:bg-white/10 hover:text-white"
      aria-label="Notifications"
    >
      <Bell size={18} />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
