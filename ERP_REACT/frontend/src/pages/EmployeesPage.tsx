/**
 * ERP React Frontend - Employees Page
 * Employee list with detail panel showing competences and time entries.
 */

import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, X, Mail, Phone, Pencil, Download, ChevronLeft, ShieldCheck, KeyRound } from 'lucide-react';
import * as employeesApi from '@/api/employees';
import type { Employee } from '@/api/employees';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { formatDate, formatCurrency } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { useColumnResize } from '@/hooks/useColumnResize';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { CommandBar } from '@/components/ui/CommandBar';

type EmpTabKey = 'employes' | 'statistiques';

const STATUT_COLORS: Record<string, 'green' | 'amber' | 'blue' | 'red' | 'gray'> = {
  ACTIF: 'green', CONGE: 'amber', FORMATION: 'blue', ARRET_TRAVAIL: 'red', INACTIF: 'gray',
};

const DEPT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'CHANTIER', label: 'Chantier' },
  { value: 'ADMINISTRATION', label: 'Administration' },
  { value: 'ELECTRICITE', label: 'Électricité' },
  { value: 'INGENIERIE', label: 'Ingénierie' },
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'DIRECTION', label: 'Direction' },
];

const CONTRAT_OPTIONS = [
  { value: 'CDI', label: 'CDI' },
  { value: 'CDD', label: 'CDD' },
  { value: 'TEMPORAIRE', label: 'Temporaire' },
  { value: 'SAISONNIER', label: 'Saisonnier' },
  { value: 'CONSULTANT', label: 'Consultant' },
];

const STATUT_OPTIONS = [
  { value: 'ACTIF', label: 'Actif' },
  { value: 'CONGE', label: 'Congé' },
  { value: 'FORMATION', label: 'Formation' },
  { value: 'ARRET_TRAVAIL', label: 'Arrêt de travail' },
  { value: 'INACTIF', label: 'Inactif' },
];

