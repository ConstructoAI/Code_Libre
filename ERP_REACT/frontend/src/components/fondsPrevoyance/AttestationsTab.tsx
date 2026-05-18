/**
 * Fonds de Prevoyance - Sub-tab: Attestations de vente
 * Certificates issued during unit sales (Art. 1069 C.c.Q.).
 */
import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import * as fpApi from '@/api/fondsPrevoyance';
import type { Attestation, FpReferenceData } from '@/api/fondsPrevoyance';
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
  numero_unite: '',
  nom_vendeur: '',
  nom_acheteur: '',
  date_demande: new Date().toISOString().slice(0, 10),
  date_emission: '',
  montant_fonds_prevoyance: '',
  montant_recommande: '',
  contributions_arrieres: '',
  travaux_votes_montant: '',
  travaux_votes_description: '',
  restrictions_declarations: '',
  date_validite: '',
  emise_par: '',
  statut: 'Demandée',
  notes: '',
});

type FormState = ReturnType<typeof emptyForm>;

function toPayload(form: FormState, coproId: number) {
  const num = (v: string): number | null => (v === '' ? null : Number(v));
  return {
    id_copropriete: coproId,
    numero_unite: form.numero_unite || null,
    nom_vendeur: form.nom_vendeur || null,
    nom_acheteur: form.nom_acheteur || null,
    date_demande: form.date_demande,
    date_emission: form.date_emission || null,
    montant_fonds_prevoyance: num(form.montant_fonds_prevoyance),
    montant_recommande: num(form.montant_recommande),
    contributions_arrieres: num(form.contributions_arrieres),
    travaux_votes_montant: num(form.travaux_votes_montant),
    travaux_votes_description: form.travaux_votes_description || null,
    restrictions_declarations: form.restrictions_declarations || null,
    date_validite: form.date_validite || null,
    emise_par: form.emise_par || null,
    statut: form.statut || null,
    notes: form.notes || null,
  };
}

function fromEntity(a: Attestation): FormState {
  return {
    numero_unite: a.numero_unite || '',
    nom_vendeur: a.nom_vendeur || '',
    nom_acheteur: a.nom_acheteur || '',
    date_demande: a.date_demande?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    date_emission: a.date_emission?.slice(0, 10) || '',
    montant_fonds_prevoyance: a.montant_fonds_prevoyance?.toString() || '',
    montant_recommande: a.montant_recommande?.toString() || '',
    contributions_arrieres: a.contributions_arrieres?.toString() || '',
    travaux_votes_montant: a.travaux_votes_montant?.toString() || '',
    travaux_votes_description: a.travaux_votes_description || '',
    restrictions_declarations: a.restrictions_declarations || '',
    date_validite: a.date_validite?.slice(0, 10) || '',
    emise_par: a.emise_par || '',
    statut: a.statut || 'Demandée',
    notes: a.notes || '',
  };
}

function statutColor(statut: string | null): BadgeColor {
  switch (statut) {
    case 'Émise': return 'green';
    case 'En préparation': return 'blue';
    case 'Demandée': return 'yellow';
    case 'Annulée': return 'red';
    default: return 'gray';
  }
}

