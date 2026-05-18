/**
 * SEAOP React Frontend - Chat Thread
 * Message thread display with input for sending new messages.
 */

import { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Send, Check, CheckCheck, User } from 'lucide-react';

import type { Message } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { formatRelativeTime } from '@/utils/format';

interface Props {
  messages: Message[];
  currentUserType: string;
  currentUserId: number;
  onSend: (message: string) => void;
  isLoading?: boolean;
  leadNom?: string;
  otherPartyName?: string;
}

function ChatThread({
  messages,
  currentUserType,
  currentUserId,
  onSend,
  isLoading = false,
  leadNom,
  otherPartyName,
}: Props) {
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend() {
    const trimmed = newMessage.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    try {
      onSend(trimmed);
      setNewMessage('');
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function isMine(msg: Message): boolean {
    return msg.expediteurType === currentUserType && msg.expediteurId === currentUserId;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700">
            <User className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {otherPartyName || 'Conversation'}
            </p>
            {leadNom && (
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {leadNom}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Aucun message pour le moment.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Envoyez le premier message.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const mine = isMine(msg);
            return (
              <div
                key={msg.id}
                className={clsx(
                  'flex',
                  mine ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={clsx(
                    'max-w-[75%] rounded-2xl px-4 py-2.5',
                    mine
                      ? 'bg-seaop-primary-600 text-white dark:bg-seaop-primary-500 rounded-br-md'
                      : 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100 rounded-bl-md',
                  )}
                >
                  {/* Sender name (for received messages) */}
                  {!mine && (
                    <p
                      className={clsx(
                        'text-xs font-medium mb-1',
                        'text-gray-500 dark:text-gray-400',
                      )}
                    >
                      {msg.expediteurType === 'entrepreneur'
                        ? 'Entrepreneur'
                        : 'Client'}
                    </p>
                  )}

                  {/* Message text */}
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {msg.message}
                  </p>

                  {/* Timestamp + read indicator */}
                  <div
                    className={clsx(
                      'flex items-center gap-1 mt-1',
                      mine ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <span
                      className={clsx(
                        'text-[10px]',
                        mine
                          ? 'text-white/70'
                          : 'text-gray-400 dark:text-gray-500',
                      )}
                    >
                      {formatRelativeTime(msg.dateEnvoi)}
                    </span>
                    {mine && (
                      msg.lu ? (
                        <CheckCheck className="h-3 w-3 text-white/70" />
                      ) : (
                        <Check className="h-3 w-3 text-white/70" />
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Écrivez votre message..."
            rows={1}
            className={clsx(
              'flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm transition-colors duration-150',
              'bg-gray-50 dark:bg-gray-900',
              'text-gray-900 dark:text-gray-100',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'border-gray-200 dark:border-gray-600',
              'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500',
              'max-h-32',
            )}
            style={{ minHeight: '42px' }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!newMessage.trim() || isSending}
            className={clsx(
              'inline-flex items-center justify-center rounded-xl p-2.5 transition-colors duration-150',
              'focus:outline-none focus:ring-2 focus:ring-seaop-primary-500',
              newMessage.trim() && !isSending
                ? 'bg-seaop-primary-600 text-white hover:bg-seaop-primary-700 dark:bg-seaop-primary-500 dark:hover:bg-seaop-primary-600'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500',
            )}
            aria-label="Envoyer"
          >
            {isSending ? (
              <Spinner size="sm" className="text-current" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

ChatThread.displayName = 'ChatThread';

export { ChatThread };
export type { Props as ChatThreadProps };
