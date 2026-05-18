/**
 * Fonds de Prevoyance - Sub-tab: Composantes du batiment
 * Inventory with grouped-by-category view + alerts for end-of-life items.
 */
import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import * as fpApi from '@/api/fondsPrevoyance';
import type { Composante, FpReferenceData } from '@/api/fondsPrevoyance';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/utils/format';

interface Props {
  coproId: number;
  reference: FpReferenceData;
}

const emptyForm = () => ({
  categorie: '',
  sous_categorie: '',
  description_detaillee: '',
  quantite: '1',
  unite_mesure: 'unité',
  annee_installation: new Date().getFullYear().toString(),
  duree_vie_theorique: '25',
  etat_actuel: 'Bon',
  cout_remplacement_unitaire: '',
  date_derniere_inspection: '',
  notes_inspection: '',
  priorite: 'Moyenne',
});

type FormState = ReturnType<typeof emptyForm>;

function toPayload(form: FormState, coproId: number) {
  const num = (v: string): number | null => (v === '' ? null : Number(v));
  return {
    id_copropriete: coproId,
    categorie: form.categorie,
    sous_categorie: form.sous_categorie || null,
    description_detaillee: form.description_detaillee || null,
    quantite: num(form.quantite),
    unite_mesure: form.unite_mesure || null,
    annee_installation: num(form.annee_installation),
    duree_vie_theorique: num(form.duree_vie_theorique),
    etat_actuel: form.etat_actuel || null,
    cout_remplacement_unitaire: num(form.cout_remplacement_unitaire),
    date_derniere_inspection: form.date_derniere_inspection || null,
    notes_inspection: form.notes_inspection || null,
    priorite: form.priorite || null,
  };
}

function fromEntity(c: Composante): FormState {
  return {
    categorie: c.categorie,
    sous_categorie: c.sous_categorie || '',
    description_detaillee: c.description_detaillee || '',
    quantite: c.quantite?.toString() || '1',
    unite_mesure: c.unite_mesure || 'unité',
    annee_installation: c.annee_installation?.toString() || new Date().getFullYear().toString(),
    duree_vie_theorique: c.duree_vie_theorique?.toString() || '25',
    etat_actuel: c.etat_actuel || 'Bon',
    cout_remplacement_unitaire: c.cout_remplacement_unitaire?.toString() || '',
    date_derniere_inspection: c.date_derniere_inspection?.slice(0, 10) || '',
    notes_inspection: c.notes_inspection || '',
    priorite: c.priorite || 'Moyenne',
  };
}

function etatColor(etat: string | null): string {
  switch (etat) {
    case 'Excellent': return 'text-green-700 dark:text-green-400';
    case 'Bon': return 'text-blue-700 dark:text-blue-400';
    case 'Moyen': return 'text-yellow-700 dark:text-yellow-400';
    case 'Mauvais': return 'text-orange-700 dark:text-orange-400';
    case 'Critique': return 'text-red-700 dark:text-red-400';
    default: return 'text-gray-500 dark:text-gray-400';
  }
}

/** Four-tier replacement alert based on remaining life (matches Streamlit generer_alerte_remplacement). */
function getAlerteNiveau(dvr: number | null): { label: string; classes: string; icon: string } | null {
  if (dvr === null || dvr === undefined) return null;
  if (dvr <= 0) return { label: 'CRITIQUE', classes: 'text-red-700 dark:text-red-400 font-semibold', icon: '🔴' };
  if (dvr <= 2) return { label: 'URGENT', classes: 'text-orange-700 dark:text-orange-400 font-semibold', icon: '🟠' };
  if (dvr <= 5) return { label: 'AVERTISSEMENT', classes: 'text-yellow-700 dark:text-yellow-400', icon: '🟡' };
  return { label: 'OK', classes: 'text-green-700 dark:text-green-400', icon: '🟢' };
}

