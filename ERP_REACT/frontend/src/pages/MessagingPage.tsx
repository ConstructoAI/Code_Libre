/**
 * ERP React Frontend - Messaging Page
 * Teams-like internal messaging with channels, messages, reactions.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Hash, Plus, Send, MessageSquare, Search, Users, X, ChevronLeft, Smile,
} from 'lucide-react';
import * as msgApi from '@/api/messaging';
import type { Channel, ChannelMessage } from '@/api/messaging';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { formatRelativeTime } from '@/utils/format';
import { usePolling } from '@/hooks/usePolling';

const EMOJI_REACTIONS = ['👍', '❤️', '😄', '🎉', '🤔', '👀'];

export default function MessagingPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const prevMsgLenRef = useRef(0);
  const prevChannelIdRef = useRef<number | null>(null);
  const pendingReactionsRef = useRef<Set<string>>(new Set());

  const fetchChannels = useCallback(async () => {
    try {
      const res = await msgApi.listChannels();
      setChannels(res.items);
      // Auto-select first channel only on initial load
      setActiveChannel((prev) => {
        if (prev) return prev;
        return res.items.length > 0 ? res.items[0] : null;
      });
    } catch {
      setError('Erreur lors du chargement des canaux');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!activeChannel) return;
    try {
      const res = await msgApi.getChannelMessages(activeChannel.id);
      setMessages(res.items);
    } catch {
      // Silent fail for polling
    }
  }, [activeChannel]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    if (activeChannel) {
      fetchMessages();
    }
  }, [activeChannel, fetchMessages]);

  // Poll for new messages every 30s
  usePolling(fetchMessages, 30000, !!activeChannel);

  // Auto-scroll: seulement si nouveau message arrive OU changement de canal
  useEffect(() => {
    const channelChanged = activeChannel?.id !== prevChannelIdRef.current;
    const newMessagesArrived = messages.length > prevMsgLenRef.current;
    if (channelChanged || newMessagesArrived) {
      messagesEndRef.current?.scrollIntoView({ behavior: channelChanged ? 'auto' : 'smooth' });
    }
    prevMsgLenRef.current = messages.length;
    prevChannelIdRef.current = activeChannel?.id ?? null;
  }, [messages, activeChannel?.id]);

  // Close emoji picker on click outside / Escape
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEmojiPicker(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showEmojiPicker]);

  const insertEmoji = (emoji: string) => {
    const input = messageInputRef.current;
    if (!input) {
      setNewMessage((prev) => prev + emoji);
      return;
    }
    const currentValue = input.value;
    const start = input.selectionStart ?? currentValue.length;
    const end = input.selectionEnd ?? currentValue.length;
    const next = currentValue.slice(0, start) + emoji + currentValue.slice(end);
    setNewMessage(next);
    requestAnimationFrame(() => {
      input.focus();
      const pos = start + emoji.length;
      try {
        input.setSelectionRange(pos, pos);
      } catch {
        // Silently ignore if input detached
      }
    });
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !activeChannel) return;
    try {
      await msgApi.postChannelMessage(activeChannel.id, newMessage.trim());
      setNewMessage('');
      fetchMessages();
    } catch {
      setError('Erreur lors de l\'envoi');
    }
  };

  const handleReaction = async (messageId: number, emoji: string) => {
    if (!activeChannel) return;
    const key = `${messageId}:${emoji}`;
    if (pendingReactionsRef.current.has(key)) return; // Lock anti double-click
    pendingReactionsRef.current.add(key);
    try {
      await msgApi.toggleReaction(activeChannel.id, messageId, emoji);
      await fetchMessages();
    } catch {
      // Silently ignore
    } finally {
      pendingReactionsRef.current.delete(key);
    }
  };

  const handleCreateChannel = async () => {
    if (!channelName.trim()) return;
    try {
      await msgApi.createChannel({ name: channelName, description: channelDesc });
      setShowCreateChannel(false);
      setChannelName('');
      setChannelDesc('');
      fetchChannels();
    } catch {
      setError('Erreur lors de la création du canal');
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  }

  return (
    <div className="flex h-[calc(100vh-120px)] md:h-[calc(100vh-180px)] gap-0 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
      {error && (
        <div className="absolute top-4 right-4 z-50">
          <Alert type="error" onClose={() => setError(null)}>{error}</Alert>
        </div>
      )}

      {/* Channel Sidebar */}
      <div className={`${activeChannel ? 'hidden md:flex md:w-64' : 'w-full md:w-64'} bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-col md:flex`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Canaux</h3>
          <button
            onClick={() => setShowCreateChannel(true)}
            className="p-1 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => { setActiveChannel(ch); setMessageSearch(''); }}
              className={`w-full flex items-center gap-2 px-4 py-3 md:py-2 text-sm transition-colors ${
                activeChannel?.id === ch.id
                  ? 'bg-seaop-primary-50 text-seaop-primary-700 dark:bg-seaop-primary-900/30 dark:text-seaop-primary-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Hash size={14} />
              <span className="truncate flex-1 text-left">{ch.name}</span>
              <span className="flex items-center gap-1">
                {ch.memberCount > 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-gray-400" title={`${ch.memberCount} membre${ch.memberCount > 1 ? 's' : ''}`}>
                    <Users size={10} />{ch.memberCount}
                  </span>
                )}
                {ch.messageCount > 0 && (
                  <span className="text-xs text-gray-400">{ch.messageCount}</span>
                )}
              </span>
            </button>
          ))}
          {channels.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Aucun canal</p>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className={`${activeChannel ? 'flex flex-1' : 'hidden md:flex md:flex-1'} flex-col bg-white dark:bg-gray-900`}>
        {/* Channel Header */}
        {activeChannel && (
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveChannel(null)}
                  className="md:hidden p-1 -ml-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  aria-label="Retour aux canaux"
                >
                  <ChevronLeft size={20} />
                </button>
                <Hash size={16} className="text-gray-400" />
                <h3 className="font-semibold text-gray-900 dark:text-white">{activeChannel.name}</h3>
                <Badge color="gray" size="sm">{activeChannel.memberCount} membre{activeChannel.memberCount !== 1 ? 's' : ''}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={messageSearch}
                    onChange={(e) => setMessageSearch(e.target.value)}
                    placeholder="Rechercher..."
                    className="w-32 md:w-44 pl-7 pr-7 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-seaop-primary-500"
                  />
                  {messageSearch && (
                    <button onClick={() => setMessageSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            {activeChannel.description && (
              <p className="text-xs text-gray-400 mt-1">{activeChannel.description}</p>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messageSearch && (
            <p className="text-xs text-gray-400 text-center py-1">
              {messages.filter(m => (m.messageText || '').toLowerCase().includes(messageSearch.toLowerCase())).length} resultat(s) pour "{messageSearch}"
            </p>
          )}
          {messages.filter(msg => !messageSearch || (msg.messageText || '').toLowerCase().includes(messageSearch.toLowerCase())).map((msg) => (
            <div key={msg.id} className="group flex gap-3">
              <div className="w-8 h-8 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center text-xs font-medium text-seaop-primary-600 shrink-0 mt-0.5">
                {(msg.userName || msg.username || '?')[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-sm text-gray-900 dark:text-white">
                    {msg.userName || msg.username || 'Utilisateur'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatRelativeTime(msg.createdAt)}
                  </span>
                  {msg.isEdited && <span className="text-xs text-gray-400">(modifie)</span>}
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">
                  {msg.messageText}
                </p>
                {/* Reactions */}
                <div className="flex items-center flex-wrap gap-1 mt-1">
                  {(msg.reactions || []).map((r) => (
                    <button
                      key={r.emoji}
                      onClick={() => handleReaction(msg.id, r.emoji)}
                      title={r.mine ? 'Retirer ma réaction' : 'Ajouter ma réaction'}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                        r.mine
                          ? 'bg-seaop-primary-100 dark:bg-seaop-primary-900/40 border border-seaop-primary-300 dark:border-seaop-primary-700 text-seaop-primary-700 dark:text-seaop-primary-300'
                          : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-transparent'
                      }`}
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                  {/* Quick-react picker — toujours visible (masque si tous déjà réagis) */}
                  {(() => {
                    const available = EMOJI_REACTIONS.filter(
                      (emoji) => !(msg.reactions || []).some((r) => r.emoji === emoji),
                    );
                    if (available.length === 0) return null;
                    return (
                      <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                        {available.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(msg.id, emoji)}
                            className="p-1 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                            title="Ajouter une réaction"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ))}
          {messages.length === 0 && activeChannel && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <MessageSquare size={32} className="mb-2" />
              <p className="text-sm">Aucun message dans #{activeChannel.name}</p>
              <p className="text-xs">Soyez le premier a ecrire!</p>
            </div>
          )}
          {!activeChannel && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Hash size={32} className="mb-2" />
              <p className="text-sm">Sélectionnez un canal</p>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input */}
        {activeChannel && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="flex gap-2 items-center">
              <div className="relative" ref={emojiPickerRef}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className="p-2 rounded-lg text-gray-400 hover:text-seaop-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label="Ajouter un emoji"
                  aria-haspopup="true"
                  aria-expanded={showEmojiPicker}
                >
                  <Smile size={18} />
                </button>
                {showEmojiPicker && (
                  <div
                    role="menu"
                    className="absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 flex gap-1 z-20"
                  >
                    {EMOJI_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        role="menuitem"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { insertEmoji(emoji); setShowEmojiPicker(false); }}
                        className="text-xl p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                ref={messageInputRef}
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder={`Message dans #${activeChannel.name}...`}
                className="flex-1 erp-input"
              />
              <Button onClick={handleSend} disabled={!newMessage.trim()}>
                <Send size={16} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create Channel Modal */}
      <Modal isOpen={showCreateChannel} onClose={() => setShowCreateChannel(false)} title="Nouveau canal">
        <div className="space-y-4">
          <Input
            label="Nom du canal *"
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder="general"
            required
          />
          <Input
            label="Description"
            value={channelDesc}
            onChange={(e) => setChannelDesc(e.target.value)}
            placeholder="Description du canal..."
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreateChannel(false)}>Annuler</Button>
            <Button onClick={handleCreateChannel} disabled={!channelName.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
