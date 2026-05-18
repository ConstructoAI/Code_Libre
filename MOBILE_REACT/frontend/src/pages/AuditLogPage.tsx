/**
 * Mobile React Frontend - Journal d'audit (Phase 5D)
 *
 * Conformite Loi 25 Quebec + GDPR : visualisation des evenements d'audit
 * (qui a fait quoi, quand, sur quelle entite). Visible uniquement pour le
 * role ADMIN. require_role cote serveur (defense en profondeur).
 *
 * UX :
 *  - Touch targets >= 44 px
 *  - Pas d'emojis
 *  - Francais Quebec
 *  - Pas de any TS
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { formatDateTime } from '@/utils/format';
import { listAuditEvents } from '@/api/audit';
import { extractApiError } from '@/types/api';
import { useAuthStore } from '@/store/useAuthStore';
import type { AuditEvent, AuditEventsResponse } from '@/types';

const ENTITY_TYPES = [
  { value: '', label: 'Toutes les entites' },
  { value: 'facture', label: 'Factures' },
  { value: 'devis', label: 'Devis' },
  { value: 'bons-travail', label: 'Bons de travail' },
  { value: 'bons-commande', label: 'Bons de commande' },
  { value: 'auth', label: 'Authentification' },
  { value: 'attachment', label: 'Pieces jointes' },
];

const ACTIONS = [
  { value: '', label: 'Toutes les actions' },
  { value: 'create', label: 'Creation' },
  { value: 'update', label: 'Modification' },
  { value: 'delete', label: 'Suppression' },
  { value: 'login', label: 'Connexion' },
  { value: 'sign', label: 'Signature' },
  { value: 'email_sent', label: 'Envoi courriel' },
  { value: 'payment_received', label: 'Paiement recu' },
];

const ACTION_LABELS: Record<string, string> = {
  create: 'Creation',
  update: 'Modification',
  delete: 'Suppression',
  login: 'Connexion',
  sign: 'Signature',
  email_sent: 'Envoi courriel',
  payment_received: 'Paiement recu',
};

const ACTION_STYLES: Record<string, string> = {
  create: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800',
  update: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
  delete: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
  login: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800',
  sign: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
  email_sent: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-300 dark:border-cyan-800',
  payment_received: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
};

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);

  const [data, setData] = useState<AuditEventsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtres
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const resp = await listAuditEvents({
        entityType: entityType || undefined,
        action: action || undefined,
        since: since ? new Date(since).toISOString() : undefined,
        until: until ? new Date(until + 'T23:59:59').toISOString() : undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(resp);
    } catch (err) {
      setError(extractApiError(err, 'Impossible de charger le journal d audit'));
    } finally {
      setIsLoading(false);
    }
  }, [entityType, action, since, until, offset]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetFilters = () => {
    setEntityType('');
    setAction('');
    setSince('');
    setUntil('');
    setOffset(0);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Garde-fou client : si le user n est pas ADMIN, on n affiche rien
  // (le serveur renverra 403 de toute facon via require_role)
  if (role !== 'ADMIN') {
    return (
      <div className="px-4 py-8 text-center">
        <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          Acces refuse
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Le journal d audit est reserve aux administrateurs.
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate('/')}
          className="mt-4"
        >
          Retour
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Retour"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Journal d audit
          </h1>
        </div>
        <button
          onClick={() => void loadData()}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
          aria-label="Actualiser"
        >
          <RefreshCw
            className={`w-5 h-5 text-gray-600 dark:text-gray-400 ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {error && (
        <Alert type="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Filtres */}
      <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <Search className="w-4 h-4" />
          Filtres
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FilterSelect
            label="Entite"
            value={entityType}
            onChange={(v) => {
              setEntityType(v);
              setOffset(0);
            }}
            options={ENTITY_TYPES}
          />
          <FilterSelect
            label="Action"
            value={action}
            onChange={(v) => {
              setAction(v);
              setOffset(0);
            }}
            options={ACTIONS}
          />
          <FilterDate
            label="Depuis"
            value={since}
            onChange={(v) => {
              setSince(v);
              setOffset(0);
            }}
          />
          <FilterDate
            label="Jusqu au"
            value={until}
            onChange={(v) => {
              setUntil(v);
              setOffset(0);
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {data ? `${data.total} evenement${data.total !== 1 ? 's' : ''}` : '...'}
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={resetFilters}
            disabled={isLoading || (!entityType && !action && !since && !until && offset === 0)}
          >
            Reinitialiser
          </Button>
        </div>
      </div>

      {/* Loader initial */}
      {isLoading && !data && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {/* Liste vide */}
      {data && data.events.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            Aucun evenement
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Aucun evenement ne correspond aux filtres selectionnes.
          </p>
        </div>
      )}

      {/* Liste */}
      {data && data.events.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.events.map((event) => (
              <AuditEventRow
                key={event.id}
                event={event}
                expanded={expandedId === event.id}
                onToggle={() =>
                  setExpandedId((prev) => (prev === event.id ? null : event.id))
                }
              />
            ))}
          </ul>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || isLoading}
          >
            Precedent
          </Button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Page {currentPage} / {totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= data.total || isLoading}
          >
            Suivant
          </Button>
        </div>
      )}
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 min-h-[44px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface FilterDateProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function FilterDate({ label, value, onChange }: FilterDateProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-base text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 focus:border-seaop-primary-500 min-h-[44px]"
      />
    </label>
  );
}

