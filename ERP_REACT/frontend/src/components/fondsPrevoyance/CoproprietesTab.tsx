/**
 * Fonds de Prevoyance - Sub-tab: Coproprietes
 * List + create/edit/delete coproprietes.
 */
import { useState } from 'react';
import { Plus, Pencil, Trash2, ExternalLink, Calculator } from 'lucide-react';
import * as fpApi from '@/api/fondsPrevoyance';
import type { Copropriete, FpReferenceData } from '@/api/fondsPrevoyance';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/utils/format';

interface Props {
  coproprietes: Copropriete[];
  reference: FpReferenceData | null;
  loading: boolean;
  onChanged: () => void;
  onSelect: (id: number) => void;
}

const emptyForm = () => ({
  nom_copropriete: '',
  adresse_complete: '',
  ville: '',
  code_postal: '',
  annee_construction: '',
  nombre_unites: '',
  superficie_totale_pc: '',
  valeur_reconstruction: '',
  type_batiment: 'Résidentiel',
  nombre_etages: '',
  type_structure: 'Béton',
  qualite_construction: 'Moyenne',
  notes: '',
});

type FormState = ReturnType<typeof emptyForm>;

function toPayload(form: FormState): Partial<Copropriete> {
  const num = (v: string): number | null => (v === '' ? null : Number(v));
  return {
    nom_copropriete: form.nom_copropriete.trim(),
    adresse_complete: form.adresse_complete.trim(),
    ville: form.ville || null,
    code_postal: form.code_postal || null,
    annee_construction: num(form.annee_construction),
    nombre_unites: num(form.nombre_unites),
    superficie_totale_pc: num(form.superficie_totale_pc),
    valeur_reconstruction: num(form.valeur_reconstruction),
    type_batiment: form.type_batiment || null,
    nombre_etages: num(form.nombre_etages),
    type_structure: form.type_structure || null,
    qualite_construction: form.qualite_construction || null,
    notes: form.notes || null,
  };
}

function fromEntity(c: Copropriete): FormState {
  return {
    nom_copropriete: c.nom_copropriete,
    adresse_complete: c.adresse_complete,
    ville: c.ville || '',
    code_postal: c.code_postal || '',
    annee_construction: c.annee_construction?.toString() || '',
    nombre_unites: c.nombre_unites?.toString() || '',
    superficie_totale_pc: c.superficie_totale_pc?.toString() || '',
    valeur_reconstruction: c.valeur_reconstruction?.toString() || '',
    type_batiment: c.type_batiment || 'Résidentiel',
    nombre_etages: c.nombre_etages?.toString() || '',
    type_structure: c.type_structure || 'Béton',
    qualite_construction: c.qualite_construction || 'Moyenne',
    notes: c.notes || '',
  };
}

