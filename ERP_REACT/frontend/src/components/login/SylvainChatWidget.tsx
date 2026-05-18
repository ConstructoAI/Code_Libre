/**
 * Floating chat widget — Sylvain Leduc pre-login assistant.
 * Bottom-right bubble that opens into a 380x560 D365 Fluent chat panel.
 * Session UUID in localStorage, 20-exchange limit enforced server-side.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, X, Sparkles, AlertCircle } from 'lucide-react';
import { sendSylvainChat, type ChatMessage } from '@/api/publicChat';

const SESSION_KEY = 'sylvain_chat_session_id';
const MAX_EXCHANGES = 20;

const GREETING: ChatMessage = {
  role: 'assistant',
  content: `**Bonjour! Je suis Sylvain Leduc**, créateur de Constructo AI!

Je peux répondre à toutes vos questions sur l'écosystème Constructo AI.

**Nos 4 produits :**
- 🏗️ **ERP AI** — 79.99$/mois (tout inclus)
- 📱 **Pointeur Mobile** — gratuit
- 🛒 **Portail B2B/C2B** — gratuit
- 🤝 **SEAOP** — gratuit

**Comment puis-je vous aider?**
- Découvrir les modules de l'ERP AI
- En savoir plus sur SEAOP ou le Pointeur Mobile
- Créer un compte entreprise
- Questions sur les fonctionnalités

*Posez-moi vos questions, je suis là pour vous aider!*`,
};

function getOrCreateSessionId(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SESSION_KEY);
  } catch {
    // localStorage disabled (private browsing, quota, SecurityError) — use ephemeral ID
  }
  if (stored) return stored;

  const fallback =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `sylvain-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(SESSION_KEY, fallback);
  } catch {
    // Cannot persist — session ID remains ephemeral for this visit
  }
  return fallback;
}

/**
 * Minimal markdown-to-React renderer for Sylvain responses.
 * Supports **bold**, bullet lines, and line breaks. No HTML, no scripts.
 */
function renderMarkdown(text: string): JSX.Element[] {
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trimStart();
    const isBullet = trimmed.startsWith('• ') || trimmed.startsWith('- ');
    const content = isBullet ? trimmed.slice(2) : line;

    // Split on **bold** markers
    const parts: Array<{ bold: boolean; text: string }> = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ bold: false, text: content.slice(lastIndex, match.index) });
      }
      parts.push({ bold: true, text: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push({ bold: false, text: content.slice(lastIndex) });
    }
    if (parts.length === 0) {
      parts.push({ bold: false, text: content });
    }

    const rendered = parts.map((p, i) =>
      p.bold ? (
        <strong key={i} className="font-semibold">
          {p.text}
        </strong>
      ) : (
        <span key={i}>{p.text}</span>
      ),
    );

    if (isBullet) {
      return (
        <div key={idx} className="flex gap-2 leading-snug">
          <span className="text-[#0078D4] shrink-0">•</span>
          <span>{rendered}</span>
        </div>
      );
    }
    if (line.trim() === '') {
      return <div key={idx} className="h-2" />;
    }
    return (
      <div key={idx} className="leading-snug">
        {rendered}
      </div>
    );
  });
}

