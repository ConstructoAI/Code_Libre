/**
 * Mobile React Frontend - Direct Message Chat Page
 * Conversation view with compose mode for new conversations.
 */

import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Send, Search, User } from 'lucide-react';
import { useMessagesStore } from '@/store/useMessagesStore';
import { useAuthStore } from '@/store/useAuthStore';
import { formatTime } from '@/utils/format';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';

export default function DmChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Selecteurs Zustand individuels (anti-pattern destructuring v5 = risque React #185).
  const dmMessages = useMessagesStore((s) => s.dmMessages);
  const dmEmployees = useMessagesStore((s) => s.dmEmployees);
  const isLoading = useMessagesStore((s) => s.isLoading);
  const error = useMessagesStore((s) => s.error);
  const fetchDmConversation = useMessagesStore((s) => s.fetchDmConversation);
  const fetchDmEmployees = useMessagesStore((s) => s.fetchDmEmployees);
  const sendDm = useMessagesStore((s) => s.sendDm);
  const clearError = useMessagesStore((s) => s.clearError);
  const employee = useAuthStore((s) => s.employee);

  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Compose mode state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState<{
    id: number;
    prenom: string;
    nom: string;
  } | null>(null);

  const isNewConversation = conversationId === 'new';

  useEffect(() => {
    if (isNewConversation) {
      fetchDmEmployees();
    } else if (conversationId) {
      fetchDmConversation(conversationId);
    }
  }, [conversationId, isNewConversation, fetchDmConversation, fetchDmEmployees]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dmMessages]);

  const filteredEmployees = dmEmployees.filter((emp) => {
    if (!searchQuery.trim()) return true;
    const fullName = `${emp.prenom} ${emp.nom}`.toLowerCase();
    return fullName.includes(searchQuery.toLowerCase());
  });

  const otherPartyName = isNewConversation
    ? selectedRecipient
      ? `${selectedRecipient.prenom} ${selectedRecipient.nom}`
      : 'Nouveau message'
    : dmMessages.length > 0
      ? dmMessages.find((m) => m.senderUserId !== employee?.id)?.senderName ??
        'Conversation'
      : 'Conversation';

  const handleSend = async () => {
    const text = messageText.trim();
    if (!text) return;

    setIsSending(true);
    try {
      if (isNewConversation && selectedRecipient) {
        await sendDm(selectedRecipient.id, text);
        navigate('/messages', { replace: true });
      } else if (conversationId && conversationId !== 'new') {
        const recipientId =
          dmMessages.find((m) => m.senderUserId !== employee?.id)
            ?.senderUserId ??
          dmMessages.find((m) => m.recipientUserId !== employee?.id)
            ?.recipientUserId;
        if (recipientId) {
          await sendDm(recipientId, text, conversationId);
        }
      }
      setMessageText('');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-[#1b1a19]">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3">
        <button
          onClick={() => navigate('/messages')}
          className="rounded-lg p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Retour"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-8 w-8 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/40 flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-seaop-primary-600 dark:text-seaop-primary-400" />
          </div>
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
            {otherPartyName}
          </h1>
        </div>
      </header>

      {/* Error */}
      {error && (
        <Alert type="error" onDismiss={clearError} className="mx-3 mt-3">
          {error}
        </Alert>
      )}

      {/* Compose: recipient selection */}
      {isNewConversation && !selectedRecipient && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-3 pt-3 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Rechercher un employé..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-safe">
            {filteredEmployees.length === 0 && (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
                Aucun employé trouvé
              </p>
            )}
            {filteredEmployees.map((emp) => (
              <button
                key={emp.id}
                onClick={() =>
                  setSelectedRecipient({
                    id: emp.id,
                    prenom: emp.prenom,
                    nom: emp.nom,
                  })
                }
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center shrink-0">
                  <User className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {emp.prenom} {emp.nom}
                  </p>
                  {emp.poste && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {emp.poste}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages list */}
      {(!isNewConversation || selectedRecipient) && (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {isLoading && (
              <div className="flex justify-center py-12">
                <Spinner size="lg" />
              </div>
            )}

            {!isLoading && dmMessages.length === 0 && (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-12">
                Aucun message. Envoyez le premier!
              </p>
            )}

            {dmMessages.map((msg) => {
              const isMe = msg.senderUserId === employee?.id;
              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                      isMe
                        ? 'bg-seaop-primary-600 text-white rounded-br-md'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md'
                    }`}
                  >
                    {!isMe && (
                      <p className="text-xs font-semibold text-seaop-primary-600 dark:text-seaop-primary-400 mb-0.5">
                        {msg.senderName}
                      </p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {msg.message}
                    </p>
                    <div
                      className={`flex items-center gap-1.5 mt-1 ${
                        isMe ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <span
                        className={`text-[10px] ${
                          isMe
                            ? 'text-white/70'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {formatTime(msg.createdAt)}
                      </span>
                      {isMe && (
                        <span
                          className={`text-[10px] ${
                            msg.isRead ? 'text-white' : 'text-white/50'
                          }`}
                        >
                          {msg.isRead ? '✓✓' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Message input. Bottom padding combines a fixed 12px gap with
              the iOS home-indicator clearance via calc — guarantees visible
              spacing on Android/desktop where `pb-safe` collapses to 0. */}
          <div className="sticky bottom-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            <div className="flex items-end gap-2">
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Écrire un message..."
                rows={1}
                className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-3.5 py-3 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 max-h-32"
                style={{ minHeight: '48px' }}
              />
              <Button
                onClick={handleSend}
                disabled={
                  !messageText.trim() ||
                  isSending ||
                  (isNewConversation && !selectedRecipient)
                }
                isLoading={isSending}
                size="md"
                className="rounded-xl shrink-0"
                aria-label="Envoyer"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
