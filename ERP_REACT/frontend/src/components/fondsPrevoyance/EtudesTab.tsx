/**
 * Fonds de Prevoyance - Sub-tab: Etudes (studies)
 * CRUD for Loi 16 official studies by professional orders.
 */
import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Shield, AlertCircle } from 'lucide-react';
import * as fpApi from '@/api/fondsPrevoyance';
import type { Etude, FpReferenceData } from '@/api/fondsPrevoyance';
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
  date_etude: new Date().toISOString().slice(0, 10),
  professionnel_responsable: '',
  ordre_professionnel: 'OIQ',
  numero_permis: '',
  periode_couverte: '25',
  periode_debut: new Date().getFullYear().toString(),
  periode_fin: (new Date().getFullYear() + 25).toString(),
  montant_fonds_actuel: '',
  montant_recommande_debut_annee: '',
  contribution_annuelle_recommandee: '',
  methodologie_calcul: '',
  taux_inflation_suppose: '2.5',
  taux_rendement_suppose: '3.0',
  contingence_pourcentage: '10',
  date_prochaine_revision: '',
  statut_conformite: false,
  notes: '',
});

type FormState = ReturnType<typeof emptyForm>;

function toPayload(form: FormState, coproId: number) {
  const num = (v: string): number | null => (v === '' ? null : Number(v));
  return {
    id_copropriete: coproId,
    date_etude: form.date_etude,
    professionnel_responsable: form.professionnel_responsable,
    ordre_professionnel: form.ordre_professionnel || null,
    numero_permis: form.numero_permis || null,
    periode_couverte: num(form.periode_couverte) ?? 25,
    periode_debut: num(form.periode_debut),
    periode_fin: num(form.periode_fin),
    montant_fonds_actuel: num(form.montant_fonds_actuel),
    montant_recommande_debut_annee: num(form.montant_recommande_debut_annee),
    contribution_annuelle_recommandee: num(form.contribution_annuelle_recommandee),
    methodologie_calcul: form.methodologie_calcul || null,
    taux_inflation_suppose: num(form.taux_inflation_suppose),
    taux_rendement_suppose: num(form.taux_rendement_suppose),
    contingence_pourcentage: num(form.contingence_pourcentage),
    date_prochaine_revision: form.date_prochaine_revision || null,
    statut_conformite: form.statut_conformite,
    notes: form.notes || null,
  };
}

function fromEntity(e: Etude): FormState {
  return {
    date_etude: e.date_etude?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    professionnel_responsable: e.professionnel_responsable,
    ordre_professionnel: e.ordre_professionnel || 'OIQ',
    numero_permis: e.numero_permis || '',
    periode_couverte: e.periode_couverte?.toString() || '25',
    periode_debut: e.periode_debut?.toString() || '',
    periode_fin: e.periode_fin?.toString() || '',
    montant_fonds_actuel: e.montant_fonds_actuel?.toString() || '',
    montant_recommande_debut_annee: e.montant_recommande_debut_annee?.toString() || '',
    contribution_annuelle_recommandee: e.contribution_annuelle_recommandee?.toString() || '',
    methodologie_calcul: e.methodologie_calcul || '',
    taux_inflation_suppose: e.taux_inflation_suppose?.toString() || '2.5',
    taux_rendement_suppose: e.taux_rendement_suppose?.toString() || '3.0',
    contingence_pourcentage: e.contingence_pourcentage?.toString() || '10',
    date_prochaine_revision: e.date_prochaine_revision?.slice(0, 10) || '',
    statut_conformite: e.statut_conformite || false,
    notes: e.notes || '',
  };
}

