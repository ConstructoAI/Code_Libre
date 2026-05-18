/**
 * Fonds de Prevoyance - Sub-tab: Carnet d'entretien
 * Maintenance log with status filter.
 */
import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import * as fpApi from '@/api/fondsPrevoyance';
import type { Entretien, FpReferenceData } from '@/api/fondsPrevoyance';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import type { BadgeColor } from '@/components/ui/Badge';
import { formatCurrency } from '@/utils/format';

interface Props {
  coproId: number;
  reference: FpReferenceData;
}

const emptyForm = () => ({
  id_composante: '',
  type_intervention: 'Entretien',
  description_travaux: '',
  date_prevue: '',
  date_realisee: '',
  frequence: 'annuel',
  cout_prevu: '',
  cout_reel: '',
  entrepreneur: '',
  numero_contrat: '',
  garantie_duree: '',
  garantie_expiration: '',
  statut: 'Planifié',
  notes: '',
});

type FormState = ReturnType<typeof emptyForm>;

function toPayload(form: FormState, coproId: number) {
  const num = (v: string): number | null => (v === '' ? null : Number(v));
  return {
    id_copropriete: coproId,
    id_composante: num(form.id_composante),
    type_intervention: form.type_intervention || null,
    description_travaux: form.description_travaux,
    date_prevue: form.date_prevue || null,
    date_realisee: form.date_realisee || null,
    frequence: form.frequence || null,
    cout_prevu: num(form.cout_prevu),
    cout_reel: num(form.cout_reel),
    entrepreneur: form.entrepreneur || null,
    numero_contrat: form.numero_contrat || null,
    garantie_duree: num(form.garantie_duree),
    garantie_expiration: form.garantie_expiration || null,
    statut: form.statut || null,
    notes: form.notes || null,
  };
}

function fromEntity(e: Entretien): FormState {
  return {
    id_composante: e.id_composante?.toString() || '',
    type_intervention: e.type_intervention || 'Entretien',
    description_travaux: e.description_travaux,
    date_prevue: e.date_prevue?.slice(0, 10) || '',
    date_realisee: e.date_realisee?.slice(0, 10) || '',
    frequence: e.frequence || 'annuel',
    cout_prevu: e.cout_prevu?.toString() || '',
    cout_reel: e.cout_reel?.toString() || '',
    entrepreneur: e.entrepreneur || '',
    numero_contrat: e.numero_contrat || '',
    garantie_duree: e.garantie_duree?.toString() || '',
    garantie_expiration: e.garantie_expiration?.slice(0, 10) || '',
    statut: e.statut || 'Planifié',
    notes: e.notes || '',
  };
}

function statutColor(statut: string | null): BadgeColor {
  switch (statut) {
    case 'Complété': return 'green';
    case 'En cours': return 'blue';
    case 'Planifié': return 'yellow';
    case 'Reporté': return 'gray';
    case 'Annulé': return 'red';
    default: return 'gray';
  }
}

