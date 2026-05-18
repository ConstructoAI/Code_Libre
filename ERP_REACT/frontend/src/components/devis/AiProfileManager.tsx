/**
 * AiProfileManager — CRUD profils IA personnalises avec base de connaissance
 * Modal accessible depuis EstimationIA toolbar
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Plus, Trash2, FileUp, Save, Pencil, ChevronLeft, Loader2, FileText, Brain,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import * as devisApi from '../../api/devis';
import type { CustomAiProfile, AiProfileDocument } from '../../api/devis';

interface Props {
  open: boolean;
  onClose: () => void;
  onProfilesChanged: () => void;
}

type View = 'list' | 'create' | 'edit';

export default function AiProfileManager({ open, onClose, onProfilesChanged }: Props) {
  const [view, setView] = useState<View>('list');
  const [profiles, setProfiles] = useState<CustomAiProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit/create form
  const [editId, setEditId] = useState<number | null>(null);
  const [formName, setFormName] = useState('');
  const [formInstructions, setFormInstructions] = useState('');
  const [documents, setDocuments] = useState<AiProfileDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await devisApi.listCustomProfiles();
      setProfiles(res.items);
    } catch {
      setError('Erreur lors du chargement des profils');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadProfiles();
      setView('list');
      setError(null);
      setSuccess(null);
    }
  }, [open, loadProfiles]);

  const handleCreate = async () => {
    if (!formName.trim()) {
      setError('Le nom du profil est requis');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await devisApi.createCustomProfile({
        name: formName.trim(),
        instructions: formInstructions,
      });
      setSuccess('Profil créé');
      onProfilesChanged();
      // Switch to edit mode to allow document upload
      setEditId(res.id);
      setView('edit');
      await loadDocuments(res.id);
      await loadProfiles();
    } catch {
      setError('Erreur lors de la création du profil');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editId || !formName.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await devisApi.updateCustomProfile(editId, {
        name: formName.trim(),
        instructions: formInstructions,
      });
      setSuccess('Profil mis à jour');
      onProfilesChanged();
      await loadProfiles();
    } catch {
      setError('Erreur lors de la mise à jour');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce profil et tous ses documents ?')) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      await devisApi.deleteCustomProfile(id);
      setSuccess('Profil supprimé');
      onProfilesChanged();
      await loadProfiles();
      if (editId === id) {
        setView('list');
        setEditId(null);
      }
    } catch {
      setError('Erreur lors de la suppression');
    } finally {
      setLoading(false);
    }
  };

  const loadDocuments = async (profileId: number) => {
    try {
      const res = await devisApi.getCustomProfile(profileId);
      setDocuments(res.documents || []);
    } catch {
      setDocuments([]);
    }
  };

  const openEdit = async (profile: CustomAiProfile) => {
    setEditId(profile.id);
    setFormName(profile.name);
    setFormInstructions(profile.instructions || '');
    setView('edit');
    setError(null);
    setSuccess(null);
    await loadDocuments(profile.id);
  };

  const openCreate = () => {
    setEditId(null);
    setFormName('');
    setFormInstructions('');
    setDocuments([]);
    setView('create');
    setError(null);
    setSuccess(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editId) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('Fichier trop volumineux (max 20 Mo)');
      return;
    }
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await devisApi.uploadProfileDocument(editId, file);
      setSuccess(`Document "${res.originalName}" ajouté (${res.extractedTextLength} caractères extraits)`);
      await loadDocuments(editId);
    } catch {
      setError("Erreur lors de l'upload du document");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteDoc = async (docId: number) => {
    if (!editId) return;
    setError(null);
    setSuccess(null);
    try {
      await devisApi.deleteProfileDocument(editId, docId);
      setSuccess('Document supprimé');
      await loadDocuments(editId);
    } catch {
      setError('Erreur lors de la suppression du document');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {view !== 'list' && (
              <button
                onClick={() => { setView('list'); setError(null); setSuccess(null); }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <Brain size={22} className="text-blue-600" />
            <h2 className="text-lg font-semibold">
              {view === 'list' && 'Mes profils IA'}
              {view === 'create' && 'Nouveau profil'}
              {view === 'edit' && 'Modifier le profil'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
          {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

          {/* ===== LIST VIEW ===== */}
          {view === 'list' && (
            <>
              <Button size="sm" onClick={openCreate} leftIcon={<Plus size={15} />}>
                Créer un profil
              </Button>

              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-blue-600" />
                </div>
              )}

              {!loading && profiles.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Brain size={48} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Aucun profil personnalisé</p>
                  <p className="text-xs mt-1">Créez un profil IA avec votre personnalité et base de connaissance</p>
                </div>
              )}

              {profiles.map(p => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors cursor-pointer"
                  onClick={() => openEdit(p)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-sm">
                      <Brain size={18} className="text-white" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{p.name}</p>
                      <p className="text-xs text-gray-500">
                        {p.documentCount || 0} document{(p.documentCount || 0) !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                    >
                      <Pencil size={15} className="text-gray-500" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    >
                      <Trash2 size={15} className="text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ===== CREATE / EDIT VIEW ===== */}
          {(view === 'create' || view === 'edit') && (
            <>
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1">Nom du profil</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: Mon estimateur toiture"
                  className="erp-input w-full"
                />
              </div>

              {/* Instructions / Personality */}
              <div>
                <label className="block text-sm font-medium mb-1">Instructions (personnalité et expertise)</label>
                <textarea
                  value={formInstructions}
                  onChange={e => setFormInstructions(e.target.value)}
                  placeholder={"Décrivez la personnalité, l'expertise et les instructions spécifiques de ce profil.\n\nEx:\n- Tu es un estimateur spécialisé en toiture au Québec\n- Tu utilises les prix 2026 du marché\n- Tu inclus toujours les frais de sécurité CNESST\n- Tu références les normes du Code du bâtiment"}
                  rows={8}
                  className="erp-input w-full resize-y"
                />
              </div>

              {/* Save button */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={view === 'create' ? handleCreate : handleUpdate}
                  disabled={loading || !formName.trim()}
                  leftIcon={loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                >
                  {view === 'create' ? 'Créer le profil' : 'Sauvegarder'}
                </Button>
              </div>

              {/* Documents section (edit only) */}
              {view === 'edit' && editId && (
                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <FileText size={16} className="text-blue-600" />
                      Base de connaissance
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      leftIcon={uploading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
                    >
                      {uploading ? 'Upload...' : 'Ajouter un document'}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".pdf,.txt,.csv,.xlsx,.docx,.md,.tsv"
                      onChange={handleFileUpload}
                    />
                  </div>

                  <p className="text-xs text-gray-500 mb-3">
                    Ajoutez vos listes de prix, spécifications techniques, catalogues fournisseurs, etc.
                    Le texte sera extrait automatiquement et injecté dans le contexte de l'IA.
                  </p>

                  {documents.length === 0 && (
                    <div className="text-center py-6 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                      <FileUp size={32} className="mx-auto mb-2 text-gray-300" />
                      <p className="text-sm text-gray-500">Aucun document</p>
                      <p className="text-xs text-gray-400">PDF, CSV, XLSX, TXT, DOCX</p>
                    </div>
                  )}

                  {documents.map(doc => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 mb-2"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText size={16} className="text-gray-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{doc.originalName}</p>
                          <p className="text-xs text-gray-500">
                            {(doc.fileSize / 1024).toFixed(0)} Ko
                            {doc.extractedTextLength > 0
                              ? ` — ${doc.extractedTextLength.toLocaleString()} car. extraits`
                              : ' — extraction échouée'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg flex-shrink-0"
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
