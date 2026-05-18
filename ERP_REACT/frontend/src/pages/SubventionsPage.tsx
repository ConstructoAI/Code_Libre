/**
 * ERP React - Subventions Page
 * Full feature parity with Streamlit subventions_manager.py.
 * 5 tabs: Catalogue / Eligibilite / Demandes / Dashboard / Ressources.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Landmark, Plus, BarChart3, BookOpen, Target, FileText, Layers,
  Search, ExternalLink, Phone, AlertTriangle, CheckCircle2,
  Calendar, Trash2, Send, Download,
  Upload, X, Info, Pencil,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { Badge } from '@/components/ui/Badge';
import type { BadgeColor } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { CommandBar } from '@/components/ui/CommandBar';
import StatCard from '@/components/dashboard/StatCard';
import { formatCurrency } from '@/utils/format';
import { useSubventionsStore } from '@/store/useSubventionsStore';
import type {
  ProgrammeFilters, SubventionDemande, SubventionProgramme,
  EligibilityProfile,
} from '@/api/subventions';

type TabKey =
  | 'catalogue' | 'eligibilite' | 'demandes' | 'dashboard' | 'ressources';

const STATUT_TO_BADGE: Record<string, BadgeColor> = {
  BROUILLON: 'gray',
  EN_PREPARATION: 'amber',
  SOUMISE: 'blue',
  EN_EVALUATION: 'purple',
  INFO_SUPPLEMENTAIRE: 'orange',
  APPROUVEE: 'green',
  REFUSEE: 'red',
  ANNULEE: 'gray',
  VERSEE: 'teal',
};

const NIVEAU_TO_BADGE: Record<string, BadgeColor> = {
  FEDERAL: 'red',
  PROVINCIAL: 'blue',
  MUNICIPAL: 'green',
  MIXTE: 'purple',
};

const TYPE_AIDE_TO_BADGE: Record<string, BadgeColor> = {
  SUBVENTION: 'green',
  PRET: 'blue',
  CREDIT_IMPOT: 'purple',
  MIXTE: 'amber',
  GARANTIE: 'indigo',
};

const DIFFICULTE_TO_BADGE: Record<string, BadgeColor> = {
  FACILE: 'green',
  MOYEN: 'amber',
  COMPLEXE: 'red',
};

const DOC_STATUT_TO_BADGE: Record<string, BadgeColor> = {
  A_FOURNIR: 'gray',
  FOURNI: 'blue',
  VALIDE: 'green',
  REJETE: 'red',
};

const DOC_STATUTS = ['A_FOURNIR', 'FOURNI', 'VALIDE', 'REJETE'] as const;

const CHART_COLORS = ['#7BAFD4', '#7DC4A5', '#F6C87A', '#E8919A', '#B09BD8', '#7DC4B5', '#D4A0B0', '#8B9FD4'];

const formatMoney = (v: number | null | undefined) =>
  v === null || v === undefined ? '--' : formatCurrency(Number(v));

// ============================================
// TABS NAV
// ============================================

function TabsNav({ tab, setTab }: { tab: TabKey; setTab: (t: TabKey) => void }) {
  const items: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'catalogue', label: 'Catalogue', icon: <BookOpen size={14} /> },
    { key: 'eligibilite', label: 'Eligibilite', icon: <Target size={14} /> },
    { key: 'demandes', label: 'Mes demandes', icon: <FileText size={14} /> },
    { key: 'dashboard', label: 'Tableau de bord', icon: <BarChart3 size={14} /> },
    { key: 'ressources', label: 'Ressources', icon: <Layers size={14} /> },
  ];
  return (
    <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => setTab(item.key)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${
            tab === item.key
              ? 'border-seaop-primary-600 text-seaop-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <span className="flex items-center gap-1.5">{item.icon} {item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ============================================
// CATALOGUE TAB
// ============================================

function CatalogueTab() {
  const {
    categories, programmes, constants, filters, isLoadingProgrammes,
    fetchProgrammes, setFilters,
  } = useSubventionsStore();
  const [localSearch, setLocalSearch] = useState(filters.search || '');

  // Debounced search — reads filters via store.getState() at timer-fire time,
  // so non-search filter changes applied concurrently are always preserved.
  useEffect(() => {
    const t = setTimeout(() => {
      const currentFilters = useSubventionsStore.getState().filters;
      if ((currentFilters.search || '') === (localSearch || '')) return;
      const next = { ...currentFilters, search: localSearch || undefined };
      setFilters(next);
      fetchProgrammes(next);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  const applyFilter = (patch: Partial<ProgrammeFilters>) => {
    const next = { ...filters, ...patch };
    if (patch.categorieId === 0) next.categorieId = undefined;
    setFilters(next);
    fetchProgrammes(next);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card padding="sm">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Select
            label="Catégorie"
            value={filters.categorieId ? String(filters.categorieId) : ''}
            onChange={(e) => applyFilter({ categorieId: e.target.value ? Number(e.target.value) : undefined })}
            options={[
              { value: '', label: 'Toutes' },
              ...categories.map((c) => ({ value: String(c.id), label: c.nom })),
            ]}
          />
          <Select
            label="Type d'aide"
            value={filters.typeAide || ''}
            onChange={(e) => applyFilter({ typeAide: e.target.value || undefined })}
            options={[
              { value: '', label: 'Tous' },
              ...Object.entries(constants?.typesAide || {}).map(([code, info]) => ({
                value: code, label: info.label,
              })),
            ]}
          />
          <Select
            label="Niveau"
            value={filters.niveauGouvernement || ''}
            onChange={(e) => applyFilter({ niveauGouvernement: e.target.value || undefined })}
            options={[
              { value: '', label: 'Tous' },
              ...Object.entries(constants?.niveauxGouvernement || {}).map(([code, info]) => ({
                value: code, label: info.label,
              })),
            ]}
          />
          <Select
            label="Difficulté"
            value={filters.difficulte || ''}
            onChange={(e) => applyFilter({ difficulte: e.target.value || undefined })}
            options={[
              { value: '', label: 'Toutes' },
              ...Object.entries(constants?.niveauxDifficulte || {}).map(([code, info]) => ({
                value: code, label: info.label,
              })),
            ]}
          />
          <div>
            <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">Recherche</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Programme, organisme..."
                className="block w-full rounded-lg border pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="text-sm text-gray-500">
        {isLoadingProgrammes ? 'Chargement...' : `${programmes.length} programme(s) trouvé(s)`}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {programmes.map((prog) => <ProgrammeCard key={prog.id} programme={prog} />)}
        {!isLoadingProgrammes && programmes.length === 0 && (
          <div className="col-span-full text-center text-gray-400 py-8">Aucun programme ne correspond aux filtres</div>
        )}
      </div>
    </div>
  );
}

function ProgrammeCard({ programme }: { programme: SubventionProgramme }) {
  const min = programme.montantMin || 0;
  const max = programme.montantMax || 0;
  const pct = programme.pourcentageAide || 0;
  return (
    <Card hover>
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 dark:text-white">{programme.nom}</h4>
          {programme.organisme && <p className="text-xs text-gray-500">{programme.organisme}</p>}
        </div>
        {programme.typeAide && (
          <Badge color={TYPE_AIDE_TO_BADGE[programme.typeAide] || 'gray'} size="sm">
            {programme.typeAide}
          </Badge>
        )}
      </div>
      {programme.description && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3">{programme.description}</p>
      )}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {programme.niveauGouvernement && (
          <Badge color={NIVEAU_TO_BADGE[programme.niveauGouvernement] || 'gray'} size="sm">
            {programme.niveauGouvernement}
          </Badge>
        )}
        {programme.difficulte && (
          <Badge color={DIFFICULTE_TO_BADGE[programme.difficulte] || 'gray'} size="sm">
            {programme.difficulte}
          </Badge>
        )}
        {programme.categorieNom && <Badge color="indigo" size="sm">{programme.categorieNom}</Badge>}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-3">
        <div>
          {max > 0 && <span className="font-medium text-gray-900 dark:text-white">{formatMoney(min)} - {formatMoney(max)}</span>}
          {pct > 0 && <span className="ml-2">({pct}%)</span>}
        </div>
        <div className="flex items-center gap-2">
          {programme.telephone && (
            <a href={`tel:${programme.telephone}`} className="text-gray-400 hover:text-seaop-primary-600" title={programme.telephone}>
              <Phone size={14} />
            </a>
          )}
          {programme.urlProgramme && (
            <a href={programme.urlProgramme} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-seaop-primary-600">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
      {programme.dateFin && (
        <div className="mt-2 text-xs text-[#9E7B1E] dark:text-[#F6D89A] flex items-center gap-1">
          <Calendar size={12} /> Date limite: {programme.dateFin}
        </div>
      )}
    </Card>
  );
}

// ============================================
// ELIGIBILITE TAB
// ============================================

function EligibiliteTab() {
  const {
    constants, eligibilityResult, isEligibilityRunning, checkEligibility, clearEligibilityResult,
  } = useSubventionsStore();
  const [profile, setProfile] = useState<EligibilityProfile>({
    taille: '',
    secteurs: [],
    region: '',
    typesProjet: [],
    budget: 50000,
    urgence: '',
  });

  const toggle = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];

  return (
    <div className="space-y-4">
      <Alert type="info" title="Verificateur d'eligibilite">
        Remplissez votre profil pour identifier les programmes de subventions qui correspondent a votre situation.
      </Alert>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Taille de l'entreprise"
            value={profile.taille || ''}
            onChange={(e) => setProfile({ ...profile, taille: e.target.value })}
            options={[
              { value: '', label: 'Choisir...' },
              ...(constants?.taillesEntreprise || []).map((t) => ({ value: t, label: t })),
            ]}
          />
          <Select
            label="Region"
            value={profile.region || ''}
            onChange={(e) => setProfile({ ...profile, region: e.target.value })}
            options={[
              { value: '', label: 'Choisir...' },
              ...(constants?.regions || []).map((r) => ({ value: r, label: r })),
            ]}
          />
          <div>
            <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">
              Budget approximatif
            </label>
            <Input
              type="number"
              min={0}
              step={10000}
              value={profile.budget ?? 0}
              onChange={(e) => setProfile({ ...profile, budget: Number(e.target.value) })}
            />
          </div>
          <Select
            label="Urgence"
            value={profile.urgence || ''}
            onChange={(e) => setProfile({ ...profile, urgence: e.target.value })}
            options={[
              { value: '', label: 'Choisir...' },
              ...(constants?.niveauxUrgence || []).map((u) => ({ value: u, label: u })),
            ]}
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">
            Secteurs d'activité
          </label>
          <div className="flex flex-wrap gap-2">
            {(constants?.secteursActivite || []).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setProfile({ ...profile, secteurs: toggle(profile.secteurs, s) })}
                className={`px-3 py-1 rounded-full text-xs border transition ${
                  profile.secteurs.includes(s)
                    ? 'bg-seaop-primary-600 text-white border-seaop-primary-600'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">
            Types de projet
          </label>
          <div className="flex flex-wrap gap-2">
            {(constants?.typesProjet || []).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setProfile({ ...profile, typesProjet: toggle(profile.typesProjet, t) })}
                className={`px-3 py-1 rounded-full text-xs border transition ${
                  profile.typesProjet.includes(t)
                    ? 'bg-seaop-primary-600 text-white border-seaop-primary-600'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button onClick={() => checkEligibility(profile)} disabled={isEligibilityRunning}>
            {isEligibilityRunning ? <Spinner size="sm" /> : <Target size={16} />}
            Vérifier mon éligibilité
          </Button>
          {eligibilityResult && (
            <Button variant="ghost" onClick={clearEligibilityResult}>Effacer</Button>
          )}
        </div>
      </Card>

      {eligibilityResult && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            {eligibilityResult.totalEligible} programme(s) potentiellement éligible(s)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {eligibilityResult.topMatches.map((prog) => (
              <Card key={prog.id}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 dark:text-white">{prog.nom}</h4>
                    <p className="text-xs text-gray-500">{prog.organisme}</p>
                  </div>
                  <Badge color={prog.scoreEligibilite && prog.scoreEligibilite >= 50 ? 'green' : 'amber'} size="md">
                    Score: {prog.scoreEligibilite || 0}
                  </Badge>
                </div>
                {prog.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">{prog.description}</p>
                )}
                <div className="text-xs text-gray-500">
                  {prog.montantMax && <span>Jusqu'à {formatMoney(prog.montantMax)}</span>}
                  {prog.urlProgramme && (
                    <a href={prog.urlProgramme} target="_blank" rel="noopener noreferrer"
                       className="ml-2 text-seaop-primary-600 hover:underline inline-flex items-center gap-1">
                      Site officiel <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </Card>
            ))}
            {eligibilityResult.topMatches.length === 0 && (
              <div className="col-span-full text-center text-gray-400 py-8">
                Aucun programme ne correspond parfaitement. Essayez d'ajuster votre profil.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// DEMANDES TAB
// ============================================

function DemandesTab() {
  const {
    demandes, programmes, currentDemande, isLoadingDemandes,
    createDemande, soumettreDemande, deleteDemande, fetchDemandes, fetchDemande,
    updateDemande, clearCurrentDemande,
  } = useSubventionsStore();
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ programmeId: 0, montantDemande: '', notes: '' });
  const [submitError, setSubmitError] = useState('');
  const [editing, setEditing] = useState<SubventionDemande | null>(null);
  const [editError, setEditError] = useState('');

  const filtered = useMemo(() => {
    let list = filterStatut ? demandes.filter((d) => d.statut === filterStatut) : demandes;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((d) => {
        const hay = `${d.programmeNom || ''} ${d.referenceExterne || ''} ${d.notes || ''} ${d.statut || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [demandes, filterStatut, search]);

  const handleCreate = async () => {
    setSubmitError('');
    if (!form.programmeId) {
      setSubmitError('Programme requis');
      return;
    }
    try {
      await createDemande({
        programmeId: form.programmeId,
        montantDemande: form.montantDemande ? Number(form.montantDemande) : undefined,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      setForm({ programmeId: 0, montantDemande: '', notes: '' });
    } catch (err) {
      setSubmitError((err as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer cette demande ?')) return;
    try {
      await deleteDemande(id);
    } catch { /* store shows error */ }
  };

  const handleSoumettre = async (id: number) => {
    if (!window.confirm('Soumettre cette demande ? Elle ne pourra plus être modifiée facilement.')) return;
    try {
      await soumettreDemande(id);
    } catch { /* store shows error */ }
  };

  const handleEditSave = async () => {
    if (!editing) return;
    setEditError('');
    try {
      await updateDemande(editing.id, {
        montantDemande: editing.montantDemande ?? undefined,
        montantAccorde: editing.montantAccorde ?? undefined,
        notes: editing.notes ?? undefined,
        motifRefus: editing.motifRefus ?? undefined,
        referenceExterne: editing.referenceExterne ?? undefined,
      });
      setEditing(null);
    } catch (err) {
      setEditError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <CommandBar
        actions={[
          { label: 'Nouvelle demande', icon: <Plus size={15} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
            </div>
            <div className="w-36 sm:w-44 shrink-0">
              <Select
                value={filterStatut}
                onChange={(e) => {
                  setFilterStatut(e.target.value);
                  fetchDemandes(e.target.value || undefined);
                }}
                options={[
                  { value: '', label: 'Tous les statuts' },
                  { value: 'BROUILLON', label: 'Brouillon' },
                  { value: 'SOUMISE', label: 'Soumise' },
                  { value: 'EN_EVALUATION', label: 'En évaluation' },
                  { value: 'APPROUVEE', label: 'Approuvée' },
                  { value: 'REFUSEE', label: 'Refusée' },
                  { value: 'VERSEE', label: 'Versée' },
                ]}
              />
            </div>
          </div>
        }
      />

      {isLoadingDemandes && <Spinner />}

      <div className="space-y-3">
        {filtered.map((d) => (
          <DemandeCard
            key={d.id}
            demande={d}
            onDelete={handleDelete}
            onSoumettre={handleSoumettre}
            onOpenDetail={() => fetchDemande(d.id)}
            onEdit={() => setEditing(d)}
          />
        ))}
        {!isLoadingDemandes && filtered.length === 0 && (
          <div className="text-center text-gray-400 py-8">Aucune demande de subvention</div>
        )}
      </div>

      {currentDemande && (
        <DemandeDetailModal onClose={clearCurrentDemande} />
      )}

      {editing && (
        <Modal isOpen onClose={() => { setEditing(null); setEditError(''); }} title={`Modifier ${editing.referenceInterne || '#' + editing.id}`}>
          <div className="space-y-4">
            <Input
              label="Montant demande ($)"
              type="number"
              min={0}
              step={1000}
              value={editing.montantDemande ?? ''}
              onChange={(e) => setEditing({ ...editing, montantDemande: e.target.value === '' ? null : Number(e.target.value) })}
            />
            <Input
              label="Montant accordé ($)"
              type="number"
              min={0}
              step={1000}
              value={editing.montantAccorde ?? ''}
              onChange={(e) => setEditing({ ...editing, montantAccorde: e.target.value === '' ? null : Number(e.target.value) })}
            />
            <Input
              label="Référence externe"
              value={editing.referenceExterne ?? ''}
              onChange={(e) => setEditing({ ...editing, referenceExterne: e.target.value })}
            />
            <Textarea
              label="Notes"
              rows={3}
              value={editing.notes ?? ''}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
            />
            {editing.statut === 'REFUSEE' && (
              <Textarea
                label="Motif de refus"
                rows={3}
                value={editing.motifRefus ?? ''}
                onChange={(e) => setEditing({ ...editing, motifRefus: e.target.value })}
              />
            )}
            {editError && <Alert type="error">{editError}</Alert>}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => { setEditing(null); setEditError(''); }}>Annuler</Button>
              <Button onClick={handleEditSave}>Enregistrer</Button>
            </div>
          </div>
        </Modal>
      )}

      <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); setSubmitError(''); }} title="Nouvelle demande de subvention">
        <div className="space-y-4">
          <Select
            label="Programme *"
            value={form.programmeId ? String(form.programmeId) : ''}
            onChange={(e) => setForm({ ...form, programmeId: Number(e.target.value) })}
            options={[
              { value: '', label: 'Choisir un programme...' },
              ...programmes.map((p) => ({ value: String(p.id), label: `${p.nom} (${p.organisme || ''})` })),
            ]}
          />
          <Input
            label="Montant demande ($)"
            type="number"
            min={0}
            step={1000}
            value={form.montantDemande}
            onChange={(e) => setForm({ ...form, montantDemande: e.target.value })}
          />
          <Textarea
            label="Notes"
            rows={4}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          {submitError && <Alert type="error">{submitError}</Alert>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.programmeId}>Créer la demande</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DemandeCard({
  demande, onDelete, onSoumettre, onOpenDetail, onEdit,
}: {
  demande: SubventionDemande;
  onDelete: (id: number) => void;
  onSoumettre: (id: number) => void;
  onOpenDetail: () => void;
  onEdit: () => void;
}) {
  const canSubmit = demande.statut === 'BROUILLON' || demande.statut === 'EN_PREPARATION';
  const canDelete = demande.statut !== 'APPROUVEE' && demande.statut !== 'VERSEE';
  const canEdit = demande.statut !== 'ANNULEE';
  return (
    <Card>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-gray-900 dark:text-white">{demande.referenceInterne || `#${demande.id}`}</h4>
            <Badge color={STATUT_TO_BADGE[demande.statut] || 'gray'} size="sm">{demande.statut}</Badge>
          </div>
          {demande.programmeNom && (
            <p className="text-sm text-gray-700 dark:text-gray-300">{demande.programmeNom}</p>
          )}
          {demande.organisme && <p className="text-xs text-gray-500">{demande.organisme}</p>}
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold text-gray-900 dark:text-white">{formatMoney(demande.montantDemande)}</div>
          {demande.montantAccorde && demande.montantAccorde > 0 && (
            <div className="text-xs text-[#4A9475] dark:text-[#9DD4B5]">Accordé: {formatMoney(demande.montantAccorde)}</div>
          )}
        </div>
      </div>
      {demande.notes && (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic mb-2 line-clamp-2">{demande.notes}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-2 mt-2">
        {demande.createdAt && <span>Créée: {new Date(demande.createdAt).toLocaleDateString('fr-CA')}</span>}
        {demande.dateSoumission && <span>Soumise: {demande.dateSoumission}</span>}
        {demande.dateDecision && <span>Décision: {demande.dateDecision}</span>}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button size="sm" variant="ghost" onClick={onOpenDetail}>
          <FileText size={14} /> Détails
        </Button>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil size={14} /> Modifier
          </Button>
        )}
        {canSubmit && (
          <Button size="sm" variant="primary" onClick={() => onSoumettre(demande.id)}>
            <Send size={14} /> Soumettre
          </Button>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" onClick={() => onDelete(demande.id)}>
            <Trash2 size={14} /> Supprimer
          </Button>
        )}
      </div>
    </Card>
  );
}

