/**
 * SEAOP React Frontend - Online Users Sidebar
 * Shows online users with status indicators and chat stats.
 */

import clsx from 'clsx';
import { Users, MessageCircle } from 'lucide-react';
import type { OnlineUser } from '@/types';

interface Props {
  users: OnlineUser[];
  stats: { totalMessages: number; totalParticipants: number };
}

/** Map userType to a badge label */
function getUserTypeBadge(type: string): string {
  switch (type) {
    case 'admin':
    case 'super_admin':
      return 'Admin';
    case 'entrepreneur':
      return 'Entr.';
    case 'client':
      return 'Client';
    default:
      return '';
  }
}

export default function OnlineUsers({ users, stats }: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <Users size={16} />
          En ligne ({users.length})
        </h3>
      </div>

      {/* User list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {users.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
            Aucun utilisateur en ligne
          </p>
        )}
        {users.map((user) => (
          <div
            key={user.userEmail}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {/* Online dot */}
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>

            {/* Name + badge */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-gray-700 dark:text-gray-200 truncate">
                  {user.userName}
                </span>
                {getUserTypeBadge(user.userType) && (
                  <span
                    className={clsx(
                      'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      user.userType === 'admin' || user.userType === 'super_admin'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                        : user.userType === 'entrepreneur'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                    )}
                  >
                    {getUserTypeBadge(user.userType)}
                  </span>
                )}
              </div>

              {/* Typing indicator */}
              {user.isTyping && (
                <p className="text-[10px] text-seaop-primary-500 dark:text-seaop-primary-400 italic">
                  en train d'écrire...
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <MessageCircle size={14} />
          <span>{stats.totalMessages.toLocaleString('fr-CA')} messages</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Users size={14} />
          <span>{stats.totalParticipants.toLocaleString('fr-CA')} participants</span>
        </div>
      </div>
    </div>
  );
}
