/**
 * B2B Client Portal - Demandes (Quote Requests)
 * New request form + list of existing requests with received proposals.
 */

import { useEffect, useState } from 'react';
import { FileText, Plus, ChevronRight, ArrowLeft } from 'lucide-react';
import { useB2bPortalStore } from '@/store/useB2bPortalStore';

const STATUS_COLORS: Record<string, string> = {
  NOUVELLE: 'bg-blue-100 text-blue-800',
  EN_COURS: 'bg-yellow-100 text-yellow-800',
  SOUMISE: 'bg-indigo-100 text-indigo-800',
  ACCEPTEE: 'bg-green-100 text-green-800',
  REFUSEE: 'bg-red-100 text-red-800',
  ANNULEE: 'bg-gray-100 text-gray-800',
};

export default function B2bDemandesPage() {
  const { demandes, currentDemande, isLoading, error, successMessage, fetchDemandes, fetchDemande, createDemande, clearSuccess, clearError } = useB2bPortalStore();
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState({ titre: '', description: '', categorie: '', budgetEstime: '', dateLimite: '', priorite: 'normale' });

  useEffect(() => { fetchDemandes(); }, [fetchDemandes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createDemande({
      ...form,
      budgetEstime: form.budgetEstime ? parseFloat(form.budgetEstime) : undefined,
      dateLimite: form.dateLimite || undefined,
    });
    setForm({ titre: '', description: '', categorie: '', budgetEstime: '', dateLimite: '', priorite: 'normale' });
    setShowForm(false);
  };

  const handleSelect = (id: number) => {
    setSelectedId(id);
    useB2bPortalStore.setState({ currentDemande: null });
    fetchDemande(id);
  };

  // Detail view
  if (selectedId && currentDemande) {
    return (
      <div className="space-y-6">
        <button onClick={() => { setSelectedId(null); useB2bPortalStore.setState({ currentDemande: null }); }} className="flex items-center gap-1 text-sm text-[#0078D4] hover:underline">
          <ArrowLeft size={16} /> Retour aux demandes
        </button>
        <div className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#323130] dark:text-[#f3f2f1]">{currentDemande.titre}</h2>
            <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[currentDemande.statut] || 'bg-gray-100'}`}>{currentDemande.statut}</span>
          </div>
          {currentDemande.description && <p className="text-sm text-[#605e5c] mb-4">{currentDemande.description}</p>}
          <div className="grid grid-cols-2 gap-4 text-sm mb-6">
            {currentDemande.categorie && <div><span className="text-[#605e5c]">Catégorie:</span> {currentDemande.categorie}</div>}
            {currentDemande.budgetEstime != null && <div><span className="text-[#605e5c]">Budget:</span> {(currentDemande.budgetEstime ?? 0).toFixed(2)} $</div>}
            {currentDemande.priorite && <div><span className="text-[#605e5c]">Priorité:</span> {currentDemande.priorite}</div>}
            {currentDemande.dateLimite && <div><span className="text-[#605e5c]">Date limite:</span> {currentDemande.dateLimite}</div>}
          </div>
          {/* Soumissions received */}
          <h3 className="text-sm font-semibold text-[#323130] dark:text-[#f3f2f1] mb-3">Soumissions reçues ({currentDemande.soumissions?.length || 0})</h3>
          {!currentDemande.soumissions?.length ? (
            <p className="text-sm text-[#605e5c]">Aucune soumission reçue pour le moment.</p>
          ) : (
            <div className="space-y-3">
              {currentDemande.soumissions.map((s) => (
                <div key={s.id} className="border border-[#edebe9] dark:border-[#3b3a39] rounded p-3">
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-sm font-medium">{s.montantTotal != null ? `${(s.montantTotal ?? 0).toFixed(2)} $` : '--'}</p>
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[s.statut] || 'bg-gray-100'}`}>{s.statut}</span>
                  </div>
                  {s.description && <p className="text-xs text-[#605e5c] line-clamp-2">{s.description}</p>}
                  {s.delaiExecutionJours && <p className="text-xs text-[#605e5c] mt-1">Délai: {s.delaiExecutionJours} jours</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1]">Demandes de soumission</h1>
        <button onClick={() => { setShowForm(!showForm); clearError(); clearSuccess(); }} className="flex items-center gap-1 px-3 py-2 bg-[#0078D4] text-white rounded text-sm font-medium hover:bg-[#106EBE]">
          <Plus size={16} /> Nouvelle demande
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
      {successMessage && <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700 flex justify-between"><span>{successMessage}</span><button onClick={clearSuccess}>&times;</button></div>}

      {/* New demande form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] p-6 space-y-4">
          <h3 className="text-sm font-semibold">Nouvelle demande de soumission</h3>
          <input type="text" value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} placeholder="Titre du projet *" required
            className="w-full px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description détaillée" rows={3}
            className="w-full px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="text" value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} placeholder="Catégorie (ex: rénovation)"
              className="px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
            <input type="number" value={form.budgetEstime} onChange={(e) => setForm({ ...form, budgetEstime: e.target.value })} placeholder="Budget estimé ($)" step="0.01"
              className="px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
            <input type="date" value={form.dateLimite} onChange={(e) => setForm({ ...form, dateLimite: e.target.value })}
              className="px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
            <select value={form.priorite} onChange={(e) => setForm({ ...form, priorite: e.target.value })}
              className="px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]">
              <option value="basse">Basse</option>
              <option value="normale">Normale</option>
              <option value="haute">Haute</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={isLoading} className="px-4 py-2 bg-[#0078D4] text-white rounded text-sm font-medium hover:bg-[#106EBE] disabled:opacity-50">
              {isLoading ? 'Envoi...' : 'Soumettre'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-[#605e5c] hover:text-[#323130]">Annuler</button>
          </div>
        </form>
      )}

      {/* Demandes list */}
      {isLoading && !showForm ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : demandes.length === 0 ? (
        <div className="text-center py-16 text-[#605e5c]">
          <FileText size={48} className="mx-auto mb-4 text-[#a19f9d]" />
          <p className="text-lg font-medium">Aucune demande</p>
          <p className="text-sm mt-1">Soumettez votre première demande de soumission</p>
        </div>
      ) : (
        <div className="space-y-3">
          {demandes.map((d) => (
            <button
              key={d.id}
              onClick={() => handleSelect(d.id)}
              className="w-full text-left bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] p-4 hover:border-[#0078D4] transition-colors flex items-center gap-4"
            >
              <FileText size={20} className="text-[#0078D4] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1] truncate">{d.titre}</p>
                <p className="text-xs text-[#605e5c]">{d.nombreSoumissions} soumission(s) &middot; {d.createdAt ? new Date(d.createdAt).toLocaleDateString('fr-CA') : ''}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[d.statut] || 'bg-gray-100'}`}>{d.statut}</span>
              <ChevronRight size={16} className="text-[#a19f9d]" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
