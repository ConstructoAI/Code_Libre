/**
 * Estimation IA — Chat expert + generation soumission structuree
 * Claude Opus, 63 profils experts, historique BD
 * Style inspire de la version Streamlit (bordures accent, markdown riche, animations)
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  MessageSquare, Send, Sparkles, FileUp, Save, Trash2, Download, Paperclip,
  History, X, Plus, Pencil, Check, Loader2, User, HardHat, ChevronUp, Calendar,
  CreditCard, Settings,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import AiProfileManager from './AiProfileManager';
import ClientInfoCard from './ClientInfoCard';
import * as devisApi from '../../api/devis';
import type { ExpertProfile, ChatMessage, SoumissionItem, Conversation, ConversationDocument } from '../../api/devis';
import * as aiApi from '../../api/ai';
import type { AiCredits } from '../../api/ai';
import * as companiesApi from '../../api/companies';
import type { Company, Contact } from '../../api/companies';

/* ------------------------------------------------------------------ */
/*  Markdown → HTML renderer (Streamlit-quality)                       */
/* ------------------------------------------------------------------ */
function renderMarkdown(text: string): string {

  // D365 Fluent theme — Segoe UI + navy #002050 + slate text.
  // Use single quotes inside font stack because these strings are interpolated into
  // inline style="..." attributes. Double quotes would terminate the HTML attribute early.
  const FONT = "'Segoe UI','Segoe UI Web','Segoe UI Symbol',system-ui,-apple-system,Roboto,sans-serif";
  const MONO = "'Cascadia Code','Cascadia Mono','Consolas','SF Mono',ui-monospace,monospace";

  // Fix bloc code (2026-05-17): Extraire les blocs ```...``` AVANT les autres
  // replacements pour eviter que la regex \n\n -> </p><p style="color:#334155">
  // (ligne ~205) ne s'injecte au milieu du <pre>, ce qui forcait une partie
  // du contenu en gris fonce illisible sur fond noir. On stocke chaque bloc
  // dans un array indexe par placeholder, on travaille sur le reste du texte,
  // puis on restaure les blocs a la fin (avant return).
  const codeBlocks: string[] = [];
  const textWithPlaceholders = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, content: string) => {
    const idx = codeBlocks.length;
    const escapedContent = content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // color:#e6edf3 sur le <code> aussi pour qu'aucun fragment (meme s'il
    // contient un <p> orphelin par un autre bug futur) ne tombe sur le gris.
    // white-space:pre pour preserver les espaces/indentation des blocs ```text.
    const blockHtml = `<pre style="background:#0d1117;color:#e6edf3;border-radius:6px;padding:14px 18px;margin:12px 0;font-size:12px;line-height:1.55;overflow-x:auto;border:1px solid #30363d;font-family:${MONO}"><code style="color:#e6edf3;background:transparent;border:none;padding:0;font-family:inherit;font-size:inherit;white-space:pre;display:block">${escapedContent}</code></pre>`;
    codeBlocks.push(blockHtml);
    // Entoure le placeholder de \n\n pour le sortir des paragraphes adjacents
    // (la regex de paragraphes wrap le placeholder mais le step de restoration
    // strippera le <p> wrapper avant remplacement).
    return `\n\n__EIA_CODE_BLOCK_${idx}__\n\n`;
  });

  let html = textWithPlaceholders
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Inline code
    .replace(/`([^`]+)`/g,
      `<code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12.5px;font-family:${MONO};color:#002050;border:1px solid #e2e8f0">$1</code>`)
    // Headers
    .replace(/^#### (.+)$/gm,
      `<h6 style="font-family:${FONT};font-weight:600;font-size:12px;margin:14px 0 4px;color:#64748b;text-transform:uppercase;letter-spacing:0.6px">$1</h6>`)
    .replace(/^### (.+)$/gm,
      `<div style="font-family:${FONT};font-weight:600;font-size:14px;margin:18px 0 8px;padding:0 0 4px 0;color:#002050;border-bottom:1px solid #e2e8f0;letter-spacing:0.1px">$1</div>`)
    .replace(/^## (.+)$/gm,
      `<div style="font-family:${FONT};font-weight:600;font-size:16px;margin:20px 0 10px;padding:0 0 6px 0;color:#002050;border-bottom:2px solid #002050;letter-spacing:0.1px">$1</div>`)
    .replace(/^# (.+)$/gm,
      `<div style="font-family:${FONT};font-weight:600;font-size:18px;margin:22px 0 12px;padding:10px 16px;background:#002050;color:white;border-radius:6px;letter-spacing:0.2px">$1</div>`)
    // Bold & italic — inherit color (so they match surrounding text instead of forcing blue)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:600">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em style="color:#64748b">$1</em>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr style="margin:16px 0;border:none;height:1px;background:#e2e8f0"/>')
    ;

  // Tables — process line by line (resets header state between tables)
  {
    const tLines = html.split('\n');
    let inTable = false;
    let rowIdx = 0;
    // Captured across header → data rows so alignment stays consistent per column
    let numCols = 0;
    let seenSeparator = false;
    let colMeta: Array<{ isNum: boolean; colType: 'text' | 'small' | 'money' }> = [];

    const _noAccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const _isNumHeader = (h: string) => {
      const n = _noAccent(h);
      return /(\$|%|Montant|Qte|Quantit|Prix|Total|Cout|M[\s.\-]?O|Mate|pi[²2]?|Superficie|Heures|Taux|Honoraires|h\/)/i.test(n);
    };
    const _isSmallCol = (h: string) => /^(#|no\.?|qte|quantit|unite|forf)/i.test(_noAccent(h));
    // Short words (type, nom) require word boundary to avoid false positives like "Nombre" matching "^nom".
    const _isTextCol = (h: string) => {
      const n = _noAccent(h);
      return /^(description|element|poste|mesure|phase|semaine|corps|travaux|item|activit|categorie|libelle|rubrique|ventilation)/i.test(n) ||
             /^(type|nom)\b/i.test(n);
    };

    const resetTableState = () => { inTable = false; rowIdx = 0; numCols = 0; seenSeparator = false; colMeta = []; };

    html = tLines.map(ln => {
      // Accept any row containing a pipe — don't require a trailing pipe (robust to AI output)
      if (!/\|/.test(ln) || !/^\s*\|/.test(ln.trim())) {
        if (inTable) resetTableState();
        return ln;
      }
      // Parse cells: keep empty cells in the middle, strip only outer empty cells from outer pipes
      const parts = ln.split('|');
      const startIdx = parts.length > 0 && parts[0].trim() === '' ? 1 : 0;
      const endIdx = parts.length > 0 && parts[parts.length - 1].trim() === '' ? parts.length - 1 : parts.length;
      const cells = parts.slice(startIdx, endIdx).map(c => c.trim());
      if (cells.length === 0) {
        if (inTable) resetTableState();
        return ln;
      }
      // Separator row (|---|---|) — per GFM spec, each cell must contain at least 3 dashes.
      // Additional constraint: we only accept ONE separator per table and only if no data
      // row has been processed yet (via `seenSeparator` flag). This prevents data rows like
      // `| --- | --- |` (where `---` is legitimate content meaning "not applicable") from
      // being falsely consumed as separators and silently discarded.
      const isSeparatorPattern = cells.every(c => /^[\s:]*-{3,}[\s:]*$/.test(c));
      if (isSeparatorPattern && !seenSeparator && rowIdx === 0) {
        // Orphan separator without a preceding header: treat as plain text, don't enter table state
        if (!inTable && numCols === 0) return ln;
        inTable = true;
        seenSeparator = true;
        // Use a unique marker instead of '' so the join('\n') doesn't produce stray \n\n
        // that would later corrupt the wrap regex. The marker is stripped before wrapping.
        return '__EIA_TABLE_SEP__';
      }
      // Header row (first |...| row of a new table)
      if (!inTable) {
        inTable = true;
        rowIdx = 0;
        seenSeparator = false;
        numCols = cells.length;
        // Classify each column: 'text' (wide), 'small' (narrow), 'money' (medium)
        colMeta = cells.map((c, ci) => {
          const h = c;
          let colType: 'text' | 'small' | 'money';
          if (h === '') colType = 'small';
          else if (ci === 0 && _isTextCol(h)) colType = 'text';
          else if (_isSmallCol(h)) colType = 'small';
          else if (_isTextCol(h)) colType = 'text';
          else colType = 'money';
          // Money/small columns are right-aligned; header text may also be numeric-looking
          const isNum = colType === 'money' || colType === 'small' || _isNumHeader(h);
          return { isNum, colType };
        });
        const minW = (t: 'text' | 'small' | 'money') => t === 'text' ? 180 : t === 'small' ? 48 : 96;
        return '<tr>' + cells.map((c, ci) => {
          const meta = colMeta[ci];
          // Header alignment: text cols stay left; small # col stays left; money cols align right
          const headerAlign = meta.colType === 'text' ? 'left' : (meta.colType === 'money' || _isNumHeader(c)) ? 'right' : 'left';
          return `<th style="background:#002050;color:#ffffff;padding:12px 16px;font-family:${FONT};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;border:none;border-right:1px solid #002b6b;white-space:nowrap;text-align:${headerAlign};vertical-align:middle;min-width:${minW(meta.colType)}px">${c}</th>`;
        }).join('') + '</tr>';
      }
      // Data row — pad/trim to match header column count so alignment is preserved
      rowIdx++;
      // Defensive: if the row has FEWER cells than the header and starts with TOTAL/SOUS-TOTAL,
      // pad AFTER the first cell so the label stays in col 0 and values land in the money columns
      // on the right. This handles AI output that drops unused cells in total rows.
      // Strip inline HTML tags (e.g. <strong> from **bold**) before matching — otherwise a row
      // starting with **Total** would have firstCell='<strong...>Total</strong>' and not match.
      const firstCellLower = _noAccent((cells[0] || '').replace(/<[^>]+>/g, '')).toLowerCase();
      const isSubtotal = /\bsous[- ]?total\b|\bgrand\s+total\b|^total\b/i.test(firstCellLower);
      if (isSubtotal && cells.length < numCols) {
        while (cells.length < numCols) cells.splice(1, 0, '');
      } else {
        while (cells.length < numCols) cells.push('');
      }
      if (cells.length > numCols) cells.length = numCols;
      const bg = rowIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
      const rowBg = isSubtotal ? '#f0f6ff' : bg;
      return '<tr style="background:' + rowBg + '">' + cells.map((c, ci) => {
        const v = c;
        // Alignment comes from the header classification — NOT from re-detecting per cell.
        // Small (#, No, Qté) and text columns align left; money columns align right — matches header alignment.
        const meta = colMeta[ci] || { isNum: false, colType: 'text' as const };
        const alignRight = meta.colType === 'money';
        // Base text style: D365 typography, uniform slate gray (#334155), no per-cell color override.
        // Bold/navy emphasis is reserved for subtotal rows only, per accounting convention.
        const alignStyle = alignRight
          ? `text-align:right;font-family:${MONO};font-variant-numeric:tabular-nums;white-space:nowrap;`
          : `text-align:left;font-family:${FONT};word-wrap:break-word;`;
        const subtotalStyle = isSubtotal
          ? 'font-weight:600;color:#002050;border-top:2px solid #002050;'
          : 'color:#334155;';
        return `<td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f1f5f9;vertical-align:middle;${alignStyle}${subtotalStyle}">${v}</td>`;
      }).join('') + '</tr>';
    }).join('\n');
  }

  // Unordered lists
  html = html.replace(/((?:^[-*] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line =>
      `<li style="margin:4px 0;padding-left:6px;position:relative">${line.replace(/^[-*] /, '')}</li>`
    ).join('');
    return `<ul style="list-style:none;padding-left:16px;margin:10px 0;font-family:${FONT};color:#334155">${items.replace(/<li /g, '<li style="margin:4px 0;padding-left:20px;position:relative;' +
      'background-image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxjaXJjbGUgY3g9IjQiIGN5PSI0IiByPSIzIiBmaWxsPSIjMDAyMDUwIi8+PC9zdmc+);' +
      'background-repeat:no-repeat;background-position:0 6px;background-size:8px" ')}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map((line, idx) =>
      `<li style="margin:4px 0;padding-left:6px;counter-increment:item"><span style="color:#002050;font-weight:600;margin-right:6px">${idx + 1}.</span>${line.replace(/^\d+\. /, '')}</li>`
    ).join('');
    return `<ol style="list-style:none;padding-left:12px;margin:10px 0;font-family:${FONT};color:#334155">${items}</ol>`;
  });

  // Strip separator markers (they only existed to keep split/join positional; remove without leaving whitespace gaps).
  html = html.replace(/\n__EIA_TABLE_SEP__/g, '');
  html = html.replace(/__EIA_TABLE_SEP__\n?/g, '');

  // Wrap table rows — D365 Fluent card: subtle shadow, rounded, neutral border, white surface.
  html = html.replace(/((?:<tr[^>]*>.*?<\/tr>\n?)+)/g,
    `<div style="overflow-x:auto;margin:14px 0;border-radius:8px;box-shadow:0 1px 3px 0 rgba(0,0,0,0.05);border:1px solid #e2e8f0;background:#ffffff"><table style="width:100%;border-collapse:collapse;font-family:${FONT};font-size:13px">$1</table></div>`);

  // Paragraphs
  const PARA_STYLE = `margin:10px 0;line-height:1.65;color:#334155;font-family:${FONT};font-size:14px`;
  html = html.replace(/\n\n/g, `</p><p style="${PARA_STYLE}">`);
  html = `<p style="${PARA_STYLE}">` + html + '</p>';
  // Strip empty paragraphs (simpler and robust regardless of inline style contents)
  html = html.replace(/<p[^>]*><\/p>/g, '');

  // Restoration des blocs code (placeholders __EIA_CODE_BLOCK_N__ inseres au
  // debut). On strip d'abord le <p> wrapper qui les entoure (sinon on aurait
  // un <pre> dans un <p>, invalide HTML), puis on remplace l'occurrence.
  html = html.replace(/<p[^>]*>\s*__EIA_CODE_BLOCK_(\d+)__\s*<\/p>/g,
    (_m, idx: string) => codeBlocks[parseInt(idx, 10)] || '');
  html = html.replace(/__EIA_CODE_BLOCK_(\d+)__/g,
    (_m, idx: string) => codeBlocks[parseInt(idx, 10)] || '');

  return html;
}

/* ------------------------------------------------------------------ */
/*  Inline CSS for animations + chat styling                           */
/* ------------------------------------------------------------------ */
const ANIMATION_STYLES = `
@keyframes eia-fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
@keyframes eia-slideR { from { opacity:0; transform:translateX(12px) } to { opacity:1; transform:translateX(0) } }
@keyframes eia-pulse { 0%,100% { opacity:1 } 50% { opacity:.6 } }
.eia-msg-ai { animation: eia-fadeIn .4s ease-out; }
.eia-msg-user { animation: eia-slideR .3s ease-out; }
.eia-thinking { animation: eia-pulse 1.5s ease-in-out infinite; }
.eia-chat-area { background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 50%, #e8eef5 100%); }
.eia-chat-area table tr:hover td { background: #eff6ff !important; }
`;

export interface ClientInfo {
  nomProjet: string;
  clientCompanyId?: number;
  clientContactId?: number;
  clientNomDirect?: string;
  poClient?: string;
  datePrevu?: string;
  dateSoumis?: string;
  priorite?: string;
  description?: string;
}

interface Props {
  devisId?: number;
  devisNom?: string;
  onApplyToDevis?: (items: SoumissionItem[], clientInfo: ClientInfo) => void;
  onCreateDevis?: (items: SoumissionItem[], clientInfo: ClientInfo) => void;
}

export default function EstimationIA({ devisId, devisNom, onApplyToDevis, onCreateDevis }: Props) {
  const [profiles, setProfiles] = useState<ExpertProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('ENTREPRENEUR_GENERAL');
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [soumissionItems, setSoumissionItems] = useState<SoumissionItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editItem, setEditItem] = useState<SoumissionItem | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  // Edition inline du nom d'une conversation dans le panneau historique
  const [editingConvId, setEditingConvId] = useState<number | null>(null);
  const [editingConvName, setEditingConvName] = useState('');
  const [credits, setCredits] = useState<AiCredits | null>(null);
  // Documents persistes de la conversation courante (plans, devis Excel, etc.)
  const [conversationDocuments, setConversationDocuments] = useState<ConversationDocument[]>([]);
  // Categorie detectee par l'Entrepreneur general au premier upload
  const [detectedCategory, setDetectedCategory] = useState<{
    category?: string;
    subcategory?: string;
    superficie?: number;  // Superficie A ESTIMER (zones touchees)
    superficieRenovation?: number;  // Zone B
    superficieAgrandissement?: number;  // Zone C
    superficieExistant?: number;  // Zone A (exclue du calcul)
  } | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<'upload' | 'analyze'>('upload');
  const [uploadFileName, setUploadFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const [chatFiles, setChatFiles] = useState<File[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const soumissionTopRef = useRef<HTMLDivElement>(null);

  // --- Client info form ---
  const [showClientForm, setShowClientForm] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [clientForm, setClientForm] = useState<ClientInfo>({
    nomProjet: '', clientCompanyId: undefined, clientContactId: undefined,
    clientNomDirect: '', poClient: '', datePrevu: '', dateSoumis: '',
    priorite: 'NORMAL', description: '',
  });

  const reloadProfiles = useCallback(() => {
    devisApi.listExpertProfiles().then(r => setProfiles(r.profiles)).catch(() => {});
  }, []);

  useEffect(() => {
    reloadProfiles();
    devisApi.listConversations().then(r => setConversations(r.items)).catch(() => {});
    aiApi.getCredits().then(setCredits).catch(() => {});
    // Load companies & contacts for client form
    Promise.all([
      companiesApi.listCompanies({ perPage: 100 }),
      companiesApi.listContacts({ perPage: 100 }),
    ]).then(([compRes, contRes]) => {
      setCompanies(compRes.items);
      setContacts(contRes.items);
    }).catch(() => {});
  }, [reloadProfiles]);

  const customProfiles = useMemo(() => profiles.filter(p => p.source === 'custom'), [profiles]);
  const systemProfiles = useMemo(() => profiles.filter(p => p.source !== 'custom'), [profiles]);

  const balanceTextColor = useMemo(() => {
    if (!credits || credits.isExempt) return 'text-green-600';
    if (credits.balanceUsd > 5) return 'text-green-600';
    if (credits.balanceUsd > 0) return 'text-yellow-600';
    return 'text-red-600';
  }, [credits]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // --- Chat ---
  const sendMessage = useCallback(async () => {
    if ((!input.trim() && chatFiles.length === 0) || loading) return;
    const fileNames = chatFiles.map(f => f.name);
    const userText = input.trim() || (fileNames.length ? `Analyse ces fichiers: ${fileNames.join(', ')}` : '');
    const userMsg: ChatMessage = { role: 'user', content: userText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    const filesToSend = [...chatFiles];
    setChatFiles([]);
    if (chatFileInputRef.current) chatFileInputRef.current.value = '';
    setLoading(true);
    setError(null);
    try {
      const res = filesToSend.length > 0
        ? await devisApi.aiChatWithFiles({ messages: newMessages, profileId: selectedProfile, devisId, conversationId: currentConversationId ?? undefined, files: filesToSend })
        : await devisApi.aiChat({ messages: newMessages, profileId: selectedProfile, devisId, conversationId: currentConversationId ?? undefined });
      const updatedMessages = [...newMessages, { role: 'assistant' as const, content: res.response }];
      setMessages(updatedMessages);

      // Si aiChatWithFiles a persiste de nouveaux fichiers, refresh les chips.
      // Le type retour a persistedFiles seulement pour aiChatWithFiles.
      const persisted = (res as { persistedFiles?: Array<{ id: number; filename: string }> }).persistedFiles;
      if (persisted && persisted.length && currentConversationId) {
        devisApi.listConversationDocuments(currentConversationId)
          .then(r => setConversationDocuments(r.items || []))
          .catch(() => {});
      }

      // Auto-save conversation after each AI response
      // NB: utilise un snapshot local du profil pour eviter la closure stale
      // (si setSelectedProfile a ete appele recemment, la valeur pourrait
      // ne pas etre encore propagee au prochain render).
      const profileSnapshot = selectedProfile;
      const autoName = newMessages.find(m => m.role === 'user')?.content.slice(0, 50) + '...' || 'Conversation';
      const savePayload = {
        name: autoName, devisId, messages: updatedMessages,
        expertProfile: profileSnapshot, metadata: JSON.stringify(clientForm),
      };
      try {
        if (currentConversationId) {
          await devisApi.updateConversation(currentConversationId, savePayload);
        } else {
          const saved = await devisApi.saveConversation(savePayload);
          setCurrentConversationId(saved.id);
        }
        devisApi.listConversations().then(r => setConversations(r.items)).catch(() => {});
      } catch { /* auto-save silencieux */ }
      // Refresh credits after AI call
      aiApi.getCredits().then(setCredits).catch(() => {});
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 402) {
        setError('Crédits IA épuisés. Veuillez recharger votre solde pour continuer.');
      } else if (status === 403) {
        setError('Accès au service IA refusé. Contactez le support.');
      } else {
        setError(err?.response?.data?.detail || 'Erreur de communication avec le service IA');
      }
      // Restore files on error so user doesn't have to re-attach
      if (filesToSend.length > 0) setChatFiles(filesToSend);
    }
    setLoading(false);
  }, [input, messages, selectedProfile, devisId, currentConversationId, clientForm, chatFiles]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // --- File upload ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validation client-side: 32 Mo max (limite Anthropic payload)
    const MAX_SIZE = 32 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setError(`Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo). Maximum: 32 Mo.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true); setError(null);
    setUploadProgress(0); setUploadPhase('upload'); setUploadFileName(file.name);
    // IMPORTANT: premier upload dans une conversation IA = diagnostic
    // Entrepreneur general (detection categorie parmi 5: Residentiel neuf,
    // Renovation residentielle, Commercial neuf, Commercial renovation,
    // Institutionnel). Le profil bascule automatiquement sur Entrepreneur
    // general pour ce premier diagnostic. IMPORTANT: on utilise effectiveProfile
    // localement car setSelectedProfile est async (closure stale sinon).
    const isFirstUpload = messages.length === 0;
    const effectiveProfile = isFirstUpload ? 'ENTREPRENEUR_GENERAL' : selectedProfile;
    if (isFirstUpload && selectedProfile !== 'ENTREPRENEUR_GENERAL') {
      setSelectedProfile('ENTREPRENEUR_GENERAL');
    }
    try {
      const res = await devisApi.aiAnalyzeDocument(file, (ev) => {
        if (ev.total) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setUploadProgress(pct);
          if (pct >= 100) setUploadPhase('analyze');
        }
      }, currentConversationId ?? undefined);
      const summary = res.summary || '';
      // Capture la categorie detectee pour affichage dans un badge
      if (res.category) {
        setDetectedCategory({
          category: res.category,
          subcategory: res.subcategory,
          superficie: res.superficiePi2,
          superficieRenovation: res.superficieRenovationPi2,
          superficieAgrandissement: res.superficieAgrandissementPi2,
          superficieExistant: res.superficieExistantConservePi2,
        });
      }
      if (summary) {
        const updatedMessages = [...messages,
          { role: 'user' as const, content: `[Document analysé: ${file.name}]` },
          { role: 'assistant' as const, content: summary },
        ];
        setMessages(updatedMessages);

        // Auto-save after document analysis (same logic as sendMessage)
        const autoName = `[Document] ${file.name}`.slice(0, 50) + '...';
        const savePayload = {
          name: autoName, devisId, messages: updatedMessages,
          expertProfile: effectiveProfile, metadata: JSON.stringify(clientForm),
        };
        let activeConvId = currentConversationId;
        try {
          if (currentConversationId) {
            await devisApi.updateConversation(currentConversationId, savePayload);
          } else {
            const saved = await devisApi.saveConversation(savePayload);
            setCurrentConversationId(saved.id);
            activeConvId = saved.id;
          }
          devisApi.listConversations().then(r => setConversations(r.items)).catch(() => {});
        } catch { /* auto-save silencieux */ }
        // Refresh les chips documents (le backend vient de persister le nouveau
        // fichier + linker les orphelins si saveConversation vient de creer la conv)
        if (activeConvId) {
          devisApi.listConversationDocuments(activeConvId)
            .then(r => setConversationDocuments(r.items || []))
            .catch(() => {});
        }
        aiApi.getCredits().then(setCredits).catch(() => {});
      } else { setError('Impossible d\'analyser ce document.'); }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 402) { setError('Crédits IA épuisés. Veuillez recharger votre solde.'); }
      else if (status === 403) { setError('Accès au service IA refusé.'); }
      else { setError(err?.response?.data?.detail || 'Erreur lors de l\'analyse du document'); }
    }
    setUploading(false); setUploadProgress(0); setUploadFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Generate soumission ---
  const handleGenerateSoumission = async () => {
    if (messages.length === 0) { setError('Démarrez une conversation avant de générer une soumission'); return; }
    setGenerating(true); setError(null);
    try {
      const res = await devisApi.aiGenerateSoumission({ messages, profileId: selectedProfile });
      if (res.items?.length) { setSoumissionItems(res.items); setSuccess(`${res.items.length} items générés`); }
      else { setError('Aucun item généré. Ajoutez plus de détails.'); }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 402) { setError('Crédits IA épuisés. Veuillez recharger votre solde.'); }
      else if (status === 403) { setError('Accès au service IA refusé.'); }
      else { setError(err?.response?.data?.detail || 'Erreur lors de la génération'); }
    }
    setGenerating(false);
  };

  // --- Inline edit ---
  const startEdit = (idx: number) => { setEditIdx(idx); setEditItem({ ...soumissionItems[idx] }); };
  const saveEdit = () => {
    if (editIdx === null || !editItem) return;
    const updated = [...soumissionItems];
    editItem.montantLigne = Math.round(editItem.quantite * editItem.prixUnitaire * 100) / 100;
    updated[editIdx] = editItem;
    setSoumissionItems(updated); setEditIdx(null); setEditItem(null);
  };
  const removeItem = (idx: number) => { setSoumissionItems(soumissionItems.filter((_, i) => i !== idx)); };

  const totalSoumission = soumissionItems.reduce((s, it) => s + (it.montantLigne || 0), 0);
  const tps = Math.round(totalSoumission * 0.05 * 100) / 100;
  const tvq = Math.round(totalSoumission * 0.09975 * 100) / 100;
  const totalTTC = Math.round((totalSoumission + tps + tvq) * 100) / 100;

  // Group items by corps de métier (categorie)
  const groupedItems = soumissionItems.reduce<Record<string, { items: (SoumissionItem & { idx: number })[]; total: number }>>((acc, it, idx) => {
    const cat = it.categorie || 'General';
    if (!acc[cat]) acc[cat] = { items: [], total: 0 };
    acc[cat].items.push({ ...it, idx });
    acc[cat].total += it.montantLigne || 0;
    return acc;
  }, {});
  const sectionNames = Object.keys(groupedItems);

  // --- Conversations ---
  const handleSave = async () => {
    if (!saveName.trim() || messages.length === 0) return;
    try {
      const payload = {
        name: saveName.trim(), devisId, messages, expertProfile: selectedProfile,
        metadata: JSON.stringify(clientForm),
      };
      if (currentConversationId) {
        await devisApi.updateConversation(currentConversationId, payload);
      } else {
        const saved = await devisApi.saveConversation(payload);
        setCurrentConversationId(saved.id);
      }
      setSuccess('Conversation sauvegardée'); setShowSaveDialog(false); setSaveName('');
      const r = await devisApi.listConversations(); setConversations(r.items);
    } catch { setError('Erreur lors de la sauvegarde'); }
  };
  const loadConversation = async (conv: Conversation) => {
    try {
      const full = await devisApi.getConversation(conv.id);
      setMessages(full.messages || []);
      setCurrentConversationId(conv.id);
      // Restore client form if saved
      if (full.metadata) {
        try {
          const saved = typeof full.metadata === 'string' ? JSON.parse(full.metadata) : full.metadata;
          setClientForm(prev => ({ ...prev, ...saved }));
          setShowClientForm(true);
        } catch { /* ignore parse errors */ }
      }
      // Charge les documents persistes (plans, devis Excel, etc.) pour que
      // Claude puisse les reconsulter et que l'UI affiche les chips.
      try {
        const docsRes = await devisApi.listConversationDocuments(conv.id);
        setConversationDocuments(docsRes.items || []);
        // Restore la categorie detectee si disponible
        const catDoc = (docsRes.items || []).find(d => d.category);
        if (catDoc) {
          setDetectedCategory({
            category: catDoc.category,
            subcategory: catDoc.subcategory,
            superficie: catDoc.superficiePi2,
            superficieRenovation: catDoc.superficieRenovationPi2,
            superficieAgrandissement: catDoc.superficieAgrandissementPi2,
            superficieExistant: catDoc.superficieExistantConservePi2,
          });
        } else {
          setDetectedCategory(null);
        }
      } catch { setConversationDocuments([]); }
      setShowHistory(false); setSuccess(`Conversation "${conv.name}" chargée`);
    } catch { setError('Erreur lors du chargement'); }
  };

  // Recharge les documents quand la conversation change (ex: nouvelle conv cree apres upload)
  // Guard cancelled pour eviter race condition si on switch conv rapidement.
  useEffect(() => {
    if (!currentConversationId) { setConversationDocuments([]); return; }
    let cancelled = false;
    devisApi.listConversationDocuments(currentConversationId)
      .then(r => { if (!cancelled) setConversationDocuments(r.items || []); })
      .catch(() => { if (!cancelled) setConversationDocuments([]); });
    return () => { cancelled = true; };
  }, [currentConversationId]);

  // Toggle is_active_context — permet a l'user de activer/desactiver un doc
  const toggleDocumentActive = async (docId: number) => {
    if (!currentConversationId) return;
    try {
      await devisApi.toggleConversationDocument(currentConversationId, docId);
      const r = await devisApi.listConversationDocuments(currentConversationId);
      setConversationDocuments(r.items || []);
    } catch { setError('Erreur lors du toggle du document'); }
  };

  // Download d'un doc persiste via fetch+blob (necessaire pour passer JWT)
  const downloadDocument = async (docId: number, filename: string) => {
    if (!currentConversationId) return;
    try {
      await devisApi.downloadConversationDocument(currentConversationId, docId, filename);
    } catch { setError('Erreur lors du téléchargement'); }
  };

  // Suppression definitive d'un doc persiste
  const removeConversationDocument = async (docId: number) => {
    if (!currentConversationId) return;
    if (!confirm('Supprimer ce document de la conversation? Claude n\'y aura plus acces.')) return;
    try {
      await devisApi.deleteConversationDocument(currentConversationId, docId);
      const r = await devisApi.listConversationDocuments(currentConversationId);
      setConversationDocuments(r.items || []);
    } catch { setError('Erreur lors de la suppression du document'); }
  };
  const handleDeleteConversation = async (id: number) => {
    try { await devisApi.deleteConversation(id); setConversations(conversations.filter(c => c.id !== id)); }
    catch { setError('Erreur lors de la suppression'); }
  };

  const startRenameConversation = (id: number, currentName: string) => {
    setEditingConvId(id);
    setEditingConvName(currentName);
  };

  const cancelRenameConversation = () => {
    setEditingConvId(null);
    setEditingConvName('');
  };

  const handleRenameConversation = async (id: number) => {
    const trimmed = editingConvName.trim();
    if (!trimmed) { cancelRenameConversation(); return; }
    // Pas de changement : sortir sans appel reseau
    const current = conversations.find(c => c.id === id);
    if (current && current.name === trimmed) { cancelRenameConversation(); return; }
    try {
      await devisApi.renameConversation(id, trimmed);
      setConversations(conversations.map(c => c.id === id ? { ...c, name: trimmed } : c));
      cancelRenameConversation();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors du renommage de la conversation');
    }
  };

  const handleApply = () => {
    if (soumissionItems.length === 0) return;
    const info: ClientInfo = {
      ...clientForm,
      nomProjet: clientForm.nomProjet.trim() || devisNom || messages[0]?.content?.slice(0, 60) || 'Estimation IA',
    };
    if (onApplyToDevis && devisId) onApplyToDevis(soumissionItems, info);
    else if (onCreateDevis) onCreateDevis(soumissionItems, info);
  };

  const handleExportHTML = () => {
    if (soumissionItems.length === 0) return;
    const date = new Date().toLocaleDateString('fr-CA');

    // Financial calculations
    const admin = Math.round(totalSoumission * 0.03 * 100) / 100;
    const contingences = Math.round(totalSoumission * 0.12 * 100) / 100;
    const profit = Math.round(totalSoumission * 0.15 * 100) / 100;
    const totalAvantTaxes = Math.round((totalSoumission + admin + contingences + profit) * 100) / 100;
    const exportTps = Math.round(totalAvantTaxes * 0.05 * 100) / 100;
    const exportTvq = Math.round(totalAvantTaxes * 0.09975 * 100) / 100;
    const exportTotalTTC = Math.round((totalAvantTaxes + exportTps + exportTvq) * 100) / 100;

    // Build HTML grouped by section
    let sectionRows = '';
    sectionNames.forEach((section, si) => {
      const g = groupedItems[section];
      sectionRows += `<tr><td colspan="6" style="background:linear-gradient(90deg,#1e3a5f,#1e3a5f);color:white;padding:8px 14px;font-weight:bold;font-size:13px;border-left:4px solid #E8C17A">${si + 1}. ${section} <span style="float:right;color:#f5a623;font-weight:bold">${(g.total ?? 0).toFixed(2)} $</span></td></tr>`;
      g.items.forEach((it, i) => {
        const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
        sectionRows += `<tr style="background:${bg}"><td style="padding:7px 14px;text-align:center;color:#94a3b8;font-size:11px;width:40px">${i + 1}</td><td style="padding:7px 14px">${it.description}</td><td class="num" style="padding:7px 14px;width:70px">${it.quantite}</td><td style="padding:7px 14px;color:#64748b;width:60px">${it.unite}</td><td class="num" style="padding:7px 14px;width:90px">${(it.prixUnitaire ?? 0).toFixed(2)} $</td><td class="num bold" style="padding:7px 14px;width:100px;font-weight:700;color:#1e3a5f">${(it.montantLigne ?? 0).toFixed(2)} $</td></tr>`;
      });
    });

    // Client info section
    let clientInfoHtml = '';
    const clientCompany = clientForm.clientCompanyId ? companies.find(c => c.id === clientForm.clientCompanyId) : null;
    const clientContact = clientForm.clientContactId ? contacts.find(c => c.id === clientForm.clientContactId) : null;
    const clientName = clientCompany?.nom || clientForm.clientNomDirect || '';
    const contactName = clientContact ? `${clientContact.prenom || ''} ${clientContact.nomFamille || ''}`.trim() : '';
    if (clientName || contactName || clientForm.poClient || clientForm.nomProjet) {
      clientInfoHtml = `<div style="margin:15px 0;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;border-left:4px solid #1e3a5f;font-size:12px;color:#334155">
        <div style="display:flex;gap:40px;flex-wrap:wrap">
          ${clientForm.nomProjet ? `<div><span style="color:#94a3b8;text-transform:uppercase;font-size:10px;letter-spacing:0.5px">Projet</span><div style="font-weight:600">${clientForm.nomProjet}</div></div>` : ''}
          ${clientName ? `<div><span style="color:#94a3b8;text-transform:uppercase;font-size:10px;letter-spacing:0.5px">Client</span><div style="font-weight:600">${clientName}</div></div>` : ''}
          ${contactName ? `<div><span style="color:#94a3b8;text-transform:uppercase;font-size:10px;letter-spacing:0.5px">Contact</span><div style="font-weight:600">${contactName}</div></div>` : ''}
          ${clientForm.poClient ? `<div><span style="color:#94a3b8;text-transform:uppercase;font-size:10px;letter-spacing:0.5px">No. PO</span><div style="font-weight:600">${clientForm.poClient}</div></div>` : ''}
        </div>
      </div>`;
    }

    // Build Gantt HTML (bar chart matching React UI)
    let ganttHtml = '';
    if (sectionNames.length > 1) {
      const schedule = sectionNames.map((name, i) => {
        const sectionTotal = groupedItems[name].total;
        const proportion = totalSoumission > 0 ? sectionTotal / totalSoumission : 1 / sectionNames.length;
        const baseDuration = Math.max(1, Math.round(proportion * sectionNames.length * 3));
        const start = Math.round(i * 1.5);
        return { name, start, duration: baseDuration };
      });
      const maxWeek = Math.max(...schedule.map(s => s.start + s.duration));
      const colors = ['#7BAFD4','#B09BD8','#7DC4B5','#7DC4A5','#E8C17A','#E8919A','#8B9FD4','#9BB8D8','#F6C87A','#D4A0B0','#B09BD8','#7DC4B5','#F0B07A','#E8919A','#B09BD8'];
      const weekHeaders = Array.from({length:maxWeek}, (_,i) => `<div style="flex:1;text-align:center;font-size:10px;color:#94a3b8;padding:2px 0;border-left:1px solid #f1f5f9">S${i+1}</div>`).join('');

      ganttHtml = `<div style="margin-top:30px;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
  <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:16px;display:flex;align-items:center;gap:8px">
    <span style="display:inline-block;width:18px;height:18px;background:#2563eb;border-radius:4px;text-align:center;line-height:18px;color:white;font-size:10px">&#128197;</span>
    Échéancier estimatif
  </div>
  <!-- Week axis -->
  <div style="display:flex;margin-left:180px;margin-bottom:4px">${weekHeaders}</div>
  <!-- Bars -->
  ${schedule.map((s,i) => {
    const bg = colors[i % colors.length];
    const leftPct = ((s.start / maxWeek) * 100).toFixed(1);
    const widthPct = ((s.duration / maxWeek) * 100).toFixed(1);
    return `<div style="display:flex;align-items:center;height:28px">
    <div style="width:180px;min-width:180px;text-align:right;padding-right:12px;font-size:12px;font-weight:500;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.name}</div>
    <div style="flex:1;position:relative;height:22px;background:#f1f5f9;border-radius:4px">
      <div style="position:absolute;left:${leftPct}%;width:${widthPct}%;height:22px;background:linear-gradient(90deg,${bg},${bg}dd);border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.15)">
        <span style="font-size:9px;color:white;font-weight:600;padding:0 6px;line-height:22px;white-space:nowrap">${s.duration} sem.</span>
      </div>
    </div>
  </div>`;
  }).join('')}
  <!-- Total -->
  <div style="display:flex;align-items:center;height:28px;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0">
    <div style="width:180px;min-width:180px;text-align:right;padding-right:12px;font-size:13px;font-weight:700;color:#1e293b">Durée totale estimée</div>
    <div style="font-size:14px;font-weight:700;color:#2563eb">${maxWeek} semaines</div>
  </div>
</div>`;
    }

    const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Soumission Constructo AI</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; font-size: 13px; line-height: 1.5; background:#f8fafc; }
.page { max-width:1100px; margin:0 auto; background:white; min-height:100vh; box-shadow:0 0 20px rgba(0,0,0,0.08); }
table { width: 100%; border-collapse: collapse; }
th { background: #f1f5f9; color: #64748b; padding: 10px 16px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; text-align: left; border-bottom:2px solid #e2e8f0; }
th.num { text-align: right; }
td { padding: 8px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
td.num { text-align: right; font-family: 'Consolas', 'Courier New', monospace; white-space: nowrap; }
td.bold { font-weight: 700; color: #1e293b; }
tr:hover td { background: #f8fafc; }
@media print { body { background:white; } .page { box-shadow:none; margin:0; } }
</style></head><body>
<div class="page">

<!-- Header bar (matches React dark header) -->
<div style="background:linear-gradient(135deg,#1f2937,#111827);padding:16px 24px;display:flex;justify-content:space-between;align-items:center">
  <div style="color:white;font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px">
    <span style="color:#60a5fa">&#10024;</span> Soumission générée — ${soumissionItems.length} items
  </div>
  <div style="color:#94a3b8;font-size:11px;text-align:right">
    <div>${date}</div>
    <div>${devisNom || 'Estimation IA'}</div>
  </div>
</div>

<!-- Client info -->
${clientInfoHtml ? `<div style="padding:16px 24px;border-bottom:1px solid #e2e8f0">${clientInfoHtml}</div>` : ''}

<!-- Total box -->
<div style="margin:20px 24px;padding:16px 24px;background:linear-gradient(135deg,#1e293b,#0f172a);color:white;border-radius:10px;text-align:center;border-left:5px solid #E8C17A;box-shadow:0 4px 12px rgba(0,0,0,0.15)">
  <div style="font-size:32px;font-weight:bold;font-family:'Consolas',monospace;letter-spacing:1px">${(exportTotalTTC ?? 0).toFixed(2)} $</div>
  <div style="font-size:11px;opacity:0.7;margin-top:4px">Taxes incluses (TPS 5% + TVQ 9.975%) | ${soumissionItems.length} items | ${sectionNames.length} corps de métier</div>
</div>

<!-- Items table -->
<div style="padding:0 24px">
<table>
<thead><tr>
  <th style="width:40px">#</th>
  <th>DESCRIPTION</th>
  <th class="num" style="width:70px">QTE</th>
  <th style="width:65px">UNITE</th>
  <th class="num" style="width:95px">PRIX UNIT.</th>
  <th class="num" style="width:110px">MONTANT</th>
</tr></thead>
<tbody>${sectionRows}</tbody>
</table>
</div>

<!-- Financial summary (right-aligned like React) -->
<div style="padding:20px 24px;display:flex;justify-content:flex-end">
<div style="width:320px">
  <div style="display:flex;justify-content:space-between;padding:5px 0"><span style="color:#64748b">Sous-total:</span><span style="font-weight:700;font-family:monospace">${(totalSoumission ?? 0).toFixed(2)} $</span></div>
  <div style="display:flex;justify-content:space-between;padding:5px 0"><span style="color:#94a3b8">TPS (5%):</span><span style="color:#475569;font-family:monospace">${(exportTps ?? 0).toFixed(2)} $</span></div>
  <div style="display:flex;justify-content:space-between;padding:5px 0"><span style="color:#94a3b8">TVQ (9.975%):</span><span style="color:#475569;font-family:monospace">${(exportTvq ?? 0).toFixed(2)} $</span></div>
  <div style="display:flex;justify-content:space-between;padding:10px 0 5px;margin-top:6px;border-top:2px solid #1e3a5f">
    <span style="font-weight:700;font-size:15px;color:#1e293b">Total TTC:</span>
    <span style="font-weight:700;font-size:18px;color:#2563eb;font-family:monospace">${(exportTotalTTC ?? 0).toFixed(2)} $</span>
  </div>
</div>
</div>

<!-- Gantt -->
<div style="padding:0 24px 24px">
${ganttHtml}
</div>

<!-- Signature -->
<div style="padding:24px;border-top:2px solid #1e3a5f;margin-top:20px">
  <div style="display:flex;justify-content:space-between">
    <div style="width:45%"><div style="border-bottom:1px solid #333;height:35px;margin-bottom:4px"></div><div style="font-size:11px;color:#666">Signature client</div></div>
    <div style="width:45%"><div style="border-bottom:1px solid #333;height:35px;margin-bottom:4px"></div><div style="font-size:11px;color:#666">Date</div></div>
  </div>
</div>

<!-- Footer -->
<div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
  <span style="color:#94a3b8;font-size:10px">Document généré par Constructo AI — ERP AI pour la Construction au Québec</span>
</div>

</div><!-- .page -->
</body></html>`;
    const blob = new Blob([htmlDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `soumission_${new Date().toISOString().slice(0, 10)}.html`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleNewConversation = () => { setMessages([]); setSoumissionItems([]); setError(null); setSuccess(null); setCurrentConversationId(null); };

  const profileName = profiles.find(p => p.id === selectedProfile)?.name || 'Expert';

  // =====================
  // RENDER
  // =====================
  return (
    <div className="space-y-4">
      {/* Inject animations */}
      <style>{ANIMATION_STYLES}</style>

      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0 shadow-sm">
            <HardHat size={16} className="text-white" />
          </div>
          <select value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)}
            className="erp-input w-full text-sm font-medium">
            {profiles.length === 0 ? (
              <option value="">Chargement...</option>
            ) : (
              <>
                {customProfiles.length > 0 && (
                  <optgroup label="Mes profils">
                    {customProfiles.map(p =>
                      <option key={p.id} value={p.id}>{p.name}</option>
                    )}
                  </optgroup>
                )}
                {systemProfiles.length > 0 && (
                  <optgroup label="Profils système">
                    {systemProfiles.map(p =>
                      <option key={p.id} value={p.id}>{p.name}</option>
                    )}
                  </optgroup>
                )}
              </>
            )}
          </select>
          <button
            onClick={() => setShowProfileManager(true)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex-shrink-0"
            title="Gérer mes profils IA"
          >
            <Settings size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block" />

        <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}
          leftIcon={<FileUp size={15} />}>
          {uploading ? 'Analyse...' : 'Document'}
        </Button>
        <input ref={fileInputRef} type="file" className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.xlsx,.docx" onChange={handleFileUpload} />

        <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}
          leftIcon={<History size={15} />}>Historique</Button>
        <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(true)} disabled={messages.length === 0}
          leftIcon={<Save size={15} />}>Sauvegarder</Button>

        <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block" />

        <Button size="sm" variant="ghost" onClick={handleNewConversation}
          leftIcon={<Plus size={15} />}>Nouveau</Button>

        {/* Credit balance indicator */}
        {credits && (
          <>
            <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block ml-auto" />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 ml-auto">
              <CreditCard size={14} className={balanceTextColor} />
              <span className={`text-xs font-bold ${balanceTextColor}`}>
                {credits.isExempt ? 'Illimite' : `${(credits.balanceUsd ?? 0).toFixed(2)} $`}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Upload progress bar */}
      {uploading && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <FileUp size={16} className="text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{uploadFileName}</p>
                <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                  {uploadPhase === 'upload' ? `${uploadProgress}%` : 'Analyse IA...'}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                {uploadPhase === 'upload' ? (
                  <div className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }} />
                ) : (
                  <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '100%' }} />
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {uploadPhase === 'upload' ? 'Envoi du fichier...' : 'Analyse par l\'expert IA en cours...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Save dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-200 dark:border-blue-800">
          <Save size={16} className="text-blue-500 flex-shrink-0" />
          <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
            placeholder="Nom de la conversation..." className="erp-input flex-1 text-sm"
            onKeyDown={e => e.key === 'Enter' && handleSave()} autoFocus />
          <Button size="sm" onClick={handleSave} disabled={!saveName.trim()}>Sauvegarder</Button>
          <button onClick={() => setShowSaveDialog(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
      )}

      {/* History panel */}
      {showHistory && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <History size={15} className="text-blue-500" /> Conversations sauvegardées
            </h3>
            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          {conversations.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Aucune conversation sauvegardée</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {conversations.map(c => (
                <div key={c.id} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  {editingConvId === c.id ? (
                    <>
                      <input
                        type="text"
                        autoFocus
                        value={editingConvName}
                        onChange={(e) => setEditingConvName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleRenameConversation(c.id); }
                          else if (e.key === 'Escape') { e.preventDefault(); cancelRenameConversation(); }
                        }}
                        maxLength={200}
                        className="flex-1 text-sm px-2 py-1 rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        placeholder="Nom de la conversation"
                      />
                      <button
                        onClick={() => handleRenameConversation(c.id)}
                        className="text-green-500 hover:text-green-600 ml-2 transition-colors"
                        title="Valider"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={cancelRenameConversation}
                        className="text-gray-400 hover:text-gray-600 ml-1 transition-colors"
                        title="Annuler"
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => loadConversation(c)} className="flex-1 text-left truncate text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{c.createdAt?.slice(0, 10)}</span>
                      </button>
                      <button
                        onClick={() => startRenameConversation(c.id, c.name)}
                        className="text-gray-300 hover:text-blue-500 ml-2 transition-colors"
                        title="Renommer"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteConversation(c.id)}
                        className="text-gray-300 hover:text-red-500 ml-1 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== DEVIS CONNECTE BANNER ==================== */}
      {devisId && devisNom && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Devis connecté : <strong>{devisNom}</strong> — les items générés seront ajoutés à ce devis
          </span>
        </div>
      )}
      {!devisId && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
          <span className="text-sm text-amber-700 dark:text-amber-300">
            Aucun devis sélectionné — sélectionnez un devis dans l'onglet Soumissions, ou un nouveau sera créé
          </span>
        </div>
      )}

      {/* Fiche client / Informations du devis — hidden when a devis is connected */}
      {!devisId && (
        <ClientInfoCard
          clientForm={clientForm}
          onChange={setClientForm}
          companies={companies}
          contacts={contacts}
          open={showClientForm}
          onOpenChange={setShowClientForm}
        />
      )}

      {/* Banniere categorie detectee par l'Entrepreneur general */}
      {detectedCategory?.category && (
        <div className="mb-3 px-4 py-3 bg-gradient-to-r from-[#002050] to-[#1e3a5f] text-white rounded-lg shadow-sm">
          <div className="flex items-start gap-3">
            <HardHat size={20} className="flex-shrink-0 text-[#E8C17A] mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider opacity-80">Diagnostic Entrepreneur général</div>
              <div className="text-sm font-semibold">
                {detectedCategory.category}
                {detectedCategory.subcategory && <span className="mx-2 opacity-70">•</span>}
                {detectedCategory.subcategory && <span className="text-[#E8C17A]">{detectedCategory.subcategory}</span>}
              </div>
              {/* Breakdown 3 zones si applicable (renovation + agrandissement) */}
              {(detectedCategory.superficieRenovation != null && detectedCategory.superficieRenovation > 0) ||
               (detectedCategory.superficieAgrandissement != null && detectedCategory.superficieAgrandissement > 0) ||
               (detectedCategory.superficieExistant != null && detectedCategory.superficieExistant > 0) ? (
                <div className="mt-1.5 text-[11px] opacity-85 flex flex-wrap gap-x-3 gap-y-0.5">
                  {detectedCategory.superficie != null && detectedCategory.superficie > 0 && (
                    <span className="font-semibold text-[#E8C17A]">
                      Zone à estimer: {detectedCategory.superficie.toLocaleString('fr-CA')} pi²
                    </span>
                  )}
                  {detectedCategory.superficieRenovation != null && detectedCategory.superficieRenovation > 0 && (
                    <span>• Rénovation: {detectedCategory.superficieRenovation.toLocaleString('fr-CA')} pi²</span>
                  )}
                  {detectedCategory.superficieAgrandissement != null && detectedCategory.superficieAgrandissement > 0 && (
                    <span>• Agrandissement: {detectedCategory.superficieAgrandissement.toLocaleString('fr-CA')} pi²</span>
                  )}
                  {detectedCategory.superficieExistant != null && detectedCategory.superficieExistant > 0 && (
                    <span className="opacity-70 italic">• Existant conservé (exclu): {detectedCategory.superficieExistant.toLocaleString('fr-CA')} pi²</span>
                  )}
                </div>
              ) : (
                detectedCategory.superficie != null && detectedCategory.superficie > 0 && (
                  <div className="mt-0.5 text-[11px] opacity-85">
                    Superficie à estimer: {detectedCategory.superficie.toLocaleString('fr-CA')} pi²
                  </div>
                )
              )}
            </div>
            <button onClick={() => setDetectedCategory(null)} className="opacity-60 hover:opacity-100 mt-0.5" aria-label="Fermer le diagnostic" title="Fermer">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Chips documents persistes de la conversation */}
      {conversationDocuments.length > 0 && (
        <div className="mb-3 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
            <Paperclip size={13} />
            Documents de la conversation ({conversationDocuments.length})
            <span className="text-[10px] text-gray-400 normal-case font-normal ml-1">
              — Claude y a accès via cache
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {conversationDocuments.map((doc) => (
              <div
                key={doc.id}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs border transition-all ${
                  doc.isActiveContext
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200'
                    : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 line-through opacity-60'
                }`}
                title={doc.isActiveContext ? 'Contexte actif — cliquer pour désactiver' : 'Inactif — cliquer pour réactiver'}
              >
                <FileUp size={12} />
                <span className="max-w-[180px] truncate">{doc.filename}</span>
                {doc.fileSize && (
                  <span className="opacity-60 text-[10px]">
                    ({(doc.fileSize / 1024 / 1024).toFixed(1)} Mo)
                  </span>
                )}
                <button
                  onClick={() => downloadDocument(doc.id, doc.filename)}
                  className="ml-1 opacity-60 hover:opacity-100"
                  aria-label={`Télécharger ${doc.filename}`}
                  title="Télécharger"
                >
                  <Download size={12} />
                </button>
                <button
                  onClick={() => toggleDocumentActive(doc.id)}
                  className="opacity-60 hover:opacity-100"
                  aria-label={doc.isActiveContext ? `Désactiver ${doc.filename} du contexte IA` : `Réactiver ${doc.filename} dans le contexte IA`}
                  title={doc.isActiveContext ? 'Désactiver du contexte IA' : 'Réactiver dans le contexte IA'}
                >
                  {doc.isActiveContext ? <Check size={12} /> : <Plus size={12} />}
                </button>
                <button
                  onClick={() => removeConversationDocument(doc.id)}
                  className="opacity-60 hover:opacity-100 hover:text-red-600"
                  aria-label={`Supprimer définitivement ${doc.filename}`}
                  title="Supprimer définitivement"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== CHAT AREA ==================== */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col"
        style={{ minHeight: 300, height: 'calc(100vh - 380px)', maxHeight: 'calc(100vh - 300px)' }}>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 eia-chat-area rounded-t-xl">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mb-4 shadow-lg">
                <MessageSquare size={28} className="text-white" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 font-medium">Posez une question à l'expert</p>
              <p className="text-gray-400 dark:text-gray-500 text-sm mt-1 max-w-md">
                Ex: "J'ai besoin d'un estime pour rénover une cuisine de 120 pi2 à Montréal"
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${msg.role === 'user' ? 'eia-msg-user' : 'eia-msg-ai'}`}>
              {/* Assistant avatar */}
              {msg.role === 'assistant' && (
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                  <HardHat size={16} className="text-white" />
                </div>
              )}

              {/* Message bubble */}
              <div className={`rounded-xl shadow-sm ${
                msg.role === 'user'
                  ? 'max-w-[80%] px-4 py-3 text-sm bg-gradient-to-r from-blue-600 to-blue-700 text-white whitespace-pre-wrap'
                  : 'max-w-[92%] px-5 py-4 text-sm border border-gray-200/80 text-gray-800 dark:text-gray-200 border-l-4 border-l-blue-500'
              }`} style={msg.role === 'assistant' ? { background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 50%, #f0f4ff 100%)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' } : undefined}>
                {msg.role === 'user' ? msg.content : (
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                )}
              </div>

              {/* User avatar */}
              {msg.role === 'user' && (
                <div className="w-9 h-9 rounded-xl bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <User size={16} className="text-gray-600 dark:text-gray-300" />
                </div>
              )}
            </div>
          ))}

          {/* Thinking indicator */}
          {loading && (
            <div className="flex gap-3 items-start eia-msg-ai">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center flex-shrink-0 shadow-sm">
                <HardHat size={16} className="text-white" />
              </div>
              <div className="bg-white border border-gray-100 border-l-4 border-l-blue-500 rounded-xl px-4 py-3 shadow-sm eia-thinking"
                style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)' }}>
                <div className="flex items-center gap-2 text-blue-600 text-sm">
                  <Loader2 size={15} className="animate-spin" />
                  <span className="font-medium">{profileName} réfléchit...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-3">
          {/* Attached files preview */}
          {chatFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {chatFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1 text-xs text-blue-700">
                  <Paperclip size={12} />
                  <span className="max-w-32 truncate">{f.name}</span>
                  <span className="text-blue-400">({(f.size / 1024 / 1024).toFixed(1)} Mo)</span>
                  <button onClick={() => setChatFiles(prev => prev.filter((_, j) => j !== i))}
                    className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input ref={chatFileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" className="hidden"
              onChange={(e) => {
                const newFiles = Array.from(e.target.files || []);
                setChatFiles(prev => {
                  const combined = [...prev, ...newFiles].slice(0, 5);
                  if (prev.length + newFiles.length > 5) setError('Maximum 5 fichiers par message');
                  return combined;
                });
                if (chatFileInputRef.current) chatFileInputRef.current.value = '';
              }} />
            <button onClick={() => chatFileInputRef.current?.click()} disabled={loading || chatFiles.length >= 5}
              title="Joindre des fichiers (PDF, images)"
              className="self-end w-10 h-10 rounded-xl border border-gray-300 text-gray-500 flex items-center justify-center hover:bg-gray-50 hover:text-blue-600 hover:border-blue-300 transition-all disabled:opacity-40">
              <Paperclip size={18} />
            </button>
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Décrivez votre projet ou posez une question..."
              className="erp-input flex-1 text-sm resize-none rounded-xl" rows={2} disabled={loading} />
            <button onClick={sendMessage} disabled={(!input.trim() && chatFiles.length === 0) || loading}
              className="self-end w-10 h-10 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white flex items-center justify-center shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-sm">
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Generate soumission */}
      {messages.length > 0 && (
        <div className="flex justify-center">
          <button onClick={handleGenerateSoumission} disabled={generating}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0">
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {generating ? 'Génération en cours...' : devisId ? 'Générer les items pour ce devis' : 'Générer la soumission'}
          </button>
        </div>
      )}

      {/* ==================== SOUMISSION TABLE ==================== */}
      {soumissionItems.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden relative">
          <div ref={soumissionTopRef} />
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-gray-800 to-gray-900 text-white">
            <h3 className="font-semibold flex items-center gap-2">
              <Sparkles size={16} className="text-blue-400" />
              Soumission générée — {soumissionItems.length} items
            </h3>
            <div className="flex gap-2">
              <button onClick={handleExportHTML}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors">
                <Download size={14} /> HTML
              </button>
              {onApplyToDevis && devisId && (
                <button onClick={handleApply}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-sm font-semibold transition-colors shadow-sm">
                  <Check size={14} /> Ajouter au devis existant
                </button>
              )}
              {onCreateDevis && !devisId && (
                <button onClick={handleApply}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-sm font-semibold transition-colors shadow-sm">
                  <Check size={14} /> Créer un nouveau devis
                </button>
              )}
            </div>
          </div>

          {/* Table grouped by corps de métier */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-3 px-4 w-10">#</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-right w-20">Qte</th>
                  <th className="py-3 px-4 w-16">Unité</th>
                  <th className="py-3 px-4 text-right w-24">Prix unit.</th>
                  <th className="py-3 px-4 text-right w-28">Montant</th>
                  <th className="py-3 px-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {sectionNames.map((section, secIdx) => {
                  const group = groupedItems[section];
                  return (
                    <React.Fragment key={section}>
                      {/* Section header */}
                      <tr>
                        <td colSpan={7} className="py-0 px-0">
                          <div className="flex items-center justify-between px-4 py-2.5 mt-1"
                            style={{ background: 'linear-gradient(90deg, #1e3a5f, #1e3a5f)', borderLeft: '4px solid #E8C17A' }}>
                            <span className="text-white font-semibold text-sm">{secIdx + 1}. {section}</span>
                            <span className="font-bold text-sm font-mono" style={{ color: '#f5a623' }}>{(group.total ?? 0).toFixed(2)} $</span>
                          </div>
                        </td>
                      </tr>
                      {/* Section items */}
                      {group.items.map((it, localIdx) => (
                        <tr key={it.idx} className="border-t border-gray-100 dark:border-gray-700/50 hover:bg-blue-50/50 dark:hover:bg-gray-700/30 transition-colors">
                          {editIdx === it.idx && editItem ? (
                            <>
                              <td className="py-2 px-4 text-gray-400">{localIdx + 1}</td>
                              <td className="py-2 px-4"><input className="erp-input text-sm w-full" value={editItem.description}
                                onChange={e => setEditItem({ ...editItem, description: e.target.value })} /></td>
                              <td className="py-2 px-4"><input type="number" className="erp-input text-sm w-20 text-right"
                                value={editItem.quantite} onChange={e => setEditItem({ ...editItem, quantite: parseFloat(e.target.value) || 0 })} /></td>
                              <td className="py-2 px-4"><input className="erp-input text-sm w-16" value={editItem.unite}
                                onChange={e => setEditItem({ ...editItem, unite: e.target.value })} /></td>
                              <td className="py-2 px-4"><input type="number" className="erp-input text-sm w-24 text-right"
                                value={editItem.prixUnitaire} onChange={e => setEditItem({ ...editItem, prixUnitaire: parseFloat(e.target.value) || 0 })} /></td>
                              <td className="py-2 px-4 text-right text-gray-500">{((editItem.quantite || 0) * (editItem.prixUnitaire || 0)).toFixed(2)} $</td>
                              <td className="py-2 px-2 flex gap-1">
                                <button onClick={saveEdit} className="text-green-600 hover:text-green-700"><Check size={15} /></button>
                                <button onClick={() => { setEditIdx(null); setEditItem(null); }} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-2.5 px-4 text-gray-400 font-mono text-xs">{localIdx + 1}</td>
                              <td className="py-2.5 px-4 text-gray-800 dark:text-gray-200">{it.description}</td>
                              <td className="py-2.5 px-4 text-right font-mono">{it.quantite}</td>
                              <td className="py-2.5 px-4 text-gray-500">{it.unite}</td>
                              <td className="py-2.5 px-4 text-right font-mono">{(it.prixUnitaire ?? 0).toFixed(2)} $</td>
                              <td className="py-2.5 px-4 text-right font-semibold text-gray-900 dark:text-white font-mono">{(it.montantLigne ?? 0).toFixed(2)} $</td>
                              <td className="py-2.5 px-2 flex gap-1">
                                <button onClick={() => startEdit(it.idx)} className="text-gray-300 hover:text-blue-500 transition-colors"><Pencil size={14} /></button>
                                <button onClick={() => removeItem(it.idx)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-5 py-4">
            <div className="flex flex-col items-end gap-1 text-sm">
              <div className="flex justify-between w-64"><span className="text-gray-500">Sous-total:</span><span className="font-semibold font-mono">{(totalSoumission ?? 0).toFixed(2)} $</span></div>
              <div className="flex justify-between w-64"><span className="text-gray-400">TPS (5%):</span><span className="text-gray-600 font-mono">{(tps ?? 0).toFixed(2)} $</span></div>
              <div className="flex justify-between w-64"><span className="text-gray-400">TVQ (9.975%):</span><span className="text-gray-600 font-mono">{(tvq ?? 0).toFixed(2)} $</span></div>
              <div className="flex justify-between w-64 pt-2 mt-1 border-t border-gray-300 dark:border-gray-600">
                <span className="font-bold text-gray-900 dark:text-white text-base">Total TTC:</span>
                <span className="font-bold text-lg text-blue-600 font-mono">{(totalTTC ?? 0).toFixed(2)} $</span>
              </div>
            </div>
          </div>

          {/* Gantt Chart */}
          {sectionNames.length > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4">
              <h4 className="font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
                <Calendar size={16} className="text-blue-500" /> Échéancier estimatif
              </h4>
              {(() => {
                // Build schedule: each section gets a start week and duration
                const schedule = sectionNames.map((name, i) => {
                  // Estimate duration based on section cost proportion
                  const sectionTotal = groupedItems[name].total;
                  const proportion = totalSoumission > 0 ? sectionTotal / totalSoumission : 1 / sectionNames.length;
                  const baseDuration = Math.max(1, Math.round(proportion * sectionNames.length * 3));
                  // Stagger starts: roughly sequential with some overlap
                  const start = Math.round(i * 1.5);
                  return { name, start, duration: baseDuration, total: sectionTotal };
                });
                const maxWeek = Math.max(...schedule.map(s => s.start + s.duration));
                const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
                const colors = ['#7BAFD4','#B09BD8','#7DC4B5','#7DC4A5','#E8C17A','#E8919A','#8B9FD4','#9BB8D8','#F6C87A','#D4A0B0','#B09BD8','#7DC4B5','#F0B07A','#E8919A','#B09BD8'];

                return (
                  <div className="overflow-x-auto">
                    <div style={{ minWidth: Math.max(600, maxWeek * 45 + 200) }}>
                      {/* Week headers */}
                      <div className="flex">
                        <div style={{ width: 180, minWidth: 180 }} className="text-xs text-gray-400 py-1 pr-2 text-right">Corps de métier</div>
                        <div className="flex flex-1">
                          {weeks.map(w => (
                            <div key={w} style={{ width: `${100/maxWeek}%` }} className="text-center text-[10px] text-gray-400 py-1 border-l border-gray-100">
                              S{w}
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Bars */}
                      {schedule.map((s, i) => (
                        <div key={s.name} className="flex items-center" style={{ height: 28 }}>
                          <div style={{ width: 180, minWidth: 180 }} className="text-xs text-gray-700 dark:text-gray-300 pr-2 text-right truncate font-medium">
                            {s.name}
                          </div>
                          <div className="flex flex-1 relative" style={{ height: 20 }}>
                            {weeks.map(w => (
                              <div key={w} style={{ width: `${100/maxWeek}%` }} className="border-l border-gray-50 h-full" />
                            ))}
                            <div
                              className="absolute top-0 rounded-md shadow-sm"
                              style={{
                                left: `${(s.start / maxWeek) * 100}%`,
                                width: `${(s.duration / maxWeek) * 100}%`,
                                height: 20,
                                background: `linear-gradient(90deg, ${colors[i % colors.length]}, ${colors[i % colors.length]}dd)`,
                                opacity: 0.85,
                              }}
                            >
                              <span className="text-[9px] text-white font-medium px-1.5 leading-5 truncate block">
                                {s.duration} sem.
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {/* Total duration */}
                      <div className="flex items-center mt-2 pt-2 border-t border-gray-200">
                        <div style={{ width: 180 }} className="text-xs font-semibold text-gray-800 dark:text-white pr-2 text-right">
                          Durée totale estimée
                        </div>
                        <div className="text-sm font-bold text-blue-600">{maxWeek} semaines</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Scroll to top button */}
          <button
            onClick={() => soumissionTopRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="sticky bottom-4 ml-auto mr-4 mb-4 mt-2 w-10 h-10 rounded-full bg-gradient-to-r from-blue-600 to-blue-700 text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5 z-10"
            title="Remonter en haut de la soumission"
          >
            <ChevronUp size={20} />
          </button>
        </div>
      )}
      {/* AI Profile Manager Modal */}
      <AiProfileManager
        open={showProfileManager}
        onClose={() => setShowProfileManager(false)}
        onProfilesChanged={reloadProfiles}
      />
    </div>
  );
}
