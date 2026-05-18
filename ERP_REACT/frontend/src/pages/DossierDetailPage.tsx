/**
 * ERP React Frontend - Dossier 360° Detail Page
 * Fiche projet complète: opportunité, devis, projet, BT, factures, pointage, comptabilité, documents.
 */

import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, FolderOpen, Target, FileText, Briefcase, Wrench,
  Receipt, Clock, DollarSign, Paperclip, CheckCircle2, AlertCircle, MessageSquare,
  TrendingUp, Calendar, ShoppingCart, Send, Plus, X, Trash2, Upload, Download,
  Mic, Square, Bot, Sparkles, Pin, Image as ImageIcon, Share2, Copy, Link2,
  Pencil, Check, Eye, ExternalLink,
} from 'lucide-react';
import DocumentViewer from '@/components/DocumentViewer';
import {
  getDossier360, getLinkableItems, linkItemToDossier, unlinkItemFromDossier,
  uploadAttachment, downloadAttachment, deleteAttachment,
  getDossierNotes, createDossierNoteWithFiles, deleteDossierNote, downloadNoteAttachment,
  aiEnrichNote, aiAnalyzePhoto, aiSummarizeNotes, toggleNotePin,
  generateShareLink, revokeShareLink, getShareInfo, updateDocument, deleteDocument,
  getDossierLiens, createDossierLien, updateDossierLien, deleteDossierLien,
} from '@/api/documents';
import type { ShareInfo } from '@/api/documents';
import type { DossierNote, NoteAttachment, NoteAiSummaryResult, DossierLien } from '@/api/documents';
import type { Dossier360, LinkableType, LinkableItem } from '@/api/documents';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { formatDate, formatCurrency } from '@/utils/format';

type Section = 'resume' | 'devis' | 'projet' | 'bons_travail' | 'achats' | 'demandes_prix' | 'factures' | 'pointage' | 'comptabilite' | 'documents' | 'notes' | 'liens';

const STATUS_COLORS: Record<string, 'blue' | 'green' | 'yellow' | 'gray' | 'red' | 'purple' | 'orange' | 'indigo' | 'teal'> = {
  PROSPECTION: 'blue', QUALIFICATION: 'yellow', PROPOSITION: 'purple',
  NEGOCIATION: 'orange', GAGNE: 'green', PERDU: 'red',
  'En cours': 'blue', 'Brouillon': 'gray', 'Envoye': 'indigo',
  Accepte: 'green', Refuse: 'red', Termine: 'teal',
  BROUILLON: 'gray', EN_COURS: 'blue', TERMINEE: 'green',
  ENVOYEE: 'indigo', PAYEE: 'green', EN_RETARD: 'red',
  OUVERT: 'blue', EN_ATTENTE: 'yellow', ARCHIVE: 'gray',
};

const NAV_ITEMS: Array<{ key: Section; label: string; icon: typeof Target }> = [
  { key: 'resume', label: 'Résumé', icon: FolderOpen },
  { key: 'devis', label: 'Soumissions', icon: FileText },
  { key: 'projet', label: 'Projet', icon: Briefcase },
  { key: 'bons_travail', label: 'Bons de travail', icon: Wrench },
  { key: 'achats', label: 'Achats', icon: ShoppingCart },
  { key: 'demandes_prix', label: 'Demandes de prix', icon: Send },
  { key: 'factures', label: 'Factures', icon: Receipt },
  { key: 'pointage', label: 'Pointage', icon: Clock },
  { key: 'comptabilite', label: 'Comptabilité', icon: DollarSign },
  { key: 'documents', label: 'Documents', icon: Paperclip },
  { key: 'notes', label: 'Notes', icon: MessageSquare },
  { key: 'liens', label: 'Liens', icon: Link2 },
];

