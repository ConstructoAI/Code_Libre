/**
 * ERP React Frontend - Pointage Page
 * Time tracking entries + payroll summary + Paie CCQ (full payroll).
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Clock, DollarSign, Users, Plus, Calculator, Lock, FileText, Check, Download, ChevronLeft, ChevronRight, Briefcase, CalendarDays, Pencil, Trash2, Search } from 'lucide-react';
import * as employeesApi from '@/api/employees';
import * as payrollApi from '@/api/payroll';
import * as projectsApi from '@/api/projects';
import * as productionApi from '@/api/production';
import type { TimeEntry, PayrollItem, Employee } from '@/api/employees';
import type { PayrollPeriod, PayrollEntry, PayrollEntryDetail } from '@/api/payroll';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { CommandBar } from '@/components/ui/CommandBar';
import StatCard from '@/components/dashboard/StatCard';
import { formatDateTimeFull, formatCurrency } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { useColumnResize } from '@/hooks/useColumnResize';
import { SortableHeader } from '@/components/ui/SortableHeader';

type TabKey = 'pointages' | 'vue_semaine' | 'par_projet' | 'paie' | 'paie_ccq';

// Form shape used by the edit-entry modal. formulaireBtId/operationId stay loose
// because the modal keeps them as '' when absent while updateTimeEntry takes a
// number. All fields shown in the Pointage table are editable here.
type EditTimeEntryForm = {
  employeeId?: number;
  projectId?: string;
  formulaireBtId?: number | string;
  operationId?: number | string;
  punchIn?: string;
  punchOut?: string;
  notes?: string;
  typeTravail?: string;
  billable?: boolean;
  validated?: boolean;
};

type BtOperationOption = { id: number; label: string };

export default function PointagePage() {
  const [tab, setTab] = useState<TabKey>('pointages');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const perPage = 20;

  // Time entries
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [entriesTotal, setEntriesTotal] = useState(0);

  // Payroll (simple summary)
  const [payroll, setPayroll] = useState<PayrollItem[]>([]);
  const [payrollTotalBrut, setPayrollTotalBrut] = useState(0);
  const [payrollPeriod, setPayrollPeriod] = useState('30');

  // Paie CCQ state
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [showCreatePeriod, setShowCreatePeriod] = useState(false);
  const [periodForm, setPeriodForm] = useState({ dateDebut: '', dateFin: '', typePeriode: 'BI_HEBDO' });

  // Fiche de paie detail modal
  const [showFiche, setShowFiche] = useState(false);
  const [ficheDetail, setFicheDetail] = useState<PayrollEntryDetail | null>(null);
  const [ficheLoading, setFicheLoading] = useState(false);

  // New time entry state
  const [showCreateEntry, setShowCreateEntry] = useState(false);
  const [entryForm, setEntryForm] = useState({
    employeeId: '',
    projectId: '',
    formulaireBtId: '',
    punchIn: '',
    punchOut: '',
    notes: '',
    billable: true,
  });
  const [entryLoading, setEntryLoading] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);

  // Employees, projects, work orders lists for dropdown
  const [employeesList, setEmployeesList] = useState<Employee[]>([]);
  const [projectsList, setProjectsList] = useState<Array<{ id: number; nomProjet: string }>>([]);
  const [workOrdersList, setWorkOrdersList] = useState<Array<{ id: number; numeroDocument: string; projectNom?: string }>>([]);

  // Weekly view state
  const [weeklyData, setWeeklyData] = useState<{
    weekStart: string; weekEnd: string;
    jours: Array<{ jour: string; date: string; entries: TimeEntry[]; totalHeures: number }>;
    totalSemaine: number;
  } | null>(null);
  const [weekStart, setWeekStart] = useState<string>('');
  const [weekLoading, setWeekLoading] = useState(false);

  // By-project state
  const [projectHours, setProjectHours] = useState<Array<{ id: string; nomProjet: string; heures: number; nbEmployes: number; employes?: Array<{ id: number; nom: string; heures: number }> }>>([]);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);

  // Validation loading tracker
  const [validatingId, setValidatingId] = useState<number | null>(null);

  // Edit entry state
  const [showEditEntry, setShowEditEntry] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editForm, setEditForm] = useState<EditTimeEntryForm>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editOperationsList, setEditOperationsList] = useState<BtOperationOption[]>([]);
  const [editOperationsLoading, setEditOperationsLoading] = useState(false);
  // Monotonic counter so concurrent loadOperationsForBt calls (rapid BT
  // switches) only let the LAST request update the operations dropdown.
  // Without this, a slow response for BT-A can land after BT-B and overwrite
  // the list with stale data.
  const loadOperationsSeqRef = useRef(0);

  // Success feedback
  const [success, setSuccess] = useState<string | null>(null);

  const filteredEntries = entries.filter((e) => {
    if (statusFilter) {
      if (statusFilter === 'valide' && !e.validated) return false;
      if (statusFilter === 'non_valide' && e.validated) return false;
      if (statusFilter === 'facture' && !e.isBilled) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const hay = `${e.employeNom || ''} ${e.clientNom || ''} ${e.nomProjet || ''} ${e.btNumero || ''} ${e.operationNom || ''} ${e.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const { sortedItems: sortedEntries, sortConfig, requestSort } = useSortable(filteredEntries);
  const { colWidths, startResize, autoFit } = useColumnResize({
    employeNom: 150,
    clientNom: 160,
    nomProjet: 150,
    btNumero: 100,
    operationNom: 150,
    punchIn: 180,
    punchOut: 180,
    totalHours: 90,
    validated: 100,
  });

  // ---- Data fetching ----

  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await employeesApi.listTimeEntries({ page, perPage });
      setEntries(res.items);
      setEntriesTotal(res.total);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [page]);

  const fetchPayroll = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await employeesApi.getPayrollSummary(parseInt(payrollPeriod));
      setPayroll(res.items);
      setPayrollTotalBrut(res.totalBrut);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [payrollPeriod]);

  const fetchPeriods = useCallback(async () => {
    try {
      const res = await payrollApi.listPeriods({ perPage: 50 });
      setPeriods(res.items);
      if (res.items.length > 0 && !selectedPeriodId) {
        setSelectedPeriodId(res.items[0].id);
      }
    } catch { /* ignore */ }
  }, [selectedPeriodId]);

  const fetchPayrollEntries = useCallback(async () => {
    if (!selectedPeriodId) return;
    setIsLoading(true);
    try {
      const res = await payrollApi.listEntries({ periodId: selectedPeriodId, perPage: 100 });
      setPayrollEntries(res.items);
    } catch { setError('Erreur chargement fiches de paie'); }
    finally { setIsLoading(false); }
  }, [selectedPeriodId]);

  const fetchEmployeesForDropdown = useCallback(async () => {
    try {
      const [empRes, projRes, btRes] = await Promise.all([
        employeesApi.listEmployees({ page: 1, perPage: 100 }),
        projectsApi.listProjects({ page: 1, perPage: 100 }),
        productionApi.listWorkOrders({ page: 1, perPage: 100 }),
      ]);
      setEmployeesList(empRes.items);
      setProjectsList(projRes.items.map((p: { id: number; nomProjet?: string }) => ({ id: p.id, nomProjet: p.nomProjet || `Projet #${p.id}` })));
      setWorkOrdersList(btRes.items.map((bt: { id: number; numeroDocument?: string; projectNom?: string }) => ({ id: bt.id, numeroDocument: bt.numeroDocument || `BT #${bt.id}`, projectNom: bt.projectNom })));
    } catch { /* ignore */ }
  }, []);

  const fetchWeekly = useCallback(async () => {
    setWeekLoading(true);
    try {
      const res = await employeesApi.getWeeklyTimesheet({
        weekStart: weekStart || undefined,
      });
      setWeeklyData(res);
    } catch { setError('Erreur chargement semaine'); }
    finally { setWeekLoading(false); }
  }, [weekStart]);

  const fetchByProject = useCallback(async () => {
    setProjectLoading(true);
    try {
      const res = await employeesApi.getHoursByProject();
      setProjectHours(res.items);
    } catch { setError('Erreur chargement projets'); }
    finally { setProjectLoading(false); }
  }, []);

  const handleValidate = async (entryId: number) => {
    setValidatingId(entryId);
    try {
      await employeesApi.validateTimeEntry(entryId);
      fetchEntries();
    } catch { setError('Erreur validation'); }
    finally { setValidatingId(null); }
  };

  // datetime-local inputs accept "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS"
  // (with step="1"). Backend returns ISO strings; we normalise space-separated
  // timestamps as a safety net so legacy payloads still open in the modal, and
  // keep seconds so the admin can adjust punch times with full precision.
  const toDateTimeLocal = (iso?: string): string => {
    if (!iso) return '';
    const normalized = iso.includes(' ') && !iso.includes('T') ? iso.replace(' ', 'T') : iso;
    return normalized.slice(0, 19);
  };

  const loadOperationsForBt = useCallback(async (btId: number): Promise<BtOperationOption[]> => {
    const requestId = ++loadOperationsSeqRef.current;
    setEditOperationsLoading(true);
    try {
      const res = await productionApi.listOperations(btId);
      const opts: BtOperationOption[] = res.items.map((op) => ({
        id: op.id,
        label: (op.nom && op.nom.trim())
          || (op.description && op.description.trim())
          || `Operation #${op.id}`,
      }));
      // Ignore stale responses — only the most recent request applies.
      if (requestId === loadOperationsSeqRef.current) {
        setEditOperationsList(opts);
      }
      return opts;
    } catch {
      if (requestId === loadOperationsSeqRef.current) {
        setEditOperationsList([]);
      }
      return [];
    } finally {
      if (requestId === loadOperationsSeqRef.current) {
        setEditOperationsLoading(false);
      }
    }
  }, []);

  const handleOpenEdit = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditForm({
      employeeId: entry.employeeId,
      projectId: entry.projectId || '',
      formulaireBtId: entry.formulaireBtId || '',
      operationId: entry.operationId || '',
      punchIn: toDateTimeLocal(entry.punchIn),
      punchOut: toDateTimeLocal(entry.punchOut),
      notes: entry.notes || '',
      typeTravail: entry.typeTravail || '',
      billable: entry.billable ?? true,
      validated: entry.validated ?? false,
    });
    setEditError(null);
    setEditOperationsList([]);
    if (!employeesList.length) fetchEmployeesForDropdown();
    if (entry.formulaireBtId) {
      void loadOperationsForBt(Number(entry.formulaireBtId));
    }
    setShowEditEntry(true);
  };

  const handleEditBtChange = async (btValue: string) => {
    setEditForm((prev) => ({ ...prev, formulaireBtId: btValue, operationId: '' }));
    if (!btValue) {
      setEditOperationsList([]);
      return;
    }
    await loadOperationsForBt(Number(btValue));
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry) return;
    setEditError(null);
    setEditLoading(true);
    try {
      const payload: Parameters<typeof employeesApi.updateTimeEntry>[1] = {};

      if (editForm.employeeId && editForm.employeeId !== editingEntry.employeeId) {
        payload.employeeId = editForm.employeeId;
      }
      if (editForm.punchIn) payload.punchIn = editForm.punchIn;
      if (editForm.punchOut) payload.punchOut = editForm.punchOut;

      const currentProject = editingEntry.projectId || '';
      if ((editForm.projectId || '') !== currentProject) {
        payload.projectId = editForm.projectId || undefined;
      }

      const currentBt = editingEntry.formulaireBtId != null ? String(editingEntry.formulaireBtId) : '';
      const nextBt = editForm.formulaireBtId != null ? String(editForm.formulaireBtId) : '';
      if (nextBt !== currentBt) {
        payload.formulaireBtId = nextBt ? Number(nextBt) : null;
      }

      const currentOp = editingEntry.operationId != null ? String(editingEntry.operationId) : '';
      const nextOp = editForm.operationId != null ? String(editForm.operationId) : '';
      if (nextOp !== currentOp) {
        payload.operationId = nextOp ? Number(nextOp) : null;
      }

      if ((editForm.notes || '') !== (editingEntry.notes || '')) {
        payload.notes = editForm.notes || '';
      }
      if ((editForm.typeTravail || '') !== (editingEntry.typeTravail || '')) {
        payload.typeTravail = editForm.typeTravail || '';
      }

      const currentBillable = editingEntry.billable ?? true;
      if ((editForm.billable ?? true) !== currentBillable) {
        payload.billable = editForm.billable ?? true;
      }

      const currentValidated = editingEntry.validated ?? false;
      if ((editForm.validated ?? false) !== currentValidated) {
        payload.validated = editForm.validated ?? false;
      }

      if (Object.keys(payload).length === 0) {
        setShowEditEntry(false);
        return;
      }
      await employeesApi.updateTimeEntry(editingEntry.id, payload);
      setShowEditEntry(false);
      setEditingEntry(null);
      setEditOperationsList([]);
      fetchEntries();
      setSuccess('Pointage modifié');
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setEditError(detail || 'Erreur lors de la modification');
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteEntry = async (entryId: number) => {
    if (!confirm('Supprimer ce pointage?')) return;
    try {
      await employeesApi.deleteTimeEntry(entryId);
      fetchEntries();
      setSuccess('Pointage supprimé');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erreur lors de la suppression');
    }
  };

  const handleExportCsv = async () => {
    try {
      const response = await employeesApi.exportTimeEntriesCsv();
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pointages_export.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { setError('Erreur export CSV'); }
  };

  const navigateWeek = (direction: number) => {
    const current = weeklyData?.weekStart || weekStart || new Date().toISOString().slice(0, 10);
    const d = new Date(current);
    d.setDate(d.getDate() + direction * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  useEffect(() => { setPage(1); }, [tab]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => {
    if (tab === 'pointages') fetchEntries();
    else if (tab === 'vue_semaine') fetchWeekly();
    else if (tab === 'par_projet') fetchByProject();
    else if (tab === 'paie') fetchPayroll();
    else if (tab === 'paie_ccq') { fetchPeriods(); }
  }, [tab, fetchEntries, fetchPayroll, fetchPeriods, fetchWeekly, fetchByProject]);

  useEffect(() => {
    if (tab === 'paie_ccq' && selectedPeriodId) fetchPayrollEntries();
  }, [tab, selectedPeriodId, fetchPayrollEntries]);

  // ---- Handlers ----

  const calcTotalHours = (punchIn: string, punchOut: string): number => {
    if (!punchIn || !punchOut) return 0;
    const diff = new Date(punchOut).getTime() - new Date(punchIn).getTime();
    return diff > 0 ? Math.round((diff / 3600000) * 100) / 100 : 0;
  };

  const computedHours = calcTotalHours(entryForm.punchIn, entryForm.punchOut);
  const editComputedHours = calcTotalHours(editForm.punchIn || '', editForm.punchOut || '');

  const openCreateEntry = () => {
    setEntryForm({ employeeId: '', projectId: '', formulaireBtId: '', punchIn: '', punchOut: '', notes: '', billable: true });
    setEntryError(null);
    fetchEmployeesForDropdown();
    setShowCreateEntry(true);
  };

  const handleCreateEntry = async () => {
    if (!entryForm.employeeId) return;
    setEntryLoading(true);
    setEntryError(null);
    try {
      await employeesApi.createTimeEntry({
        employeeId: parseInt(entryForm.employeeId),
        projectId: entryForm.projectId || undefined,
        formulaireBtId: entryForm.formulaireBtId ? parseInt(entryForm.formulaireBtId) : undefined,
        punchIn: entryForm.punchIn || undefined,
        punchOut: entryForm.punchOut || undefined,
        totalHours: computedHours || undefined,
        notes: entryForm.notes || undefined,
        billable: entryForm.billable,
      });
      setShowCreateEntry(false);
      fetchEntries();
    } catch {
      setEntryError('Erreur lors de la création du pointage');
    } finally {
      setEntryLoading(false);
    }
  };

  const handleCreatePeriod = async () => {
    if (!periodForm.dateDebut || !periodForm.dateFin) return;
    setIsLoading(true);
    try {
      const res = await payrollApi.createPeriod(periodForm);
      setSelectedPeriodId(res.id);
      setShowCreatePeriod(false);
      fetchPeriods();
    } catch {
      setError('Erreur création période');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedPeriodId) return;
    setGenerating(true);
    setError(null);
    try {
      await payrollApi.generatePayroll(selectedPeriodId);
      fetchPayrollEntries();
    } catch {
      setError('Erreur generation paie');
    } finally {
      setGenerating(false);
    }
  };

  const handleClosePeriod = async () => {
    if (!selectedPeriodId) return;
    if (!confirm('Fermer cette periode de paie? Cette action est irreversible.')) return;
    try {
      await payrollApi.closePeriod(selectedPeriodId);
      fetchPeriods();
    } catch {
      setError('Erreur fermeture periode');
    }
  };

  const openFiche = async (entryId: number) => {
    setFicheLoading(true);
    setShowFiche(true);
    try {
      const detail = await payrollApi.getEntry(entryId);
      setFicheDetail(detail);
    } catch {
      setError('Erreur chargement fiche');
      setShowFiche(false);
    } finally {
      setFicheLoading(false);
    }
  };

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const periodIsClosed = selectedPeriod?.statut === 'FERME';
  const totalPages = Math.ceil(entriesTotal / perPage);

  // Paie CCQ totals
  const ccqTotalBrut = payrollEntries.reduce((s, e) => s + e.salaireBrut, 0);
  const ccqTotalNet = payrollEntries.reduce((s, e) => s + e.salaireNet, 0);
  const ccqTotalCout = payrollEntries.reduce((s, e) => s + e.coutTotal, 0);

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Pointage & Paie</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" leftIcon={<Download size={16} />} onClick={handleExportCsv}>Exporter</Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        {([
          ['pointages', 'Pointages', <Clock size={16} key="c" />] as const,
          ['vue_semaine', 'Vue Semaine', <CalendarDays size={16} key="vs" />] as const,
          ['par_projet', 'Par Projet', <Briefcase size={16} key="bp" />] as const,
          ['paie', 'Résumé paie', <DollarSign size={16} key="d" />] as const,
          ['paie_ccq', 'Paie CCQ', <Calculator size={16} key="calc" />] as const,
        ]).map(([k, label, icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === k ? 'border-seaop-primary-600 text-seaop-primary-600' : 'border-transparent text-gray-500'
            }`}>
            {icon} {label}
          </button>
        ))}
      </div>

      {isLoading && tab !== 'paie_ccq' ? <div className="flex justify-center py-12"><Spinner size="lg" /></div> : (
        <>
          {/* TIME ENTRIES */}
          {tab === 'pointages' && (
            <>
              <CommandBar
                actions={[
                  { label: 'Nouveau pointage', icon: <Plus size={16} />, onClick: openCreateEntry, variant: 'primary' },
                ]}
                right={
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:flex-none">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Rechercher..." className="erp-input pl-9 w-full sm:w-48" />
                    </div>
                    <div className="w-36 sm:w-44 shrink-0">
                      <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                        options={[
                          { value: '', label: 'Tous' },
                          { value: 'valide', label: 'Valides' },
                          { value: 'non_valide', label: 'Non valides' },
                          { value: 'facture', label: 'Factures' },
                        ]} />
                    </div>
                  </div>
                }
              />
              {/* Tableau (desktop + mobile via scroll horizontal) */}
              <Card padding="sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <SortableHeader label="Employé" sortKey="employeNom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.employeNom} onResizeStart={(e) => startResize(e, 'employeNom')} onAutoFit={(e) => autoFit(e, 'employeNom')} />
                        <SortableHeader label="Client" sortKey="clientNom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.clientNom} onResizeStart={(e) => startResize(e, 'clientNom')} onAutoFit={(e) => autoFit(e, 'clientNom')} />
                        <SortableHeader label="Projet" sortKey="nomProjet" sortConfig={sortConfig} onSort={requestSort} width={colWidths.nomProjet} onResizeStart={(e) => startResize(e, 'nomProjet')} onAutoFit={(e) => autoFit(e, 'nomProjet')} />
                        <SortableHeader label="BT" sortKey="btNumero" sortConfig={sortConfig} onSort={requestSort} width={colWidths.btNumero} onResizeStart={(e) => startResize(e, 'btNumero')} onAutoFit={(e) => autoFit(e, 'btNumero')} />
                        <SortableHeader label="Opération" sortKey="operationNom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.operationNom} onResizeStart={(e) => startResize(e, 'operationNom')} onAutoFit={(e) => autoFit(e, 'operationNom')} />
                        <SortableHeader label="Entrée" sortKey="punchIn" sortConfig={sortConfig} onSort={requestSort} width={colWidths.punchIn} onResizeStart={(e) => startResize(e, 'punchIn')} onAutoFit={(e) => autoFit(e, 'punchIn')} />
                        <SortableHeader label="Sortie" sortKey="punchOut" sortConfig={sortConfig} onSort={requestSort} width={colWidths.punchOut} onResizeStart={(e) => startResize(e, 'punchOut')} onAutoFit={(e) => autoFit(e, 'punchOut')} />
                        <SortableHeader label="Heures" sortKey="totalHours" sortConfig={sortConfig} onSort={requestSort} className="text-right" width={colWidths.totalHours} onResizeStart={(e) => startResize(e, 'totalHours')} onAutoFit={(e) => autoFit(e, 'totalHours')} />
                        <SortableHeader label="Valide" sortKey="validated" sortConfig={sortConfig} onSort={requestSort} className="text-center" width={colWidths.validated} onResizeStart={(e) => startResize(e, 'validated')} onAutoFit={(e) => autoFit(e, 'validated')} />
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-gray-900 dark:text-white truncate">{e.employeNom || `#${e.employeeId}`}</td>
                          <td className="px-4 py-3 text-gray-500 truncate">{e.clientNom || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 truncate">{e.nomProjet || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs truncate">{e.btNumero || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs truncate">{e.operationNom || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs font-mono whitespace-nowrap">{formatDateTimeFull(e.punchIn)}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs font-mono whitespace-nowrap">{formatDateTimeFull(e.punchOut)}</td>
                          <td className="px-4 py-3 text-right font-medium">{e.totalHours ? `${e.totalHours}h` : '--'}</td>
                          <td className="px-4 py-3 text-center">
                            {e.isBilled ? (
                              <Badge color="blue" size="sm">Facturé</Badge>
                            ) : e.validated ? (
                              <Badge color="green" size="sm"><Check size={12} className="inline mr-1" />Validé</Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleValidate(e.id)}
                                isLoading={validatingId === e.id}
                                className="text-xs"
                              >
                                Valider
                              </Button>
                            )}
                          </td>
                          <td className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenEdit(e)}
                                disabled={e.isBilled}
                                className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                title={e.isBilled ? 'Pointage facturé — verrouillé' : 'Modifier'}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteEntry(e.id)}
                                disabled={e.isBilled}
                                className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                title={e.isBilled ? 'Pointage facturé — verrouillé' : 'Supprimer'}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {sortedEntries.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Aucun pointage</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              {totalPages > 1 && !search && !statusFilter && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
            </>
          )}

          {/* WEEKLY VIEW */}
          {tab === 'vue_semaine' && (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <Button size="sm" variant="ghost" onClick={() => navigateWeek(-1)}>
                  <ChevronLeft size={16} />
                </Button>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {weeklyData ? `${weeklyData.weekStart} au ${weeklyData.weekEnd}` : 'Semaine en cours'}
                </span>
                <Button size="sm" variant="ghost" onClick={() => navigateWeek(1)}>
                  <ChevronRight size={16} />
                </Button>
                {weeklyData && (
                  <Badge color="blue" size="sm">Total: {weeklyData.totalSemaine}h</Badge>
                )}
              </div>
              {weekLoading ? (
                <div className="flex justify-center py-12"><Spinner size="lg" /></div>
              ) : weeklyData ? (
                <Card padding="sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Jour</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Nb Entrées</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total Heures</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {weeklyData.jours.map((j) => (
                          <tr key={j.date} className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 ${j.totalHeures > 0 ? '' : 'opacity-50'}`}>
                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white capitalize">{j.jour}</td>
                            <td className="px-4 py-3 text-gray-500">{j.date}</td>
                            <td className="px-4 py-3 text-right text-gray-500">{j.entries.length}</td>
                            <td className="px-4 py-3 text-right font-medium">{j.totalHeures > 0 ? `${j.totalHeures}h` : '--'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50">
                          <td colSpan={3} className="px-4 py-3 font-semibold text-gray-900 dark:text-white">Total semaine</td>
                          <td className="px-4 py-3 text-right font-bold text-seaop-primary-600">{weeklyData.totalSemaine}h</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              ) : (
                <Card><p className="text-center text-gray-400 py-8">Aucune donnée</p></Card>
              )}
            </>
          )}

          {/* BY PROJECT */}
          {tab === 'par_projet' && (
            <>
              {projectLoading ? (
                <div className="flex justify-center py-12"><Spinner size="lg" /></div>
              ) : (
                <Card padding="sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Projet</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Heures</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Nb Employés</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {projectHours.map((p) => (
                          <React.Fragment key={p.id}>
                            <tr
                              className="hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer"
                              onClick={() => setExpandedProjectId(expandedProjectId === p.id ? null : p.id)}
                            >
                              <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                                <span className="mr-2 text-gray-400">{expandedProjectId === p.id ? '▼' : '▶'}</span>
                                {p.nomProjet}
                              </td>
                              <td className="px-4 py-3 text-right font-medium">{p.heures}h</td>
                              <td className="px-4 py-3 text-right text-gray-500">{p.nbEmployes}</td>
                            </tr>
                            {expandedProjectId === p.id && p.employes && p.employes.map((emp) => (
                              <tr key={`${p.id}-${emp.id}`} className="bg-gray-50/50 dark:bg-gray-800/20">
                                <td className="px-4 py-2 pl-12 text-sm text-gray-600 dark:text-gray-400">
                                  <Users size={14} className="inline mr-2 text-gray-400" />{emp.nom}
                                </td>
                                <td className="px-4 py-2 text-right text-sm text-gray-500">{emp.heures}h</td>
                                <td className="px-4 py-2"></td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                        {projectHours.length === 0 && (
                          <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Aucune donnée</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}

          {/* PAYROLL SUMMARY (simple) */}
          {tab === 'paie' && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-40">
                  <Select options={[
                    { value: '7', label: '7 jours' },
                    { value: '14', label: '14 jours' },
                    { value: '30', label: '30 jours' },
                    { value: '90', label: '90 jours' },
                  ]} value={payrollPeriod} onChange={(e) => setPayrollPeriod(e.target.value)} />
                </div>
                <StatCard label="Masse salariale brute" value={formatCurrency(payrollTotalBrut)} icon={<DollarSign size={20} />} color="blue" />
                <StatCard label="Employés" value={payroll.length} icon={<Users size={20} />} color="green" />
              </div>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Employé</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Dept.</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Heures</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Taux</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Brut</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Deductions</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {payroll.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{p.employe}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{p.departement || '--'}</td>
                          <td className="px-4 py-3 text-right">{p.heuresTotales}h</td>
                          <td className="px-4 py-3 text-right text-gray-500">{p.taux}$/h</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(p.salaireBrut)}</td>
                          <td className="px-4 py-3 text-right text-red-500">{formatCurrency(p.deductions)}</td>
                          <td className="px-4 py-3 text-right font-bold text-green-600">{formatCurrency(p.salaireNet)}</td>
                        </tr>
                      ))}
                      {payroll.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucune donnée</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {payroll.map((p) => (
                  <Card key={p.id} padding="sm">
                    <div className="flex items-start justify-between mb-1">
                      <h4 className="font-medium text-sm text-gray-900 dark:text-white">{p.employe}</h4>
                      <span className="text-xs text-gray-400">{p.departement || '--'}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>{p.heuresTotales}h @ {p.taux}$/h</span>
                      <span className="font-medium text-gray-900 dark:text-white">Brut: {formatCurrency(p.salaireBrut)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-red-500">Ded: {formatCurrency(p.deductions)}</span>
                      <span className="font-bold text-green-600">Net: {formatCurrency(p.salaireNet)}</span>
                    </div>
                  </Card>
                ))}
                {payroll.length === 0 && <p className="text-gray-400 text-center py-8">Aucune donnée</p>}
              </div>
            </>
          )}

          {/* PAIE CCQ (full payroll) */}
          {tab === 'paie_ccq' && (
            <>
              {/* Period selector */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-full sm:w-64">
                  <Select
                    label="Période de paie"
                    options={[
                      { value: '', label: 'Sélectionner une période' },
                      ...periods.map((p) => ({
                        value: String(p.id),
                        label: `${p.dateDebut} au ${p.dateFin} (${p.typePeriode})${p.statut === 'FERME' ? ' [FERME]' : ''}`,
                      })),
                    ]}
                    value={selectedPeriodId ? String(selectedPeriodId) : ''}
                    onChange={(e) => setSelectedPeriodId(e.target.value ? parseInt(e.target.value) : null)}
                  />
                </div>
                <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => setShowCreatePeriod(true)}>
                  Nouvelle periode
                </Button>
                {selectedPeriodId && !periodIsClosed && (
                  <>
                    <Button
                      size="sm"
                      leftIcon={<Calculator size={14} />}
                      onClick={handleGenerate}
                      isLoading={generating}
                    >
                      Calculer paie
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Lock size={14} />}
                      onClick={handleClosePeriod}
                      className="text-red-600 hover:text-red-700"
                    >
                      Fermer periode
                    </Button>
                  </>
                )}
                {periodIsClosed && (
                  <Badge color="red" size="sm">Période fermée</Badge>
                )}
              </div>

              {/* Totals */}
              {payrollEntries.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Employés" value={payrollEntries.length} icon={<Users size={20} />} color="blue" />
                  <StatCard label="Masse brute" value={formatCurrency(ccqTotalBrut)} icon={<DollarSign size={20} />} color="purple" />
                  <StatCard label="Masse nette" value={formatCurrency(ccqTotalNet)} icon={<DollarSign size={20} />} color="green" />
                  <StatCard label="Coût employeur" value={formatCurrency(ccqTotalCout)} icon={<DollarSign size={20} />} color="red" />
                </div>
              )}

              {/* Entries table */}
              {isLoading ? (
                <div className="flex justify-center py-12"><Spinner size="lg" /></div>
              ) : (
                <>
                {/* Desktop table */}
                <Card padding="sm" className="hidden md:block">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Employé</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Dept.</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">H. Reg</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">H. Supp</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Brut</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Deductions</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Net</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Coût Empl.</th>
                          <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">CCQ</th>
                          <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Fiche</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {payrollEntries.map((e) => (
                          <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                            <td className="px-3 py-3 text-gray-900 dark:text-white font-medium">{e.employe}</td>
                            <td className="px-3 py-3 text-gray-500 text-xs">{e.departement || '--'}</td>
                            <td className="px-3 py-3 text-right">{e.heuresRegulieres}h</td>
                            <td className="px-3 py-3 text-right text-orange-500">{e.heuresSupplementaires > 0 ? `${e.heuresSupplementaires}h` : '--'}</td>
                            <td className="px-3 py-3 text-right font-medium">{formatCurrency(e.salaireBrut)}</td>
                            <td className="px-3 py-3 text-right text-red-500">{formatCurrency(e.totalDeductions)}</td>
                            <td className="px-3 py-3 text-right font-bold text-green-600">{formatCurrency(e.salaireNet)}</td>
                            <td className="px-3 py-3 text-right text-purple-600 font-medium">{formatCurrency(e.coutTotal)}</td>
                            <td className="px-3 py-3 text-center">
                              <Badge color={e.isCcq ? 'blue' : 'gray'} size="sm">{e.isCcq ? 'Oui' : 'Non'}</Badge>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <button
                                onClick={() => openFiche(e.id)}
                                className="text-seaop-primary-600 hover:text-seaop-primary-800 transition-colors"
                                title="Voir la fiche de paie"
                              >
                                <FileText size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {payrollEntries.length === 0 && (
                          <tr>
                            <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                              {selectedPeriodId
                                ? 'Aucune fiche de paie. Cliquez "Calculer paie" pour générer.'
                                : 'Sélectionnez ou créez une période de paie.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {payrollEntries.map((e) => (
                    <Card key={e.id} padding="sm">
                      <div className="flex items-start justify-between mb-1">
                        <h4 className="font-medium text-sm text-gray-900 dark:text-white">{e.employe}</h4>
                        <div className="flex items-center gap-1.5">
                          <Badge color={e.isCcq ? 'blue' : 'gray'} size="sm">{e.isCcq ? 'CCQ' : 'Non-CCQ'}</Badge>
                          <button
                            onClick={() => openFiche(e.id)}
                            className="text-seaop-primary-600 hover:text-seaop-primary-800 transition-colors"
                            title="Voir la fiche de paie"
                          >
                            <FileText size={16} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{e.departement || '--'}</p>
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{e.heuresRegulieres}h reg{e.heuresSupplementaires > 0 ? ` + ${e.heuresSupplementaires}h supp` : ''}</span>
                        <span className="font-medium text-gray-900 dark:text-white">Brut: {formatCurrency(e.salaireBrut)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-red-500">Ded: {formatCurrency(e.totalDeductions)}</span>
                        <span className="font-bold text-green-600">Net: {formatCurrency(e.salaireNet)}</span>
                      </div>
                    </Card>
                  ))}
                  {payrollEntries.length === 0 && (
                    <p className="text-gray-400 text-center py-8">
                      {selectedPeriodId
                        ? 'Aucune fiche de paie. Cliquez "Calculer paie" pour générer.'
                        : 'Sélectionnez ou créez une période de paie.'}
                    </p>
                  )}
                </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Create Time Entry Modal */}
      <Modal isOpen={showCreateEntry} onClose={() => setShowCreateEntry(false)} title="Nouveau pointage" size="lg">
        <div className="space-y-4">
          {entryError && <Alert type="error" onClose={() => setEntryError(null)}>{entryError}</Alert>}
          <Select
            label="Employé *"
            options={[
              { value: '', label: 'Sélectionner un employé' },
              ...employeesList.map((emp) => ({
                value: String(emp.id),
                label: `${emp.prenom} ${emp.nom}`,
              })),
            ]}
            value={entryForm.employeeId}
            onChange={(e) => setEntryForm({ ...entryForm, employeeId: e.target.value })}
          />
          <Select
            label="Projet"
            options={[
              { value: '', label: '-- Aucun projet --' },
              ...projectsList.map((p) => ({
                value: String(p.id),
                label: p.nomProjet,
              })),
            ]}
            value={entryForm.projectId}
            onChange={(e) => setEntryForm({ ...entryForm, projectId: e.target.value })}
          />
          <Select
            label="Bon de travail"
            options={[
              { value: '', label: '-- Aucun BT --' },
              ...workOrdersList.map((bt) => ({
                value: String(bt.id),
                label: `${bt.numeroDocument}${bt.projectNom ? ` - ${bt.projectNom}` : ''}`,
              })),
            ]}
            value={entryForm.formulaireBtId}
            onChange={(e) => setEntryForm({ ...entryForm, formulaireBtId: e.target.value })}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Entrée (Punch In)" type="datetime-local" value={entryForm.punchIn} onChange={(e) => setEntryForm({ ...entryForm, punchIn: e.target.value })} />
            <Input label="Sortie (Punch Out)" type="datetime-local" value={entryForm.punchOut} onChange={(e) => setEntryForm({ ...entryForm, punchOut: e.target.value })} />
          </div>
          {computedHours > 0 && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
              <span className="text-gray-500">Heures calculees: </span>
              <span className="font-medium">{computedHours}h</span>
            </div>
          )}
          <Textarea label="Notes" value={entryForm.notes} onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })} rows={2} />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={entryForm.billable}
              onChange={(e) => setEntryForm({ ...entryForm, billable: e.target.checked })}
              className="rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
            />
            Facturable
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreateEntry(false)}>Annuler</Button>
            <Button onClick={handleCreateEntry} isLoading={entryLoading} disabled={!entryForm.employeeId}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* ==================== MODAL EDITION POINTAGE ==================== */}
      <Modal
        isOpen={showEditEntry && !!editingEntry}
        onClose={() => { setShowEditEntry(false); setEditingEntry(null); }}
        title="Modifier le pointage"
        size="lg"
      >
        {editingEntry && (
          <div className="space-y-4">
            {editError && <Alert type="error" onClose={() => setEditError(null)}>{editError}</Alert>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                label="Employé *"
                options={[
                  { value: '', label: 'Sélectionner un employé' },
                  ...employeesList.map((emp) => ({
                    value: String(emp.id),
                    label: `${emp.prenom} ${emp.nom}`,
                  })),
                ]}
                value={editForm.employeeId ? String(editForm.employeeId) : ''}
                onChange={(e) => setEditForm({ ...editForm, employeeId: e.target.value ? Number(e.target.value) : undefined })}
              />
              <Select
                label="Projet"
                options={[
                  { value: '', label: '-- Aucun projet --' },
                  ...projectsList.map((p) => ({ value: String(p.id), label: p.nomProjet })),
                ]}
                value={editForm.projectId || ''}
                onChange={(e) => setEditForm({ ...editForm, projectId: e.target.value })}
              />
              <Select
                label="Bon de travail"
                options={[
                  { value: '', label: '-- Aucun BT --' },
                  ...workOrdersList.map((bt) => ({
                    value: String(bt.id),
                    label: `${bt.numeroDocument}${bt.projectNom ? ` - ${bt.projectNom}` : ''}`,
                  })),
                ]}
                value={editForm.formulaireBtId != null ? String(editForm.formulaireBtId) : ''}
                onChange={(e) => handleEditBtChange(e.target.value)}
              />
              <Select
                label={editOperationsLoading ? 'Opération (chargement...)' : 'Opération'}
                options={[
                  { value: '', label: editForm.formulaireBtId ? '-- Aucune opération --' : '-- Sélectionnez un BT --' },
                  ...editOperationsList.map((op) => ({ value: String(op.id), label: op.label })),
                ]}
                value={editForm.operationId != null ? String(editForm.operationId) : ''}
                onChange={(e) => setEditForm({ ...editForm, operationId: e.target.value })}
                disabled={!editForm.formulaireBtId || editOperationsLoading}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Entrée"
                type="datetime-local"
                step="1"
                value={editForm.punchIn || ''}
                onChange={(e) => setEditForm({ ...editForm, punchIn: e.target.value })}
              />
              <Input
                label="Sortie"
                type="datetime-local"
                step="1"
                value={editForm.punchOut || ''}
                onChange={(e) => setEditForm({ ...editForm, punchOut: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
                <span className="text-gray-500">Heures calculées: </span>
                <span className="font-medium">{editComputedHours > 0 ? `${editComputedHours}h` : '--'}</span>
              </div>
              <Input
                label="Type de travail"
                placeholder="Ex: Installation, Réparation..."
                value={editForm.typeTravail || ''}
                onChange={(e) => setEditForm({ ...editForm, typeTravail: e.target.value })}
              />
            </div>

            <Textarea
              label="Notes"
              value={editForm.notes || ''}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              rows={3}
            />

            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.billable ?? true}
                  onChange={(e) => setEditForm({ ...editForm, billable: e.target.checked })}
                  className="rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
                />
                Facturable
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.validated ?? false}
                  onChange={(e) => setEditForm({ ...editForm, validated: e.target.checked })}
                  className="rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
                />
                Validé
              </label>
              {editingEntry.isBilled && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  <Lock size={12} className="inline mr-1" />
                  Déjà facturé — modifications refusées côté serveur
                </span>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => { setShowEditEntry(false); setEditingEntry(null); }}>
                Annuler
              </Button>
              <Button onClick={handleUpdateEntry} isLoading={editLoading}>
                Enregistrer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Period Modal */}
      <Modal isOpen={showCreatePeriod} onClose={() => setShowCreatePeriod(false)} title="Nouvelle période de paie" size="md">
        <div className="space-y-4">
          <Input
            label="Date début *"
            type="date"
            value={periodForm.dateDebut}
            onChange={(e) => setPeriodForm({ ...periodForm, dateDebut: e.target.value })}
          />
          <Input
            label="Date fin *"
            type="date"
            value={periodForm.dateFin}
            onChange={(e) => setPeriodForm({ ...periodForm, dateFin: e.target.value })}
          />
          <Select
            label="Type de période"
            options={[
              { value: 'HEBDOMADAIRE', label: 'Hebdomadaire (52 periodes/an)' },
              { value: 'BI_HEBDO', label: 'Bi-hebdomadaire (26 periodes/an)' },
              { value: 'MENSUEL', label: 'Mensuel (12 periodes/an)' },
            ]}
            value={periodForm.typePeriode}
            onChange={(e) => setPeriodForm({ ...periodForm, typePeriode: e.target.value })}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreatePeriod(false)}>Annuler</Button>
            <Button onClick={handleCreatePeriod} disabled={!periodForm.dateDebut || !periodForm.dateFin}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Fiche de Paie Detail Modal */}
      <Modal isOpen={showFiche} onClose={() => { setShowFiche(false); setFicheDetail(null); }} title="Fiche de paie" size="xl">
        {ficheLoading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : ficheDetail ? (
          <div className="space-y-4 text-sm">
            {/* Header */}
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {ficheDetail.prenom} {ficheDetail.nom}
                </h3>
                <p className="text-gray-500">{ficheDetail.poste || ''} — {ficheDetail.departement || ''}</p>
              </div>
              <div className="text-right text-xs text-gray-400">
                <p>Période: {ficheDetail.periodDateDebut} au {ficheDetail.periodDateFin}</p>
                <p>Type: {ficheDetail.typePeriode}</p>
              </div>
            </div>

            {/* Hours */}
            <Card padding="sm">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Heures travaillees</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><span className="text-gray-500">Regulieres:</span> <span className="font-medium">{ficheDetail.heuresRegulieres}h</span></div>
                <div><span className="text-gray-500">Supplementaires:</span> <span className="font-medium text-orange-500">{ficheDetail.heuresSupplementaires}h</span></div>
                <div><span className="text-gray-500">Taux horaire:</span> <span className="font-medium">{ficheDetail.tauxHoraire}$/h</span></div>
              </div>
            </Card>

            {/* Gross / Net */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card padding="sm" className="text-center">
                <p className="text-xs text-gray-500 uppercase">Salaire brut</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(ficheDetail.salaireBrut)}</p>
              </Card>
              <Card padding="sm" className="text-center">
                <p className="text-xs text-gray-500 uppercase">Salaire net</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(ficheDetail.salaireNet)}</p>
              </Card>
              <Card padding="sm" className="text-center">
                <p className="text-xs text-gray-500 uppercase">Coût employeur</p>
                <p className="text-xl font-bold text-purple-600">{formatCurrency(ficheDetail.coutTotal)}</p>
              </Card>
            </div>

            {/* Employee Deductions */}
            <Card padding="sm">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Deductions employe</h4>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr>
                    <td className="py-1.5 text-gray-600">Impot federal</td>
                    <td className="py-1.5 text-right font-medium text-red-500">{formatCurrency(ficheDetail.impotFederal)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">Impot provincial QC</td>
                    <td className="py-1.5 text-right font-medium text-red-500">{formatCurrency(ficheDetail.impotProvincial)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">RRQ (6.40%)</td>
                    <td className="py-1.5 text-right font-medium text-red-500">{formatCurrency(ficheDetail.rrqEmploye)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">RQAP (0.494%)</td>
                    <td className="py-1.5 text-right font-medium text-red-500">{formatCurrency(ficheDetail.rqapEmploye)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">AE (1.32%)</td>
                    <td className="py-1.5 text-right font-medium text-red-500">{formatCurrency(ficheDetail.aeEmploye)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="py-1.5">Total deductions</td>
                    <td className="py-1.5 text-right text-red-600">{formatCurrency(ficheDetail.totalDeductions)}</td>
                  </tr>
                </tbody>
              </table>
            </Card>

            {/* Employer Charges */}
            <Card padding="sm">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Charges employeur</h4>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr>
                    <td className="py-1.5 text-gray-600">RRQ employeur (6.40%)</td>
                    <td className="py-1.5 text-right font-medium text-purple-500">{formatCurrency(ficheDetail.rrqEmployeur)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">RQAP employeur (0.692%)</td>
                    <td className="py-1.5 text-right font-medium text-purple-500">{formatCurrency(ficheDetail.rqapEmployeur)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">AE employeur (1.848%)</td>
                    <td className="py-1.5 text-right font-medium text-purple-500">{formatCurrency(ficheDetail.aeEmployeur)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">CNESST (1.80%)</td>
                    <td className="py-1.5 text-right font-medium text-purple-500">{formatCurrency(ficheDetail.cnesst)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">FSS (1.65%)</td>
                    <td className="py-1.5 text-right font-medium text-purple-500">{formatCurrency(ficheDetail.fss)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-600">
                      CCQ (12.5%)
                      {ficheDetail.isCcq ? (
                        <span className="ml-2"><Badge color="blue" size="sm">Applicable</Badge></span>
                      ) : (
                        <span className="ml-2"><Badge color="gray" size="sm">N/A</Badge></span>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-medium text-purple-500">{formatCurrency(ficheDetail.ccq)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="py-1.5">Total charges employeur</td>
                    <td className="py-1.5 text-right text-purple-600">{formatCurrency(ficheDetail.totalCharges)}</td>
                  </tr>
                </tbody>
              </table>
            </Card>

            <div className="flex justify-end pt-2">
              <Button variant="ghost" onClick={() => { setShowFiche(false); setFicheDetail(null); }}>Fermer</Button>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">Aucune donnée</p>
        )}
      </Modal>
    </div>
  );
}
