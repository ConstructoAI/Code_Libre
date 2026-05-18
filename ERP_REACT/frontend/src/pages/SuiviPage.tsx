/**
 * ERP React Frontend - Suivi Page
 * Three views: Kanban | Gantt | Calendrier
 * Kanban supports drag-and-drop to change item statuses.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Kanban, RefreshCw, BarChart3, Calendar, ChevronLeft, ChevronRight, X, Download, Link2, Plus, MoreVertical, Filter, CheckCircle2, DollarSign, ListTodo, UserPlus, ArrowRight, Search, Printer, ArrowUp, ArrowDown, GripVertical, Briefcase, ClipboardList, FileText, TrendingUp, ShoppingCart, Receipt, MessageSquare, Activity, Flag, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';
import * as productionApi from '@/api/production';
import * as projectsApi from '@/api/projects';
import * as devisApi from '@/api/devis';
import * as crmApi from '@/api/crm';
import * as suppliersApi from '@/api/suppliers';
import * as companiesApi from '@/api/companies';
import * as aiApi from '@/api/ai';
import { listEmployees } from '@/api/employees';
import type { KanbanData, KanbanAssignee, CalendarEvent } from '@/api/production';
import type { GanttProject, GanttPhase } from '@/api/projects';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { formatCurrency, formatDate } from '@/utils/format';

// ============================================================
// Types & Constants
// ============================================================

type MainTab = 'kanban' | 'gantt' | 'calendrier';
type KanbanView = 'ventes' | 'projects' | 'devis' | 'bons_travail' | 'achats' | 'factures';
type GanttSource = 'ventes' | 'projets' | 'bons_travail' | 'devis' | 'bons_commande';
type GanttZoom = 'semaine' | '2semaines' | 'mois';

const VENTES_COLUMNS = ['PROSPECTION', 'QUALIFICATION', 'PROPOSITION', 'NEGOCIATION'];
const PROJECT_COLUMNS = ['En attente', 'En cours', 'Termine'];
const DEVIS_COLUMNS = ['Brouillon', 'Envoye', 'Accepte', 'Refuse'];
const BT_COLUMNS = ['BROUILLON', 'EN_COURS', 'EN_PAUSE', 'TERMINE'];
const ACHATS_COLUMNS = ['Brouillon', 'Envoye', 'Recu', 'Annule'];
const FACTURES_COLUMNS = ['BROUILLON', 'ENVOYEE', 'PAYEE', 'EN_RETARD'];

// Mirroir cote frontend du BT_STATUS_TRANSITIONS backend
// (production.py:39-45). Permet de filtrer le dropdown statut du Gantt
// pour ne montrer que les transitions valides depuis le statut courant.
// Sans cela, l'utilisateur pouvait choisir un statut invalide et recevoir
// un 400 "Transition de statut interdite" sans pouvoir s'expliquer pourquoi.
const BT_STATUS_TRANSITIONS_FRONT: Record<string, string[]> = {
  BROUILLON: ['BROUILLON', 'EN_COURS', 'ANNULE'],
  EN_COURS: ['EN_COURS', 'EN_PAUSE', 'TERMINE', 'ANNULE'],
  EN_PAUSE: ['EN_PAUSE', 'EN_COURS', 'ANNULE'],
  TERMINE: ['TERMINE'],
  ANNULE: ['ANNULE'],
};

// Aliases legacy (accents/espaces) -> cle canonique
const _BT_STATUS_ALIASES_FRONT: Record<string, string> = {
  'TERMINÉ': 'TERMINE', 'TERMINÉE': 'TERMINE', 'TERMINEE': 'TERMINE',
  'COMPLETE': 'TERMINE', 'COMPLETÉ': 'TERMINE', 'COMPLET': 'TERMINE',
  'ANNULÉ': 'ANNULE', 'ANNULÉE': 'ANNULE', 'ANNULEE': 'ANNULE',
  'EN COURS': 'EN_COURS', 'EN PAUSE': 'EN_PAUSE',
  'BLOQUE': 'EN_PAUSE', 'BLOQUÉ': 'EN_PAUSE',
  'REPORTE': 'EN_PAUSE', 'REPORTÉ': 'EN_PAUSE',
  'EN ATTENTE': 'BROUILLON', 'EN_ATTENTE': 'BROUILLON',
};

function _normalizeBtStatusFront(s: string | undefined | null): string {
  if (!s) return 'BROUILLON';
  const upper = s.trim().toUpperCase();
  return _BT_STATUS_ALIASES_FRONT[upper] || upper;
}

function getAllowedBtTransitions(currentStatus: string | undefined | null): string[] {
  const key = _normalizeBtStatusFront(currentStatus);
  const allowed = BT_STATUS_TRANSITIONS_FRONT[key];
  if (allowed && allowed.length > 0) return allowed;
  // Fallback : statut inconnu ou non-canonique -> proposer tous (le backend
  // rejettera si transition vraiment interdite, et le fix saveInlineEdit
  // affichera le message d'erreur clair du backend).
  return ['BROUILLON', 'EN_COURS', 'EN_PAUSE', 'TERMINE', 'ANNULE'];
}

const STATUS_BAR_COLORS: Record<string, string> = {
  // Palette pastel professionnelle — tons mats et raffines
  'En attente': 'bg-[#F6C87A]',   // or doux
  'En cours': 'bg-[#7BAFD4]',     // bleu acier pastel
  'Termine': 'bg-[#7DC4A5]',      // vert sauge
  'Brouillon': 'bg-[#B8C4CE]',    // gris ardoise doux
  'Envoye': 'bg-[#8B9FD4]',       // bleu lavande
  'Accepte': 'bg-[#7DC4A5]',      // vert sauge
  'Refuse': 'bg-[#E8919A]',       // rose corail mat
  'BROUILLON': 'bg-[#B8C4CE]',
  'EN_COURS': 'bg-[#7BAFD4]',
  'TERMINE': 'bg-[#7DC4A5]',
  'EN_PAUSE': 'bg-[#E8C17A]',     // ambre mat
  'Recu': 'bg-[#7DC4B5]',         // sarcelle doux
  'Annule': 'bg-[#E8919A]',
  'Suspendu': 'bg-[#E8C17A]',
  'ENVOYEE': 'bg-[#8B9FD4]',
  'PAYEE': 'bg-[#7DC4A5]',
  'EN_RETARD': 'bg-[#E8919A]',
  'PARTIELLEMENT_PAYEE': 'bg-[#F6C87A]',
  'PROSPECTION': 'bg-[#9BB8D8]',  // bleu ciel doux
  'QUALIFICATION': 'bg-[#F6C87A]',
  'PROPOSITION': 'bg-[#B09BD8]',  // mauve pastel
  'NEGOCIATION': 'bg-[#F0B07A]',  // peche
  'GAGNE': 'bg-[#7DC4A5]',
  'PERDU': 'bg-[#E8919A]',
  'Confirme': 'bg-[#7DC4B5]',
};

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const SHORT_MONTH_NAMES_FR = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
  'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc',
];

const DAY_NAMES_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// Icônes lucide-react par type d'événement (aide daltoniens + scan rapide)
const ICONES_PAR_TYPE: Record<string, LucideIcon> = {
  project: Briefcase,
  project_start: Briefcase,
  bon_travail: ClipboardList,
  devis: FileText,
  opportunite: TrendingUp,
  bon_commande: ShoppingCart,
  facture: Receipt,
  interaction: MessageSquare,
  activite: Activity,
};

// Jours fériés Québec 2024-2030 (loi sur les normes du travail + CCQ construction)
// Format: 'YYYY-MM-DD' → libellé court
const JOURS_FERIES_QC: Record<string, string> = {
  // 2024
  '2024-01-01': 'Jour de l\'An',
  '2024-03-29': 'Vendredi saint',
  '2024-04-01': 'Lundi de Pâques',
  '2024-05-20': 'Journée nationale des patriotes',
  '2024-06-24': 'Fête nationale du Québec',
  '2024-07-01': 'Fête du Canada',
  '2024-09-02': 'Fête du Travail',
  '2024-10-14': 'Action de grâce',
  '2024-12-25': 'Noël',
  '2024-12-26': 'Lendemain de Noël',
  // 2025
  '2025-01-01': 'Jour de l\'An',
  '2025-04-18': 'Vendredi saint',
  '2025-04-21': 'Lundi de Pâques',
  '2025-05-19': 'Journée nationale des patriotes',
  '2025-06-24': 'Fête nationale du Québec',
  '2025-07-01': 'Fête du Canada',
  '2025-09-01': 'Fête du Travail',
  '2025-10-13': 'Action de grâce',
  '2025-12-25': 'Noël',
  '2025-12-26': 'Lendemain de Noël',
  // 2026
  '2026-01-01': 'Jour de l\'An',
  '2026-04-03': 'Vendredi saint',
  '2026-04-06': 'Lundi de Pâques',
  '2026-05-18': 'Journée nationale des patriotes',
  '2026-06-24': 'Fête nationale du Québec',
  '2026-07-01': 'Fête du Canada',
  '2026-09-07': 'Fête du Travail',
  '2026-10-12': 'Action de grâce',
  '2026-12-25': 'Noël',
  '2026-12-26': 'Lendemain de Noël',
  // 2027
  '2027-01-01': 'Jour de l\'An',
  '2027-03-26': 'Vendredi saint',
  '2027-03-29': 'Lundi de Pâques',
  '2027-05-17': 'Journée nationale des patriotes',
  '2027-06-24': 'Fête nationale du Québec',
  '2027-07-01': 'Fête du Canada',
  '2027-09-06': 'Fête du Travail',
  '2027-10-11': 'Action de grâce',
  '2027-12-25': 'Noël',
  '2027-12-27': 'Lendemain de Noël (reporté)',
  // 2028
  '2028-01-03': 'Jour de l\'An (reporté)',
  '2028-04-14': 'Vendredi saint',
  '2028-04-17': 'Lundi de Pâques',
  '2028-05-22': 'Journée nationale des patriotes',
  '2028-06-26': 'Fête nationale du Québec (reportée)',
  '2028-07-03': 'Fête du Canada (reportée)',
  '2028-09-04': 'Fête du Travail',
  '2028-10-09': 'Action de grâce',
  '2028-12-25': 'Noël',
  '2028-12-26': 'Lendemain de Noël',
  // 2029
  '2029-01-01': 'Jour de l\'An',
  '2029-03-30': 'Vendredi saint',
  '2029-04-02': 'Lundi de Pâques',
  '2029-05-21': 'Journée nationale des patriotes',
  '2029-06-25': 'Fête nationale du Québec (reportée)',
  '2029-07-02': 'Fête du Canada (reportée)',
  '2029-09-03': 'Fête du Travail',
  '2029-10-08': 'Action de grâce',
  '2029-12-25': 'Noël',
  '2029-12-26': 'Lendemain de Noël',
  // 2030
  '2030-01-01': 'Jour de l\'An',
  '2030-04-19': 'Vendredi saint',
  '2030-04-22': 'Lundi de Pâques',
  '2030-05-20': 'Journée nationale des patriotes',
  '2030-06-24': 'Fête nationale du Québec',
  '2030-07-01': 'Fête du Canada',
  '2030-09-02': 'Fête du Travail',
  '2030-10-14': 'Action de grâce',
  '2030-12-25': 'Noël',
  '2030-12-26': 'Lendemain de Noël',
};

function getFerieQC(iso: string): string | null {
  return JOURS_FERIES_QC[iso.substring(0, 10)] || null;
}

interface DragItem {
  id: string | number;
  type: KanbanView;
  fromStatus: string;
}

// ============================================================
// Helper: date math
// ============================================================

function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / (1000 * 60 * 60 * 24));
}

/** Auto-calculate progress % based on elapsed days vs total duration */
function calcAutoProgress(dateDebut?: string, dateFin?: string): number | null {
  const s = parseDate(dateDebut);
  const e = parseDate(dateFin);
  if (!s || !e) return null;
  const today = new Date();
  if (today < s) return 0;
  if (today >= e) return 100;
  const total = daysBetween(s, e);
  if (total <= 0) return 100;
  const elapsed = daysBetween(s, today);
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ============================================================
// Main Component
// ============================================================

export default function SuiviPage() {
  const [mainTab, setMainTab] = useState<MainTab>('kanban');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={`flex flex-col ${mainTab === 'gantt' || mainTab === 'calendrier' ? 'h-[calc(100vh-80px)]' : 'space-y-4'}`}>
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Suivi</h2>
      </div>

      {/* Main tab selector: Kanban | Gantt | Calendrier */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide shrink-0">
        {([
          ['kanban', 'Kanban', Kanban],
          ['gantt', 'Gantt', BarChart3],
          ['calendrier', 'Calendrier', Calendar],
        ] as [MainTab, string, typeof Kanban][]).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              mainTab === key
                ? 'border-seaop-primary-600 text-seaop-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {mainTab === 'kanban' && <KanbanTab onError={setError} />}
      {mainTab === 'gantt' && <GanttTab onError={setError} />}
      {mainTab === 'calendrier' && <CalendarTab onError={setError} />}
    </div>
  );
}

// ============================================================
// KANBAN TAB — Modern visual design with sidebar, rich cards,
// drag & drop with dashed placeholders, toast notifications.
// ============================================================

/** Compute a deadline badge for a kanban card. */
function getDeadlineBadge(dueDate: string | undefined | null): { label: string; color: 'red' | 'blue' | 'yellow' | 'gray' } | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: 'En retard', color: 'red' };
  if (diff === 0) return { label: "Aujourd'hui", color: 'blue' };
  if (diff <= 3) return { label: `${diff}j restants`, color: 'yellow' };
  return null;
}