export default function DossierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Dossier360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('resume');
  const [editingTitre, setEditingTitre] = useState(false);
  const [titreDraft, setTitreDraft] = useState('');
  const [savingTitre, setSavingTitre] = useState(false);
  const [titreError, setTitreError] = useState<string | null>(null);
  const [deletingDossier, setDeletingDossier] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getDossier360(Number(id))
      .then(setData)
      .catch((e) => setError(e?.response?.data?.detail || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleStartEditTitre = () => {
    if (!data) return;
    setTitreDraft(data.dossier.titre || '');
    setTitreError(null);
    setEditingTitre(true);
  };

  const handleCancelEditTitre = () => {
    if (savingTitre) return;
    setEditingTitre(false);
    setTitreDraft('');
    setTitreError(null);
  };

  const handleSaveTitre = async () => {
    if (savingTitre) return;
    if (!data || !id) return;
    const trimmed = titreDraft.trim();
    if (!trimmed) {
      setTitreError('Le titre ne peut pas être vide');
      return;
    }
    if (trimmed === data.dossier.titre) {
      setEditingTitre(false);
      return;
    }
    setSavingTitre(true);
    setTitreError(null);
    try {
      await updateDocument(Number(id), { titre: trimmed });
      setData({ ...data, dossier: { ...data.dossier, titre: trimmed } });
      setEditingTitre(false);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const message = Array.isArray(detail)
        ? (detail[0]?.msg || 'Validation invalide')
        : (typeof detail === 'string' ? detail : 'Erreur de sauvegarde');
      setTitreError(message);
    } finally {
      setSavingTitre(false);
    }
  };

  const handleDeleteDossier = async () => {
    if (!data || !id) return;
    const titre = data.dossier.titre || `#${data.dossier.id}`;
    const msg = `Supprimer le dossier "${titre}" ?\n\nAttention :\n• Toutes les pièces jointes, notes et étapes du dossier seront supprimées\n• Les opportunités/projets liés seront détachés (non supprimés)\n• Les dépenses liées seront aussi supprimées (cascade comptable)\n\nCette action est irréversible.`;
    if (!window.confirm(msg)) return;
    setDeletingDossier(true);
    try {
      await deleteDocument(Number(id));
      navigate('/dossiers');
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Erreur lors de la suppression du dossier');
      setDeletingDossier(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (error || !data) return <Alert type="error">{error || 'Dossier introuvable'}</Alert>;

  const { dossier, opportunite, devis, projets, bonsTravail, bonsCommande, demandesPrix, factures, pointage, comptabilite, documents } = data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {editingTitre ? (
              <>
                <input
                  type="text"
                  value={titreDraft}
                  onChange={(e) => setTitreDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitre();
                    if (e.key === 'Escape') handleCancelEditTitre();
                  }}
                  disabled={savingTitre}
                  autoFocus
                  maxLength={255}
                  aria-label="Nouveau titre du dossier"
                  className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[240px]"
                />
                <button
                  onClick={handleSaveTitre}
                  disabled={savingTitre}
                  className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  title="Sauvegarder"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={handleCancelEditTitre}
                  disabled={savingTitre}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                  title="Annuler"
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <>
                <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">{dossier.titre}</h1>
                <button
                  onClick={handleStartEditTitre}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                  title="Modifier le nom"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={handleDeleteDossier}
                  disabled={deletingDossier}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Supprimer le dossier"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <Badge color={STATUS_COLORS[dossier.statut] || 'gray'}>{dossier.statut}</Badge>
          </div>
          {titreError && (
            <div role="alert" aria-live="polite" className="text-xs text-red-600 dark:text-red-400 mt-1">{titreError}</div>
          )}
          <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-1 text-sm text-gray-500">
            <span className="font-mono">{dossier.numeroDossier}</span>
            {opportunite?.numeroOpportunite && (
              <span className="font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">
                {opportunite.numeroOpportunite}
              </span>
            )}
            {dossier.clientNom && <span>| {dossier.clientNom}</span>}
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 pb-px -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const count = key === 'devis' ? devis.length
            : key === 'bons_travail' ? bonsTravail.length
            : key === 'achats' ? bonsCommande.length
            : key === 'demandes_prix' ? demandesPrix.length
            : key === 'factures' ? factures.length
            : key === 'pointage' ? pointage.length
            : key === 'documents' ? documents.length
            : undefined;
          return (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`flex items-center gap-1.5 px-2.5 md:px-3 py-2 text-xs md:text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
                section === key
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-900/10'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
            >
              <Icon size={15} />
              {label}
              {count !== undefined && count > 0 && (
                <span className="ml-1 text-xs bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {section === 'resume' && <ResumeSection data={data} />}
        {section === 'devis' && <LinkableSection dossierId={dossier.id} itemType="devis" items={devis} onRefresh={() => { setLoading(true); getDossier360(dossier.id).then(setData).finally(() => setLoading(false)); }}><DevisSection items={devis} /></LinkableSection>}
        {section === 'projet' && <LinkableSection dossierId={dossier.id} itemType="projet" items={projets} onRefresh={() => { setLoading(true); getDossier360(dossier.id).then(setData).finally(() => setLoading(false)); }}><ProjetSection items={projets} /></LinkableSection>}
        {section === 'bons_travail' && <LinkableSection dossierId={dossier.id} itemType="bon_travail" items={bonsTravail} onRefresh={() => { setLoading(true); getDossier360(dossier.id).then(setData).finally(() => setLoading(false)); }}><BonsTravailSection items={bonsTravail} /></LinkableSection>}
        {section === 'achats' && <LinkableSection dossierId={dossier.id} itemType="bon_commande" items={bonsCommande} onRefresh={() => { setLoading(true); getDossier360(dossier.id).then(setData).finally(() => setLoading(false)); }}><AchatsSection items={bonsCommande} /></LinkableSection>}
        {section === 'demandes_prix' && <LinkableSection dossierId={dossier.id} itemType="demande_prix" items={demandesPrix} onRefresh={() => { setLoading(true); getDossier360(dossier.id).then(setData).finally(() => setLoading(false)); }}><DemandesPrixSection items={demandesPrix} /></LinkableSection>}
        {section === 'factures' && <LinkableSection dossierId={dossier.id} itemType="facture" items={factures} onRefresh={() => { setLoading(true); getDossier360(dossier.id).then(setData).finally(() => setLoading(false)); }}><FacturesSection items={factures} /></LinkableSection>}
        {section === 'pointage' && <PointageSection items={pointage} />}
        {section === 'comptabilite' && <ComptabiliteSection data={comptabilite} />}
        {section === 'documents' && <DocumentsSection dossierId={dossier.id} items={documents} onRefresh={() => { setLoading(true); getDossier360(dossier.id).then(setData).finally(() => setLoading(false)); }} />}
        {section === 'notes' && <NotesSection dossierId={dossier.id} />}
        {section === 'liens' && <LiensSection dossierId={dossier.id} />}
      </div>
    </div>
  );
}

/* =============================================
   RESUME - Vue d'ensemble
   ============================================= */

function ResumeSection({ data }: { data: Dossier360 }) {
  const { opportunite, comptabilite, devis, projets, bonsTravail, factures } = data;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={DollarSign} label="Budget total" value={formatCurrency(comptabilite.budgetTotal)} color="blue" />
        <KpiCard icon={Receipt} label="Facture" value={formatCurrency(comptabilite.totalFacture)} color="green" />
        <KpiCard icon={CheckCircle2} label="Payé" value={formatCurrency(comptabilite.totalPaye)} color="green" />
        <KpiCard icon={AlertCircle} label="Solde dû" value={formatCurrency(comptabilite.totalSoldeDu)} color={comptabilite.totalSoldeDu > 0 ? 'red' : 'gray'} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={ShoppingCart} label="Achats" value={formatCurrency(comptabilite.totalAchats)} color="red" />
        <KpiCard icon={Clock} label="Main d'œuvre" value={formatCurrency(comptabilite.totalCoutMainOeuvre)} color="red" />
        <KpiCard icon={TrendingUp} label="Marge" value={formatCurrency(comptabilite.margeEstimee)} color={comptabilite.margeEstimee >= 0 ? 'green' : 'red'} />
        <KpiCard icon={Wrench} label="BT / BC / DP" value={`${bonsTravail.length} / ${comptabilite.nbBonsCommande} / ${comptabilite.nbDemandesPrix}`} color="gray" />
      </div>

      {/* Opportunity info */}
      {opportunite && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Target size={18} className="text-blue-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Opportunité</h3>
            <Badge color={STATUS_COLORS[opportunite.statut] || 'gray'}>{opportunite.statut}</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-500">Nom:</span> <span className="font-medium">{opportunite.nom}</span></div>
            <div><span className="text-gray-500">Client:</span> <span className="font-medium">{opportunite.companyNom || '--'}</span></div>
            <div><span className="text-gray-500">Montant:</span> <span className="font-medium">{opportunite.montantEstime != null ? formatCurrency(opportunite.montantEstime) : '--'}</span></div>
            <div><span className="text-gray-500">Source:</span> <span className="font-medium">{opportunite.source || '--'}</span></div>
          </div>
        </Card>
      )}

      {/* Timeline / progression */}
      <Card>
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Progression</h3>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <TimelineStep done={!!opportunite} label="Opportunite" detail={opportunite?.numeroOpportunite} />
          <TimelineArrow />
          <TimelineStep done={devis.length > 0} label="Soumission" detail={devis[0]?.numeroDevis} />
          <TimelineArrow />
          <TimelineStep done={projets.length > 0} label="Projet" detail={projets[0]?.statut} />
          <TimelineArrow />
          <TimelineStep done={bonsTravail.length > 0} label="Travaux" detail={`${bonsTravail.length} BT`} />
          <TimelineArrow />
          <TimelineStep done={factures.length > 0} label="Facturation" detail={`${comptabilite.nbFacturesPayees}/${factures.length}`} />
        </div>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color }: { icon: typeof DollarSign; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-[#4A7FA8] bg-[#7BAFD4]/10 dark:text-[#9BC8E4] dark:bg-[#7BAFD4]/20',
    green: 'text-[#4A9475] bg-[#7DC4A5]/10 dark:text-[#9DD4B5] dark:bg-[#7DC4A5]/20',
    red: 'text-[#B8616A] bg-[#E8919A]/10 dark:text-[#E8A1AA] dark:bg-[#E8919A]/20',
    gray: 'text-[#6B7B8A] bg-[#B8C4CE]/10 dark:text-[#B8C4CE] dark:bg-[#B8C4CE]/15',
  };
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className={`p-2 rounded-lg ${colorMap[color] || colorMap.gray}`}><Icon size={18} /></div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-lg font-bold text-gray-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

function TimelineStep({ done, label, detail }: { done: boolean; label: string; detail?: string }) {
  return (
    <div className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg ${done ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
      <div className={`w-3 h-3 rounded-full ${done ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
      <span className={`text-xs font-medium ${done ? 'text-green-700 dark:text-green-400' : 'text-gray-400'}`}>{label}</span>
      {detail && <span className="text-[10px] text-gray-500 font-mono">{detail}</span>}
    </div>
  );
}

function TimelineArrow() {
  return <div className="text-gray-300 dark:text-gray-600 hidden md:block">→</div>;
}

/* =============================================
   LINKABLE SECTION WRAPPER — adds "+ Associer" dropdown
   ============================================= */

function LinkableSection({ dossierId, itemType, items, onRefresh, children }: {
  dossierId: number;
  itemType: LinkableType;
  items: Array<{ id: number; [k: string]: unknown }>;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const [showAssocier, setShowAssocier] = useState(false);
  const [linkableItems, setLinkableItems] = useState<LinkableItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);

  const TYPE_LABELS: Record<string, string> = {
    devis: 'une soumission', projet: 'un projet', bon_travail: 'un bon de travail',
    bon_commande: 'un bon de commande', facture: 'une facture', demande_prix: 'une demande de prix',
  };

  const openAssocier = async () => {
    setShowAssocier(true);
    setLoadingItems(true);
    try {
      const res = await getLinkableItems(dossierId, itemType);
      setLinkableItems(res.items);
    } catch { /* silent */ }
    finally { setLoadingItems(false); }
  };

  const handleLink = async (itemId: number) => {
    setLinking(true);
    try {
      await linkItemToDossier(dossierId, itemType, itemId);
      setShowAssocier(false);
      onRefresh();
    } catch { /* silent */ }
    finally { setLinking(false); }
  };

  const handleUnlink = async (itemId: number) => {
    setUnlinkingId(itemId);
    try {
      await unlinkItemFromDossier(dossierId, itemType, itemId);
      onRefresh();
    } catch { /* silent */ }
    finally { setUnlinkingId(null); }
  };

  return (
    <div className="space-y-3">
      {/* Associer / Retirer buttons */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{items.length} element{items.length !== 1 ? 's' : ''}</span>
        <button
          onClick={showAssocier ? () => setShowAssocier(false) : openAssocier}
          className="text-xs text-seaop-primary-600 hover:text-seaop-primary-700 font-medium flex items-center gap-1"
        >
          {showAssocier ? <><X size={12} /> Fermer</> : <><Plus size={12} /> Associer {TYPE_LABELS[itemType]}</>}
        </button>
      </div>

      {/* Dropdown to select item */}
      {showAssocier && (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50 dark:bg-blue-900/10">
          <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">Sélectionner {TYPE_LABELS[itemType]}</label>
          {loadingItems ? (
            <p className="text-xs text-gray-400">Chargement...</p>
          ) : linkableItems.length === 0 ? (
            <p className="text-xs text-gray-400">Aucun element disponible</p>
          ) : (
            <select
              disabled={linking}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (val) handleLink(val);
              }}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              defaultValue=""
            >
              <option value="">Choisir...</option>
              {linkableItems.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label} {item.statut ? `(${item.statut})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Content (the actual section) */}
      {children}

      {/* Unlink buttons per item */}
      {items.length > 0 && (
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-400 mb-1">Retirer une association:</p>
          <div className="flex flex-wrap gap-1">
            {items.map((item) => (
              <button
                key={item.id}
                disabled={unlinkingId === item.id}
                onClick={() => handleUnlink(item.id)}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-red-600 hover:border-red-300 disabled:opacity-50"
              >
                <Trash2 size={10} />
                #{item.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* =============================================
   DEVIS
   ============================================= */

function DevisSection({ items }: { items: Dossier360['devis'] }) {
  if (items.length === 0) return <EmptyState message="Aucune soumission liee a ce dossier" />;
  return (
    <div className="space-y-3">
      {items.map((d) => (
        <Card key={d.id} padding="sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Link to={`/devis?open=${d.id}`} className="font-mono text-sm text-blue-600 dark:text-blue-400 hover:underline">{d.numeroDevis}</Link>
                <Badge color={STATUS_COLORS[d.statut] || 'gray'}>{d.statut}</Badge>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{d.nomProjet || '--'}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {d.investissementTotal != null ? formatCurrency(d.investissementTotal) : '--'}
              </p>
              <p className="text-xs text-gray-400">{formatDate(d.createdAt)}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* =============================================
   PROJET
   ============================================= */

function ProjetSection({ items }: { items: Dossier360['projets'] }) {
  if (items.length === 0) return <EmptyState message="Aucun projet lie a ce dossier" />;
  return (
    <div className="space-y-3">
      {items.map((p) => (
        <Card key={p.id} padding="sm">
          <div className="flex items-center justify-between">
            <div>
              <Link to={`/projets?open=${p.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{p.nomProjet}</Link>
              <div className="flex items-center gap-2 mt-1">
                <Badge color={STATUS_COLORS[p.statut] || 'gray'}>{p.statut}</Badge>
                {p.priorite && <span className="text-xs text-gray-500">{p.priorite}</span>}
              </div>
            </div>
            <div className="text-right text-sm">
              {p.budgetTotal != null && (
                <p className="font-bold text-gray-900 dark:text-white">{formatCurrency(p.budgetTotal)}</p>
              )}
              <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                <Calendar size={12} />
                {p.dateDebutReel ? formatDate(p.dateDebutReel) : '--'}
                {' → '}
                {p.dateFinReel ? formatDate(p.dateFinReel) : (p.datePrevu ? formatDate(p.datePrevu) : '...')}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* =============================================
   BONS DE TRAVAIL
   ============================================= */

function BonsTravailSection({ items }: { items: Dossier360['bonsTravail'] }) {
  if (items.length === 0) return <EmptyState message="Aucun bon de travail" />;
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">No.</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Priorité</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Échéance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((bt) => (
              <tr key={bt.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                <td className="px-4 py-3 font-mono"><Link to={`/bons-travail?open=${bt.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{bt.numeroDocument}</Link></td>
                <td className="px-4 py-3 text-gray-900 dark:text-white">{bt.nom || '--'}</td>
                <td className="px-4 py-3"><Badge color={STATUS_COLORS[bt.statut] || 'gray'}>{bt.statut}</Badge></td>
                <td className="px-4 py-3 text-gray-500">{bt.priorite || '--'}</td>
                <td className="px-4 py-3 text-right font-medium">{bt.montantTotal != null ? formatCurrency(bt.montantTotal) : '--'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(bt.dateEcheance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {items.map((bt) => (
          <div key={bt.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <Link to={`/bons-travail?open=${bt.id}`} className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline">{bt.numeroDocument}</Link>
              <Badge color={STATUS_COLORS[bt.statut] || 'gray'} size="sm">{bt.statut}</Badge>
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{bt.nom || '--'}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {bt.montantTotal != null && <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(bt.montantTotal)}</span>}
              {bt.priorite && <span>{bt.priorite}</span>}
              {bt.dateEcheance && <span className="flex items-center gap-1"><Calendar size={10} /> {formatDate(bt.dateEcheance)}</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* =============================================
   FACTURES
   ============================================= */

function FacturesSection({ items }: { items: Dossier360['factures'] }) {
  if (items.length === 0) return <EmptyState message="Aucune facture" />;
  return (
    <>
    {/* Desktop table */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">No.</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Client</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant TTC</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Payé</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Solde du</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((f) => (
            <tr key={f.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
              <td className="px-4 py-3 font-mono"><Link to={`/comptabilite?open=${f.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{f.numeroFacture}</Link></td>
              <td className="px-4 py-3 text-gray-900 dark:text-white">{f.clientNom || '--'}</td>
              <td className="px-4 py-3"><Badge color={STATUS_COLORS[f.statut] || 'gray'}>{f.statut}</Badge></td>
              <td className="px-4 py-3 text-right font-medium">{f.montantTtc != null ? formatCurrency(f.montantTtc) : '--'}</td>
              <td className="px-4 py-3 text-right text-green-600">{f.montantPaye != null ? formatCurrency(f.montantPaye) : '--'}</td>
              <td className="px-4 py-3 text-right text-red-600 font-medium">{f.soldeDu != null && f.soldeDu > 0 ? formatCurrency(f.soldeDu) : '--'}</td>
              <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(f.dateFacture)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {/* Mobile cards */}
    <div className="md:hidden space-y-2">
      {items.map((f) => (
        <div key={f.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1.5">
            <Link to={`/comptabilite?open=${f.id}`} className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline">{f.numeroFacture}</Link>
            <Badge color={STATUS_COLORS[f.statut] || 'gray'} size="sm">{f.statut}</Badge>
          </div>
          <p className="text-sm text-gray-900 dark:text-white">{f.clientNom || '--'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-xs">
            <div>
              <span className="text-gray-500 block">TTC</span>
              <span className="font-medium text-gray-900 dark:text-white">{f.montantTtc != null ? formatCurrency(f.montantTtc) : '--'}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Payé</span>
              <span className="font-medium text-green-600">{f.montantPaye != null ? formatCurrency(f.montantPaye) : '--'}</span>
            </div>
            <div className="text-right">
              <span className="text-gray-500 block">Solde</span>
              <span className="font-medium text-red-600">{f.soldeDu != null && f.soldeDu > 0 ? formatCurrency(f.soldeDu) : '--'}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
    </>
  );
}

/* =============================================
   POINTAGE
   ============================================= */

function PointageSection({ items }: { items: Dossier360['pointage'] }) {
  if (items.length === 0) return <EmptyState message="Aucune entrée de pointage" />;

  const byEmployee = new Map<number, { prenom: string; nom: string; heures: number; cout: number; entries: number }>();
  for (const p of items) {
    const key = p.employeeId;
    const existing = byEmployee.get(key) || { prenom: p.prenom || '', nom: p.nom || '', heures: 0, cout: 0, entries: 0 };
    existing.heures += p.totalHours || 0;
    existing.cout += p.totalCost || 0;
    existing.entries += 1;
    byEmployee.set(key, existing);
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Sommaire par employé</h3>
        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Employé</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500">Heures</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500">Coût</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500">Entrées</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {Array.from(byEmployee.values()).map((emp, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 text-gray-900 dark:text-white">{emp.prenom} {emp.nom}</td>
                  <td className="px-4 py-2 text-right">{(emp.heures ?? 0).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(emp.cout)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{emp.entries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {Array.from(byEmployee.values()).map((emp, i) => (
            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{emp.prenom} {emp.nom}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                <span>{(emp.heures ?? 0).toFixed(1)}h</span>
                <span>{formatCurrency(emp.cout)}</span>
                <span>{emp.entries} entrees</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Entrées récentes</h3>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Employé</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Entree</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Sortie</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500">Heures</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.slice(0, 20).map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-gray-900 dark:text-white">{p.prenom} {p.nom}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{p.punchIn ? formatDate(p.punchIn) : '--'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{p.punchOut ? formatDate(p.punchOut) : '--'}</td>
                  <td className="px-4 py-2 text-right">{p.totalHours != null ? `${(p.totalHours ?? 0).toFixed(1)}h` : '--'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{p.typeTravail || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {items.slice(0, 20).map((p) => (
            <div key={p.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{p.prenom} {p.nom}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                <span>{p.totalHours != null ? `${(p.totalHours ?? 0).toFixed(1)}h` : '--'}</span>
                {p.typeTravail && <span>{p.typeTravail}</span>}
                <span>{p.punchIn ? formatDate(p.punchIn) : '--'}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* =============================================
   COMPTABILITE
   ============================================= */

function ComptabiliteSection({ data }: { data: Dossier360['comptabilite'] }) {
  const margePercent = data.totalFacture > 0
    ? ((data.margeEstimee / data.totalFacture) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold text-green-700 dark:text-green-400 mb-4 flex items-center gap-2">
            <TrendingUp size={18} /> Revenus
          </h3>
          <div className="space-y-3">
            <CompRow label="Budget total (devis)" value={formatCurrency(data.budgetTotal)} />
            <CompRow label="Total facturé" value={formatCurrency(data.totalFacture)} />
            <CompRow label="Total payé" value={formatCurrency(data.totalPaye)} highlight="green" />
            <CompRow label="Solde dû (à recevoir)" value={formatCurrency(data.totalSoldeDu)} highlight={data.totalSoldeDu > 0 ? 'red' : undefined} />
            <hr className="border-gray-200 dark:border-gray-700" />
            <CompRow label="Factures payées" value={`${data.nbFacturesPayees} / ${data.nbFactures}`} />
            {data.nbFacturesEnRetard > 0 && (
              <CompRow label="Factures en retard" value={String(data.nbFacturesEnRetard)} highlight="red" />
            )}
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-red-700 dark:text-red-400 mb-4 flex items-center gap-2">
            <DollarSign size={18} /> Coûts & Marge
          </h3>
          <div className="space-y-3">
            <CompRow label="Heures travaillées" value={`${data.totalHeures}h`} />
            <CompRow label="Coût main d'œuvre" value={formatCurrency(data.totalCoutMainOeuvre)} highlight="red" />
            <CompRow label="Achats / matériaux" value={formatCurrency(data.totalAchats)} highlight="red" />
            <hr className="border-gray-200 dark:border-gray-700" />
            <CompRow label="Total couts" value={formatCurrency(data.totalCouts)} highlight="red" />
            <CompRow label="Marge estimee" value={formatCurrency(data.margeEstimee)} highlight={data.margeEstimee >= 0 ? 'green' : 'red'} />
            <CompRow label="% marge" value={`${margePercent}%`} highlight={Number(margePercent) >= 0 ? 'green' : 'red'} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function CompRow({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  const colorClass = highlight === 'green' ? 'text-green-600 dark:text-green-400 font-bold'
    : highlight === 'red' ? 'text-red-600 dark:text-red-400 font-bold'
    : 'text-gray-900 dark:text-white font-medium';
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm ${colorClass}`}>{value}</span>
    </div>
  );
}

/* =============================================
   DOCUMENTS
   ============================================= */

function DocumentsSection({ dossierId, items, onRefresh }: { dossierId: number; items: Dossier360['documents']; onRefresh: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadFileIndex, setUploadFileIndex] = useState<[number, number]>([0, 0]);

  // Inline preview state — opens DocumentViewer modal when set
  const [previewDoc, setPreviewDoc] = useState<
    { id: number; name: string; contentType?: string } | null
  >(null);

  // Share state
  const [shareOpen, setShareOpen] = useState(false);
  const [shareInfo, setShareInfoState] = useState<ShareInfo | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const refreshShareInfo = async () => {
    try {
      const info = await getShareInfo(dossierId);
      setShareInfoState(info);
    } catch {
      setShareInfoState({ active: false });
    }
  };

  useEffect(() => {
    if (shareOpen) refreshShareInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareOpen, dossierId]);

  const handleGenerateShare = async () => {
    if (shareLoading) return; // Guard against double-click races
    setShareLoading(true);
    try {
      await generateShareLink(dossierId);
      await refreshShareInfo();
    } catch {
      setError('Erreur lors de la génération du lien');
    } finally {
      setShareLoading(false);
    }
  };

  const handleRevokeShare = async () => {
    if (shareLoading) return;
    if (!confirm('Révoquer ce lien? Le sous-traitant ne pourra plus accéder aux documents.')) return;
    setShareLoading(true);
    try {
      await revokeShareLink(dossierId);
      await refreshShareInfo();
    } catch {
      setError('Erreur lors de la révocation');
    } finally {
      setShareLoading(false);
    }
  };

  const publicUrl = shareInfo?.token
    ? `${window.location.origin}/dossiers/public/${shareInfo.token}`
    : '';

  const handleCopyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API may be blocked */
    }
  };

  const formatDateTime = (iso?: string) => {
    if (!iso) return 'Jamais';
    try {
      return new Date(iso).toLocaleString('fr-CA', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    setUploadProgress(0);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadFileName(file.name);
      setUploadFileIndex([i + 1, files.length]);
      setUploadProgress(0);
      try {
        await uploadAttachment(dossierId, file, (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
      } catch (err: unknown) {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(detail || 'Erreur lors du telechargement');
      }
    }
    onRefresh();
    setUploading(false);
    setUploadProgress(0);
    setUploadFileName('');
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) uploadFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  const handleDownload = async (docId: number, filename: string) => {
    try {
      const res = await downloadAttachment(dossierId, docId);
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      // Firefox / Safari legacy require the anchor to be attached to the DOM
      // before .click() takes effect, AND they can abort the download if the
      // blob URL is revoked synchronously — deferring the revoke by ~1s lets
      // the browser capture the resource first. Pattern kept in sync with
      // DocumentViewer.tsx::handleDownload.
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Erreur lors du telechargement');
    }
  };

  const handleDelete = async (docId: number) => {
    if (!confirm('Supprimer ce document?')) return;
    try {
      await deleteAttachment(dossierId, docId);
      onRefresh();
    } catch {
      setError('Erreur lors de la suppression');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{items.length} document{items.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            title="Partager les documents avec un sous-traitant"
          >
            <Share2 size={14} />
            Partager
          </button>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
            <Upload size={14} />
            {uploading ? 'Envoi...' : 'Ajouter un document'}
            <input
              type="file"
              className="hidden"
              multiple
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Share modal */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShareOpen(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Share2 size={16} className="text-blue-500" />
                Partager les documents
              </h3>
              <button onClick={() => setShareOpen(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {!shareInfo ? (
                <p className="text-sm text-gray-500">Chargement...</p>
              ) : !shareInfo.active ? (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Génère un lien sécurisé que tu peux envoyer à un sous-traitant. Le lien est valide 90 jours et permet la consultation et le téléchargement des documents (lecture seule).
                  </p>
                  <button
                    type="button"
                    onClick={handleGenerateShare}
                    disabled={shareLoading}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <Link2 size={14} />
                    {shareLoading ? 'Génération...' : 'Générer un lien de partage'}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      Lien à partager
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={publicUrl}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        className="erp-input flex-1 text-sm font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors shrink-0"
                      >
                        <Copy size={13} />
                        {copied ? 'Copié!' : 'Copier'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Statistiques
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                        <p className="text-[11px] text-gray-500 uppercase tracking-wider">Consultations</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{shareInfo.totalViews ?? 0}</p>
                        <p className="text-[11px] text-gray-400 mt-1">Dernière: {formatDateTime(shareInfo.lastViewedAt)}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                        <p className="text-[11px] text-gray-500 uppercase tracking-wider">Téléchargements</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{shareInfo.totalDownloads ?? 0}</p>
                        <p className="text-[11px] text-gray-400 mt-1">Dernier: {formatDateTime(shareInfo.lastDownloadedAt)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-gray-500 flex justify-between">
                    <span>Créé: {formatDateTime(shareInfo.createdAt)}</span>
                    <span>Expire: {formatDateTime(shareInfo.expiresAt)}</span>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                    <button
                      type="button"
                      onClick={handleGenerateShare}
                      disabled={shareLoading}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Link2 size={13} />
                      Régénérer
                    </button>
                    <button
                      type="button"
                      onClick={handleRevokeShare}
                      disabled={shareLoading}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 text-sm rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                      Révoquer
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative rounded-xl border-2 border-dashed transition-colors min-h-[200px] ${
          dragOver
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-200 dark:border-gray-700'
        }`}
      >
        {uploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 dark:bg-gray-900/90 rounded-xl z-10 px-8">
            <Spinner size="sm" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-3 truncate max-w-full">{uploadFileName}</p>
            {uploadFileIndex[1] > 1 && (
              <p className="text-xs text-gray-400 mt-0.5">Fichier {uploadFileIndex[0]} / {uploadFileIndex[1]}</p>
            )}
            <div className="w-full max-w-xs mt-3 bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1.5">{uploadProgress}%</p>
          </div>
        )}
        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-50/90 dark:bg-blue-900/40 rounded-xl z-10">
            <div className="text-center">
              <Upload size={32} className="mx-auto text-blue-500 mb-2" />
              <p className="text-sm font-medium text-blue-600">Deposer ici</p>
            </div>
          </div>
        )}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <FolderOpen size={40} className="mb-3" />
            <p className="text-sm">Aucun document attache</p>
            <p className="text-xs mt-1">Glissez-deposez des fichiers ici ou utilisez le bouton ci-dessus</p>
          </div>
        ) : (
          <div className="space-y-2 p-3">
            {items.map((doc) => {
              const canPreview = doc.source === 'attachments';
              const openPreview = () =>
                canPreview &&
                setPreviewDoc({ id: doc.id, name: doc.nomFichier, contentType: undefined });
              return (
                <Card key={`${doc.source || 'doc'}-${doc.id}`} padding="sm">
                  <div className="flex items-center gap-3">
                    <Paperclip size={16} className="text-gray-400" />
                    <div className="flex-1 min-w-0">
                      {canPreview ? (
                        <button
                          type="button"
                          onClick={openPreview}
                          className="text-left text-sm font-medium text-gray-900 dark:text-white truncate hover:text-seaop-primary-600 hover:underline w-full"
                          title="Cliquer pour afficher un aperçu"
                        >
                          {doc.nomFichier}
                        </button>
                      ) : (
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{doc.nomFichier}</p>
                      )}
                      <div className="flex gap-3 text-xs text-gray-400">
                        {doc.categorie && <span>{doc.categorie}</span>}
                        {doc.taille && <span>{(doc.taille / 1024).toFixed(0)} Ko</span>}
                        {doc.createdAt && <span>{formatDate(doc.createdAt)}</span>}
                      </div>
                    </div>
                    {canPreview && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={openPreview}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-seaop-primary-600"
                          title="Aperçu"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => handleDownload(doc.id, doc.nomFichier)}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-blue-600"
                          title="Télécharger"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-red-600"
                          title="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {previewDoc && (
        <DocumentViewer
          dossierId={dossierId}
          attId={previewDoc.id}
          fileName={previewDoc.name}
          contentType={previewDoc.contentType}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  );
}

/* =============================================
   ACHATS (Bons de commande)
   ============================================= */

function AchatsSection({ items }: { items: Dossier360['bonsCommande'] }) {
  if (items.length === 0) return <EmptyState message="Aucun bon de commande" />;
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">No.</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fournisseur</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Commande</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Livraison prévue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((bc) => (
              <tr key={bc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                <td className="px-4 py-3 font-mono"><Link to={`/magasin?open=${bc.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{bc.numero}</Link></td>
                <td className="px-4 py-3 text-gray-900 dark:text-white">{bc.fournisseurNom || '--'}</td>
                <td className="px-4 py-3"><Badge color={STATUS_COLORS[bc.statut] || 'gray'}>{bc.statut}</Badge></td>
                <td className="px-4 py-3 text-right font-medium">{bc.total != null ? formatCurrency(bc.total) : (bc.montantTotal != null ? formatCurrency(bc.montantTotal) : '--')}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(bc.dateCommande)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(bc.dateLivraisonPrevue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {items.map((bc) => (
          <div key={bc.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <Link to={`/magasin?open=${bc.id}`} className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline">{bc.numero}</Link>
              <Badge color={STATUS_COLORS[bc.statut] || 'gray'} size="sm">{bc.statut}</Badge>
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{bc.fournisseurNom || '--'}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {(bc.total != null || bc.montantTotal != null) && <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(bc.total ?? bc.montantTotal ?? 0)}</span>}
              {bc.dateCommande && <span className="flex items-center gap-1"><Calendar size={10} /> {formatDate(bc.dateCommande)}</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* =============================================
   DEMANDES DE PRIX
   ============================================= */

function DemandesPrixSection({ items }: { items: Dossier360['demandesPrix'] }) {
  if (items.length === 0) return <EmptyState message="Aucune demande de prix" />;
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">No.</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Priorité</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Montant</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Échéance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((dp) => (
              <tr key={dp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                <td className="px-4 py-3 font-mono"><span className="text-blue-600 dark:text-blue-400">{dp.numeroDocument}</span></td>
                <td className="px-4 py-3 text-gray-900 dark:text-white">{dp.nom || '--'}</td>
                <td className="px-4 py-3"><Badge color={STATUS_COLORS[dp.statut] || 'gray'}>{dp.statut}</Badge></td>
                <td className="px-4 py-3 text-gray-500">{dp.priorite || '--'}</td>
                <td className="px-4 py-3 text-right font-medium">{dp.montantTotal != null ? formatCurrency(dp.montantTotal) : '--'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(dp.dateEcheance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {items.map((dp) => (
          <div key={dp.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <Link to={`/bons-travail?open=${dp.id}`} className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline">{dp.numeroDocument}</Link>
              <Badge color={STATUS_COLORS[dp.statut] || 'gray'} size="sm">{dp.statut}</Badge>
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{dp.nom || '--'}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {dp.montantTotal != null && <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(dp.montantTotal)}</span>}
              {dp.priorite && <span>{dp.priorite}</span>}
              {dp.dateEcheance && <span className="flex items-center gap-1"><Calendar size={10} /> {formatDate(dp.dateEcheance)}</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* =============================================
   NOTES
   ============================================= */

function NoteImagePreview({ dossierId, noteId, attIndex, att, onView }: {
  dossierId: number; noteId: number; attIndex: number; att: NoteAttachment;
  onView: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    downloadNoteAttachment(dossierId, noteId, attIndex)
      .then((res) => {
        if (cancelled) return;
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
        setUrl(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dossierId, noteId, attIndex]);

  // Revoke blob URL on unmount or when URL changes to prevent memory leak
  useEffect(() => {
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [url]);

  if (!url) {
    return <div className="w-32 h-24 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />;
  }

  return (
    <img
      src={url}
      alt={att.nom}
      className="max-h-48 max-w-xs rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 hover:opacity-90 hover:shadow-md transition-all object-cover"
      title={`${att.nom} — Cliquer pour agrandir`}
      onClick={() => onView(url, att.nom)}
    />
  );
}

/** Audio player for note attachments — lazy-loads audio blob on first play */
function NoteAudioPlayer({ dossierId, noteId, attIndex, att }: { dossierId: number; noteId: number; attIndex: number; att: NoteAttachment }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Cleanup objectURL on unmount to prevent memory leaks
  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); };
  }, [audioUrl]);

  const loadAudio = async () => {
    if (audioUrl) return;
    setLoading(true);
    try {
      const res = await downloadNoteAttachment(dossierId, noteId, attIndex);
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: att.type });
      setAudioUrl(URL.createObjectURL(blob));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <Mic size={14} className="text-gray-400 shrink-0" />
      {audioUrl ? (
        <audio controls src={audioUrl} className="h-8 flex-1 min-w-0" style={{ maxWidth: 300 }} />
      ) : (
        <button
          onClick={loadAudio}
          disabled={loading}
          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
        >
          {loading ? 'Chargement...' : `Ecouter (${att.nom})`}
        </button>
      )}
      <span className="text-[10px] text-gray-400 shrink-0">
        {att.taille < 1048576 ? `${(att.taille / 1024).toFixed(0)} Ko` : `${(att.taille / 1048576).toFixed(1)} Mo`}
      </span>
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  defaut: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  observation: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  progression: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  decision: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  action: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  general: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};

function NotesSection({ dossierId }: { dossierId: number }) {
  const [notes, setNotes] = useState<DossierNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [contenu, setContenu] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  // AI state
  const [enriching, setEnriching] = useState(false);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [aiActions, setAiActions] = useState<string[]>([]);
  const [summary, setSummary] = useState<NoteAiSummaryResult | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const fetchNotes = async () => {
    try {
      const res = await getDossierNotes(dossierId);
      setNotes(res.items || []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors du chargement des notes');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchNotes(); }, [dossierId]);

  const handleSubmit = async () => {
    if (!contenu.trim() && files.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const text = contenu.trim() || (files.some(f => f.type.startsWith('audio/')) ? '[Note audio]' : '[Fichier joint]');
      await createDossierNoteWithFiles(dossierId, text, files);
      setContenu('');
      setFiles([]);
      fetchNotes();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la création de la note');
    } finally { setSaving(false); }
  };

  const handleDelete = async (noteId: number) => {
    if (!confirm('Supprimer cette note?')) return;
    try {
      await deleteDossierNote(dossierId, noteId);
      fetchNotes();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la suppression');
    }
  };

  // AI handlers
  const handleEnrich = async () => {
    if (!contenu.trim()) return;
    setEnriching(true);
    setError(null);
    try {
      const res = await aiEnrichNote(dossierId, contenu.trim());
      setContenu(res.contenuEnrichi);
      setAiActions(res.actions || []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur enrichissement IA');
    } finally { setEnriching(false); }
  };

  const handleAnalyzePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setAnalyzingPhoto(true);
    setError(null);
    try {
      const res = await aiAnalyzePhoto(dossierId, file);
      setContenu(res.contenuEnrichi);
      setAiActions(res.actions || []);
      // Also add the photo to files for attachment
      setFiles((prev) => [...prev, file]);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur analyse photo IA');
    } finally { setAnalyzingPhoto(false); }
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    setError(null);
    try {
      const res = await aiSummarizeNotes(dossierId);
      setSummary(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur resume IA');
    } finally { setSummarizing(false); }
  };

  const handleTogglePin = async (noteId: number) => {
    try {
      await toggleNotePin(dossierId, noteId);
      fetchNotes();
    } catch { /* silent */ }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...newFiles]);
    }
    e.target.value = ''; // reset so re-selecting same file triggers onChange
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  // --- Audio recording ---
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup recording on unmount (stop recorder first, then mic stream + timer)
  const abortRecordingRef = useRef(false);
  useEffect(() => {
    return () => {
      abortRecordingRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop(); // stop recorder first (flushes buffer)
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const startRecording = async () => {
    if (isRecording) return; // guard against double-click race condition
    setIsRecording(true); // set BEFORE await to prevent re-entry
    abortRecordingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // If user clicked stop or navigated away during the permission dialog, abort
      if (abortRecordingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        return;
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        const ext = recorder.mimeType.includes('webm') ? 'webm' : recorder.mimeType.includes('mp4') ? 'm4a' : 'ogg';
        const file = new File([blob], `note-audio-${Date.now()}.${ext}`, { type: recorder.mimeType });
        setFiles((prev) => [...prev, file]);
        if (timerRef.current) clearInterval(timerRef.current);
        setRecordingDuration(0);
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      setIsRecording(false); // reset on failure
      setError('Impossible d\'acceder au microphone');
    }
  };

  const stopRecording = () => {
    abortRecordingRef.current = true; // cancel pending getUserMedia if still awaiting
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / 1048576).toFixed(1)} Mo`;
  };

  return (
    <div className="space-y-4">
      {/* New note form */}
      <Card padding="sm">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Ajouter une note</h4>
        {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
        <textarea
          value={contenu}
          onChange={(e) => setContenu(e.target.value)}
          placeholder="Ecrivez votre note, commentaire..."
          rows={3}
          className="erp-input text-sm w-full mb-2"
        />
        {/* AI actions extracted */}
        {aiActions.length > 0 && (
          <div className="mb-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Actions identifiees par l'IA:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {aiActions.map((a, i) => <li key={i} className="text-xs text-amber-600 dark:text-amber-300">{a}</li>)}
            </ul>
          </div>
        )}
        {/* AI buttons row */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button
            onClick={handleEnrich}
            disabled={!contenu.trim() || enriching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/40 disabled:opacity-40"
            title="Enrichir avec l'IA"
          >
            <Sparkles size={14} />
            {enriching ? 'Enrichissement...' : 'Enrichir avec IA'}
          </button>
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={analyzingPhoto}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-40"
            title="Analyser une photo avec l'IA"
          >
            <ImageIcon size={14} />
            {analyzingPhoto ? 'Analyse...' : 'Analyser photo IA'}
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handleAnalyzePhoto} />
          <button
            onClick={handleSummarize}
            disabled={summarizing || notes.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/40 disabled:opacity-40"
            title="Résumé IA de toutes les notes"
          >
            <Bot size={14} />
            {summarizing ? 'Résumé en cours...' : 'Résumé IA du dossier'}
          </button>
        </div>
        {/* File attachments */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700">
            <Paperclip size={14} />
            Joindre fichier(s)
            <input type="file" multiple onChange={handleFileChange} className="hidden" accept="*/*" />
          </label>
          {/* Audio recording button */}
          {isRecording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 animate-pulse"
            >
              <Square size={12} fill="currentColor" />
              {Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <Mic size={14} />
              Note audio
            </button>
          )}
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded">
              {f.name} ({formatFileSize(f.size)})
              <button onClick={() => removeFile(i)} className="text-blue-500 hover:text-red-500"><X size={12} /></button>
            </span>
          ))}
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving || (!contenu.trim() && files.length === 0)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Enregistrement...' : 'Ajouter la note'}
        </button>
      </Card>

      {/* AI Summary panel */}
      {summary && (
        <Card padding="sm">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-teal-700 dark:text-teal-400 flex items-center gap-2">
              <Bot size={14} /> Résumé IA ({summary.nbNotesAnalysees} notes analysées)
            </h4>
            <button onClick={() => setSummary(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>
          <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap mb-3">{summary.resume}</p>
          {summary.problemesOuverts.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">Problemes ouverts:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {summary.problemesOuverts.map((p, i) => <li key={i} className="text-xs text-red-500 dark:text-red-300">{p}</li>)}
              </ul>
            </div>
          )}
          {summary.actionsEnAttente.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-orange-600 dark:text-orange-400 mb-1">Actions en attente:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {summary.actionsEnAttente.map((a, i) => <li key={i} className="text-xs text-orange-500 dark:text-orange-300">{a}</li>)}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Notes list */}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : notes.length === 0 ? (
        <EmptyState message="Aucune note pour ce dossier" />
      ) : (
        <div className="space-y-3">
          {notes.map((note) => {
            const cat = note.categorie || 'general';
            const isPinned = note.isPinned || false;
            return (
            <Card key={note.id} padding="sm" className={isPinned ? 'border-l-4 border-l-blue-500' : ''}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5 flex-wrap">
                    {note.createdBy && <span className="font-medium text-gray-700 dark:text-gray-300">{note.createdBy}</span>}
                    {note.createdAt && <span>{formatDate(note.createdAt)}</span>}
                    {cat !== 'general' && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.general}`}>
                        {cat}
                      </span>
                    )}
                    {isPinned && <Pin size={12} className="text-blue-500" />}
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{note.contenu}</p>
                  {/* Attachments: images inline, others as download buttons */}
                  {note.attachments && note.attachments.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {note.attachments.some(a => a.type?.startsWith('image/')) && (
                        <div className="flex flex-wrap gap-3">
                          {note.attachments.map((att, idx) =>
                            att.type?.startsWith('image/') ? (
                              <NoteImagePreview
                                key={idx}
                                dossierId={dossierId}
                                noteId={note.id}
                                attIndex={idx}
                                att={att}
                                onView={(url, name) => setLightbox({ url, name })}
                              />
                            ) : null
                          )}
                        </div>
                      )}
                      {/* Audio attachments: inline player */}
                      {note.attachments.some(a => a.type?.startsWith('audio/')) && (
                        <div className="space-y-2">
                          {note.attachments.map((att, idx) =>
                            att.type?.startsWith('audio/') ? (
                              <NoteAudioPlayer key={idx} dossierId={dossierId} noteId={note.id} attIndex={idx} att={att} />
                            ) : null
                          )}
                        </div>
                      )}
                      {/* Other non-image, non-audio attachments: download buttons */}
                      {note.attachments.some(a => !a.type?.startsWith('image/') && !a.type?.startsWith('audio/')) && (
                        <div className="flex flex-wrap gap-2">
                          {note.attachments.map((att, idx) =>
                            !att.type?.startsWith('image/') && !att.type?.startsWith('audio/') ? (
                              <button
                                key={idx}
                                onClick={async () => {
                                  try {
                                    const res = await downloadNoteAttachment(dossierId, note.id, idx);
                                    const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = att.nom;
                                    a.click();
                                    window.URL.revokeObjectURL(url);
                                  } catch { /* ignore */ }
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
                              >
                                <Download size={12} />
                                {att.nom} <span className="text-gray-400">({formatFileSize(att.taille)})</span>
                              </button>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleTogglePin(note.id)}
                    className={`p-1.5 rounded transition-colors ${isPinned ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
                    title={isPinned ? 'Desepingler' : 'Epingler'}
                  >
                    <Pin size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Supprimer la note"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      )}

      {/* Lightbox for full-size image viewing */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white z-10" onClick={() => setLightbox(null)}>
            <X size={28} />
          </button>
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.name} className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg" />
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-black/60 text-white text-sm px-3 py-2 rounded-b-lg">
              <span>{lightbox.name}</span>
              <button
                onClick={() => { const a = document.createElement('a'); a.href = lightbox!.url; a.download = lightbox!.name; a.click(); }}
                className="flex items-center gap-1 hover:text-blue-300"
              >
                <Download size={14} /> Télécharger
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* =============================================
   EMPTY STATE
   ============================================= */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <FolderOpen size={48} strokeWidth={1} />
      <p className="mt-3 text-sm">{message}</p>
    </div>
  );
}


/* =============================================
   LIENS - Liens cliquables
   ============================================= */

function LiensSection({ dossierId }: { dossierId: number }) {
  const [liens, setLiens] = useState<DossierLien[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Ref synchrone pour bloquer les doubles soumissions meme avant que React
  // ait propage le state (window de 16ms entre click et render).
  const mutationInFlightRef = useRef(false);
  // Ref de unmount : evite les setState warnings si une requete en vol
  // resout apres que le composant soit demonte (changement de dossier
  // pendant une mutation, navigation rapide, etc.).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchLiens = async () => {
    setLoading(true);
    try {
      const res = await getDossierLiens(dossierId);
      if (!isMountedRef.current) return;
      setLiens(res.items || []);
      setError(null);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setError(err?.response?.data?.detail || 'Erreur lors du chargement des liens');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  // Strict : schema http(s) + aucun whitespace (interne ni bordure). Aligne
  // avec le backend qui rejette \r \n \0 dans l'URL.
  const isValidUrl = (value: string) => {
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return false;
    if (/\s/.test(trimmed)) return false;
    return true;
  };
  // Compte les code points Unicode (1 par emoji) pour matcher Pydantic
  // max_length=1000 cote backend. Sans ca, 500 emojis s'afficheraient comme
  // "1000/1000" mais le backend ne verrait que 500 chars Python -> OK.
  // Le vrai risque inverse: un emoji compose (ex. drapeau 🇫🇷 = 2 code points)
  // pourrait depasser maxLength DOM (1000 UTF-16 units) sans atteindre 1000
  // code points. On prend le max des deux pour etre safe.
  const codePointLength = (s: string) => [...s].length;

  const handleCreate = async () => {
    if (mutationInFlightRef.current) return;
    const cleanUrl = url.trim();
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
        description: description.trim() || undefined,
      });
      setUrl('');
      setDescription('');
      await fetchLiens();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la creation du lien');
    } finally {
      setSubmitting(false);
      mutationInFlightRef.current = false;
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
    // Clear toute erreur restante pour ne pas afficher le message d'une
    // tentative precedente apres que l'utilisateur ait abandonne.
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
        description: editDescription.trim(),
      });
      await fetchLiens();
      // Ne fermer l'edition qu'apres succes complet (update + refetch)
      // pour eviter un flash de state stale si refetch echoue.
      setEditingId(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la mise a jour');
    } finally {
      setSavingEdit(false);
      mutationInFlightRef.current = false;
    }
  };

  const handleDelete = async (lienId: number) => {
    if (mutationInFlightRef.current) return;
    if (!confirm('Supprimer ce lien ?')) return;
    mutationInFlightRef.current = true;
    setDeletingId(lienId);
    setError(null);
    try {
      await deleteDossierLien(dossierId, lienId);
      await fetchLiens();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
      mutationInFlightRef.current = false;
    }
  };

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Formulaire ajout */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Plus size={16} /> Ajouter un lien
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://exemple.com/document"
              maxLength={2048}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={submitting}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description (optionnel)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Courte description du lien"
              rows={2}
              maxLength={1000}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-gray-400 text-right">{codePointLength(description)}/1000</p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting || !url.trim() || !isValidUrl(url)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} /> {submitting ? 'Ajout...' : 'Ajouter le lien'}
            </button>
          </div>
        </div>
      </Card>

      {/* Liste liens */}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : liens.length === 0 ? (
        <Card className="p-8">
          <div className="flex flex-col items-center justify-center text-gray-400">
            <Link2 size={48} strokeWidth={1} />
            <p className="mt-3 text-sm">Aucun lien ajoute</p>
            <p className="text-xs mt-1">Collez une URL ci-dessus pour commencer</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{liens.length} lien{liens.length > 1 ? 's' : ''}</p>
          {liens.map((lien) => {
            const isEditing = editingId === lien.id;
            return (
              <Card key={lien.id} className="p-4">
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">URL *</label>
                      <input
                        type="url"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        maxLength={2048}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={savingEdit}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        maxLength={1000}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        disabled={savingEdit}
                      />
                      <p className="mt-1 text-xs text-gray-400 text-right">{codePointLength(editDescription)}/1000</p>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={savingEdit}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X size={14} /> Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(lien.id)}
                        disabled={savingEdit || !editUrl.trim() || !isValidUrl(editUrl)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check size={14} /> {savingEdit ? 'Sauvegarde...' : 'Sauvegarder'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <a
                        href={lien.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline break-all"
                      >
                        <ExternalLink size={14} className="flex-shrink-0" />
                        <span className="break-all">{lien.url}</span>
                      </a>
                      {lien.description && (
                        <p className="mt-1.5 text-sm text-gray-700 whitespace-pre-wrap break-words">
                          {lien.description}
                        </p>
                      )}
                      {lien.createdAt && (
                        <p className="mt-2 text-xs text-gray-400">
                          Ajoute le {formatDate(lien.createdAt)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(lien)}
                        disabled={deletingId !== null || submitting || savingEdit}
                        title="Modifier"
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(lien.id)}
                        disabled={deletingId !== null || submitting || savingEdit}
                        title="Supprimer"
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
