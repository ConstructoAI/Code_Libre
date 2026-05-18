/**
 * ERP React - Conformite RBQ/CCQ Page
 * Full feature parity with Streamlit conformite_construction.py.
 *
 * 5 main tabs:
 *   1. Licences RBQ (CRUD + filters + 26 categories)
 *   2. Cartes CCQ (CRUD + filters + 28 trades with dynamic qualifications)
 *   3. Attestations fiscales (CRUD + PDF upload + 5 types)
 *   4. Verifications (AI project requirements)
 *   5. Tableau de bord (KPIs + score + alertes + calendrier)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit3,
  FileText,
  Plus,
  Search,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useConformiteStore } from '@/store/useConformiteStore';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { CommandBar } from '@/components/ui/CommandBar';
import StatCard from '@/components/dashboard/StatCard';
import { formatDate } from '@/utils/format';
import type {
  AiVerifyProjectResult,
  Attestation,
  AttestationCreateBody,
  AttestationUpdateBody,
  CarteCreateBody,
  CarteUpdateBody,
  CcqCarte,
  LicenceCreateBody,
  LicenceUpdateBody,
  RbqLicence,
} from '@/api/conformite';

type MainTab = 'rbq' | 'ccq' | 'attestations' | 'verifications' | 'dashboard';

// ============================================
// HELPERS
// ============================================

function isExpired(d?: string | null): boolean {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

function isExpiringSoon(d?: string | null, days = 60): boolean {
  if (!d) return false;
  const diff = (new Date(d).getTime() - Date.now()) / (1000 * 86400);
  return diff >= 0 && diff <= days;
}

function statutBadgeColor(statut: string, dateExpiration?: string | null): 'red' | 'yellow' | 'green' | 'gray' {
  if (isExpired(dateExpiration) || statut === 'EXPIREE') return 'red';
  if (isExpiringSoon(dateExpiration, 30)) return 'yellow';
  if (statut === 'SUSPENDUE' || statut === 'EN_RENOUVELLEMENT') return 'yellow';
  if (statut === 'ACTIVE' || statut === 'VALIDE') return 'green';
  return 'gray';
}

function priorityBadgeColor(priorite: string): 'red' | 'yellow' | 'green' {
  const p = priorite.toUpperCase();
  if (p === 'HAUTE' || p === 'CRITIQUE') return 'red';
  if (p === 'MOYENNE') return 'yellow';
  return 'green';
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function ConformitePage() {
  const store = useConformiteStore();
  const {
    constants,
    resources,
    licences,
    cartes,
    attestations,
    stats,
    alertes,
    isLoadingLicences,
    isLoadingCartes,
    isLoadingAttestations,
    error,
    successMessage,
    init,
    clearError,
    clearSuccess,
  } = store;

  const [tab, setTab] = useState<MainTab>('rbq');
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    (async () => {
      await init();
      setInitialized(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!initialized || !constants) return <SkeletonPage />;

  const tabs: { key: MainTab; label: string; short: string; icon: JSX.Element }[] = [
    { key: 'rbq', label: `Licences RBQ (${licences.length})`, short: 'RBQ', icon: <Shield size={16} /> },
    { key: 'ccq', label: `Cartes CCQ (${cartes.length})`, short: 'CCQ', icon: <UserCheck size={16} /> },
    { key: 'attestations', label: `Attestations (${attestations.length})`, short: 'Attest.', icon: <FileText size={16} /> },
    { key: 'verifications', label: 'Verifications', short: 'Verif.', icon: <CheckCircle2 size={16} /> },
    { key: 'dashboard', label: 'Tableau de bord', short: 'Dash', icon: <BarChart3 size={16} /> },
  ];

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={clearError}>{error}</Alert>}
      {successMessage && <Alert type="success" onClose={clearSuccess}>{successMessage}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
            Conformite RBQ / CCQ
          </h2>
          <p className="text-xs md:text-sm text-gray-500 mt-1">
            Gestion complete des licences, cartes de competence et attestations - Expert IA Quebec
          </p>
        </div>
        {stats && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">Score conformite:</span>
            <Badge
              color={stats.scoreConformite >= 80 ? 'green' : stats.scoreConformite >= 50 ? 'yellow' : 'red'}
              size="md"
            >
              {stats.scoreConformite}%
            </Badge>
          </div>
        )}
      </div>

      {/* Tabs navigation */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'border-seaop-primary-600 text-seaop-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t.icon}
            <span className="md:hidden">{t.short}</span>
            <span className="hidden md:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'rbq' && <RbqTab isLoading={isLoadingLicences} />}
      {tab === 'ccq' && <CcqTab isLoading={isLoadingCartes} />}
      {tab === 'attestations' && <AttestationsTab isLoading={isLoadingAttestations} />}
      {tab === 'verifications' && <VerificationsTab />}
      {tab === 'dashboard' && <DashboardTab />}
    </div>
  );
}

// ============================================
// TAB RBQ - Licences
// ============================================

