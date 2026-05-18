/**
 * Mobile React Frontend - Dossier Detail Page (Fiche 360)
 * 10 tabbed view matching ERP Fiche 360:
 * Résumé, Soumissions, Projet, BT, Achats, Demandes, Factures, Pointage, Comptabilité, Documents
 * Plus: Étapes, Notes (mobile-specific)
 */

import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, Check, FileText, Camera, Download, Plus, MessageSquare,
  ListChecks, BarChart3, FileSpreadsheet, FolderKanban, Wrench,
  ShoppingCart, DollarSign, Clock, Calculator, Receipt,
  Sparkles, Bot, Image as ImageIcon, X, Link2, ExternalLink, Pencil, Trash2,
} from 'lucide-react';
import { useDossiersStore } from '@/store/useDossiersStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { STATUTS_DOSSIER, STATUTS_ETAPE } from '@/utils/constants';
import { formatDate, formatCurrency } from '@/utils/format';
import {
  getNotePhotoUrl, getNoteAttachmentUrl, getDocumentDownloadUrl,
  getDossierLiens, createDossierLien, updateDossierLien, deleteDossierLien,
} from '@/api/dossiers';
import type { DossierLien } from '@/types';
import { enrichNote, analyzePhoto, getDossierSummary } from '@/api/ai';
import { extractApiError } from '@/types/api';
import { useConfirm } from '@/hooks/useConfirm';
import { FileUpload } from '@/components/FileUpload';
import { AttachmentList } from '@/components/AttachmentList';
import { AttachmentViewer } from '@/components/AttachmentViewer';
import { useAttachmentsStore } from '@/store/useAttachmentsStore';

type TabKey = 'resume' | 'soumissions' | 'projet' | 'bt' | 'achats' | 'demandes' | 'factures' | 'pointage' | 'comptabilite' | 'etapes' | 'notes' | 'documents' | 'liens';

/* ── Helper: empty state ── */
function EmptyState({ text }: { text: string }) {
  return <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">{text}</p>;
}

