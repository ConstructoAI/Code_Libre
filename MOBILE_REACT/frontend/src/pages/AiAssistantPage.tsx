/**
 * Mobile React Frontend - AI Assistant Chat Page
 * Conversation list + chat view with basic markdown rendering.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Bot,
  Send,
  Plus,
  Trash2,
  ChevronLeft,
  MessageSquare,
  Paperclip,
  X,
  Camera,
  FileText,
  Check,
  AlertTriangle,
  Clock,
  Loader2,
  Pencil,
  PlusSquare,
  Trash,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAiStore } from '@/store/useAiStore';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { SpeakButton } from '@/components/ui/SpeakButton';
import { MicButton } from '@/components/ui/MicButton';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { formatRelativeTime } from '@/utils/format';
import type { AiPendingAction } from '@/types';

interface PendingActionCardProps {
  action: AiPendingAction;
  messageIndex: number;
  onConfirm: (messageIndex: number, actionId: number) => void | Promise<void>;
  onCancel: (messageIndex: number, actionId: number) => void | Promise<void>;
}

function PendingActionCard({
  action,
  messageIndex,
  onConfirm,
  onCancel,
}: PendingActionCardProps) {
  const status = action.status ?? 'pending';
  const isBusy = status === 'executing' || status === 'cancelling';
  const isDone =
    status === 'executed' ||
    status === 'cancelled' ||
    status === 'failed' ||
    status === 'expired' ||
    status === 'rejected';

  const ActionIcon = (() => {
    if (action.actionType === 'INSERT') return PlusSquare;
    if (action.actionType === 'UPDATE') return Pencil;
    if (action.actionType === 'DELETE') return Trash;
    return AlertTriangle; // fallback if backend ever sends an unknown type
  })();

  const headerColor = (() => {
    if (action.actionType === 'DELETE') return 'text-red-700 dark:text-red-300';
    if (action.actionType === 'INSERT') return 'text-emerald-700 dark:text-emerald-300';
    if (action.actionType === 'UPDATE') return 'text-amber-700 dark:text-amber-300';
    return 'text-gray-700 dark:text-gray-300';
  })();

  const statusBadge = (() => {
    if (status === 'pending') return null;
    if (status === 'executing') {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Execution...
        </span>
      );
    }
    if (status === 'cancelling') {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Annulation...
        </span>
      );
    }
    if (status === 'executed') {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
          role="status"
        >
          <Check className="h-3.5 w-3.5" />
          Execute
        </span>
      );
    }
    if (status === 'cancelled') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
          <X className="h-3.5 w-3.5" />
          Annule
        </span>
      );
    }
    if (status === 'expired') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          <Clock className="h-3.5 w-3.5" />
          Expire
        </span>
      );
    }
    if (status === 'rejected') {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300"
          role="alert"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Rejete
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300"
        role="alert"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Echec
      </span>
    );
  })();

  return (
    <div
      className={`mt-3 rounded-xl border bg-white dark:bg-gray-900 shadow-sm overflow-hidden ${
        action.actionType === 'DELETE'
          ? 'border-red-200 dark:border-red-900/50'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div
        className={`px-3 py-2 border-b ${
          action.actionType === 'DELETE'
            ? 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30'
            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className={`flex items-center gap-2 ${headerColor}`}>
            <ActionIcon className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {action.actionType}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              sur <code className="font-mono text-[11px]">{action.targetTable}</code>
            </span>
          </div>
          {statusBadge}
        </div>
      </div>
      <div className="px-3 py-2.5 text-sm text-gray-800 dark:text-gray-100">
        {action.summary}
      </div>
      {action.resultMsg && isDone && (
        <div
          className={`px-3 pb-2 text-xs ${
            status === 'failed'
              ? 'text-red-700 dark:text-red-300'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          {action.resultMsg}
        </div>
      )}
      {!isDone && (
        <div className="px-3 pb-3 pt-1 flex items-center gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onConfirm(messageIndex, action.id)}
            aria-label={`Confirmer ${action.actionType} sur ${action.targetTable}`}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium min-h-[44px] transition-colors disabled:opacity-60 ${
              action.actionType === 'DELETE'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-seaop-primary-600 text-white hover:bg-seaop-primary-700'
            }`}
          >
            {status === 'executing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Confirmer
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onCancel(messageIndex, action.id)}
            aria-label={`Annuler ${action.actionType} sur ${action.targetTable}`}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium min-h-[44px] border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
          >
            {status === 'cancelling' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}

interface AttachedFile {
  data: string;       // base64 data (without prefix)
  mediaType: string;  // e.g. "image/jpeg", "application/pdf"
  name: string;       // original file name
  preview?: string;   // data URL for thumbnail preview (images only)
}

/** Converts a File to base64 and returns an AttachedFile */
function fileToAttachment(file: File): Promise<AttachedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // dataUrl format: "data:<mediaType>;base64,<data>"
      const base64 = dataUrl.split(',')[1];
      const mediaType = file.type || 'application/octet-stream';
      const isImage = mediaType.startsWith('image/');
      resolve({
        data: base64,
        mediaType,
        name: file.name,
        preview: isImage ? dataUrl : undefined,
      });
    };
    reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
    reader.readAsDataURL(file);
  });
}