export default function EmployeesPage() {
  const [_empTab, _setEmpTab] = useState<EmpTabKey>('employes');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<Partial<Employee>>({ prenom: '', nom: '', statut: 'ACTIF', typeContrat: 'CDI' });
  const perPage = 20;

  const { sortedItems: sortedEmployees, sortConfig, requestSort } = useSortable(employees);
  const { colWidths, startResize, autoFit } = useColumnResize({ nom: 220, poste: 160, departement: 120, statut: 100, tauxHoraire: 100 });

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Statistics state (camelCase — Axios interceptor transforms snake_case keys)
  const [stats, setStats] = useState<{
    total: number; actifs: number;
    parStatut: Array<{ statut: string; count: number }>;
    parDepartement: Array<{ departement: string; count: number }>;
  } | null>(null);
  const [_statsLoading, setStatsLoading] = useState(false);

  const fetchEmployees = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await employeesApi.listEmployees({
        page, perPage, search: search || undefined, departement: deptFilter || undefined,
      });
      setEmployees(res.items);
      setTotal(res.total);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [page, search, deptFilter]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const fetchStatistics = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await employeesApi.getEmployeeStatistics();
      setStats(res);
    } catch { setError('Erreur chargement statistiques'); }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => {
    fetchStatistics();
  }, [fetchStatistics]);

  const handleExportEmployees = () => {
    // Build CSV from current employees data
    const header = ['ID', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Poste', 'Département', 'Statut', 'Taux Horaire'];
    const rows = employees.map((e) => [
      e.id, e.prenom, e.nom, e.email || '', e.telephone || '',
      e.poste || '', e.departement || '', e.statut, e.tauxHoraire ?? '',
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employes_export.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleCreate = async () => {
    if (!form.prenom?.trim() || !form.nom?.trim()) return;
    if (form.pinCode && form.pinCode.length !== 4) return;
    try {
      const payload = { ...form };
      if (!payload.pinCode) delete payload.pinCode;
      await employeesApi.createEmployee(payload);
      setShowCreate(false);
      setForm({ prenom: '', nom: '', statut: 'ACTIF', typeContrat: 'CDI' });
      fetchEmployees();
    } catch { setError('Erreur de création'); }
  };

  const handleSelect = async (id: number) => {
    try { setSelected(await employeesApi.getEmployee(id)); } catch { setError('Erreur'); }
  };

  const openEdit = (employee: Employee) => {
    setEditForm({
      prenom: employee.prenom,
      nom: employee.nom,
      email: employee.email || '',
      telephone: employee.telephone || '',
      poste: employee.poste || '',
      departement: employee.departement || '',
      typeContrat: employee.typeContrat || '',
      statut: employee.statut,
      dateEmbauche: employee.dateEmbauche || '',
      tauxHoraire: employee.tauxHoraire || undefined,
      salaire: employee.salaire || undefined,
      notes: employee.notes || '',
      pinCode: '',
      canApproveTimecards: employee.canApproveTimecards || false,
    });
    setEditError(null);
    setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!selected || !editForm.prenom?.trim() || !editForm.nom?.trim()) return;
    if (editForm.pinCode && editForm.pinCode.length !== 4) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const payload = { ...editForm };
      // Don't send empty pinCode (would erase existing PIN)
      if (!payload.pinCode) delete payload.pinCode;
      await employeesApi.updateEmployee(selected.id, payload);
      setShowEdit(false);
      const updated = await employeesApi.getEmployee(selected.id);
      setSelected(updated);
      fetchEmployees();
    } catch {
      setEditError('Erreur lors de la mise à jour');
    } finally {
      setEditLoading(false);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Employés</h2>

      <CommandBar
        actions={[
          { label: 'Nouvel employé', icon: <Plus size={16} />, onClick: () => setShowCreate(true), variant: 'primary' },
          { label: 'Exporter CSV', icon: <Download size={16} />, onClick: handleExportEmployees },
        ]}
        right={
          <>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Rechercher..." className="erp-input pl-9 w-48" />
            </div>
            <Select options={DEPT_OPTIONS} value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }} className="w-40" />
          </>
        }
      />

      {/* KPI Stats Cards — always visible */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Total employés</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Actifs</div>
            <div className="text-2xl font-bold text-green-600">{stats.actifs}</div>
          </Card>
          <Card padding="md">
            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Départements</div>
            <div className="text-2xl font-bold text-purple-600">{stats.parDepartement.length}</div>
          </Card>
        </div>
      )}

      <>
      <div className="flex gap-6">
        {/* ---- LIST COLUMN ---- */}
        <div className={`flex-1 ${selected ? 'hidden md:block md:max-w-[60%]' : ''}`}>
          {isLoading ? <SkeletonPage /> : (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <SortableHeader sortKey="nom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.nom} onResizeStart={(e) => startResize(e, 'nom')} onAutoFit={(e) => autoFit(e, 'nom')}>Nom</SortableHeader>
                        <SortableHeader sortKey="poste" sortConfig={sortConfig} onSort={requestSort} width={colWidths.poste} onResizeStart={(e) => startResize(e, 'poste')} onAutoFit={(e) => autoFit(e, 'poste')}>Poste</SortableHeader>
                        <SortableHeader sortKey="departement" sortConfig={sortConfig} onSort={requestSort} width={colWidths.departement} onResizeStart={(e) => startResize(e, 'departement')} onAutoFit={(e) => autoFit(e, 'departement')}>Dept.</SortableHeader>
                        <SortableHeader sortKey="statut" sortConfig={sortConfig} onSort={requestSort} className="text-center" width={colWidths.statut} onResizeStart={(e) => startResize(e, 'statut')} onAutoFit={(e) => autoFit(e, 'statut')}>Statut</SortableHeader>
                        <SortableHeader sortKey="tauxHoraire" sortConfig={sortConfig} onSort={requestSort} className="text-right" width={colWidths.tauxHoraire} onResizeStart={(e) => startResize(e, 'tauxHoraire')} onAutoFit={(e) => autoFit(e, 'tauxHoraire')}>Taux h.</SortableHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedEmployees.map((e) => (
                        <tr key={e.id} onClick={() => handleSelect(e.id)}
                          className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selected?.id === e.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center text-xs font-medium text-seaop-primary-600">
                                {e.prenom?.[0]}{e.nom?.[0]}
                              </div>
                              <div>
                                <span className="font-medium text-gray-900 dark:text-white">{e.prenom} {e.nom}</span>
                                {e.email && <div className="text-xs text-gray-400">{e.email}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{e.poste || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{e.departement || '--'}</td>
                          <td className="px-4 py-3 text-center"><Badge color={STATUT_COLORS[e.statut] || 'gray'} size="sm">{e.statut}</Badge></td>
                          <td className="px-4 py-3 text-right text-gray-600">{e.tauxHoraire ? `${e.tauxHoraire}$/h` : '--'}</td>
                        </tr>
                      ))}
                      {employees.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucun employé</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {sortedEmployees.map((e) => (
                  <Card key={e.id} padding="sm" className={`cursor-pointer active:bg-gray-50 dark:active:bg-gray-800/30 ${selected?.id === e.id ? 'ring-2 ring-blue-500' : ''}`}
                    onClick={() => handleSelect(e.id)}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center text-sm font-medium text-seaop-primary-600 shrink-0">
                        {e.prenom?.[0]}{e.nom?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate">{e.prenom} {e.nom}</div>
                        <div className="text-xs text-gray-500 truncate">{e.poste || '--'} — {e.departement || '--'}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge color={STATUT_COLORS[e.statut] || 'gray'} size="sm">{e.statut}</Badge>
                        <span className="text-xs text-gray-500">{e.tauxHoraire ? `${e.tauxHoraire}$/h` : e.salaire ? formatCurrency(e.salaire) : '--'}</span>
                      </div>
                    </div>
                  </Card>
                ))}
                {employees.length === 0 && <p className="text-center text-gray-400 py-8">Aucun employé</p>}
              </div>

              {totalPages > 1 && <div className="mt-4"><Pagination page={page} totalPages={totalPages} onPageChange={setPage} /></div>}
            </>
          )}
        </div>

        {/* ---- DETAIL PANEL (desktop sidebar) ---- */}
        {selected && (
          <div className="hidden md:block w-[40%] min-w-[300px]">
            <Card>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{selected.prenom} {selected.nom}</h3>
                  <p className="text-sm text-gray-500">{selected.poste} — {selected.departement}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(selected)}
                    className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                    title="Modifier"
                  >
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                </div>
              </div>
              <Badge color={STATUT_COLORS[selected.statut] || 'gray'}>{selected.statut}</Badge>
              <div className="mt-3 space-y-2 text-sm">
                {selected.email && <p className="flex items-center gap-2 text-gray-600 dark:text-gray-400"><Mail size={14} />{selected.email}</p>}
                {selected.telephone && <p className="flex items-center gap-2 text-gray-600 dark:text-gray-400"><Phone size={14} />{selected.telephone}</p>}
                {selected.tauxHoraire && <p className="text-gray-500">Taux horaire: {selected.tauxHoraire}$/h</p>}
                {selected.salaire && <p className="text-gray-500">Salaire: {formatCurrency(selected.salaire)}</p>}
                <p className="text-xs text-gray-400">Embauche: {formatDate(selected.dateEmbauche)}</p>
              </div>

              {selected.competences && selected.competences.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Competences ({selected.competences.length})</h4>
                  <div className="flex flex-wrap gap-1">
                    {selected.competences.map((c) => (
                      <Badge key={c.id} color={c.certifie ? 'green' : 'gray'} size="sm">{c.nomCompetence}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selected.timeEntries && selected.timeEntries.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Pointages recents</h4>
                  {selected.timeEntries.slice(0, 5).map((te) => (
                    <div key={te.id} className="flex justify-between text-xs py-1 text-gray-500">
                      <span>{formatDate(te.punchIn)}</span>
                      <span>{te.totalHours ? `${te.totalHours}h` : '--'}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* ---- DETAIL PANEL (mobile full-width) ---- */}
      {selected && (
        <div className="md:hidden">
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setSelected(null)} className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <ChevronLeft size={20} />
              </button>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex-1">{selected.prenom} {selected.nom}</h3>
              <button
                onClick={() => openEdit(selected)}
                className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                title="Modifier"
              >
                <Pencil size={16} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-2">{selected.poste} — {selected.departement}</p>
            <Badge color={STATUT_COLORS[selected.statut] || 'gray'}>{selected.statut}</Badge>
            <div className="mt-3 space-y-2 text-sm">
              {selected.email && <p className="flex items-center gap-2 text-gray-600 dark:text-gray-400"><Mail size={14} />{selected.email}</p>}
              {selected.telephone && <p className="flex items-center gap-2 text-gray-600 dark:text-gray-400"><Phone size={14} />{selected.telephone}</p>}
              {selected.tauxHoraire && <p className="text-gray-500">Taux horaire: {selected.tauxHoraire}$/h</p>}
              {selected.salaire && <p className="text-gray-500">Salaire: {formatCurrency(selected.salaire)}</p>}
              <p className="text-xs text-gray-400">Embauche: {formatDate(selected.dateEmbauche)}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <KeyRound size={12} /> NIP: {selected.pinCode ? 'Configure' : 'Non configure'}
                </span>
                {selected.canApproveTimecards && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <ShieldCheck size={12} /> Approbateur
                  </span>
                )}
              </div>
            </div>

            {selected.competences && selected.competences.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Competences ({selected.competences.length})</h4>
                <div className="flex flex-wrap gap-1">
                  {selected.competences.map((c) => (
                    <Badge key={c.id} color={c.certifie ? 'green' : 'gray'} size="sm">{c.nomCompetence}</Badge>
                  ))}
                </div>
              </div>
            )}

            {selected.timeEntries && selected.timeEntries.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Pointages recents</h4>
                {selected.timeEntries.slice(0, 5).map((te) => (
                  <div key={te.id} className="flex justify-between text-xs py-1 text-gray-500">
                    <span>{formatDate(te.punchIn)}</span>
                    <span>{te.totalHours ? `${te.totalHours}h` : '--'}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      </>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouvel employé" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Prénom *" value={form.prenom || ''} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required />
            <Input label="Nom *" value={form.nom || ''} onChange={(e) => setForm({ ...form, nom: e.target.value })} required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label="Téléphone" value={form.telephone || ''} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Poste" value={form.poste || ''} onChange={(e) => setForm({ ...form, poste: e.target.value })} />
            <Select label="Département" options={DEPT_OPTIONS.slice(1)} value={form.departement || ''} onChange={(e) => setForm({ ...form, departement: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Type de contrat" options={CONTRAT_OPTIONS} value={form.typeContrat || 'CDI'} onChange={(e) => setForm({ ...form, typeContrat: e.target.value })} />
            <Select label="Statut" options={STATUT_OPTIONS} value={form.statut || 'ACTIF'} onChange={(e) => setForm({ ...form, statut: e.target.value })} />
          </div>
          <Input label="Date d'embauche" type="date" value={form.dateEmbauche || ''} onChange={(e) => setForm({ ...form, dateEmbauche: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Taux horaire ($/h)" type="number" step="0.01" value={form.tauxHoraire ?? ''} onChange={(e) => setForm({ ...form, tauxHoraire: e.target.value ? parseFloat(e.target.value) : undefined })} />
            <Input label="Salaire annuel ($)" type="number" step="0.01" value={form.salaire ?? ''} onChange={(e) => setForm({ ...form, salaire: e.target.value ? parseFloat(e.target.value) : undefined })} />
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-2">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Sécurité pointage mobile</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Input
                  label="Code NIP (4 chiffres)"
                  type="password"
                  maxLength={4}
                  placeholder="Aucun NIP"
                  value={form.pinCode || ''}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setForm({ ...form, pinCode: v });
                  }}
                />
                {form.pinCode && form.pinCode.length > 0 && form.pinCode.length < 4 && (
                  <p className="text-xs text-amber-500 mt-1">Le NIP doit contenir 4 chiffres</p>
                )}
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.canApproveTimecards || false}
                    onChange={(e) => setForm({ ...form, canApproveTimecards: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <ShieldCheck className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Peut approuver les heures</span>
                </label>
              </div>
            </div>
          </div>
          <Textarea label="Notes" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.prenom?.trim() || !form.nom?.trim()}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Modifier l'employé" size="lg">
        <div className="space-y-4">
          {editError && <Alert type="error" onClose={() => setEditError(null)}>{editError}</Alert>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Prénom *" value={editForm.prenom || ''} onChange={(e) => setEditForm({ ...editForm, prenom: e.target.value })} required />
            <Input label="Nom *" value={editForm.nom || ''} onChange={(e) => setEditForm({ ...editForm, nom: e.target.value })} required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Email" type="email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <Input label="Téléphone" value={editForm.telephone || ''} onChange={(e) => setEditForm({ ...editForm, telephone: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Poste" value={editForm.poste || ''} onChange={(e) => setEditForm({ ...editForm, poste: e.target.value })} />
            <Select label="Département" options={DEPT_OPTIONS.slice(1)} value={editForm.departement || ''} onChange={(e) => setEditForm({ ...editForm, departement: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Type de contrat" options={CONTRAT_OPTIONS} value={editForm.typeContrat || 'CDI'} onChange={(e) => setEditForm({ ...editForm, typeContrat: e.target.value })} />
            <Select label="Statut" options={STATUT_OPTIONS} value={editForm.statut || 'ACTIF'} onChange={(e) => setEditForm({ ...editForm, statut: e.target.value })} />
          </div>
          <Input label="Date d'embauche" type="date" value={editForm.dateEmbauche || ''} onChange={(e) => setEditForm({ ...editForm, dateEmbauche: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Taux horaire ($/h)" type="number" step="0.01" value={editForm.tauxHoraire ?? ''} onChange={(e) => setEditForm({ ...editForm, tauxHoraire: e.target.value ? parseFloat(e.target.value) : undefined })} />
            <Input label="Salaire annuel ($)" type="number" step="0.01" value={editForm.salaire ?? ''} onChange={(e) => setEditForm({ ...editForm, salaire: e.target.value ? parseFloat(e.target.value) : undefined })} />
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-2">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Sécurité pointage mobile</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Input
                  label="Code NIP (4 chiffres)"
                  type="password"
                  maxLength={4}
                  placeholder={selected?.pinCode ? '****' : 'Aucun NIP'}
                  value={editForm.pinCode || ''}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setEditForm({ ...editForm, pinCode: v });
                  }}
                />
                {editForm.pinCode && editForm.pinCode.length > 0 && editForm.pinCode.length < 4 && (
                  <p className="text-xs text-amber-500 mt-1">Le NIP doit contenir 4 chiffres</p>
                )}
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.canApproveTimecards || false}
                    onChange={(e) => setEditForm({ ...editForm, canApproveTimecards: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <ShieldCheck className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Peut approuver les heures</span>
                </label>
              </div>
            </div>
          </div>
          <Textarea label="Notes" value={editForm.notes || ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowEdit(false)}>Annuler</Button>
            <Button onClick={handleEdit} isLoading={editLoading} disabled={!editForm.prenom?.trim() || !editForm.nom?.trim()}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
