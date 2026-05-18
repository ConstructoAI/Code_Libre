/**
 * Mobile React Frontend - Document Form Page
 * Create or edit a document (devis, facture, BT, BC).
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { useDocumentsStore } from '@/store/useDocumentsStore';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { useAlert } from '@/hooks/useAlert';
import type { DocType } from '@/types';

const TYPE_LABELS: Record<string, string> = {
  devis: 'Devis',
  factures: 'Facture',
  'bons-travail': 'Bon de travail',
  'bons-commande': 'Bon de commande',
};

const STATUT_OPTIONS: Record<string, string[]> = {
  devis: ['BROUILLON', 'EN_ATTENTE', 'ENVOYE', 'ACCEPTE', 'REFUSE', 'ANNULE'],
  factures: ['BROUILLON', 'ENVOYEE', 'PAYEE', 'ANNULEE'],
  'bons-travail': ['BROUILLON', 'EN_COURS', 'TERMINE', 'EN_PAUSE', 'ANNULE'],
  'bons-commande': ['brouillon', 'commande', 'livree', 'facturee', 'fermee'],
};

export default function DocumentFormPage() {
  const { docType, docId } = useParams<{ docType: string; docId: string }>();
  const navigate = useNavigate();
  const {
    current, companies, projects, isLoading, error,
    fetchDetail, fetchLookups, createDocument, updateDocument,
    clearError, clearCurrent,
  } = useDocumentsStore();

  const isEdit = !!docId;
  const label = TYPE_LABELS[docType || ''] || 'Document';

  // Form state
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { alert: showAlert, element: alertElement } = useAlert();

  useEffect(() => {
    fetchLookups();
    if (isEdit && docType && docId) {
      fetchDetail(docType as DocType, parseInt(docId));
    }
    return () => clearCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, docId]);

  // Populate form when editing
  useEffect(() => {
    if (isEdit && current) {
      setForm({
        nomProjet: current.nomProjet || '',
        clientNom: current.clientNom || '',
        clientCompanyId: current.clientCompanyId?.toString() || '',
        projectId: current.projectId?.toString() || '',
        description: current.description || '',
        notes: current.notes || '',
        statut: current.statut || 'BROUILLON',
        priorite: current.priorite || 'NORMAL',
        dateEcheance: current.dateEcheance?.split('T')[0] || '',
      });
    }
  }, [isEdit, current]);

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isEdit) {
        const payload: Record<string, unknown> = {};
        if (form.statut) payload.statut = form.statut;
        if (form.priorite) payload.priorite = form.priorite;
        if (form.description) payload.description = form.description;
        if (form.notes) payload.notes = form.notes;
        if (form.dateEcheance) payload.dateEcheance = form.dateEcheance;
        if (form.nomProjet) payload.nomProjet = form.nomProjet;
        if (form.clientNom) payload.clientNom = form.clientNom;
        if (form.projectId) payload.projectId = parseInt(form.projectId);
        if (form.clientCompanyId) payload.clientCompanyId = parseInt(form.clientCompanyId);

        const ok = await updateDocument(docType as DocType, parseInt(docId!), payload);
        if (ok) navigate(`/documents/${docType}/${docId}`);
      } else {
        let payload: Record<string, unknown> = {};

        if (docType === 'devis') {
          if (!form.nomProjet?.trim()) {
            await showAlert({ message: 'Le nom du projet est requis', type: 'warning' });
            setSaving(false);
            return;
          }
          payload = {
            nomProjet: form.nomProjet,
            clientCompanyId: form.clientCompanyId ? parseInt(form.clientCompanyId) : undefined,
            clientNomDirect: form.clientNom || undefined,
            projectId: form.projectId ? parseInt(form.projectId) : undefined,
            description: form.description || undefined,
            datePrevu: form.dateEcheance || undefined,
            priorite: form.priorite || 'NORMAL',
          };
        } else if (docType === 'factures') {
          payload = {
            clientCompanyId: form.clientCompanyId ? parseInt(form.clientCompanyId) : undefined,
            clientNom: form.clientNom || undefined,
            projectId: form.projectId ? parseInt(form.projectId) : undefined,
            dateEcheance: form.dateEcheance || undefined,
            conditionsPaiement: 'Net 30',
            notes: form.notes || undefined,
          };
        } else if (docType === 'bons-travail') {
          if (!form.nomProjet?.trim()) {
            await showAlert({ message: 'Le nom est requis', type: 'warning' });
            setSaving(false);
            return;
          }
          payload = {
            nom: form.nomProjet,
            projectId: form.projectId ? parseInt(form.projectId) : undefined,
            priorite: form.priorite || 'NORMALE',
            dateEcheance: form.dateEcheance || undefined,
            notes: form.notes || undefined,
          };
        } else if (docType === 'bons-commande') {
          payload = {
            fournisseurNom: form.clientNom || undefined,
            projectId: form.projectId ? parseInt(form.projectId) : undefined,
            dateLivraisonPrevue: form.dateEcheance || undefined,
            notes: form.notes || undefined,
          };
        }

        const result = await createDocument(docType as DocType, payload);
        if (result) {
          navigate(`/documents/${docType}/${result.id}`);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && isLoading && !current) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">
            {isEdit ? `Modifier ${label}` : `Nouveau ${label}`}
          </h1>
        </div>
      </div>

      {error && (
        <Alert type="error" onDismiss={clearError}>
          {error}
        </Alert>
      )}

      {/* Form */}
      <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200/60 dark:border-gray-700 p-4 space-y-4">
        {/* Nom / Titre */}
        {(docType === 'devis' || docType === 'bons-travail') && (
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              {docType === 'devis' ? 'Nom du projet *' : 'Nom *'}
            </label>
            <input
              type="text"
              value={form.nomProjet || ''}
              onChange={(e) => updateField('nomProjet', e.target.value)}
              placeholder={docType === 'devis' ? 'Ex: Rénovation cuisine' : 'Ex: Installation plomberie'}
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
            />
          </div>
        )}

        {/* Client */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
            {docType === 'bons-commande' ? 'Fournisseur' : 'Client'}
          </label>
          {companies.length > 0 ? (
            <select
              value={form.clientCompanyId || ''}
              onChange={(e) => updateField('clientCompanyId', e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
            >
              <option value="">-- Sélectionner --</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.nom}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={form.clientNom || ''}
              onChange={(e) => updateField('clientNom', e.target.value)}
              placeholder="Nom du client"
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
            />
          )}
        </div>

        {/* Projet */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Projet</label>
          {projects.length > 0 ? (
            <select
              value={form.projectId || ''}
              onChange={(e) => updateField('projectId', e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
            >
              <option value="">-- Aucun --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.nom}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={form.projectId || ''}
              onChange={(e) => updateField('projectId', e.target.value)}
              placeholder="ID du projet"
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
            />
          )}
        </div>

        {/* Statut (edit only) */}
        {isEdit && (
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Statut</label>
            <select
              value={form.statut || ''}
              onChange={(e) => updateField('statut', e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
            >
              {(STATUT_OPTIONS[docType || ''] || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {/* Priorité */}
        {(docType === 'devis' || docType === 'bons-travail') && (
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Priorité</label>
            <select
              value={form.priorite || 'NORMAL'}
              onChange={(e) => updateField('priorite', e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
            >
              <option value="BASSE">Basse</option>
              <option value="NORMAL">Normal</option>
              <option value="NORMALE">Normale</option>
              <option value="HAUTE">Haute</option>
              <option value="URGENTE">Urgente</option>
            </select>
          </div>
        )}

        {/* Date échéance */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
            {docType === 'bons-commande' ? 'Date livraison prévue' : 'Date échéance'}
          </label>
          <input
            type="date"
            value={form.dateEcheance || ''}
            onChange={(e) => updateField('dateEcheance', e.target.value)}
            className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-seaop-primary/30"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
            {docType === 'devis' ? 'Description' : 'Notes'}
          </label>
          <textarea
            value={(docType === 'devis' ? form.description : form.notes) || ''}
            onChange={(e) => updateField(docType === 'devis' ? 'description' : 'notes', e.target.value)}
            rows={3}
            placeholder="Optionnel..."
            className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary/30 resize-none"
          />
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-seaop-primary text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 min-h-[48px] active:scale-[0.98] transition-transform"
      >
        {saving ? (
          <Spinner />
        ) : (
          <>
            <Save className="w-5 h-5" />
            {isEdit ? 'Sauvegarder' : `Créer ${label}`}
          </>
        )}
      </button>
      {alertElement}
    </div>
  );
}