function DemandeDetailModal({ onClose }: { onClose: () => void }) {
  const {
    currentDemande, uploadDocument, downloadDocument, deleteDocument, updateDocumentStatus,
  } = useSubventionsStore();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!currentDemande) return null;

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploadError('');
    setIsUploading(true);
    try {
      await uploadDocument(currentDemande.id, file);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteDoc = async (docId: number) => {
    if (!window.confirm('Supprimer ce document ?')) return;
    try {
      await deleteDocument(docId);
    } catch { /* store shows error */ }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Demande ${currentDemande.referenceInterne || `#${currentDemande.id}`}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge color={STATUT_TO_BADGE[currentDemande.statut] || 'gray'} size="md">{currentDemande.statut}</Badge>
          {currentDemande.niveauGouvernement && (
            <Badge color={NIVEAU_TO_BADGE[currentDemande.niveauGouvernement] || 'gray'} size="sm">
              {currentDemande.niveauGouvernement}
            </Badge>
          )}
        </div>

        {currentDemande.programmeNom && (
          <div>
            <p className="text-xs text-gray-500">Programme</p>
            <p className="font-medium">{currentDemande.programmeNom}</p>
            {currentDemande.organisme && <p className="text-sm text-gray-500">{currentDemande.organisme}</p>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500">Montant demandé</p>
            <p className="font-semibold">{formatMoney(currentDemande.montantDemande)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Montant accordé</p>
            <p className="font-semibold text-[#4A9475] dark:text-[#9DD4B5]">{formatMoney(currentDemande.montantAccorde)}</p>
          </div>
          {currentDemande.dateSoumission && (
            <div>
              <p className="text-xs text-gray-500">Date soumission</p>
              <p className="text-sm">{currentDemande.dateSoumission}</p>
            </div>
          )}
          {currentDemande.dateDecision && (
            <div>
              <p className="text-xs text-gray-500">Date décision</p>
              <p className="text-sm">{currentDemande.dateDecision}</p>
            </div>
          )}
        </div>

        {currentDemande.notes && (
          <div>
            <p className="text-xs text-gray-500">Notes</p>
            <p className="text-sm italic">{currentDemande.notes}</p>
          </div>
        )}

        {currentDemande.motifRefus && (
          <Alert type="error" title="Motif de refus">{currentDemande.motifRefus}</Alert>
        )}

        {currentDemande.criteresEligibilite && (
          <div>
            <p className="text-xs text-gray-500">Critères du programme</p>
            <p className="text-sm">{currentDemande.criteresEligibilite}</p>
          </div>
        )}

        {/* Documents section */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold">Documents</h4>
            <label className="cursor-pointer">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
                disabled={isUploading}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.txt,.csv"
              />
              <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-seaop-primary-600 text-white hover:bg-seaop-primary-700">
                {isUploading ? <Spinner size="sm" /> : <Upload size={14} />}
                Téléverser
              </span>
            </label>
          </div>
          {uploadError && <Alert type="error">{uploadError}</Alert>}
          <div className="space-y-2">
            {(currentDemande.documents || []).map((doc) => (
              <div key={doc.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{doc.nom}</p>
                    <Badge color={DOC_STATUT_TO_BADGE[doc.statut || 'FOURNI'] || 'gray'} size="sm">
                      {doc.statut || 'FOURNI'}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500">
                    {doc.mimeType} - {((doc.taille || 0) / 1024).toFixed(1)} KB
                    {doc.uploadedAt && ` - ${new Date(doc.uploadedAt).toLocaleDateString('fr-CA')}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <select
                    value={doc.statut || 'FOURNI'}
                    onChange={(e) => updateDocumentStatus(doc.id, e.target.value)}
                    className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-1.5 py-1"
                    aria-label="Statut du document"
                  >
                    {DOC_STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button
                    onClick={() => downloadDocument(doc.id, doc.nom)}
                    className="p-1.5 text-gray-500 hover:text-seaop-primary-600"
                    title="Télécharger"
                    aria-label="Télécharger le document"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="p-1.5 text-gray-500 hover:text-[#B8616A]"
                    title="Supprimer"
                    aria-label="Supprimer le document"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            {(!currentDemande.documents || currentDemande.documents.length === 0) && (
              <p className="text-sm text-gray-400 text-center py-4">Aucun document téléversé</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// DASHBOARD TAB
// ============================================

function DashboardTab() {
  const { stats, expiringProgrammes, constants, isLoadingStats } = useSubventionsStore();

  if (isLoadingStats && !stats) return <Spinner />;
  if (!stats) return <div className="text-center text-gray-400 py-8">Aucune donnée</div>;

  const statutData = Object.entries(stats.demandesParStatut || {}).map(([statut, count]) => ({
    statut: constants?.statutsDemande?.[statut]?.label || statut,
    count,
  }));

  const programmesParCategorie = stats.programmesParCategorie ?? [];
  const programmesParNiveau = stats.programmesParNiveau ?? [];

  return (
    <div className="space-y-6">
      {/* KPI cards — StatCard pastel (harmonise avec Suivi) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Programmes actifs" value={stats.totalProgrammes ?? 0} icon={<BookOpen size={20} />} color="blue" />
        <StatCard label="Demandes totales" value={stats.totalDemandes ?? 0} icon={<FileText size={20} />} color="purple" />
        <StatCard label="Montant demandé" value={formatMoney(stats.montantTotalDemande ?? 0)} icon={<Target size={20} />} color="yellow" />
        <StatCard label="Montant accordé" value={formatMoney(stats.montantTotalAccorde ?? 0)} icon={<CheckCircle2 size={20} />} color="green" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">Programmes par catégorie</h3>
          {programmesParCategorie.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={programmesParCategorie}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="categorie" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="nombre" fill="#7BAFD4" />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-sm text-center py-8">Aucune donnée</p>}
        </Card>

        <Card>
          <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">Programmes par niveau</h3>
          {programmesParNiveau.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={programmesParNiveau}
                  dataKey="nombre"
                  nameKey="niveau"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label
                >
                  {programmesParNiveau.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-sm text-center py-8">Aucune donnée</p>}
        </Card>
      </div>

      {/* Demandes by status chart */}
      {statutData.length > 0 && (
        <Card>
          <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">Demandes par statut</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={statutData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="statut" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#10B981" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Expiring programmes alert */}
      <Card>
        <h3 className="font-semibold mb-3 text-gray-900 dark:text-white flex items-center gap-2">
          <AlertTriangle size={16} className="text-[#E8C17A]" /> Programmes expirant dans les 30 prochains jours
        </h3>
        {expiringProgrammes.length > 0 ? (
          <div className="space-y-2">
            {expiringProgrammes.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-[#E8C17A]/10 dark:bg-[#E8C17A]/20 border border-[#E8C17A]/40 dark:border-[#E8C17A]/30">
                <div>
                  <p className="font-medium text-sm text-gray-900 dark:text-white">{p.nom}</p>
                  <p className="text-xs text-gray-500">{p.organisme}</p>
                </div>
                <div className="text-xs text-[#9E7B1E] dark:text-[#E8D19A] font-medium">
                  <Calendar size={12} className="inline mr-1" />
                  {p.dateFin}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-[#7DC4A5]" /> Aucun programme n'expire dans les 30 prochains jours.
          </p>
        )}
      </Card>
    </div>
  );
}

// ============================================
// RESSOURCES TAB
// ============================================

function RessourcesTab() {
  const { resources } = useSubventionsStore();
  if (!resources) return <Spinner />;
  return (
    <div className="space-y-6">
      {/* Conseils pratiques */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {resources.conseils.map((section) => (
          <Card key={section.titre}>
            <h3 className="font-semibold mb-3 text-gray-900 dark:text-white flex items-center gap-2">
              <Info size={16} className="text-seaop-primary-600" /> {section.titre}
            </h3>
            <ul className="space-y-2">
              {section.items.map((item, i) => (
                <li key={i} className="text-sm text-gray-600 dark:text-gray-400 flex items-start gap-2">
                  <span className="text-seaop-primary-600 mt-0.5">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {/* Organismes */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">Organismes partenaires</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {resources.organismes.map((org) => (
            <Card key={org.nom} padding="sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-900 dark:text-white">{org.nom}</h4>
                  <p className="text-xs text-gray-500 italic">{org.role}</p>
                  {org.contact && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-1">
                      <Phone size={12} /> {org.contact}
                    </p>
                  )}
                </div>
                {org.url && (
                  <a href={org.url} target="_blank" rel="noopener noreferrer"
                     className="text-seaop-primary-600 hover:underline text-xs flex items-center gap-1 shrink-0">
                    Site <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Plan PME */}
      <Card>
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{resources.planPme.titre}</h3>
          <p className="text-2xl font-bold text-seaop-primary-600 mt-1">{resources.planPme.montantTotal}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{resources.planPme.description}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-2 text-left font-medium">Programme</th>
                <th className="px-4 py-2 text-right font-medium">Enveloppe</th>
                <th className="px-4 py-2 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {resources.planPme.programmes.map((p, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{p.programme}</td>
                  <td className="px-4 py-2 text-right text-seaop-primary-600 font-semibold">{p.enveloppe}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================
// PAGE
// ============================================

export default function SubventionsPage() {
  const [tab, setTab] = useState<TabKey>('catalogue');
  const {
    init, isLoading, error, successMessage, clearError, clearSuccess, constants,
    clearCurrentDemande, clearEligibilityResult,
  } = useSubventionsStore();

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear transient tab state when navigating away
  useEffect(() => {
    if (tab !== 'demandes') clearCurrentDemande();
    if (tab !== 'eligibilite') clearEligibilityResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (isLoading && !constants) return <SkeletonPage />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Landmark size={24} className="text-seaop-primary-600" />
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Subventions Quebec</h2>
      </div>

      {error && (
        <Alert type="error" onClose={clearError}>{error}</Alert>
      )}
      {successMessage && (
        <Alert type="success" onClose={clearSuccess}>{successMessage}</Alert>
      )}

      <TabsNav tab={tab} setTab={setTab} />

      {tab === 'catalogue' && <CatalogueTab />}
      {tab === 'eligibilite' && <EligibiliteTab />}
      {tab === 'demandes' && <DemandesTab />}
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'ressources' && <RessourcesTab />}
    </div>
  );
}