interface AuditEventRowProps {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
}

function AuditEventRow({ event, expanded, onToggle }: AuditEventRowProps) {
  const actionLabel = ACTION_LABELS[event.action] ?? event.action;
  const actionStyle =
    ACTION_STYLES[event.action] ??
    'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600';

  const hasDetails = useMemo(
    () =>
      Boolean(
        event.beforeData ||
          event.afterData ||
          event.metadata ||
          event.ipAddress ||
          event.userAgent,
      ),
    [event],
  );

  return (
    <li className="px-4 py-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasDetails}
        className="w-full text-left flex items-start gap-3 min-h-[44px] disabled:cursor-default"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${actionStyle}`}
            >
              {actionLabel}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {event.entityType}
              {event.entityId !== null && ` #${event.entityId}`}
            </span>
            {event.entityLabel && (
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                {event.entityLabel}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <User className="w-3 h-3" />
            <span className="truncate">
              {event.employeeName || (event.employeeId ? `Employe #${event.employeeId}` : 'Systeme')}
            </span>
            <span className="text-gray-400 dark:text-gray-500">·</span>
            <span>{formatDateTime(event.createdAt)}</span>
          </div>
        </div>
        {hasDetails &&
          (expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 mt-1" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-1" />
          ))}
      </button>

      {expanded && hasDetails && (
        <div className="mt-3 space-y-2 text-xs border-t border-gray-100 dark:border-gray-700 pt-3">
          {(event.ipAddress || event.userAgent) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-gray-600 dark:text-gray-400">
              {event.ipAddress && (
                <span>
                  <strong className="text-gray-700 dark:text-gray-300">IP : </strong>
                  {event.ipAddress}
                </span>
              )}
              {event.userAgent && (
                <span className="truncate max-w-full">
                  <strong className="text-gray-700 dark:text-gray-300">UA : </strong>
                  <span className="break-all">{event.userAgent}</span>
                </span>
              )}
            </div>
          )}

          {event.metadata && (
            <JsonBlock title="Contexte" data={event.metadata} />
          )}
          {event.beforeData && (
            <JsonBlock title="Avant" data={event.beforeData} />
          )}
          {event.afterData && (
            <JsonBlock title="Apres" data={event.afterData} />
          )}
        </div>
      )}
    </li>
  );
}

interface JsonBlockProps {
  title: string;
  data: Record<string, unknown>;
}

function JsonBlock({ title, data }: JsonBlockProps) {
  let serialized: string;
  try {
    serialized = JSON.stringify(data, null, 2);
  } catch {
    serialized = '[unserializable]';
  }
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
        {title}
      </p>
      <pre className="bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-x-auto text-[11px] text-gray-800 dark:text-gray-200 max-h-64 overflow-y-auto">
        {serialized}
      </pre>
    </div>
  );
}