export default function EtudesTab({ coproId, reference }: Props) {
  const [items, setItems] = useState<Etude[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fpApi.listEtudes(coproId);
      setItems(res.items);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [coproId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm());
    setShowModal(true);
  };

  const openEdit = (e: Etude) => {
    setEditId(e.id);
    setForm(fromEntity(e));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.professionnel_responsable.trim()) return;
    setSaving(true);
    try {
      const payload = toPayload(form, coproId);
      if (editId) {
        await fpApi.updateEtude(editId, payload);
      } else {
        await fpApi.createEtude(payload);
      }
      setShowModal(false);
      load();
    } catch { /* handled */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette étude ? Les projections associées seront également supprimées.')) return;
    try {
      await fpApi.deleteEtude(id);
      load();
    } catch { /* handled */ }
  };

  const ordreOptions = reference.ordresProfessionnels.map((o) => ({
    value: o.code, label: `${o.code} - ${o.nom}`,
  }));

  // Check if an etude is overdue (> 5 years)
  const isOverdue = (dateEtude: string): boolean => {
    const d = new Date(dateEtude);
    const fiveYearsLater = new Date(d);
    fiveYearsLater.setFullYear(d.getFullYear() + 5);
    return fiveYearsLater < new Date();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-700 dark:text-gray-300">{items.length} étude{items.length > 1 ? 's' : ''}</div>
        <Button onClick={openCreate} leftIcon={<Plus size={16} />}>Nouvelle étude</Button>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 text-center py-8">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-500 dark:text-gray-400">
          Aucune étude. La Loi 16 exige une étude tous les 5 ans.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Professionnel</th>
                <th className="px-3 py-2 text-left">Ordre</th>
                <th className="px-3 py-2 text-right">Fonds actuel</th>
                <th className="px-3 py-2 text-right">Recommandé</th>
                <th className="px-3 py-2 text-right">Contrib. annuelle</th>
                <th className="px-3 py-2 text-center">Conforme</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((e) => {
                const overdue = isOverdue(e.date_etude);
                return (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                      <div className="flex items-center gap-1">
                        {overdue && <AlertCircle size={14} className="text-amber-600 dark:text-amber-400" />}
                        {e.date_etude?.slice(0, 10) || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{e.professionnel_responsable}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{e.ordre_professionnel || '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                      {e.montant_fonds_actuel != null ? formatCurrency(e.montant_fonds_actuel) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                      {e.montant_recommande_debut_annee != null ? formatCurrency(e.montant_recommande_debut_annee) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                      {e.contribution_annuelle_recommandee != null ? formatCurrency(e.contribution_annuelle_recommandee) : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {e.statut_conformite ? (
                        <Shield size={16} className="inline text-green-600 dark:text-green-400" />
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(e)}
                          aria-label="Modifier l'étude"
                          title="Modifier"
                          className="p-1 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(e.id)}
                          aria-label="Supprimer l'étude"
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
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editId ? "Modifier l'étude" : 'Nouvelle étude du fonds de prévoyance'}
        size="xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Date de l'étude *"
            type="date"
            value={form.date_etude}
            onChange={(e) => setForm({ ...form, date_etude: e.target.value })}
          />
          <Input
            label="Professionnel responsable *"
            value={form.professionnel_responsable}
            onChange={(e) => setForm({ ...form, professionnel_responsable: e.target.value })}
          />
          <Select
            label="Ordre professionnel"
            value={form.ordre_professionnel}
            onChange={(e) => setForm({ ...form, ordre_professionnel: e.target.value })}
            options={ordreOptions}
          />
          <Input
            label="Numéro de permis"
            value={form.numero_permis}
            onChange={(e) => setForm({ ...form, numero_permis: e.target.value })}
          />
          <Input
            label="Période couverte (ans)"
            type="number"
            value={form.periode_couverte}
            onChange={(e) => setForm({ ...form, periode_couverte: e.target.value })}
          />
          <Input
            label="Date prochaine révision"
            type="date"
            value={form.date_prochaine_revision}
            onChange={(e) => setForm({ ...form, date_prochaine_revision: e.target.value })}
          />
          <Input
            label="Montant fonds actuel ($)"
            type="number"
            step="0.01"
            value={form.montant_fonds_actuel}
            onChange={(e) => setForm({ ...form, montant_fonds_actuel: e.target.value })}
          />
          <Input
            label="Montant recommandé ($)"
            type="number"
            step="0.01"
            value={form.montant_recommande_debut_annee}
            onChange={(e) => setForm({ ...form, montant_recommande_debut_annee: e.target.value })}
          />
          <Input
            label="Contribution annuelle recommandée ($)"
            type="number"
            step="0.01"
            value={form.contribution_annuelle_recommandee}
            onChange={(e) => setForm({ ...form, contribution_annuelle_recommandee: e.target.value })}
          />
          <Input
            label="Taux inflation (%)"
            type="number"
            step="0.01"
            value={form.taux_inflation_suppose}
            onChange={(e) => setForm({ ...form, taux_inflation_suppose: e.target.value })}
          />
          <Input
            label="Taux rendement (%)"
            type="number"
            step="0.01"
            value={form.taux_rendement_suppose}
            onChange={(e) => setForm({ ...form, taux_rendement_suppose: e.target.value })}
          />
          <Input
            label="Contingence (%)"
            type="number"
            step="0.01"
            value={form.contingence_pourcentage}
            onChange={(e) => setForm({ ...form, contingence_pourcentage: e.target.value })}
          />
          <div className="md:col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="statut_conformite"
              checked={form.statut_conformite}
              onChange={(e) => setForm({ ...form, statut_conformite: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="statut_conformite" className="text-sm text-gray-700 dark:text-gray-300">
              Étude conforme à la Loi 16
            </label>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Méthodologie de calcul</label>
            <textarea
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
              rows={2}
              value={form.methodologie_calcul}
              onChange={(e) => setForm({ ...form, methodologie_calcul: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setShowModal(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !form.professionnel_responsable.trim()}>
            {saving ? 'Enregistrement…' : editId ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