function RbqTab({ isLoading }: { isLoading: boolean }) {
  const {
    constants,
    licences,
    fetchLicences,
    deleteLicence,
    currentLicenceStatutFilter,
    currentLicenceCategorieFilter,
  } = useConformiteStore();

  const [showCreate, setShowCreate] = useState(false);
  const [editLicence, setEditLicence] = useState<RbqLicence | null>(null);
  const [localSearch, setLocalSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      const s = useConformiteStore.getState();
      if ((s.currentLicenceSearchFilter || '') === (localSearch || '')) return;
      fetchLicences({
        statut: s.currentLicenceStatutFilter,
        categorie: s.currentLicenceCategorieFilter,
        search: localSearch || undefined,
      });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  const categories = constants?.categoriesRbq ?? [];
  const statuts = constants?.statutsLicence ?? {};

  const statutOptions = useMemo(
    () => [
      { value: '', label: 'Tous les statuts' },
      ...Object.entries(statuts).map(([code, s]) => ({ value: code, label: s.label })),
    ],
    [statuts],
  );

  const categorieOptions = useMemo(
    () => [
      { value: '', label: 'Toutes les categories' },
      ...categories.map((c) => ({ value: c.code, label: `${c.code} - ${c.label}` })),
    ],
    [categories],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm('Supprimer cette licence RBQ ?')) return;
      setDeletingId(id);
      try {
        await deleteLicence(id);
      } finally {
        setDeletingId(null);
      }
    },
    [deleteLicence],
  );

  return (
    <div className="space-y-4">
      <CommandBar
        actions={[
          { label: 'Nouvelle licence', icon: <Plus size={15} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="erp-input pl-9 w-full sm:w-48"
              />
            </div>
            <div className="w-36 sm:w-44 shrink-0">
              <Select
                options={statutOptions}
                value={currentLicenceStatutFilter ?? ''}
                onChange={(e) =>
                  fetchLicences({
                    statut: e.target.value || undefined,
                    categorie: currentLicenceCategorieFilter,
                    search: localSearch || undefined,
                  })
                }
              />
            </div>
            <div className="w-40 sm:w-48 shrink-0">
              <Select
                options={categorieOptions}
                value={currentLicenceCategorieFilter ?? ''}
                onChange={(e) =>
                  fetchLicences({
                    statut: currentLicenceStatutFilter,
                    categorie: e.target.value || undefined,
                    search: localSearch || undefined,
                  })
                }
              />
            </div>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      ) : licences.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-400 text-center py-8">Aucune licence RBQ enregistree</p>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card padding="sm" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Entreprise</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Catégories</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Cautionnement</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Expiration</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {licences.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-mono text-xs">{l.numeroLicence}</td>
                      <td className="px-4 py-3">{l.nomEntreprise}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(l.categories || []).slice(0, 3).map((c) => (
                            <Badge key={c} color="blue" size="sm">
                              {c}
                            </Badge>
                          ))}
                          {(l.categories || []).length > 3 && (
                            <Badge color="gray" size="sm">
                              +{(l.categories || []).length - 3}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {l.cautionnement ? `${l.cautionnement.toLocaleString('fr-CA')} $` : '--'}
                      </td>
                      <td className="px-4 py-3 text-xs">{formatDate(l.dateExpiration || '')}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge color={statutBadgeColor(l.statut, l.dateExpiration)} size="sm">
                          {statuts[l.statut]?.label || l.statut}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setEditLicence(l)}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-seaop-primary-600"
                            aria-label="Modifier"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(l.id)}
                            disabled={deletingId === l.id}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-[#B8616A] disabled:opacity-50"
                            aria-label="Supprimer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {licences.map((l) => (
              <Card key={l.id} padding="sm">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-xs text-seaop-primary-600">{l.numeroLicence}</span>
                  <Badge color={statutBadgeColor(l.statut, l.dateExpiration)} size="sm">
                    {statuts[l.statut]?.label || l.statut}
                  </Badge>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{l.nomEntreprise}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(l.categories || []).slice(0, 4).map((c) => (
                    <Badge key={c} color="blue" size="sm">
                      {c}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                  <span>Exp: {formatDate(l.dateExpiration || '')}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setEditLicence(l)} className="text-seaop-primary-600">
                      Modifier
                    </button>
                    <button
                      onClick={() => handleDelete(l.id)}
                      disabled={deletingId === l.id}
                      className="text-[#B8616A] disabled:opacity-50"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {showCreate && <LicenceModal onClose={() => setShowCreate(false)} />}
      {editLicence && <LicenceModal licence={editLicence} onClose={() => setEditLicence(null)} />}
    </div>
  );
}

// ============================================
// LICENCE MODAL (Create + Edit)
// ============================================

function LicenceModal({ licence, onClose }: { licence?: RbqLicence; onClose: () => void }) {
  const { constants, createLicence, updateLicence } = useConformiteStore();
  const isEdit = !!licence;
  const categories = constants?.categoriesRbq ?? [];
  const statuts = constants?.statutsLicence ?? {};

  const [form, setForm] = useState({
    numeroLicence: licence?.numeroLicence ?? '',
    nomEntreprise: licence?.nomEntreprise ?? '',
    categories: new Set<string>(licence?.categories ?? []),
    dateEmission: licence?.dateEmission ?? '',
    dateExpiration: licence?.dateExpiration ?? '',
    statut: licence?.statut ?? 'ACTIVE',
    cautionnement: licence?.cautionnement?.toString() ?? '',
    assuranceResponsabilite: licence?.assuranceResponsabilite?.toString() ?? '',
    notes: licence?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const toggleCategorie = (code: string) => {
    setForm((f) => {
      const next = new Set(f.categories);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { ...f, categories: next };
    });
  };

  const handleSave = async () => {
    if (!form.numeroLicence.trim() || !form.nomEntreprise.trim()) {
      setFormError('Le numéro de licence et le nom de l\'entreprise sont obligatoires');
      return;
    }
    if (form.dateEmission && form.dateExpiration && form.dateEmission > form.dateExpiration) {
      setFormError('La date d\'emission doit preceder la date d\'expiration');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload: LicenceCreateBody | LicenceUpdateBody = {
        numeroLicence: form.numeroLicence.trim(),
        nomEntreprise: form.nomEntreprise.trim(),
        categories: Array.from(form.categories),
        dateEmission: form.dateEmission || undefined,
        dateExpiration: form.dateExpiration || undefined,
        statut: form.statut,
        cautionnement: form.cautionnement ? parseFloat(form.cautionnement) : 0,
        assuranceResponsabilite: form.assuranceResponsabilite ? parseFloat(form.assuranceResponsabilite) : 0,
        notes: form.notes || undefined,
      };
      if (isEdit && licence) {
        await updateLicence(licence.id, payload);
      } else {
        await createLicence(payload as LicenceCreateBody);
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const statutOptions = Object.entries(statuts).map(([code, s]) => ({ value: code, label: s.label }));

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={isEdit ? 'Modifier la licence RBQ' : 'Nouvelle licence RBQ'}
      size="xl"
    >
      <div className="space-y-4">
        {formError && <Alert type="error">{formError}</Alert>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Numéro de licence *"
            value={form.numeroLicence}
            onChange={(e) => setForm({ ...form, numeroLicence: e.target.value })}
            placeholder="Ex: 5734-1234-01"
            required
          />
          <Input
            label="Nom de l'entreprise *"
            value={form.nomEntreprise}
            onChange={(e) => setForm({ ...form, nomEntreprise: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">
            Categories RBQ ({form.categories.size} selectionnees)
          </label>
          <div className="max-h-52 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-1">
            {categories.map((c) => (
              <label key={c.code} className="flex items-start gap-2 p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.categories.has(c.code)}
                  onChange={() => toggleCategorie(c.code)}
                  className="mt-0.5 rounded"
                />
                <div className="flex-1 text-xs">
                  <span className="font-mono font-semibold text-seaop-primary-600">{c.code}</span>
                  <span className="text-gray-700 dark:text-gray-300 ml-2">{c.label}</span>
                  <span className="text-gray-400 ml-2">({c.groupe})</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            label="Date d'emission"
            type="date"
            value={form.dateEmission}
            onChange={(e) => setForm({ ...form, dateEmission: e.target.value })}
          />
          <Input
            label="Date d'expiration"
            type="date"
            value={form.dateExpiration}
            onChange={(e) => setForm({ ...form, dateExpiration: e.target.value })}
          />
          <Select
            label="Statut"
            options={statutOptions}
            value={form.statut}
            onChange={(e) => setForm({ ...form, statut: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Cautionnement ($)"
            type="number"
            min={0}
            step={1000}
            value={form.cautionnement}
            onChange={(e) => setForm({ ...form, cautionnement: e.target.value })}
          />
          <Input
            label="Assurance responsabilite ($)"
            type="number"
            min={0}
            step={1000}
            value={form.assuranceResponsabilite}
            onChange={(e) => setForm({ ...form, assuranceResponsabilite: e.target.value })}
          />
        </div>

        <Textarea
          label="Notes"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSave} isLoading={saving}>
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// TAB CCQ - Cartes
// ============================================

function CcqTab({ isLoading }: { isLoading: boolean }) {
  const {
    constants,
    cartes,
    fetchCartes,
    deleteCarte,
    currentCarteStatutFilter,
    currentCarteMetierFilter,
  } = useConformiteStore();

  const [showCreate, setShowCreate] = useState(false);
  const [editCarte, setEditCarte] = useState<CcqCarte | null>(null);
  const [localSearch, setLocalSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const s = useConformiteStore.getState();
      if ((s.currentCarteSearchFilter || '') === (localSearch || '')) return;
      fetchCartes({
        statut: s.currentCarteStatutFilter,
        metier: s.currentCarteMetierFilter,
        search: localSearch || undefined,
      });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  const metiers = constants?.metiersCcq ?? [];
  const statuts = constants?.statutsCarteCcq ?? {};

  const statutOptions = useMemo(
    () => [
      { value: '', label: 'Tous les statuts' },
      ...Object.entries(statuts).map(([code, s]) => ({ value: code, label: s.label })),
    ],
    [statuts],
  );

  const metierOptions = useMemo(
    () => [
      { value: '', label: 'Tous les metiers' },
      ...metiers.map((m) => ({ value: m.nom, label: m.nom })),
    ],
    [metiers],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm('Supprimer cette carte CCQ ?')) return;
      setDeletingId(id);
      try {
        await deleteCarte(id);
      } finally {
        setDeletingId(null);
      }
    },
    [deleteCarte],
  );

  return (
    <div className="space-y-4">
      <CommandBar
        actions={[
          { label: 'Nouvelle carte', icon: <Plus size={15} />, onClick: () => setShowCreate(true), variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                className="erp-input pl-9 w-full sm:w-48"
              />
            </div>
            <div className="w-32 sm:w-40 shrink-0">
              <Select
                options={statutOptions}
                value={currentCarteStatutFilter ?? ''}
                onChange={(e) =>
                  fetchCartes({
                    statut: e.target.value || undefined,
                    metier: currentCarteMetierFilter,
                    search: localSearch || undefined,
                  })
                }
              />
            </div>
            <div className="w-40 sm:w-48 shrink-0">
              <Select
                options={metierOptions}
                value={currentCarteMetierFilter ?? ''}
                onChange={(e) =>
                  fetchCartes({
                    statut: currentCarteStatutFilter,
                    metier: e.target.value || undefined,
                    search: localSearch || undefined,
                  })
                }
              />
            </div>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      ) : cartes.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-400 text-center py-8">Aucune carte CCQ enregistree</p>
        </Card>
      ) : (
        <>
          <Card padding="sm" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Employé</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Métier</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Qualification</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Heures</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">ASP</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Renouvellement</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {cartes.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3">{c.employeNom || `#${c.employeeId}`}</td>
                      <td className="px-4 py-3 font-mono text-xs">{c.numeroCarte}</td>
                      <td className="px-4 py-3">{c.metierPrincipal}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{c.qualification || '--'}</td>
                      <td className="px-4 py-3 text-xs">{(c.heuresTotales ?? 0).toLocaleString('fr-CA')} h</td>
                      <td className="px-4 py-3">
                        {c.aspConstruction ? (
                          <Badge color="green" size="sm">
                            ASP
                          </Badge>
                        ) : (
                          <span className="text-gray-400 text-xs">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">{formatDate(c.dateRenouvellement || '')}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge color={statutBadgeColor(c.statut, c.dateRenouvellement)} size="sm">
                          {statuts[c.statut]?.label || c.statut}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setEditCarte(c)}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-seaop-primary-600"
                            aria-label="Modifier"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            disabled={deletingId === c.id}
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-[#B8616A] disabled:opacity-50"
                            aria-label="Supprimer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="md:hidden space-y-2">
            {cartes.map((c) => (
              <Card key={c.id} padding="sm">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">
                    {c.employeNom || `#${c.employeeId}`}
                  </span>
                  <Badge color={statutBadgeColor(c.statut, c.dateRenouvellement)} size="sm">
                    {statuts[c.statut]?.label || c.statut}
                  </Badge>
                </div>
                <div className="text-xs text-gray-500">
                  {c.metierPrincipal} {c.qualification ? `(${c.qualification})` : ''}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
                  <span className="font-mono">{c.numeroCarte}</span>
                  <span>{(c.heuresTotales ?? 0).toLocaleString('fr-CA')} h</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                  <span>Renouv: {formatDate(c.dateRenouvellement || '')}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setEditCarte(c)} className="text-seaop-primary-600">
                      Modifier
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      disabled={deletingId === c.id}
                      className="text-[#B8616A] disabled:opacity-50"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {showCreate && <CarteModal onClose={() => setShowCreate(false)} />}
      {editCarte && <CarteModal carte={editCarte} onClose={() => setEditCarte(null)} />}
    </div>
  );
}

// ============================================
// CARTE MODAL (Create + Edit, dynamic qualifications)
// ============================================

function CarteModal({ carte, onClose }: { carte?: CcqCarte; onClose: () => void }) {
  const { constants, createCarte, updateCarte } = useConformiteStore();
  const isEdit = !!carte;
  const metiers = constants?.metiersCcq ?? [];
  const statuts = constants?.statutsCarteCcq ?? {};

  const [form, setForm] = useState({
    employeeId: carte?.employeeId?.toString() ?? '',
    numeroCarte: carte?.numeroCarte ?? '',
    metierPrincipal: carte?.metierPrincipal ?? metiers[0]?.nom ?? '',
    qualification: carte?.qualification ?? '',
    metiersAdditionnels: new Set<string>(carte?.metiersAdditionnels ?? []),
    heuresTotales: carte?.heuresTotales?.toString() ?? '0',
    dateEmission: carte?.dateEmission ?? '',
    dateRenouvellement: carte?.dateRenouvellement ?? '',
    aspConstruction: carte?.aspConstruction ?? false,
    statut: carte?.statut ?? 'ACTIVE',
    notes: carte?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Dynamic qualifications based on metier selection
  const currentMetier = metiers.find((m) => m.nom === form.metierPrincipal);
  const qualifications = currentMetier?.qualifications ?? ['Compagnon'];

  // Auto-select qualification when switching metiers
  useEffect(() => {
    if (qualifications.length > 0 && !qualifications.includes(form.qualification)) {
      setForm((f) => ({ ...f, qualification: qualifications[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.metierPrincipal]);

  const toggleMetierAdd = (nom: string) => {
    setForm((f) => {
      const next = new Set(f.metiersAdditionnels);
      if (next.has(nom)) next.delete(nom);
      else next.add(nom);
      return { ...f, metiersAdditionnels: next };
    });
  };

  const handleSave = async () => {
    if (!form.numeroCarte.trim() || !form.metierPrincipal) {
      setFormError('Le numéro de carte et le métier sont obligatoires');
      return;
    }
    const empId = parseInt(form.employeeId, 10);
    if (!empId || empId <= 0) {
      setFormError('L\'ID employé doit être un entier valide');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload: CarteCreateBody | CarteUpdateBody = {
        numeroCarte: form.numeroCarte.trim(),
        metierPrincipal: form.metierPrincipal,
        qualification: form.qualification || undefined,
        metiersAdditionnels: Array.from(form.metiersAdditionnels),
        heuresTotales: parseInt(form.heuresTotales, 10) || 0,
        dateEmission: form.dateEmission || undefined,
        dateRenouvellement: form.dateRenouvellement || undefined,
        aspConstruction: form.aspConstruction,
        statut: form.statut,
        notes: form.notes || undefined,
      };
      if (isEdit && carte) {
        await updateCarte(carte.id, payload);
      } else {
        await createCarte({ ...payload, employeeId: empId } as CarteCreateBody);
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const metierOptions = metiers.map((m) => ({ value: m.nom, label: m.nom }));
  const qualificationOptions = qualifications.map((q) => ({ value: q, label: q }));
  const statutOptions = Object.entries(statuts).map(([code, s]) => ({ value: code, label: s.label }));

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={isEdit ? 'Modifier la carte CCQ' : 'Nouvelle carte CCQ'}
      size="xl"
    >
      <div className="space-y-4">
        {formError && <Alert type="error">{formError}</Alert>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="ID Employé *"
            type="number"
            value={form.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
            disabled={isEdit}
            required
          />
          <Input
            label="Numéro de carte *"
            value={form.numeroCarte}
            onChange={(e) => setForm({ ...form, numeroCarte: e.target.value })}
            placeholder="Ex: CCQ-12345"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label="Métier principal"
            options={metierOptions}
            value={form.metierPrincipal}
            onChange={(e) => setForm({ ...form, metierPrincipal: e.target.value })}
          />
          <Select
            label="Qualification"
            options={qualificationOptions}
            value={form.qualification}
            onChange={(e) => setForm({ ...form, qualification: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">
            Metiers additionnels ({form.metiersAdditionnels.size})
          </label>
          <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
            <div className="grid grid-cols-2 gap-1">
              {metiers
                .filter((m) => m.nom !== form.metierPrincipal)
                .map((m) => (
                  <label
                    key={m.nom}
                    className="flex items-center gap-2 p-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={form.metiersAdditionnels.has(m.nom)}
                      onChange={() => toggleMetierAdd(m.nom)}
                    />
                    <span className="text-gray-700 dark:text-gray-300 truncate">{m.nom}</span>
                  </label>
                ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            label="Heures totales"
            type="number"
            min={0}
            step={100}
            value={form.heuresTotales}
            onChange={(e) => setForm({ ...form, heuresTotales: e.target.value })}
          />
          <Input
            label="Date d'emission"
            type="date"
            value={form.dateEmission}
            onChange={(e) => setForm({ ...form, dateEmission: e.target.value })}
          />
          <Input
            label="Date de renouvellement"
            type="date"
            value={form.dateRenouvellement}
            onChange={(e) => setForm({ ...form, dateRenouvellement: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 pt-6 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.aspConstruction}
              onChange={(e) => setForm({ ...form, aspConstruction: e.target.checked })}
            />
            Formation ASP Construction valide
          </label>
          <Select
            label="Statut"
            options={statutOptions}
            value={form.statut}
            onChange={(e) => setForm({ ...form, statut: e.target.value })}
          />
        </div>

        <Textarea
          label="Notes"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSave} isLoading={saving}>
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// TAB ATTESTATIONS
// ============================================

function AttestationsTab({ isLoading }: { isLoading: boolean }) {
  const {
    constants,
    attestations,
    fetchAttestations,
    deleteAttestation,
    downloadAttestationFile,
    currentAttestationStatutFilter,
    currentAttestationTypeFilter,
  } = useConformiteStore();

  const [showCreate, setShowCreate] = useState(false);
  const [editAtt, setEditAtt] = useState<Attestation | null>(null);
  const [uploadAtt, setUploadAtt] = useState<Attestation | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const types = constants?.typesAttestation ?? [];
  const statuts = constants?.statutsAttestation ?? {};

  const filteredAttestations = useMemo(() => {
    if (!search) return attestations;
    const q = search.toLowerCase();
    return attestations.filter((a) => {
      const typeInfo = types.find((t) => t.code === a.type);
      const hay = `${a.type || ''} ${typeInfo?.label || ''} ${typeInfo?.organisme || ''} ${a.numero || ''} ${a.notes || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [attestations, search, types]);

  const statutOptions = useMemo(
    () => [
      { value: '', label: 'Tous les statuts' },
      ...Object.entries(statuts).map(([code, s]) => ({ value: code, label: s.label })),
    ],
    [statuts],
  );

  const typeOptions = useMemo(
    () => [
      { value: '', label: 'Tous les types' },
      ...types.map((t) => ({ value: t.code, label: t.label })),
    ],
    [types],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm('Supprimer cette attestation ?')) return;
      setDeletingId(id);
      try {
        await deleteAttestation(id);
      } finally {
        setDeletingId(null);
      }
    },
    [deleteAttestation],
  );

  const handleDownload = async (a: Attestation) => {
    if (!a.fichierNom) return;
    await downloadAttestationFile(a.id, a.fichierNom);
  };

  return (
    <div className="space-y-4">
      <CommandBar
        actions={[
          { label: 'Nouvelle attestation', icon: <Plus size={15} />, onClick: () => setShowCreate(true), variant: 'primary' },
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
                options={statutOptions}
                value={currentAttestationStatutFilter ?? ''}
                onChange={(e) =>
                  fetchAttestations({
                    statut: e.target.value || undefined,
                    type: currentAttestationTypeFilter,
                  })
                }
              />
            </div>
            <div className="w-40 sm:w-48 shrink-0">
              <Select
                options={typeOptions}
                value={currentAttestationTypeFilter ?? ''}
                onChange={(e) =>
                  fetchAttestations({
                    statut: currentAttestationStatutFilter,
                    type: e.target.value || undefined,
                  })
                }
              />
            </div>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      ) : filteredAttestations.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-400 text-center py-8">Aucune attestation enregistree</p>
        </Card>
      ) : (
        <>
          <Card padding="sm" className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Numéro</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Organisme</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Expiration</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Fichier</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredAttestations.map((a) => {
                    const typeInfo = types.find((t) => t.code === a.type);
                    return (
                      <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3">{typeInfo?.label || a.type}</td>
                        <td className="px-4 py-3 font-mono text-xs">{a.numero}</td>
                        <td className="px-4 py-3 text-gray-500">{typeInfo?.organisme || '--'}</td>
                        <td className="px-4 py-3 text-xs">{formatDate(a.dateExpiration || '')}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge color={statutBadgeColor(a.statut, a.dateExpiration)} size="sm">
                            {statuts[a.statut]?.label || a.statut}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {a.fichierNom ? (
                            <button
                              onClick={() => handleDownload(a)}
                              className="text-seaop-primary-600 hover:underline text-xs inline-flex items-center gap-1"
                            >
                              <Download size={12} />
                              {a.taille ? `${Math.round(a.taille / 1024)} Ko` : 'Fichier'}
                            </button>
                          ) : (
                            <button
                              onClick={() => setUploadAtt(a)}
                              className="text-gray-400 hover:text-seaop-primary-600 text-xs inline-flex items-center gap-1"
                            >
                              <Upload size={12} /> Televerser
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => setEditAtt(a)}
                              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-seaop-primary-600"
                              aria-label="Modifier"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(a.id)}
                              disabled={deletingId === a.id}
                              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-[#B8616A] disabled:opacity-50"
                              aria-label="Supprimer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="md:hidden space-y-2">
            {filteredAttestations.map((a) => {
              const typeInfo = types.find((t) => t.code === a.type);
              return (
                <Card key={a.id} padding="sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {typeInfo?.label || a.type}
                    </span>
                    <Badge color={statutBadgeColor(a.statut, a.dateExpiration)} size="sm">
                      {statuts[a.statut]?.label || a.statut}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-500">
                    <span className="font-mono">{a.numero}</span> · {typeInfo?.organisme || '--'}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Exp: {formatDate(a.dateExpiration || '')}</div>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    {a.fichierNom ? (
                      <button onClick={() => handleDownload(a)} className="text-seaop-primary-600 inline-flex items-center gap-1">
                        <Download size={12} /> Télécharger
                      </button>
                    ) : (
                      <button onClick={() => setUploadAtt(a)} className="text-gray-400 inline-flex items-center gap-1">
                        <Upload size={12} /> Televerser
                      </button>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => setEditAtt(a)} className="text-seaop-primary-600">
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
                        disabled={deletingId === a.id}
                        className="text-[#B8616A] disabled:opacity-50"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {showCreate && <AttestationModal onClose={() => setShowCreate(false)} />}
      {editAtt && <AttestationModal attestation={editAtt} onClose={() => setEditAtt(null)} />}
      {uploadAtt && <UploadAttestationModal attestation={uploadAtt} onClose={() => setUploadAtt(null)} />}
    </div>
  );
}

// ============================================
// ATTESTATION MODAL (Create + Edit)
// ============================================

function AttestationModal({ attestation, onClose }: { attestation?: Attestation; onClose: () => void }) {
  const { constants, createAttestation, updateAttestation } = useConformiteStore();
  const isEdit = !!attestation;
  const types = constants?.typesAttestation ?? [];
  const statuts = constants?.statutsAttestation ?? {};

  const [form, setForm] = useState({
    type: attestation?.type ?? (types[0]?.code ?? ''),
    numero: attestation?.numero ?? '',
    dateEmission: attestation?.dateEmission ?? '',
    dateExpiration: attestation?.dateExpiration ?? '',
    statut: attestation?.statut ?? 'VALIDE',
    notes: attestation?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!form.numero.trim() || !form.type) {
      setFormError('Le type et le numéro sont obligatoires');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload: AttestationCreateBody | AttestationUpdateBody = {
        type: form.type,
        numero: form.numero.trim(),
        dateEmission: form.dateEmission || undefined,
        dateExpiration: form.dateExpiration || undefined,
        statut: form.statut,
        notes: form.notes || undefined,
      };
      if (isEdit && attestation) {
        await updateAttestation(attestation.id, payload);
      } else {
        await createAttestation(payload as AttestationCreateBody);
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = types.map((t) => ({ value: t.code, label: t.label }));
  const statutOptions = Object.entries(statuts).map(([code, s]) => ({ value: code, label: s.label }));

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={isEdit ? 'Modifier l\'attestation' : 'Nouvelle attestation'}
      size="lg"
    >
      <div className="space-y-4">
        {formError && <Alert type="error">{formError}</Alert>}

        <Select
          label="Type d'attestation *"
          options={typeOptions}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        />

        <Input
          label="Numéro d'attestation *"
          value={form.numero}
          onChange={(e) => setForm({ ...form, numero: e.target.value })}
          required
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            label="Date d'emission"
            type="date"
            value={form.dateEmission}
            onChange={(e) => setForm({ ...form, dateEmission: e.target.value })}
          />
          <Input
            label="Date d'expiration"
            type="date"
            value={form.dateExpiration}
            onChange={(e) => setForm({ ...form, dateExpiration: e.target.value })}
          />
          <Select
            label="Statut"
            options={statutOptions}
            value={form.statut}
            onChange={(e) => setForm({ ...form, statut: e.target.value })}
          />
        </div>

        <Textarea
          label="Notes"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSave} isLoading={saving}>
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// UPLOAD ATTESTATION MODAL
// ============================================

function UploadAttestationModal({ attestation, onClose }: { attestation: Attestation; onClose: () => void }) {
  const { uploadAttestationFile } = useConformiteStore();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      await uploadAttestationFile(attestation.id, file);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur');
      setUploading(false);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Televerser un document" size="md">
      <div className="space-y-4">
        {formError && <Alert type="error">{formError}</Alert>}

        <p className="text-sm text-gray-500">
          Types acceptes: PDF, JPG, PNG, WebP. Taille maximum: 10 Mo.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-seaop-primary-50 file:text-seaop-primary-700 hover:file:bg-seaop-primary-100"
        />

        {file && (
          <div className="text-xs text-gray-500">
            Fichier selectionne: <span className="font-medium">{file.name}</span> (
            {Math.round(file.size / 1024)} Ko)
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleUpload} isLoading={uploading} disabled={!file}>
            Televerser
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// TAB VERIFICATIONS (AI Verify Project)
// ============================================

function VerificationsTab() {
  const { constants, aiVerifyProject, aiVerifyProjectResult, isAiRunning } = useConformiteStore();

  const [form, setForm] = useState({
    typeProjet: constants?.typesProjet?.[0] ?? 'Residentiel unifamilial',
    valeur: '100000',
    region: constants?.regions?.[0] ?? 'Montreal',
    travaux: new Set<string>(),
  });

  const toggleTravail = (t: string) => {
    setForm((f) => {
      const next = new Set(f.travaux);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return { ...f, travaux: next };
    });
  };

  const handleSubmit = async () => {
    if (form.travaux.size === 0) return;
    await aiVerifyProject({
      typeProjet: form.typeProjet,
      valeur: parseFloat(form.valeur) || 0,
      region: form.region,
      travaux: Array.from(form.travaux),
    });
  };

  const typeOptions = (constants?.typesProjet ?? []).map((t) => ({ value: t, label: t }));
  const regionOptions = (constants?.regions ?? []).map((r) => ({ value: r, label: r }));
  const travauxOptions = constants?.typesTravaux ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CheckCircle2 size={18} className="text-seaop-primary-600" />
            Verification d'exigences reglementaires (IA)
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Entrez les details d'un projet pour connaitre toutes les exigences RBQ, CCQ, permis, cautionnement.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label="Type de projet"
            options={typeOptions}
            value={form.typeProjet}
            onChange={(e) => setForm({ ...form, typeProjet: e.target.value })}
          />
          <Input
            label="Valeur estimee ($)"
            type="number"
            min={0}
            step={10000}
            value={form.valeur}
            onChange={(e) => setForm({ ...form, valeur: e.target.value })}
          />
        </div>

        <div className="mt-3">
          <Select
            label="Region"
            options={regionOptions}
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Types de travaux ({form.travaux.size} selectionnes) *
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
            {travauxOptions.map((t) => (
              <label
                key={t}
                className="flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer text-xs"
              >
                <input type="checkbox" checked={form.travaux.has(t)} onChange={() => toggleTravail(t)} />
                <span className="text-gray-700 dark:text-gray-300">{t}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <Button onClick={handleSubmit} isLoading={isAiRunning} disabled={form.travaux.size === 0} leftIcon={<Sparkles size={16} />}>
            Verifier les exigences
          </Button>
        </div>
      </Card>

      {aiVerifyProjectResult && <VerifyProjectResultPanel result={aiVerifyProjectResult} />}
    </div>
  );
}

function VerifyProjectResultPanel({ result }: { result: AiVerifyProjectResult }) {
  return (
    <Card>
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
        <ClipboardList size={18} className="text-seaop-primary-600" />
        Exigences reglementaires
      </h3>

      <div className="space-y-4">
        {result.licencesRbqRequises && result.licencesRbqRequises.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Licences RBQ requises</h4>
            <ul className="space-y-1 text-sm">
              {result.licencesRbqRequises.map((l, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Badge color={l.obligatoire ? 'red' : 'yellow'} size="sm">
                    {l.obligatoire ? 'Obligatoire' : 'Recommandee'}
                  </Badge>
                  <span>
                    <span className="font-mono font-semibold">{l.categorie}</span> - {l.description}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.metiersCcqRequis && result.metiersCcqRequis.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Métiers CCQ requis</h4>
            <ul className="space-y-1 text-sm">
              {result.metiersCcqRequis.map((m, i) => (
                <li key={i}>
                  • <strong>{m.metier}</strong>: ~{m.nombreEstime} ({m.qualification})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {result.permisRequis && result.permisRequis.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Permis requis</h4>
              <ul className="text-sm space-y-1">
                {result.permisRequis.map((p, i) => (
                  <li key={i}>
                    • {p.type} ({p.organisme})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.attestationsRequises && result.attestationsRequises.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Attestations requises</h4>
              <ul className="text-sm space-y-1">
                {result.attestationsRequises.map((a, i) => (
                  <li key={i}>
                    • {a.type} - {a.organisme}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div>
            <div className="text-xs text-gray-500">Cautionnement minimum</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white">
              {(result.cautionnementMinimum ?? 0).toLocaleString('fr-CA')} $
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Assurance responsabilite minimum</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white">
              {(result.assuranceResponsabiliteMinimum ?? 0).toLocaleString('fr-CA')} $
            </div>
          </div>
        </div>

        {result.ratioCompagnonApprenti && (
          <div className="text-sm">
            <strong>Ratio compagnon/apprenti:</strong> {result.ratioCompagnonApprenti}
          </div>
        )}

        {result.estimationDelaiConformite && (
          <div className="text-sm">
            <strong>Delai estime mise en conformite:</strong> {result.estimationDelaiConformite}
          </div>
        )}

        {result.alertes && result.alertes.length > 0 && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-semibold text-[#9E7B1E] dark:text-[#E8D19A] mb-2 flex items-center gap-1">
              <AlertTriangle size={14} /> Alertes
            </h4>
            <ul className="space-y-1 text-sm">
              {result.alertes.map((a, i) => (
                <li key={i} className="text-[#9E7B1E] dark:text-[#E8D19A]">
                  • {a}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================
// TAB DASHBOARD
// ============================================

function DashboardTab() {
  const { stats, alertes, resources, fetchStatistics, fetchAlertes } = useConformiteStore();

  useEffect(() => {
    fetchStatistics();
    fetchAlertes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const scoreColor: 'green' | 'yellow' | 'red' =
    stats.scoreConformite >= 80 ? 'green' : stats.scoreConformite >= 50 ? 'yellow' : 'red';

  return (
    <div className="space-y-4">
      {/* KPIs — StatCard pastel (harmonise avec Suivi) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Licences RBQ actives"
          value={stats.licencesActives}
          icon={<Shield size={20} />}
          color="blue"
          trend={stats.totalLicences > 0 ? `${stats.totalLicences} total` : undefined}
        />
        <StatCard
          label="Cartes CCQ actives"
          value={stats.cartesActives}
          icon={<UserCheck size={20} />}
          color="green"
          trend={stats.totalCartes > 0 ? `${stats.totalCartes} total` : undefined}
        />
        <StatCard
          label="Attestations valides"
          value={stats.attestationsValides}
          icon={<FileText size={20} />}
          color="purple"
          trend={stats.totalAttestations > 0 ? `${stats.totalAttestations} total` : undefined}
        />
        <StatCard
          label="Score conformite"
          value={`${stats.scoreConformite}%`}
          icon={<BarChart3 size={20} />}
          color={scoreColor}
        />
      </div>

      {/* Alerts row — StatCard pastel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard
          label="A renouveler (60 jours)"
          value={stats.licencesARenouveler + stats.cartesARenouveler + stats.attestationsARenouveler}
          icon={<AlertTriangle size={20} />}
          color="yellow"
        />
        <StatCard
          label="Expires"
          value={stats.licencesExpirees + stats.cartesExpirees + stats.attestationsExpirees}
          icon={<XCircle size={20} />}
          color="red"
        />
        <StatCard
          label="Cautionnement total"
          value={`${stats.cautionnementTotal.toLocaleString('fr-CA')} $`}
          icon={<Shield size={20} />}
          color="blue"
        />
      </div>

      {/* Alertes list */}
      <Card>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-[#E8C17A]" />
          Alertes de conformite ({alertes.length})
        </h3>
        {alertes.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-6 flex items-center justify-center gap-2">
            <CheckCircle2 size={16} className="text-[#7DC4A5]" />
            Aucune alerte - Tous les documents sont a jour
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {alertes.slice(0, 30).map((a, i) => (
              <div
                key={`${a.type}-${a.itemId}-${i}`}
                className="flex items-center gap-3 p-2 rounded border border-gray-200 dark:border-gray-700 text-sm"
              >
                <Badge color={priorityBadgeColor(a.priorite)} size="sm">
                  {a.priorite}
                </Badge>
                <div className="flex-1 text-gray-700 dark:text-gray-300">{a.message}</div>
                {a.dateReference && (
                  <span className="text-xs text-gray-400">{formatDate(a.dateReference)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Repartitions: RBQ categories, CCQ metiers, Attestation types */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.repartitionLicencesCategorie.length > 0 && (
          <Card>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Répartition par catégorie (RBQ)</h3>
            <div className="space-y-1.5">
              {stats.repartitionLicencesCategorie.slice(0, 10).map((c) => (
                <div key={c.categorie} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300 font-mono text-xs">{c.categorie}</span>
                  <Badge color="teal" size="sm">
                    {c.nombre}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
        {stats.repartitionCartesMetier.length > 0 && (
          <Card>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Repartition par metier (CCQ)</h3>
            <div className="space-y-1.5">
              {stats.repartitionCartesMetier.slice(0, 10).map((m) => (
                <div key={m.metier} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">{m.metier}</span>
                  <Badge color="blue" size="sm">
                    {m.nombre}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
        {stats.repartitionAttestationsType.length > 0 && (
          <Card>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Repartition par type (attestations)</h3>
            <div className="space-y-1.5">
              {stats.repartitionAttestationsType.map((t) => (
                <div key={t.type} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">{t.type}</span>
                  <Badge color="purple" size="sm">
                    {t.nombre}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Resources */}
      {resources && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Organismes de reference</h3>
            <div className="space-y-2 text-sm">
              {resources.organismes.slice(0, 6).map((o) => (
                <div key={o.nom} className="border-l-2 border-seaop-primary-400 pl-2">
                  <div className="font-medium text-gray-900 dark:text-white">{o.nom}</div>
                  <div className="text-xs text-gray-500">{o.role}</div>
                  {o.contact && <div className="text-xs text-seaop-primary-600">{o.contact}</div>}
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Conseils pratiques</h3>
            <div className="space-y-2 text-sm max-h-80 overflow-y-auto">
              {resources.conseils.map((c) => (
                <div key={c.titre}>
                  <div className="font-medium text-gray-900 dark:text-white">{c.titre}</div>
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-500 pl-3">
                    {c.items.slice(0, 3).map((item, i) => (
                      <li key={i}>• {item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
