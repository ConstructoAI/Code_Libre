/**
 * SEAOP React Frontend - Chat Room Panel
 * Full chat room layout with sidebar, messages, and input area.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { Send, Pin } from 'lucide-react';
import { useChatRoomStore } from '@/store/useChatRoomStore';
import { useAuthStore } from '@/store/useAuthStore';
import { usePolling } from '@/hooks/usePolling';
import ChatMessageItem from './ChatMessageItem';
import OnlineUsers from './OnlineUsers';
import { Spinner } from '@/components/ui/Spinner';

export default function ChatRoomPanel() {
  const {
    messages,
    pinnedMessages,
    onlineUsers,
    stats,
    isLoading,
    error,
    fetchMessages,
    fetchPinnedMessages,
    fetchOnlineUsers,
    fetchStats,
    postMessage,
    toggleLike,
    deleteMessage,
  } = useChatRoomStore();

  const { user, isAuthenticated } = useAuthStore();

  const [inputValue, setInputValue] = useState('');
  const [replyTo, setReplyTo] = useState<number | undefined>(undefined);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Poll messages every 30 seconds
  usePolling(fetchMessages, 30000, true);
  usePolling(fetchPinnedMessages, 60000, true);
  usePolling(fetchOnlineUsers, 30000, isAuthenticated);
  usePolling(fetchStats, 60000, true);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    await postMessage(trimmed, replyTo);
    setInputValue('');
    setReplyTo(undefined);
    setIsSending(false);
  }, [inputValue, replyTo, isSending, postMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleReply = useCallback((id: number) => {
    setReplyTo(id);
  }, []);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] sm:h-[calc(100dvh-8rem)] rounded-none sm:rounded-xl border-0 sm:border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
      {/* Left sidebar: Online users */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <OnlineUsers users={onlineUsers} stats={stats} />
      </aside>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Pinned messages */}
        {pinnedMessages.length > 0 && (
          <div className="border-b border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 px-4 py-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 dark:text-orange-400 mb-1">
              <Pin size={12} />
              <span>Messages épinglés ({pinnedMessages.length})</span>
            </div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {pinnedMessages.map((msg) => (
                <div key={msg.id} className="text-xs text-orange-700 dark:text-orange-300">
                  <span className="font-medium">{msg.userName}:</span> {msg.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3">
          {isLoading && messages.length === 0 && (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          )}

          {error && (
            <div className="text-center py-4 text-sm text-red-500 dark:text-red-400">
              {error}
            </div>
          )}

          {!isLoading && messages.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
              <p className="text-lg font-medium">Bienvenue dans le Chat Room</p>
              <p className="text-sm mt-1">Soyez le premier à écrire un message</p>
            </div>
          )}

          {/* Messages rendered in reverse chronological order (newest first from API),
              but we display oldest first so reverse the array */}
          {[...messages].reverse().map((msg) => (
            <ChatMessageItem
              key={msg.id}
              message={msg}
              currentUserEmail={user?.email}
              isAdmin={user?.userType === 'admin' || user?.userType === 'super_admin'}
              onLike={toggleLike}
              onDelete={deleteMessage}
              onReply={handleReply}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        {isAuthenticated ? (
          <div className="border-t border-gray-200 dark:border-gray-700 px-3 sm:px-4 py-3">
            {/* Reply indicator */}
            {replyTo !== undefined && (
              <div className="flex items-center justify-between mb-2 px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded text-xs text-gray-500 dark:text-gray-400">
                <span>Réponse au message #{replyTo}</span>
                <button
                  type="button"
                  onClick={() => setReplyTo(undefined)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  Annuler
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Écrivez un message..."
                maxLength={5000}
                rows={1}
                className={clsx(
                  'flex-1 resize-none rounded-lg border px-3 py-2 text-base sm:text-sm min-h-[44px] max-h-32 overflow-y-auto',
                  'border-gray-300 dark:border-gray-600',
                  'bg-white dark:bg-gray-700',
                  'text-gray-800 dark:text-gray-100',
                  'placeholder-gray-400 dark:placeholder-gray-500',
                  'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-transparent',
                )}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputValue.trim() || isSending}
                className={clsx(
                  'shrink-0 rounded-lg p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors',
                  inputValue.trim() && !isSending
                    ? 'bg-seaop-primary-600 text-white hover:bg-seaop-primary-700 dark:bg-seaop-primary-500 dark:hover:bg-seaop-primary-600'
                    : 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed',
                )}
                aria-label="Envoyer"
              >
                {isSending ? <Spinner size="sm" className="text-current" /> : <Send size={20} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
            Connectez-vous pour participer à la discussion
          </div>
        )}
      </div>
    </div>
  );
}
