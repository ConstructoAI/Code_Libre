/**
 * ERP React Frontend - Emails Page (Multi-Account IMAP/SMTP/OAuth)
 *
 * 7 onglets Outlook (port modules/email_manager/email_ui.py):
 *   1. Boite de Reception
 *   2. Nouveau Message (compose modal)
 *   3. Envoyes
 *   4. Brouillons
 *   5. Templates
 *   6. Configuration (multi-comptes IMAP/SMTP/OAuth)
 *   7. Synchronisation
 *
 * Pas d'IA Claude (decision utilisateur).
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import {
  Inbox, Send, FileText, Trash2, Star, Search,
  Mail, MailOpen, Paperclip, Plus,
  ChevronLeft, X, Download, Info, Settings, RefreshCw,
} from 'lucide-react';
import { useEmailsStore } from '@/store/useEmailsStore';
import type { EmailFolder } from '@/store/useEmailsStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { Textarea } from '@/components/ui/Textarea';
import { formatRelativeTime } from '@/utils/format';
import * as emailsApi from '@/api/emails';
import { EmailAccountsPanel } from '@/components/emails/EmailAccountsPanel';
import { EmailSyncPanel } from '@/components/emails/EmailSyncPanel';
import { EmailAIPanel } from '@/components/emails/EmailAIPanel';
import { EmailAIComposeButton } from '@/components/emails/EmailAIComposeButton';

// ============ HTML sanitizer ============
//
// Utilise DOMPurify pour sanitizer le HTML des emails INBOUND avant rendu via
// dangerouslySetInnerHTML. La version regex precedente etait bypass-able via:
//   - javascript&#58;alert(1)        (HTML entity encoding)
//   - java\nscript:alert(1)          (control char break)
//   - <a href=" javascript:...">     (leading whitespace)
// DOMPurify utilise un parser HTML reel qui rejette toutes ces variantes.
//
// Le webhook /webhook/inbound (n8n + Mailgun) accepte des emails Internet
// non-controles -- la surface d'attaque XSS est externe non-fiable, pas
// "interne controle" comme le commentaire precedent l'indiquait par erreur.
//
// Whitelist de tags / attributs / schemes URL similaire a bleach cote serveur.

const SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'hr', 'sub', 'sup', 'small', 'font', 'center',
  ],
  ALLOWED_ATTR: [
    'class', 'style', 'align', 'valign',
    'href', 'title', 'target', 'rel',
    'src', 'alt', 'width', 'height',
    'border', 'cellpadding', 'cellspacing',
    'colspan', 'rowspan',
    'color', 'size', 'face',
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'form', 'svg', 'base'],
  // FORBID_CONTENTS supprime AUSSI le contenu textuel des tags forbidden.
  // Sans ca, KEEP_CONTENT=true preserve par defaut le texte interieur ->
  // le CSS dans <style>...</style> apparaissait en clear text dans les
  // emails Google/Gmail (.awl a {color:#FFF...} affiche brut).
  // Pour les autres tags (script/iframe/etc.), le contenu doit aussi
  // disparaitre car il n'a pas de sens hors du tag d'origine.
  FORBID_CONTENTS: ['script', 'style', 'iframe', 'object', 'embed', 'noscript'],
};

// Hook anti reverse-tabnabbing: force rel="noopener noreferrer" sur tous
// les liens target="_blank" (mais aussi sur les liens externes en general
// pour eviter window.opener.location = phishing). Configure une seule fois.
let _domPurifyHookInstalled = false;
function _installDomPurifyHooks() {
  if (_domPurifyHookInstalled) return;
  _domPurifyHookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // node est typed Element par DOMPurify mais en TS strict il faut narrow.
    if (node instanceof HTMLAnchorElement) {
      const target = node.getAttribute('target');
      if (target === '_blank' || target === '_new' || target === '_top') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
}

function sanitizeHtml(html: string): string {
  if (!html) return '';
  _installDomPurifyHooks();
  // DOMPurify.sanitize avec Config retourne par defaut un string. Le cast
  // garantit que TS sait que ce n'est pas TrustedHTML/Document.
  return DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as string;
}

// ============ Folder definitions ============

interface FolderDef {
  key: EmailFolder;
  label: string;
  icon: React.ElementType;
}

const FOLDERS: FolderDef[] = [
  { key: 'inbox', label: 'Boîte de réception', icon: Inbox },
  { key: 'sent', label: 'Envoyés', icon: Send },
  { key: 'drafts', label: 'Brouillons', icon: FileText },
  { key: 'trash', label: 'Corbeille', icon: Trash2 },
];

// ============ Main component ============

export default function EmailsPage() {
  const {
    accounts, messages, selectedMessage, totalMessages, currentPage,
    currentFolder, folderStats, isLoading, error, successMessage,
    templates,
    fetchAccounts, fetchMessages, selectMessage, clearSelectedMessage,
    toggleStar, sendEmail, setFolder, setSearch, fetchStats,
    clearError, clearSuccess,
    deleteMessage, moveMessage,
    fetchTemplates,
  } = useEmailsStore();

  const [showCompose, setShowCompose] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [mobileShowSidebar, setMobileShowSidebar] = useState(false);

  // 7 onglets Outlook (port email_ui.py).
  type EmailTab =
    | 'inbox' | 'compose' | 'sent' | 'drafts'
    | 'templates' | 'settings' | 'sync';
  const [activeTab, setActiveTab] = useState<EmailTab>('inbox');

  // Compose form
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState('');
  // ID du compte expediteur. null = compte par defaut (INTERNAL fallback ou
  // compte multi-comptes is_default=TRUE selectionne cote backend).
  const [composeAccountId, setComposeAccountId] = useState<number | null>(null);

  // Track blob URLs for cleanup on unmount (lecon #96)
  const blobUrlsRef = useRef<Array<{ url: string; timeout: ReturnType<typeof setTimeout> }>>([]);

  // Initial fetch
  useEffect(() => {
    fetchAccounts();
    fetchMessages(1);
    fetchStats();
    fetchTemplates();
  }, [fetchAccounts, fetchMessages, fetchStats, fetchTemplates]);

  // OAuth callback feedback (apres redirect /emails?oauth_success=1&email=...)
  useEffect(() => {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get('oauth_success');
    const oerr = url.searchParams.get('oauth_error');
    const email = url.searchParams.get('email');
    if (ok && email) {
      useEmailsStore.setState({
        successMessage: `Compte ${email} connecte par OAuth`,
      });
      setActiveTab('settings');
      url.searchParams.delete('oauth_success');
      url.searchParams.delete('oauth_provider');
      url.searchParams.delete('email');
      window.history.replaceState({}, '', url.toString());
    } else if (oerr) {
      useEmailsStore.setState({
        error: `Echec de la connexion OAuth: ${oerr}`,
      });
      setActiveTab('settings');
      url.searchParams.delete('oauth_error');
      url.searchParams.delete('oauth_provider');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Polling background pour nouveaux emails (60s) — recoit via webhook Mailgun.
  // FIX (round 1 webhook):
  // - fetchStats TOUJOURS execute (badges unread restent sync meme en compose)
  // - fetchMessages conditionnel: seulement si inbox ET pas en compose
  // - fetchMessages(1) pour toujours afficher les plus recents (pas la page courante)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      if (currentFolder === 'inbox' && !showCompose) {
        fetchMessages(1);
      }
    }, 60000); // 60s
    return () => clearInterval(interval);
  }, [showCompose, currentFolder, fetchStats, fetchMessages]);

  // Auto-clear success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => clearSuccess(), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, clearSuccess]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(({ url, timeout }) => {
        clearTimeout(timeout);
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      });
      blobUrlsRef.current = [];
    };
  }, []);

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput, setSearch]);

  // ---- Compose handlers ----
  const handleCompose = useCallback(() => {
    setComposeTo('');
    setComposeCc('');
    setComposeBcc('');
    setComposeSubject('');
    setComposeBody('');
    setSelectedTemplateCode('');
    setComposeAccountId(null);
    setShowCompose(true);
  }, []);

  const handleTemplateSelect = useCallback((code: string) => {
    setSelectedTemplateCode(code);
    const tmpl = templates.find(t => t.code === code);
    if (tmpl) {
      setComposeSubject(tmpl.subjectTemplate);
      const text = tmpl.bodyHtmlTemplate
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      setComposeBody(text);
    } else {
      // Lecon #98: deselect doit vider le compose
      setComposeSubject('');
      setComposeBody('');
    }
  }, [templates]);

  const handleReply = useCallback(() => {
    if (!selectedMessage) return;
    setComposeTo(selectedMessage.emailFrom || '');
    setComposeCc('');
    setComposeBcc('');
    setComposeSubject(`Re: ${selectedMessage.subject || ''}`);
    setComposeBody(
      `\n\n--- Message original ---\nDe: ${selectedMessage.emailFrom}\nDate: ${selectedMessage.dateSent || selectedMessage.dateReceived || ''}\n\n${selectedMessage.bodyText || ''}`
    );
    setSelectedTemplateCode('');
    // Pre-selectionner le compte qui a recu l'email original (response from
    // same address). Si non trouve, fallback sur compte par defaut (null).
    setComposeAccountId(
      selectedMessage.accountId
      && accounts.some((a) => a.id === selectedMessage.accountId && a.active !== false)
        ? selectedMessage.accountId
        : null,
    );
    setShowCompose(true);
  }, [selectedMessage, accounts]);

  const handleSend = useCallback(async () => {
    if (!composeTo.trim() || composeSending) return;
    setComposeSending(true);
    try {
      // HTML body: escape < et > pour eviter HTML inattendu, preserver les
      // sauts de ligne via <br>.
      const safeHtml = composeBody
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      const result = await sendEmail({
        emailTo: composeTo.trim(),
        emailCc: composeCc.trim() || undefined,
        emailBcc: composeBcc.trim() || undefined,
        subject: composeSubject,
        bodyText: composeBody,
        bodyHtml: `<div style="font-family:Segoe UI,sans-serif;white-space:pre-wrap">${safeHtml}</div>`,
        accountId: composeAccountId ?? undefined,
      });
      // Si SMTP echoue (compte mal configure, Gmail rejette, etc.), le store
      // fixe `error` mais ne throw pas. On ne ferme PAS la modal pour
      // preserver la saisie (comportement coherent avec l'echec exception).
      if (result.smtpSent) {
        setShowCompose(false);
      }
    } catch {
      // Error shown via store; modal reste ouvert pour preserver la saisie.
    } finally {
      setComposeSending(false);
    }
  }, [composeTo, composeCc, composeBcc, composeSubject, composeBody, composeSending, composeAccountId, sendEmail]);

  const handleDownloadAttachment = useCallback(async (attachmentId: number, filename: string) => {
    try {
      const blob = await emailsApi.downloadAttachment(attachmentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      // Track for cleanup on unmount; revoke after 30s if user stays on page
      const timeout = setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        blobUrlsRef.current = blobUrlsRef.current.filter((entry) => entry.url !== url);
      }, 30000);
      blobUrlsRef.current.push({ url, timeout });
    } catch {
      useEmailsStore.setState({ error: 'Erreur lors du telechargement' });
    }
  }, []);

  // ---- Derived data ----
  const inboxUnread = useMemo(() => {
    const s = folderStats['inbox'];
    return s ? s.unreadCount : 0;
  }, [folderStats]);

  // Le bandeau "Adresse interne" affiche specifiquement le compte INTERNAL
  // (auto-cree par tenant). Les comptes externes (Gmail/Outlook/M365/etc.)
  // sont geres dans l'onglet Configuration, donc on ne fallback pas sur
  // accounts[0] qui pourrait etre un Gmail marque par defaut.
  const internalAccount = useMemo(
    () => accounts.find((a) => a.provider === 'INTERNAL') || null,
    [accounts],
  );

  // ---- Sync activeTab -> currentFolder (one-way) ----
  // Quand l'utilisateur change d'onglet (Inbox / Envoyes / Brouillons), on
  // bascule le folder du store. ATTENTION: la sync est ONE-WAY uniquement.
  // La sidebar peut faire `setFolder('trash')` independamment de activeTab,
  // c'est volontaire (la corbeille n'est pas un onglet, on l'atteint via
  // la sidebar). On ne ferme donc PAS le folder courant si l'utilisateur
  // est encore sur le tab inbox/sent/drafts -- on respecte son choix.
  const lastActiveTabRef = useRef<EmailTab>(activeTab);
  useEffect(() => {
    // Si le tab a change (vs le dernier render), forcer le folder
    if (lastActiveTabRef.current !== activeTab) {
      lastActiveTabRef.current = activeTab;
      if (activeTab === 'inbox') setFolder('inbox');
      else if (activeTab === 'sent') setFolder('sent');
      else if (activeTab === 'drafts') setFolder('drafts');
    }
  }, [activeTab, setFolder]);

  const TABS: { key: EmailTab; label: string; icon: typeof Inbox }[] = [
    { key: 'inbox', label: 'Boite de reception', icon: Inbox },
    { key: 'compose', label: 'Nouveau message', icon: Plus },
    { key: 'sent', label: 'Envoyes', icon: Send },
    { key: 'drafts', label: 'Brouillons', icon: FileText },
    { key: 'templates', label: 'Templates', icon: FileText },
    { key: 'settings', label: 'Configuration', icon: Settings },
    { key: 'sync', label: 'Synchronisation', icon: RefreshCw },
  ];

  const handleTabClick = useCallback((tab: EmailTab) => {
    if (tab === 'compose') {
      handleCompose();
      // Le compose ouvre une modal -- on garde l'onglet courant (inbox par defaut).
      setActiveTab((prev) => (prev === 'compose' ? 'inbox' : prev));
      return;
    }
    setActiveTab(tab);
  }, [handleCompose]);

  // L'onglet 'inbox' englobe aussi la navigation sidebar vers Corbeille
  // (`currentFolder === 'trash'`) — la corbeille n'a pas d'onglet propre,
  // on l'atteint via la sidebar. Le layout 3-panels est donc affiche.
  const isMessageListTab = activeTab === 'inbox' || activeTab === 'sent' || activeTab === 'drafts';

  // ---- Render ----
  return (
    <div className="flex flex-col h-[calc(100vh-100px)] relative">
      {/* ========== Barre d'onglets (7 tabs Outlook) ========== */}
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          const showUnread = t.key === 'inbox' && inboxUnread > 0;
          return (
            <button
              key={t.key}
              onClick={() => handleTabClick(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Icon size={14} />
              {t.label}
              {showUnread && (
                <Badge color="blue" size="sm">{inboxUnread}</Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* ========== Contenu Templates / Configuration / Sync ========== */}
      {activeTab === 'templates' && (
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Templates email
            </h2>
            {templates.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun template disponible.</p>
            ) : (
              <div className="space-y-2">
                {templates.map((tmpl) => (
                  <div
                    key={tmpl.id}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {tmpl.name}
                      </span>
                      <Badge color="blue" size="sm">{tmpl.category}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mb-1">code: {tmpl.code}</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 italic">
                      {tmpl.subjectTemplate}
                    </p>
                    {tmpl.variables.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        Variables: {tmpl.variables.map((v) => `{{${v}}}`).join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-4xl mx-auto">
            <EmailAccountsPanel />
          </div>
        </div>
      )}

      {activeTab === 'sync' && (
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-4xl mx-auto">
            <EmailSyncPanel />
          </div>
        </div>
      )}

      {/* ========== Layout boite de reception (3 panels) ========== */}
      {isMessageListTab && (
    <div className="flex flex-col md:flex-row flex-1 gap-0 overflow-hidden border-t border-gray-200 dark:border-gray-700 relative">
      {/* Alerts */}
      {error && (
        <div className="absolute top-4 right-4 z-50 max-w-md">
          <Alert type="error" onClose={clearError}>{error}</Alert>
        </div>
      )}
      {successMessage && (
        <div className="absolute top-4 right-4 z-50 max-w-md">
          <Alert type="success" onClose={clearSuccess}>{successMessage}</Alert>
        </div>
      )}

      {/* ========== Mobile top bar ========== */}
      <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0">
        <button
          onClick={() => setMobileShowSidebar(!mobileShowSidebar)}
          className="p-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Inbox size={18} />
        </button>
        <span className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
          {FOLDERS.find(f => f.key === currentFolder)?.label || 'Boîte de réception'}
          {inboxUnread > 0 && currentFolder === 'inbox' && (
            <Badge color="blue" size="sm" className="ml-2">{inboxUnread}</Badge>
          )}
        </span>
        <Button size="sm" onClick={handleCompose}>
          <Plus size={14} className="mr-1" /> Nouveau
        </Button>
      </div>

      {/* ========== Left Sidebar: Folders ========== */}
      <div className={`${mobileShowSidebar ? 'absolute inset-0 z-40 w-full' : 'hidden'} md:relative md:block md:w-56 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col shrink-0`}>
        {/* Mobile close */}
        <div className="flex md:hidden items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Dossiers</span>
          <button onClick={() => setMobileShowSidebar(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Compose button */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <Button onClick={handleCompose} className="w-full">
            <Plus size={16} className="mr-1" /> Nouveau message
          </Button>
        </div>

        {/* Internal account info banner (read-only) */}
        {internalAccount && (
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-blue-50/40 dark:bg-blue-900/10">
            <div className="flex items-start gap-2">
              <Info size={12} className="text-blue-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Adresse interne</p>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate" title={internalAccount.emailAddress}>
                  {internalAccount.emailAddress}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto py-1">
          {FOLDERS.map((f) => {
            const stats = folderStats[f.key];
            const unread = stats ? stats.unreadCount : 0;
            const total = stats ? stats.totalCount : 0;
            const isActive = currentFolder === f.key;
            const Icon = f.icon;
            return (
              <button
                key={f.key}
                onClick={() => { setFolder(f.key); setMobileShowSidebar(false); }}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <Icon size={16} />
                <span className="flex-1 text-left">{f.label}</span>
                {unread > 0 ? (
                  <Badge color="blue" size="sm">{unread}</Badge>
                ) : total > 0 ? (
                  <span className="text-xs text-gray-400">{total}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========== Middle: Message List ========== */}
      <div className={`${selectedMessage ? 'hidden md:flex' : 'flex w-full'} md:w-80 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex-col shrink-0`}>
        {/* Search */}
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && messages.length === 0 && (
            <div className="flex justify-center py-8"><Spinner size="md" /></div>
          )}
          {!isLoading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 px-4 text-center">
              <Mail size={28} className="mb-2" />
              <p className="text-sm">
                {currentFolder === 'inbox'
                  ? 'Aucun email reçu'
                  : currentFolder === 'sent'
                    ? 'Aucun email envoyé'
                    : currentFolder === 'drafts'
                      ? 'Aucun brouillon'
                      : 'Aucun email'}
              </p>
              {currentFolder === 'inbox' && internalAccount && (
                <p className="text-xs text-gray-400 mt-1 max-w-xs">
                  Les emails envoyés à <span className="font-medium">{internalAccount.emailAddress}</span> apparaîtront ici (rafraîchi toutes les 60s).
                </p>
              )}
            </div>
          )}

          {messages.map((msg) => {
            const isSelected = selectedMessage?.id === msg.id;
            const isUnread = !msg.isRead;
            return (
              <button
                key={msg.id}
                onClick={() => selectMessage(msg.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 transition-colors ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-1.5 shrink-0">
                    {isUnread ? <div className="w-2 h-2 rounded-full bg-[#7BAFD4]" /> : <div className="w-2 h-2" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                        {currentFolder === 'sent' || currentFolder === 'drafts'
                          ? (msg.emailTo || '--')
                          : (msg.emailFromName || msg.emailFrom || '--')}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {formatRelativeTime(msg.dateReceived || msg.dateSent)}
                      </span>
                    </div>
                    <p className={`text-sm truncate mt-0.5 ${isUnread ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'}`}>
                      {msg.subject || '(sans objet)'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {msg.isStarred && <Star size={12} className="text-yellow-500 fill-yellow-500" />}
                      {msg.hasAttachments && <Paperclip size={12} className="text-gray-400" />}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Pagination */}
          {totalMessages > 50 && (
            <div className="flex items-center justify-center gap-2 py-3">
              <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => fetchMessages(currentPage - 1)}>Préc.</Button>
              <span className="text-xs text-gray-400">Page {currentPage} / {Math.ceil(totalMessages / 50)}</span>
              <Button variant="ghost" size="sm" disabled={currentPage * 50 >= totalMessages} onClick={() => fetchMessages(currentPage + 1)}>Suiv.</Button>
            </div>
          )}
        </div>
      </div>

      {/* ========== Right: Reading Pane ========== */}
      <div className={`${selectedMessage ? 'flex w-full' : 'hidden'} md:flex md:w-auto flex-1 flex-col bg-white dark:bg-gray-900 min-w-0`}>
        {selectedMessage ? (
          <>
            {/* Email header */}
            <div className="px-3 md:px-5 py-3 md:py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={clearSelectedMessage}
                  className="md:hidden p-1.5 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 transition-colors shrink-0 mt-0.5"
                >
                  <ChevronLeft size={20} />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                    {selectedMessage.subject || '(sans objet)'}
                  </h2>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {selectedMessage.emailFromName || selectedMessage.emailFrom}
                    </span>
                    {selectedMessage.emailFromName && (
                      <span className="ml-1 text-xs text-gray-400">&lt;{selectedMessage.emailFrom}&gt;</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    A: {selectedMessage.emailTo}
                    {selectedMessage.emailCc && <span className="ml-2">Cc: {selectedMessage.emailCc}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    {formatRelativeTime(selectedMessage.dateReceived || selectedMessage.dateSent)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleStar(selectedMessage.id)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title={selectedMessage.isStarred ? 'Retirer le favori' : 'Marquer comme favori'}
                  >
                    <Star size={16} className={selectedMessage.isStarred ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400'} />
                  </button>
                  {/* FIX (round 1): bouton Archive retire (folder 'archive' n'est
                      pas dans EmailFolder type ni dans la sidebar). En mode
                      interne 100% sortant, le pattern est: garder dans Sent
                      ou supprimer (Trash). */}
                  <button
                    onClick={() => {
                      const action = currentFolder === 'trash' ? 'definitivement supprimer' : 'mettre a la corbeille';
                      if (confirm(`Voulez-vous ${action} ce message ?`)) {
                        deleteMessage(selectedMessage.id);
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-400 hover:text-red-500"
                    title={currentFolder === 'trash' ? 'Supprimer définitivement' : 'Mettre à la corbeille'}
                  >
                    <Trash2 size={16} />
                  </button>
                  <Button variant="ghost" size="sm" onClick={handleReply}>Répondre</Button>
                  <button onClick={clearSelectedMessage} className="hidden md:block p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Email body */}
            <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4">
              {selectedMessage.bodyHtml ? (
                <div
                  className="prose dark:prose-invert max-w-none text-sm"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedMessage.bodyHtml) }}
                />
              ) : (
                <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">
                  {selectedMessage.bodyText || '(aucun contenu)'}
                </pre>
              )}

              {/* Assistant IA: suggerer / repondre auto / analyser */}
              {selectedMessage.folder === 'inbox' && (
                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <EmailAIPanel
                    email={selectedMessage}
                    accounts={accounts}
                    onUseSuggestion={(subject, body, accId) => {
                      setComposeTo(selectedMessage.emailFrom || '');
                      setComposeCc('');
                      setComposeBcc('');
                      setComposeSubject(subject);
                      setComposeBody(body);
                      setSelectedTemplateCode('');
                      setComposeAccountId(accId ?? null);
                      setShowCompose(true);
                    }}
                  />
                </div>
              )}

              {/* Attachments */}
              {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Pièces jointes ({selectedMessage.attachments.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedMessage.attachments.map((att) => (
                      <button
                        key={att.id}
                        onClick={() => handleDownloadAttachment(att.id, att.filename)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 transition-colors cursor-pointer"
                        title="Télécharger"
                      >
                        <Paperclip size={14} className="text-gray-400 shrink-0" />
                        <span className="text-gray-700 dark:text-gray-300 truncate max-w-[120px] sm:max-w-[200px]">
                          {att.filename}
                        </span>
                        <span className="text-xs text-gray-400 shrink-0">
                          {att.sizeBytes ? `${(att.sizeBytes / 1024).toFixed(0)} Ko` : ''}
                        </span>
                        <Download size={12} className="text-blue-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 px-6 text-center">
            <MailOpen size={40} className="mb-3" />
            <p className="text-sm">Sélectionnez un email pour le lire</p>
            {internalAccount && (
              <p className="text-xs text-gray-400 mt-2">
                Votre adresse: <span className="font-medium">{internalAccount.emailAddress}</span>
              </p>
            )}
          </div>
        )}
      </div>

    </div>
      )}

      {/* ========== Compose Modal ========== */}
      <Modal isOpen={showCompose} onClose={() => setShowCompose(false)} title="Nouveau message" size="lg">
        <div className="space-y-3">
          {/* Selecteur de compte expediteur (multi-comptes) */}
          {accounts.filter((a) => a.active !== false).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                De
              </label>
              <select
                value={composeAccountId ?? ''}
                onChange={(e) => setComposeAccountId(e.target.value ? parseInt(e.target.value, 10) : null)}
                className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">
                  Compte par defaut
                  {internalAccount ? ` (${internalAccount.emailAddress})` : ''}
                </option>
                {accounts
                  .filter((a) => a.active !== false)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName || a.name || a.emailAddress} &lt;{a.emailAddress}&gt;
                      {a.isDefault ? ' (defaut)' : ''}
                      {a.provider && a.provider !== 'INTERNAL' ? ` -- ${a.provider}` : ''}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Template selector */}
          {templates.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modèle</label>
              <select
                value={selectedTemplateCode}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Choisir un modèle --</option>
                {templates.map((t) => (
                  <option key={t.code} value={t.code}>{t.name} ({t.category})</option>
                ))}
              </select>
            </div>
          )}
          <Input label="A *" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="destinataire@example.com" required />
          <Input label="Cc" value={composeCc} onChange={(e) => setComposeCc(e.target.value)} placeholder="copie@example.com" />
          <Input label="Cci" value={composeBcc} onChange={(e) => setComposeBcc(e.target.value)} placeholder="copie cachée@example.com" />

          {/* Bouton "Rediger avec IA" -- ouvre une modale de generation IA
              qui pre-remplit sujet + corps depuis instructions libres.
              Place avant Objet/Message pour visibilite, full-width mobile. */}
          <EmailAIComposeButton
            recipientEmail={composeTo.trim() || undefined}
            onApply={(subject, body) => {
              setComposeSubject(subject);
              setComposeBody(body);
              // Eviter qu'un template prealablement selectionne reste affiche
              // alors que le contenu vient maintenant de l'IA.
              setSelectedTemplateCode('');
            }}
          />

          <Input label="Objet" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="Objet du message" />
          <Textarea label="Message" value={composeBody} onChange={(e) => setComposeBody(e.target.value)} placeholder="Écrivez votre message..." rows={8} />
          {/* Actions: stack mobile, flex desktop */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCompose(false)} className="w-full sm:w-auto">
              Annuler
            </Button>
            <Button
              onClick={handleSend}
              disabled={!composeTo.trim() || composeSending}
              className="w-full sm:w-auto justify-center"
            >
              {composeSending ? <Spinner size="sm" /> : <Send size={16} className="mr-1" />}
              Envoyer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
