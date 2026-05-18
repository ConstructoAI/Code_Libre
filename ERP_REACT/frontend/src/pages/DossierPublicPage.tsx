/**
 * ERP React Frontend - Public Dossier Documents Page
 * Accessible without authentication via a token-based URL.
 * Read-only: view documents inline or download. No upload, no delete.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Paperclip, Download, Eye, FolderOpen, AlertTriangle } from 'lucide-react';
import {
  getPublicDossier,
  publicAttachmentViewUrl,
  downloadPublicAttachment,
} from '@/api/documents';
import type { PublicDossier, PublicAttachment } from '@/api/documents';

type PageState = 'loading' | 'ready' | 'error';

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function isInlineViewable(ct?: string): boolean {
  if (!ct) return false;
  return (
    ct.startsWith('image/') ||
    ct.startsWith('text/') ||
    ct === 'application/pdf'
  );
}

export default function DossierPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>('loading');
  const [data, setData] = useState<PublicDossier | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMsg('Lien invalide.');
      return;
    }
    getPublicDossier(token)
      .then((res) => {
        setData(res);
        setState('ready');
      })
      .catch(() => {
        setState('error');
        setErrorMsg("Ce lien n'est pas disponible, ou il a expiré.");
      });
  }, [token]);

  const handleDownload = async (att: PublicAttachment) => {
    if (!token) return;
    setDownloadingId(att.id);
    try {
      const res = await downloadPublicAttachment(token, att.id);
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.originalName;
      a.click();
      setTimeout(() => window.URL.revokeObjectURL(url), 30000);
    } catch {
      /* silent — user can retry */
    } finally {
      setDownloadingId(null);
    }
  };

  const handleView = (att: PublicAttachment) => {
    if (!token) return;
    window.open(publicAttachmentViewUrl(token, att.id), '_blank', 'noopener,noreferrer');
  };

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-500">Chargement...</div>
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <AlertTriangle size={40} className="mx-auto text-red-500 mb-3" />
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Lien non disponible</h1>
          <p className="text-sm text-gray-500">{errorMsg}</p>
        </div>
      </div>
    );
  }

  const { dossier, attachments, enterpriseName } = data;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                {enterpriseName || 'Constructo AI'}
              </p>
              <h1 className="text-xl font-bold text-gray-900 truncate">
                {dossier.titre || 'Dossier'}
              </h1>
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                {dossier.numero && <span className="font-mono">{dossier.numero}</span>}
                {dossier.statut && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-medium">
                    {dossier.statut}
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Documents partagés
              </p>
              <p className="text-2xl font-bold text-gray-900">{attachments.length}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Documents list */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {attachments.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <FolderOpen size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">Aucun document partagé</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <ul className="divide-y divide-gray-100">
              {attachments.map((att) => {
                const viewable = isInlineViewable(att.contentType);
                return (
                  <li
                    key={att.id}
                    className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                  >
                    <Paperclip size={16} className="text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {att.originalName}
                      </p>
                      <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                        {att.category && <span>{att.category}</span>}
                        {att.fileSize ? <span>{formatSize(att.fileSize)}</span> : null}
                        {att.createdAt && <span>{formatDate(att.createdAt)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {viewable && (
                        <button
                          type="button"
                          onClick={() => handleView(att)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                        >
                          <Eye size={13} />
                          Consulter
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDownload(att)}
                        disabled={downloadingId === att.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors"
                      >
                        <Download size={13} />
                        {downloadingId === att.id ? '...' : 'Télécharger'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          Lien sécurisé — {enterpriseName || 'Constructo AI'} · Documents en lecture seule
        </p>
      </main>
    </div>
  );
}
