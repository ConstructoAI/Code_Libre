/**
 * ChannelChatPage - Conversation dans un canal
 * Affichage des messages avec saisie en bas de page.
 */

import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Send, SmilePlus } from 'lucide-react';
import { useMessagesStore } from '@/store/useMessagesStore';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { formatTime } from '@/utils/format';
import type { ChannelMessage } from '@/types';

/** Deterministic colour for avatar initials based on userId. */
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-red-500',
  'bg-cyan-500',
  'bg-amber-500',
];

function getAvatarColor(userId: number): string {
  return AVATAR_COLORS[userId % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (name.slice(0, 2) || '??').toUpperCase();
}

function ChannelChatPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const parsedChannelId = Number(channelId);

  // Selecteurs Zustand individuels (anti-pattern destructuring v5 = risque React #185).
  const channels = useMessagesStore((s) => s.channels);
  const channelMessages = useMessagesStore((s) => s.channelMessages);
  const isLoading = useMessagesStore((s) => s.isLoading);
  const error = useMessagesStore((s) => s.error);
  const fetchChannelMessages = useMessagesStore((s) => s.fetchChannelMessages);
  const sendChannelMessage = useMessagesStore((s) => s.sendChannelMessage);
  const clearError = useMessagesStore((s) => s.clearError);

  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find channel metadata
  const channel = channels.find((c) => c.id === parsedChannelId);

  // Fetch messages on mount / channel change
  useEffect(() => {
    if (!isNaN(parsedChannelId)) {
      fetchChannelMessages(parsedChannelId);
    }
  }, [parsedChannelId, fetchChannelMessages]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending || isNaN(parsedChannelId)) return;

    setIsSending(true);
    try {
      await sendChannelMessage(parsedChannelId, trimmed);
      setText('');
      inputRef.current?.focus();
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-[#1b1a19]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-2 py-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-2 -ml-1 rounded-lg active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
          aria-label="Retour"
        >
          <ChevronLeft className="h-5 w-5 text-gray-700 dark:text-gray-300" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-gray-900 dark:text-white truncate">
            # {channel?.name ?? `Canal ${channelId}`}
          </h1>
          {channel && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {channel.memberCount} membres
            </p>
          )}
        </div>
      </header>

      {/* Error */}
      {error && (
        <Alert type="error" onDismiss={clearError} className="mx-4 mt-3">
          {error}
        </Alert>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isLoading && channelMessages.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {!isLoading && channelMessages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Aucun message pour l&apos;instant. Lancez la conversation!
            </p>
          </div>
        )}

        {channelMessages.map((msg: ChannelMessage) => (
          <div key={msg.id} className="flex items-start gap-3">
            {/* Avatar */}
            <div
              className={`h-8 w-8 rounded-full ${getAvatarColor(msg.userId)} flex items-center justify-center shrink-0`}
            >
              <span className="text-xs font-bold text-white leading-none">
                {getInitials(msg.userName)}
              </span>
            </div>

            {/* Message content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {msg.userName}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {formatTime(msg.createdAt)}
                </span>
                {msg.isEdited && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                    (modifié)
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap break-words">
                {msg.isDeleted ? (
                  <span className="italic text-gray-400 dark:text-gray-500">
                    Message supprimé
                  </span>
                ) : (
                  msg.messageText
                )}
              </p>

              {/* Reactions */}
              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {Object.entries(msg.reactions).map(([emoji, count]) => (
                    <button
                      key={emoji}
                      type="button"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      <span>{emoji}</span>
                      <span>{count}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    aria-label="Ajouter une réaction"
                  >
                    <SmilePlus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar. Bottom padding combines a fixed 12px gap with the iOS
          home-indicator clearance via calc — guarantees visible spacing
          on Android/desktop where `safe-area-bottom` collapses to 0. */}
      <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex items-center gap-2 max-w-lg mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Écrire un message..."
            className="flex-1 min-w-0 rounded-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-4 py-3 text-base text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-transparent min-h-[48px]"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || isSending}
            className="h-11 w-11 rounded-full bg-seaop-primary-600 dark:bg-seaop-primary-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed active:bg-seaop-primary-700 transition-colors"
            aria-label="Envoyer"
          >
            {isSending ? (
              <Spinner size="sm" className="text-white" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChannelChatPage;