/** Format a date as short display: "12 Jan 2025" */
function formatShortDate(d: string | undefined | null): string {
  if (!d) return '--';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Generate initials + color from a name for avatar placeholders. */
const AVATAR_COLORS = [
  'bg-[#7BAFD4]', 'bg-[#7DC4A5]', 'bg-[#B09BD8]', 'bg-[#F0B07A]',
  'bg-[#E8919A]', 'bg-[#7DC4B5]', 'bg-[#8B9FD4]', 'bg-[#E8C17A]',
];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getAvatarColor(id: string | number): string {
  const hash = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Column dot color mapping */
const COLUMN_DOT_COLORS: Record<string, string> = {
  'En attente': 'bg-[#F6C87A]',
  'En cours': 'bg-[#7BAFD4]',
  'Termine': 'bg-[#7DC4A5]',
  'Brouillon': 'bg-[#B8C4CE]',
  'Envoye': 'bg-[#8B9FD4]',
  'Accepte': 'bg-[#7DC4A5]',
  'Refuse': 'bg-[#E8919A]',
  'BROUILLON': 'bg-[#B8C4CE]',
  'EN_COURS': 'bg-[#7BAFD4]',
  'TERMINE': 'bg-[#7DC4A5]',
  'Recu': 'bg-[#7DC4B5]',
  'Annule': 'bg-[#E8919A]',
  'EN_PAUSE': 'bg-[#E8C17A]',
  'Suspendu': 'bg-[#E8C17A]',
  'PROSPECTION': 'bg-[#9BB8D8]',
  'QUALIFICATION': 'bg-[#F6C87A]',
  'PROPOSITION': 'bg-[#B09BD8]',
  'NEGOCIATION': 'bg-[#F0B07A]',
  'GAGNE': 'bg-[#7DC4A5]',
  'PERDU': 'bg-[#E8919A]',
};

/** Column display names (prettier) */
const COLUMN_LABELS: Record<string, string> = {
  'En attente': 'À faire',
  'En cours': 'En cours',
  'Termine': 'Terminé',
  'Brouillon': 'Brouillon',
  'Envoye': 'Envoyé',
  'Accepte': 'Accepté',
  'Refuse': 'Refusé',
  'BROUILLON': 'À faire',
  'EN_COURS': 'En cours',
  'TERMINE': 'Terminé',
  'Recu': 'Reçu',
  'PROSPECTION': 'Prospection',
  'QUALIFICATION': 'Qualification',
  'PROPOSITION': 'Proposition',
  'NEGOCIATION': 'Négociation',
  'Annule': 'Annulé',
};

function KanbanTab({ onError }: { onError: (msg: string) => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<KanbanData | null>(null);
  const [achatsData, setAchatsData] = useState<any[]>([]);
  const [facturesData, setFacturesData] = useState<any[]>([]);
  const [ventesData, setVentesData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<KanbanView>('ventes');
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const dragItemRef = useRef<DragItem | null>(null);
  const [expandedItem, setExpandedItem] = useState<Record<string, unknown> | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | number | null>(null);

  // Assign modal state
  const [assignTarget, setAssignTarget] = useState<{ id: string | number; type: KanbanView } | null>(null);
  const [employees, setEmployees] = useState<{ id: number; prenom: string; nom: string }[]>([]);
  const [employeesLoaded, setEmployeesLoaded] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const isMobile = useIsMobile();
  const [mobileStatusMenu, setMobileStatusMenu] = useState<{ id: string | number; type: KanbanView; fromStatus: string } | null>(null);
  const [activeColumnIdx, setActiveColumnIdx] = useState(0);
  const kanbanScrollRef = useRef<HTMLDivElement>(null);

  // Auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load employees when assign modal opens
  useEffect(() => {
    if (assignTarget && !employeesLoaded) {
      listEmployees({ perPage: 100 }).then(res => {
        setEmployees(res.items.map(e => ({ id: e.id, prenom: e.prenom, nom: e.nom })));
        setEmployeesLoaded(true);
      }).catch(() => {});
    }
  }, [assignTarget, employeesLoaded]);

  /** Assign an employee to an item */
  const handleAssign = async (employeeId: number) => {
    if (!assignTarget) return;
    setAssignLoading(true);
    try {
      if (assignTarget.type === 'projects') {
        await projectsApi.addProjectAssignment(String(assignTarget.id), { employeeId });
      } else if (assignTarget.type === 'devis') {
        await devisApi.addDevisAssignment(Number(assignTarget.id), { employeeId });
      } else if (assignTarget.type === 'achats') {
        await productionApi.addAchatAssignation(Number(assignTarget.id), { employeeId });
      } else if (assignTarget.type === 'ventes') {
        await crmApi.addOpportunityAssignation(Number(assignTarget.id), { employeeId });
      } else {
        await productionApi.addAssignation(Number(assignTarget.id), { employeeId });
      }
      setToast('Employé assigné avec succès');
      setAssignTarget(null);
      setAssignSearch('');
      fetchData(); // Refresh to show new assignee
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Erreur lors de l\'assignation';
      onError(msg);
    } finally {
      setAssignLoading(false);
    }
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [kanbanRes, achatsRes, ventesRes] = await Promise.all([
        productionApi.getKanbanData(),
        productionApi.getKanbanAchats().catch(() => ({ items: [] })),
        crmApi.listOpportunities({ perPage: 100 }).catch(() => ({ items: [] })),
      ]);
      setData(kanbanRes);
      setFacturesData(kanbanRes.factures || []);
      setAchatsData(achatsRes.items || achatsRes || []);
      const ventesItems = (ventesRes.items || []).map((o: any) => ({
        id: o.id, nom: o.nom, statut: o.statut,
        montantTotal: o.montantEstime, budget: o.montantEstime,
        dateDebut: o.createdAt, dateFin: o.dateCloturePrevue,
        companyNom: o.companyNom, contactNom: o.contactNom,
        numero: o.numeroOpportunite, probabilite: o.probabilite,
        source: o.source,
        assignees: [] as { employeeId: number; nom: string }[],
      }));
      // Fetch assignees for all opportunities in parallel
      await Promise.all(ventesItems.map(async (v) => {
        try {
          const aRes = await crmApi.listOpportunityAssignations(v.id);
          v.assignees = (aRes.items || []).map((a: any) => ({ employeeId: a.employeeId, nom: a.employeNom || 'Inconnu' }));
        } catch { /* table may not exist yet */ }
      }));
      setVentesData(ventesItems);
    } catch {
      onError('Erreur lors du chargement du kanban');
    } finally {
      setIsLoading(false);
    }
  }, [onError]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // --- Drag-and-drop handlers ---

  const handleDragStart = (e: React.DragEvent, itemId: string | number, itemType: KanbanView, fromStatus: string) => {
    dragItemRef.current = { id: itemId, type: itemType, fromStatus };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: itemId, type: itemType, fromStatus }));
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';
    setDragOverColumn(null);
    dragItemRef.current = null;
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setDragOverColumn(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    const dragItem = dragItemRef.current;
    if (!dragItem) return;
    if (dragItem.fromStatus === newStatus) return;

    const { id, type } = dragItem;
    dragItemRef.current = null;

    // Handle ventes (opportunities) separately via CRM API
    if (type === 'ventes') {
      const prevVentes = [...ventesData];
      setVentesData(ventesData.map((v: any) => v.id === id ? { ...v, statut: newStatus } : v));
      try {
        await crmApi.updateOpportunity(Number(id), { statut: newStatus });
        setToast('Statut mis à jour avec succès');
      } catch (err: any) {
        setVentesData(prevVentes);
        const detail = err?.response?.data?.detail;
        const msg = typeof detail === 'string' && detail.trim()
          ? detail
          : 'Erreur lors du changement de statut. Le déplacement a été annulé.';
        onError(msg);
      }
      return;
    }

    if (!data) return;

    const prevData = { ...data, projects: [...data.projects], devis: [...data.devis], bonsTravail: [...data.bonsTravail] };

    if (type === 'projects') {
      setData({
        ...data,
        projects: data.projects.map((p) => p.id === id ? { ...p, statut: newStatus } : p),
        devis: [...data.devis],
        bonsTravail: [...data.bonsTravail],
      });
    } else if (type === 'devis') {
      setData({
        ...data,
        projects: [...data.projects],
        devis: data.devis.map((d) => d.id === id ? { ...d, statut: newStatus } : d),
        bonsTravail: [...data.bonsTravail],
      });
    } else if (type === 'factures') {
      const prevFactures = [...facturesData];
      setFacturesData(facturesData.map((f: any) => f.id === id ? { ...f, statut: newStatus } : f));
      try {
        await productionApi.updateKanbanStatus({ entityType: 'facture', entityId: String(id), newStatut: newStatus });
        setToast('Statut mis à jour avec succès');
        return;
      } catch (err: any) {
        setFacturesData(prevFactures);
        const detail = err?.response?.data?.detail;
        const msg = typeof detail === 'string' && detail.trim()
          ? detail
          : 'Erreur lors du changement de statut. Le déplacement a été annulé.';
        onError(msg);
        return;
      }
    } else if (type === 'achats') {
      const prevAchats = [...achatsData];
      setAchatsData(achatsData.map((a: any) => a.id === id ? { ...a, statut: newStatus } : a));
      try {
        await productionApi.updateKanbanStatus({ entityType: 'achat', entityId: String(id), newStatut: newStatus });
        setToast('Statut mis à jour avec succès');
        return;
      } catch (err: any) {
        setAchatsData(prevAchats);
        const detail = err?.response?.data?.detail;
        const msg = typeof detail === 'string' && detail.trim()
          ? detail
          : 'Erreur lors du changement de statut. Le déplacement a été annulé.';
        onError(msg);
        return;
      }
    } else {
      setData({
        ...data,
        projects: [...data.projects],
        devis: [...data.devis],
        bonsTravail: data.bonsTravail.map((b) => b.id === id ? { ...b, statut: newStatus } : b),
      });
    }

    try {
      await productionApi.updateKanbanStatus({
        entityType: type === 'projects' ? 'project' : type === 'devis' ? 'devis' : 'bon_travail',
        entityId: String(id),
        newStatut: newStatus,
      });
      setToast('Statut mis à jour avec succès');
    } catch {
      try {
        if (type === 'projects') {
          await projectsApi.updateProject(String(id), { statut: newStatus });
        } else if (type === 'devis') {
          await devisApi.updateDevis(Number(id), { statut: newStatus });
        } else {
          await productionApi.updateWorkOrder(Number(id), { statut: newStatus });
        }
        setToast('Statut mis à jour avec succès');
      } catch (err: any) {
        setData(prevData);
        // Extraire le detail backend (ex: "Transition de statut interdite:
        // TERMINE -> EN_PAUSE...") au lieu d'afficher un message generique.
        const detail = err?.response?.data?.detail;
        const msg = typeof detail === 'string' && detail.trim()
          ? detail
          : 'Erreur lors du changement de statut. Le déplacement a été annulé.';
        onError(msg);
      }
    }
  };

  if (isLoading) return <SkeletonPage />;

  const columns = view === 'ventes' ? VENTES_COLUMNS : view === 'projects' ? PROJECT_COLUMNS : view === 'devis' ? DEVIS_COLUMNS : view === 'achats' ? ACHATS_COLUMNS : view === 'factures' ? FACTURES_COLUMNS : BT_COLUMNS;

  const getItems = (status: string): Record<string, unknown>[] => {
    if (view === 'ventes') return ventesData.filter((v: any) => v.statut === status);
    if (view === 'achats') return achatsData.filter((a: any) => a.statut === status);
    if (view === 'factures') return facturesData.filter((f: any) => f.statut === status);
    if (!data) return [];
    if (view === 'projects') return data.projects.filter((p) => p.statut === status) as unknown as Record<string, unknown>[];
    if (view === 'devis') return data.devis.filter((d) => d.statut === status) as unknown as Record<string, unknown>[];
    return data.bonsTravail.filter((b) => b.statut === status) as unknown as Record<string, unknown>[];
  };

  // Summary stats
  const allItems = columns.flatMap(s => getItems(s));
  // For ventes: also count GAGNE/PERDU which are not in the active columns
  const allVentes = view === 'ventes' ? ventesData : [];
  const ventesGagne = allVentes.filter((v: any) => v.statut === 'GAGNE');
  const ventesPerdu = allVentes.filter((v: any) => v.statut === 'PERDU');
  const ventesGagneMontant = ventesGagne.reduce((s: number, v: any) => s + Number(v.montantTotal ?? 0), 0);
  const ventesPerduMontant = ventesPerdu.reduce((s: number, v: any) => s + Number(v.montantTotal ?? 0), 0);
  const doneStatuses = view === 'ventes' ? ['GAGNE'] : ['Termine', 'TERMINE', 'Accepte', 'Recu'];
  const inProgressStatuses = view === 'ventes' ? ['QUALIFICATION', 'PROPOSITION', 'NEGOCIATION'] : ['En cours', 'EN_COURS', 'Envoye'];
  const completedCount = view === 'ventes' ? ventesGagne.length : allItems.filter(i => doneStatuses.includes(String(i.statut))).length;
  const inProgressCount = allItems.filter(i => inProgressStatuses.includes(String(i.statut))).length;
  const pendingCount = view === 'ventes' ? allItems.filter(i => String(i.statut) === 'PROSPECTION').length : (allItems.length - completedCount - inProgressCount);
  // totalItems = sum of the 3 circles (excludes PERDU for ventes — shown separately in summary bar)
  const totalItems = view === 'ventes' ? (pendingCount + inProgressCount + completedCount) : allItems.length;
  const totalBudget = (view === 'ventes' ? allVentes : allItems).reduce((sum: number, i: any) => sum + Number(i.budget ?? i.budgetTotal ?? i.montantTotal ?? i.investissementTotal ?? 0), 0);
  const progressPercent = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;

  /** Get due date from item */
  const getDueDate = (item: Record<string, unknown>): string | undefined => {
    return (item.dateFinReel || item.dateFin || item.dateEcheance || item.datePrevu || item.dateValidite) as string | undefined;
  };

  /** Get start date from item */
  const getStartDate = (item: Record<string, unknown>): string | undefined => {
    return (item.dateDebutReel || item.createdAt || item.dateCommande) as string | undefined;
  };

  const viewLabels: Record<KanbanView, string> = {
    ventes: 'Ventes',
    projects: 'Projets',
    devis: 'Soumissions',
    bons_travail: 'Bons de Travail',
    achats: 'Achats',
    factures: 'Factures',
  };

  return (
    <div className={isMobile ? 'space-y-4' : 'flex gap-6'}>
      {/* ====== LEFT SIDEBAR — Project Summary (desktop only) ====== */}
      <div className={`w-72 shrink-0 space-y-5 ${isMobile ? 'hidden' : ''}`}>
        {/* View title */}
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Vue active</p>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-1">{viewLabels[view]}</h3>
        </div>

        {/* Task Information */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Information</h4>
            <Badge color="gray" size="sm">{totalItems}</Badge>
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>Progression</span>
              <span className="font-semibold text-[#5aad8a] dark:text-[#7DC4A5]">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-[#7DC4A5] rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          {/* Stat circles */}
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-center">
            <div>
              <div className="w-14 h-14 mx-auto rounded-full border-[3px] border-[#F6C87A] flex items-center justify-center">
                <span className="text-lg font-bold text-gray-900 dark:text-white">{pendingCount}</span>
              </div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5">{view === 'ventes' ? 'Prospect.' : 'À faire'}</p>
            </div>
            <div>
              <div className="w-14 h-14 mx-auto rounded-full border-[3px] border-[#7BAFD4] flex items-center justify-center">
                <span className="text-lg font-bold text-gray-900 dark:text-white">{inProgressCount}</span>
              </div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5">{view === 'ventes' ? 'Pipeline' : 'En cours'}</p>
            </div>
            <div>
              <div className="w-14 h-14 mx-auto rounded-full border-[3px] border-[#7DC4A5] flex items-center justify-center">
                <span className="text-lg font-bold text-gray-900 dark:text-white">{completedCount}</span>
              </div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5">{view === 'ventes' ? 'Gagné' : 'Terminés'}</p>
            </div>
          </div>
        </div>

        {/* Budget summary */}
        {totalBudget > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={14} className="text-gray-400" />
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Budget</h4>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(totalBudget)}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Budget total</p>
            </div>
          </div>
        )}

        {/* Item count by status */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <ListTodo size={14} className="text-gray-400" />
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Par statut</h4>
          </div>
          <div className="space-y-2">
            {columns.map(status => {
              const count = getItems(status).length;
              const pct = totalItems > 0 ? Math.round((count / totalItems) * 100) : 0;
              return (
                <div key={status} className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${COLUMN_DOT_COLORS[status] || 'bg-gray-400'}`} />
                  <span className="text-xs text-gray-600 dark:text-gray-400 flex-1 truncate">{COLUMN_LABELS[status] || status}</span>
                  <span className="text-xs font-semibold text-gray-900 dark:text-white">{count}</span>
                  <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${COLUMN_DOT_COLORS[status] || 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ====== MAIN CONTENT — Kanban Board ====== */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Mobile compact stats — single-line inline badges */}
        {isMobile && (
          <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 shadow-sm">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#c8962a] bg-[#F6C87A]/20 dark:bg-[#F6C87A]/10 rounded-full px-2 py-0.5">
              {pendingCount} <span className="text-[10px] font-normal">a faire</span>
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#5a8fba] bg-[#7BAFD4]/20 dark:bg-[#7BAFD4]/10 rounded-full px-2 py-0.5">
              {inProgressCount} <span className="text-[10px] font-normal">en cours</span>
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#5aad8a] bg-[#7DC4A5]/20 dark:bg-[#7DC4A5]/10 rounded-full px-2 py-0.5">
              {completedCount} <span className="text-[10px] font-normal">finis</span>
            </span>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <div className="w-12 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-[#7DC4A5] rounded-full" style={{ width: `${progressPercent}%` }} />
              </div>
              <span className="text-[10px] font-semibold text-[#5aad8a]">{progressPercent}%</span>
            </div>
          </div>
        )}

        {/* Top bar: sub-view selector + actions */}
        <div className={`flex ${isMobile ? 'flex-col gap-3' : 'items-center justify-between'}`}>
          <div className={`flex gap-1 ${isMobile ? 'overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide' : ''}`}>
            {([['ventes', 'Ventes'], ['devis', 'Soumissions'], ['projects', 'Projets'], ['achats', 'Achats'], ['bons_travail', 'BT'], ['factures', 'Factures']] as [KanbanView, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap shrink-0 ${
                  view === k
                    ? 'bg-seaop-primary-100 text-seaop-primary-700 dark:bg-seaop-primary-900/30 dark:text-seaop-primary-300'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" leftIcon={<Filter size={14} />}>Filtres</Button>
            <Button size="sm" variant="ghost" leftIcon={<RefreshCw size={14} />} onClick={fetchData}>Rafraîchir</Button>
          </div>
        </div>

        {/* Kanban columns */}
        <div
          ref={kanbanScrollRef}
          className={isMobile
            ? 'kanban-mobile flex gap-2.5 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scrollbar-hide'
            : 'grid gap-4'
          }
          style={isMobile ? undefined : { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
          onScroll={isMobile ? (e) => {
            const el = e.currentTarget;
            const colWidth = el.scrollWidth / columns.length;
            const idx = Math.round(el.scrollLeft / colWidth);
            setActiveColumnIdx(Math.min(idx, columns.length - 1));
          } : undefined}
        >
          {/* Gagne/Perdu summary for ventes */}
          {view === 'ventes' && (ventesGagne.length > 0 || ventesPerdu.length > 0) && (
            <div className="col-span-full flex gap-4 mb-2 px-1">
              {ventesGagne.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Badge color="green" size="sm">Gagne</Badge>
                  <span className="text-gray-500">{ventesGagne.length} opportunite{ventesGagne.length > 1 ? 's' : ''}</span>
                  <span className="font-semibold text-green-600">{formatCurrency(ventesGagneMontant)}</span>
                </div>
              )}
              {ventesPerdu.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Badge color="red" size="sm">Perdu</Badge>
                  <span className="text-gray-500">{ventesPerdu.length} opportunite{ventesPerdu.length > 1 ? 's' : ''}</span>
                  <span className="font-semibold text-red-600">{formatCurrency(ventesPerduMontant)}</span>
                </div>
              )}
            </div>
          )}

          {columns.map((status, _colIdx) => {
            const items = getItems(status);
            const isOver = dragOverColumn === status;
            const dotColor = COLUMN_DOT_COLORS[status] || 'bg-gray-400';
            const colMontant = view === 'ventes' ? items.reduce((s: number, i: any) => s + Number(i.montantTotal ?? 0), 0) : 0;
            return (
              <div
                key={status}
                className={`flex flex-col ${isMobile ? 'min-w-[72vw] max-w-[72vw] snap-start flex-shrink-0' : 'min-w-0'}`}
                onDragOver={(e) => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, status)}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 px-1 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                  <h3 className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold text-gray-700 dark:text-gray-300`}>{COLUMN_LABELS[status] || status}</h3>
                  <span className={`ml-auto flex items-center justify-center ${isMobile ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-xs'} rounded-full bg-gray-200 dark:bg-gray-700 font-bold text-gray-600 dark:text-gray-300`}>
                    {items.length}
                  </span>
                  {view === 'ventes' && !isMobile && <span className="text-[10px] text-gray-400 font-medium">{formatCurrency(colMontant)}</span>}
                </div>

                {/* Cards container */}
                <div className={`flex-1 rounded-xl ${isMobile ? 'p-1.5 space-y-2' : 'p-2 space-y-3'} ${isMobile ? 'max-h-[60vh]' : 'max-h-[65vh]'} overflow-y-auto transition-all duration-200 ${
                  isOver
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'bg-gray-50/50 dark:bg-gray-800/30'
                }`}>
                  {items.map((item: Record<string, unknown>, idx: number) => {
                    const dueDate = getDueDate(item);
                    const startDate = getStartDate(item);
                    const badge = getDeadlineBadge(dueDate);
                    const itemName = String(item.nom || item.titre || item.nomProjet || '');
                    const itemId = item.id as string | number;

                    return (
                      <div
                        key={`${view}-${status}-${itemId || idx}`}
                        draggable={!isMobile}
                        onDragStart={isMobile ? undefined : (e) => handleDragStart(e, itemId, view, status)}
                        onDragEnd={isMobile ? undefined : handleDragEnd}
                        onClick={() => setExpandedItem(item)}
                        onDoubleClick={() => {
                          const routeMap: Record<KanbanView, string> = { ventes: '/ventes', devis: '/devis', projects: '/projets', bons_travail: '/bons-travail', achats: '/magasin', factures: '/comptabilite' };
                          navigate(`${routeMap[view]}?open=${itemId}`);
                        }}
                        className={`bg-white dark:bg-gray-800 ${isMobile ? 'rounded-lg p-3' : 'rounded-xl p-4'} shadow-sm border border-gray-200 dark:border-gray-700 select-none hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 group relative ${
                          isMobile ? 'cursor-pointer active:scale-[0.98]' : 'cursor-grab active:cursor-grabbing'
                        }`}
                      >
                        {/* Card header: title + menu/move */}
                        <div className="flex items-start justify-between gap-1.5 mb-2">
                          <h4 className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold text-gray-900 dark:text-white leading-snug line-clamp-2`}>
                            {itemName}
                          </h4>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {/* Mobile: move to status button */}
                            {isMobile && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setMobileStatusMenu({ id: itemId, type: view, fromStatus: status }); }}
                                className="p-1 rounded-md bg-gray-100 dark:bg-gray-700 active:bg-gray-200"
                                title="Deplacer"
                              >
                                <ArrowRight size={12} className="text-gray-500" />
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); setMenuItemId(menuItemId === itemId ? null : itemId); }}
                              className={`p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity shrink-0 ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            >
                              <MoreVertical size={isMobile ? 12 : 14} className="text-gray-400" />
                            </button>
                          </div>
                        </div>

                        {/* Ventes: company + amount */}
                        {view === 'ventes' && (
                          <div className="flex items-center justify-between text-[11px] mb-1.5">
                            {item.companyNom != null && <span className="text-gray-500 truncate mr-2">{String(item.companyNom)}</span>}
                            {item.montantTotal != null && <span className="font-semibold text-[#5a8fba] whitespace-nowrap">{formatCurrency(Number(item.montantTotal))}</span>}
                          </div>
                        )}
                        {view === 'ventes' && item.probabilite != null && (
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full bg-[#7DC4A5] rounded-full" style={{ width: `${Number(item.probabilite)}%` }} />
                            </div>
                            <span className="text-[10px] text-gray-400 font-medium">{Number(item.probabilite)}%</span>
                          </div>
                        )}

                        {/* Dates row */}
                        <div className={`flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 ${isMobile ? 'mb-2' : 'mb-3'}`}>
                          {startDate && (
                            <div className="flex items-center gap-0.5">
                              <span className="font-medium text-gray-400">Deb:</span>
                              <span>{formatShortDate(startDate)}</span>
                            </div>
                          )}
                          {dueDate && (
                            <div className="flex items-center gap-0.5">
                              <span className="font-medium text-gray-400">Fin:</span>
                              <span>{formatShortDate(dueDate)}</span>
                            </div>
                          )}
                        </div>

                        {/* Bottom row: avatars + badges */}
                        <div className="flex items-center justify-between">
                          {/* Assignee avatars */}
                          <div className="flex items-center -space-x-1.5">
                            {((item.assignees as KanbanAssignee[] | undefined) || []).slice(0, isMobile ? 3 : 4).map((assignee, ai) => (
                              <div
                                key={assignee.employeeId || ai}
                                title={assignee.nom}
                                className={`${isMobile ? 'w-6 h-6 text-[9px]' : 'w-7 h-7 text-[10px]'} rounded-full ${getAvatarColor(assignee.employeeId)} flex items-center justify-center font-bold text-white ring-2 ring-white dark:ring-gray-800`}
                              >
                                {getInitials(assignee.nom)}
                              </div>
                            ))}
                            {((item.assignees as KanbanAssignee[] | undefined) || []).length > (isMobile ? 3 : 4) && (
                              <div className={`${isMobile ? 'w-6 h-6 text-[9px]' : 'w-7 h-7 text-[10px]'} rounded-full bg-gray-400 flex items-center justify-center font-bold text-white ring-2 ring-white dark:ring-gray-800`}>
                                +{((item.assignees as KanbanAssignee[] | undefined) || []).length - (isMobile ? 3 : 4)}
                              </div>
                            )}
                            {((item.assignees as KanbanAssignee[] | undefined) || []).length === 0 && (
                              <div className={`${isMobile ? 'w-6 h-6 text-[9px]' : 'w-7 h-7 text-[10px]'} rounded-full ${getAvatarColor(itemId)} flex items-center justify-center font-bold text-white ring-2 ring-white dark:ring-gray-800`}>
                                {getInitials(itemName)}
                              </div>
                            )}
                            {/* Add assignee button */}
                            {!isMobile && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setAssignTarget({ id: itemId, type: view }); }}
                              className="w-7 h-7 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center hover:border-seaop-primary-400 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 transition-colors ml-1"
                              title="Assigner un employé"
                            >
                              <Plus size={12} className="text-gray-400 dark:text-gray-500" />
                            </button>
                            )}
                          </div>

                          {/* Status badges */}
                          <div className="flex items-center gap-1.5">
                            {!!item.priorite && (String(item.priorite) === 'URGENT' || String(item.priorite) === 'Urgente' || String(item.priorite) === 'HAUTE') && (
                              <Badge color="red" size="sm">{String(item.priorite)}</Badge>
                            )}
                            {badge && (
                              <Badge color={badge.color} size="sm">{badge.label}</Badge>
                            )}
                            {!!(item.budget || item.budgetTotal || item.montantTotal || item.investissementTotal) && !badge && (
                              <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                                {formatCurrency(Number(item.budget || item.budgetTotal || item.montantTotal || item.investissementTotal))}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Drag placeholder */}
                  {isOver && (
                    <div className="border-2 border-dashed border-blue-400 dark:border-blue-500 rounded-xl p-6 flex items-center justify-center">
                      <p className="text-xs font-medium text-blue-500 dark:text-blue-400">Deposer ici</p>
                    </div>
                  )}

                  {items.length === 0 && !isOver && (
                    <div className={`flex flex-col items-center justify-center ${isMobile ? 'py-6' : 'py-8'} text-gray-400 dark:text-gray-500`}>
                      <ListTodo size={isMobile ? 20 : 24} className="mb-1.5 opacity-50" />
                      <p className="text-[11px]">Aucun element</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile column indicator dots */}
        {isMobile && columns.length > 1 && (
          <div className="kanban-dots flex items-center justify-center gap-1.5 pt-1">
            {columns.map((status, i) => (
              <button
                key={status}
                className={`rounded-full transition-all duration-200 ${
                  i === activeColumnIdx
                    ? 'w-4 h-1.5 bg-seaop-primary-500'
                    : 'w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600'
                }`}
                onClick={() => {
                  const el = kanbanScrollRef.current;
                  if (!el) return;
                  const colWidth = el.scrollWidth / columns.length;
                  el.scrollTo({ left: colWidth * i, behavior: 'smooth' });
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ====== ITEM DETAIL MODAL ====== */}
      {expandedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setExpandedItem(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div className="bg-gradient-to-r from-seaop-primary-600 to-seaop-primary-700 px-6 py-4">
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-semibold text-white pr-4">
                  {String(expandedItem.nom || expandedItem.titre || expandedItem.nomProjet || 'Detail')}
                </h3>
                <button onClick={() => setExpandedItem(null)} className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors">
                  <X size={18} />
                </button>
              </div>
              {!!expandedItem.numero && (
                <p className="text-sm text-white/70 font-mono mt-1">{String(expandedItem.numero)}</p>
              )}
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 space-y-4">
              {!!expandedItem.statut && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Statut</span>
                  <Badge color={doneStatuses.includes(String(expandedItem.statut)) ? 'green' : inProgressStatuses.includes(String(expandedItem.statut)) ? 'blue' : 'gray'} size="sm">
                    {String(expandedItem.statut)}
                  </Badge>
                </div>
              )}
              {!!expandedItem.priorite && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Priorité</span>
                  <Badge color={expandedItem.priorite === 'URGENT' || expandedItem.priorite === 'Urgente' || expandedItem.priorite === 'HAUTE' ? 'red' : 'gray'} size="sm">
                    {String(expandedItem.priorite)}
                  </Badge>
                </div>
              )}
              {!!(expandedItem.budget || expandedItem.budgetTotal || expandedItem.montantTotal || expandedItem.investissementTotal) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Montant</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(Number(expandedItem.budget || expandedItem.budgetTotal || expandedItem.montantTotal || expandedItem.investissementTotal))}
                  </span>
                </div>
              )}
              {getStartDate(expandedItem) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Date debut</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{formatDate(getStartDate(expandedItem) || null)}</span>
                </div>
              )}
              {getDueDate(expandedItem) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Échéance</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{formatDate(getDueDate(expandedItem) || null)}</span>
                    {getDeadlineBadge(getDueDate(expandedItem)) && (
                      <Badge color={getDeadlineBadge(getDueDate(expandedItem))!.color} size="sm">
                        {getDeadlineBadge(getDueDate(expandedItem))!.label}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
              {!!expandedItem.fournisseur && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Fournisseur</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{String(expandedItem.fournisseur)}</span>
                </div>
              )}

              {/* Assignees section */}
              <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Equipe assignee</span>
                  <button
                    onClick={() => { setAssignTarget({ id: expandedItem.id as string | number, type: view }); }}
                    className="text-xs text-seaop-primary-600 hover:text-seaop-primary-700 font-medium flex items-center gap-1"
                  >
                    <UserPlus size={12} /> Ajouter
                  </button>
                </div>
                {((expandedItem.assignees as KanbanAssignee[] | undefined) || []).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {((expandedItem.assignees as KanbanAssignee[] | undefined) || []).map((assignee, ai) => (
                      <div key={assignee.employeeId || ai} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-2.5 py-1.5">
                        <div className={`w-6 h-6 rounded-full ${getAvatarColor(assignee.employeeId)} flex items-center justify-center text-[9px] font-bold text-white`}>
                          {getInitials(assignee.nom)}
                        </div>
                        <span className="text-xs text-gray-700 dark:text-gray-300">{assignee.nom}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">Aucun employe assigne</p>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setExpandedItem(null)}>Fermer</Button>
            </div>
          </div>
        </div>
      )}

      {/* ====== ASSIGN EMPLOYEE MODAL ====== */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setAssignTarget(null); setAssignSearch(''); }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <UserPlus size={18} className="text-seaop-primary-600" />
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Assigner un employe</h3>
              </div>
              <button onClick={() => { setAssignTarget(null); setAssignSearch(''); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                <X size={16} />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <input
                type="text"
                placeholder="Rechercher un employé..."
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {/* Employee list */}
            <div className="max-h-64 overflow-y-auto">
              {employees
                .filter(e => {
                  if (!assignSearch) return true;
                  const search = assignSearch.toLowerCase();
                  return `${e.prenom} ${e.nom}`.toLowerCase().includes(search);
                })
                .map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => handleAssign(emp.id)}
                    disabled={assignLoading}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left disabled:opacity-50"
                  >
                    <div className={`w-9 h-9 rounded-full ${getAvatarColor(emp.id)} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
                      {getInitials(`${emp.prenom} ${emp.nom}`)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{emp.prenom} {emp.nom}</p>
                    </div>
                  </button>
                ))}
              {employees.length === 0 && (
                <div className="px-5 py-8 text-center">
                  <Spinner size="sm" />
                  <p className="text-xs text-gray-400 mt-2">Chargement...</p>
                </div>
              )}
              {employees.length > 0 && employees.filter(e => `${e.prenom} ${e.nom}`.toLowerCase().includes(assignSearch.toLowerCase())).length === 0 && (
                <p className="px-5 py-6 text-sm text-gray-400 text-center">Aucun employe trouve</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====== MOBILE STATUS CHANGE MODAL ====== */}
      {mobileStatusMenu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={() => setMobileStatusMenu(null)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl border-t border-gray-200 dark:border-gray-700 w-full max-w-lg animate-slide-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Deplacer vers</h3>
              <button onClick={() => setMobileStatusMenu(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-2 pb-8">
              {columns.filter(s => s !== mobileStatusMenu.fromStatus).map(targetStatus => (
                <button
                  key={targetStatus}
                  onClick={async () => {
                    // Reuse the same drop logic
                    const fakeEvent = { preventDefault: () => {} } as React.DragEvent;
                    dragItemRef.current = { id: mobileStatusMenu.id, type: mobileStatusMenu.type, fromStatus: mobileStatusMenu.fromStatus };
                    setMobileStatusMenu(null);
                    await handleDrop(fakeEvent, targetStatus);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 transition-colors"
                >
                  <span className={`w-3 h-3 rounded-full shrink-0 ${COLUMN_DOT_COLORS[targetStatus] || 'bg-gray-400'}`} />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{COLUMN_LABELS[targetStatus] || targetStatus}</span>
                  <ArrowRight size={14} className="ml-auto text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ====== TOAST NOTIFICATION ====== */}
      {toast && (
        <div className={`fixed ${isMobile ? 'bottom-4 left-4 right-4' : 'bottom-6 right-6'} z-50 flex items-center gap-3 bg-green-600 text-white px-5 py-3 rounded-xl shadow-2xl animate-slide-in-up`}>
          <CheckCircle2 size={20} />
          <span className="text-sm font-medium">{toast}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// GANTT TAB
// ============================================================

interface GanttTooltip {
  x: number;
  y: number;
  project: GanttProject;
  phase?: GanttPhase;
}

function GanttTab({ onError }: { onError: (msg: string) => void }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [projects, setProjects] = useState<GanttProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tooltip, setTooltip] = useState<GanttTooltip | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ganttSource, setGanttSource] = useState<GanttSource>('ventes');
  const [ganttZoom, setGanttZoom] = useState<GanttZoom>('mois');
  const [dependencies, setDependencies] = useState<any[]>([]);
  // showDeps controle a la fois le panneau du tableau ET les fleches SVG.
  // Default true pour preserver le comportement historique (les fleches
  // etaient toujours visibles ; seul le panneau changeait).
  const [showDeps, setShowDeps] = useState(true);
  const [ganttSearch, setGanttSearch] = useState('');
  const [ganttEmployees, setGanttEmployees] = useState<{ id: number; nom: string; prenom: string }[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; col: string } | null>(null);

  // Double-click on a bar navigates to the item's detail page
  function handleBarDoubleClick(project: GanttProject) {
    const routeMap: Record<GanttSource, string> = {
      ventes: '/ventes',
      devis: '/devis',
      projets: '/projets',
      bons_travail: '/bons-travail',
      bons_commande: '/magasin',
    };
    const route = routeMap[ganttSource] || '/';
    navigate(`${route}?open=${project.id}`);
  }

  // --- Drag & drop state ---
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize-left' | 'resize-right' | 'reorder';
    rowIndex: number;
    startX: number;
    startY: number;
    originalLeft: number;
    originalWidth: number;
    currentLeft: number;
    currentWidth: number;
    dropIndex?: number;
  } | null>(null);
  const dragMouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const dragHasMoved = useRef(false);

  // --- Column sort state ---
  type GanttSortCol = 'numero' | 'nom' | 'projet' | 'fournisseur' | 'montant' | 'priorite' | 'statut' | 'assignee' | 'debut' | 'duree' | 'fin' | 'progression' | null;
  type GanttSortDir = 'asc' | 'desc';
  const [ganttSortCol, setGanttSortCol] = useState<GanttSortCol>(null);
  const [ganttSortDir, setGanttSortDir] = useState<GanttSortDir>('asc');

  function toggleSort(col: NonNullable<GanttSortCol>) {
    if (ganttSortCol === col) {
      if (ganttSortDir === 'asc') setGanttSortDir('desc');
      else { setGanttSortCol(null); setGanttSortDir('asc'); }
    } else {
      setGanttSortCol(col);
      setGanttSortDir('asc');
    }
  }

  // --- Dependency linking state ---
  const [linkingState, setLinkingState] = useState<{
    sourceRowIndex: number;
    sourceProject: GanttProject;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [depPopup, setDepPopup] = useState<{ depId: number; x: number; y: number } | null>(null);

  // Generation counter pour eviter race conditions au switch rapide de
  // source. Si la generation change pendant qu'on attend une reponse,
  // on jette le resultat (la nouvelle generation a deja lance son fetch).
  const fetchGenRef = useRef(0);
  const fetchData = useCallback(async () => {
    const myGen = ++fetchGenRef.current;
    setIsLoading(true);
    try {
      let items: any[] = [];
      if (ganttSource === 'ventes') {
        const res = await crmApi.listOpportunities({ perPage: 100 }).catch(() => ({ items: [] }));
        if (fetchGenRef.current !== myGen) return;
        items = (res.items || []).map((o: any) => ({
          id: o.id, nom: o.nom, nomProjet: o.nom,
          dateDebut: o.dateDebutPrevu || o.createdAt,
          dateFin: o.dateCloturePrevue || o.dateFinPrevue,
          statut: o.statut, budget: o.montantEstime,
          montant: o.montantEstime,
          priorite: o.priorite,
          numero: o.numeroOpportunite,
        }));
      } else if (ganttSource === 'projets') {
        const res = await projectsApi.getGanttData();
        if (fetchGenRef.current !== myGen) return;
        items = res.items;
      } else if (ganttSource === 'bons_travail') {
        const res = await productionApi.getGanttBonsTravail().catch(() => ({ items: [] }));
        if (fetchGenRef.current !== myGen) return;
        items = res.items || res || [];
      } else if (ganttSource === 'devis') {
        const res = await productionApi.getGanttDevis().catch(() => ({ items: [] }));
        if (fetchGenRef.current !== myGen) return;
        items = res.items || res || [];
      } else {
        const res = await productionApi.getGanttBonsCommande().catch(() => ({ items: [] }));
        if (fetchGenRef.current !== myGen) return;
        items = res.items || res || [];
      }
      // Normalize: ensure each item has at least nomProjet, dateDebut, dateFin, statut, phases
      setProjects(items.map((it: any): GanttProject => {
        const phases = it.phases || [];
        let computedDebut = it.dateDebutReel || it.dateDebut || it.dateCreation || undefined;
        let computedFin = it.dateFinReel || it.dateFin || it.dateEcheance || it.dateValidite || undefined;
        // For BTs: auto-calculate parent dates from earliest/latest operation dates
        if (ganttSource === 'bons_travail' && phases.length > 0) {
          let minStart: Date | null = null;
          let maxEnd: Date | null = null;
          for (const ph of phases) {
            const s = parseDate(ph.dateDebut);
            const e = parseDate(ph.dateFin);
            if (s && (!minStart || s < minStart)) minStart = s;
            if (e && (!maxEnd || e > maxEnd)) maxEnd = e;
          }
          if (minStart) computedDebut = minStart.toISOString().slice(0, 10);
          if (maxEnd) computedFin = maxEnd.toISOString().slice(0, 10);
        }
        return {
          id: it.id,
          nomProjet: it.nomProjet || it.nom || it.numero || '',
          dateDebut: computedDebut,
          dateFin: computedFin,
          statut: it.statut || 'En attente',
          priorite: it.priorite || 'Moyenne',
          budget: it.budget || it.montantTotal || 0,
          gestionnaire: it.gestionnaire || '',
          numero: it.numero || it.numeroDocument || it.numeroProjet || undefined,
          // L'intercepteur axios convertit snake_case -> camelCase, donc le
          // backend qui retourne `nom_projet` devient `nomProjet` cote front.
          // Seul `projectNom` est un champ explicite du backend Gantt BT/BC.
          projectNom: it.projectNom || undefined,
          // Fournisseur : retourne par /gantt/bons-commande seulement.
          fournisseur: it.fournisseur || undefined,
          // Montant: budget pour BT/projets, montant pour BC/devis, montantEstime
          // pour ventes. On unifie via le champ unique `montant` au front.
          montant: typeof it.montant === 'number' ? it.montant
            : typeof it.budget === 'number' ? it.budget
            : typeof it.montantTotal === 'number' ? it.montantTotal
            : typeof it.budgetTotal === 'number' ? it.budgetTotal
            : undefined,
          phases,
        };
      }));
      // Fetch dependencies + employees
      const [depsRes, empRes] = await Promise.all([
        productionApi.getGanttDependencies().catch(() => ({ items: [] })),
        listEmployees({ perPage: 200 }).catch(() => ({ items: [] })),
      ]);
      if (fetchGenRef.current !== myGen) return;
      setDependencies(depsRes.items || depsRes || []);
      setGanttEmployees(empRes.items || []);
    } catch {
      if (fetchGenRef.current !== myGen) return;
      onError('Erreur lors du chargement du Gantt');
    } finally {
      if (fetchGenRef.current === myGen) setIsLoading(false);
    }
  }, [onError, ganttSource]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // --- Column panel resize ---
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!resizingRef.current) return;
      const delta = e.clientX - resizeStartX.current;
      const newW = Math.min(LABEL_WIDTH_MAX, Math.max(LABEL_WIDTH_MIN, resizeStartW.current + delta));
      setLabelWidthOverride(newW);
    }
    function onMouseUp() {
      if (resizingRef.current) {
        resizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, []);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizingRef.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = LABEL_WIDTH;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  const handleExportCsv = async () => {
    try {
      const response = await productionApi.exportGanttCsv();
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gantt-${ganttSource}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      onError('Erreur lors de l\'export CSV');
    }
  };

  // Calculate timeline boundaries
  const { timelineStart, totalDays, months } = useMemo(() => {
    const today = new Date();
    let earliest = new Date(today.getFullYear(), today.getMonth(), 1);
    let latest = addMonths(earliest, 3);

    for (const p of projects) {
      const ds = parseDate(p.dateDebut);
      const de = parseDate(p.dateFin);
      if (ds && ds < earliest) earliest = startOfMonth(ds);
      if (de && de > latest) latest = de;
      for (const ph of p.phases) {
        const pds = parseDate(ph.dateDebut);
        const pde = parseDate(ph.dateFin);
        if (pds && pds < earliest) earliest = startOfMonth(pds);
        if (pde && pde > latest) latest = pde;
      }
    }

    // Ensure at least 3 months visible
    const minEnd = addMonths(earliest, 3);
    if (latest < minEnd) latest = minEnd;
    // Extend to end of last month
    latest = new Date(latest.getFullYear(), latest.getMonth() + 1, 0);

    const totalDays = daysBetween(earliest, latest) + 1;

    // Build month labels
    const months: { label: string; startDay: number; days: number }[] = [];
    let cursor = new Date(earliest);
    while (cursor <= latest) {
      const mStart = daysBetween(earliest, cursor);
      const mEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const visibleEnd = mEnd > latest ? latest : mEnd;
      const visibleDays = daysBetween(cursor, visibleEnd) + 1;
      months.push({
        label: `${SHORT_MONTH_NAMES_FR[cursor.getMonth()]} ${cursor.getFullYear()}`,
        startDay: mStart,
        days: visibleDays,
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return { timelineStart: earliest, timelineEnd: latest, totalDays, months };
  }, [projects]);

  // Build flat rows: project row + phase sub-rows (filtered by search, sorted)
  const rows = useMemo(() => {
    const result: { type: 'project' | 'phase'; project: GanttProject; phase?: GanttPhase; label: string; indent: boolean }[] = [];
    const q = ganttSearch.toLowerCase().trim();

    // Filter projects first
    const filtered = projects.filter((p) => {
      const projectMatch = !q || p.nomProjet.toLowerCase().includes(q) || p.statut.toLowerCase().includes(q) || (p.gestionnaire || '').toLowerCase().includes(q);
      const phaseMatches = p.phases.some((ph) => !q || ph.nom.toLowerCase().includes(q) || (ph as any).assignee?.toLowerCase().includes(q));
      return projectMatch || phaseMatches;
    });

    // Sort projects if a sort column is active
    const sorted = ganttSortCol ? [...filtered].sort((a, b) => {
      let cmp = 0;
      const dateVal = (d?: string | null) => d ? new Date(d).getTime() : 0;
      const durVal = (p: GanttProject) => {
        const s = parseDate(p.dateDebut); const e = parseDate(p.dateFin);
        return s && e ? daysBetween(s, e) + 1 : 0;
      };
      switch (ganttSortCol) {
        case 'numero': cmp = (a.numero || '').localeCompare(b.numero || '', 'fr', { numeric: true }); break;
        case 'nom': cmp = a.nomProjet.localeCompare(b.nomProjet, 'fr'); break;
        case 'projet': cmp = (a.projectNom || '').localeCompare(b.projectNom || '', 'fr'); break;
        case 'fournisseur': cmp = (a.fournisseur || '').localeCompare(b.fournisseur || '', 'fr'); break;
        case 'montant': cmp = (a.montant ?? 0) - (b.montant ?? 0); break;
        case 'priorite': {
          // HAUT > MOYEN > BAS pour le tri (asc = du moins important au plus important).
          // Pour une UX coherente, les valeurs inconnues/vides sont TOUJOURS placees
          // a la fin (que ce soit en asc ou desc) — pattern standard MS Project /
          // Smartsheet. On compense l'inversion finale `-cmp` pour desc en
          // pre-inversant le signe quand un seul cote est inconnu.
          const order: Record<string, number> = { 'BAS': 0, 'BASSE': 0, 'MOYEN': 1, 'MOYENNE': 1, 'NORMAL': 1, 'NORMALE': 1, 'HAUT': 2, 'HAUTE': 2, 'URGENT': 3, 'URGENTE': 3 };
          // .trim() avant .toUpperCase() pour gerer les valeurs avec espaces
          // (ex: ' HAUT ' du saisie utilisateur ou import CSV).
          const ka = (a.priorite || '').trim().toUpperCase();
          const kb = (b.priorite || '').trim().toUpperCase();
          const knownA = ka in order;
          const knownB = kb in order;
          if (!knownA && !knownB) cmp = 0;
          else if (!knownA) cmp = ganttSortDir === 'desc' ? -1 : 1;
          else if (!knownB) cmp = ganttSortDir === 'desc' ? 1 : -1;
          else cmp = order[ka] - order[kb];
          break;
        }
        case 'statut': cmp = a.statut.localeCompare(b.statut, 'fr'); break;
        case 'assignee': cmp = (a.gestionnaire || '').localeCompare(b.gestionnaire || '', 'fr'); break;
        case 'debut': cmp = dateVal(a.dateDebut) - dateVal(b.dateDebut); break;
        case 'fin': cmp = dateVal(a.dateFin) - dateVal(b.dateFin); break;
        case 'duree': cmp = durVal(a) - durVal(b); break;
        case 'progression': cmp = (calcAutoProgress(a.dateDebut, a.dateFin) ?? 0) - (calcAutoProgress(b.dateDebut, b.dateFin) ?? 0); break;
        // default placee EN DERNIER pour respecter la convention switch.
        // En JS, l'ordre du default n'affecte pas le matching, mais cette
        // position est plus lisible et evite les confusions.
        default: cmp = 0; break;
      }
      return ganttSortDir === 'desc' ? -cmp : cmp;
    }) : filtered;

    for (const p of sorted) {
      const projectMatch = !q || p.nomProjet.toLowerCase().includes(q) || p.statut.toLowerCase().includes(q) || (p.gestionnaire || '').toLowerCase().includes(q);
      const phaseMatches = p.phases.filter((ph) => !q || ph.nom.toLowerCase().includes(q) || (ph as any).assignee?.toLowerCase().includes(q));
      result.push({ type: 'project', project: p, label: p.nomProjet, indent: false });
      const phasesToShow = projectMatch ? p.phases : phaseMatches;
      for (const ph of phasesToShow) {
        result.push({ type: 'phase', project: p, phase: ph, label: ph.nom, indent: true });
      }
    }
    return result;
  }, [projects, ganttSearch, ganttSortCol, ganttSortDir]);

  const todayOffset = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return daysBetween(timelineStart, today);
  }, [timelineStart]);

  const todayPercent = totalDays > 0 ? (todayOffset / totalDays) * 100 : 0;

  const ROW_HEIGHT = isMobile ? 44 : 36;

  // --- Individual column widths ---
  // Colonne `numero` affichee uniquement pour les sources qui en ont (ventes, BT, devis, BC).
  // Pour `projets` (pas de numero metier), la colonne est masquee.
  // Sur mobile (LABEL_WIDTH=120px), on masque aussi pour eviter l'overflow
  // — l'utilisateur peut toujours voir le numero en ouvrant la fiche detail.
  // Depuis l'ajout de numero_projet (PROJ-YYYY-NNNNN), toutes les sources
  // ont un numero metier. Masquee uniquement sur mobile (LABEL_WIDTH=120px).
  const showNumeroCol = !isMobile;
  // Colonne `projet` (nom du projet parent) pour les BT et BC qui referencent
  // un project. Les autres sources (ventes=opportunite, devis, projets) n'ont
  // pas de project parent distinct. Masquee sur mobile aussi.
  const showProjetCol = (ganttSource === 'bons_travail' || ganttSource === 'bons_commande') && !isMobile;
  // Colonne `fournisseur` : seulement pour les bons de commande (BC) qui ont
  // un fournisseur attribue. Les autres sources n'ont pas de fournisseur.
  const showFournisseurCol = ganttSource === 'bons_commande' && !isMobile;
  // Colonne `montant` : universelle (tous les items ont une valeur monetaire).
  // Affichee pour toutes les sources sauf en mobile (place limitee).
  const showMontantCol = !isMobile;
  // Colonne `priorite` : utile pour BT, projets, ventes (HAUT/MOYEN/BAS).
  // Devis et BC n'ont pas de priorite metier — masquee.
  const showPrioriteCol = (ganttSource === 'bons_travail' || ganttSource === 'projets' || ganttSource === 'ventes') && !isMobile;
  const COL_KEYS = ([
    ...(showNumeroCol ? ['numero'] : []),
    'nom',
    ...(showProjetCol ? ['projet'] : []),
    ...(showFournisseurCol ? ['fournisseur'] : []),
    ...(showMontantCol ? ['montant'] : []),
    ...(showPrioriteCol ? ['priorite'] : []),
    'statut', 'assignee', 'debut', 'duree', 'fin', 'progression',
  ]) as ReadonlyArray<string>;
  const COL_DEFAULTS: Record<string, number> = {
    numero: 90, nom: 200, projet: 140, fournisseur: 140, montant: 90, priorite: 70,
    statut: 80, assignee: 80, debut: 75, duree: 45, fin: 75, progression: 50,
  };
  const COL_MIN = 30;
  const [colWidths, setColWidths] = useState<Record<string, number>>(COL_DEFAULTS);
  const colResizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onColMouseMove(e: MouseEvent) {
      const r = colResizeRef.current;
      if (!r) return;
      const delta = e.clientX - r.startX;
      setColWidths(prev => ({ ...prev, [r.key]: Math.max(COL_MIN, r.startW + delta) }));
    }
    function onColMouseUp() {
      if (colResizeRef.current) {
        colResizeRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
    window.addEventListener('mousemove', onColMouseMove);
    window.addEventListener('mouseup', onColMouseUp);
    return () => { window.removeEventListener('mousemove', onColMouseMove); window.removeEventListener('mouseup', onColMouseUp); };
  }, []);

  function startColResize(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    e.preventDefault();
    colResizeRef.current = { key, startX: e.clientX, startW: colWidths[key] };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  // Depend aussi sur showNumeroCol car COL_KEYS est recree a chaque render
  // et change quand la colonne numero est ajoutee/retiree. Sans cette dep,
  // la largeur totale reste figee sur l'ancien COL_KEYS apres un switch
  // de source (ex: projets <-> BT) et le layout se desynchronise.
  // Le `?? 0` evite NaN si colWidths[k] est undefined pour une cle rajoutee
  // a COL_KEYS sans etre presente dans COL_DEFAULTS (futur proofing).
  const computedLabelWidth = useMemo(
    () => COL_KEYS.reduce((s, k) => s + (colWidths[k] ?? COL_DEFAULTS[k] ?? 0), 0),
    [colWidths, showNumeroCol, showProjetCol, showFournisseurCol, showMontantCol, showPrioriteCol],
  );

  // Reset le tri si la colonne actuellement triee est masquee (ex: user trie
  // par 'numero' en vue BT, puis switch vers 'projets' ou la colonne numero
  // n'existe pas). Sans ce reset, l'ArrowUp reste "accroche" a une colonne
  // invisible et la UX est confuse.
  useEffect(() => {
    const visible: Record<string, boolean> = {
      numero: showNumeroCol,
      projet: showProjetCol,
      fournisseur: showFournisseurCol,
      montant: showMontantCol,
      priorite: showPrioriteCol,
    };
    if (ganttSortCol && ganttSortCol in visible && !visible[ganttSortCol]) {
      setGanttSortCol(null);
      setGanttSortDir('asc');
    }
  }, [ganttSortCol, showNumeroCol, showProjetCol, showFournisseurCol, showMontantCol, showPrioriteCol]);

  const LABEL_WIDTH_MIN = 200;
  const LABEL_WIDTH_MAX = 1200;
  const resizingRef = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const [labelWidthOverride, setLabelWidthOverride] = useState<number | null>(null);
  const LABEL_WIDTH = isMobile ? 120 : (labelWidthOverride ?? computedLabelWidth);
  const DAY_WIDTH = ganttZoom === 'semaine' ? 55 : ganttZoom === '2semaines' ? 28 : 11;
  const MIN_TIMELINE_WIDTH = isMobile ? 400 : Math.max(800, totalDays * DAY_WIDTH);

  // Build individual days + header groups for 2-row header
  const { headerGroups, allDays } = useMemo(() => {
    const allDays: { dayOfMonth: number; dayOfWeek: number; isWeekend: boolean; month: number; year: number; weekNum: number }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(timelineStart);
      d.setDate(d.getDate() + i);
      allDays.push({
        dayOfMonth: d.getDate(),
        dayOfWeek: d.getDay(),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        month: d.getMonth(),
        year: d.getFullYear(),
        weekNum: getISOWeek(d),
      });
    }
    const groups: { label: string; startDay: number; days: number }[] = [];
    if (ganttZoom === 'mois') {
      for (const m of months) groups.push({ label: m.label, startDay: m.startDay, days: m.days });
    } else {
      // Group by week starting on Sunday (dayOfWeek === 0)
      let i = 0;
      while (i < allDays.length) {
        const startIdx = i;
        // Advance until next Sunday (or end of range)
        i++;
        while (i < allDays.length && allDays[i].dayOfWeek !== 0) i++;
        const firstDate = new Date(timelineStart);
        firstDate.setDate(firstDate.getDate() + startIdx);
        const lastDate = new Date(timelineStart);
        lastDate.setDate(lastDate.getDate() + i - 1);
        const wn = getISOWeek(firstDate);
        groups.push({
          label: `Sem ${wn}: ${firstDate.getDate()} ${SHORT_MONTH_NAMES_FR[firstDate.getMonth()]}-${lastDate.getDate()} ${SHORT_MONTH_NAMES_FR[lastDate.getMonth()]}`,
          startDay: startIdx,
          days: i - startIdx,
        });
      }
    }
    return { headerGroups: groups, allDays };
  }, [timelineStart, totalDays, months, ganttZoom]);

  function getBarStyle(dateDebut?: string | null, dateFin?: string | null): { left: string; width: string } | null {
    const start = parseDate(dateDebut);
    const end = parseDate(dateFin);
    if (!start || !end) return null;
    const startOffset = daysBetween(timelineStart, start);
    const duration = daysBetween(start, end) + 1;
    if (duration <= 0) return null;
    const leftPct = (startOffset / totalDays) * 100;
    const widthPct = (duration / totalDays) * 100;
    return { left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` };
  }

  function handleBarClick(e: React.MouseEvent, project: GanttProject, phase?: GanttPhase) {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      project,
      phase,
    });
  }

  // --- Drag & drop helpers ---

  /** Convert a percentage position on the timeline back to a YYYY-MM-DD string */
  function pctToDateStr(pct: number): string {
    const dayOffset = Math.round((pct / 100) * totalDays);
    const d = new Date(timelineStart);
    d.setDate(d.getDate() + dayOffset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /** Parse the existing bar style percentages back to numbers */
  function parsePctFromBarStyle(dateDebut?: string | null, dateFin?: string | null): { leftPct: number; widthPct: number } | null {
    const start = parseDate(dateDebut);
    const end = parseDate(dateFin);
    if (!start || !end) return null;
    const startOffset = daysBetween(timelineStart, start);
    const duration = daysBetween(start, end) + 1;
    if (duration <= 0) return null;
    return {
      leftPct: (startOffset / totalDays) * 100,
      widthPct: (duration / totalDays) * 100,
    };
  }

  /** Determine cursor type when hovering near bar edges */
  function getBarCursorZone(e: React.MouseEvent<HTMLDivElement>): 'left-edge' | 'right-edge' | 'center' {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x <= 8) return 'left-edge';
    if (x >= rect.width - 8) return 'right-edge';
    return 'center';
  }

  /** onMouseDown on a bar: start dragging (project or phase rows) */
  function handleBarMouseDown(e: React.MouseEvent<HTMLDivElement>, rowIndex: number, row: typeof rows[number]) {
    const dates = row.type === 'phase'
      ? { dateDebut: row.phase?.dateDebut, dateFin: row.phase?.dateFin }
      : { dateDebut: row.project.dateDebut, dateFin: row.project.dateFin };
    const barPcts = parsePctFromBarStyle(dates.dateDebut, dates.dateFin);
    if (!barPcts) return;

    const zone = getBarCursorZone(e);

    dragMouseDownPos.current = { x: e.clientX, y: e.clientY };
    dragHasMoved.current = false;

    const dragType: 'move' | 'resize-left' | 'resize-right' =
      zone === 'left-edge' ? 'resize-left' :
      zone === 'right-edge' ? 'resize-right' :
      'move';

    setDragState({
      type: dragType,
      rowIndex,
      startX: e.clientX,
      startY: e.clientY,
      originalLeft: barPcts.leftPct,
      originalWidth: barPcts.widthPct,
      currentLeft: barPcts.leftPct,
      currentWidth: barPcts.widthPct,
    });

    e.preventDefault(); // prevent text selection
  }

  /** onMouseDown on a grip handle: start reorder immediately (no bar needed) */
  function handleGripMouseDown(e: React.MouseEvent<HTMLDivElement>, rowIndex: number) {
    e.preventDefault();
    e.stopPropagation();
    dragMouseDownPos.current = { x: e.clientX, y: e.clientY };
    dragHasMoved.current = false;

    setDragState({
      type: 'reorder',
      rowIndex,
      startX: e.clientX,
      startY: e.clientY,
      originalLeft: 0,
      originalWidth: 0,
      currentLeft: 0,
      currentWidth: 0,
      dropIndex: rowIndex,
    });
  }

  /** Core drag position update — shared between React onMouseMove and window-level listener */
  function updateDragPosition(clientX: number, clientY: number) {
    if (!dragState) return;

    // Check if mouse has moved enough to count as a drag (not a click)
    if (!dragHasMoved.current) {
      const dx = Math.abs(clientX - (dragMouseDownPos.current?.x || 0));
      const dy = Math.abs(clientY - (dragMouseDownPos.current?.y || 0));
      if (dx <= 3 && dy <= 3) return;
      dragHasMoved.current = true;
    }

    // Get the timeline area width for pixel-to-percentage conversion
    const timelineArea = containerRef.current?.querySelector('.flex-1.relative') as HTMLElement | null;
    if (!timelineArea) return;
    const timelineWidth = timelineArea.getBoundingClientRect().width;
    if (timelineWidth <= 0) return;

    const deltaXPx = clientX - dragState.startX;
    const deltaYPx = clientY - dragState.startY;
    const deltaPct = (deltaXPx / timelineWidth) * 100;

    /** Calculate drop index from mouse Y position */
    function calcDropIndex(): number {
      const rowsAreaTop = timelineRef.current?.getBoundingClientRect().top || 0;
      const relY = clientY - rowsAreaTop;
      let dropIdx = Math.round(relY / ROW_HEIGHT);
      return Math.max(0, Math.min(rows.length, dropIdx));
    }

    if (dragState.type === 'move') {
      // Check for vertical drag to trigger reorder
      if (Math.abs(deltaYPx) > ROW_HEIGHT * 0.6 && Math.abs(deltaYPx) > Math.abs(deltaXPx)) {
        setDragState({
          ...dragState,
          type: 'reorder',
          currentLeft: dragState.originalLeft + deltaPct,
          currentWidth: dragState.originalWidth,
          dropIndex: calcDropIndex(),
        });
      } else {
        const newLeft = dragState.originalLeft + deltaPct;
        setDragState({
          ...dragState,
          currentLeft: newLeft,
          currentWidth: dragState.originalWidth,
        });
      }
    } else if (dragState.type === 'reorder') {
      // Continue updating reorder position
      setDragState({
        ...dragState,
        currentLeft: dragState.originalLeft + deltaPct,
        currentWidth: dragState.originalWidth,
        dropIndex: calcDropIndex(),
      });
    } else if (dragState.type === 'resize-left') {
      // Resize from left: move left edge, adjust width
      const newLeft = dragState.originalLeft + deltaPct;
      const newWidth = dragState.originalWidth - deltaPct;
      if (newWidth > 0.3) { // minimum bar width
        setDragState({
          ...dragState,
          currentLeft: newLeft,
          currentWidth: newWidth,
        });
      }
    } else if (dragState.type === 'resize-right') {
      // Resize from right: keep left, adjust width
      const newWidth = dragState.originalWidth + deltaPct;
      if (newWidth > 0.3) {
        setDragState({
          ...dragState,
          currentLeft: dragState.originalLeft,
          currentWidth: newWidth,
        });
      }
    }
  }

  /** Save an inline cell edit to the backend */
  // Helper: recalculate BT parent dates from min/max of its operations
  function recalcBtParentDates(p: GanttProject): GanttProject {
    if (ganttSource !== 'bons_travail' || p.phases.length === 0) return p;
    let minStart: Date | null = null;
    let maxEnd: Date | null = null;
    for (const ph of p.phases) {
      const s = parseDate(ph.dateDebut);
      const e = parseDate(ph.dateFin);
      if (s && (!minStart || s < minStart)) minStart = s;
      if (e && (!maxEnd || e > maxEnd)) maxEnd = e;
    }
    return {
      ...p,
      dateDebut: minStart ? minStart.toISOString().slice(0, 10) : p.dateDebut,
      dateFin: maxEnd ? maxEnd.toISOString().slice(0, 10) : p.dateFin,
    };
  }

  async function saveInlineEdit(row: typeof rows[number], col: string, value: string) {
    try {
      if (row.type === 'phase' && row.phase && ganttSource === 'bons_travail') {
        const body: Record<string, unknown> = {};
        if (col === 'statut') body.statut = value;
        else if (col === 'assignee') body.employeeId = value ? Number(value) : null;
        else if (col === 'dateDebut') body.dateDebut = value || null;
        else if (col === 'dateFin') body.dateFin = value || null;
        else if (col === 'progression') body.heuresReelles = parseFloat(value) || 0;
        await productionApi.updateOperation(row.project.id, row.phase.id, body as any);
      } else if (row.type === 'project') {
        if (ganttSource === 'bons_travail') {
          const body: Record<string, unknown> = {};
          if (col === 'statut') body.statut = value;
          else if (col === 'dateDebut') body.dateDebut = value || null;
          else if (col === 'dateFin') body.dateFin = value || null;
          await productionApi.updateWorkOrder(row.project.id, body as any);
        } else if (ganttSource === 'projets') {
          const body: Record<string, unknown> = {};
          if (col === 'statut') body.statut = value;
          else if (col === 'dateDebut') body.dateDebutReel = value || null;
          else if (col === 'dateFin') body.dateFinReel = value || null;
          else if (col === 'assignee') body.gestionnaire = value;
          await projectsApi.updateProject(String(row.project.id), body as any);
        } else if (ganttSource === 'devis') {
          const body: Record<string, unknown> = {};
          if (col === 'statut') body.statut = value;
          else if (col === 'dateDebut') body.datePrevu = value || null;
          else if (col === 'dateFin') body.dateFin = value || null;
          await devisApi.updateDevis(row.project.id, body as any);
        } else if (ganttSource === 'ventes') {
          const body: Record<string, unknown> = {};
          if (col === 'statut') body.statut = value;
          else if (col === 'dateFin') body.dateCloturePrevue = value || null;
          await crmApi.updateOpportunity(row.project.id, body as any);
        }
      }
      // Update local state
      setProjects((prev) => prev.map((p) => {
        if (row.type === 'project' && p.id === row.project.id) {
          if (col === 'statut') return { ...p, statut: value };
          if (col === 'dateDebut') return { ...p, dateDebut: value || undefined };
          if (col === 'dateFin') return { ...p, dateFin: value || undefined };
          if (col === 'assignee') return { ...p, gestionnaire: value };
        }
        if (row.type === 'phase' && row.phase && p.id === row.project.id) {
          const updated = { ...p, phases: p.phases.map((ph) => {
            if (ph.id !== row.phase!.id) return ph;
            if (col === 'statut') return { ...ph, statut: value };
            if (col === 'dateDebut') return { ...ph, dateDebut: value || undefined };
            if (col === 'dateFin') return { ...ph, dateFin: value || undefined };
            if (col === 'assignee') return { ...ph, assignee: value } as any;
            return ph;
          })};
          // Recalculate BT parent dates when operation date changes
          if ((col === 'dateDebut' || col === 'dateFin') && ganttSource === 'bons_travail') return recalcBtParentDates(updated);
          return updated;
        }
        return p;
      }));
    } catch (err: any) {
      // Extraire le detail du backend (ex: "Transition de statut interdite:
      // TERMINE -> EN_PAUSE. Transitions autorisees depuis TERMINE: (aucune).")
      // pour informer l'utilisateur de la raison reelle du refus.
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' && detail.trim()
        ? detail
        : 'Erreur lors de la sauvegarde';
      onError(msg);
    }
    setEditingCell(null);
  }

  /** Save the updated dates to the backend */
  /** Auto-schedule: cascade dependency dates (Finish-to-Start) */
  function propagateDependencyDates(changedId: string, newEndDate: string, depsOverride?: any[]) {
    const depsToUse = depsOverride || dependencies;
    const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Collect all updates before applying
    const projUpdates = new Map<string, { s: string; e: string }>();
    const phaseUpdates = new Map<string, { parentId: number; s: string; e: string }>();

    const visited = new Set<string>();
    function cascade(srcId: string, srcEnd: string) {
      if (visited.has(srcId)) return; // prevent circular dependency infinite loop
      visited.add(srcId);
      const endDate = parseDate(srcEnd);
      if (!endDate) return;
      const affected = depsToUse.filter((d) => String(d.sourceId) === srcId);
      for (const dep of affected) {
        const tgtId = String(dep.targetId);
        const lag = dep.lagDays || 0;
        const reqStart = new Date(endDate);
        reqStart.setDate(reqStart.getDate() + lag + 1);

        const isPhase = tgtId.startsWith('op-');
        let curStart: Date | null = null;
        let curEnd: Date | null = null;
        let parentId = 0;

        if (isPhase) {
          const phId = Number(tgtId.replace('op-', ''));
          for (const p of projects) {
            const ph = p.phases?.find((x: any) => x.id === phId);
            if (ph) {
              const ex = phaseUpdates.get(tgtId);
              curStart = parseDate(ex?.s || ph.dateDebut);
              curEnd = parseDate(ex?.e || ph.dateFin);
              parentId = p.id;
              break;
            }
          }
        } else {
          const tp = projects.find((p) => String(p.id) === tgtId);
          if (tp) {
            const ex = projUpdates.get(tgtId);
            curStart = parseDate(ex?.s || tp.dateDebut);
            curEnd = parseDate(ex?.e || tp.dateFin);
          }
        }

        if (!curStart || !curEnd || curStart >= reqStart) continue;
        const dur = daysBetween(curStart, curEnd);
        const newEnd = new Date(reqStart);
        newEnd.setDate(newEnd.getDate() + dur);
        const sStr = toIso(reqStart);
        const eStr = toIso(newEnd);

        if (isPhase) {
          phaseUpdates.set(tgtId, { parentId, s: sStr, e: eStr });
        } else {
          projUpdates.set(tgtId, { s: sStr, e: eStr });
        }
        cascade(tgtId, eStr);
      }
    }

    cascade(changedId, newEndDate);
    if (projUpdates.size === 0 && phaseUpdates.size === 0) return;

    // Apply all updates to local state in one pass
    setProjects((prev) =>
      prev.map((p) => {
        let u = p;
        const pu = projUpdates.get(String(p.id));
        if (pu) u = { ...u, dateDebut: pu.s, dateFin: pu.e };
        const hasPhase = [...phaseUpdates.values()].some((v) => v.parentId === p.id);
        if (hasPhase) {
          u = { ...u, phases: u.phases.map((ph: any) => {
            const phu = phaseUpdates.get(`op-${ph.id}`);
            return phu ? { ...ph, dateDebut: phu.s, dateFin: phu.e } : ph;
          }) };
          if (ganttSource === 'bons_travail') u = recalcBtParentDates(u);
        }
        return u;
      })
    );

    // Persist to backend
    for (const [id, d] of projUpdates) saveDragResult(id, d.s, d.e);
    for (const [tgtId, d] of phaseUpdates) {
      if (ganttSource === 'bons_travail') {
        const phId = Number(tgtId.replace('op-', ''));
        productionApi.updateOperation(d.parentId, phId, { dateDebut: d.s, dateFin: d.e }).catch(() => {});
      }
    }
  }

  async function saveDragResult(projectId: string, newStartStr: string, newEndStr: string) {
    try {
      if (ganttSource === 'devis') {
        await devisApi.updateDevis(Number(projectId), { datePrevu: newStartStr, dateFin: newEndStr });
      } else if (ganttSource === 'projets') {
        await projectsApi.updateProject(projectId, { dateDebutReel: newStartStr, dateFinReel: newEndStr });
      } else if (ganttSource === 'bons_travail') {
        await productionApi.updateWorkOrder(Number(projectId), { dateDebut: newStartStr, dateFin: newEndStr });
      } else if (ganttSource === 'bons_commande') {
        await suppliersApi.updatePurchaseOrderDates(Number(projectId), { dateCommande: newStartStr, dateLivraisonPrevue: newEndStr });
      } else if (ganttSource === 'ventes') {
        await crmApi.updateOpportunity(Number(projectId), { dateDebutPrevu: newStartStr, dateCloturePrevue: newEndStr } as any);
      }
    } catch {
      onError('Erreur lors de la sauvegarde des dates du Gantt');
    }
  }

  // --- Dependency linking helpers ---

  /** Check if click is on the right edge of a bar (last 12px) */
  function isRightEdgeClick(e: React.MouseEvent<HTMLDivElement>): boolean {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientX >= rect.right - 12;
  }

  /** Start linking from the right edge of a project bar */
  function handleLinkStart(e: React.MouseEvent, rowIndex: number, project: GanttProject) {
    e.stopPropagation();
    e.preventDefault();
    const tlEl = timelineRef.current;
    if (!tlEl) return;
    const tlRect = tlEl.getBoundingClientRect();
    setLinkingState({
      sourceRowIndex: rowIndex,
      sourceProject: project,
      mouseX: e.clientX - tlRect.left,
      mouseY: e.clientY - tlRect.top,
    });
    setTooltip(null);
  }

  /** Update the temporary linking line as the mouse moves */
  function handleLinkMouseMove(e: React.MouseEvent) {
    if (!linkingState) return;
    const tlEl = timelineRef.current;
    if (!tlEl) return;
    const tlRect = tlEl.getBoundingClientRect();
    setLinkingState({
      ...linkingState,
      mouseX: e.clientX - tlRect.left,
      mouseY: e.clientY - tlRect.top,
    });
  }

  /** Map ganttSource (UI) -> backend Gantt type
   *  ('project'|'bt'|'devis'|'bc'|'op'|'opp'). */
  function ganttSourceToBackendType(src: GanttSource, isPhase: boolean): string {
    if (isPhase) return 'op';
    switch (src) {
      case 'projets': return 'project';
      case 'bons_travail': return 'bt';
      case 'devis': return 'devis';
      case 'bons_commande': return 'bc';
      // CRM opportunities (vue 'ventes') -> table opportunities, type 'opp'.
      // Fix: avant ce commit on mappait vers 'project' ce qui faisait
      // echouer _gantt_entity_exists (id opportunite cherche dans projects).
      case 'ventes': return 'opp';
      default: return 'project';
    }
  }

  /** Sanitize ID a envoyer au backend : strip prefix 'op-' (le type='op'
   *  porte deja l'info, l'ID doit etre numerique pur). */
  function sanitizeGanttId(rawId: string | number): string {
    const s = String(rawId);
    return s.startsWith('op-') ? s.substring(3) : s;
  }

  /** Resoud une dep (type, id) en libelle humain depuis projects[] courant.
   *  Le backend list_dependencies ne renvoie pas de nom - on resout localement
   *  depuis les items de la vue active. Si le type ne correspond pas au
   *  ganttSource, on renvoie un libelle generique avec l'ID.
   *  - Pour type='op' : on cherche dans projects[].phases[] (les operations
   *    sont des phases d'un BT). sanitizeGanttId strip 'op-' avant POST,
   *    donc backend stocke des ids numeriques purs. */
  function resolveDepLabel(type: string | undefined, id: string | number | undefined): string {
    if (!type || id === undefined || id === null) return String(id ?? '?');
    const idStr = String(id);
    if (type === 'op') {
      for (const p of projects) {
        const ph = p.phases?.find((x: any) => String(x.id) === idStr);
        if (ph) {
          const phLabel = (ph as any).nom || (ph as any).description || (ph as any).numero;
          if (phLabel && String(phLabel).trim()) return String(phLabel);
          return `Op #${idStr}`;
        }
      }
    } else {
      const currentType = ganttSourceToBackendType(ganttSource, false);
      if (type === currentType) {
        const match = projects.find((p) => String(p.id) === idStr);
        if (match) {
          const label = match.nomProjet || match.numero || match.projectNom;
          if (label && String(label).trim()) return String(label);
        }
      }
    }
    const typeLabels: Record<string, string> = {
      project: 'Projet', bt: 'BT', devis: 'Devis',
      bc: 'BC', op: 'Op', opp: 'Opportunite',
    };
    return `${typeLabels[type] || type} #${idStr}`;
  }

  /** Detection client de cycle avant POST. Si target peut atteindre source
   *  via les dependances existantes, l'ajout creerait une boucle. */
  function wouldCreateCycle(
    sourceType: string, sourceId: string,
    targetType: string, targetId: string,
    existingDeps: any[],
  ): boolean {
    if (sourceType === targetType && sourceId === targetId) return true;
    const visited = new Set<string>([`${targetType}:${targetId}`]);
    const queue: Array<{ t: string; id: string }> = [{ t: targetType, id: targetId }];
    let safety = 0;
    while (queue.length > 0 && safety++ < 1000) {
      const cur = queue.shift()!;
      for (const d of existingDeps) {
        if (d.sourceType === cur.t && String(d.sourceId) === cur.id) {
          if (d.targetType === sourceType && String(d.targetId) === sourceId) return true;
          const key = `${d.targetType}:${d.targetId}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push({ t: d.targetType, id: String(d.targetId) });
          }
        }
      }
    }
    return false;
  }

  /** Complete the link on the left edge of a target bar (project or phase) */
  async function handleLinkEnd(e: React.MouseEvent, targetRow: typeof rows[number]) {
    e.stopPropagation();
    e.preventDefault();
    if (!linkingState) return;
    const sourceRow = rows[linkingState.sourceRowIndex];
    const sourceIsPhase = sourceRow?.type === 'phase' && !!sourceRow.phase;
    const targetIsPhase = targetRow.type === 'phase' && !!targetRow.phase;
    const sourceType = ganttSourceToBackendType(ganttSource, sourceIsPhase);
    const targetType = ganttSourceToBackendType(ganttSource, targetIsPhase);
    const sourceId = sanitizeGanttId(
      sourceIsPhase && sourceRow?.phase ? sourceRow.phase.id : linkingState.sourceProject.id,
    );
    const targetId = sanitizeGanttId(
      targetIsPhase && targetRow.phase ? targetRow.phase.id : targetRow.project.id,
    );
    if (sourceType === targetType && sourceId === targetId) {
      setLinkingState(null);
      return;
    }
    // Cycle detection cote client (defense en profondeur ; backend revalide)
    if (wouldCreateCycle(sourceType, sourceId, targetType, targetId, dependencies)) {
      onError('Cette dependance creerait un cycle (boucle de dependances).');
      setLinkingState(null);
      return;
    }
    try {
      await productionApi.createGanttDependency({
        sourceType,
        sourceId,
        targetType,
        targetId,
        dependencyType: 'finish_to_start',
        lagDays: 0,
      });
      const depsRes = await productionApi.getGanttDependencies().catch(() => ({ items: [] }));
      const newDeps = depsRes.items || depsRes || [];
      setDependencies(newDeps);
      // Auto-schedule: shift target if source ends after target starts
      const srcDates = sourceIsPhase && sourceRow?.phase
        ? sourceRow.phase : sourceRow?.project;
      if (srcDates?.dateFin) {
        // propagateDependencyDates s'attend a un sourceId potentiellement
        // prefixe 'op-' pour distinguer phase/projet dans rows. On utilise
        // l'ID UI original ici (avant sanitize) pour preserver la logique.
        const uiSourceId = sourceIsPhase && sourceRow?.phase
          ? `op-${sourceRow.phase.id}` : String(linkingState.sourceProject.id);
        propagateDependencyDates(uiSourceId, srcDates.dateFin, newDeps);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Erreur lors de la creation de la dependance';
      onError(typeof msg === 'string' ? msg : 'Erreur lors de la creation de la dependance');
    }
    setLinkingState(null);
  }

  /** Delete a dependency */
  async function handleDeleteDependency(depId: number) {
    try {
      await productionApi.deleteGanttDependency(depId);
      const depsRes = await productionApi.getGanttDependencies().catch(() => ({ items: [] }));
      setDependencies(depsRes.items || depsRes || []);
    } catch {
      onError('Erreur lors de la suppression de la dependance');
    }
    setDepPopup(null);
  }

  // Escape key to cancel linking mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setLinkingState(null);
        setDepPopup(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Window-level mouseup listener to finalize drag
  useEffect(() => {
    if (!dragState) return;

    function handleWindowMouseUp() {
      if (!dragState) return;

      // If mouse barely moved, treat as a click (tooltip will open via handleBarClick)
      if (!dragHasMoved.current) {
        setDragState(null);
        dragMouseDownPos.current = null;
        return;
      }

      if (dragState.type === 'reorder' && dragState.dropIndex !== undefined) {
        // Clear column sort so manual reorder sticks
        setGanttSortCol(null);
        const fromRow = rows[dragState.rowIndex];
        if (fromRow?.type === 'phase' && fromRow.phase) {
          // Reorder operation within its parent BT
          const parentId = fromRow.project.id;
          const fromPhaseId = fromRow.phase.id;
          // Find which phase rows belong to this parent and determine target index
          const siblingPhaseRows = rows
            .map((r, idx) => ({ r, idx }))
            .filter((x) => x.r.type === 'phase' && x.r.project.id === parentId);
          const fromIdx = siblingPhaseRows.findIndex((x) => x.r.phase?.id === fromPhaseId);
          // Calculate target position from dropIndex
          let toIdx = 0;
          for (let si = 0; si < siblingPhaseRows.length; si++) {
            if (siblingPhaseRows[si].idx >= dragState.dropIndex) { toIdx = si; break; }
            toIdx = si + 1;
          }
          if (fromIdx >= 0 && toIdx !== fromIdx) {
            setProjects((prev) => prev.map((p) => {
              if (p.id !== parentId) return p;
              const newPhases = [...p.phases];
              const [moved] = newPhases.splice(fromIdx, 1);
              const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
              newPhases.splice(Math.max(0, insertAt), 0, moved);
              return { ...p, phases: newPhases };
            }));
          }
        } else if (fromRow?.type === 'project') {
          // Reorder project in the array
          const fromProjectIndex = projects.findIndex((p) => p.id === fromRow.project.id);
          if (fromProjectIndex >= 0) {
            let targetProjectIndex = 0;
            let rowCount = 0;
            for (let pi = 0; pi < projects.length; pi++) {
              if (rowCount >= dragState.dropIndex) {
                targetProjectIndex = pi;
                break;
              }
              rowCount++;
              rowCount += projects[pi].phases.length;
              if (rowCount >= dragState.dropIndex) {
                targetProjectIndex = pi + 1;
                break;
              }
              targetProjectIndex = pi + 1;
            }
            targetProjectIndex = Math.min(targetProjectIndex, projects.length);

            const newProjects = [...projects];
            const [moved] = newProjects.splice(fromProjectIndex, 1);
            const insertAt = targetProjectIndex > fromProjectIndex ? targetProjectIndex - 1 : targetProjectIndex;
            newProjects.splice(Math.max(0, insertAt), 0, moved);
            setProjects(newProjects);
          }
        }
      } else if (dragState.type === 'move' || dragState.type === 'resize-left' || dragState.type === 'resize-right') {
        // Calculate new dates from the current percentages
        const newStartStr = pctToDateStr(dragState.currentLeft);
        const newEndPct = dragState.currentLeft + dragState.currentWidth;
        // End date: the last day included in the bar
        const endDayOffset = Math.round((newEndPct / 100) * totalDays) - 1;
        const endDate = new Date(timelineStart);
        endDate.setDate(endDate.getDate() + Math.max(endDayOffset, Math.round((dragState.currentLeft / 100) * totalDays)));
        const newEndStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

        // Update local state + persist
        const draggedRow = rows[dragState.rowIndex];
        if (draggedRow?.type === 'project') {
          setProjects((prev) =>
            prev.map((p) =>
              p.id === draggedRow.project.id
                ? { ...p, dateDebut: newStartStr, dateFin: newEndStr }
                : p
            )
          );
          saveDragResult(String(draggedRow.project.id), newStartStr, newEndStr);
          // Auto-schedule: cascade to dependent tasks
          propagateDependencyDates(String(draggedRow.project.id), newEndStr);
        } else if (draggedRow?.type === 'phase' && draggedRow.phase) {
          // Update phase (operation) dates locally + recalculate parent BT dates
          const phaseId = `op-${draggedRow.phase.id}`;
          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== draggedRow.project.id) return p;
              const updated = { ...p, phases: p.phases.map((ph) => ph.id === draggedRow.phase!.id ? { ...ph, dateDebut: newStartStr, dateFin: newEndStr } : ph) };
              return recalcBtParentDates(updated);
            })
          );
          // Persist operation dates via API (only for bons_travail source)
          if (ganttSource === 'bons_travail') {
            productionApi.updateOperation(draggedRow.project.id, draggedRow.phase.id, { dateDebut: newStartStr, dateFin: newEndStr }).catch(() =>
              onError('Erreur lors de la sauvegarde des dates de l\'operation')
            );
          }
          // Auto-schedule: cascade to dependent tasks
          propagateDependencyDates(phaseId, newEndStr);
        }
      }

      setDragState(null);
      dragMouseDownPos.current = null;
      dragHasMoved.current = false;
    }

    function handleWindowMouseMove(e: MouseEvent) {
      updateDragPosition(e.clientX, e.clientY);
    }

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => { window.removeEventListener('mousemove', handleWindowMouseMove); window.removeEventListener('mouseup', handleWindowMouseUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState, rows, projects, totalDays, timelineStart, ganttSource]);

  if (isLoading) return <SkeletonPage />;

  if (projects.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <BarChart3 size={48} className="mx-auto mb-3 opacity-50" />
        <p className="text-lg font-medium">Aucun projet à afficher</p>
        <p className="text-sm mt-1">Créez des projets avec des dates pour voir le diagramme de Gantt</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div className={`flex shrink-0 ${isMobile ? 'flex-col gap-3' : 'items-center justify-between flex-wrap gap-2'}`}>
        <div className={`flex items-center gap-3 ${isMobile ? 'overflow-x-auto' : ''}`}>
          {/* Data source selector — pill buttons */}
          <div className="flex items-center gap-1">
            {([['ventes', 'Ventes'], ['devis', 'Soumissions'], ['projets', 'Projets'], ['bons_commande', 'Achats'], ['bons_travail', 'BT']] as [GanttSource, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setGanttSource(key)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  ganttSource === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {!isMobile && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="inline-block w-3 h-3 rounded bg-[#F6C87A]" /> En attente
              <span className="inline-block w-3 h-3 rounded bg-[#7BAFD4] ml-2" /> En cours
              <span className="inline-block w-3 h-3 rounded bg-[#7DC4A5] ml-2" /> Termine
              <span className="inline-block w-3 h-3 rounded bg-[#E8919A] ml-2" /> Annule
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isMobile && (
            <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden text-xs">
              {(['semaine', '2semaines', 'mois'] as GanttZoom[]).map((z) => (
                <button key={z} onClick={() => setGanttZoom(z)}
                  className={`px-2.5 py-1.5 ${ganttZoom === z ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >{z === 'semaine' ? 'Semaine' : z === '2semaines' ? '2 Sem' : 'Mois'}</button>
              ))}
            </div>
          )}
          {!isMobile && (
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={ganttSearch}
                onChange={(e) => setGanttSearch(e.target.value)}
                className="text-xs border border-gray-300 dark:border-gray-600 rounded-md pl-7 pr-6 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 w-36"
              />
              {ganttSearch && (
                <button onClick={() => setGanttSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          {!isMobile && (
            <Button size="sm" variant="ghost" onClick={() => setShowDeps(!showDeps)}>
              {showDeps ? 'Masquer deps' : 'Dependances'}
            </Button>
          )}
          <Button size="sm" variant="ghost" leftIcon={<Download size={14} />} onClick={handleExportCsv}>{isMobile ? 'CSV' : 'Exporter CSV'}</Button>
          {!isMobile && (
            <Button size="sm" variant="ghost" leftIcon={<Printer size={14} />} onClick={() => window.print()}>Imprimer</Button>
          )}
          <Button size="sm" variant="ghost" leftIcon={<RefreshCw size={14} />} onClick={fetchData}>{isMobile ? '' : 'Rafraîchir'}</Button>
        </div>
      </div>

      {/* Dependencies panel */}
      {showDeps && dependencies.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Dependances ({dependencies.length})</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Source</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Cible</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {dependencies.map((dep: any, idx: number) => (
                  <tr key={dep.id || idx}>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{resolveDepLabel(dep.sourceType, dep.sourceId)}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{resolveDepLabel(dep.targetType, dep.targetId)}</td>
                    <td className="px-3 py-2 text-gray-500">{dep.dependencyType || dep.type || 'finish_to_start'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {showDeps && dependencies.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center text-sm text-gray-400">
          Aucune dependance configuree
        </div>
      )}

      {/* ====== GANTT CHART (desktop + mobile with horizontal scroll) ====== */}
      {(
      <div
        ref={containerRef}
        className={`relative border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 overflow-auto flex-1 min-h-0 ${dragState ? 'select-none' : ''}`}
        style={{ WebkitOverflowScrolling: 'touch', cursor: linkingState ? 'crosshair' : dragState ? (dragState.type === 'resize-left' || dragState.type === 'resize-right' ? 'col-resize' : dragState.type === 'reorder' ? 'move' : 'grabbing') : undefined }}
        onClick={() => { if (!dragHasMoved.current) { setTooltip(null); if (linkingState) setLinkingState(null); } }}
        onMouseMove={(e) => { updateDragPosition(e.clientX, e.clientY); handleLinkMouseMove(e); }}
      >
        <div className="flex" style={{ minWidth: LABEL_WIDTH + MIN_TIMELINE_WIDTH }}>
          {/* Left columns panel (MS Project style) */}
          <div className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700" style={{ width: LABEL_WIDTH, position: 'sticky', left: 0, zIndex: 10, overflow: 'hidden', backgroundColor: '#f9fafb' }}>
           <div style={{ width: computedLabelWidth, minWidth: computedLabelWidth }}>
            {/* Column headers — clickable for sorting, draggable edges for resizing */}
            <div style={{ height: 44 }} className="border-b border-gray-200 dark:border-gray-700 flex items-end text-[10px] font-semibold text-gray-500 uppercase tracking-wide select-none">
              {/* Spacer 18px pour s'aligner avec le grip-handle (GripVertical) des rows */}
              <div style={{ width: 18, flexShrink: 0 }} />
              {([
                ...(showNumeroCol ? [{ key: 'numero' as const, label: 'Numéro', align: 'left' as const }] : []),
                { key: 'nom' as const, label: 'Nom', align: 'left' as const },
                ...(showProjetCol ? [{ key: 'projet' as const, label: 'Projet', align: 'left' as const }] : []),
                ...(showFournisseurCol ? [{ key: 'fournisseur' as const, label: 'Fournisseur', align: 'left' as const }] : []),
                ...(showMontantCol ? [{ key: 'montant' as const, label: 'Montant', align: 'right' as const }] : []),
                ...(showPrioriteCol ? [{ key: 'priorite' as const, label: 'Priorité', align: 'center' as const }] : []),
                { key: 'statut' as const, label: 'Statut', align: 'center' as const },
                { key: 'assignee' as const, label: 'Assigné', align: 'center' as const },
                { key: 'debut' as const, label: 'Début', align: 'center' as const },
                { key: 'duree' as const, label: 'Durée', align: 'center' as const },
                { key: 'fin' as const, label: 'Fin', align: 'center' as const },
                { key: 'progression' as const, label: '%', align: 'center' as const },
              ]).map(({ key, label, align }) => (
                <div
                  key={key}
                  className="relative"
                  style={{
                    // La cellule `nom` des rows utilise colWidths.nom - 18 (les
                    // 18px sont pris par le grip-handle rendu en tete de row).
                    // On applique la meme reduction ici pour aligner le header
                    // avec les rows. Le spacer 18px avant ces colonnes absorbe
                    // la difference et maintient computedLabelWidth = sum(colWidths).
                    width: key === 'nom' ? colWidths[key] - 18 : colWidths[key],
                    minWidth: COL_MIN,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Trier par ${label}${ganttSortCol === key ? (ganttSortDir === 'asc' ? ' (croissant)' : ' (decroissant)') : ''}`}
                    aria-sort={ganttSortCol === key ? (ganttSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`h-full px-${align === 'left' ? '2' : '1'} pb-1.5 ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''} cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex items-center ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''} gap-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-inset`}
                    onClick={() => toggleSort(key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleSort(key);
                      }
                    }}
                  >
                    <span className="truncate">{label}</span>
                    {ganttSortCol === key && (
                      ganttSortDir === 'asc'
                        ? <ArrowUp size={10} className="shrink-0 text-blue-500" aria-hidden="true" />
                        : <ArrowDown size={10} className="shrink-0 text-blue-500" aria-hidden="true" />
                    )}
                  </div>
                  {/* Resize handle on right edge */}
                  <div
                    className="absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize hover:bg-blue-300 z-10"
                    onMouseDown={(e) => startColResize(e, key)}
                  />
                </div>
              ))}
            </div>
            {/* Data rows */}
            {rows.map((row, i) => {
              const showLabelDropIndicator = dragState?.type === 'reorder' && dragState.dropIndex === i;
              const rd = row.type === 'phase' && row.phase
                ? { dateDebut: row.phase.dateDebut, dateFin: row.phase.dateFin, statut: row.phase.statut, prog: calcAutoProgress(row.phase.dateDebut, row.phase.dateFin), assignee: (row.phase as any).assignee || '' }
                : { dateDebut: row.project.dateDebut, dateFin: row.project.dateFin, statut: row.project.statut, prog: calcAutoProgress(row.project.dateDebut, row.project.dateFin), assignee: row.project.gestionnaire || '' };
              const startD = parseDate(rd.dateDebut);
              const endD = parseDate(rd.dateFin);
              const duree = startD && endD ? daysBetween(startD, endD) + 1 : null;
              const statusColor = STATUS_BAR_COLORS[rd.statut] || 'bg-gray-400';
              return (
                <div
                  key={`label-${i}`}
                  className={`relative flex items-center border-b border-gray-100 dark:border-gray-800 ${
                    row.type === 'project' ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
                  } ${dragState?.type === 'reorder' && dragState.rowIndex === i ? 'opacity-50' : ''}`}
                  style={{ height: ROW_HEIGHT }}
                >
                  {showLabelDropIndicator && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 z-20" style={{ marginTop: -1 }} />
                  )}
                  {/* Grip handle for reorder drag */}
                  <div
                    className="flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
                    style={{ width: 18 }}
                    onMouseDown={(e) => handleGripMouseDown(e, i)}
                  >
                    <GripVertical size={12} />
                  </div>
                  {/* Numéro — cliquable (ouvre la fiche detail de l'item) */}
                  {showNumeroCol && (
                    <div style={{ width: colWidths.numero, minWidth: COL_MIN }} className="px-1 text-[10px] font-mono truncate" title={row.project.numero || ''}>
                      {row.type === 'project' && row.project.numero ? (
                        <button
                          type="button"
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                          onClick={(e) => { e.stopPropagation(); handleBarDoubleClick(row.project); }}
                        >
                          {row.project.numero}
                        </button>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </div>
                  )}
                  {/* Nom */}
                  <div style={{ width: colWidths.nom - 18, minWidth: COL_MIN }} className="px-1 text-xs truncate" title={row.label}>
                    {row.indent && <span className="text-gray-300 dark:text-gray-600 mr-1">-</span>}
                    {row.label}
                  </div>
                  {/* Projet — nom du projet parent (BT/BC seulement).
                      On affiche uniquement pour les rows de type 'project' :
                      les phases (operations sous-lignes) heritent du meme
                      projectNom que leur parent, donc afficher la valeur
                      3 fois sous un BT = redondance visuelle bruyante.
                      Pour les phases, on affiche "--" comme pour Numero
                      (coherence visuelle entre les deux colonnes meta). */}
                  {showProjetCol && (
                    <div style={{ width: colWidths.projet, minWidth: COL_MIN }} className="px-1 text-[10px] text-gray-500 dark:text-gray-400 truncate" title={row.type === 'project' ? (row.project.projectNom || '') : ''}>
                      {row.type === 'project' ? (
                        row.project.projectNom || <span className="text-gray-400">--</span>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </div>
                  )}
                  {/* Fournisseur — BC seulement, masque pour phases */}
                  {showFournisseurCol && (
                    <div style={{ width: colWidths.fournisseur, minWidth: COL_MIN }} className="px-1 text-[10px] text-gray-500 dark:text-gray-400 truncate" title={row.type === 'project' ? (row.project.fournisseur || '') : ''}>
                      {row.type === 'project' ? (
                        row.project.fournisseur || <span className="text-gray-400">--</span>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </div>
                  )}
                  {/* Montant — toutes les sources, formate en CAD */}
                  {showMontantCol && (
                    <div style={{ width: colWidths.montant, minWidth: COL_MIN }} className="px-1 text-[10px] text-gray-700 dark:text-gray-300 truncate text-right tabular-nums" title={row.type === 'project' && typeof row.project.montant === 'number' ? formatCurrency(row.project.montant) : ''}>
                      {row.type === 'project' && typeof row.project.montant === 'number' ? (
                        formatCurrency(row.project.montant)
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </div>
                  )}
                  {/* Priorite — badge couleur HAUT/MOYEN/BAS */}
                  {showPrioriteCol && (
                    <div style={{ width: colWidths.priorite, minWidth: COL_MIN }} className="px-0.5 text-center">
                      {row.type === 'project' && row.project.priorite ? (() => {
                        // Trim + uppercase pour matcher robustement les valeurs BD
                        // (qui peuvent contenir des espaces ou casse mixte).
                        const p = (row.project.priorite || '').trim().toUpperCase();
                        const colorMap: Record<string, string> = {
                          'HAUT': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                          'HAUTE': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                          'URGENT': 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200',
                          'URGENTE': 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200',
                          'MOYEN': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
                          'MOYENNE': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
                          'NORMAL': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
                          'NORMALE': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
                          'BAS': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
                          'BASSE': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
                        };
                        const cls = colorMap[p] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
                        return <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] ${cls} truncate max-w-[60px]`} title={p}>{p}</span>;
                      })() : (
                        <span className="text-gray-400 dark:text-gray-500 text-[10px]">--</span>
                      )}
                    </div>
                  )}
                  {/* Statut — editable dropdown.
                      Pour BT (bons_travail), on filtre les options selon les
                      transitions autorisees par le backend (BT_STATUS_TRANSITIONS
                      dans production.py). Sans cela, l'utilisateur voyait tous
                      les statuts mais le PUT renvoyait 400 "Transition interdite"
                      (ex: TERMINE -> EN_PAUSE) sans message clair. */}
                  <div style={{ width: colWidths.statut, minWidth: COL_MIN }} className="px-0.5" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowIndex: i, col: 'statut' }); }}>
                    {editingCell?.rowIndex === i && editingCell.col === 'statut' ? (
                      <select autoFocus className="w-full text-[9px] border border-blue-400 rounded px-0.5 py-0.5 bg-white dark:bg-gray-800"
                        defaultValue={
                          // Normaliser le statut courant pour qu'il matche
                          // les options canoniques (UPPER_FR) du dropdown BT.
                          // Sans cela, un BT en 'En cours' (Title-case legacy)
                          // ne matche pas l'option 'EN_COURS' -> select affiche
                          // la 1ere option par defaut, UX confuse.
                          ganttSource === 'bons_travail' && row.type === 'project'
                            ? _normalizeBtStatusFront(rd.statut)
                            : rd.statut
                        }
                        onChange={(e) => saveInlineEdit(row, 'statut', e.target.value)} onBlur={() => setEditingCell(null)}>
                        {(() => {
                          if (ganttSource === 'bons_travail' && row.type === 'phase') {
                            return ['En attente','En cours','Termine','Annule'];
                          }
                          if (ganttSource === 'bons_travail') {
                            return getAllowedBtTransitions(rd.statut);
                          }
                          if (ganttSource === 'devis') return ['Brouillon','Envoye','Accepte','Refuse'];
                          if (ganttSource === 'projets') return ['En attente','En cours','Termine','Annule'];
                          if (ganttSource === 'ventes') return ['PROSPECTION','QUALIFICATION','PROPOSITION','NEGOCIATION','GAGNE','PERDU'];
                          return ['Brouillon','Envoye','Confirme','Recu','Annule'];
                        })().map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] text-white ${statusColor} truncate max-w-[72px] cursor-pointer`}>
                        {rd.statut || '--'}
                      </span>
                    )}
                  </div>
                  {/* Assigne — editable dropdown */}
                  <div style={{ width: colWidths.assignee, minWidth: COL_MIN }} className="px-0.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowIndex: i, col: 'assignee' }); }}>
                    {editingCell?.rowIndex === i && editingCell.col === 'assignee' ? (
                      <select autoFocus className="w-full text-[9px] border border-blue-400 rounded px-0.5 py-0.5 bg-white dark:bg-gray-800"
                        defaultValue={rd.assignee} onChange={(e) => saveInlineEdit(row, 'assignee', e.target.value)} onBlur={() => setEditingCell(null)}>
                        <option value="">--</option>
                        {ganttEmployees.map((emp) => <option key={emp.id} value={row.type === 'phase' ? String(emp.id) : `${emp.prenom} ${emp.nom}`}>{emp.prenom} {emp.nom}</option>)}
                      </select>
                    ) : (
                      <span className="text-[10px] text-gray-500 truncate block text-center">{rd.assignee || '--'}</span>
                    )}
                  </div>
                  {/* Debut — editable date */}
                  <div style={{ width: colWidths.debut, minWidth: COL_MIN }} className="px-0.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowIndex: i, col: 'dateDebut' }); }}>
                    {editingCell?.rowIndex === i && editingCell.col === 'dateDebut' ? (
                      <input type="date" autoFocus className="w-full text-[9px] border border-blue-400 rounded px-0.5 py-0.5 bg-white dark:bg-gray-800"
                        defaultValue={rd.dateDebut || ''} onChange={(e) => saveInlineEdit(row, 'dateDebut', e.target.value)} onBlur={() => setEditingCell(null)} />
                    ) : (
                      <span className="text-[10px] text-gray-500 truncate block text-center">{rd.dateDebut ? formatShortDate(rd.dateDebut) : '--'}</span>
                    )}
                  </div>
                  {/* Duree — read-only (computed) */}
                  <div style={{ width: colWidths.duree, minWidth: COL_MIN }} className="px-1 text-[10px] text-center text-gray-500">
                    {duree !== null ? `${duree}j` : '--'}
                  </div>
                  {/* Fin — editable date */}
                  <div style={{ width: colWidths.fin, minWidth: COL_MIN }} className="px-0.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowIndex: i, col: 'dateFin' }); }}>
                    {editingCell?.rowIndex === i && editingCell.col === 'dateFin' ? (
                      <input type="date" autoFocus className="w-full text-[9px] border border-blue-400 rounded px-0.5 py-0.5 bg-white dark:bg-gray-800"
                        defaultValue={rd.dateFin || ''} onChange={(e) => saveInlineEdit(row, 'dateFin', e.target.value)} onBlur={() => setEditingCell(null)} />
                    ) : (
                      <span className="text-[10px] text-gray-500 truncate block text-center">{rd.dateFin ? formatShortDate(rd.dateFin) : '--'}</span>
                    )}
                  </div>
                  {/* Progression — auto-calculated from dates */}
                  <div style={{ width: colWidths.progression, minWidth: COL_MIN }} className="px-1 flex items-center gap-1">
                    {rd.prog !== null ? (
                      <div className="flex items-center gap-0.5 w-full">
                        <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${statusColor}`} style={{ width: `${rd.prog}%` }} />
                        </div>
                        <span className="text-[9px] text-gray-400 w-6 text-right">{rd.prog}%</span>
                      </div>
                    ) : (
                      <span className="text-[9px] text-gray-400 w-full text-center">--</span>
                    )}
                  </div>
                </div>
              );
            })}
           </div>{/* close inner fixed-width wrapper */}
          </div>

          {/* Resize handle between columns and timeline */}
          <div
            onMouseDown={startResize}
            className="flex-shrink-0 cursor-col-resize group hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
            style={{ width: 5, position: 'sticky', left: LABEL_WIDTH, zIndex: 11, backgroundColor: resizingRef.current ? '#93c5fd' : '#f0f0f0' }}
            title="Glisser pour redimensionner"
          >
            <div className="w-px h-full bg-gray-300 dark:bg-gray-600 group-hover:bg-blue-400 mx-auto" />
          </div>

          {/* Right timeline area */}
          <div className="flex-1 relative" style={{ minWidth: MIN_TIMELINE_WIDTH }}>
            {/* 2-row header */}
            <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              {/* Row 1: Week or Month group labels */}
              <div className="flex" style={{ height: 24 }}>
                {headerGroups.map((g, i) => (
                  <div key={`hg-${i}`}
                    className="border-r border-gray-200 dark:border-gray-700 flex items-center justify-center text-[11px] font-semibold text-gray-600 dark:text-gray-400 truncate px-1"
                    style={{ width: `${(g.days / totalDays) * 100}%` }}
                  >{g.label}</div>
                ))}
              </div>
              {/* Row 2: Individual day numbers */}
              <div className="flex" style={{ height: 20 }}>
                {allDays.map((d, i) => {
                  const showNum = DAY_WIDTH >= 20 || d.dayOfMonth === 1 || d.dayOfMonth % 5 === 0;
                  return (
                    <div key={`day-${i}`}
                      className={`border-r flex items-center justify-center text-[9px] ${
                        d.isWeekend
                          ? 'bg-gray-100 dark:bg-gray-800/80 text-gray-400 border-gray-200 dark:border-gray-700'
                          : 'text-gray-500 dark:text-gray-500 border-gray-100 dark:border-gray-800'
                      } ${d.dayOfWeek === 1 ? 'font-semibold' : ''}`}
                      style={{ width: `${(1 / totalDays) * 100}%`, minWidth: DAY_WIDTH }}
                    >{showNum ? d.dayOfMonth : ''}</div>
                  );
                })}
              </div>
            </div>

            {/* Rows with bars */}
            <div className="relative" ref={timelineRef}>
              {/* Day gridlines + weekend shading */}
              {allDays.map((d, i) => (
                <div key={`grid-${i}`}
                  className={`absolute top-0 bottom-0 ${d.isWeekend ? 'bg-gray-50 dark:bg-gray-800/30' : ''} ${
                    d.dayOfWeek === 1 ? 'border-l border-gray-200 dark:border-gray-700' : 'border-l border-gray-50 dark:border-gray-800/50'
                  }`}
                  style={{ left: `${(i / totalDays) * 100}%`, width: `${(1 / totalDays) * 100}%` }}
                />
              ))}

              {/* Today marker */}
              {todayPercent >= 0 && todayPercent <= 100 && (
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-dashed border-red-500 z-[5]"
                  style={{ left: `${todayPercent}%` }}
                >
                  <div className="absolute -top-0 -left-3 bg-red-500 text-white text-[10px] px-1 rounded-b">
                    Auj.
                  </div>
                </div>
              )}

              {/* Row backgrounds + bars */}
              {rows.map((row, i) => {
                const barData = row.type === 'project'
                  ? { dateDebut: row.project.dateDebut, dateFin: row.project.dateFin, statut: row.project.statut, progression: calcAutoProgress(row.project.dateDebut, row.project.dateFin) }
                  : { dateDebut: row.phase?.dateDebut, dateFin: row.phase?.dateFin, statut: row.phase?.statut || row.project.statut, progression: calcAutoProgress(row.phase?.dateDebut, row.phase?.dateFin) };
                const barStyle = getBarStyle(barData.dateDebut, barData.dateFin);
                const barColor = STATUS_BAR_COLORS[barData.statut] || 'bg-gray-400';
                const prog = barData.progression;
                // Milestone: dateDebut === dateFin or duration <= 1 day
                const startD = parseDate(barData.dateDebut);
                const endD = parseDate(barData.dateFin);
                const isMilestone = startD && endD && daysBetween(startD, endD) <= 0;

                // Override bar position/width if this row is being dragged
                const isDragTarget = dragState && dragState.rowIndex === i && dragHasMoved.current;
                const dragLeft = isDragTarget ? `${dragState!.currentLeft}%` : barStyle?.left;
                const dragWidth = isDragTarget ? `${dragState!.currentWidth}%` : barStyle?.width;

                // Reorder drop indicator: show blue line above this row
                const showDropIndicator = dragState?.type === 'reorder' && dragState.dropIndex === i;

                // Linking mode: highlight source bar, show link handle dots
                const isLinkSource = linkingState && linkingState.sourceRowIndex === i;
                const rowUniqueId = row.type === 'phase' && row.phase ? `op-${row.phase.id}` : String(row.project.id);
                const sourceUniqueId = linkingState ? (rows[linkingState.sourceRowIndex]?.type === 'phase' && rows[linkingState.sourceRowIndex]?.phase ? `op-${rows[linkingState.sourceRowIndex].phase!.id}` : String(linkingState.sourceProject.id)) : '';
                const isLinkableTarget = linkingState && rowUniqueId !== sourceUniqueId && barStyle;

                return (
                  <div
                    key={`row-${i}`}
                    className={`relative border-b border-gray-100 dark:border-gray-800 ${
                      row.type === 'project' ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-900/50'
                    }`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    {/* Reorder drop indicator line */}
                    {showDropIndicator && (
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 z-20" style={{ marginTop: -1 }} />
                    )}
                    {/* Milestone diamond */}
                    {barStyle && isMilestone && (
                      <div
                        className="absolute z-10 cursor-pointer"
                        style={{ left: dragLeft, top: ROW_HEIGHT / 2 - 7 }}
                        onClick={(e) => { if (!dragHasMoved.current && !linkingState) handleBarClick(e, row.project, row.phase); }}
                        onMouseDown={(e) => { if (!linkingState) handleBarMouseDown(e, i, row); }}
                        title={row.label}
                      >
                        <div className={`w-3.5 h-3.5 rotate-45 ${barColor} border-2 border-white shadow-sm`} />
                      </div>
                    )}
                    {barStyle && !isMilestone && (
                      <div
                        className={`absolute rounded transition-opacity hover:opacity-90 group ${
                          row.type === 'project' ? 'h-5' : 'h-4'
                        } ${isDragTarget ? 'opacity-80 ring-2 ring-blue-400 z-20' : ''} ${isLinkSource ? 'ring-2 ring-blue-500 z-20' : ''}`}
                        style={{
                          left: dragLeft,
                          width: dragWidth,
                          top: row.type === 'phase' ? 10 : 8,
                          cursor: linkingState
                            ? (isLinkableTarget ? 'crosshair' : 'default')
                            : dragState && dragState.rowIndex === i
                              ? (dragState.type === 'resize-left' || dragState.type === 'resize-right' ? 'col-resize' : dragState.type === 'reorder' ? 'move' : 'grabbing')
                              : 'grab',
                        }}
                        onClick={(e) => {
                          // If in linking mode, clicking on any valid target bar creates the link
                          if (linkingState && isLinkableTarget) {
                            handleLinkEnd(e, row);
                            return;
                          }
                          // Only open tooltip if not dragging and not linking
                          if (!dragHasMoved.current && !linkingState) {
                            handleBarClick(e, row.project, row.phase);
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (row.type === 'project') handleBarDoubleClick(row.project);
                        }}
                        onMouseDown={(e) => {
                          // Normal drag/resize if not in linking mode
                          // (dependency linking is initiated from the blue dot, not the bar edge)
                          if (!linkingState) {
                            handleBarMouseDown(e, i, row);
                          }
                        }}
                        onMouseUp={(e) => {
                          // Complete dependency link on drop (drag from source dot → release on target bar)
                          if (linkingState && isLinkableTarget) {
                            e.stopPropagation();
                            handleLinkEnd(e, row);
                          }
                        }}
                        onMouseMove={(e) => {
                          // Show edge cursors on hover when not already dragging
                          if (linkingState || dragState) return;
                          const zone = getBarCursorZone(e);
                          const el = e.currentTarget;
                          if (zone === 'left-edge' || zone === 'right-edge') {
                            el.style.cursor = 'col-resize';
                          } else {
                            el.style.cursor = 'grab';
                          }
                        }}
                      >
                        {/* Background bar */}
                        <div className={`absolute inset-0 rounded ${barColor} opacity-30`} />
                        {/* Filled progression portion */}
                        <div
                          className={`absolute inset-y-0 left-0 rounded-l ${barColor} ${prog === 100 ? 'rounded-r' : ''}`}
                          style={{ width: prog !== undefined ? `${prog}%` : '100%', opacity: prog !== undefined ? 1 : 0.7 }}
                        />
                        {/* Resize edge handles (visible on hover) */}
                        {!linkingState && (
                          <>
                            <div className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-white/20 rounded-l" />
                            <div className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-white/20 rounded-r" />
                          </>
                        )}
                        {/* Link handle dots on edges */}
                        {(
                          <>
                            {/* Right edge: link source dot — click or drag to create dependency */}
                            {/* Hitbox fully outside bar so it doesn't block resize-right handle */}
                            <div
                              className="absolute z-30"
                              style={{ right: -22, top: '50%', transform: 'translateY(-50%)', width: 20, height: 24 }}
                              title="Glisser pour créer une dépendance"
                              onMouseDown={(e) => {
                                if (linkingState && isLinkableTarget) {
                                  e.stopPropagation();
                                  handleLinkEnd(e, row);
                                } else if (!linkingState && !dragState) {
                                  e.stopPropagation();
                                  handleLinkStart(e, i, row.project);
                                }
                              }}
                              onMouseUp={(e) => {
                                if (linkingState && isLinkableTarget) {
                                  e.stopPropagation();
                                  handleLinkEnd(e, row);
                                }
                              }}
                            >
                              <div
                                className={`absolute rounded-full border-2 border-white bg-blue-500 shadow-md cursor-crosshair transition-all ${
                                  linkingState ? 'w-4 h-4 opacity-100 animate-pulse' : 'w-3 h-3 opacity-0 group-hover:opacity-80'
                                }`}
                                style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
                              />
                            </div>
                            {/* Left edge: link target dot (visible during linking for valid targets) */}
                            {isLinkableTarget && (
                              <div
                                className="absolute z-30"
                                style={{ left: -12, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, cursor: 'crosshair' }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  handleLinkEnd(e, row);
                                }}
                                onMouseUp={(e) => {
                                  e.stopPropagation();
                                  handleLinkEnd(e, row);
                                }}
                              >
                                <div
                                  className="absolute w-4 h-4 rounded-full border-2 border-white bg-green-500 shadow-md animate-pulse"
                                  style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
                                />
                              </div>
                            )}
                          </>
                        )}
                        {/* Progress % on bar when wide enough */}
                      </div>
                    )}
                    {/* Label inside bar (left-aligned, overflows right if bar is narrow) */}
                    {barStyle && !isMilestone && (
                      <span
                        className="absolute text-[11px] font-medium text-gray-700 dark:text-gray-300 pointer-events-none whitespace-nowrap z-[5]"
                        style={{ left: `calc(${dragLeft} + 6px)`, top: row.type === 'phase' ? 10 : 8, lineHeight: row.type === 'project' ? '20px' : '16px' }}
                      >
                        {row.label}
                      </span>
                    )}
                    {/* No dates indicator */}
                    {!barStyle && (
                      <div className="absolute inset-0 flex items-center px-2">
                        <span className="text-[10px] text-gray-400 italic">Pas de dates</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Reorder drop indicator at the very bottom (after last row) */}
              {dragState?.type === 'reorder' && dragState.dropIndex === rows.length && (
                <div className="relative" style={{ height: 2 }}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 z-20" />
                </div>
              )}

              {/* SVG overlay for dependency arrows and linking line */}
              <svg
                className="absolute inset-0"
                style={{ width: '100%', height: rows.length * ROW_HEIGHT, pointerEvents: 'none', zIndex: 15 }}
              >
                <defs>
                  <marker
                    id="dep-arrowhead"
                    markerWidth="7"
                    markerHeight="5"
                    refX="7"
                    refY="2.5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M 0 0 L 6.5 2.5 L 0 5 Z" fill="#9ca3af" />
                  </marker>
                  <marker
                    id="dep-arrowhead-hover"
                    markerWidth="8"
                    markerHeight="6"
                    refX="8"
                    refY="3"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M 0 0 L 7.5 3 L 0 6 Z" fill="#3B82F6" />
                  </marker>
                </defs>
                <style>{`
                  .dep-group .dep-line { transition: stroke 0.15s; }
                  .dep-group:hover .dep-line { stroke: #3B82F6; }
                  .dep-group:hover .dep-line[marker-end] { marker-end: url(#dep-arrowhead-hover); }
                `}</style>

                {/* Rendered dependency arrows. Le toggle showDeps masque
                    aussi les fleches SVG (anciennement il ne masquait que
                    le panneau du tableau, les fleches restaient visibles). */}
                {showDeps && dependencies.map((dep: any, idx: number) => {
                  // Find source and target rows (support both project and phase/operation IDs)
                  const findRow = (id: string) => rows.findIndex((r) => {
                    if (String(id).startsWith('op-')) {
                      return r.type === 'phase' && r.phase && `op-${r.phase.id}` === id;
                    }
                    return r.type === 'project' && String(r.project.id) === String(id);
                  });
                  const sourceIdx = findRow(String(dep.sourceId));
                  const targetIdx = findRow(String(dep.targetId));
                  if (sourceIdx < 0 || targetIdx < 0) return null;

                  const sourceRow = rows[sourceIdx];
                  const targetRow = rows[targetIdx];
                  const srcDates = sourceRow.type === 'phase' && sourceRow.phase ? { d: sourceRow.phase.dateDebut, f: sourceRow.phase.dateFin } : { d: sourceRow.project.dateDebut, f: sourceRow.project.dateFin };
                  const tgtDates = targetRow.type === 'phase' && targetRow.phase ? { d: targetRow.phase.dateDebut, f: targetRow.phase.dateFin } : { d: targetRow.project.dateDebut, f: targetRow.project.dateFin };
                  const sourcePcts = parsePctFromBarStyle(srcDates.d, srcDates.f);
                  const targetPcts = parsePctFromBarStyle(tgtDates.d, tgtDates.f);
                  if (!sourcePcts || !targetPcts) return null;

                  const tlEl = timelineRef.current;
                  if (!tlEl) return null;
                  const tlWidth = tlEl.getBoundingClientRect().width;

                  // Classic finish-to-start arrow: right stub → vertical → horizontal into target left
                  const srcRightX = ((sourcePcts.leftPct + sourcePcts.widthPct) / 100) * tlWidth;
                  const tgtLeftX = (targetPcts.leftPct / 100) * tlWidth;
                  const barTopOffset = 8;
                  const barH = 20;
                  const srcMidY = sourceIdx * ROW_HEIGHT + barTopOffset + barH / 2;
                  const tgtMidY = targetIdx * ROW_HEIGHT + barTopOffset + barH / 2;
                  const stub = 10;

                  let pathD: string;
                  if (tgtLeftX >= srcRightX + stub) {
                    // Target is to the right: simple L-route
                    const turnX = srcRightX + stub;
                    pathD = `M ${srcRightX} ${srcMidY} H ${turnX} V ${tgtMidY} H ${tgtLeftX}`;
                  } else {
                    // Target starts before/under source: route around with midpoint
                    const turnX = srcRightX + stub;
                    const midY = (srcMidY + tgtMidY) / 2;
                    const preX = tgtLeftX - stub;
                    pathD = `M ${srcRightX} ${srcMidY} H ${turnX} V ${midY} H ${preX} V ${tgtMidY} H ${tgtLeftX}`;
                  }

                  return (
                    <g key={dep.id || idx} className="dep-group">
                      {/* Visible arrow path — thin gray, sharp 90° corners */}
                      <path
                        className="dep-line"
                        d={pathD}
                        fill="none"
                        stroke="#9ca3af"
                        strokeWidth="1.5"
                        markerEnd="url(#dep-arrowhead)"
                      />
                      {/* Invisible wider path for easier click/hover target */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="14"
                        strokeLinecap="round"
                        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const svgRect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                          setDepPopup({
                            depId: dep.id,
                            x: e.clientX - svgRect.left,
                            y: e.clientY - svgRect.top,
                          });
                        }}
                      >
                        <title>
                          {resolveDepLabel(dep.sourceType, dep.sourceId)} → {resolveDepLabel(dep.targetType, dep.targetId)}
                          {'\n'}Cliquer pour supprimer
                        </title>
                      </path>
                    </g>
                  );
                })}

                {/* Temporary linking line */}
                {linkingState && (() => {
                  const sourceRow = rows[linkingState.sourceRowIndex];
                  if (!sourceRow) return null;
                  const srcDates = sourceRow.type === 'phase' && sourceRow.phase
                    ? { d: sourceRow.phase.dateDebut, f: sourceRow.phase.dateFin }
                    : { d: sourceRow.project.dateDebut, f: sourceRow.project.dateFin };
                  const sourcePcts = parsePctFromBarStyle(srcDates.d, srcDates.f);
                  if (!sourcePcts) return null;

                  const tlEl = timelineRef.current;
                  if (!tlEl) return null;
                  const tlWidth = tlEl.getBoundingClientRect().width;

                  const srcRightX = ((sourcePcts.leftPct + sourcePcts.widthPct) / 100) * tlWidth;
                  const srcY = linkingState.sourceRowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

                  return (
                    <>
                      {/* Source dot */}
                      <circle cx={srcRightX} cy={srcY} r={3.5} fill="#3B82F6" stroke="white" strokeWidth={1.5} />
                      {/* Temporary curved line to mouse */}
                      <path
                        d={(() => {
                          const dx = linkingState.mouseX - srcRightX;
                          const cpOff = Math.max(Math.abs(dx) * 0.3, 20);
                          return `M ${srcRightX} ${srcY} C ${srcRightX + cpOff} ${srcY}, ${linkingState.mouseX - cpOff} ${linkingState.mouseY}, ${linkingState.mouseX} ${linkingState.mouseY}`;
                        })()}
                        fill="none"
                        stroke="#3B82F6"
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        strokeOpacity={0.7}
                        strokeLinecap="round"
                      />
                      {/* Mouse dot */}
                      <circle cx={linkingState.mouseX} cy={linkingState.mouseY} r={3} fill="#3B82F6" fillOpacity={0.5} stroke="white" strokeWidth={1} />
                    </>
                  );
                })()}
              </svg>

              {/* Dependency delete confirmation popup */}
              {depPopup && (
                <div
                  className="absolute z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-3"
                  style={{ left: depPopup.x - 80, top: depPopup.y + 8, width: 200 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">Supprimer cette dependance?</p>
                  <div className="flex gap-2 justify-end">
                    <button
                      className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      onClick={() => setDepPopup(null)}
                    >
                      Annuler
                    </button>
                    <button
                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                      onClick={() => handleDeleteDependency(depPopup.depId)}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <GanttTooltipPanel tooltip={tooltip} onClose={() => setTooltip(null)} />
        )}
      </div>
      )}

      {/* Linking mode indicator (desktop only) */}
      {!isMobile && linkingState && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          <Link2 size={14} />
          <span>Mode liaison: cliquez sur le bord gauche d&apos;une autre barre pour créer la dépendance. <strong>Echap</strong> pour annuler.</span>
        </div>
      )}
    </div>
  );
}

function GanttTooltipPanel({ tooltip, onClose }: { tooltip: GanttTooltip; onClose: () => void }) {
  const { project, phase } = tooltip;
  const title = phase ? phase.nom : project.nomProjet;
  const statut = phase ? (phase.statut || project.statut) : project.statut;
  const dateDebut = phase ? phase.dateDebut : project.dateDebut;
  const dateFin = phase ? phase.dateFin : project.dateFin;

  // Position tooltip
  const style: React.CSSProperties = {
    position: 'absolute',
    left: Math.min(tooltip.x, 600),
    top: tooltip.y + 8,
    zIndex: 50,
  };

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4 w-72"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white pr-2">{title}</h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0">
          <X size={14} />
        </button>
      </div>
      {phase && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Projet: {project.nomProjet}</p>
      )}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Statut</span>
          <Badge color={statut === 'Termine' || statut === 'TERMINE' || statut === 'Accepte' || statut === 'Recu' ? 'green' : statut === 'En cours' || statut === 'EN_COURS' || statut === 'Envoye' ? 'blue' : statut === 'En attente' || statut === 'Suspendu' ? 'yellow' : statut === 'Annule' || statut === 'Refuse' ? 'red' : 'gray'} size="sm">{statut}</Badge>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Début</span>
          <span className="text-gray-700 dark:text-gray-300">{formatDate(dateDebut)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Fin</span>
          <span className="text-gray-700 dark:text-gray-300">{formatDate(dateFin)}</span>
        </div>
        {(() => {
          const tooltipProg = calcAutoProgress(dateDebut, dateFin);
          return tooltipProg !== null ? (
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Progression</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
                <div className={`h-full ${STATUS_BAR_COLORS[statut] || 'bg-blue-400'} rounded-full`} style={{ width: `${tooltipProg}%` }} />
              </div>
              <span className="text-gray-700 dark:text-gray-300">{tooltipProg}%</span>
            </div>
          </div>
          ) : null;
        })()}
        {!phase && project.budget && (
          <div className="flex justify-between">
            <span className="text-gray-500">Budget</span>
            <span className="text-gray-700 dark:text-gray-300">{formatCurrency(project.budget)}</span>
          </div>
        )}
        {!phase && project.gestionnaire && (
          <div className="flex justify-between">
            <span className="text-gray-500">Gestionnaire</span>
            <span className="text-gray-700 dark:text-gray-300">{project.gestionnaire}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// CALENDAR TAB
// ============================================================

type CalendarViewMode = 'mois' | 'semaine' | 'jour' | 'agenda';

// LocalStorage key pour persistance préférences calendrier
const CAL_PREFS_KEY = 'erp.suivi.calendar.prefs.v1';

const VALID_CAL_FILTER_KEYS = ['opportunite', 'project', 'project_start', 'bon_travail', 'devis', 'bon_commande', 'facture', 'interaction', 'activite'] as const;

function loadCalPrefs(): { viewMode: CalendarViewMode; calFilters?: Record<string, boolean> } {
  try {
    const raw = localStorage.getItem(CAL_PREFS_KEY);
    if (!raw) return { viewMode: 'mois' };
    const parsed = JSON.parse(raw);
    // Validation stricte: viewMode whitelist + calFilters bool/whitelist seulement
    const viewMode: CalendarViewMode = ['mois', 'semaine', 'jour', 'agenda'].includes(parsed?.viewMode)
      ? parsed.viewMode : 'mois';
    let calFilters: Record<string, boolean> | undefined;
    if (parsed?.calFilters && typeof parsed.calFilters === 'object') {
      calFilters = {};
      for (const key of VALID_CAL_FILTER_KEYS) {
        if (typeof parsed.calFilters[key] === 'boolean') {
          calFilters[key] = parsed.calFilters[key];
        }
      }
    }
    return { viewMode, calFilters };
  } catch {
    return { viewMode: 'mois' };
  }
}

function CalendarTab({ onError }: { onError: (msg: string) => void }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // Mémoïsation de today (date d'aujourd'hui) — évite recalcul à chaque render
  // qui invaliderait subtilement les useMemo dépendants. Recalculé une fois par session.
  const today = useMemo(() => new Date(), []);
  const initialPrefs = useMemo(() => loadCalPrefs(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  // Date de référence pour vues semaine/jour (jour central)
  const [refDay, setRefDay] = useState<number>(today.getDate());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>(initialPrefs.viewMode);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [calFilters, setCalFilters] = useState<Record<string, boolean>>(
    initialPrefs.calFilters ?? {
      opportunite: true, project: true, project_start: true,
      bon_travail: true, devis: true, bon_commande: true,
      facture: true, interaction: true, activite: true,
    }
  );

  // Persistance préférences (viewMode + filtres)
  useEffect(() => {
    try {
      localStorage.setItem(CAL_PREFS_KEY, JSON.stringify({ viewMode, calFilters }));
    } catch { /* quota / privacy mode — ignore */ }
  }, [viewMode, calFilters]);

  // --- Calendar drag & drop / resize state ---
  const [calDrag, setCalDrag] = useState<{
    event: CalendarEvent;
    originDate: string;
    targetDate: string | null;
    type: 'move' | 'resize';
  } | null>(null);
  const calDragMoved = useRef(false);

  const toggleCalFilter = (type: string) => {
    setCalFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  // Normalisation pour recherche insensible aux accents
  // \p{Mn} = Mark, Nonspacing = diacritiques combinants (U+0300-U+036F + autres scripts)
  // ASCII-only dans le source, immune à toute conversion d'encodage
  const normalizeForSearch = (s: string): string =>
    s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');

  const filteredEvents = useMemo(() => {
    const q = normalizeForSearch(searchQuery.trim());
    return events.filter((ev) => {
      if (calFilters[ev.type] === false) return false;
      if (q) {
        const hay = normalizeForSearch(
          [ev.title, ev.numero, ev.statut].filter(Boolean).join(' ')
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, calFilters, searchQuery]);

  // Helpers TZ-safe pour calculs de dates (évitent décalage local/UTC)
  // Format ISO attendu strict: 'YYYY-MM-DD' (10 char). Retourne NaN si invalide.
  const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  function isoToUTCDays(iso: string): number {
    if (!iso || iso.length < 10) return NaN;
    const head = iso.substring(0, 10);
    if (!ISO_DATE_REGEX.test(head)) return NaN;
    const [y, m, d] = head.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  }
  function utcDaysToIso(days: number): string {
    if (!Number.isFinite(days)) return '';
    const ms = days * 86400000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function addDaysToIso(iso: string, days: number): string {
    const base = isoToUTCDays(iso);
    if (!Number.isFinite(base)) return iso; // input invalide, retourne tel quel
    return utcDaysToIso(base + days);
  }

  /** Save calendar drag/resize result to backend */
  async function saveCalendarDates(ev: CalendarEvent, newStart: string, newEnd: string) {
    // Validation cohérence dates (fin >= début) + format ISO
    if (newStart && !ISO_DATE_REGEX.test(newStart.substring(0, 10))) {
      onError('Format de date de début invalide.');
      return;
    }
    if (newEnd && !ISO_DATE_REGEX.test(newEnd.substring(0, 10))) {
      onError('Format de date de fin invalide.');
      return;
    }
    if (newStart && newEnd && newStart > newEnd) {
      onError('La date de fin ne peut pas être antérieure à la date de début.');
      return;
    }
    const draggableTypes = ['project', 'project_start', 'bon_travail', 'devis', 'opportunite', 'bon_commande'];
    if (!draggableTypes.includes(ev.type)) {
      onError(`Les éléments de type « ${ev.type} » ne peuvent pas être déplacés depuis le calendrier.`);
      return;
    }
    // Validation sourceId: numérique pour les types qui en ont besoin, string pour projects
    const needsNumericId = ['bon_travail', 'devis', 'opportunite', 'bon_commande'].includes(ev.type);
    if (needsNumericId) {
      const numId = Number(ev.sourceId);
      if (!Number.isFinite(numId) || numId <= 0) {
        onError('Identifiant invalide — opération annulée.');
        return;
      }
    } else {
      if (!ev.sourceId && ev.sourceId !== 0) {
        onError('Identifiant manquant — opération annulée.');
        return;
      }
    }
    try {
      if (ev.type === 'project' || ev.type === 'project_start') {
        await projectsApi.updateProject(String(ev.sourceId), { dateDebutReel: newStart, dateFinReel: newEnd });
      } else if (ev.type === 'bon_travail') {
        await productionApi.updateWorkOrder(Number(ev.sourceId), { dateDebut: newStart, dateFin: newEnd } as any);
      } else if (ev.type === 'devis') {
        await devisApi.updateDevis(Number(ev.sourceId), { datePrevu: newEnd } as any);
      } else if (ev.type === 'opportunite') {
        await crmApi.updateOpportunity(Number(ev.sourceId), { dateDebutPrevu: newStart, dateCloturePrevue: newEnd } as any);
      } else if (ev.type === 'bon_commande') {
        await suppliersApi.updatePurchaseOrderDates(Number(ev.sourceId), { dateCommande: newStart, dateLivraisonPrevue: newEnd });
      }
      fetchEvents(year, month, viewMode === 'mois' ? 1 : 3);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Erreur inconnue';
      onError(`Erreur lors de la sauvegarde des dates : ${detail}`);
    }
  }

  // Window mouseup handler for calendar drag (TZ-safe: uses UTC day math)
  useEffect(() => {
    if (!calDrag) return;
    function handleCalMouseUp() {
      if (calDrag && calDragMoved.current && calDrag.targetDate && calDrag.targetDate !== calDrag.originDate) {
        const ev = calDrag.event;
        const evStart = (ev.dateDebut || ev.date)?.substring(0, 10);
        const evEnd = (ev.dateFin || ev.date)?.substring(0, 10);
        if (!evStart || !evEnd) {
          setCalDrag(null);
          calDragMoved.current = false;
          return;
        }
        if (calDrag.type === 'move') {
          const shiftDays = isoToUTCDays(calDrag.targetDate) - isoToUTCDays(calDrag.originDate);
          const newStart = addDaysToIso(evStart, shiftDays);
          const newEnd = addDaysToIso(evEnd, shiftDays);
          saveCalendarDates(ev, newStart, newEnd);
        } else {
          // resize: keep start, change end (validation fin >= début dans saveCalendarDates)
          saveCalendarDates(ev, evStart, calDrag.targetDate);
        }
      }
      setCalDrag(null);
      calDragMoved.current = false;
    }
    window.addEventListener('mouseup', handleCalMouseUp);
    return () => window.removeEventListener('mouseup', handleCalMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calDrag]);

  // --- Chat Claude IA pour le calendrier ---
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; content: string; timestamp: number }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConversationId, setAiConversationId] = useState<number | undefined>(undefined);
  const aiInputRef = useRef<HTMLTextAreaElement | null>(null);
  const aiChatModalRef = useRef<HTMLDivElement | null>(null);

  // Focus management chat IA (similaire à quickCreate)
  const aiReturnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let focusTimerId: number | undefined;
    if (aiChatOpen) {
      aiReturnFocusRef.current = document.activeElement as HTMLElement | null;
      focusTimerId = window.setTimeout(() => aiInputRef.current?.focus(), 50);
    } else if (aiReturnFocusRef.current && typeof aiReturnFocusRef.current.focus === 'function' && document.contains(aiReturnFocusRef.current)) {
      aiReturnFocusRef.current.focus();
      aiReturnFocusRef.current = null;
    }
    return () => {
      if (focusTimerId !== undefined) window.clearTimeout(focusTimerId);
    };
  }, [aiChatOpen]);

  useEffect(() => {
    if (!aiChatOpen) return;
    const handler = makeFocusTrap(aiChatModalRef);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [aiChatOpen]);

  // Construit le contexte calendrier à envoyer à Claude (compact, max 50 events)
  function buildAiContext(): string {
    const filterSummary = Object.entries(calFilters)
      .filter(([_, v]) => v === false)
      .map(([k]) => k)
      .join(', ');
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const eventsCompact = filteredEvents.slice(0, 50).map((ev) => {
      const start = (ev.dateDebut || ev.date)?.substring(0, 10) || '?';
      const end = (ev.dateFin || ev.date)?.substring(0, 10) || start;
      const range = start === end ? start : `${start}→${end}`;
      return `- [${ev.type}] ${ev.title} | ${range} | statut:${ev.statut}${ev.numero ? ` | num:${ev.numero}` : ''}${ev.montant ? ` | ${ev.montant.toFixed(0)}$` : ''}`;
    }).join('\n');
    const truncatedCount = Math.max(0, filteredEvents.length - 50);
    return [
      `Date du jour : ${todayIso}`,
      `Période affichée : ${headerTitle}`,
      `Vue active : ${viewMode}`,
      filterSummary ? `Filtres masqués : ${filterSummary}` : 'Tous types affichés',
      searchQuery ? `Recherche active : "${searchQuery}"` : '',
      `Événements visibles (${filteredEvents.length} total, ${Math.min(filteredEvents.length, 50)} listés) :`,
      eventsCompact || '(aucun)',
      truncatedCount > 0 ? `… (${truncatedCount} événement${truncatedCount > 1 ? 's' : ''} supplémentaire${truncatedCount > 1 ? 's' : ''} non listé${truncatedCount > 1 ? 's' : ''} — précise une plage ou un filtre si besoin)` : '',
    ].filter(Boolean).join('\n');
  }

  async function handleAiSubmit() {
    const q = aiQuestion.trim();
    if (!q || aiLoading) return;
    const userMsg = { role: 'user' as const, content: q, timestamp: Date.now() };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiQuestion('');
    setAiLoading(true);
    try {
      const context = buildAiContext();
      const res = await aiApi.chat(q, 'general', context, aiConversationId);
      if (res.conversationId) setAiConversationId(res.conversationId);
      const assistantMsg = { role: 'assistant' as const, content: res.response, timestamp: Date.now() };
      setAiMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Erreur inconnue';
      const errMsg = { role: 'assistant' as const, content: `Désolé, une erreur est survenue : ${detail}`, timestamp: Date.now() };
      setAiMessages((prev) => [...prev, errMsg]);
    } finally {
      setAiLoading(false);
      setTimeout(() => aiInputRef.current?.focus(), 50);
    }
  }

  function openAiChat() {
    setAiChatOpen(true);
  }

  function closeAiChat() {
    setAiChatOpen(false);
  }

  function resetAiConversation() {
    setAiMessages([]);
    setAiConversationId(undefined);
  }

  // --- Quick-create from calendar (formulaires riches par type) ---
  const [quickCreate, setQuickCreate] = useState<{ dateStr: string } | null>(null);
  const [qcType, setQcType] = useState<'project' | 'opportunite' | 'devis' | 'bon_travail' | 'bon_commande'>('project');
  const [qcSaving, setQcSaving] = useState(false);

  // Champs communs et spécifiques (utilisés selon qcType)
  const [qcNom, setQcNom] = useState('');
  const [qcStatut, setQcStatut] = useState('');
  const [qcPriorite, setQcPriorite] = useState('Normale');
  const [qcCompanyId, setQcCompanyId] = useState<number | ''>('');
  const [qcSupplierId, setQcSupplierId] = useState<number | ''>('');
  const [qcProjectId, setQcProjectId] = useState<number | string | ''>('');
  const [qcDateDebut, setQcDateDebut] = useState('');
  const [qcDateFin, setQcDateFin] = useState('');
  const [qcDateEcheance, setQcDateEcheance] = useState('');
  const [qcMontantEstime, setQcMontantEstime] = useState<number | ''>('');
  const [qcProbabilite, setQcProbabilite] = useState<number | ''>('');
  const [qcSource, setQcSource] = useState('');
  const [qcDescription, setQcDescription] = useState('');
  const [qcNotes, setQcNotes] = useState('');
  const [qcAdresseChantier, setQcAdresseChantier] = useState('');
  const [qcTypeSoumission, setQcTypeSoumission] = useState<'Détaillée' | 'Budgétaire'>('Détaillée');
  const [qcPoClient, setQcPoClient] = useState('');

  // Listes de référence chargées lazy à l'ouverture du modal (cache via ref)
  const [qcCompanies, setQcCompanies] = useState<{ id: number; nom: string }[]>([]);
  const [qcProjects, setQcProjects] = useState<{ id: number | string; nomProjet: string }[]>([]);
  const [qcSuppliers, setQcSuppliers] = useState<{ id: number; nom: string }[]>([]);
  const [qcListsLoading, setQcListsLoading] = useState(false);
  const qcListsLoadedRef = useRef(false);
  // Élément à re-focus à la fermeture des modals (accessibilité)
  const qcReturnFocusRef = useRef<HTMLElement | null>(null);
  const qcModalRef = useRef<HTMLDivElement | null>(null);
  const sideReturnFocusRef = useRef<HTMLElement | null>(null);
  const bottomSheetRef = useRef<HTMLDivElement | null>(null);

  // Helper générique focus trap (cycle Tab/Shift+Tab dans un container)
  function makeFocusTrap(containerRef: { current: HTMLElement | null }) {
    return function handleTrapKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusables = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
  }

  // Focus management modal quickCreate: memorize trigger, restore on close
  useEffect(() => {
    if (quickCreate) {
      qcReturnFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (qcReturnFocusRef.current && typeof qcReturnFocusRef.current.focus === 'function' && document.contains(qcReturnFocusRef.current)) {
      qcReturnFocusRef.current.focus();
      qcReturnFocusRef.current = null;
    }
  }, [quickCreate]);

  // Focus trap dans modal quickCreate
  useEffect(() => {
    if (!quickCreate) return;
    const handler = makeFocusTrap(qcModalRef);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [quickCreate]);

  // Focus management side panel / bottom sheet (selectedDay)
  useEffect(() => {
    if (selectedDay !== null) {
      sideReturnFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (sideReturnFocusRef.current && typeof sideReturnFocusRef.current.focus === 'function' && document.contains(sideReturnFocusRef.current)) {
      sideReturnFocusRef.current.focus();
      sideReturnFocusRef.current = null;
    }
  }, [selectedDay]);

  // Focus trap dans bottom sheet mobile (quand selectedDay actif sur mobile)
  useEffect(() => {
    if (!isMobile || selectedDay === null) return;
    const handler = makeFocusTrap(bottomSheetRef);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isMobile, selectedDay]);

  const QC_TYPES = [
    { value: 'project', label: 'Projet' },
    { value: 'opportunite', label: 'Opportunité' },
    { value: 'devis', label: 'Soumission' },
    { value: 'bon_travail', label: 'Bon de travail' },
    { value: 'bon_commande', label: 'Bon de commande' },
  ] as const;

  // Statuts par défaut selon le type (1ère valeur = défaut)
  const QC_STATUTS_BY_TYPE: Record<string, string[]> = {
    project: ['En attente', 'En cours', 'En pause', 'Termine'],
    opportunite: ['PROSPECTION', 'QUALIFICATION', 'PROPOSITION', 'NEGOCIATION', 'GAGNE', 'PERDU'],
    devis: ['Brouillon', 'Envoye', 'Accepte', 'Refuse'],
    bon_travail: ['BROUILLON', 'EN_COURS', 'EN_PAUSE', 'TERMINE'],
    bon_commande: ['Brouillon', 'Envoye', 'Recu', 'Annule'],
  };
  const QC_PRIORITES = ['Basse', 'Normale', 'Haute', 'Urgente'];
  const QC_SOURCES = ['Site web', 'Référence', 'Téléphone', 'Email', 'LinkedIn', 'Salon', 'Autre'];

  // Reset complet des champs au changement de type ou ouverture du modal.
  // Pré-remplit la date principale selon le type (cohérent avec l'usage métier).
  function resetQcFields(dateStr: string, type: typeof qcType) {
    setQcNom('');
    setQcStatut(QC_STATUTS_BY_TYPE[type]?.[0] || '');
    setQcPriorite('Normale');
    setQcCompanyId('');
    setQcSupplierId('');
    setQcProjectId('');
    setQcMontantEstime('');
    setQcProbabilite('');
    setQcSource('');
    setQcDescription('');
    setQcNotes('');
    setQcAdresseChantier('');
    setQcTypeSoumission('Détaillée');
    setQcPoClient('');
    // Pré-remplit la date principale selon le type
    if (type === 'project' || type === 'bon_travail') {
      setQcDateDebut(dateStr);
      setQcDateFin('');
      setQcDateEcheance('');
    } else if (type === 'opportunite') {
      setQcDateDebut('');
      setQcDateFin('');
      setQcDateEcheance(dateStr); // dateCloturePrevue
    } else if (type === 'devis') {
      setQcDateDebut('');
      setQcDateFin('');
      setQcDateEcheance(dateStr); // datePrevu
    } else if (type === 'bon_commande') {
      setQcDateDebut('');
      setQcDateFin('');
      setQcDateEcheance(dateStr); // dateLivraisonPrevue
    }
  }

  // Chargement lazy des listes de référence (1x par session, au 1er ouverture modal)
  async function ensureQcListsLoaded() {
    if (qcListsLoadedRef.current || qcListsLoading) return;
    setQcListsLoading(true);
    try {
      const [compsRes, projsRes, suppsRes] = await Promise.allSettled([
        companiesApi.listCompanies({ perPage: 500 }),
        projectsApi.listProjects({ perPage: 500 }),
        suppliersApi.listSuppliers({ perPage: 500, actif: true }),
      ]);
      if (compsRes.status === 'fulfilled') {
        setQcCompanies(compsRes.value.items.map((c: any) => ({ id: c.id, nom: c.nom || c.nomEntreprise || `Entreprise ${c.id}` })));
      }
      if (projsRes.status === 'fulfilled') {
        setQcProjects(projsRes.value.items.map((p) => ({ id: p.id, nomProjet: p.nomProjet })));
      }
      if (suppsRes.status === 'fulfilled') {
        setQcSuppliers(suppsRes.value.items.map((s) => ({ id: s.id, nom: s.nom || s.nomFournisseur || s.companyNom || `Fournisseur ${s.id}` })));
      }
      qcListsLoadedRef.current = true;
    } catch {
      // Listes restent vides — l'utilisateur peut tout de même créer sans select
    } finally {
      setQcListsLoading(false);
    }
  }

  // Au changement de type pendant le modal ouvert: reset spécifiques et repré-remplit
  // la date principale du nouveau type avec la dateStr d'origine (cohérent avec clic
  // calendrier). Garde qcNom/qcDescription/qcNotes (champs textuels libres).
  // Reset les champs numériques/sélectifs pour éviter contamination sémantique
  // (ex: montantEstime opp ne devient pas budgetTotal projet).
  useEffect(() => {
    if (!quickCreate) return;
    setQcStatut(QC_STATUTS_BY_TYPE[qcType]?.[0] || '');
    // Repré-remplit la date principale selon le nouveau type
    const d = quickCreate.dateStr;
    if (qcType === 'project' || qcType === 'bon_travail') {
      setQcDateDebut(d);
      setQcDateEcheance('');
    } else {
      // opportunite, devis, bon_commande
      setQcDateDebut('');
      setQcDateEcheance(d);
    }
    // Reset date fin (sémantique différente selon type)
    setQcDateFin('');
    // Reset champs numériques (sémantique différente: budget vs montant vs prix)
    setQcMontantEstime('');
    setQcProbabilite(''); // opportunité-only
    // Reset champs ID (chaque type a ses propres relations)
    setQcSupplierId(''); // BC-only
    setQcCompanyId(''); // pas exposé pour BT/BC
    setQcProjectId(''); // pas exposé pour Projet/Opportunité
    // Reset champs textuels propres au type
    setQcSource(''); // opportunité-only
    setQcTypeSoumission('Détaillée'); // devis-only
    setQcAdresseChantier(''); // projet-only
    setQcPoClient(''); // sémantique différente selon type
    setQcPriorite('Normale'); // par défaut
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qcType]);

  // Au ouverture du modal, charger les listes + reset les champs
  useEffect(() => {
    if (quickCreate) {
      ensureQcListsLoaded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickCreate]);

  // Création avec tous les champs riches + navigation post-création.
  // openAfterCreate=true => navigate vers la page détail (mode "Plus de détails")
  // openAfterCreate=false => reste sur calendrier (recharge events)
  async function handleQuickCreate(openAfterCreate = false) {
    if (!quickCreate || qcSaving) return;
    // Nom requis pour Projet/Opportunité/Devis. BT et BC peuvent être créés sans nom.
    // (BT : utilise le nom projet par défaut ; BC : pas de notion de nom)
    const requiresName = qcType !== 'bon_commande' && qcType !== 'bon_travail';
    if (requiresName && !qcNom.trim()) {
      onError('Le nom est requis.');
      return;
    }
    // BC requiert obligatoirement un fournisseur
    if (qcType === 'bon_commande' && (typeof qcSupplierId !== 'number' || qcSupplierId <= 0)) {
      onError('Veuillez sélectionner un fournisseur pour le bon de commande.');
      return;
    }
    setQcSaving(true);
    try {
      let createdId: number | string | undefined;
      let detailRoute: string | null = null;

      if (qcType === 'project') {
        const res = await projectsApi.createProject({
          nomProjet: qcNom.trim(),
          statut: qcStatut || 'En cours',
          priorite: qcPriorite,
          clientCompanyId: typeof qcCompanyId === 'number' ? qcCompanyId : undefined,
          dateDebutReel: qcDateDebut || undefined,
          dateFinReel: qcDateFin || undefined,
          datePrevu: qcDateEcheance || undefined,
          budgetTotal: typeof qcMontantEstime === 'number' ? qcMontantEstime : undefined,
          description: qcDescription || undefined,
          notes: qcNotes || undefined,
          adresseChantier: qcAdresseChantier || undefined,
          poClient: qcPoClient || undefined,
        });
        createdId = res.id;
        detailRoute = `/projets?open=${res.id}`;
      } else if (qcType === 'opportunite') {
        const res = await crmApi.createOpportunity({
          nom: qcNom.trim(),
          statut: qcStatut || 'PROSPECTION',
          priorite: qcPriorite,
          companyId: typeof qcCompanyId === 'number' ? qcCompanyId : undefined,
          montantEstime: typeof qcMontantEstime === 'number' ? qcMontantEstime : undefined,
          probabilite: typeof qcProbabilite === 'number' ? qcProbabilite : undefined,
          dateDebutPrevu: qcDateDebut || undefined,
          dateCloturePrevue: qcDateEcheance || undefined,
          source: qcSource || undefined,
          notes: qcNotes || undefined,
          description: qcDescription || undefined,
          poClient: qcPoClient || undefined,
        });
        createdId = res.id;
        detailRoute = `/ventes?open=${res.id}`;
      } else if (qcType === 'devis') {
        const res = await devisApi.createDevis({
          nomProjet: qcNom.trim(),
          statut: qcStatut || 'Brouillon',
          priorite: qcPriorite,
          clientCompanyId: typeof qcCompanyId === 'number' ? qcCompanyId : undefined,
          projectId: typeof qcProjectId === 'number' ? String(qcProjectId) : (typeof qcProjectId === 'string' && qcProjectId ? qcProjectId : undefined),
          datePrevu: qcDateEcheance || undefined,
          dateFin: qcDateFin || undefined,
          typeSoumission: qcTypeSoumission,
          prixEstime: typeof qcMontantEstime === 'number' ? qcMontantEstime : undefined,
          description: qcDescription || undefined,
          notes: qcNotes || undefined,
          poClient: qcPoClient || undefined,
        });
        createdId = res.id;
        detailRoute = `/devis?open=${res.id}`;
      } else if (qcType === 'bon_travail') {
        const res = await productionApi.createWorkOrder({
          nom: qcNom.trim() || undefined,
          projectId: typeof qcProjectId === 'number' ? qcProjectId : (typeof qcProjectId === 'string' && qcProjectId ? Number(qcProjectId) : undefined),
          priorite: qcPriorite,
          dateDebut: qcDateDebut || undefined,
          dateFin: qcDateFin || undefined,
          dateEcheance: qcDateEcheance || undefined,
          notes: qcNotes || undefined,
        });
        createdId = res.id;
        detailRoute = `/bons-travail?open=${res.id}`;
      } else if (qcType === 'bon_commande') {
        const supId = qcSupplierId as number;
        const res = await suppliersApi.createPurchaseOrder(supId, {
          projectId: typeof qcProjectId === 'number' ? qcProjectId : (typeof qcProjectId === 'string' && qcProjectId ? Number(qcProjectId) : undefined),
          dateLivraisonPrevue: qcDateEcheance || undefined,
          notes: qcNotes || undefined,
        });
        createdId = res.id;
        detailRoute = `/magasin?open=${res.id}`;
      }

      const willNavigate = !!(createdId && detailRoute && (openAfterCreate || qcType === 'bon_travail'));
      setQuickCreate(null);
      // Skip refetch si on va navigate ailleurs (le composant sera démonté)
      if (!willNavigate) {
        fetchEvents(year, month, viewMode === 'mois' ? 1 : 3);
      }
      // Navigation vers la page détail si demandé OU si type BT (Sylvain a choisi
      // 'créer vide + ouvrir page après' pour les BT — sections Opérations/Produits)
      if (willNavigate && detailRoute) {
        navigate(detailRoute);
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Erreur inconnue';
      onError(`Erreur lors de la création : ${detail}`);
    } finally {
      setQcSaving(false);
    }
  }

  function navigateToItem(ev: CalendarEvent) {
    const routeMap: Record<string, string> = {
      devis: '/devis',
      project: '/projets',
      project_start: '/projets',
      bon_travail: '/bons-travail',
      bon_commande: '/magasin',
      opportunite: '/ventes',
      facture: '/comptabilite',
      interaction: '/ventes',
      activite: '/ventes',
    };
    const route = routeMap[ev.type];
    if (route && ev.sourceId) {
      navigate(`${route}?open=${ev.sourceId}`);
    }
  }

  // Compteur de version pour annuler les fetch obsolètes (race condition guard)
  // Si l'utilisateur navigue/change de vue rapidement, seul le dernier fetch écrit setEvents.
  const fetchVersionRef = useRef(0);

  // Garde de montage pour prévenir setState après unmount (ex: switch tab pendant fetch)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Fetch événements pour 1 mois (vue mois) ou 3 mois adjacents (vues semaine/jour)
  // afin de couvrir les périodes chevauchant la frontière mensuelle.
  const fetchEvents = useCallback(async (y: number, m: number, spanMonths: 1 | 3 = 1) => {
    const myVersion = ++fetchVersionRef.current;
    setIsLoading(true);
    try {
      const monthsToFetch: { y: number; m: number }[] = [];
      if (spanMonths === 3) {
        const prev = m - 1 < 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
        const next = m + 1 > 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
        monthsToFetch.push(prev, { y, m }, next);
      } else {
        monthsToFetch.push({ y, m });
      }
      const seenIds = new Set<string>();
      // Mois en parallèle (3 max) — plus rapide qu'en séquence
      const monthResults = await Promise.allSettled(
        monthsToFetch.map((slot) => productionApi.getCalendarEvents(slot.y, slot.m + 1))
      );
      const calEvents: CalendarEvent[] = [];
      for (const r of monthResults) {
        if (r.status === 'fulfilled') {
          for (const ev of (r.value.events || [])) {
            if (!seenIds.has(ev.id)) {
              seenIds.add(ev.id);
              calEvents.push(ev);
            }
          }
        }
      }
      // Opportunités CRM: 1ère page synchrone (lit total), suite en parallèle
      try {
        const PAGE_SIZE = 200;
        const MAX_PAGES = 25; // safety cap: max 5000 opportunités
        const firstRes = await crmApi.listOpportunities({ page: 1, perPage: PAGE_SIZE });
        const total = firstRes.total ?? 0;
        const totalPages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
        const allItems = [...(firstRes.items || [])];
        if (totalPages > 1) {
          const pages = await Promise.allSettled(
            Array.from({ length: totalPages - 1 }, (_, i) =>
              crmApi.listOpportunities({ page: i + 2, perPage: PAGE_SIZE })
            )
          );
          for (const p of pages) {
            if (p.status === 'fulfilled') {
              allItems.push(...(p.value.items || []));
            }
          }
        }
        for (const opp of allItems) {
          if (opp.dateCloturePrevue) {
            const id = `opp-${opp.id}`;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              calEvents.push({
                id,
                title: `${opp.nom}`,
                date: opp.dateCloturePrevue,
                type: 'opportunite',
                sourceId: opp.id,
                statut: opp.statut,
              });
            }
          }
        }
      } catch { /* ignore */ }
      // Si composant unmount ou autre version a démarré, ignorer ce résultat
      if (!isMountedRef.current || myVersion !== fetchVersionRef.current) return;
      setEvents(calEvents);
    } catch {
      if (!isMountedRef.current || myVersion !== fetchVersionRef.current) return;
      onError('Erreur lors du chargement du calendrier');
    } finally {
      if (isMountedRef.current && myVersion === fetchVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [onError]);

  useEffect(() => {
    const span: 1 | 3 = viewMode === 'mois' ? 1 : 3;
    fetchEvents(year, month, span);
  }, [year, month, viewMode, fetchEvents]);

  // Clamp synchrone refDay si supérieur au nombre de jours du mois courant
  // (calculé pendant le render pour éviter affichage 1 frame d'une date invalide).
  // setState async dans useEffect pour persister le clamp dans le state.
  const safeRefDay = useMemo(() => {
    const maxDay = daysInMonth(year, month);
    return Math.min(refDay, maxDay);
  }, [year, month, refDay]);

  useEffect(() => {
    if (safeRefDay !== refDay) {
      setRefDay(safeRefDay);
    }
  }, [safeRefDay, refDay]);

  // Bornes de navigation: années [1900, 9999] (ISO_DATE_REGEX exige 4 digits exact)
  const MIN_YEAR = 1900;
  const MAX_YEAR = 9999;

  // Navigation universelle selon viewMode
  function navigateDelta(delta: number) {
    setSelectedDay(null);
    if (viewMode === 'mois') {
      let newMonth = month + delta;
      let newYear = year;
      while (newMonth < 0) { newMonth += 12; newYear--; }
      while (newMonth > 11) { newMonth -= 12; newYear++; }
      // Clamp aux bornes raisonnables
      if (newYear < MIN_YEAR || newYear > MAX_YEAR) return;
      setMonth(newMonth);
      setYear(newYear);
    } else {
      // semaine=7 jours, jour=1 jour, agenda=7 jours (semaine glissée)
      const unitDays = viewMode === 'semaine' ? 7 : viewMode === 'agenda' ? 7 : 1;
      const refIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(safeRefDay).padStart(2, '0')}`;
      const newIso = addDaysToIso(refIso, delta * unitDays);
      const [y, m, d] = newIso.split('-').map(Number);
      if (!Number.isFinite(y) || y < MIN_YEAR || y > MAX_YEAR) return;
      setYear(y); setMonth(m - 1); setRefDay(d);
    }
  }

  function goToPrev() { navigateDelta(-1); }
  function goToNext() { navigateDelta(1); }

  function goToToday() {
    setSelectedDay(null);
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setRefDay(today.getDate());
  }

  // Raccourcis clavier
  // - '/' focus recherche, Esc vide recherche
  // - ←/→ navigation
  // - Shift+T = Aujourd'hui, Shift+M = Mois, Shift+S = Semaine, Shift+J = Jour
  //   (Shift modificateur pour ne pas conflit avec QuickNav lecteurs d'écran NVDA/JAWS)
  // - Tous ignorés si un drag est actif (calDrag) ou si focus dans input
  function changeView(mode: CalendarViewMode) {
    setViewMode(mode);
    setSelectedDay(null); // Fix QA: reset selection pour cohérence side panel
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inEditable = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      );
      // Escape: priorité drag > chat IA > modal quick-create > side panel > recherche > blur input
      // Esc pendant drag = annule le drag (UX standard)
      // Esc bloqué si qcSaving en cours pour éviter close pendant API call
      if (e.key === 'Escape') {
        if (calDrag) { setCalDrag(null); calDragMoved.current = false; return; }
        if (aiChatOpen) { setAiChatOpen(false); return; }
        if (quickCreate) { if (qcSaving) return; setQuickCreate(null); return; }
        if (selectedDay !== null) { setSelectedDay(null); return; }
        if (searchQuery) { setSearchQuery(''); return; }
        if (target === searchInputRef.current) searchInputRef.current?.blur();
        return;
      }
      // Bloque tous les autres raccourcis si un drag est actif (évite état sticky)
      if (calDrag) return;
      // Bloque les raccourcis non-Escape si un modal est ouvert (focus trap)
      if (quickCreate || aiChatOpen) return;
      // '/' focus search depuis n'importe où sauf un input
      if (e.key === '/' && !inEditable) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (inEditable) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // Navigation ← / → toujours active (utile au clavier sans Shift)
      if (e.key === 'ArrowLeft') { navigateDelta(-1); return; }
      if (e.key === 'ArrowRight') { navigateDelta(1); return; }
      // Lettres requièrent Shift pour éviter conflit avec NVDA/JAWS QuickNav
      if (!e.shiftKey) return;
      switch (e.key) {
        case 't': case 'T': goToToday(); break;
        case 'm': case 'M': changeView('mois'); break;
        case 's': case 'S': changeView('semaine'); break;
        case 'j': case 'J': changeView('jour'); break;
        case 'a': case 'A': changeView('agenda'); break;
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, year, month, refDay, searchQuery, calDrag, quickCreate, selectedDay, aiChatOpen, qcSaving]);

  // Build calendar grid
  const grid = useMemo(() => {
    const totalDaysCount = daysInMonth(year, month);
    const firstDayOfMonth = new Date(year, month, 1);
    // getDay: 0=Sun — Sunday is first column
    const startDow = firstDayOfMonth.getDay();

    type DayEvent = CalendarEvent & { spanPos: 'single' | 'start' | 'middle' | 'end' };
    const cells: { day: number | null; isToday: boolean; events: DayEvent[] }[] = [];

    // Empty cells before the 1st
    for (let i = 0; i < startDow; i++) {
      cells.push({ day: null, isToday: false, events: [] });
    }

    // Day cells — place multi-day events on every day in their range
    for (let d = 1; d <= totalDaysCount; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
      const dayEvents: DayEvent[] = [];
      for (const ev of filteredEvents) {
        const evStart = (ev.dateDebut || ev.date)?.substring(0, 10);
        const evEnd = (ev.dateFin || ev.date)?.substring(0, 10);
        if (!evStart || !evEnd) continue;
        if (dateStr >= evStart && dateStr <= evEnd) {
          const isStart = dateStr === evStart;
          const isEnd = dateStr === evEnd;
          dayEvents.push({
            ...ev,
            spanPos: isStart && isEnd ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'middle',
          });
        }
      }
      cells.push({ day: d, isToday, events: dayEvents });
    }

    // Pad to complete last row
    while (cells.length % 7 !== 0) {
      cells.push({ day: null, isToday: false, events: [] });
    }

    return cells;
  }, [year, month, filteredEvents]);

  // Events for selected day
  const selectedDayEvents = useMemo(() => {
    if (selectedDay === null) return [];
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    return filteredEvents.filter((ev) => {
      const evStart = (ev.dateDebut || ev.date)?.substring(0, 10);
      const evEnd = (ev.dateFin || ev.date)?.substring(0, 10);
      if (!evStart || !evEnd) return false;
      return dateStr >= evStart && dateStr <= evEnd;
    });
  }, [selectedDay, year, month, filteredEvents]);

  // Grid vue Semaine — 7 colonnes (Dim→Sam) à partir du dimanche contenant refDay
  const weekGrid = useMemo(() => {
    const refIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(safeRefDay).padStart(2, '0')}`;
    // Calcul du jour de la semaine UTC pour éviter décalages
    const [ry, rm, rd] = refIso.split('-').map(Number);
    const refUtc = new Date(Date.UTC(ry, rm - 1, rd));
    const dow = refUtc.getUTCDay(); // 0=Dim
    const sundayIso = addDaysToIso(refIso, -dow);
    const days: { dateStr: string; dayNum: number; monthIdx: number; yearNum: number; dayName: string; isToday: boolean; events: CalendarEvent[] }[] = [];
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    for (let i = 0; i < 7; i++) {
      const dIso = addDaysToIso(sundayIso, i);
      const [y, m, d] = dIso.split('-').map(Number);
      const dEvents = filteredEvents.filter((ev) => {
        const evStart = (ev.dateDebut || ev.date)?.substring(0, 10);
        const evEnd = (ev.dateFin || ev.date)?.substring(0, 10);
        if (!evStart || !evEnd) return false;
        return dIso >= evStart && dIso <= evEnd;
      });
      days.push({
        dateStr: dIso,
        dayNum: d,
        monthIdx: m - 1,
        yearNum: y,
        dayName: DAY_NAMES_FR[i],
        isToday: dIso === todayIso,
        events: dEvents,
      });
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, safeRefDay, filteredEvents]);

  // Vue Jour — événements pour refDay
  const dayView = useMemo(() => {
    const refIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(safeRefDay).padStart(2, '0')}`;
    const dEvents = filteredEvents.filter((ev) => {
      const evStart = (ev.dateDebut || ev.date)?.substring(0, 10);
      const evEnd = (ev.dateFin || ev.date)?.substring(0, 10);
      if (!evStart || !evEnd) return false;
      return refIso >= evStart && refIso <= evEnd;
    });
    const [y, m, d] = refIso.split('-').map(Number);
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return {
      dateStr: refIso,
      dayNum: d,
      monthIdx: m - 1,
      yearNum: y,
      isToday: refIso === todayIso,
      events: dEvents,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, safeRefDay, filteredEvents]);

  // Vue Agenda — liste chronologique sur 30 jours à partir de refDay
  const agendaView = useMemo(() => {
    const startIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(safeRefDay).padStart(2, '0')}`;
    const AGENDA_DAYS = 30;
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const days: {
      dateStr: string;
      dayNum: number;
      monthIdx: number;
      yearNum: number;
      dayName: string;
      isToday: boolean;
      ferieLabel: string | null;
      events: CalendarEvent[];
    }[] = [];
    for (let i = 0; i < AGENDA_DAYS; i++) {
      const dIso = addDaysToIso(startIso, i);
      const [y, m, d] = dIso.split('-').map(Number);
      if (!Number.isFinite(y)) continue;
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dEvents = filteredEvents.filter((ev) => {
        const evStart = (ev.dateDebut || ev.date)?.substring(0, 10);
        const evEnd = (ev.dateFin || ev.date)?.substring(0, 10);
        if (!evStart || !evEnd) return false;
        return dIso >= evStart && dIso <= evEnd;
      });
      days.push({
        dateStr: dIso,
        dayNum: d,
        monthIdx: m - 1,
        yearNum: y,
        dayName: DAY_NAMES_FR[dt.getUTCDay()],
        isToday: dIso === todayIso,
        ferieLabel: getFerieQC(dIso),
        events: dEvents,
      });
    }
    return { startIso, endIso: days[days.length - 1]?.dateStr ?? startIso, days };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, safeRefDay, filteredEvents]);

  // Titre du header selon vue
  const headerTitle = useMemo(() => {
    if (viewMode === 'mois') return `${MONTH_NAMES_FR[month]} ${year}`;
    if (viewMode === 'semaine') {
      // weekGrid contient toujours 7 éléments (boucle for i<7 dans le memo)
      const first = weekGrid[0];
      const last = weekGrid[6];
      if (first.monthIdx === last.monthIdx && first.yearNum === last.yearNum) {
        return `${first.dayNum}–${last.dayNum} ${MONTH_NAMES_FR[first.monthIdx]} ${first.yearNum}`;
      }
      const fmShort = SHORT_MONTH_NAMES_FR[first.monthIdx];
      const lmShort = SHORT_MONTH_NAMES_FR[last.monthIdx];
      if (first.yearNum === last.yearNum) {
        return `${first.dayNum} ${fmShort} – ${last.dayNum} ${lmShort} ${first.yearNum}`;
      }
      return `${first.dayNum} ${fmShort} ${first.yearNum} – ${last.dayNum} ${lmShort} ${last.yearNum}`;
    }
    if (viewMode === 'agenda') {
      const first = agendaView.days[0];
      const last = agendaView.days[agendaView.days.length - 1];
      if (!first || !last) return 'Agenda';
      const fmShort = SHORT_MONTH_NAMES_FR[first.monthIdx];
      const lmShort = SHORT_MONTH_NAMES_FR[last.monthIdx];
      if (first.yearNum === last.yearNum) {
        return `Agenda · ${first.dayNum} ${fmShort} – ${last.dayNum} ${lmShort} ${first.yearNum}`;
      }
      return `Agenda · ${first.dayNum} ${fmShort} ${first.yearNum} – ${last.dayNum} ${lmShort} ${last.yearNum}`;
    }
    // jour
    const dt = new Date(Date.UTC(dayView.yearNum, dayView.monthIdx, dayView.dayNum));
    const dayName = DAY_NAMES_FR[dt.getUTCDay()];
    return `${dayName} ${dayView.dayNum} ${MONTH_NAMES_FR[dayView.monthIdx]} ${dayView.yearNum}`;
  }, [viewMode, year, month, weekGrid, dayView, agendaView]);

  // EVENT_TYPE_COLORS: textes assombris pour WCAG AA (ratio ≥ 4.5:1 sur fond /10) en mode clair
  // Variants dark: claircis pour WCAG AA sur fond gray-900 (#101820) en mode sombre
  // Palette pastel design préservée pour les dots et backgrounds.
  const EVENT_TYPE_COLORS: Record<string, { dot: string; bg: string; text: string; label: string }> = {
    project: { dot: 'bg-[#7BAFD4]', bg: 'bg-[#7BAFD4]/10', text: 'text-[#2f5470] dark:text-[#a8ccff]', label: 'Échéance projet' },
    project_start: { dot: 'bg-[#7BAFD4]', bg: 'bg-[#7BAFD4]/10', text: 'text-[#2f5470] dark:text-[#a8ccff]', label: 'Début projet' },
    bon_travail: { dot: 'bg-[#F6C87A]', bg: 'bg-[#F6C87A]/10', text: 'text-[#6b5413] dark:text-[#f6c87a]', label: 'Bon de travail' },
    devis: { dot: 'bg-[#7DC4A5]', bg: 'bg-[#7DC4A5]/10', text: 'text-[#2d6149] dark:text-[#a8ddc4]', label: 'Soumission expiration' },
    opportunite: { dot: 'bg-[#B09BD8]', bg: 'bg-[#B09BD8]/10', text: 'text-[#544370] dark:text-[#cebfee]', label: 'Opportunité' },
    bon_commande: { dot: 'bg-[#F0B07A]', bg: 'bg-[#F0B07A]/10', text: 'text-[#6b4818] dark:text-[#f0b07a]', label: 'Bon de commande' },
    facture: { dot: 'bg-[#E8919A]', bg: 'bg-[#E8919A]/10', text: 'text-[#7a3942] dark:text-[#f5bac1]', label: 'Facture' },
    interaction: { dot: 'bg-[#D4A0B0]', bg: 'bg-[#D4A0B0]/10', text: 'text-[#6e4250] dark:text-[#e8c5d0]', label: 'Interaction' },
    activite: { dot: 'bg-[#7DC4B5]', bg: 'bg-[#7DC4B5]/10', text: 'text-[#2d6157] dark:text-[#a8ddd1]', label: 'Activité CRM' },
  };

  function getStatusBadgeColor(statut: string | undefined): 'green' | 'blue' | 'yellow' | 'red' | 'gray' {
    if (!statut) return 'gray';
    if (['Termine', 'TERMINE', 'Accepte', 'Recu', 'Payee', 'PAYEE'].includes(statut)) return 'green';
    if (['En cours', 'EN_COURS', 'Envoye', 'Envoyee', 'ENVOYEE'].includes(statut)) return 'blue';
    if (['En attente', 'Suspendu', 'BROUILLON', 'Brouillon', 'PARTIELLEMENT_PAYEE'].includes(statut)) return 'yellow';
    if (['Annule', 'Refuse', 'En retard', 'EN_RETARD', 'ANNULEE'].includes(statut)) return 'red';
    return 'gray';
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Annonce sr-only pour lecteurs d'écran (changement vue/période) */}
      <div role="status" aria-live="polite" className="sr-only">
        {`Calendrier — Vue ${viewMode === 'mois' ? 'mois' : viewMode === 'semaine' ? 'semaine' : viewMode === 'agenda' ? 'agenda' : 'jour'}, ${headerTitle}`}
      </div>
      {/* Header: navigation + toggle vues + recherche */}
      <div className={`${isMobile ? 'space-y-2' : 'flex items-center justify-between gap-3 flex-wrap'}`}>
        <div className="flex items-center gap-2 flex-wrap" role="navigation" aria-label="Navigation période">
          <Button size="sm" variant="ghost" onClick={goToPrev} title="Précédent (←)" aria-label="Période précédente">
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <h3 className={`${isMobile ? 'text-sm' : 'text-base'} font-semibold text-gray-900 dark:text-white min-w-[180px] text-center`}>
            {headerTitle}
          </h3>
          <Button size="sm" variant="ghost" onClick={goToNext} title="Suivant (→)" aria-label="Période suivante">
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="ghost" onClick={goToToday} title="Aujourd'hui (Shift+T)">
            Aujourd&apos;hui
          </Button>
        </div>
        <div className={`flex items-center gap-2 ${isMobile ? 'flex-wrap' : ''}`}>
          {/* Toggle de vue */}
          <div
            className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs"
            role="tablist"
            aria-label="Mode d'affichage du calendrier"
          >
            {([
              ['mois', 'Mois', 'Shift+M'],
              ['semaine', 'Semaine', 'Shift+S'],
              ['jour', 'Jour', 'Shift+J'],
              ['agenda', 'Agenda', 'Shift+A'],
            ] as [CalendarViewMode, string, string][]).map(([mode, label, key]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={viewMode === mode}
                onClick={() => changeView(mode)}
                className={`px-3 py-1 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:ring-inset ${
                  viewMode === mode
                    ? 'bg-seaop-primary-600 text-white'
                    : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
                title={`Vue ${label} (raccourci : ${key})`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Recherche */}
          <div className="relative">
            <Search size={13} aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isMobile ? 'Rechercher' : 'Rechercher (touche /)'}
              aria-label="Rechercher dans le calendrier"
              className={`pl-7 pr-7 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:ring-2 focus:ring-seaop-primary-500 focus:border-transparent ${isMobile ? 'w-36' : 'w-52'}`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Effacer (Esc)"
                aria-label="Effacer la recherche"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {/* Bouton Demander à Claude */}
          <button
            type="button"
            onClick={openAiChat}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-gradient-to-r from-seaop-primary-600 to-seaop-primary-500 text-white hover:from-seaop-primary-700 hover:to-seaop-primary-600 shadow-sm hover:shadow focus:outline-none focus:ring-2 focus:ring-seaop-primary-400 transition-all"
            title="Demander à Claude un résumé ou des suggestions sur le calendrier"
            aria-label="Ouvrir l'assistant IA Claude pour le calendrier"
          >
            <Sparkles size={13} aria-hidden="true" />
            {!isMobile && <span>Claude</span>}
          </button>
        </div>
      </div>

      {/* Filtres par type d'événement */}
      <div
        className={`flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 ${isMobile ? 'overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1' : 'flex-wrap gap-3'}`}
        role="group"
        aria-label="Filtres par type d'événement"
      >
        {([
          ['opportunite', 'bg-[#B09BD8]', isMobile ? 'Opp.' : 'Opportunité'],
          ['devis', 'bg-[#7DC4A5]', 'Soumission'],
          ['project', 'bg-[#7BAFD4]', 'Projet'],
          ['bon_commande', 'bg-[#F0B07A]', isMobile ? 'BC' : 'Bon de commande'],
          ['bon_travail', 'bg-[#F6C87A]', isMobile ? 'BT' : 'Bon de travail'],
          ['facture', 'bg-[#E8919A]', isMobile ? 'Fact.' : 'Facture'],
          ['interaction', 'bg-[#D4A0B0]', isMobile ? 'Inter.' : 'Interaction'],
          ['activite', 'bg-[#7DC4B5]', isMobile ? 'Act.' : 'Activité CRM'],
        ] as [string, string, string][]).map(([type, dotClass, label]) => (
          <button
            key={type}
            type="button"
            onClick={() => toggleCalFilter(type)}
            className={`flex items-center gap-1 px-2 py-1 rounded-full transition-colors whitespace-nowrap shrink-0 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 ${
              calFilters[type] !== false
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                : 'bg-transparent text-gray-400 dark:text-gray-500 line-through'
            }`}
            aria-pressed={calFilters[type] !== false}
            title={`${calFilters[type] !== false ? 'Masquer' : 'Afficher'} ${label}`}
          >
            <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${calFilters[type] !== false ? dotClass : 'bg-gray-300 dark:bg-gray-600'}`} />
            {label}
          </button>
        ))}
        {searchQuery && (
          <span
            className="text-[11px] text-gray-500 dark:text-gray-400 italic"
            role="status"
            aria-live="polite"
          >
            {filteredEvents.length} résultat{filteredEvents.length > 1 ? 's' : ''} pour « {searchQuery} »
          </span>
        )}
        {(() => {
          // Bouton "Réinitialiser" si au moins 1 filtre désactivé OU recherche active
          const hasFilterChanged = Object.values(calFilters).some((v) => v === false);
          const hasActiveFilter = hasFilterChanged || !!searchQuery;
          if (!hasActiveFilter) return null;
          return (
            <button
              type="button"
              onClick={() => {
                setCalFilters({
                  opportunite: true, project: true, project_start: true,
                  bon_travail: true, devis: true, bon_commande: true,
                  facture: true, interaction: true, activite: true,
                });
                setSearchQuery('');
              }}
              className="text-[11px] text-seaop-primary-600 hover:text-seaop-primary-700 dark:text-seaop-primary-400 dark:hover:text-seaop-primary-300 hover:underline focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 rounded px-1"
              title="Réinitialiser tous les filtres et la recherche"
            >
              Réinitialiser
            </button>
          );
        })()}
      </div>

      {isLoading ? (
        <div role="status" aria-busy="true" aria-live="polite" className="flex-1 min-h-0">
          <span className="sr-only">Chargement du calendrier en cours…</span>
          <SkeletonPage />
        </div>
      ) : (
        <div className={isMobile ? 'space-y-0' : 'flex gap-4 flex-1 min-h-0'}>
          {/* Calendar grid */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* === VUE MOIS === */}
            {viewMode === 'mois' && (
            <div
              className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 flex flex-col flex-1 min-h-0"
              role="grid"
              aria-label={`Calendrier ${MONTH_NAMES_FR[month]} ${year}`}
            >
              {/* Day headers */}
              <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-800/50" role="row">
                {DAY_NAMES_FR.map((d) => (
                  <div
                    key={d}
                    role="columnheader"
                    className={`${isMobile ? 'py-1.5 text-[10px]' : 'py-2 text-xs'} text-center font-semibold text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700`}
                  >
                    {isMobile ? d.charAt(0) : d}
                  </div>
                ))}
              </div>

              {/* Day cells — full-height grid: weeks share available space equally */}
              {/* Structure WAI-ARIA: rowgroup > row > gridcell (lignes groupées par 7 via display:contents) */}
              <div
                className="grid grid-cols-7 flex-1 min-h-0"
                style={{ gridTemplateRows: `repeat(${Math.ceil(grid.length / 7)}, 1fr)` }}
                role="rowgroup"
              >
                {Array.from({ length: Math.ceil(grid.length / 7) }, (_, weekIdx) => (
                  <div key={`row-${weekIdx}`} role="row" className="contents">
                {grid.slice(weekIdx * 7, weekIdx * 7 + 7).map((cell, j) => {
                  const i = weekIdx * 7 + j;
                  const cellDateStr = cell.day !== null ? `${year}-${String(month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}` : '';
                  const isDropTarget = calDrag && cell.day !== null && calDrag.targetDate === cellDateStr && cellDateStr !== calDrag.originDate;
                  const ferieLabel = cell.day !== null ? getFerieQC(cellDateStr) : null;
                  // Numéro semaine ISO (affiché uniquement sur 1ère cellule de la ligne avec cell.day !== null)
                  const showWeekNum = cell.day !== null && j === 0;
                  const weekNum = showWeekNum ? getISOWeek(new Date(Date.UTC(year, month, cell.day!))) : null;
                  return (
                  <div
                    key={i}
                    role={cell.day !== null ? 'gridcell' : 'presentation'}
                    aria-current={cell.isToday ? 'date' : undefined}
                    aria-selected={cell.day !== null && cell.day === selectedDay}
                    aria-label={cell.day !== null ? `${cell.day} ${MONTH_NAMES_FR[month]} ${year}${ferieLabel ? `, jour férié : ${ferieLabel}` : ''}${cell.events.length > 0 ? `, ${cell.events.length} événement${cell.events.length > 1 ? 's' : ''}` : ''}` : undefined}
                    tabIndex={cell.day !== null ? 0 : undefined}
                    className={`group relative ${isMobile ? 'min-h-[52px]' : 'min-h-0'} border-b border-r border-gray-100 dark:border-gray-800 p-1 transition-colors overflow-hidden focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:ring-inset ${
                      isDropTarget
                        ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-inset ring-blue-300'
                        : cell.day === null
                          ? 'bg-gray-50/50 dark:bg-gray-900/50'
                          : ferieLabel
                            ? 'bg-red-50/40 dark:bg-red-900/10 hover:bg-red-50/60 dark:hover:bg-red-900/15 cursor-pointer'
                            : cell.day === selectedDay
                              ? 'bg-seaop-primary-50 dark:bg-seaop-primary-900/20'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer'
                    }`}
                    onClick={() => !calDrag && cell.day !== null && setSelectedDay(cell.day === selectedDay ? null : cell.day)}
                    onKeyDown={(e) => {
                      if (cell.day === null) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedDay(cell.day === selectedDay ? null : cell.day);
                      }
                    }}
                    onMouseEnter={() => {
                      if (calDrag && cell.day !== null) {
                        calDragMoved.current = true;
                        setCalDrag((prev) => prev ? { ...prev, targetDate: cellDateStr } : null);
                      }
                    }}
                  >
                    {cell.day !== null && (
                      <>
                        {/* Numéro semaine ISO (1ère cellule de la rangée seulement) */}
                        {showWeekNum && !isMobile && (
                          <span
                            className="absolute top-0.5 left-0.5 text-[8px] font-mono text-gray-400 dark:text-gray-600 select-none pointer-events-none"
                            aria-hidden="true"
                            title={`Semaine ${weekNum}`}
                          >
                            S{weekNum}
                          </span>
                        )}
                        <div className="flex items-center justify-between mb-0.5">
                          <div className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium ${showWeekNum && !isMobile ? 'ml-3' : ''} ${
                            cell.isToday
                              ? `bg-seaop-primary-600 text-white ${isMobile ? 'w-5 h-5 text-[10px]' : 'w-6 h-6'} rounded-full flex items-center justify-center`
                              : ferieLabel
                                ? 'text-red-700 dark:text-red-300 px-0.5'
                                : 'text-gray-700 dark:text-gray-300 px-0.5'
                          }`}>
                            {cell.day}
                          </div>
                          <div className="flex items-center gap-0.5">
                            {ferieLabel && (
                              <span title={ferieLabel} className="inline-flex">
                                <Flag
                                  size={isMobile ? 10 : 11}
                                  aria-hidden="true"
                                  className="text-red-500 dark:text-red-400 flex-shrink-0"
                                />
                              </span>
                            )}
                            {!isMobile && (
                              <button
                                type="button"
                                className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setQcType('project');
                                  resetQcFields(cellDateStr, 'project');
                                  setQuickCreate({ dateStr: cellDateStr });
                                }}
                                title="Créer un élément"
                                aria-label={`Créer un élément le ${cell.day} ${MONTH_NAMES_FR[month]}`}
                              >
                                <Plus size={12} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Event indicators */}
                        {isMobile ? (
                          /* Mobile: 1-2 labels tronqués + dots résumé */
                          cell.events.length > 0 && (
                            <div className="space-y-0.5 mt-0.5">
                              {cell.events.slice(0, 2).map((ev) => {
                                const evStyle = EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.project;
                                const EvIcon = ICONES_PAR_TYPE[ev.type] || Briefcase;
                                return (
                                  <div
                                    key={ev.id}
                                    className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-snug ${evStyle.bg} ${evStyle.text} truncate`}
                                  >
                                    <EvIcon size={9} aria-hidden="true" className="flex-shrink-0 opacity-80" />
                                    <span className="truncate">{ev.title}</span>
                                  </div>
                                );
                              })}
                              {cell.events.length > 2 && (
                                <div className="flex items-center gap-0.5 px-1">
                                  {cell.events.slice(2, 5).map((ev) => {
                                    const evStyle = EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.project;
                                    return <span aria-hidden="true" key={ev.id} className={`w-1 h-1 rounded-full ${evStyle.dot}`} />;
                                  })}
                                  <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-0.5">+{cell.events.length - 2}</span>
                                </div>
                              )}
                            </div>
                          )
                        ) : (
                          /* Desktop: show event labels with multi-day spanning */
                          <div className="space-y-0.5">
                            {cell.events.slice(0, 4).map((ev) => {
                              const evStyle = EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.project;
                              const EvIcon = ICONES_PAR_TYPE[ev.type] || Briefcase;
                              const sp = ev.spanPos || 'single';
                              const isDraggable = ['project', 'project_start', 'bon_travail', 'devis', 'opportunite', 'bon_commande'].includes(ev.type);
                              const spanCls =
                                sp === 'start' ? 'rounded-l -mr-[5px] pr-0' :
                                sp === 'middle' ? '-mx-[5px] rounded-none' :
                                sp === 'end' ? 'rounded-r -ml-[5px] pl-0' :
                                'rounded';
                              const isDragging = calDrag?.event.id === ev.id;
                              const tooltipText = isDraggable
                                ? `${ev.title} — Glisser pour déplacer, redimensionner par le bord droit, double-clic pour ouvrir`
                                : `${ev.title} — Élément en lecture seule. Double-clic pour ouvrir le détail.`;
                              return (
                                <div
                                  key={`${ev.id}-${sp}`}
                                  title={tooltipText}
                                  className={`flex items-center gap-1 py-0.5 text-[10px] leading-snug ${evStyle.bg} ${evStyle.text} truncate ${spanCls} ${sp === 'start' || sp === 'single' ? 'px-1' : 'px-0'} ${isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer italic'} ${isDragging ? 'opacity-50 ring-1 ring-blue-400' : ''} select-none relative`}
                                  onDoubleClick={(e) => { e.stopPropagation(); navigateToItem(ev); }}
                                  onMouseDown={(e) => {
                                    if (!isDraggable || isMobile) return;
                                    e.stopPropagation();
                                    e.preventDefault();
                                    // Right 6px = resize, rest = move
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const isResizeEdge = (sp === 'end' || sp === 'single') && e.clientX >= rect.right - 6;
                                    calDragMoved.current = false;
                                    setCalDrag({
                                      event: ev,
                                      originDate: cellDateStr,
                                      targetDate: null,
                                      type: isResizeEdge ? 'resize' : 'move',
                                    });
                                  }}
                                >
                                  {(sp === 'start' || sp === 'single') && (
                                    <EvIcon size={9} aria-hidden="true" className="flex-shrink-0 opacity-80" />
                                  )}
                                  {(sp === 'start' || sp === 'single') && (
                                    <span className="truncate">{ev.title}</span>
                                  )}
                                  {/* Resize handle on end/single */}
                                  {isDraggable && (sp === 'end' || sp === 'single') && !isMobile && (
                                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-black/10 rounded-r" />
                                  )}
                                </div>
                              );
                            })}
                            {cell.events.length > 4 && (
                              <span className="text-[10px] text-gray-400 px-1">+{cell.events.length - 4} autres</span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ); })}
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* === VUE SEMAINE === */}
            {viewMode === 'semaine' && (
              <div
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 flex flex-col flex-1 min-h-0"
                role="grid"
                aria-label={`Calendrier semaine ${headerTitle}`}
              >
                {/* Headers semaine */}
                <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-800/50" role="row">
                  {weekGrid.map((d) => {
                    const ferieLabel = getFerieQC(d.dateStr);
                    return (
                    <div
                      key={d.dateStr}
                      role="columnheader"
                      aria-current={d.isToday ? 'date' : undefined}
                      aria-label={ferieLabel ? `${d.dayName} ${d.dayNum}, jour férié : ${ferieLabel}` : undefined}
                      className={`py-2 text-center border-b border-gray-200 dark:border-gray-700 ${
                        d.isToday ? 'bg-seaop-primary-50 dark:bg-seaop-primary-900/20'
                        : ferieLabel ? 'bg-red-50/40 dark:bg-red-900/10' : ''
                      }`}
                      title={ferieLabel || undefined}
                    >
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase flex items-center justify-center gap-1">
                        {d.dayName}
                        {ferieLabel && <Flag size={9} aria-hidden="true" className="text-red-500 dark:text-red-400" />}
                      </div>
                      <div className={`text-sm font-semibold ${
                        d.isToday ? 'text-seaop-primary-600 dark:text-seaop-primary-400'
                        : ferieLabel ? 'text-red-700 dark:text-red-300'
                        : 'text-gray-900 dark:text-white'
                      }`}>
                        {d.dayNum}
                      </div>
                    </div>
                  ); })}
                </div>
                {/* Colonnes événements */}
                <div className="grid grid-cols-7 flex-1 min-h-0 overflow-hidden" role="rowgroup">
                  <div role="row" className="contents">
                  {weekGrid.map((d) => (
                    <div
                      key={d.dateStr}
                      role="gridcell"
                      aria-current={d.isToday ? 'date' : undefined}
                      aria-label={`${d.dayName} ${d.dayNum} ${MONTH_NAMES_FR[d.monthIdx]} ${d.yearNum}${d.events.length > 0 ? `, ${d.events.length} événement${d.events.length > 1 ? 's' : ''}` : ''}`}
                      className={`group border-r border-gray-100 dark:border-gray-800 p-1.5 overflow-y-auto ${
                        d.isToday ? 'bg-seaop-primary-50/30 dark:bg-seaop-primary-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                      }`}
                    >
                      <div className="flex justify-end mb-1">
                        <button
                          type="button"
                          className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                          onClick={() => { setQcType('project'); resetQcFields(d.dateStr, 'project'); setQuickCreate({ dateStr: d.dateStr }); }}
                          title="Créer un élément"
                          aria-label={`Créer un élément le ${d.dayNum} ${MONTH_NAMES_FR[d.monthIdx]}`}
                        >
                          <Plus size={12} aria-hidden="true" />
                        </button>
                      </div>
                      {d.events.length === 0 ? (
                        <p className="text-[10px] text-gray-300 dark:text-gray-600 italic text-center mt-2">—</p>
                      ) : (
                        <div className="space-y-1">
                          {d.events.map((ev) => {
                            const evStyle = EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.project;
                            const EvIcon = ICONES_PAR_TYPE[ev.type] || Briefcase;
                            return (
                              <div
                                key={`${d.dateStr}-${ev.id}`}
                                className={`rounded p-1.5 ${evStyle.bg} cursor-pointer hover:shadow-sm transition-shadow`}
                                onDoubleClick={() => navigateToItem(ev)}
                                onClick={() => navigateToItem(ev)}
                                title={`${ev.title} — Cliquer pour ouvrir`}
                              >
                                <div className="flex items-start gap-1.5">
                                  <EvIcon size={11} aria-hidden="true" className={`flex-shrink-0 mt-0.5 ${evStyle.text}`} />
                                  <div className="min-w-0 flex-1">
                                    <p className={`text-[10px] font-medium ${evStyle.text} truncate leading-snug`}>{ev.title}</p>
                                    {ev.numero && (
                                      <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">{ev.numero}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            )}

            {/* === VUE JOUR === */}
            {viewMode === 'jour' && (() => {
              const dayFerieLabel = getFerieQC(dayView.dateStr);
              const dayWeekNum = getISOWeek(new Date(Date.UTC(dayView.yearNum, dayView.monthIdx, dayView.dayNum)));
              return (
              <div
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 flex flex-col flex-1 min-h-0"
                role="region"
                aria-label={`Calendrier journée ${headerTitle}${dayFerieLabel ? `, jour férié : ${dayFerieLabel}` : ''}`}
                aria-current={dayView.isToday ? 'date' : undefined}
              >
                <div className={`flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 ${
                  dayView.isToday ? 'bg-seaop-primary-50 dark:bg-seaop-primary-900/20'
                  : dayFerieLabel ? 'bg-red-50/40 dark:bg-red-900/10'
                  : 'bg-gray-50 dark:bg-gray-800/50'
                }`}>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase flex items-center gap-2">
                      <span>{dayView.isToday ? "Aujourd'hui" : 'Journée'}</span>
                      <span className="text-gray-400 dark:text-gray-500 font-mono">· Semaine {dayWeekNum}</span>
                      {dayFerieLabel && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-[10px] font-semibold">
                          <Flag size={10} aria-hidden="true" />
                          {dayFerieLabel}
                        </span>
                      )}
                    </p>
                    <p className={`text-base font-semibold ${
                      dayView.isToday ? 'text-seaop-primary-600 dark:text-seaop-primary-400'
                      : dayFerieLabel ? 'text-red-700 dark:text-red-300'
                      : 'text-gray-900 dark:text-white'
                    }`}>
                      {dayView.events.length} événement{dayView.events.length > 1 ? 's' : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setQcType('project'); resetQcFields(dayView.dateStr, 'project'); setQuickCreate({ dateStr: dayView.dateStr }); }}
                  >
                    <Plus size={14} className="mr-1" aria-hidden="true" /> Créer
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {dayView.events.length === 0 ? (
                    <div className="text-center py-12">
                      <Calendar size={40} aria-hidden="true" className="mx-auto text-gray-300 dark:text-gray-700 mb-3" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">Aucun événement ce jour</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Cliquez sur « Créer » pour ajouter un élément</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-w-3xl mx-auto">
                      {dayView.events.map((ev) => {
                        const evStyle = EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.project;
                        const EvIcon = ICONES_PAR_TYPE[ev.type] || Briefcase;
                        return (
                          <div
                            key={ev.id}
                            className={`rounded-lg p-4 ${evStyle.bg} border border-gray-100 dark:border-gray-800 cursor-pointer hover:shadow-md transition-shadow`}
                            onDoubleClick={() => navigateToItem(ev)}
                            onClick={() => navigateToItem(ev)}
                            title="Cliquer pour ouvrir"
                          >
                            <div className="flex items-start gap-3">
                              <div className={`flex-shrink-0 w-9 h-9 rounded-lg ${evStyle.dot}/20 flex items-center justify-center`}>
                                <EvIcon size={18} aria-hidden="true" className={evStyle.text} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={`text-sm font-semibold ${evStyle.text}`}>{ev.title}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{evStyle.label}</p>
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                  {ev.numero && <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{ev.numero}</span>}
                                  {ev.statut && (
                                    <Badge color={getStatusBadgeColor(ev.statut)} size="sm">{ev.statut}</Badge>
                                  )}
                                  {ev.montant !== undefined && ev.montant !== null && (
                                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{formatCurrency(ev.montant)}</span>
                                  )}
                                  {ev.dateDebut && ev.dateFin && ev.dateDebut !== ev.dateFin && (
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                      {ev.dateDebut.substring(0, 10)} → {ev.dateFin.substring(0, 10)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <ArrowRight size={14} className="text-gray-400 dark:text-gray-500 shrink-0 mt-1" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              );
            })()}

            {/* === VUE AGENDA === */}
            {viewMode === 'agenda' && (
              <div
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 flex flex-col flex-1 min-h-0"
                role="region"
                aria-label={`Calendrier agenda ${headerTitle}`}
              >
                <div className="flex-1 overflow-y-auto">
                  <div className="max-w-3xl mx-auto p-3">
                    {agendaView.days.map((d) => (
                      <div key={d.dateStr} className="mb-3 last:mb-0">
                        <div
                          className={`sticky top-0 z-10 px-3 py-2 -mx-3 border-y ${
                            d.isToday
                              ? 'bg-seaop-primary-50 dark:bg-seaop-primary-900/20 border-seaop-primary-200 dark:border-seaop-primary-800'
                              : d.ferieLabel
                                ? 'bg-red-50/60 dark:bg-red-900/15 border-red-200 dark:border-red-900/40'
                                : 'bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[11px] uppercase font-medium ${
                                d.isToday ? 'text-seaop-primary-700 dark:text-seaop-primary-300' : 'text-gray-500 dark:text-gray-400'
                              }`}>
                                {d.dayName}
                              </span>
                              <span className={`text-base font-semibold ${
                                d.isToday ? 'text-seaop-primary-600 dark:text-seaop-primary-400'
                                : d.ferieLabel ? 'text-red-700 dark:text-red-300'
                                : 'text-gray-900 dark:text-white'
                              }`}>
                                {d.dayNum} {MONTH_NAMES_FR[d.monthIdx]}
                              </span>
                              {d.isToday && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-seaop-primary-600 text-white font-semibold">
                                  Aujourd&apos;hui
                                </span>
                              )}
                              {d.ferieLabel && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 inline-flex items-center gap-1 font-semibold">
                                  <Flag size={9} aria-hidden="true" />
                                  {d.ferieLabel}
                                </span>
                              )}
                              {d.events.length > 0 && (
                                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                  · {d.events.length} événement{d.events.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => { setQcType('project'); resetQcFields(d.dateStr, 'project'); setQuickCreate({ dateStr: d.dateStr }); }}
                              className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
                              title={`Créer un élément le ${d.dayNum} ${MONTH_NAMES_FR[d.monthIdx]}`}
                              aria-label={`Créer un élément le ${d.dayNum} ${MONTH_NAMES_FR[d.monthIdx]}`}
                            >
                              <Plus size={14} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 space-y-1.5 pl-2">
                          {d.events.length === 0 ? (
                            <p className="text-xs text-gray-300 dark:text-gray-600 italic py-1 pl-1">Aucun événement</p>
                          ) : (
                            d.events.map((ev) => {
                              const evStyle = EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.project;
                              const EvIcon = ICONES_PAR_TYPE[ev.type] || Briefcase;
                              return (
                                <div
                                  key={`agenda-${d.dateStr}-${ev.id}`}
                                  className={`rounded-lg p-2.5 ${evStyle.bg} border border-gray-100 dark:border-gray-800 cursor-pointer hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-seaop-primary-500`}
                                  onClick={() => navigateToItem(ev)}
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToItem(ev); }
                                  }}
                                  title="Cliquer pour ouvrir"
                                  role="button"
                                  aria-label={`${evStyle.label} : ${ev.title}${ev.numero ? `, ${ev.numero}` : ''}${ev.statut ? `, statut ${ev.statut}` : ''}`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${evStyle.dot}/20 flex items-center justify-center`}>
                                      <EvIcon size={15} aria-hidden="true" className={evStyle.text} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className={`text-sm font-semibold ${evStyle.text} truncate`}>{ev.title}</p>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className="text-[10px] text-gray-500 dark:text-gray-400">{evStyle.label}</span>
                                        {ev.numero && <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{ev.numero}</span>}
                                        {ev.statut && <Badge color={getStatusBadgeColor(ev.statut)} size="sm">{ev.statut}</Badge>}
                                      </div>
                                    </div>
                                    {ev.montant !== undefined && ev.montant !== null && (
                                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 flex-shrink-0 tabular-nums">{formatCurrency(ev.montant)}</span>
                                    )}
                                    <ArrowRight size={14} aria-hidden="true" className="text-gray-400 dark:text-gray-500 shrink-0" />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Desktop: Side panel for selected day (vue Mois uniquement) */}
          {!isMobile && viewMode === 'mois' && selectedDay !== null && (
            <div className="w-72 flex-shrink-0" role="complementary" aria-label="Détails du jour sélectionné">
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {selectedDay} {MONTH_NAMES_FR[month]} {year}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setSelectedDay(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Fermer le panneau de détails"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Aucun evenement</p>
                ) : (
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {selectedDayEvents.map((ev) => {
                      const evStyle = EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.project;
                      const EvIcon = ICONES_PAR_TYPE[ev.type] || Briefcase;
                      return (
                        <div
                          key={ev.id}
                          className={`rounded-lg p-3 ${evStyle.bg} border border-gray-100 dark:border-gray-800 cursor-pointer hover:shadow-md transition-shadow`}
                          onDoubleClick={() => navigateToItem(ev)}
                          title="Double-cliquez pour ouvrir"
                        >
                          <div className="flex items-start gap-2">
                            <EvIcon size={14} aria-hidden="true" className={`flex-shrink-0 mt-0.5 ${evStyle.text}`} />
                            <div className="min-w-0">
                              <p className={`text-sm font-medium ${evStyle.text} truncate`}>{ev.title}</p>
                              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{evStyle.label}</p>
                              {ev.numero && <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{ev.numero}</p>}
                              {ev.statut && (
                                <Badge color={getStatusBadgeColor(ev.statut)} size="sm">{ev.statut}</Badge>
                              )}
                              {ev.montant !== undefined && ev.montant !== null && (
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{formatCurrency(ev.montant)}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      )}

      {/* Mobile: Bottom sheet for selected day (vue Mois uniquement) */}
      {isMobile && viewMode === 'mois' && selectedDay !== null && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setSelectedDay(null)}
            role="presentation"
          >
            <div
              ref={bottomSheetRef}
              className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl border-t border-gray-200 dark:border-gray-700 w-full max-w-lg animate-slide-in-up"
              style={{ maxHeight: '60vh' }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="daysheet-title"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-2 pb-1" aria-hidden="true">
                <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
                <h4 id="daysheet-title" className="text-base font-semibold text-gray-900 dark:text-white">
                  {selectedDay} {MONTH_NAMES_FR[month]} {year}
                </h4>
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                  aria-label="Fermer le panneau de détails"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(60vh - 80px)' }}>
                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">Aucun evenement ce jour</p>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEvents.map((ev) => {
                      const evStyle = EVENT_TYPE_COLORS[ev.type] || EVENT_TYPE_COLORS.project;
                      const EvIcon = ICONES_PAR_TYPE[ev.type] || Briefcase;
                      return (
                        <div
                          key={ev.id}
                          className={`rounded-xl p-4 ${evStyle.bg} border border-gray-100 dark:border-gray-800 active:scale-[0.98] transition-transform`}
                          onClick={() => navigateToItem(ev)}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${evStyle.dot}/20 flex items-center justify-center`}>
                              <EvIcon size={16} aria-hidden="true" className={evStyle.text} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-semibold ${evStyle.text}`}>{ev.title}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{evStyle.label}</p>
                              <div className="flex items-center gap-2 mt-1.5">
                                {ev.statut && (
                                  <Badge color={getStatusBadgeColor(ev.statut)} size="sm">{ev.statut}</Badge>
                                )}
                                {ev.montant !== undefined && ev.montant !== null && (
                                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{formatCurrency(ev.montant)}</span>
                                )}
                              </div>
                            </div>
                            <ArrowRight size={14} className="text-gray-400 shrink-0 mt-1" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      {/* Chat Claude IA — assistant intelligent pour le calendrier */}
      {aiChatOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={closeAiChat} role="presentation" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div
              ref={aiChatModalRef}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl flex flex-col pointer-events-auto"
              style={{ maxHeight: '85vh' }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ai-chat-title"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-seaop-primary-500 to-seaop-primary-600 flex items-center justify-center">
                    <Sparkles size={16} aria-hidden="true" className="text-white" />
                  </div>
                  <div>
                    <h3 id="ai-chat-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                      Assistant Claude — Calendrier
                    </h3>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      Vue {viewMode} · {headerTitle} · {filteredEvents.length} événement{filteredEvents.length > 1 ? 's' : ''} en contexte
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {aiMessages.length > 0 && (
                    <button
                      type="button"
                      onClick={resetAiConversation}
                      className="text-[11px] px-2 py-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
                      title="Effacer la conversation"
                      aria-label="Effacer la conversation"
                    >
                      <RefreshCw size={12} aria-hidden="true" className="inline mr-1" />
                      Nouveau
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeAiChat}
                    className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
                    aria-label="Fermer l'assistant IA"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
                {aiMessages.length === 0 ? (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-seaop-primary-50 dark:bg-seaop-primary-900/30 mb-3">
                      <Sparkles size={20} aria-hidden="true" className="text-seaop-primary-600 dark:text-seaop-primary-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                      Comment puis-je vous aider ?
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                      Posez une question sur les événements visibles
                    </p>
                    <div className="space-y-1.5 max-w-md mx-auto">
                      {[
                        'Quels événements sont en retard ?',
                        'Résume ma charge pour cette période',
                        'Y a-t-il des conflits de planning ?',
                        'Quelles sont les échéances importantes cette semaine ?',
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => { setAiQuestion(suggestion); setTimeout(() => aiInputRef.current?.focus(), 50); }}
                          className="block w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/40 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  aiMessages.map((msg, i) => (
                    <div
                      key={`${msg.timestamp}-${i}`}
                      className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-seaop-primary-100 dark:bg-seaop-primary-900/40 flex items-center justify-center mt-0.5">
                          <Sparkles size={13} aria-hidden="true" className="text-seaop-primary-600 dark:text-seaop-primary-400" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap break-words ${
                          msg.role === 'user'
                            ? 'bg-seaop-primary-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                {aiLoading && (
                  <div className="flex gap-2 justify-start" role="status" aria-live="polite">
                    <span className="sr-only">Claude analyse les événements et prépare une réponse…</span>
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-seaop-primary-100 dark:bg-seaop-primary-900/40 flex items-center justify-center mt-0.5">
                      <Sparkles size={13} aria-hidden="true" className="text-seaop-primary-600 dark:text-seaop-primary-400 animate-pulse" />
                    </div>
                    <div className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-gray-700" aria-hidden="true">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={aiInputRef}
                    value={aiQuestion}
                    onChange={(e) => setAiQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAiSubmit();
                      }
                    }}
                    placeholder="Posez votre question… (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)"
                    rows={2}
                    maxLength={1000}
                    aria-label="Question pour l'assistant Claude"
                    className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-seaop-primary-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={handleAiSubmit}
                    disabled={!aiQuestion.trim() || aiLoading}
                    className="flex-shrink-0 px-4 py-2 text-sm font-medium text-white bg-seaop-primary-600 hover:bg-seaop-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 transition-colors"
                    aria-label="Envoyer la question"
                  >
                    {aiLoading ? '…' : 'Envoyer'}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1.5 gap-2">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">
                    Claude analyse les {Math.min(filteredEvents.length, 50)} événements visibles. Aucune donnée hors de votre tenant.
                  </p>
                  {aiQuestion.length > 800 && (
                    <span
                      className={`text-[10px] font-mono tabular-nums flex-shrink-0 ${
                        aiQuestion.length >= 950
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                      aria-label={`${aiQuestion.length} caractères sur 1000`}
                    >
                      {aiQuestion.length}/1000
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Quick-create popover — formulaires riches par type */}
      {quickCreate && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => { if (!qcSaving) setQuickCreate(null); }} aria-hidden="true" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div
              ref={qcModalRef}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl flex flex-col pointer-events-auto"
              style={{ maxHeight: '90vh' }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="quickcreate-title"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div>
                  <h3 id="quickcreate-title" className="text-base font-semibold text-gray-900 dark:text-white">
                    Créer un{qcType === 'opportunite' ? 'e ' : ' '}{QC_TYPES.find((t) => t.value === qcType)?.label.toLowerCase()}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    pour le {new Date(quickCreate.dateStr + 'T00:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { if (!qcSaving) setQuickCreate(null); }}
                  disabled={qcSaving}
                  className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Fermer le formulaire de création"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              {/* Annonce sr-only chargement listes */}
              <div role="status" aria-live="polite" className="sr-only">
                {qcListsLoading ? 'Chargement des entreprises, projets et fournisseurs…' : ''}
              </div>

              {/* Body scrollable — wrappé dans form pour Enter submit natif */}
              <form
                className="flex-1 overflow-y-auto px-5 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleQuickCreate(false);
                }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Type — toujours visible (1ère case) */}
                  <div className="sm:col-span-2">
                    <label htmlFor="qc-type" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
                    <select
                      id="qc-type"
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500 focus:border-transparent"
                      value={qcType}
                      onChange={(e) => setQcType(e.target.value as typeof qcType)}
                    >
                      {QC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>

                  {/* Nom — pour tous sauf BC */}
                  {qcType !== 'bon_commande' && (
                    <div className="sm:col-span-2">
                      <label htmlFor="qc-nom" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        {qcType === 'project' || qcType === 'devis' ? 'Nom du projet' : 'Nom'} <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="qc-nom"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500 focus:border-transparent"
                        placeholder={qcType === 'project' ? 'Construction maison Tremblay' : qcType === 'opportunite' ? 'Opportunité Brossard' : qcType === 'devis' ? 'Soumission rénovation' : 'BT extérieur — semaine 21'}
                        value={qcNom}
                        onChange={(e) => setQcNom(e.target.value)}
                        maxLength={255}
                        autoFocus
                      />
                    </div>
                  )}

                  {/* Fournisseur — BC uniquement, requis */}
                  {qcType === 'bon_commande' && (
                    <div className="sm:col-span-2">
                      <label htmlFor="qc-supplier" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        Fournisseur <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="qc-supplier"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        value={qcSupplierId}
                        onChange={(e) => setQcSupplierId(e.target.value ? Number(e.target.value) : '')}
                      >
                        <option value="">{qcListsLoading ? 'Chargement…' : 'Sélectionner un fournisseur…'}</option>
                        {qcSuppliers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
                      </select>
                      {!qcListsLoading && qcSuppliers.length === 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                          Aucun fournisseur enregistré. Créez-en un dans Magasin &gt; Fournisseurs avant de créer un bon de commande.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Statut */}
                  <div>
                    <label htmlFor="qc-statut" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Statut</label>
                    <select
                      id="qc-statut"
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                      value={qcStatut}
                      onChange={(e) => setQcStatut(e.target.value)}
                    >
                      {(QC_STATUTS_BY_TYPE[qcType] || []).map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  {/* Priorité — pour tous sauf BC */}
                  {qcType !== 'bon_commande' && (
                    <div>
                      <label htmlFor="qc-priorite" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Priorité</label>
                      <select
                        id="qc-priorite"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        value={qcPriorite}
                        onChange={(e) => setQcPriorite(e.target.value)}
                      >
                        {QC_PRIORITES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Client (entreprise) — projet, opportunité, devis */}
                  {(qcType === 'project' || qcType === 'opportunite' || qcType === 'devis') && (
                    <div className="sm:col-span-2">
                      <label htmlFor="qc-company" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Client (entreprise)</label>
                      <select
                        id="qc-company"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        value={qcCompanyId}
                        onChange={(e) => setQcCompanyId(e.target.value ? Number(e.target.value) : '')}
                      >
                        <option value="">{qcListsLoading ? 'Chargement…' : 'Aucun (saisir directement)'}</option>
                        {qcCompanies.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Projet associé — devis, BT, BC */}
                  {(qcType === 'devis' || qcType === 'bon_travail' || qcType === 'bon_commande') && (
                    <div className="sm:col-span-2">
                      <label htmlFor="qc-project" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Projet associé</label>
                      <select
                        id="qc-project"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        value={qcProjectId}
                        onChange={(e) => setQcProjectId(e.target.value || '')}
                      >
                        <option value="">{qcListsLoading ? 'Chargement…' : 'Aucun projet'}</option>
                        {qcProjects.map((p) => <option key={p.id} value={p.id}>{p.nomProjet}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Date début — projet, BT, opportunité */}
                  {(qcType === 'project' || qcType === 'bon_travail' || qcType === 'opportunite') && (
                    <div>
                      <label htmlFor="qc-date-debut" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        {qcType === 'opportunite' ? 'Date début prévu' : qcType === 'project' ? 'Date début projet' : 'Date début'}
                      </label>
                      <input
                        id="qc-date-debut"
                        type="date"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        value={qcDateDebut}
                        onChange={(e) => {
                          const newStart = e.target.value;
                          setQcDateDebut(newStart);
                          // Si la nouvelle date début est postérieure à la date fin, on reset la fin
                          // pour éviter une plage invalide (newStart > qcDateFin).
                          if (newStart && qcDateFin && newStart > qcDateFin) {
                            setQcDateFin('');
                          }
                        }}
                      />
                    </div>
                  )}

                  {/* Date fin — projet, BT, devis */}
                  {(qcType === 'project' || qcType === 'bon_travail' || qcType === 'devis') && (
                    <div>
                      <label htmlFor="qc-date-fin" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date fin</label>
                      <input
                        id="qc-date-fin"
                        type="date"
                        min={qcDateDebut || undefined}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        value={qcDateFin}
                        onChange={(e) => setQcDateFin(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Date échéance / clôture / livraison / prévu — selon type */}
                  <div>
                    <label htmlFor="qc-date-echeance" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {qcType === 'opportunite' ? 'Date clôture prévue'
                        : qcType === 'devis' ? 'Date prévue'
                        : qcType === 'bon_commande' ? 'Date livraison prévue'
                        : qcType === 'bon_travail' ? 'Date d’échéance'
                        : 'Date prévue'}
                    </label>
                    <input
                      id="qc-date-echeance"
                      type="date"
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                      value={qcDateEcheance}
                      onChange={(e) => setQcDateEcheance(e.target.value)}
                    />
                  </div>

                  {/* Montant estimé / budget — projet, opportunité, devis */}
                  {(qcType === 'project' || qcType === 'opportunite' || qcType === 'devis') && (
                    <div>
                      <label htmlFor="qc-montant" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        {qcType === 'project' ? 'Budget total ($)' : qcType === 'opportunite' ? 'Montant estimé ($)' : 'Prix estimé ($)'}
                      </label>
                      <input
                        id="qc-montant"
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        placeholder="0.00"
                        value={qcMontantEstime}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!raw) { setQcMontantEstime(''); return; }
                          const n = Number(raw);
                          // Rejette NaN/Infinity et clamp >= 0
                          if (!Number.isFinite(n)) return;
                          setQcMontantEstime(Math.max(0, n));
                        }}
                      />
                    </div>
                  )}

                  {/* Probabilité — opportunité uniquement */}
                  {qcType === 'opportunite' && (
                    <div>
                      <label htmlFor="qc-probabilite" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Probabilité (%)</label>
                      <input
                        id="qc-probabilite"
                        type="number"
                        min="0"
                        max="100"
                        step="5"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        placeholder="50"
                        value={qcProbabilite}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!raw) { setQcProbabilite(''); return; }
                          const n = Number(raw);
                          if (!Number.isFinite(n)) return;
                          setQcProbabilite(Math.max(0, Math.min(100, n)));
                        }}
                      />
                    </div>
                  )}

                  {/* Source — opportunité uniquement */}
                  {qcType === 'opportunite' && (
                    <div>
                      <label htmlFor="qc-source" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Source</label>
                      <select
                        id="qc-source"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        value={qcSource}
                        onChange={(e) => setQcSource(e.target.value)}
                      >
                        <option value="">—</option>
                        {QC_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Type soumission — devis uniquement */}
                  {qcType === 'devis' && (
                    <div>
                      <label htmlFor="qc-type-soum" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type soumission</label>
                      <select
                        id="qc-type-soum"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        value={qcTypeSoumission}
                        onChange={(e) => setQcTypeSoumission(e.target.value as 'Détaillée' | 'Budgétaire')}
                      >
                        <option value="Détaillée">Détaillée</option>
                        <option value="Budgétaire">Budgétaire</option>
                      </select>
                    </div>
                  )}

                  {/* PO Client — projet, opportunité, devis */}
                  {(qcType === 'project' || qcType === 'opportunite' || qcType === 'devis') && (
                    <div>
                      <label htmlFor="qc-po" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">PO Client</label>
                      <input
                        id="qc-po"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        placeholder="PO-2026-001"
                        value={qcPoClient}
                        onChange={(e) => setQcPoClient(e.target.value)}
                        maxLength={100}
                      />
                    </div>
                  )}

                  {/* Adresse chantier — projet uniquement */}
                  {qcType === 'project' && (
                    <div className="sm:col-span-2">
                      <label htmlFor="qc-adresse" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Adresse chantier</label>
                      <input
                        id="qc-adresse"
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500"
                        placeholder="123 rue Principale, Brossard, QC"
                        value={qcAdresseChantier}
                        onChange={(e) => setQcAdresseChantier(e.target.value)}
                        maxLength={255}
                      />
                    </div>
                  )}

                  {/* Description — projet, opportunité, devis */}
                  {(qcType === 'project' || qcType === 'opportunite' || qcType === 'devis') && (
                    <div className="sm:col-span-2">
                      <label htmlFor="qc-description" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
                      <textarea
                        id="qc-description"
                        rows={2}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500 resize-none"
                        placeholder="Description courte…"
                        value={qcDescription}
                        onChange={(e) => setQcDescription(e.target.value)}
                        maxLength={2000}
                      />
                    </div>
                  )}

                  {/* Notes — tous types */}
                  <div className="sm:col-span-2">
                    <label htmlFor="qc-notes" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                    <textarea
                      id="qc-notes"
                      rows={2}
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-seaop-primary-500 resize-none"
                      placeholder="Instructions, détails supplémentaires…"
                      value={qcNotes}
                      onChange={(e) => setQcNotes(e.target.value)}
                      maxLength={2000}
                    />
                  </div>
                </div>
                {/* Submit caché pour activer Enter submit dans le form */}
                <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Créer</button>
              </form>

              {/* Footer avec actions */}
              <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 flex-wrap">
                <p className="text-[10px] text-gray-400 dark:text-gray-500 hidden sm:block">
                  {qcType === 'bon_travail'
                    ? 'Création + ouverture page détail pour ajouter opérations/produits.'
                    : '« Plus de détails » crée et ouvre la page complète.'}
                </p>
                <div className="flex items-center gap-2 ml-auto">
                  {/* Indication a11y pour lecteurs d'écran quand boutons disabled */}
                  <span id="qc-submit-help" className="sr-only" role="status" aria-live="polite">
                    {qcSaving ? 'Création en cours…' :
                      (qcType === 'bon_commande' && (typeof qcSupplierId !== 'number' || qcSupplierId <= 0)) ? 'Sélectionnez un fournisseur pour activer la création.' :
                      (qcType !== 'bon_commande' && qcType !== 'bon_travail' && !qcNom.trim()) ? 'Saisissez un nom pour activer la création.' : ''}
                  </span>
                  <button
                    type="button"
                    className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 rounded"
                    onClick={() => setQuickCreate(null)}
                    disabled={qcSaving}
                  >
                    Annuler
                  </button>
                  {qcType !== 'bon_travail' && (
                    <button
                      type="button"
                      className="px-3 py-1.5 text-sm font-medium text-seaop-primary-700 dark:text-seaop-primary-300 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/30 rounded-lg disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
                      disabled={qcSaving || (qcType !== 'bon_commande' && !qcNom.trim()) || (qcType === 'bon_commande' && (typeof qcSupplierId !== 'number' || qcSupplierId <= 0))}
                      aria-describedby="qc-submit-help"
                      onClick={() => handleQuickCreate(true)}
                      title="Créer puis ouvrir la page complète"
                    >
                      Plus de détails →
                    </button>
                  )}
                  <button
                    type="button"
                    className="px-4 py-1.5 text-sm font-medium text-white bg-seaop-primary-600 hover:bg-seaop-primary-700 rounded-lg disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500"
                    disabled={qcSaving || (qcType !== 'bon_commande' && qcType !== 'bon_travail' && !qcNom.trim()) || (qcType === 'bon_commande' && (typeof qcSupplierId !== 'number' || qcSupplierId <= 0))}
                    aria-describedby="qc-submit-help"
                    onClick={() => handleQuickCreate(false)}
                  >
                    {qcSaving ? 'Création…' : 'Créer'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
