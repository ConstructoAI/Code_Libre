/**
 * SEAOP React Frontend - Conversation List
 * Left panel showing all conversations, sorted by most recent.
 */

import clsx from 'clsx';
import { MessageSquare, User } from 'lucide-react';

import type { ConversationSummary } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { formatRelativeTime, truncate } from '@/utils/format';

interface Props {
  conversations: ConversationSummary[];
  selectedLeadId?: number;
  selectedEntrepreneurId?: number;
  onSelect: (leadId: number, entrepreneurId: number) => void;
  isLoading?: boolean;
}

function ConversationList({
  conversations,
  selectedLeadId,
  selectedEntrepreneurId,
  onSelect,
  isLoading = false,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <MessageSquare className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Aucune conversation
        </p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Les messages apparaîtront ici.
        </p>
      </div>
    );
  }

  // Sort by most recent message
  const sorted = [...conversations].sort((a, b) => {
    const da = a.lastMessageDate ? new Date(a.lastMessageDate).getTime() : 0;
    const db = b.lastMessageDate ? new Date(b.lastMessageDate).getTime() : 0;
    return db - da;
  });

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700">
      {sorted.map((conv) => {
        const isSelected =
          conv.leadId === selectedLeadId &&
          conv.entrepreneurId === selectedEntrepreneurId;

        return (
          <button
            key={`${conv.leadId}-${conv.entrepreneurId}`}
            type="button"
            onClick={() => onSelect(conv.leadId, conv.entrepreneurId ?? 0)}
            className={clsx(
              'w-full text-left px-4 py-3 transition-colors duration-150',
              'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-seaop-primary-500',
              isSelected
                ? 'bg-seaop-primary-50 dark:bg-seaop-primary-900/20'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
            )}
          >
            <div className="flex items-start gap-3">
              {/* Avatar placeholder */}
              <div className="shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700">
                <User className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              </div>

              <div className="min-w-0 flex-1">
                {/* Name + time row */}
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={clsx(
                      'text-sm font-medium truncate',
                      conv.unreadCount > 0
                        ? 'text-gray-900 dark:text-white'
                        : 'text-gray-700 dark:text-gray-300',
                    )}
                  >
                    {conv.otherPartyName || 'Utilisateur'}
                  </p>
                  <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0">
                    {formatRelativeTime(conv.lastMessageDate)}
                  </span>
                </div>

                {/* Lead reference */}
                {conv.leadNumeroReference && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    Réf: {conv.leadNumeroReference}
                    {conv.leadTypeProjet && ` - ${conv.leadTypeProjet}`}
                  </p>
                )}

                {/* Last message preview + unread badge */}
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p
                    className={clsx(
                      'text-xs truncate',
                      conv.unreadCount > 0
                        ? 'text-gray-700 dark:text-gray-300 font-medium'
                        : 'text-gray-500 dark:text-gray-400',
                    )}
                  >
                    {conv.lastMessage
                      ? truncate(conv.lastMessage, 60)
                      : 'Aucun message'}
                  </p>

                  {conv.unreadCount > 0 && (
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-seaop-primary-600 text-white text-xs font-bold dark:bg-seaop-primary-500">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

ConversationList.displayName = 'ConversationList';

export { ConversationList };
export type { Props as ConversationListProps };