export default function ComposantesTab({ coproId, reference }: Props) {
  const [items, setItems] = useState<Composante[]>([]);
  const [grouped, setGrouped] = useState<Record<string, Composante[]>>({});
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fpApi.listComposantes(coproId, true);
      setItems(res.items);
      setGrouped(res.grouped || {});
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [coproId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditId(null);
    const firstCategory = Object.keys(reference.categoriesComposantes)[0] || '';
    setForm({ ...emptyForm(), categorie: firstCategory });
    setShowModal(true);
  };

  const openEdit = (c: Composante) => {
    setEditId(c.id);
    setForm(fromEntity(c));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.categorie) return;
    setSaving(true);
    try {
      const payload = toPayload(form, coproId);
      if (editId) {
        await fpApi.updateComposante(editId, payload);
      } else {
        await fpApi.createComposante(payload);
      }
      setShowModal(false);
      load();
    } catch { /* handled */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette composante ?')) return;
    try {
      await fpApi.deleteComposante(id);
      load();
    } catch { /* handled */ }
  };

  const categoriesOptions = Object.keys(reference.categoriesComposantes).map((c) => ({ value: c, label: c }));
  const sousCategoriesOptions = form.categorie
    ? (reference.categoriesComposantes[form.categorie] || []).map((s) => ({ value: s, label: s }))
    : [];
  const etatsOptions = reference.etatsComposante.map((e) => ({ value: e, label: e }));
  const unitesOptions = reference.unitesMesure.map((u) => ({ value: u, label: u }));
  const prioritesOptions = reference.priorites.map((p) => ({ value: p, label: p }));

  const totalCout = items.reduce((s, c) => s + (c.cout_remplacement_total || 0), 0);
  const nbCritiques = items.filter((c) => (c.duree_vie_restante ?? 99) <= 5).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex gap-4 text-sm">
          <div className="text-gray-700 dark:text-gray-300">
            <span className="text-gray-500 dark:text-gray-400">Total :</span> {items.length}
          </div>
          <div className="text-gray-700 dark:text-gray-300">
            <span className="text-gray-500 dark:text-gray-400">Coût remplacement :</span> {formatCurrency(totalCout)}
          </div>
          {nbCritiques > 0 && (
            <div className="text-red-700 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle size={14} /> {nbCritiques} critique{nbCritiques > 1 ? 's' : ''}
            </div>
          )}
        </div>
        <Button onClick={openCreate} leftIcon={<Plus size={16} />}>Nouvelle composante</Button>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 text-center py-8">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-500 dark:text-gray-400">
          Aucune composante inventoriée. Cliquez sur "Nouvelle composante" pour commencer.
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([cat, comps]) => (
            <div key={cat} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-gray-900 dark:text-white font-medium text-sm">
                {cat} <span className="text-gray-500 dark:text-gray-400">({comps.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 text-xs">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Sous-catégorie</th>
                      <th className="px-3 py-1.5 text-left">Description</th>
                      <th className="px-3 py-1.5 text-right">Quantité</th>
                      <th className="px-3 py-1.5 text-left">État</th>
                      <th className="px-3 py-1.5 text-right">Vie restante</th>
                      <th className="px-3 py-1.5 text-right">Coût total</th>
                      <th className="px-3 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {comps.map((c) => {
                      const dvr = c.duree_vie_restante;
                      const alerte = getAlerteNiveau(dvr);
                      return (
                        <tr key={c.id} className="hover:bg-white dark:bg-gray-800">
                          <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{c.sous_categorie || '—'}</td>
                          <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{c.description_detaillee || '—'}</td>
                          <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">
                            {c.quantite ?? '—'} {c.unite_mesure || ''}
                          </td>
                          <td className={`px-3 py-1.5 font-medium ${etatColor(c.etat_actuel)}`}>
                            {c.etat_actuel || '—'}
                          </td>
                          <td className={`px-3 py-1.5 text-right ${alerte?.classes || 'text-gray-700 dark:text-gray-300'}`}>
                            {alerte && <span className="mr-1">{alerte.icon}</span>}
                            {dvr !== null ? `${dvr} ans` : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">
                            {c.cout_remplacement_total != null ? formatCurrency(c.cout_remplacement_total) : '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => openEdit(c)}
                                aria-label="Modifier la composante"
                                title="Modifier"
                                className="p-1 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => handleDelete(c.id)}
                                aria-label="Supprimer la composante"
                                title="Supprimer"
                                className="p-1 text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editId ? 'Modifier la composante' : 'Nouvelle composante'}
        size="xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label="Catégorie *"
            value={form.categorie}
            onChange={(e) => setForm({ ...form, categorie: e.target.value, sous_categorie: '' })}
            options={[{ value: '', label: '-- Choisir --' }, ...categoriesOptions]}
          />
          <Select
            label="Sous-catégorie"
            value={form.sous_categorie}
            onChange={(e) => setForm({ ...form, sous_categorie: e.target.value })}
            options={[{ value: '', label: '-- (optionnel) --' }, ...sousCategoriesOptions]}
          />
          <div className="md:col-span-2">
            <Input
              label="Description détaillée"
              value={form.description_detaillee}
              onChange={(e) => setForm({ ...form, description_detaillee: e.target.value })}
            />
          </div>
          <Input
            label="Quantité"
            type="number"
            step="0.01"
            value={form.quantite}
            onChange={(e) => setForm({ ...form, quantite: e.target.value })}
          />
          <Select
            label="Unité de mesure"
            value={form.unite_mesure}
            onChange={(e) => setForm({ ...form, unite_mesure: e.target.value })}
            options={unitesOptions}
          />
          <Input
            label="Année d'installation"
            type="number"
            value={form.annee_installation}
            onChange={(e) => setForm({ ...form, annee_installation: e.target.value })}
          />
          <Input
            label="Durée de vie théorique (ans)"
            type="number"
            value={form.duree_vie_theorique}
            onChange={(e) => setForm({ ...form, duree_vie_theorique: e.target.value })}
          />
          <Select
            label="État actuel"
            value={form.etat_actuel}
            onChange={(e) => setForm({ ...form, etat_actuel: e.target.value })}
            options={etatsOptions}
          />
          <Select
            label="Priorité"
            value={form.priorite}
            onChange={(e) => setForm({ ...form, priorite: e.target.value })}
            options={prioritesOptions}
          />
          <Input
            label="Coût remplacement unitaire ($)"
            type="number"
            step="0.01"
            value={form.cout_remplacement_unitaire}
            onChange={(e) => setForm({ ...form, cout_remplacement_unitaire: e.target.value })}
          />
          <Input
            label="Date dernière inspection"
            type="date"
            value={form.date_derniere_inspection}
            onChange={(e) => setForm({ ...form, date_derniere_inspection: e.target.value })}
          />
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Notes d'inspection</label>
            <textarea
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
              rows={2}
              value={form.notes_inspection}
              onChange={(e) => setForm({ ...form, notes_inspection: e.target.value })}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setShowModal(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !form.categorie}>
            {saving ? 'Enregistrement…' : editId ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