/**
 * Basic markdown-like renderer for assistant messages.
 * Handles: **bold**, `inline code`, ```code blocks```, and bullet lists.
 */
function renderMarkdown(text: string): React.ReactNode {
  const blocks = text.split(/```([\s\S]*?)```/);
  const result: React.ReactNode[] = [];

  blocks.forEach((block, blockIdx) => {
    if (blockIdx % 2 === 1) {
      // Code block
      result.push(
        <pre
          key={`code-${blockIdx}`}
          className="bg-gray-100 dark:bg-gray-900 rounded-lg p-3 text-xs font-mono overflow-x-auto my-2 text-gray-800 dark:text-gray-200"
        >
          <code>{block.trim()}</code>
        </pre>,
      );
    } else {
      // Regular text - process line by line
      const lines = block.split('\n');
      let currentList: string[] = [];

      const flushList = () => {
        if (currentList.length > 0) {
          result.push(
            <ul
              key={`list-${blockIdx}-${result.length}`}
              className="list-disc list-inside space-y-0.5 my-1"
            >
              {currentList.map((item, i) => (
                <li key={i} className="text-sm">
                  {renderInline(item)}
                </li>
              ))}
            </ul>,
          );
          currentList = [];
        }
      };

      lines.forEach((line, lineIdx) => {
        const trimmed = line.trim();

        if (/^[-*]\s+/.test(trimmed)) {
          currentList.push(trimmed.replace(/^[-*]\s+/, ''));
        } else {
          flushList();
          if (trimmed.length > 0) {
            result.push(
              <p key={`p-${blockIdx}-${lineIdx}`} className="text-sm my-0.5">
                {renderInline(trimmed)}
              </p>,
            );
          }
        }
      });
      flushList();
    }
  });

  return <>{result}</>;
}