/* ── Helper: simple card row ── */
function InfoRow({ label, value, bold }: { label: string; value: string | number | null | undefined; bold?: boolean }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-gray-500 dark:text-gray-400 text-sm">{label}</span>
      <span className={`text-sm text-gray-900 dark:text-gray-100 ${bold ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

export default function DossierDetailPage() {
  const { dossierId } = useParams<{ dossierId: string }>();
  const navigate = useNavigate();
  // Selecteurs Zustand individuels (anti-pattern destructuring v5 = risque React #185).
  const current = useDossiersStore((s) => s.current);
  const isLoading = useDossiersStore((s) => s.isLoading);
  const error = useDossiersStore((s) => s.error);
  const fetchDetail = useDossiersStore((s) => s.fetchDetail);
  const addNote = useDossiersStore((s) => s.addNote);
  const updateEtape = useDossiersStore((s) => s.updateEtape);
  const clearError = useDossiersStore((s) => s.clearError);

  const [activeTab, setActiveTab] = useState<TabKey>('resume');
  const { confirm, element: confirmElement } = useConfirm();

  // Viewer fullscreen pour les nouvelles pieces jointes (Phase 2)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  // CAUSE React #185: si on retourne `s.byParent.get(...) || []` directement,
  // le `[]` est recree a chaque call (Object.is false) => boucle infinie de
  // re-renders. Subscribe a la Map puis derive via useMemo.
  const byParent = useAttachmentsStore((s) => s.byParent);
  const attachments = useMemo(
    () => byParent.get(`dossier:${dossierId}`) || [],
    [byParent, dossierId],
  );

  // Note form state
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [notePhotos, setNotePhotos] = useState<File[]>([]);
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  // AI state
  const [enriching, setEnriching] = useState(false);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [aiActions, setAiActions] = useState<string[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ resume: string; problemesOuverts: string[]; actionsEnAttente: string[] } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const aiPhotoInputRef = useRef<HTMLInputElement>(null);

  const numericId = dossierId ? parseInt(dossierId, 10) : NaN;

  useEffect(() => {
    if (!isNaN(numericId)) {
      fetchDetail(numericId);
    }
  }, [numericId, fetchDetail]);

  const handleUpdateEtape = async (etapeId: number, statut: string) => {
    if (!isNaN(numericId)) {
      await updateEtape(numericId, etapeId, statut);
    }
  };

  const handleSubmitNote = async () => {
    if (!noteContent.trim() || isNaN(numericId)) return;
    setNoteSubmitting(true);
    try {
      await addNote(numericId, noteContent.trim(), undefined, notePhotos.length > 0 ? notePhotos : undefined);
      setNoteContent('');
      setNotePhotos([]);
      setShowNoteModal(false);
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) setNotePhotos((prev) => [...prev, ...Array.from(files)]);
    e.target.value = '';
  };

  // AI handlers
  const handleEnrichNote = async () => {
    if (!noteContent.trim()) return;
    setEnriching(true);
    setAiError(null);
    try {
      const res = await enrichNote({ contenu: noteContent.trim(), dossierTitre: current?.titre });
      setNoteContent(res.contenuEnrichi);
      setAiActions(res.actions || []);
    } catch (err) {
      setAiError(extractApiError(err, 'Erreur enrichissement IA'));
    } finally { setEnriching(false); }
  };

  const handleAiAnalyzePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setAnalyzingPhoto(true);
    setAiError(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Erreur lecture'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1];
      const mediaType = file.type || 'image/jpeg';
      const res = await analyzePhoto({ imageData: base64, mediaType, dossierTitre: current?.titre });
      setNoteContent(res.contenuEnrichi);
      setAiActions(res.actions || []);
      setNotePhotos((prev) => [...prev, file]);
    } catch (err) {
      setAiError(extractApiError(err, 'Erreur analyse photo IA'));
    } finally { setAnalyzingPhoto(false); }
  };

  const handleSummarize = async () => {
    if (!numericId || isNaN(numericId)) return;
    setSummarizing(true);
    setAiError(null);
    try {
      const res = await getDossierSummary(numericId);
      setSummary({ resume: res.resume, problemesOuverts: res.problemesOuverts, actionsEnAttente: res.actionsEnAttente });
    } catch (err) {
      setAiError(extractApiError(err, 'Erreur résumé IA'));
    } finally { setSummarizing(false); }
  };

  if (isLoading && !current) {
    return (
      <div className="flex items-center justify-center h-full bg-transparent dark:bg-[#1b1a19]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-transparent dark:bg-[#1b1a19] px-4">
        <Alert type="error">Dossier introuvable</Alert>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/dossiers')}>
          Retour aux dossiers
        </Button>
      </div>
    );
  }

  const statutInfo = STATUTS_DOSSIER[current.statut];
  const progressPct = current.etapesTotal > 0 ? Math.round((current.etapesDone / current.etapesTotal) * 100) : 0;
  const compta = current.comptabilite;

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'resume', label: 'Résumé', icon: <BarChart3 className="h-4 w-4" /> },
    { key: 'soumissions', label: 'Devis', icon: <FileSpreadsheet className="h-4 w-4" />, count: current.devis?.length },
    { key: 'projet', label: 'Projets', icon: <FolderKanban className="h-4 w-4" />, count: current.projets?.length },
    { key: 'bt', label: 'BT', icon: <Wrench className="h-4 w-4" />, count: current.bonsTravail?.length },
    { key: 'achats', label: 'Achats', icon: <ShoppingCart className="h-4 w-4" />, count: current.bonsCommande?.length },
    { key: 'demandes', label: 'Demandes', icon: <Receipt className="h-4 w-4" />, count: current.demandesPrix?.length },
    { key: 'factures', label: 'Factures', icon: <DollarSign className="h-4 w-4" />, count: current.factures?.length },
    { key: 'pointage', label: 'Pointage', icon: <Clock className="h-4 w-4" />, count: current.pointage?.length },
    { key: 'comptabilite', label: 'Compta', icon: <Calculator className="h-4 w-4" /> },
    { key: 'etapes', label: 'Étapes', icon: <ListChecks className="h-4 w-4" />, count: current.etapes?.length },
    { key: 'notes', label: 'Notes', icon: <MessageSquare className="h-4 w-4" />, count: current.notes?.length },
    { key: 'documents', label: 'Docs', icon: <FileText className="h-4 w-4" />, count: current.documents?.length },
    { key: 'liens', label: 'Liens', icon: <Link2 className="h-4 w-4" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-[#1b1a19]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dossiers')}
            className="rounded-lg p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Retour"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {current.titre}
            </h1>
            <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{current.numeroDossier}</p>
          </div>
          {statutInfo && <Badge className={statutInfo.bgClass}>{statutInfo.label}</Badge>}
        </div>
      </header>

      {error && (
        <div className="px-4 pt-3">
          <Alert type="error" onDismiss={clearError}>{error}</Alert>
        </div>
      )}

      {/* Scrollable Tabs */}
      <div className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1 px-3 py-3 text-xs font-medium whitespace-nowrap transition-colors border-b-2 shrink-0 ${
              activeTab === tab.key
                ? 'border-seaop-primary-600 text-seaop-primary-600 dark:text-seaop-primary-400 dark:border-seaop-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`text-[10px] px-1 py-0.5 rounded-full ${
                activeTab === tab.key
                  ? 'bg-seaop-primary-100 text-seaop-primary-700 dark:bg-seaop-primary-900/40 dark:text-seaop-primary-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
              }`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto pb-safe">

        {/* ═══ RESUME ═══ */}
        {activeTab === 'resume' && (
          <div className="px-4 py-3 space-y-4">
            {/* Info */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Informations</h3>
              <InfoRow label="Projet" value={current.projectNom} />
              <InfoRow label="Client" value={current.clientNom} />
              <InfoRow label="Responsable" value={current.responsableNom} />
              <InfoRow label="Ouverture" value={formatDate(current.dateOuverture)} />
              <InfoRow label="Échéance" value={formatDate(current.dateEcheance)} />
              {current.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 border-t border-gray-100 dark:border-gray-700 pt-2">{current.description}</p>
              )}
            </div>

            {/* Progress */}
            {current.etapesTotal > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span>Progression</span>
                  <span>{current.etapesDone}/{current.etapesTotal} ({progressPct}%)</span>
                </div>
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-seaop-primary-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            {/* KPI Cards */}
            {compta && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Budget', value: formatCurrency(compta.budgetTotal), cls: 'text-blue-600 dark:text-blue-400' },
                  { label: 'Facturé', value: formatCurrency(compta.totalFacture), cls: 'text-green-600 dark:text-green-400' },
                  { label: 'Payé', value: formatCurrency(compta.totalPaye), cls: 'text-emerald-600 dark:text-emerald-400' },
                  { label: 'Solde dû', value: formatCurrency(compta.totalSoldeDu), cls: 'text-orange-600 dark:text-orange-400' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className={`text-lg font-bold ${cls}`}>{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Counts */}
            {compta && (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Activité</h3>
                <InfoRow label="Devis" value={compta.nbDevis} />
                <InfoRow label="Factures" value={compta.nbFactures} />
                <InfoRow label="Bons de travail" value={compta.nbBonsTravail} />
                <InfoRow label="Bons de commande" value={compta.nbBonsCommande} />
                <InfoRow label="Heures pointées" value={`${compta.totalHeures} h`} />
              </div>
            )}
          </div>
        )}

        {/* ═══ SOUMISSIONS (Devis) ═══ */}
        {activeTab === 'soumissions' && (
          <div className="px-4 py-3 space-y-2">
            {(!current.devis || current.devis.length === 0) && <EmptyState text="Aucun devis lié" />}
            {current.devis?.map((d) => (
              <div key={d.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex justify-between items-start mb-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{d.nomProjet || d.numeroDevis}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{d.numeroDevis}</p>
                  </div>
                  <Badge variant={d.statut === 'Accepté' ? 'success' : d.statut === 'Envoyé' ? 'info' : 'default'}>{d.statut}</Badge>
                </div>
                <div className="flex justify-between items-center mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{formatDate(d.createdAt)}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(d.investissementTotal || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ PROJETS ═══ */}
        {activeTab === 'projet' && (
          <div className="px-4 py-3 space-y-2">
            {(!current.projets || current.projets.length === 0) && <EmptyState text="Aucun projet lié" />}
            {current.projets?.map((p) => (
              <div key={p.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex justify-between items-start mb-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">{p.nomProjet}</p>
                  <Badge variant={p.statut === 'EN_COURS' ? 'info' : p.statut === 'TERMINE' ? 'success' : 'default'}>{p.statut}</Badge>
                </div>
                <InfoRow label="Budget" value={p.budgetTotal ? formatCurrency(p.budgetTotal) : null} />
                <InfoRow label="Début" value={formatDate(p.dateDebutReel)} />
                <InfoRow label="Prévu" value={formatDate(p.datePrevu)} />
              </div>
            ))}
          </div>
        )}

        {/* ═══ BONS DE TRAVAIL ═══ */}
        {activeTab === 'bt' && (
          <div className="px-4 py-3 space-y-2">
            {(!current.bonsTravail || current.bonsTravail.length === 0) && <EmptyState text="Aucun bon de travail" />}
            {current.bonsTravail?.map((bt) => (
              <div key={bt.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex justify-between items-start mb-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{bt.nom || bt.numeroDocument}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{bt.numeroDocument}</p>
                  </div>
                  <Badge variant={bt.statut === 'COMPLETE' ? 'success' : bt.statut === 'EN_COURS' ? 'info' : 'default'}>{bt.statut}</Badge>
                </div>
                <div className="flex justify-between items-center mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{bt.dateEcheance ? formatDate(bt.dateEcheance) : ''}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{bt.montantTotal ? formatCurrency(bt.montantTotal) : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ ACHATS (Bons commande) ═══ */}
        {activeTab === 'achats' && (
          <div className="px-4 py-3 space-y-2">
            {(!current.bonsCommande || current.bonsCommande.length === 0) && <EmptyState text="Aucun bon de commande" />}
            {current.bonsCommande?.map((bc) => (
              <div key={bc.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex justify-between items-start mb-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{bc.numero}</p>
                  <Badge>{bc.statut}</Badge>
                </div>
                <InfoRow label="Montant" value={bc.montantTotal ? formatCurrency(bc.montantTotal) : null} bold />
                <InfoRow label="Commande" value={formatDate(bc.dateCommande)} />
                <InfoRow label="Livraison" value={formatDate(bc.dateLivraisonPrevue)} />
              </div>
            ))}
          </div>
        )}

        {/* ═══ DEMANDES DE PRIX ═══ */}
        {activeTab === 'demandes' && (
          <div className="px-4 py-3 space-y-2">
            {(!current.demandesPrix || current.demandesPrix.length === 0) && <EmptyState text="Aucune demande de prix" />}
            {current.demandesPrix?.map((dp) => (
              <div key={dp.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex justify-between items-start mb-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{dp.nom || dp.numeroDocument}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{dp.numeroDocument}</p>
                  </div>
                  <Badge>{dp.statut}</Badge>
                </div>
                <div className="flex justify-between items-center mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{dp.dateEcheance ? formatDate(dp.dateEcheance) : ''}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{dp.montantTotal ? formatCurrency(dp.montantTotal) : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ FACTURES ═══ */}
        {activeTab === 'factures' && (
          <div className="px-4 py-3 space-y-2">
            {(!current.factures || current.factures.length === 0) && <EmptyState text="Aucune facture" />}
            {current.factures?.map((f) => (
              <div key={f.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex justify-between items-start mb-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{f.numeroFacture}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{f.clientNom}</p>
                  </div>
                  <Badge variant={f.statut === 'PAYEE' ? 'success' : f.statut === 'EN_RETARD' ? 'danger' : 'default'}>{f.statut}</Badge>
                </div>
                <InfoRow label="TTC" value={formatCurrency(f.montantTtc || 0)} bold />
                <InfoRow label="Payé" value={formatCurrency(f.montantPaye || 0)} />
                <InfoRow label="Solde" value={f.soldeDu ? formatCurrency(f.soldeDu) : null} />
                <InfoRow label="Date" value={formatDate(f.dateFacture)} />
              </div>
            ))}
          </div>
        )}

        {/* ═══ POINTAGE ═══ */}
        {activeTab === 'pointage' && (
          <div className="px-4 py-3 space-y-2">
            {(!current.pointage || current.pointage.length === 0) && <EmptyState text="Aucun pointage" />}
            {current.pointage?.map((p) => (
              <div key={p.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex justify-between items-start mb-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {p.prenom} {p.nom}
                  </p>
                  {p.validated && <Badge variant="success">Validé</Badge>}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  <div>
                    <p className="text-gray-400">Entrée</p>
                    <p className="text-gray-900 dark:text-gray-100">{p.punchIn ? new Date(p.punchIn + 'Z').toLocaleString('fr-CA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '-'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Sortie</p>
                    <p className="text-gray-900 dark:text-gray-100">{p.punchOut ? new Date(p.punchOut + 'Z').toLocaleString('fr-CA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '-'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Heures</p>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{p.totalHours ? `${(p.totalHours ?? 0).toFixed(1)} h` : '-'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ COMPTABILITE ═══ */}
        {activeTab === 'comptabilite' && (
          <div className="px-4 py-3 space-y-4">
            {!compta && <EmptyState text="Aucune donnée comptable" />}
            {compta && (
              <>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Revenus / Facturation</h3>
                  <InfoRow label="Budget total" value={formatCurrency(compta.budgetTotal)} />
                  <InfoRow label="Total devis" value={formatCurrency(compta.totalDevis)} />
                  <InfoRow label="Total facturé" value={formatCurrency(compta.totalFacture)} bold />
                  <InfoRow label="Total payé" value={formatCurrency(compta.totalPaye)} />
                  <InfoRow label="Solde dû" value={formatCurrency(compta.totalSoldeDu)} bold />
                  <InfoRow label="Factures payées" value={`${compta.nbFacturesPayees} / ${compta.nbFactures}`} />
                  <InfoRow label="En retard" value={compta.nbFacturesEnRetard > 0 ? compta.nbFacturesEnRetard : null} />
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Coûts et marge</h3>
                  <InfoRow label="Heures pointées" value={`${compta.totalHeures} h`} />
                  <InfoRow label="Total achats" value={formatCurrency(compta.totalAchats)} />
                  <InfoRow label="Total coûts" value={formatCurrency(compta.totalCouts)} bold />
                  <InfoRow label="Marge estimée" value={formatCurrency(compta.margeEstimee)} bold />
                  {compta.totalFacture > 0 && (
                    <InfoRow label="% marge" value={`${((compta.margeEstimee / compta.totalFacture) * 100).toFixed(1)} %`} />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ ETAPES ═══ */}
        {activeTab === 'etapes' && (
          <div className="px-4 py-3 space-y-2">
            {current.etapes.length === 0 && <EmptyState text="Aucune étape définie" />}
            {[...current.etapes]
              .sort((a, b) => a.ordre - b.ordre)
              .map((etape) => {
                const etapeInfo = STATUTS_ETAPE[etape.statut];
                return (
                  <div key={etape.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-start gap-2 mb-1.5">
                      <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
                        etape.statut === 'DONE' ? 'bg-green-500 text-white'
                          : etape.statut === 'IN_PROGRESS' ? 'bg-blue-500 text-white'
                            : 'bg-gray-200 dark:bg-gray-600'
                      }`}>
                        {etape.statut === 'DONE' ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">{etape.ordre}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${etape.statut === 'DONE' ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100'}`}>{etape.titre}</p>
                        {etape.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{etape.description}</p>}
                        {etape.datePrevue && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Prévue: {formatDate(etape.datePrevue)}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {etapeInfo && <Badge className={etapeInfo.bgClass}>{etapeInfo.label}</Badge>}
                      <select
                        value={etape.statut}
                        onChange={(e) => handleUpdateEtape(etape.id, e.target.value)}
                        className="ml-auto text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-seaop-primary-500 min-h-[36px]"
                      >
                        {Object.entries(STATUTS_ETAPE).map(([key, { label }]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* ═══ NOTES ═══ */}
        {activeTab === 'notes' && (
          <div className="px-4 py-3">
            <div className="flex gap-2 mb-3">
              <Button onClick={() => setShowNoteModal(true)} leftIcon={<Plus className="h-4 w-4" />} size="sm" className="flex-1">
                Ajouter une note
              </Button>
              <button
                onClick={handleSummarize}
                disabled={summarizing || !current.notes?.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg disabled:opacity-40"
              >
                <Bot className="h-4 w-4" />
                {summarizing ? 'Résumé...' : 'Résumé IA'}
              </button>
            </div>

            {aiError && <Alert type="error" onDismiss={() => setAiError(null)} className="mb-3">{aiError}</Alert>}

            {/* AI Summary panel */}
            {summary && (
              <div className="mb-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5" /> Résumé IA
                  </span>
                  <button onClick={() => setSummary(null)} className="text-gray-400"><X className="h-4 w-4" /></button>
                </div>
                <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap mb-2">{summary.resume}</p>
                {summary.problemesOuverts.length > 0 && (
                  <div className="mb-1.5">
                    <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 mb-0.5">Problèmes ouverts:</p>
                    {summary.problemesOuverts.map((p, i) => <p key={i} className="text-xs text-red-500 dark:text-red-300">- {p}</p>)}
                  </div>
                )}
                {summary.actionsEnAttente.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 mb-0.5">Actions en attente:</p>
                    {summary.actionsEnAttente.map((a, i) => <p key={i} className="text-xs text-orange-500 dark:text-orange-300">- {a}</p>)}
                  </div>
                )}
              </div>
            )}

            {(!current.notes || current.notes.length === 0) && <EmptyState text="Aucune note" />}
            <div className="space-y-3">
              {(current.notes || []).map((note) => (
                <div key={note.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  {note.categorie && <Badge variant="info" className="mb-2">{note.categorie}</Badge>}
                  <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{note.contenu}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{formatDate(note.createdAt)}</p>
                  {/* Mobile photos (from dossier_note_photos) */}
                  {note.photos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {note.photos.map((photo) => (
                        <a key={photo.id} href={getNotePhotoUrl(photo.id)} target="_blank" rel="noopener noreferrer" className="shrink-0">
                          <img src={getNotePhotoUrl(photo.id)} alt={photo.fichierNom} className="h-16 w-16 rounded-lg object-cover border border-gray-200 dark:border-gray-600" />
                        </a>
                      ))}
                    </div>
                  )}
                  {/* ERP attachments (from dossier_notes.attachments JSON) */}
                  {note.attachments && note.attachments.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {/* Image attachments — inline thumbnails */}
                      {note.attachments.some(a => a.type?.startsWith('image/')) && (
                        <div className="flex gap-2 overflow-x-auto">
                          {note.attachments.map((att, idx) =>
                            att.type?.startsWith('image/') ? (
                              <a key={idx} href={getNoteAttachmentUrl(current.id, note.id, idx)} target="_blank" rel="noopener noreferrer" className="shrink-0">
                                <img src={getNoteAttachmentUrl(current.id, note.id, idx)} alt={att.nom} className="h-20 w-20 rounded-lg object-cover border border-gray-200 dark:border-gray-600" />
                              </a>
                            ) : null
                          )}
                        </div>
                      )}
                      {/* Non-image attachments — download links */}
                      {note.attachments.some(a => !a.type?.startsWith('image/')) && (
                        <div className="flex flex-wrap gap-2">
                          {note.attachments.map((att, idx) =>
                            !att.type?.startsWith('image/') ? (
                              <a
                                key={idx}
                                href={getNoteAttachmentUrl(current.id, note.id, idx)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg"
                              >
                                <Download className="h-3 w-3" />
                                {att.nom}
                                {att.taille != null && <span className="text-gray-400">({(att.taille / 1024).toFixed(0)} Ko)</span>}
                              </a>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ DOCUMENTS ═══ */}
        {activeTab === 'documents' && (
          <div className="px-4 py-3 space-y-4">
            {/* Nouvelle section : pieces jointes polymorphiques (Phase 2) */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Pieces jointes
              </h3>
              <FileUpload
                parentType="dossier"
                parentId={current.id}
                multiple
                accept="image/*,application/pdf,.docx,.xlsx"
              />
              <AttachmentList
                parentType="dossier"
                parentId={current.id}
                canDelete
                canDownload
                canRename
                onPreview={(_, i) => setViewerIdx(i)}
              />
            </section>

            {/* Documents legacy (dossier_documents + attachments BYTEA) */}
            {current.documents.length > 0 && (
              <section className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Documents existants
                </h3>
                {current.documents.map((doc) => (
                  <a
                    key={`${doc.source || 'legacy'}-${doc.id}`}
                    href={getDocumentDownloadUrl(current.id, doc.id, doc.source)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 hover:border-seaop-primary-300 dark:hover:border-seaop-primary-600 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{doc.titre}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{doc.fichierNom} &middot; {(doc.fichierTaille / 1024).toFixed(0)} Ko</p>
                    </div>
                    <Download className="h-4 w-4 text-gray-400 shrink-0" />
                  </a>
                ))}
              </section>
            )}
          </div>
        )}

        {/* ═══ LIENS ═══ */}
        {activeTab === 'liens' && <LiensSection dossierId={current.id} />}
      </div>

      {/* Add Note Modal */}
      <Modal
        isOpen={showNoteModal}
        onClose={() => { setShowNoteModal(false); setNoteContent(''); setNotePhotos([]); setAiActions([]); setAiError(null); }}
        title="Ajouter une note"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Contenu</label>
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              rows={4}
              placeholder="Écrire votre note..."
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 resize-none"
              autoFocus
            />
          </div>
          {/* AI actions */}
          {aiActions.length > 0 && (
            <div className="p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Actions identifiées par l'IA:</p>
              {aiActions.map((a, i) => <p key={i} className="text-xs text-amber-600 dark:text-amber-300">- {a}</p>)}
            </div>
          )}
          {aiError && <Alert type="error" onDismiss={() => setAiError(null)}>{aiError}</Alert>}
          {/* AI buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleEnrichNote}
              disabled={!noteContent.trim() || enriching}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg disabled:opacity-40"
              style={{ minHeight: '44px' }}
            >
              <Sparkles className="h-4 w-4" />
              {enriching ? 'Enrichissement...' : 'Enrichir avec IA'}
            </button>
            <button
              onClick={() => aiPhotoInputRef.current?.click()}
              disabled={analyzingPhoto}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg disabled:opacity-40"
              style={{ minHeight: '44px' }}
            >
              <ImageIcon className="h-4 w-4" />
              {analyzingPhoto ? 'Analyse...' : 'Analyser photo IA'}
            </button>
            <input ref={aiPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={handleAiAnalyzePhoto} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Photos</label>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 cursor-pointer hover:border-seaop-primary-400 transition-colors">
              <Camera className="h-4 w-4" />
              Ajouter des photos
              <input type="file" accept="image/*" multiple onChange={handlePhotoSelect} className="hidden" />
            </label>
            {notePhotos.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {notePhotos.map((file, idx) => (
                  <div key={idx} className="relative">
                    <img src={URL.createObjectURL(file)} alt={file.name} className="h-16 w-16 rounded-lg object-cover border border-gray-200 dark:border-gray-600" />
                    <button
                      onClick={() => setNotePhotos((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center"
                      aria-label="Retirer"
                    >&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button onClick={handleSubmitNote} disabled={!noteContent.trim()} isLoading={noteSubmitting} className="w-full">
            Enregistrer la note
          </Button>
        </div>
      </Modal>
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


/* ════════════════════════════════════════════════════════════════════
   LIENS SECTION — Mobile-friendly (touches 44+px, layout stacke)
   ════════════════════════════════════════════════════════════════════ */

function LiensSection({ dossierId }: { dossierId: number }) {
  const [liens, setLiens] = useState<DossierLien[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState('');
  // useConfirm est local a LiensSection (pas hereditaire depuis le parent)
  const { confirm, element: confirmElement } = useConfirm();
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Ref synchrone anti double-click (window 16ms entre click et React state)
  const mutationInFlightRef = useRef(false);
  // Ref unmount pour eviter setState warnings sur composant demonte
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isValidUrl = (value: string) => {
    const trimmed = value.trim();
    // Exige scheme http(s):// + au moins 1 caractere non-whitespace pour
    // le host. Rejette `https://` tout court qui clique vers nulle part.
    return /^https?:\/\/\S+$/i.test(trimmed);
  };
  // Tronque l'URL pour les aria-label des boutons (evite que screen reader
  // lise 2000 caracteres d'une URL).
  const truncateForAria = (s: string, max = 80) => (s.length <= max ? s : s.slice(0, max) + '...');
  // Compte les code points Unicode (emoji-safe) pour matcher Pydantic max_length=1000
  const codePointLength = (s: string) => [...s].length;

  const fetchLiens = async () => {
    setLoading(true);
    try {
      const data = await getDossierLiens(dossierId);
      if (!isMountedRef.current) return;
      setLiens(data);
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(extractApiError(err, 'Erreur lors du chargement des liens'));
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  const handleCreate = async () => {
    if (mutationInFlightRef.current) return;
    const cleanUrl = newUrl.trim();
    if (!cleanUrl) {
      setError("L'URL est requise");
      return;
    }
    if (!isValidUrl(cleanUrl)) {
      setError("L'URL doit commencer par http:// ou https://");
      return;
    }
    mutationInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await createDossierLien(dossierId, {
        url: cleanUrl,
        description: newDescription.trim() || undefined,
      });
      if (!isMountedRef.current) return;
      setNewUrl('');
      setNewDescription('');
      await fetchLiens();
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(extractApiError(err, 'Erreur lors de la creation'));
    } finally {
      // Reset le flag synchrone meme si demonte (pas de setState).
      mutationInFlightRef.current = false;
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  const handleStartEdit = (lien: DossierLien) => {
    setEditingId(lien.id);
    setEditUrl(lien.url);
    setEditDescription(lien.description || '');
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditUrl('');
    setEditDescription('');
    setError(null);
  };

  const handleSaveEdit = async (lienId: number) => {
    if (mutationInFlightRef.current) return;
    const cleanUrl = editUrl.trim();
    if (!cleanUrl) {
      setError("L'URL est requise");
      return;
    }
    if (!isValidUrl(cleanUrl)) {
      setError("L'URL doit commencer par http:// ou https://");
      return;
    }
    mutationInFlightRef.current = true;
    setSavingEdit(true);
    setError(null);
    try {
      await updateDossierLien(dossierId, lienId, {
        url: cleanUrl,
        // .trim() peut donner string vide. On envoie quand meme la string
        // vide pour que le backend la normalise en NULL (vs `undefined` qui
        // omet le champ et empeche d'effacer la description existante).
        description: editDescription.trim(),
      });
      if (!isMountedRef.current) return;
      await fetchLiens();
      if (!isMountedRef.current) return;
      setEditingId(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(extractApiError(err, 'Erreur lors de la mise a jour'));
    } finally {
      mutationInFlightRef.current = false;
      if (isMountedRef.current) setSavingEdit(false);
    }
  };

  const handleDelete = async (lienId: number) => {
    if (mutationInFlightRef.current) return;
    const ok = await confirm({
      message: 'Supprimer ce lien ?',
      variant: 'danger',
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    mutationInFlightRef.current = true;
    setDeletingId(lienId);
    setError(null);
    try {
      await deleteDossierLien(dossierId, lienId);
      if (!isMountedRef.current) return;
      await fetchLiens();
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(extractApiError(err, 'Erreur lors de la suppression'));
    } finally {
      mutationInFlightRef.current = false;
      if (isMountedRef.current) setDeletingId(null);
    }
  };

  return (
    <div className="px-4 py-3 space-y-4">
      {error && <Alert type="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {/* Formulaire ajout — layout mobile stacke, gros boutons tactiles */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Plus className="h-4 w-4" /> Ajouter un lien
        </h3>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">URL *</label>
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://exemple.com"
            maxLength={2048}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={submitting}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500"
            style={{ minHeight: '44px' }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description (optionnel)</label>
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Courte description"
            rows={2}
            maxLength={1000}
            disabled={submitting}
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 resize-none"
          />
          <p className="mt-1 text-xs text-gray-400 text-right">{codePointLength(newDescription)}/1000</p>
        </div>
        <Button
          onClick={handleCreate}
          disabled={submitting || !newUrl.trim() || !isValidUrl(newUrl)}
          isLoading={submitting}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Ajouter
        </Button>
      </div>

      {/* Liste des liens */}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : liens.length === 0 ? (
        <EmptyState text="Aucun lien ajoute" />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 px-1">{liens.length} lien{liens.length > 1 ? 's' : ''}</p>
          {liens.map((lien) => {
            const isEditing = editingId === lien.id;
            return (
              <div key={lien.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">URL *</label>
                      <input
                        type="url"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        maxLength={2048}
                        inputMode="url"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={savingEdit}
                        className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
                        style={{ minHeight: '44px' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        maxLength={1000}
                        disabled={savingEdit}
                        className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 resize-none"
                      />
                      <p className="mt-1 text-xs text-gray-400 text-right">{codePointLength(editDescription)}/1000</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={savingEdit}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
                        style={{ minHeight: '44px' }}
                      >
                        <X className="h-4 w-4" /> Annuler
                      </button>
                      <Button
                        onClick={() => handleSaveEdit(lien.id)}
                        disabled={savingEdit || !editUrl.trim() || !isValidUrl(editUrl)}
                        isLoading={savingEdit}
                        className="flex-1"
                      >
                        <Check className="h-4 w-4 mr-1" /> Sauvegarder
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <a
                      href={lien.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 text-sm font-medium text-seaop-primary-600 dark:text-seaop-primary-400 active:text-seaop-primary-800 break-all"
                    >
                      <ExternalLink className="h-4 w-4 shrink-0 mt-0.5" />
                      <span className="break-all">{lien.url}</span>
                    </a>
                    {lien.description && (
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                        {lien.description}
                      </p>
                    )}
                    {lien.createdAt && (
                      <p className="text-xs text-gray-400">Ajoute le {formatDate(lien.createdAt)}</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(lien)}
                        disabled={deletingId !== null || submitting || savingEdit}
                        aria-label={`Modifier le lien ${truncateForAria(lien.url)}`}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg active:bg-gray-100 dark:active:bg-gray-700 disabled:opacity-50"
                        style={{ minHeight: '44px' }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" /> Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(lien.id)}
                        disabled={deletingId !== null || submitting || savingEdit}
                        aria-label={`Supprimer le lien ${truncateForAria(lien.url)}`}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg active:bg-red-50 dark:active:bg-red-900/20 disabled:opacity-50"
                        style={{ minHeight: '44px' }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" /> Supprimer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {confirmElement}
    </div>
  );
}
