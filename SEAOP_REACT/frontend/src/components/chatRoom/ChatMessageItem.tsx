/**
 * SEAOP React Frontend - Single Chat Room Message
 * Displays message content, user badge, likes, and action buttons.
 */

import clsx from 'clsx';
import { Heart, Trash2, Reply, Pin } from 'lucide-react';
import type { ChatMessage } from '@/types';

interface Props {
  message: ChatMessage;
  currentUserEmail?: string;
  isAdmin?: boolean;
  onLike: (id: number) => void;
  onDelete: (id: number) => void;
  onReply?: (id: number) => void;
}

/** Map userBadge to an emoji/label */
function getBadge(badge: string | null): { emoji: string; label: string } | null {
  switch (badge) {
    case 'premium':
      return { emoji: '\u2B50', label: 'Premium' };
    case 'rbq':
      return { emoji: '\u2705', label: 'RBQ' };
    case 'entrepreneur':
      return { emoji: '\uD83D\uDD28', label: 'Entrepreneur' };
    case 'client':
      return { emoji: '\uD83C\uDFE0', label: 'Client' };
    case 'admin':
      return { emoji: '\uD83D\uDC51', label: 'Admin' };
    default:
      return null;
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

export default function ChatMessageItem({
  message,
  currentUserEmail,
  isAdmin = false,
  onLike,
  onDelete,
  onReply,
}: Props) {
  const isOwn = currentUserEmail === message.userEmail;
  const canDelete = isOwn || isAdmin;
  const badge = getBadge(message.userBadge);

  return (
    <div
      className={clsx(
        'group rounded-lg border px-3 sm:px-4 py-3 transition-colors',
        message.isPinned
          ? 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
      )}
    >
      {/* Pinned indicator */}
      {message.isPinned && (
        <div className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 mb-2">
          <Pin size={12} />
          <span>Message épinglé</span>
        </div>
      )}

      {/* Header: user info + time */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1.5">
        {badge && (
          <span className="text-sm" title={badge.label}>
            {badge.emoji}
          </span>
        )}
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {message.userName}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {relativeTime(message.createdAt)}
        </span>
        {message.edited && (
          <span className="text-xs text-gray-400 dark:text-gray-500 italic">
            (modifié)
          </span>
        )}
      </div>

      {/* Message body */}
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
        {message.message}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-1 sm:gap-3 mt-2">
        {/* Like button */}
        <button
          type="button"
          onClick={() => onLike(message.id)}
          className={clsx(
            'flex items-center gap-1 text-xs transition-colors min-h-[44px] sm:min-h-0 px-2 sm:px-0',
            message.likedByMe
              ? 'text-red-500 dark:text-red-400'
              : 'text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400',
          )}
          aria-label={message.likedByMe ? 'Retirer le like' : 'Aimer'}
        >
          <Heart size={14} className={clsx(message.likedByMe && 'fill-current')} />
          {message.likes > 0 && <span>{message.likes}</span>}
        </button>

        {/* Reply button */}
        {onReply && (
          <button
            type="button"
            onClick={() => onReply(message.id)}
            className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-seaop-primary-500 dark:hover:text-seaop-primary-400 transition-colors sm:opacity-0 sm:group-hover:opacity-100 min-h-[44px] sm:min-h-0 px-2 sm:px-0"
            aria-label="Répondre"
          >
            <Reply size={14} />
            <span>Répondre</span>
          </button>
        )}

        {/* Delete button */}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors sm:opacity-0 sm:group-hover:opacity-100 min-h-[44px] sm:min-h-0 px-2 sm:px-0"
            aria-label="Supprimer"
          >
            <Trash2 size={14} />
            <span>Supprimer</span>
          </button>
        )}
      </div>
    </div>
  );
}
