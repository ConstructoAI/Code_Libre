/**
 * ERP React Frontend - Assistant IA Page
 * AI chat interface with expert profiles, usage stats, credit display,
 * document analysis, plan analysis, daily cost chart, and quota management.
 */

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Bot, Send, User, Sparkles, BarChart3, CreditCard,
  FileUp, Image as ImageIcon, X, AlertTriangle, ExternalLink,
  MessageSquare, Plus, Trash2, Info,
} from 'lucide-react';
import * as aiApi from '@/api/ai';
import type { AiUsageStats, AiCredits, AiDailyUsage, AiConversation } from '@/api/ai';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import FileUpload from '@/components/ui/FileUpload';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  profile?: string;
  tokens?: number;
  cost?: number;
  elapsed?: number;
  creditBalance?: number;
  type?: 'chat' | 'document' | 'plan';
}

export default function AssistantIAPage() {
  const selectedProfile = 'general';
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsageStats | null>(null);
  const [credits, setCredits] = useState<AiCredits | null>(null);
  const [dailyUsage, setDailyUsage] = useState<AiDailyUsage[]>([]);
  const [showStats, setShowStats] = useState(false);
  const [creditsExhausted, setCreditsExhausted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Conversation persistence state
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [showConversations, setShowConversations] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // File upload state
  const [showDocUpload, setShowDocUpload] = useState(false);
  const [showPlanUpload, setShowPlanUpload] = useState(false);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [planFiles, setPlanFiles] = useState<File[]>([]);
  const [docPrompt, setDocPrompt] = useState('');

  const fetchConversations = useCallback(() => {
    aiApi.listConversations().then((res) => setConversations(res.items)).catch(() => {});
  }, []);

  useEffect(() => {
    aiApi.getCredits().then((c) => {
      setCredits(c);
      if (!c.isExempt && c.balanceUsd <= 0) setCreditsExhausted(true);
    }).catch(() => {});
    aiApi.getUsageStats().then(setUsage).catch(() => {});
    aiApi.getDailyUsage(30).then((res) => setDailyUsage(res.items)).catch(() => {});
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const refreshStats = () => {
    aiApi.getUsageStats().then(setUsage).catch(() => {});
    aiApi.getDailyUsage(30).then((res) => setDailyUsage(res.items)).catch(() => {});
  };

  const handleNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setError(null);
    setShowConversations(false);
  };

  const handleSelectConversation = async (convId: number) => {
    setLoadingConversations(true);
    setShowConversations(false);
    try {
      const detail = await aiApi.getConversation(convId);
      setCurrentConversationId(convId);
      setMessages(detail.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })));
      setError(null);
    } catch {
      setError('Impossible de charger la conversation');
    } finally {
      setLoadingConversations(false);
    }
  };

  const handleDeleteConversation = async (e: React.MouseEvent, convId: number) => {
    e.stopPropagation();
    try {
      await aiApi.deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (currentConversationId === convId) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch {
      setError('Impossible de supprimer la conversation');
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    if (creditsExhausted) {
      setError('Crédits IA épuisés. Veuillez recharger votre solde.');
      return;
    }
    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);
    setError(null);

    try {
      const res = await aiApi.chat(userMsg, selectedProfile, undefined, currentConversationId ?? undefined);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.response,
          profile: res.profile,
          tokens: res.tokensUsed,
          cost: res.costUsd,
          elapsed: res.elapsedSeconds,
          creditBalance: res.creditBalance,
          type: 'chat',
        },
      ]);
      // Track conversation ID from backend auto-save
      if (res.conversationId) {
        setCurrentConversationId(res.conversationId);
      }
      // Update credit balance from response
      if (res.creditBalance !== undefined && credits) {
        setCredits({ ...credits, balanceUsd: res.creditBalance });
        if (res.creditBalance <= 0 && !credits.isExempt) {
          setCreditsExhausted(true);
        }
      }
      refreshStats();
      fetchConversations();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
      if (axiosErr?.response?.status === 402) {
        setCreditsExhausted(true);
        setError('Crédits IA épuisés. Veuillez recharger votre solde pour continuer.');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Crédits IA épuisés. Veuillez recharger votre solde pour continuer.' },
        ]);
      } else if (axiosErr?.response?.status === 403) {
        setError('Accès au service IA refusé.');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Accès au service IA refusé.' },
        ]);
      } else {
        const msg = axiosErr?.response?.data?.detail || (err instanceof Error ? err.message : 'Erreur IA');
        setError(msg);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Erreur: ${msg}` },
        ]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeDocument = async () => {
    if (docFiles.length === 0 || isLoading) return;
    const file = docFiles[0];
    const promptText = docPrompt.trim() || undefined;

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: `[Analyse de document] ${file.name}${promptText ? `\n${promptText}` : ''}`, type: 'document' },
    ]);
    setIsLoading(true);
    setError(null);
    setShowDocUpload(false);
    setDocFiles([]);
    setDocPrompt('');

    try {
      const res = await aiApi.analyzeDocument(file, promptText);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `**Type de document:** ${res.documentType} | **Pages:** ${res.pages}\n\n${res.analysis}`,
          profile: 'Analyse Document',
          tokens: res.tokensUsed,
          cost: res.costUsd,
          elapsed: res.elapsedSeconds,
          type: 'document',
        },
      ]);
      refreshStats();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
      if (axiosErr?.response?.status === 402) {
        setCreditsExhausted(true);
        setError('Crédits IA épuisés. Veuillez recharger votre solde pour continuer.');
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Crédits IA épuisés. Veuillez recharger votre solde.' }]);
      } else if (axiosErr?.response?.status === 403) {
        setError('Accès au service IA refusé.');
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Accès au service IA refusé.' }]);
      } else {
        const msg = axiosErr?.response?.data?.detail || (err instanceof Error ? err.message : 'Erreur analyse document');
        setError(msg);
        setMessages((prev) => [...prev, { role: 'assistant', content: `Erreur: ${msg}` }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzePlan = async () => {
    if (planFiles.length === 0 || isLoading) return;
    const fileNames = planFiles.map((f) => f.name).join(', ');

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: `[Analyse de plan] ${fileNames}`, type: 'plan' },
    ]);
    setIsLoading(true);
    setError(null);
    setShowPlanUpload(false);
    const filesToAnalyze = [...planFiles];
    setPlanFiles([]);

    try {
      const res = await aiApi.analyzePlan(filesToAnalyze);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `**Type de plan:** ${res.planType} | **Fichiers analyses:** ${res.filesAnalyzed}\n\n${res.analysis}`,
          profile: 'Analyse Plan',
          tokens: res.tokensUsed,
          cost: res.costUsd,
          elapsed: res.elapsedSeconds,
          type: 'plan',
        },
      ]);
      refreshStats();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
      if (axiosErr?.response?.status === 402) {
        setCreditsExhausted(true);
        setError('Crédits IA épuisés. Veuillez recharger votre solde pour continuer.');
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Crédits IA épuisés. Veuillez recharger votre solde.' }]);
      } else if (axiosErr?.response?.status === 403) {
        setError('Accès au service IA refusé.');
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Accès au service IA refusé.' }]);
      } else {
        const msg = axiosErr?.response?.data?.detail || (err instanceof Error ? err.message : 'Erreur analyse plan');
        setError(msg);
        setMessages((prev) => [...prev, { role: 'assistant', content: `Erreur: ${msg}` }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const balanceTextColor = useMemo(() => {
    if (!credits || credits.isExempt) return 'text-green-600';
    if (credits.balanceUsd > 5) return 'text-green-600';
    if (credits.balanceUsd > 0) return 'text-yellow-600';
    return 'text-red-600';
  }, [credits]);

  // Simple bar chart max
  const maxDailyCost = useMemo(() => {
    if (dailyUsage.length === 0) return 1;
    return Math.max(...dailyUsage.map((d) => d.totalCostUsd), 0.01);
  }, [dailyUsage]);

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-180px)] gap-4">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Bot size={20} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Assistant IA</h2>
              <p className="text-xs text-gray-500">Expert construction polyvalent -- Connecté à vos données</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Conversations toggle */}
            <Button
              size="sm"
              variant={showConversations ? 'primary' : 'ghost'}
              leftIcon={<MessageSquare size={14} />}
              onClick={() => setShowConversations(!showConversations)}
            >
              <span className="hidden sm:inline">Conversations</span>
              {conversations.length > 0 && (
                <span className="ml-1 text-xs opacity-70">({conversations.length})</span>
              )}
            </Button>
            {/* Credit balance indicator — plan mensuel illimite cote serveur,
                donc on n'affiche plus de barre de progression basee sur monthly_limit. */}
            {credits && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <CreditCard size={14} className={balanceTextColor} />
                <span className={`text-sm font-bold ${balanceTextColor}`}>
                  {credits.isExempt ? 'Illimite' : `$${(credits.balanceUsd ?? 0).toFixed(2)}`}
                </span>
              </div>
            )}
            <Button
              size="sm"
              variant={showStats ? 'primary' : 'ghost'}
              leftIcon={<BarChart3 size={14} />}
              onClick={() => setShowStats(!showStats)}
            >
              Stats
            </Button>
          </div>
        </div>

        {/* Conversations Panel */}
        {showConversations && (
          <div className="mb-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Conversations</span>
              <Button size="sm" leftIcon={<Plus size={14} />} onClick={handleNewConversation}>
                Nouvelle
              </Button>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {conversations.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">Aucune conversation</p>
              )}
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                    currentConversationId === conv.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <MessageSquare size={14} className="text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-gray-100 truncate">{conv.name}</p>
                    <p className="text-xs text-gray-400">{conv.messageCount} messages</p>
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                    className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 size={14} />
                  </button>
                </button>
              ))}
            </div>
          </div>
        )}

        {loadingConversations && (
          <div className="flex justify-center py-4 mb-3">
            <Spinner size="md" />
          </div>
        )}

        {/* Credits exhausted banner */}
        {creditsExhausted && !credits?.isExempt && (
          <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle size={20} className="text-red-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">Crédits IA épuisés</p>
              <p className="text-xs text-red-600 dark:text-red-500">Rechargez votre solde pour continuer a utiliser l'assistant IA.</p>
            </div>
            <a
              href="https://billing.stripe.com/p/login/constructoai"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
            >
              <Button size="sm" leftIcon={<ExternalLink size={14} />}>
                Recharger
              </Button>
            </a>
          </div>
        )}

        {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 px-1">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Sparkles size={48} className="mb-3 opacity-30" />
              <p className="text-lg font-medium">Posez votre question</p>
              <p className="text-sm mt-1">Pour un conseil, un deuxième avis ou une question sur la base de données...</p>
              <div className="mt-4 flex items-start gap-2 max-w-md mx-auto px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40">
                <Info size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <p className="text-xs text-left text-amber-800 dark:text-amber-300">
                  Pour une <strong>estimation</strong>, allez plutôt dans le module{' '}
                  <strong>Soumissions → Estimation IA</strong>. L'Assistant IA n'est pas conçu pour produire des estimations de coût.
                </p>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setShowDocUpload(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:text-purple-600 hover:border-purple-300 transition-colors"
                >
                  <FileUp size={16} />
                  Analyser un document
                </button>
                <button
                  onClick={() => setShowPlanUpload(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:text-purple-600 hover:border-purple-300 transition-colors"
                >
                  <ImageIcon size={16} />
                  Analyser un plan
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0 mt-1">
                  <Bot size={14} className="text-purple-600" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-seaop-primary-600 text-white'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'
              }`}>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.role === 'assistant' && msg.tokens && (
                  <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex items-center gap-3 text-xs text-gray-400">
                    {msg.profile && <Badge color="purple" size="sm">{msg.profile}</Badge>}
                    {msg.type && msg.type !== 'chat' && (
                      <Badge color={msg.type === 'document' ? 'blue' : 'green'} size="sm">
                        {msg.type === 'document' ? 'Document' : 'Plan'}
                      </Badge>
                    )}
                    <span>{msg.tokens} tokens</span>
                    <span className="font-medium text-orange-400">${msg.cost?.toFixed(4)}</span>
                    <span>{msg.elapsed}s</span>
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center shrink-0 mt-1">
                  <User size={14} className="text-seaop-primary-600" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
                <Bot size={14} className="text-purple-600" />
              </div>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
                <Spinner size="sm" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Document Upload Panel */}
        {showDocUpload && (
          <div className="mb-3 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <FileUp size={16} /> Analyser un document
              </h4>
              <button onClick={() => { setShowDocUpload(false); setDocFiles([]); setDocPrompt(''); }}
                className="p-1 rounded text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <FileUpload
              onFilesSelected={(files) => setDocFiles(files)}
              maxFiles={1}
              maxSizeMb={50}
              accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json,.html,.jpg,.jpeg,.png"
              label="Document (PDF, DOCX, XLSX, CSV, TXT, Images)"
              files={docFiles}
              onRemoveFile={() => setDocFiles([])}
            />
            <div className="mt-3">
              <input
                type="text"
                value={docPrompt}
                onChange={(e) => setDocPrompt(e.target.value)}
                placeholder="Instructions specifiques (optionnel)..."
                className="w-full erp-input text-sm"
              />
            </div>
            <div className="flex justify-end mt-3">
              <Button
                size="sm"
                onClick={handleAnalyzeDocument}
                disabled={docFiles.length === 0 || isLoading}
                isLoading={isLoading}
                leftIcon={<FileUp size={14} />}
              >
                Analyser le document
              </Button>
            </div>
          </div>
        )}

        {/* Plan Upload Panel */}
        {showPlanUpload && (
          <div className="mb-3 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <ImageIcon size={16} /> Analyser un plan
              </h4>
              <button onClick={() => { setShowPlanUpload(false); setPlanFiles([]); }}
                className="p-1 rounded text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <FileUpload
              onFilesSelected={(files) => setPlanFiles((prev) => [...prev, ...files])}
              maxFiles={10}
              maxSizeMb={50}
              accept=".jpg,.jpeg,.png,.pdf"
              label="Plans (JPG, PNG, PDF) -- jusqu'à 10 fichiers"
              files={planFiles}
              onRemoveFile={(idx) => setPlanFiles((prev) => prev.filter((_, i) => i !== idx))}
            />
            <div className="flex justify-end mt-3">
              <Button
                size="sm"
                onClick={handleAnalyzePlan}
                disabled={planFiles.length === 0 || isLoading}
                isLoading={isLoading}
                leftIcon={<ImageIcon size={14} />}
              >
                Analyser les plans
              </Button>
            </div>
          </div>
        )}

        {/* Input + Upload Buttons */}
        <div className="flex gap-2">
          <div className="flex gap-1">
            <button
              onClick={() => { setShowDocUpload(!showDocUpload); setShowPlanUpload(false); }}
              className={`p-2.5 rounded-lg border transition-colors ${
                showDocUpload
                  ? 'border-purple-300 bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:border-purple-700'
                  : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 hover:border-gray-300'
              }`}
              title="Analyser un document"
            >
              <FileUp size={16} />
            </button>
            <button
              onClick={() => { setShowPlanUpload(!showPlanUpload); setShowDocUpload(false); }}
              className={`p-2.5 rounded-lg border transition-colors ${
                showPlanUpload
                  ? 'border-purple-300 bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:border-purple-700'
                  : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 hover:border-gray-300'
              }`}
              title="Analyser un plan"
            >
              <ImageIcon size={16} />
            </button>
          </div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={creditsExhausted ? 'Crédits épuisés -- rechargez pour continuer' : 'Posez votre question a l\'expert IA...'}
            className="flex-1 erp-input"
            disabled={isLoading || creditsExhausted}
          />
          <Button onClick={handleSend} disabled={!input.trim() || isLoading || creditsExhausted}>
            <Send size={16} />
          </Button>
        </div>
      </div>

      {/* Stats Sidebar */}
      {showStats && (
        <div className="w-full md:w-80 space-y-4 overflow-y-auto">
          {/* Credits Card */}
          {credits && (
            <Card padding="sm">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                <CreditCard size={14} /> Credits IA
              </h4>
              {credits.isExempt ? (
                <div>
                  <p className="text-2xl font-bold text-green-600">Illimite</p>
                  <Badge color="green" size="sm">Exempt</Badge>
                </div>
              ) : (
                <div>
                  <p className={`text-2xl font-bold ${balanceTextColor}`}>
                    ${(credits.balanceUsd ?? 0).toFixed(2)} USD
                  </p>
                  {credits.monthlyUsedUsd !== undefined && (
                    <p className="text-xs text-gray-500 mt-2">
                      Utilise ce mois: <span className="font-medium">${(credits.monthlyUsedUsd ?? 0).toFixed(4)}</span>
                    </p>
                  )}
                  {credits.autoRecharge && (
                    <p className="text-xs text-gray-400 mt-1">Recharge auto: ${credits.rechargeAmountUsd}</p>
                  )}
                  {credits.balanceUsd <= 0 && (
                    <a
                      href="https://billing.stripe.com/p/login/constructoai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block"
                    >
                      <Button size="sm" className="w-full" leftIcon={<ExternalLink size={14} />}>
                        Recharger les credits
                      </Button>
                    </a>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Daily Cost Chart */}
          {dailyUsage.length > 0 && (
            <Card padding="sm">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                <BarChart3 size={14} /> Couts quotidiens (30j)
              </h4>
              <div className="flex items-end gap-px h-24">
                {dailyUsage.slice(0, 30).reverse().map((day, idx) => {
                  const heightPct = Math.max(2, (day.totalCostUsd / maxDailyCost) * 100);
                  return (
                    <div
                      key={idx}
                      className="flex-1 bg-[#B09BD8]/60 dark:bg-[#B09BD8]/40 rounded-t-sm hover:bg-[#B09BD8]/80 transition-colors group relative"
                      style={{ height: `${heightPct}%` }}
                      title={`${day.date}: $${(day.totalCostUsd ?? 0).toFixed(4)} (${day.totalRequests} req)`}
                    >
                      <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-10">
                        {day.date}<br/>${(day.totalCostUsd ?? 0).toFixed(4)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>30j</span>
                <span>Aujourd'hui</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Total 30j: <span className="font-medium">${dailyUsage.reduce((s, d) => s + d.totalCostUsd, 0).toFixed(4)}</span>
              </p>
            </Card>
          )}

          {/* Usage Summary */}
          {usage && (
            <Card padding="sm">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                <BarChart3 size={14} /> Usage (30 jours)
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Requetes</span><span className="font-medium">{usage.totalRequests}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Tokens</span><span className="font-medium">{usage.totalTokens.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Coût</span><span className="font-medium">${(usage.totalCost ?? 0).toFixed(4)} USD</span></div>
              </div>
              {usage.byFeature.length > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
                  {usage.byFeature.map((f) => (
                    <div key={f.feature} className="flex justify-between text-xs text-gray-400">
                      <span className="truncate">{f.feature}</span>
                      <span>{f.requests} req</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