export default function CoproprietesTab({
  coproprietes, reference, loading, onChanged, onSelect,
}: Props) {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);

  const handleCalculerValeurReconstruction = async () => {
    const sup = Number(form.superficie_totale_pc);
    const ann = Number(form.annee_construction);
    if (!Number.isFinite(sup) || sup <= 0 || !Number.isFinite(ann) || ann < 1800) return;
    setCalculating(true);
    try {
      const res = await fpApi.calculerValeurReconstruction({
        superficie: sup,
        qualite: form.qualite_construction,
        type_batiment: form.type_batiment,
        annee_construction: ann,
      });
      setForm({ ...form, valeur_reconstruction: res.valeur_reconstruction.toString() });
    } catch { /* handled */ }
    finally { setCalculating(false); }
  };

  const canCalculer = Number(form.superficie_totale_pc) > 0 && Number(form.annee_construction) >= 1800;

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm());
    setShowModal(true);
  };

  const openEdit = (c: Copropriete) => {
    setEditId(c.id);
    setForm(fromEntity(c));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.nom_copropriete.trim() || !form.adresse_complete.trim()) return;
    setSaving(true);
    try {
      const payload = toPayload(form);
      if (editId) {
        await fpApi.updateCopropriete(editId, payload);
      } else {
        await fpApi.createCopropriete(payload);
      }
      setShowModal(false);
      onChanged();
    } catch {
      /* handled by interceptor */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette copropriété ? Toutes les composantes, études et autres données associées seront supprimées.')) return;
    try {
      await fpApi.deleteCopropriete(id);
      onChanged();
    } catch {
      /* handled by interceptor */
    }
  };

  const typeBatimentOptions =
    reference?.typesBatiment.map((t) => ({ value: t, label: t })) || [];
  const typeStructureOptions =
    reference?.typesStructure.map((t) => ({ value: t, label: t })) || [];
  const qualiteOptions =
    reference?.qualitesConstruction.map((t) => ({ value: t, label: t })) || [];

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {coproprietes.length} copropriété{coproprietes.length > 1 ? 's' : ''}
        </div>
        <Button onClick={openCreate} leftIcon={<Plus size={16} />}>
          Nouvelle copropriété
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 uppercase text-xs">
            <tr>
              <th className="px-3 py-2 text-left">Nom</th>
              <th className="px-3 py-2 text-left">Adresse</th>
              <th className="px-3 py-2 text-left">Année</th>
              <th className="px-3 py-2 text-right">Unités</th>
              <th className="px-3 py-2 text-right">Valeur reconstr.</th>
              <th className="px-3 py-2 text-center">Composantes</th>
              <th className="px-3 py-2 text-center">Études</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">Chargement…</td></tr>
            ) : coproprietes.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">Aucune copropriété. Cliquez sur "Nouvelle copropriété" pour commencer.</td></tr>
            ) : (
              coproprietes.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{c.nom_copropriete}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{c.adresse_complete}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{c.annee_construction || '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{c.nombre_unites ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                    {c.valeur_reconstruction != null ? formatCurrency(c.valeur_reconstruction) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-700 dark:text-gray-300">{c.nb_composantes ?? 0}</td>
                  <td className="px-3 py-2 text-center text-gray-700 dark:text-gray-300">{c.nb_etudes ?? 0}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => onSelect(c.id)}
                        aria-label="Sélectionner la copropriété"
                        title="Sélectionner pour les autres onglets"
                        className="p-1.5 text-[#4A7FA8] dark:text-[#9BC8E4] hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        aria-label="Modifier la copropriété"
                        title="Modifier"
                        className="p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        aria-label="Supprimer la copropriété"
                        title="Supprimer"
                        className="p-1.5 text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editId ? 'Modifier la copropriété' : 'Nouvelle copropriété'}
        size="xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Nom de la copropriété *"
            value={form.nom_copropriete}
            onChange={(e) => setForm({ ...form, nom_copropriete: e.target.value })}
          />
          <Input
            label="Adresse complète *"
            value={form.adresse_complete}
            onChange={(e) => setForm({ ...form, adresse_complete: e.target.value })}
          />
          <Input
            label="Ville"
            value={form.ville}
            onChange={(e) => setForm({ ...form, ville: e.target.value })}
          />
          <Input
            label="Code postal"
            value={form.code_postal}
            onChange={(e) => setForm({ ...form, code_postal: e.target.value })}
          />
          <Input
            label="Année de construction"
            type="number"
            value={form.annee_construction}
            onChange={(e) => setForm({ ...form, annee_construction: e.target.value })}
          />
          <Input
            label="Nombre d'unités"
            type="number"
            value={form.nombre_unites}
            onChange={(e) => setForm({ ...form, nombre_unites: e.target.value })}
          />
          <Input
            label="Superficie totale (pi²)"
            type="number"
            value={form.superficie_totale_pc}
            onChange={(e) => setForm({ ...form, superficie_totale_pc: e.target.value })}
          />
          <div>
            <Input
              label="Valeur de reconstruction ($)"
              type="number"
              value={form.valeur_reconstruction}
              onChange={(e) => setForm({ ...form, valeur_reconstruction: e.target.value })}
            />
            <button
              type="button"
              onClick={handleCalculerValeurReconstruction}
              disabled={calculating || !canCalculer}
              className="mt-1 text-xs text-[#4A7FA8] hover:text-[#3A6F98] dark:text-[#9BC8E4] dark:hover:text-[#7BAFD4] disabled:text-gray-400 dark:disabled:text-gray-500 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Calculator size={12} />
              {calculating ? 'Calcul…' : 'Calculer automatiquement (Québec 2025)'}
            </button>
          </div>
          <Input
            label="Nombre d'étages"
            type="number"
            value={form.nombre_etages}
            onChange={(e) => setForm({ ...form, nombre_etages: e.target.value })}
          />
          <Select
            label="Type de bâtiment"
            value={form.type_batiment}
            onChange={(e) => setForm({ ...form, type_batiment: e.target.value })}
            options={typeBatimentOptions}
          />
          <Select
            label="Type de structure"
            value={form.type_structure}
            onChange={(e) => setForm({ ...form, type_structure: e.target.value })}
            options={typeStructureOptions}
          />
          <Select
            label="Qualité de construction"
            value={form.qualite_construction}
            onChange={(e) => setForm({ ...form, qualite_construction: e.target.value })}
            options={qualiteOptions}
          />
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setShowModal(false)}>
            Annuler
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.nom_copropriete.trim() || !form.adresse_complete.trim()}
          >
            {saving ? 'Enregistrement…' : editId ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