export default function SylvainChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchangesUsed, setExchangesUsed] = useState(0);
  const [limitReached, setLimitReached] = useState(false);

  const sessionId = useMemo(() => getOrCreateSessionId(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);

  // Track unmount so async resolutions skip state updates on a dead component
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && !limitReached && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, limitReached]);

  // Escape key closes the open panel
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || limitReached) return;

    const historyForServer = messages.filter((m) => m !== GREETING);
    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const result = await sendSylvainChat(sessionId, trimmed, historyForServer);
      if (!mountedRef.current) return;
      setMessages((prev) => [...prev, { role: 'assistant', content: result.response }]);
      setExchangesUsed(result.exchanges_used);
      setLimitReached(result.limit_reached);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Service IA temporairement indisponible. Veuillez réessayer.';
      setError(typeof detail === 'string' ? detail : 'Service IA temporairement indisponible.');
      // Remove the user message so they can retry — functional form avoids stale closures.
      setMessages((prev) => (prev[prev.length - 1] === userMessage ? prev.slice(0, -1) : prev));
      setInput(trimmed);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [input, isLoading, limitReached, messages, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ============ Closed bubble ============
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full bg-[#0078D4] hover:bg-[#106EBE] text-white shadow-lg hover:shadow-xl transition-all px-5 py-3 group"
        aria-label="Ouvrir le chat avec Sylvain Leduc"
      >
        <div className="relative">
          <MessageCircle size={22} className="text-white" />
          <Sparkles
            size={12}
            className="absolute -top-1 -right-1 text-[#FFD700] animate-pulse"
          />
        </div>
        <div className="hidden sm:block text-left">
          <div className="text-sm font-semibold leading-tight">Sylvain Leduc</div>
          <div className="text-[11px] text-white/80 leading-tight">Poser une question</div>
        </div>
      </button>
    );
  }

  // ============ Open chat panel ============
  return (
    <div
      className="fixed z-50 bg-white dark:bg-[#292827] shadow-2xl border border-[#edebe9] dark:border-[#3b3a39] flex flex-col
        bottom-0 right-0 left-0 top-0 sm:bottom-6 sm:right-6 sm:left-auto sm:top-auto
        sm:w-[380px] sm:h-[560px] sm:rounded-lg sm:max-h-[80vh]"
      role="dialog"
      aria-label="Chat avec Sylvain Leduc"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#edebe9] dark:border-[#3b3a39] bg-[#002050] text-white sm:rounded-t-lg shrink-0">
        <div className="h-10 w-10 rounded-full bg-[#0078D4] flex items-center justify-center font-semibold text-sm shrink-0">
          SL
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm leading-tight truncate">Sylvain Leduc</div>
          <div className="text-[11px] text-white/70 leading-tight truncate">
            Créateur de Constructo AI
          </div>
        </div>
        <div
          className="text-[11px] text-white/80 px-2 py-1 rounded bg-white/15 shrink-0"
          aria-live="polite"
          aria-label={`${exchangesUsed} sur ${MAX_EXCHANGES} échanges utilisés`}
        >
          {exchangesUsed}/{MAX_EXCHANGES}
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="p-1 rounded hover:bg-white/10 transition-colors shrink-0"
          aria-label="Fermer le chat"
        >
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#faf9f8] dark:bg-[#1f1e1d]"
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-[#0078D4] text-white'
                  : 'bg-white dark:bg-[#3b3a39] text-[#323130] dark:text-[#f3f2f1] border border-[#edebe9] dark:border-[#525150]'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="space-y-0.5">{renderMarkdown(msg.content)}</div>
              ) : (
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start" role="status" aria-live="polite" aria-label="Sylvain réfléchit">
            <div className="bg-white dark:bg-[#3b3a39] border border-[#edebe9] dark:border-[#525150] rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-[#0078D4] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="h-2 w-2 rounded-full bg-[#0078D4] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="h-2 w-2 rounded-full bg-[#0078D4] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-sm text-red-800 dark:text-red-300">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[#edebe9] dark:border-[#3b3a39] px-3 py-3 bg-white dark:bg-[#292827] sm:rounded-b-lg shrink-0">
        {limitReached ? (
          <div className="text-center text-xs text-[#605e5c] dark:text-[#d2d0ce] py-2">
            <p className="font-semibold mb-1">Limite atteinte</p>
            <p>Créez votre compte ERP AI ou contactez-nous pour continuer.</p>
            <p className="mt-1">📞 514-820-1972</p>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tapez votre message..."
              rows={1}
              disabled={isLoading}
              className="flex-1 resize-none rounded border border-[#8a8886] dark:border-[#605e5c] bg-white dark:bg-[#1f1e1d] text-[#323130] dark:text-[#f3f2f1] text-sm px-3 py-2 focus:border-[#0078D4] focus:outline-none focus:ring-1 focus:ring-[#0078D4] max-h-24 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="h-9 w-9 rounded bg-[#0078D4] hover:bg-[#106EBE] disabled:bg-[#c8c6c4] disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0"
              aria-label="Envoyer"
            >
              <Send size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
