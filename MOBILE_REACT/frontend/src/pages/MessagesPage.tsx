/**
 * MessagesPage - Hub de messagerie
 * Onglets Canaux et Messages directs.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Hash,
  Lock,
  MessageCircle,
  Plus,
  Users,
  ChevronRight,
  X,
} from 'lucide-react';
import { useMessagesStore } from '@/store/useMessagesStore';
import { createChannel } from '@/api/messages';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { formatRelativeTime, truncate } from '@/utils/format';
import type { Channel, ConversationSummary } from '@/types';

type Tab = 'channels' | 'dm';

function MessagesPage() {
  const navigate = useNavigate();
  // Selecteurs Zustand individuels (anti-pattern destructuring v5 = risque React #185).
  const channels = useMessagesStore((s) => s.channels);
  const conversations = useMessagesStore((s) => s.conversations);
  const isLoading = useMessagesStore((s) => s.isLoading);
  const error = useMessagesStore((s) => s.error);
  const fetchChannels = useMessagesStore((s) => s.fetchChannels);
  const fetchConversations = useMessagesStore((s) => s.fetchConversations);
  const clearError = useMessagesStore((s) => s.clearError);

  const [activeTab, setActiveTab] = useState<Tab>('channels');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateChannel = async () => {
    if (!channelName.trim() || creating) return;
    setCreating(true);
    try {
      await createChannel({ name: channelName.trim(), description: channelDesc.trim() || undefined });
      setShowCreateChannel(false);
      setChannelName('');
      setChannelDesc('');
      fetchChannels();
    } catch {
      // show inline error via store
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    fetchChannels();
    fetchConversations();
  }, [fetchChannels, fetchConversations]);

  return (
    <div className="min-h-full bg-transparent dark:bg-[#1b1a19]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
            Messages
          </h1>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setActiveTab('channels')}
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
              activeTab === 'channels'
                ? 'text-seaop-primary-600 dark:text-seaop-primary-400 border-b-2 border-seaop-primary-600 dark:border-seaop-primary-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            Canaux
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('dm')}
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
              activeTab === 'dm'
                ? 'text-seaop-primary-600 dark:text-seaop-primary-400 border-b-2 border-seaop-primary-600 dark:border-seaop-primary-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            Messages directs
          </button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <Alert type="error" onDismiss={clearError} className="mx-4 mt-3">
          {error}
        </Alert>
      )}

      <main className="max-w-lg mx-auto">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {/* Channels tab */}
        {!isLoading && activeTab === 'channels' && (
          <>
            {channels.length === 0 ? (
              <div className="text-center py-16 px-4">
                <Hash className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  Aucun canal disponible
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {channels.map((channel: Channel) => (
                  <li key={channel.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/messages/channel/${channel.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-100 dark:active:bg-gray-750 transition-colors"
                    >
                      {/* Channel icon */}
                      <div className="h-10 w-10 rounded-lg bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center shrink-0">
                        {channel.isPrivate ? (
                          <Lock className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
                        ) : (
                          <Hash className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
                        )}
                      </div>

                      {/* Channel info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {channel.name}
                          </p>
                          {channel.unreadCount > 0 && (
                            <Badge variant="danger">
                              {channel.unreadCount}
                            </Badge>
                          )}
                        </div>
                        {channel.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                            {truncate(channel.description, 60)}
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                          <Users className="h-3 w-3" />
                          <span>{channel.memberCount}</span>
                        </div>
                      </div>

                      <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* DM tab */}
        {!isLoading && activeTab === 'dm' && (
          <>
            {conversations.length === 0 ? (
              <div className="text-center py-16 px-4">
                <MessageCircle className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  Aucune conversation
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {conversations.map((convo: ConversationSummary) => (
                  <li key={convo.conversationId}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/messages/dm/${convo.conversationId}`)
                      }
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-100 dark:active:bg-gray-750 transition-colors"
                    >
                      {/* Avatar initial */}
                      <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-gray-600 dark:text-gray-300 uppercase">
                          {convo.otherPartyName?.charAt(0) || '?'}
                        </span>
                      </div>

                      {/* Conversation info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {convo.otherPartyName}
                          </p>
                          <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0">
                            {formatRelativeTime(convo.lastMessageAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {truncate(convo.lastMessage, 50)}
                          </p>
                          {convo.unreadCount > 0 && (
                            <Badge variant="danger" className="shrink-0">
                              {convo.unreadCount}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      {/* FAB - Nouveau message / Nouveau canal */}
      {activeTab === 'dm' && (
        <button
          type="button"
          onClick={() => navigate('/messages/dm/new')}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 w-14 rounded-full bg-seaop-primary-600 dark:bg-seaop-primary-500 text-white shadow-lg flex items-center justify-center active:bg-seaop-primary-700 transition-colors"
          aria-label="Nouveau message"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}
      {activeTab === 'channels' && (
        <button
          type="button"
          onClick={() => setShowCreateChannel(true)}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 w-14 rounded-full bg-seaop-primary-600 dark:bg-seaop-primary-500 text-white shadow-lg flex items-center justify-center active:bg-seaop-primary-700 transition-colors"
          aria-label="Nouveau canal"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowCreateChannel(false)}
          />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-5 pb-8 animate-slide-up-sheet">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Nouveau canal
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateChannel(false)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nom du canal *
                </label>
                <input
                  type="text"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  placeholder="ex: general"
                  maxLength={100}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={channelDesc}
                  onChange={(e) => setChannelDesc(e.target.value)}
                  placeholder="Description du canal..."
                  maxLength={500}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 outline-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateChannel(false)}
                  className="flex-1 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleCreateChannel}
                  disabled={!channelName.trim() || creating}
                  className="flex-1 py-2.5 rounded-lg bg-seaop-primary-600 text-white text-sm font-medium hover:bg-seaop-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creating ? 'Création...' : 'Créer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MessagesPage;