export default function AttestationsTab({ coproId, reference }: Props) {
  const [items, setItems] = useState<Attestation[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fpApi.listAttestations(coproId);
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

  const openEdit = (a: Attestation) => {
    setEditId(a.id);
    setForm(fromEntity(a));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.date_demande) return;
    setSaving(true);
    try {
      const payload = toPayload(form, coproId);
      if (editId) {
        await fpApi.updateAttestation(editId, payload);
      } else {
        await fpApi.createAttestation(payload);
      }
      setShowModal(false);
      load();
    } catch { /* handled */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette attestation ?')) return;
    try {
      await fpApi.deleteAttestation(id);
      load();
    } catch { /* handled */ }
  };

  const statutsOptions = reference.statutsAttestation.map((s) => ({ value: s, label: s }));

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {items.length} attestation{items.length > 1 ? 's' : ''}
          <span className="text-gray-500 dark:text-gray-400 ml-2">· Art. 1069 C.c.Q.</span>
        </div>
        <Button onClick={openCreate} leftIcon={<Plus size={16} />}>Nouvelle attestation</Button>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 text-center py-8">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-500 dark:text-gray-400">
          Aucune attestation. Émettre lors de la vente d'unité selon l'article 1069 du Code civil du Québec.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Unité</th>
                <th className="px-3 py-2 text-left">Vendeur</th>
                <th className="px-3 py-2 text-left">Acheteur</th>
                <th className="px-3 py-2 text-left">Date demande</th>
                <th className="px-3 py-2 text-left">Date émission</th>
                <th className="px-3 py-2 text-right">Fonds</th>
                <th className="px-3 py-2 text-right">Arriérés</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-3 py-2 text-gray-900 dark:text-white">{a.numero_unite || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{a.nom_vendeur || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{a.nom_acheteur || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{a.date_demande?.slice(0, 10) || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{a.date_emission?.slice(0, 10) || '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                    {a.montant_fonds_prevoyance != null ? formatCurrency(a.montant_fonds_prevoyance) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                    {a.contributions_arrieres != null ? formatCurrency(a.contributions_arrieres) : '—'}
                  </td>
                  <td className="px-3 py-2"><Badge color={statutColor(a.statut)}>{a.statut || '—'}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(a)}
                        aria-label="Modifier l'attestation"
                        title="Modifier"
                        className="p-1 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
                        aria-label="Supprimer l'attestation"
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
        title={editId ? "Modifier l'attestation" : 'Nouvelle attestation de vente'}
        size="xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Numéro d'unité"
            value={form.numero_unite}
            onChange={(e) => setForm({ ...form, numero_unite: e.target.value })}
          />
          <Select
            label="Statut"
            value={form.statut}
            onChange={(e) => setForm({ ...form, statut: e.target.value })}
            options={statutsOptions}
          />
          <Input
            label="Nom du vendeur"
            value={form.nom_vendeur}
            onChange={(e) => setForm({ ...form, nom_vendeur: e.target.value })}
          />
          <Input
            label="Nom de l'acheteur"
            value={form.nom_acheteur}
            onChange={(e) => setForm({ ...form, nom_acheteur: e.target.value })}
          />
          <Input
            label="Date de demande *"
            type="date"
            value={form.date_demande}
            onChange={(e) => setForm({ ...form, date_demande: e.target.value })}
          />
          <Input
            label="Date d'émission"
            type="date"
            value={form.date_emission}
            onChange={(e) => setForm({ ...form, date_emission: e.target.value })}
          />
          <Input
            label="Date de validité"
            type="date"
            value={form.date_validite}
            onChange={(e) => setForm({ ...form, date_validite: e.target.value })}
          />
          <Input
            label="Émise par"
            value={form.emise_par}
            onChange={(e) => setForm({ ...form, emise_par: e.target.value })}
          />
          <Input
            label="Montant fonds de prévoyance ($)"
            type="number"
            step="0.01"
            value={form.montant_fonds_prevoyance}
            onChange={(e) => setForm({ ...form, montant_fonds_prevoyance: e.target.value })}
          />
          <Input
            label="Montant recommandé ($)"
            type="number"
            step="0.01"
            value={form.montant_recommande}
            onChange={(e) => setForm({ ...form, montant_recommande: e.target.value })}
          />
          <Input
            label="Contributions arriérés ($)"
            type="number"
            step="0.01"
            value={form.contributions_arrieres}
            onChange={(e) => setForm({ ...form, contributions_arrieres: e.target.value })}
          />
          <Input
            label="Travaux votés - Montant ($)"
            type="number"
            step="0.01"
            value={form.travaux_votes_montant}
            onChange={(e) => setForm({ ...form, travaux_votes_montant: e.target.value })}
          />
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Description des travaux votés</label>
            <textarea
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
              rows={2}
              value={form.travaux_votes_description}
              onChange={(e) => setForm({ ...form, travaux_votes_description: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Restrictions / Déclarations</label>
            <textarea
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
              rows={2}
              value={form.restrictions_declarations}
              onChange={(e) => setForm({ ...form, restrictions_declarations: e.target.value })}
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
          <Button onClick={handleSave} disabled={saving || !form.date_demande}>
            {saving ? 'Enregistrement…' : editId ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
