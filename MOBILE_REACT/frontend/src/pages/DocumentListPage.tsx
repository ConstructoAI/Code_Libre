/**
 * Mobile React Frontend - Document List Page
 * Shows documents of a specific type with stats cards and list.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  FileText,
  Receipt,
  ClipboardList,
  ShoppingCart,
  Search,
  MoreVertical,
  Trash2,
  Copy,
  Download,
} from 'lucide-react';
import { useDocumentsStore } from '@/store/useDocumentsStore';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { useConfirm } from '@/hooks/useConfirm';
import { duplicateDocument, exportDocumentsCsv } from '@/api/documents';
import { formatCurrency, formatDate } from '@/utils/format';
import type { DocType, DocumentListItem } from '@/types';

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  devis: { label: 'Devis', icon: <FileText className="w-5 h-5" />, color: 'bg-blue-500' },
  factures: { label: 'Factures', icon: <Receipt className="w-5 h-5" />, color: 'bg-green-500' },
  'bons-travail': { label: 'Bons de travail', icon: <ClipboardList className="w-5 h-5" />, color: 'bg-amber-500' },
  'bons-commande': { label: 'Bons de commande', icon: <ShoppingCart className="w-5 h-5" />, color: 'bg-purple-500' },
};

function getStatutBadge(statut: string) {
  const s = (statut || 'BROUILLON').toUpperCase();
  const map: Record<string, { label: string; cls: string }> = {
    BROUILLON: { label: 'Brouillon', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
    EN_ATTENTE: { label: 'En attente', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
    ENVOYE: { label: 'Envoyé', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
    ENVOYEE: { label: 'Envoyée', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
    ACCEPTE: { label: 'Accepté', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
    ACCEPTEE: { label: 'Acceptée', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
    EN_COURS: { label: 'En cours', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
    TERMINE: { label: 'Terminé', cls: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
    TERMINEE: { label: 'Terminée', cls: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
    PAYE: { label: 'Payé', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
    PAYEE: { label: 'Payée', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
    ANNULE: { label: 'Annulé', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
    ANNULEE: { label: 'Annulée', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
    REFUSE: { label: 'Refusé', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
    COMMANDE: { label: 'Commandé', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
    LIVREE: { label: 'Livrée', cls: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' },
    FACTUREE: { label: 'Facturée', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  };
  const m = map[s] || { label: statut, cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${m.cls}`}>
      {m.label}
    </span>
  );
}

export default function DocumentListPage() {
  const { docType } = useParams<{ docType: string }>();
  const navigate = useNavigate();
  const { documents, typeStats, isLoading, error, fetchDocuments, fetchTypeStats, deleteDocument, clearError } = useDocumentsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { confirm, element: confirmElement } = useConfirm();

  const config = TYPE_CONFIG[docType || ''];

  useEffect(() => {
    if (docType && config) {
      fetchDocuments(docType as DocType);
      fetchTypeStats(docType as DocType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType]);

  if (!config) {
    return (
      <div className="px-4 py-8 text-center text-gray-500">
        Type de document invalide
      </div>
    );
  }

  const filtered = searchQuery
    ? documents.filter(
        (d) =>
          (d.numero || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (d.nomProjet || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (d.clientNom || '').toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : documents;

  const handleDelete = async (doc: DocumentListItem) => {
    const ok = await confirm({
      message: `Supprimer ${doc.numero || 'ce document'} ?`,
      variant: 'danger',
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    const okDelete = await deleteDocument(docType as DocType, doc.id);
    if (okDelete) {
      fetchDocuments(docType as DocType);
      fetchTypeStats(docType as DocType);
    }
    setMenuOpenId(null);
  };

  const handleExportCsv = async () => {
    if (!docType || exportingCsv) return;
    setExportingCsv(true);
    setExportError(null);
    try {
      const { blob, filename } = await exportDocumentsCsv(docType as DocType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Liberer apres un court delai (Safari iOS)
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } };
      const detail = err?.response?.data?.detail;
      setExportError(detail || 'Erreur lors de l’export CSV.');
    } finally {
      setExportingCsv(false);
    }
  };

  const handleDuplicate = async (doc: DocumentListItem) => {
    setMenuOpenId(null);
    const ok = await confirm({
      message: `Creer une copie de ${doc.numero || 'ce document'} ?`,
      confirmLabel: 'Dupliquer',
    });
    if (!ok) return;
    setDuplicatingId(doc.id);
    setDuplicateError(null);
    try {
      await duplicateDocument(docType as DocType, doc.id);
      // Recharge la liste + stats pour faire apparaitre le nouveau document
      fetchDocuments(docType as DocType);
      fetchTypeStats(docType as DocType);
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } };
      const detail = err?.response?.data?.detail;
      setDuplicateError(detail || 'Erreur lors de la duplication du document.');
    } finally {
      setDuplicatingId(null);
    }
  };

  return (
    <div className="px-4 py-5 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/documents')}
            className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{config.label}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={exportingCsv || documents.length === 0}
            aria-label="Exporter en CSV"
            title="Exporter en CSV"
            className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 shadow-sm min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportingCsv ? <Spinner size="sm" /> : <Download className="w-5 h-5" />}
          </button>
          <button
            onClick={() => navigate(`/documents/${docType}/nouveau`)}
            aria-label={`Ajouter un ${config.label.toLowerCase()}`}
            className={`${config.color} text-white p-2.5 rounded-xl shadow-sm min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95 transition-transform`}
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {error && (
        <Alert type="error" onDismiss={clearError}>
          {error}
        </Alert>
      )}

      {duplicateError && (
        <Alert type="error" onDismiss={() => setDuplicateError(null)}>
          {duplicateError}
        </Alert>
      )}

      {exportError && (
        <Alert type="error" onDismiss={() => setExportError(null)}>
          {exportError}
        </Alert>
      )}

      {/* Stats Cards */}
      {typeStats && typeStats.total > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2.5 text-center">
            <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">Total</p>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{typeStats.total}</p>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-2.5 text-center">
            <p className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">En attente</p>
            <p className="text-xl font-bold text-yellow-700 dark:text-yellow-300">{(typeStats.enAttente || 0) + (typeStats.envoye || 0)}</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2.5 text-center">
            <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">En cours</p>
            <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{typeStats.enCours || 0}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2.5 text-center">
            <p className="text-[10px] text-green-600 dark:text-green-400 font-medium">Terminé</p>
            <p className="text-xl font-bold text-green-700 dark:text-green-300">{(typeStats.accepte || 0) + (typeStats.termine || 0) + (typeStats.paye || 0)}</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Rechercher..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
        />
      </div>

      {/* Document List */}
      {isLoading && documents.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400`}>
            {config.icon}
          </div>
          <p className="text-gray-500 dark:text-gray-400">Aucun document</p>
          <button
            onClick={() => navigate(`/documents/${docType}/nouveau`)}
            className="mt-3 text-sm text-seaop-primary font-medium"
          >
            Créer un {config.label.toLowerCase()}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((doc) => (
            <div
              key={doc.id}
              className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200/60 dark:border-gray-700 overflow-hidden"
            >
              <button
                onClick={() => navigate(`/documents/${docType}/${doc.id}`)}
                className="w-full p-3.5 text-left active:bg-gray-50 dark:active:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getStatutBadge(doc.statut)}
                      {doc.numero && (
                        <span className="text-xs font-medium text-seaop-primary dark:text-seaop-primary-400">
                          {doc.numero}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {doc.nomProjet || doc.clientNom || '--'}
                    </p>
                    {doc.clientNom && doc.nomProjet && doc.clientNom !== doc.nomProjet && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        Client: {doc.clientNom}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {doc.montantTotal != null ? formatCurrency(doc.montantTotal) : '--'}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {formatDate(doc.dateCreation)}
                    </p>
                  </div>
                </div>
              </button>

              {/* Quick actions row */}
              <div className="relative border-t border-gray-100 dark:border-gray-700 flex items-center justify-end px-2 py-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === doc.id ? null : doc.id);
                  }}
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[36px] min-w-[36px] flex items-center justify-center"
                >
                  <MoreVertical className="w-4 h-4 text-gray-400" />
                </button>

                {menuOpenId === doc.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpenId(null)} />
                    <div className="absolute right-2 bottom-full mb-1 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 py-1 min-w-[140px]">
                      <button
                        onClick={() => {
                          navigate(`/documents/${docType}/${doc.id}/modifier`);
                          setMenuOpenId(null);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDuplicate(doc)}
                        disabled={duplicatingId === doc.id}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {duplicatingId === doc.id ? (
                          <Spinner />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Dupliquer
                      </button>
                      <button
                        onClick={() => handleDelete(doc)}
                        className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Supprimer
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmElement}
    </div>
  );
}