export default function CarnetEntretienTab({ coproId, reference }: Props) {
  const [items, setItems] = useState<Entretien[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [statutFilter, setStatutFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fpApi.listEntretiens(coproId, statutFilter || undefined);
      setItems(res.items);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [coproId, statutFilter]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm());
    setShowModal(true);
  };

  const openEdit = (e: Entretien) => {
    setEditId(e.id);
    setForm(fromEntity(e));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.description_travaux.trim()) return;
    setSaving(true);
    try {
      const payload = toPayload(form, coproId);
      if (editId) {
        await fpApi.updateEntretien(editId, payload);
      } else {
        await fpApi.createEntretien(payload);
      }
      setShowModal(false);
      load();
    } catch { /* handled */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette entrée ?')) return;
    try {
      await fpApi.deleteEntretien(id);
      load();
    } catch { /* handled */ }
  };

  const statutsOptions = reference.statutsEntretien.map((s) => ({ value: s, label: s }));
  const typesInterventionOptions = reference.typesIntervention.map((t) => ({ value: t, label: t }));
  const frequencesOptions = reference.frequencesEntretien.map((f) => ({ value: f.code, label: f.nom }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400">Filtrer :</label>
          <div className="min-w-[180px]">
            <Select
              value={statutFilter}
              onChange={(e) => setStatutFilter(e.target.value)}
              options={[{ value: '', label: 'Tous' }, ...statutsOptions]}
            />
          </div>
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">{items.length} entrée{items.length > 1 ? 's' : ''}</span>
        </div>
        <Button onClick={openCreate} leftIcon={<Plus size={16} />}>Nouvel entretien</Button>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 text-center py-8">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-500 dark:text-gray-400">
          Aucun entretien enregistré. La Loi 16 exige un carnet d'entretien.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Date prévue</th>
                <th className="px-3 py-2 text-left">Date réalisée</th>
                <th className="px-3 py-2 text-right">Coût prévu</th>
                <th className="px-3 py-2 text-right">Coût réel</th>
                <th className="px-3 py-2 text-left">Entrepreneur</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-3 py-2 text-gray-900 dark:text-white">{e.description_travaux}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{e.type_intervention || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{e.date_prevue?.slice(0, 10) || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{e.date_realisee?.slice(0, 10) || '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                    {e.cout_prevu != null ? formatCurrency(e.cout_prevu) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                    {e.cout_reel != null ? formatCurrency(e.cout_reel) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{e.entrepreneur || '—'}</td>
                  <td className="px-3 py-2"><Badge color={statutColor(e.statut)}>{e.statut || '—'}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(e)}
                        aria-label="Modifier l'entretien"
                        title="Modifier"
                        className="p-1 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        aria-label="Supprimer l'entretien"
                        title="Supprimer"
                        className="p-1 text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editId ? "Modifier l'entretien" : 'Nouvel entretien'}
        size="xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Input
              label="Description des travaux *"
              value={form.description_travaux}
              onChange={(e) => setForm({ ...form, description_travaux: e.target.value })}
            />
          </div>
          <Select
            label="Type d'intervention"
            value={form.type_intervention}
            onChange={(e) => setForm({ ...form, type_intervention: e.target.value })}
            options={typesInterventionOptions}
          />
          <Select
            label="Fréquence"
            value={form.frequence}
            onChange={(e) => setForm({ ...form, frequence: e.target.value })}
            options={frequencesOptions}
          />
          <Input
            label="Date prévue"
            type="date"
            value={form.date_prevue}
            onChange={(e) => setForm({ ...form, date_prevue: e.target.value })}
          />
          <Input
            label="Date réalisée"
            type="date"
            value={form.date_realisee}
            onChange={(e) => setForm({ ...form, date_realisee: e.target.value })}
          />
          <Input
            label="Coût prévu ($)"
            type="number"
            step="0.01"
            value={form.cout_prevu}
            onChange={(e) => setForm({ ...form, cout_prevu: e.target.value })}
          />
          <Input
            label="Coût réel ($)"
            type="number"
            step="0.01"
            value={form.cout_reel}
            onChange={(e) => setForm({ ...form, cout_reel: e.target.value })}
          />
          <Input
            label="Entrepreneur"
            value={form.entrepreneur}
            onChange={(e) => setForm({ ...form, entrepreneur: e.target.value })}
          />
          <Input
            label="Numéro de contrat"
            value={form.numero_contrat}
            onChange={(e) => setForm({ ...form, numero_contrat: e.target.value })}
          />
          <Input
            label="Durée de garantie (mois)"
            type="number"
            value={form.garantie_duree}
            onChange={(e) => setForm({ ...form, garantie_duree: e.target.value })}
          />
          <Input
            label="Expiration garantie"
            type="date"
            value={form.garantie_expiration}
            onChange={(e) => setForm({ ...form, garantie_expiration: e.target.value })}
          />
          <Select
            label="Statut"
            value={form.statut}
            onChange={(e) => setForm({ ...form, statut: e.target.value })}
            options={statutsOptions}
          />
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
          <Button onClick={handleSave} disabled={saving || !form.description_travaux.trim()}>
            {saving ? 'Enregistrement…' : editId ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
