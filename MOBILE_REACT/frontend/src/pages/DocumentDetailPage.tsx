/**
 * Mobile React Frontend - Document Detail Page
 * Shows document info + line items with add/edit/delete.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Edit3,
  Trash2,
  X,
  Check,
  PenLine,
  ShieldCheck,
  FileDown,
  CreditCard,
  Mail,
  Copy,
  RotateCw,
} from 'lucide-react';
import { useDocumentsStore } from '@/store/useDocumentsStore';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { useConfirm } from '@/hooks/useConfirm';
import { FileUpload } from '@/components/FileUpload';
import { AttachmentList } from '@/components/AttachmentList';
import { AttachmentViewer } from '@/components/AttachmentViewer';
import { useAttachmentsStore } from '@/store/useAttachmentsStore';
import DocumentSignatureModal from '@/components/DocumentSignatureModal';
import { EmailDocumentModal } from '@/components/EmailDocumentModal';
import { RecurrentInvoiceModal } from '@/components/RecurrentInvoiceModal';
import {
  getDocumentSignature,
  signDocument,
  downloadDocumentPdf,
  generatePaymentLink,
  duplicateDocument,
  type DocumentSignatureState,
} from '@/api/documents';
import { formatCurrency, formatDate } from '@/utils/format';
import type { DocType, DocumentLine, AttachmentParentType } from '@/types';

const SIGNABLE_DOC_TYPES: ReadonlySet<string> = new Set(['devis', 'factures']);

const DOC_TYPE_LABELS: Record<string, string> = {
  devis: 'devis',
  factures: 'facture',
};

const DOC_TYPE_TO_PARENT: Record<string, AttachmentParentType> = {
  devis: 'devis',
  factures: 'facture',
  'bons-travail': 'bon_travail',
  'bons-commande': 'bon_commande',
  'bons-achat': 'bon_achat',
};

function getStatutBadge(statut: string) {
  const s = (statut || 'BROUILLON').toUpperCase();
  const colors: Record<string, string> = {
    BROUILLON: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    EN_ATTENTE: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    ENVOYE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    ACCEPTE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    EN_COURS: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    TERMINE: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
    PAYE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    PAYEE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    ANNULE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  const cls = colors[s] || colors.BROUILLON;
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase ${cls}`}>
      {statut || 'Brouillon'}
    </span>
  );
}

interface LineFormData {
  description: string;
  quantite: string;
  unite: string;
  prixUnitaire: string;
}

const emptyLineForm: LineFormData = { description: '', quantite: '1', unite: 'unite', prixUnitaire: '0' };

export default function DocumentDetailPage() {
  const { docType, docId } = useParams<{ docType: string; docId: string }>();
  const navigate = useNavigate();
  const { current, isLoading, error, fetchDetail, addLine, deleteLine, clearError, clearCurrent } = useDocumentsStore();
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineForm, setLineForm] = useState<LineFormData>(emptyLineForm);
  const [addingLine, setAddingLine] = useState(false);
  const { confirm, element: confirmElement } = useConfirm();

  // Pieces jointes polymorphiques (Phase 2)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const parentType = DOC_TYPE_TO_PARENT[docType || ''];
  // CAUSE React #185: si on retourne `s.byParent.get(...) || []` directement,
  // le `[]` est recree a chaque call (Object.is false) => boucle infinie de
  // re-renders. Subscribe a la Map puis derive via useMemo.
  const byParent = useAttachmentsStore((s) => s.byParent);
  const attachments = useMemo(
    () =>
      parentType && current
        ? (byParent.get(`${parentType}:${current.id}`) || [])
        : [],
    [byParent, parentType, current],
  );

  // Signature electronique (Phase 3D) — devis et factures uniquement.
  const isSignable = !!docType && SIGNABLE_DOC_TYPES.has(docType);
  const [signatureState, setSignatureState] = useState<DocumentSignatureState | null>(null);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureSubmitting, setSignatureSubmitting] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);

  const loadSignature = useCallback(async () => {
    if (!isSignable || !docType || !docId) return;
    setSignatureLoading(true);
    try {
      const state = await getDocumentSignature(docType as DocType, parseInt(docId));
      setSignatureState(state);
    } catch (e) {
      // 404 = document n existe pas. On laisse signatureState null sans bruit.
      console.warn('[DocumentDetail] getDocumentSignature failed', e);
    } finally {
      setSignatureLoading(false);
    }
  }, [isSignable, docType, docId]);

  const handleSubmitSignature = useCallback(
    async (signatureBase64: string, signataireNom: string): Promise<boolean> => {
      if (!docType || !docId) return false;
      setSignatureSubmitting(true);
      setSignatureError(null);
      try {
        await signDocument(docType as DocType, parseInt(docId), signataireNom, signatureBase64);
        await loadSignature();
        return true;
      } catch (e) {
        const err = e as { response?: { status?: number; data?: { detail?: string } } };
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail;
        if (status === 409) {
          setSignatureError('Ce document est deja signe.');
          await loadSignature();
        } else {
          setSignatureError(detail || 'Erreur lors de l enregistrement de la signature.');
        }
        return false;
      } finally {
        setSignatureSubmitting(false);
      }
    },
    [docType, docId, loadSignature],
  );

  // Telechargement PDF (Phase 3A) — devis / factures / BT / BC
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Envoi par courriel (Phase 3B) — tous types de documents
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  // Lien de paiement Stripe (Phase 3C) — factures uniquement
  const isPayable = docType === 'factures';
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [paymentLinkError, setPaymentLinkError] = useState<string | null>(null);
  const [paymentLinkSuccess, setPaymentLinkSuccess] = useState<string | null>(null);

  // Duplication de document (Phase 5A) — tous types
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  // Facture recurrente (Phase 5C) — factures uniquement
  const isFacture = docType === 'factures';
  const [recurrentModalOpen, setRecurrentModalOpen] = useState(false);
  const [recurrentSuccess, setRecurrentSuccess] = useState<string | null>(null);

  const handleDuplicate = useCallback(async () => {
    if (!docType || !docId || duplicateLoading) return;
    const ok = await confirm({
      message: 'Creer une copie de ce document ?',
      confirmLabel: 'Dupliquer',
    });
    if (!ok) return;
    setDuplicateLoading(true);
    setDuplicateError(null);
    try {
      const result = await duplicateDocument(docType as DocType, parseInt(docId));
      navigate(`/documents/${docType}/${result.id}`);
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } };
      const detail = err?.response?.data?.detail;
      setDuplicateError(detail || 'Erreur lors de la duplication du document.');
    } finally {
      setDuplicateLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, docId, navigate]);

  const handleGeneratePaymentLink = useCallback(async () => {
    if (!isPayable || !docId || paymentLinkLoading) return;
    setPaymentLinkLoading(true);
    setPaymentLinkError(null);
    setPaymentLinkSuccess(null);
    try {
      const result = await generatePaymentLink(parseInt(docId));
      // Copier l URL dans le presse-papiers
      let copied = false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(result.url);
          copied = true;
        }
      } catch (clipErr) {
        console.warn('[DocumentDetail] clipboard.writeText failed', clipErr);
      }
      const prefix = result.cached ? 'Lien existant copie' : 'Lien de paiement genere';
      setPaymentLinkSuccess(
        copied
          ? `${prefix} dans le presse-papiers (${result.url})`
          : `${prefix}. URL : ${result.url}`,
      );
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } };
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 503) {
        setPaymentLinkError('Service Stripe indisponible (cle API non configuree).');
      } else if (status === 400) {
        setPaymentLinkError(detail || 'Montant total de la facture invalide.');
      } else {
        setPaymentLinkError(detail || 'Erreur lors de la generation du lien de paiement.');
      }
    } finally {
      setPaymentLinkLoading(false);
    }
    // Note: loading flag exclu des deps volontairement (lecture seule via state
    // courant suffit, evite re-creation du callback a chaque toggle loading)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPayable, docId]);

  const handleDownloadPdf = useCallback(async () => {
    if (!docType || !docId || pdfLoading) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const { blob, filename } = await downloadDocumentPdf(
        docType as DocType,
        parseInt(docId),
      );
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
      const status = err?.response?.status;
      if (status === 503) {
        setPdfError('Generation PDF indisponible (lib manquante sur le serveur).');
      } else {
        setPdfError(detail || 'Erreur lors de la generation du PDF.');
      }
    } finally {
      setPdfLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, docId]);

  useEffect(() => {
    if (docType && docId) {
      fetchDetail(docType as DocType, parseInt(docId));
    }
    return () => clearCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, docId]);

  useEffect(() => {
    if (isSignable && current) {
      void loadSignature();
    } else {
      setSignatureState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignable, current?.id]);

  const handleAddLine = async () => {
    if (!lineForm.description.trim()) return;
    setAddingLine(true);
    await addLine(docType as DocType, parseInt(docId!), {
      description: lineForm.description,
      quantite: parseFloat(lineForm.quantite) || 1,
      unite: lineForm.unite || 'unite',
      prixUnitaire: parseFloat(lineForm.prixUnitaire) || 0,
    });
    setLineForm(emptyLineForm);
    setShowAddLine(false);
    setAddingLine(false);
  };

  const handleDeleteLine = async (line: DocumentLine) => {
    const ok = await confirm({
      message: `Supprimer la ligne "${line.description}" ?`,
      variant: 'danger',
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    await deleteLine(docType as DocType, parseInt(docId!), line.id);
  };

  if (isLoading && !current) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="px-4 py-8 text-center text-gray-500">
        Document non trouvé
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/documents/${docType}`)}
            className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              {current.numero || 'Document'}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatDate(current.dateCreation)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[60%]">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            title="Telecharger PDF"
            aria-label="Telecharger le document en PDF"
            className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            {pdfLoading ? (
              <Spinner />
            ) : (
              <FileDown className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setEmailSuccess(null);
              setEmailModalOpen(true);
            }}
            title="Envoyer par courriel"
            aria-label="Envoyer le document par courriel"
            className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-green-50 dark:hover:bg-green-900/20 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Mail className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
          {isPayable && (
            <button
              type="button"
              onClick={handleGeneratePaymentLink}
              disabled={paymentLinkLoading}
              title="Lien de paiement Stripe"
              aria-label="Generer un lien de paiement Stripe"
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {paymentLinkLoading ? (
                <Spinner />
              ) : (
                <CreditCard className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={duplicateLoading}
            title="Dupliquer"
            aria-label="Dupliquer ce document"
            className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            {duplicateLoading ? (
              <Spinner />
            ) : (
              <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            )}
          </button>
          {isFacture && (
            <button
              type="button"
              onClick={() => {
                setRecurrentSuccess(null);
                setRecurrentModalOpen(true);
              }}
              title="Rendre recurrent"
              aria-label="Rendre cette facture recurrente"
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <RotateCw className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}
          <button
            onClick={() => navigate(`/documents/${docType}/${docId}/modifier`)}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Edit3 className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>

      {error && (
        <Alert type="error" onDismiss={clearError}>
          {error}
        </Alert>
      )}

      {pdfError && (
        <Alert type="error" onDismiss={() => setPdfError(null)}>
          {pdfError}
        </Alert>
      )}

      {duplicateError && (
        <Alert type="error" onDismiss={() => setDuplicateError(null)}>
          {duplicateError}
        </Alert>
      )}

      {paymentLinkError && (
        <Alert type="error" onDismiss={() => setPaymentLinkError(null)}>
          {paymentLinkError}
        </Alert>
      )}

      {paymentLinkSuccess && (
        <Alert type="success" onDismiss={() => setPaymentLinkSuccess(null)}>
          {paymentLinkSuccess}
        </Alert>
      )}

      {recurrentSuccess && (
        <Alert type="success" onDismiss={() => setRecurrentSuccess(null)}>
          {recurrentSuccess}
        </Alert>
      )}

      {emailSuccess && (
        <Alert type="success" onDismiss={() => setEmailSuccess(null)}>
          {emailSuccess}
        </Alert>
      )}

      {/* Document Info Card */}
      <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200/60 dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          {getStatutBadge(current.statut)}
          {current.priorite && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Priorité: {current.priorite}
            </span>
          )}
        </div>

        {current.nomProjet && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Projet / Titre</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{current.nomProjet}</p>
          </div>
        )}

        {current.clientNom && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Client</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{current.clientNom}</p>
          </div>
        )}

        {current.description && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Description</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{current.description}</p>
          </div>
        )}

        {current.dateEcheance && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Échéance</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{formatDate(current.dateEcheance)}</p>
          </div>
        )}

        {current.notes && current.notes !== current.description && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Notes</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{current.notes}</p>
          </div>
        )}
      </div>

      {/* Totals Card */}
      <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200/60 dark:border-gray-700 p-4">
        <div className="space-y-1.5">
          {current.totalAvantTaxes != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Sous-total</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(current.totalAvantTaxes)}</span>
            </div>
          )}
          {current.tps != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">TPS (5%)</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(current.tps)}</span>
            </div>
          )}
          {current.tvq != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">TVQ (9,975%)</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(current.tvq)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold border-t border-gray-100 dark:border-gray-700 pt-2 mt-2">
            <span className="text-gray-900 dark:text-white">Total</span>
            <span className="text-seaop-primary dark:text-seaop-primary-400">
              {current.montantTotal != null ? formatCurrency(current.montantTotal) : '-- $'}
            </span>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Lignes ({current.lignes.length})
          </h2>
          <button
            onClick={() => setShowAddLine(!showAddLine)}
            className="flex items-center gap-1 text-sm text-seaop-primary font-medium min-h-[44px] px-2"
          >
            {showAddLine ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showAddLine ? 'Annuler' : 'Ajouter'}
          </button>
        </div>

        {/* Add Line Form */}
        {showAddLine && (
          <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-seaop-primary/30 p-3 mb-3 space-y-2.5">
            <input
              type="text"
              placeholder="Description *"
              value={lineForm.description}
              onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
            />
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400">Quantité</label>
                <input
                  type="number"
                  value={lineForm.quantite}
                  onChange={(e) => setLineForm({ ...lineForm, quantite: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400">Unité</label>
                <input
                  type="text"
                  value={lineForm.unite}
                  onChange={(e) => setLineForm({ ...lineForm, unite: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400">Prix unit.</label>
                <input
                  type="number"
                  step="0.01"
                  value={lineForm.prixUnitaire}
                  onChange={(e) => setLineForm({ ...lineForm, prixUnitaire: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
                />
              </div>
            </div>
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Montant: {formatCurrency((parseFloat(lineForm.quantite) || 0) * (parseFloat(lineForm.prixUnitaire) || 0))}
              </p>
              <button
                onClick={handleAddLine}
                disabled={!lineForm.description.trim() || addingLine}
                className="flex items-center gap-1 bg-seaop-primary text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 min-h-[44px]"
              >
                <Check className="w-4 h-4" />
                Ajouter
              </button>
            </div>
          </div>
        )}

        {/* Lines list */}
        {current.lignes.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            Aucune ligne
          </div>
        ) : (
          <div className="space-y-2">
            {current.lignes.map((line) => (
              <div
                key={line.id}
                className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200/60 dark:border-gray-700 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {line.description || '--'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {line.quantite} {line.unite} x {formatCurrency(line.prixUnitaire)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {formatCurrency(line.montantLigne)}
                    </span>
                    <button
                      onClick={() => handleDeleteLine(line)}
                      className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pieces jointes (Phase 2 polymorphique) */}
      {parentType && current && (
        <section className="px-4 py-4 space-y-3 border-t border-gray-200 dark:border-gray-700">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Pieces jointes
          </h2>
          <FileUpload
            parentType={parentType}
            parentId={current.id}
            multiple
            accept="image/*,application/pdf,.docx,.xlsx"
          />
          <AttachmentList
            parentType={parentType}
            parentId={current.id}
            canDelete
            canDownload
            canRename
            onPreview={(_, i) => setViewerIdx(i)}
          />
        </section>
      )}

      {/* Signature electronique (devis / factures uniquement) */}
      {isSignable && current && (
        <section className="px-4 py-4 space-y-3 border-t border-gray-200 dark:border-gray-700">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Signature electronique
          </h2>
          {signatureLoading && !signatureState ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : signatureState?.signed ? (
            <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-green-200 dark:border-green-900/50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                  Document signe
                </span>
              </div>
              {signatureState.signature_data_url && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white p-2">
                  <img
                    src={signatureState.signature_data_url}
                    alt="Signature"
                    className="max-h-40 w-auto mx-auto"
                  />
                </div>
              )}
              <div className="text-sm space-y-1">
                {signatureState.signataire_nom && (
                  <p className="text-gray-900 dark:text-white font-medium">
                    {signatureState.signataire_nom}
                  </p>
                )}
                {signatureState.signed_at && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Signe le {formatDate(signatureState.signed_at)}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200/60 dark:border-gray-700 p-4 space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Faites signer ce {DOC_TYPE_LABELS[docType || ''] || 'document'} par le client directement sur l ecran tactile.
              </p>
              <button
                onClick={() => {
                  setSignatureError(null);
                  setSignatureModalOpen(true);
                }}
                className="w-full flex items-center justify-center gap-2 bg-seaop-primary text-white px-4 py-3 rounded-lg text-sm font-medium min-h-[44px]"
              >
                <PenLine className="w-4 h-4" />
                Faire signer
              </button>
            </div>
          )}
        </section>
      )}

      {isSignable && current && (
        <DocumentSignatureModal
          isOpen={signatureModalOpen}
          documentNumero={current.numero}
          documentTypeLabel={DOC_TYPE_LABELS[docType || ''] || 'document'}
          isSubmitting={signatureSubmitting}
          submissionError={signatureError}
          onSubmit={handleSubmitSignature}
          onClose={() => setSignatureModalOpen(false)}
        />
      )}

      {current && docType && docId && (
        <EmailDocumentModal
          isOpen={emailModalOpen}
          onClose={() => setEmailModalOpen(false)}
          docType={docType as DocType}
          docId={parseInt(docId)}
          docNumero={current.numero}
          onSuccess={(to) => setEmailSuccess(`Courriel envoye a ${to}`)}
        />
      )}

      {isFacture && current && docId && (
        <RecurrentInvoiceModal
          isOpen={recurrentModalOpen}
          onClose={() => setRecurrentModalOpen(false)}
          factureId={parseInt(docId)}
          factureNumero={current.numero}
          onSuccess={() => {
            // L'alert de succes est gere par la modale via setTimeout ;
            // ici on stocke aussi le message externe pour rester visible
            // si l'utilisateur ferme tres vite.
            setRecurrentSuccess('Facture marquee comme recurrente.');
          }}
        />
      )}

      {confirmElement}
      {viewerIdx !== null && attachments.length > 0 && (
        <AttachmentViewer
          attachments={attachments}
          index={Math.min(viewerIdx, attachments.length - 1)}
          onClose={() => setViewerIdx(null)}
          onIndexChange={setViewerIdx}
        />
      )}
    </div>
  );
}