/** Render inline markdown: **bold** and `code` */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="bg-gray-100 dark:bg-gray-700 text-seaop-primary-700 dark:text-seaop-primary-300 px-1 py-0.5 rounded text-xs font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export default function AiAssistantPage() {
  // useShallow evite les re-renders inutiles + risque React #185 cause par
  // le destructuring direct du store Zustand v5 (cf bug Dossiers corrige).
  // 13 proprietes = useShallow plus lisible que 13 selecteurs individuels.
  const {
    conversations,
    currentConversationId,
    messages,
    isLoading,
    isSending,
    error,
    fetchConversations,
    fetchConversation,
    sendMessage,
    newConversation,
    deleteConversation,
    clearError,
    confirmPendingAction,
    cancelPendingAction,
  } = useAiStore(
    useShallow((s) => ({
      conversations: s.conversations,
      currentConversationId: s.currentConversationId,
      messages: s.messages,
      isLoading: s.isLoading,
      isSending: s.isSending,
      error: s.error,
      fetchConversations: s.fetchConversations,
      fetchConversation: s.fetchConversation,
      sendMessage: s.sendMessage,
      newConversation: s.newConversation,
      deleteConversation: s.deleteConversation,
      clearError: s.clearError,
      confirmPendingAction: s.confirmPendingAction,
      cancelPendingAction: s.cancelPendingAction,
    })),
  );

  const [messageText, setMessageText] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [composing, setComposing] = useState(false);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [sentImages, setSentImages] = useState<Record<number, AttachedFile[]>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Voice features (TTS for assistant replies, STT for hands-free dictation).
  // Both gracefully no-op on browsers that don't support the Web Speech API.
  const tts = useTextToSpeech({ lang: 'fr-CA' });
  const stt = useSpeechRecognition({ lang: 'fr-CA' });

  const isChatView = composing || currentConversationId !== null || messages.length > 0;

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Stop any in-flight speech when switching conversations or unmounting —
  // the user shouldn't hear the old conversation continue after navigating.
  // `tts.stop` is a stable useCallback, so it's safe as a dep.
  useEffect(() => {
    return () => {
      tts.stop();
    };
  }, [currentConversationId, tts.stop]);

  // Append the final dictated transcript to the input ONCE recognition has
  // ended. Chrome can emit several `isFinal` segments back-to-back during a
  // single dictation; the hook accumulates them, but flushing on every
  // intermediate update races with the recognizer (reset() and the next
  // setTranscript collide), producing duplicated text in messageText.
  // Waiting for `!isListening` guarantees no more segments will arrive
  // before we flush, so the merge is deterministic.
  useEffect(() => {
    if (stt.isListening || !stt.transcript) return;
    const finalText = stt.transcript;
    setMessageText((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} ${finalText}` : finalText;
    });
    stt.reset();
  }, [stt.transcript, stt.isListening, stt.reset]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    try {
      const newAttachments = await Promise.all(
        Array.from(files).slice(0, 5 - attachments.length).map(fileToAttachment)
      );
      setAttachments((prev) => [...prev, ...newAttachments].slice(0, 5));
    } catch {
      // Silent - file read error
    }
    // Reset input so same file can be re-selected
    e.target.value = '';
    setShowAttachMenu(false);
  }, [attachments.length]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = async () => {
    const text = messageText.trim();
    if ((!text && attachments.length === 0) || isSending) return;

    const images = attachments.length > 0
      ? attachments.map((a) => ({ data: a.data, mediaType: a.mediaType }))
      : undefined;

    const displayText = text || (attachments.length === 1 ? `[${attachments[0].name}]` : `[${attachments.length} fichiers]`);

    // Save images for display in the message bubble (keyed by message index)
    const msgIndex = messages.length; // index of the user message about to be added
    if (attachments.length > 0) {
      setSentImages((prev) => ({ ...prev, [msgIndex]: [...attachments] }));
    }

    setMessageText('');
    setAttachments([]);
    await sendMessage(displayText, images);
    // Refresh conversation list
    fetchConversations();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectConversation = (id: number) => {
    fetchConversation(id);
    setSentImages({});
    setAttachments([]);
    setShowSidebar(false);
  };

  const handleNewConversation = () => {
    newConversation();
    setSentImages({});
    setAttachments([]);
    setComposing(true);
    setShowSidebar(false);
  };

  const handleDeleteConversation = async (
    e: React.MouseEvent,
    id: number,
  ) => {
    e.stopPropagation();
    await deleteConversation(id);
  };

  // Conversation list view (shown when no active chat or sidebar is open)
  const conversationList = (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <Button
          onClick={handleNewConversation}
          leftIcon={<Plus className="h-4 w-4" />}
          className="w-full"
          size="sm"
        >
          Nouvelle conversation
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && conversations.length === 0 && (
          <div className="flex justify-center py-12">
            <Spinner size="md" />
          </div>
        )}

        {!isLoading && conversations.length === 0 && (
          <div className="text-center py-12 px-4">
            <Bot className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Aucune conversation. Commencez-en une!
            </p>
          </div>
        )}

        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => handleSelectConversation(conv.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
              currentConversationId === conv.id
                ? 'bg-seaop-primary-50 dark:bg-seaop-primary-900/20'
                : ''
            }`}
          >
            <MessageSquare className="h-4 w-4 text-gray-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {conv.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {formatRelativeTime(conv.lastUpdatedAt)} &middot; {conv.messageCount} messages
              </p>
            </div>
            <button
              onClick={(e) => handleDeleteConversation(e, conv.id)}
              className="rounded-lg p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
              aria-label="Supprimer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-[#1b1a19] relative">
      {/* Sidebar overlay for mobile */}
      {showSidebar && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setShowSidebar(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-[85%] max-w-xs bg-white dark:bg-gray-800 shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Bot className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
                Conversations
              </h2>
              <button
                onClick={() => setShowSidebar(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Fermer"
              >
                &times;
              </button>
            </div>
            {conversationList}
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <Alert type="error" onDismiss={clearError} className="mx-3 mt-3">
          {error}
        </Alert>
      )}

      {/* Main view */}
      {!isChatView ? (
        <>
          {/* Show conversation list as main view */}
          <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Bot className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
              Assistant IA
            </h1>
          </header>
          {conversationList}
        </>
      ) : (
        <>
          {/* Chat header */}
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3">
            <button
              onClick={() => {
                newConversation();
                setSentImages({});
                setAttachments([]);
                setComposing(false);
                setShowSidebar(false);
              }}
              className="rounded-lg p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Retour"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Bot className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400 shrink-0" />
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                Assistant IA
              </h1>
            </div>
            <button
              onClick={() => setShowSidebar(true)}
              className="rounded-lg p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Conversations"
            >
              <MessageSquare className="h-5 w-5" />
            </button>
          </header>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-3">
            {isLoading && messages.length === 0 && (
              <div className="flex justify-center py-12">
                <Spinner size="lg" />
              </div>
            )}

            {messages.length === 0 && !isLoading && (
              <div className="text-center py-16">
                <Bot className="h-16 w-16 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Posez une question à l&apos;assistant IA
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Construction, calculs, règlements, photos, documents...
                </p>
              </div>
            )}

            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              const msgImages = sentImages[idx];
              return (
                <div
                  key={idx}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                      isUser
                        ? 'bg-seaop-primary-600 text-white rounded-br-md'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md'
                    }`}
                  >
                    {/* Image thumbnails in user messages */}
                    {isUser && msgImages && msgImages.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {msgImages.map((img, i) =>
                          img.preview ? (
                            <img
                              key={i}
                              src={img.preview}
                              alt={img.name}
                              className="h-20 w-20 rounded-lg object-cover border border-white/20"
                            />
                          ) : (
                            <div
                              key={i}
                              className="h-20 w-20 rounded-lg border border-white/20 bg-white/10 flex flex-col items-center justify-center"
                            >
                              <FileText className="h-6 w-6 text-white/70" />
                              <span className="text-[9px] text-white/70 mt-1 max-w-[60px] truncate px-1">
                                {img.name}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                    {isUser ? (
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    ) : (
                      <div className="prose-sm">{renderMarkdown(msg.content)}</div>
                    )}
                    {!isUser && msg.content && (
                      <div className="mt-1.5 flex justify-end">
                        <SpeakButton
                          isSupported={tts.isSupported}
                          isSpeaking={tts.speakingId === idx}
                          onClick={() => tts.speak(msg.content, idx)}
                        />
                      </div>
                    )}
                    {!isUser &&
                      msg.pendingActions &&
                      msg.pendingActions.length > 0 && (
                        <div className="mt-1">
                          {msg.pendingActions.map((action) => (
                            <PendingActionCard
                              key={action.id}
                              action={action}
                              messageIndex={idx}
                              onConfirm={confirmPendingAction}
                              onCancel={cancelPendingAction}
                            />
                          ))}
                        </div>
                      )}
                  </div>
                </div>
              );
            })}

            {isSending && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      En réflexion...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="px-3 pt-2 pb-0 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {attachments.map((att, idx) => (
                  <div key={idx} className="relative shrink-0 group">
                    {att.preview ? (
                      <img
                        src={att.preview}
                        alt={att.name}
                        className="h-16 w-16 rounded-lg object-cover border border-gray-200 dark:border-gray-600"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center">
                        <FileText className="h-5 w-5 text-gray-400" />
                        <span className="text-[9px] text-gray-400 mt-0.5 max-w-[56px] truncate px-1">
                          {att.name.split('.').pop()?.toUpperCase()}
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(idx)}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 shadow-sm"
                      aria-label="Retirer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input. `pt-3` gives the textarea breathing room above the
              row. The bottom padding combines a fixed 12px gap with the
              iOS home-indicator clearance via calc — guarantees comfortable
              spacing on devices both with and without a home indicator
              (a plain `pb-safe` would collapse to 0 on Android/desktop). */}
          <div className="sticky bottom-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Attach menu popup */}
            {showAttachMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowAttachMenu(false)} />
                <div className="absolute bottom-full left-3 mb-2 z-40 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[200px]">
                  <button
                    onClick={() => { cameraInputRef.current?.click(); setShowAttachMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Camera className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
                    Prendre une photo
                  </button>
                  <button
                    onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <FileText className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
                    Choisir un fichier
                  </button>
                </div>
              </>
            )}

            {/* STT permission/network errors. The hook now surfaces these
                instead of silently failing — the user knows why the mic
                isn't responding and can act (grant permission, go online).
                Dismiss button calls stt.reset() which clears the error
                (along with any stale transcript). */}
            {stt.error && (
              <div
                role="alert"
                className="mb-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2"
              >
                <span className="flex-1">{stt.error}</span>
                <button
                  type="button"
                  onClick={() => stt.reset()}
                  aria-label="Fermer"
                  className="shrink-0 -m-1 p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-800/40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {/* Live preview of in-progress dictation. The browser's recognizer
                emits this incrementally; it gets folded into the input as
                soon as the result is finalized. aria-live announces partial
                transcripts to screen readers. */}
            {stt.isListening && stt.interimTranscript && (
              <div
                role="status"
                aria-live="polite"
                className="mb-1.5 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/40 text-xs text-red-700 dark:text-red-200 italic"
              >
                {stt.interimTranscript}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                disabled={isSending || attachments.length >= 5}
                className="rounded-xl p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors shrink-0"
                style={{ minHeight: '44px', minWidth: '44px' }}
                aria-label="Joindre un fichier"
              >
                <Paperclip className="h-5 w-5" />
              </button>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  stt.isListening ? 'Parlez maintenant...' : 'Poser une question...'
                }
                rows={1}
                disabled={isSending}
                className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-3.5 py-3 text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 max-h-32 disabled:opacity-50"
                style={{ minHeight: '48px' }}
              />
              <MicButton
                isSupported={stt.isSupported}
                isListening={stt.isListening}
                disabled={isSending}
                onClick={() => {
                  if (stt.isListening) {
                    stt.stop();
                    return;
                  }
                  // Stop any in-flight TTS before opening the mic — otherwise
                  // the assistant's voice from the speaker leaks back into
                  // the microphone and corrupts the recognition.
                  tts.stop();
                  stt.start();
                }}
              />
              <Button
                onClick={handleSend}
                disabled={
                  (!messageText.trim() && attachments.length === 0) ||
                  isSending ||
                  // Block send while dictating so the final transcript has
                  // time to be appended to the textarea. Also block while
                  // a transcript is pending append (race: `onend` may fire
                  // before the final `onresult` on some Android builds, so
                  // `isListening` flips off before the text has reached the
                  // textarea — a fast tap on Send would lose dictation).
                  stt.isListening ||
                  stt.transcript.length > 0
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
