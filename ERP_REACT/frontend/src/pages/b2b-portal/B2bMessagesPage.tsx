/**
 * B2B Client Portal - Messages
 * Thread-based messaging with tenant company.
 */

import { useEffect, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { useB2bPortalStore } from '@/store/useB2bPortalStore';
import { useB2bAuthStore } from '@/store/useB2bAuthStore';

export default function B2bMessagesPage() {
  const { messages, isLoading, error, successMessage, fetchMessages, sendMessage, clearError, clearSuccess } = useB2bPortalStore();
  const { clientUser } = useB2bAuthStore();
  const [newMessage, setNewMessage] = useState('');
  const [newSujet, setNewSujet] = useState('');
  const [showCompose, setShowCompose] = useState(false);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    await sendMessage({ message: newMessage, sujet: newSujet || undefined });
    setNewMessage('');
    setNewSujet('');
    setShowCompose(false);
  };

  const myUserId = clientUser?.userId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1]">Messages</h1>
        <button
          onClick={() => setShowCompose(!showCompose)}
          className="flex items-center gap-1 px-3 py-2 bg-[#0078D4] text-white rounded text-sm font-medium hover:bg-[#106EBE]"
        >
          <Send size={16} /> Nouveau message
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex justify-between"><span>{error}</span><button onClick={clearError}>&times;</button></div>}
      {successMessage && <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700 flex justify-between"><span>{successMessage}</span><button onClick={clearSuccess}>&times;</button></div>}

      {/* Compose */}
      {showCompose && (
        <form onSubmit={handleSend} className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] p-4 space-y-3">
          <input
            type="text"
            value={newSujet}
            onChange={(e) => setNewSujet(e.target.value)}
            placeholder="Sujet (optionnel)"
            className="w-full px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]"
          />
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Votre message..."
            rows={3}
            required
            className="w-full px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={isLoading || !newMessage.trim()} className="px-4 py-2 bg-[#0078D4] text-white rounded text-sm hover:bg-[#106EBE] disabled:opacity-50">
              Envoyer
            </button>
            <button type="button" onClick={() => setShowCompose(false)} className="px-4 py-2 text-sm text-[#605e5c]">Annuler</button>
          </div>
        </form>
      )}

      {/* Messages list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : messages.length === 0 ? (
        <div className="text-center py-16 text-[#605e5c]">
          <MessageSquare size={48} className="mx-auto mb-4 text-[#a19f9d]" />
          <p className="text-lg font-medium">Aucun message</p>
          <p className="text-sm mt-1">Envoyez un message à votre fournisseur</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => {
            const isMe = msg.senderUserId === myUserId;
            return (
              <div
                key={msg.id}
                className={`bg-white dark:bg-[#292827] rounded border p-4 ${
                  isMe
                    ? 'border-[#0078D4]/30 ml-8 sm:ml-16'
                    : 'border-[#edebe9] dark:border-[#3b3a39] mr-8 sm:mr-16'
                } ${!msg.lu && !isMe ? 'border-l-4 border-l-[#0078D4]' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-[#605e5c]">
                    {isMe ? 'Vous' : 'Fournisseur'}
                    {msg.sujet && ` - ${msg.sujet}`}
                  </p>
                  <p className="text-[10px] text-[#a19f9d]">
                    {msg.createdAt ? new Date(msg.createdAt).toLocaleString('fr-CA') : ''}
                  </p>
                </div>
                <p className="text-sm text-[#323130] dark:text-[#f3f2f1] whitespace-pre-wrap">{msg.message}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
