/**
 * TimeHistorySection - Historique et résumé hebdomadaire des pointages.
 *
 * Composant integre dans PunchPage (anciennement HistoryPage standalone).
 * Affiche 2 onglets : Historique (liste groupee par date) et Resume hebdo
 * (graphique heures + heures supp.).
 */

import React, { useState, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Check, Clock, Pencil, Trash2, Save, X } from 'lucide-react';
import { usePunchStore } from '@/store/usePunchStore';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { WeatherBadge } from '@/components/ui/WeatherBadge';
import { useConfirm } from '@/hooks/useConfirm';
import { formatDate, formatTime, formatHours } from '@/utils/format';
import { OVERTIME_DAILY, OVERTIME_WEEKLY } from '@/utils/constants';
import type { TimeEntry } from '@/types';

type Tab = 'history' | 'weekly';

function groupByDate(entries: TimeEntry[]): Map<string, TimeEntry[]> {
  const groups = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const dateKey = entry.punchIn.slice(0, 10);
    const group = groups.get(dateKey);
    if (group) {
      group.push(entry);
    } else {
      groups.set(dateKey, [entry]);
    }
  }
  return groups;
}

const TimeHistorySection: React.FC = () => {
  const history = usePunchStore((s) => s.history);
  const weeklySummary = usePunchStore((s) => s.weeklySummary);
  const isLoading = usePunchStore((s) => s.isLoading);
  const fetchHistory = usePunchStore((s) => s.fetchHistory);
  const fetchWeeklySummary = usePunchStore((s) => s.fetchWeeklySummary);
  const updateEntry = usePunchStore((s) => s.updateEntry);
  const deleteEntry = usePunchStore((s) => s.deleteEntry);

  const [activeTab, setActiveTab] = useState<Tab>('history');
  const [weekOffset, setWeekOffset] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { confirm, element: confirmElement } = useConfirm();
  const [editNotes, setEditNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (activeTab === 'weekly') {
      fetchWeeklySummary(weekOffset);
    }
  }, [activeTab, weekOffset, fetchWeeklySummary]);

  const grouped = groupByDate(history);

  const maxDayHours =
    weeklySummary && weeklySummary.jours.length > 0
      ? Math.max(OVERTIME_DAILY, ...weeklySummary.jours.map((j) => j.totalHours))
      : OVERTIME_DAILY;

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 mt-4">
          <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mt-4">
          Mes heures
        </h2>
      </div>

      {/* Tab bar */}
      <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'history'
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          Historique
        </button>
        <button
          onClick={() => setActiveTab('weekly')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'weekly'
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          Résumé hebdo
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-10">
          <Spinner size="lg" />
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && !isLoading && (
        <div className="space-y-4">
          {history.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-10">
              Aucun pointage enregistré.
            </p>
          ) : (
            Array.from(grouped.entries()).map(([dateKey, entries]) => (
              <div key={dateKey}>
                <div className="bg-white/80 dark:bg-gray-900 backdrop-blur-sm -mx-4 px-4 py-2 mb-2 border-b border-gray-200 dark:border-gray-700">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {formatDate(dateKey)}
                  </p>
                </div>

                <div className="space-y-2">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 dark:text-white truncate">
                            BT {entry.numeroBt ?? '--'}
                          </p>
                          {entry.projectNom && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                              {entry.projectNom}
                            </p>
                          )}
                          {entry.operationNom && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 truncate">
                              {entry.operationNom}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 shrink-0">
                          {entry.isBilled ? (
                            <Badge variant="info" title="Pointage déjà facturé, verrouillé en édition">
                              Facturé
                            </Badge>
                          ) : entry.validated ? (
                            <Badge variant="success" title={
                              entry.validatedBy
                                ? `Validé par ${entry.validatedBy}${entry.validatedAt ? ` le ${formatDate(entry.validatedAt)}` : ''}`
                                : undefined
                            }>
                              <Check className="h-3 w-3" />
                              Validé
                            </Badge>
                          ) : (
                            <>
                              <button
                                onClick={() => { setEditingId(entry.id); setEditNotes(entry.notes || ''); }}
                                className="p-2 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                title="Modifier"
                                aria-label="Modifier le pointage"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={async () => {
                                  const ok = await confirm({
                                    message: 'Supprimer ce pointage ?',
                                    variant: 'danger',
                                    confirmLabel: 'Supprimer',
                                  });
                                  if (!ok) return;
                                  setActionLoading(true);
                                  try { await deleteEntry(entry.id); } catch { /* error in store */ }
                                  setActionLoading(false);
                                }}
                                disabled={actionLoading}
                                className="p-2 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none"
                                title="Supprimer"
                                aria-label="Supprimer le pointage"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                          <span>{formatTime(entry.punchIn)}</span>
                          <span className="text-gray-400">-</span>
                          <span>
                            {entry.punchOut ? formatTime(entry.punchOut) : 'En cours'}
                          </span>
                        </div>
                        {entry.totalHours !== null && (
                          <span className="ml-auto font-semibold text-gray-900 dark:text-white">
                            {formatHours(entry.totalHours)}
                          </span>
                        )}
                      </div>

                      {(entry.weatherIn || entry.weatherOut) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {entry.weatherIn && (
                            <WeatherBadge weather={entry.weatherIn} variant="compact" />
                          )}
                          {entry.weatherOut && entry.punchOut && (
                            <>
                              <span
                                className="text-gray-300 dark:text-gray-600 text-xs"
                                aria-hidden
                              >
                                →
                              </span>
                              <WeatherBadge weather={entry.weatherOut} variant="compact" />
                            </>
                          )}
                        </div>
                      )}

                      {editingId === entry.id ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            rows={2}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                            placeholder="Notes..."
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                setActionLoading(true);
                                try { await updateEntry(entry.id, editNotes); setEditingId(null); } catch { /* error in store */ }
                                setActionLoading(false);
                              }}
                              disabled={actionLoading}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 min-h-[36px]"
                            >
                              <Save className="h-3.5 w-3.5" /> Sauvegarder
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 min-h-[36px]"
                            >
                              <X className="h-3.5 w-3.5" /> Annuler
                            </button>
                          </div>
                        </div>
                      ) : entry.notes ? (
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                          {entry.notes}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* WEEKLY SUMMARY TAB */}
      {activeTab === 'weekly' && !isLoading && weeklySummary && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200
                dark:text-gray-300 dark:hover:bg-gray-800 dark:active:bg-gray-700 min-h-[44px] min-w-[44px]
                flex items-center justify-center"
              aria-label="Semaine précédente"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {formatDate(weeklySummary.semaineDu)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                au {formatDate(weeklySummary.semaineAu)}
              </p>
            </div>
            <button
              onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
              disabled={weekOffset === 0}
              className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200
                dark:text-gray-300 dark:hover:bg-gray-800 dark:active:bg-gray-700 min-h-[44px] min-w-[44px]
                flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none"
              aria-label="Semaine suivante"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div
            className={`rounded-xl p-5 text-center ${
              weeklySummary.isOvertimeWeek
                ? 'bg-orange-50 border border-orange-200 dark:bg-orange-900/20 dark:border-orange-800'
                : 'bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
            }`}
          >
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
              Total de la semaine
            </p>
            <p
              className={`text-4xl font-bold ${
                weeklySummary.isOvertimeWeek
                  ? 'text-orange-700 dark:text-orange-300'
                  : 'text-blue-700 dark:text-blue-300'
              }`}
            >
              {formatHours(weeklySummary.totalHours)}
            </p>
            {weeklySummary.isOvertimeWeek && weeklySummary.overtimeHours > 0 && (
              <Badge variant="warning" className="mt-2">
                +{formatHours(weeklySummary.overtimeHours)} supp. (&gt;{OVERTIME_WEEKLY}h)
              </Badge>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Détail par jour
            </h3>

            {weeklySummary.jours.length === 0 ? (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">
                Aucune donnée pour cette semaine.
              </p>
            ) : (
              weeklySummary.jours.map((day) => {
                const barPercent = maxDayHours > 0
                  ? Math.min(100, (day.totalHours / maxDayHours) * 100)
                  : 0;
                const overtimeThresholdPercent =
                  maxDayHours > 0
                    ? Math.min(100, (OVERTIME_DAILY / maxDayHours) * 100)
                    : 100;

                return (
                  <div key={day.date} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700 dark:text-gray-300 capitalize w-12">
                        {day.jour.slice(0, 3)}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-semibold ${
                            day.isOvertime
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-gray-900 dark:text-white'
                          }`}
                        >
                          {formatHours(day.totalHours)}
                        </span>
                        {day.isOvertime && (
                          <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                            Supp.
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="relative h-3 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      {overtimeThresholdPercent < 100 && (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-gray-400 dark:bg-gray-500 z-10"
                          style={{ left: `${overtimeThresholdPercent}%` }}
                        />
                      )}
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          day.isOvertime
                            ? 'bg-orange-500 dark:bg-orange-400'
                            : 'bg-blue-500 dark:bg-blue-400'
                        }`}
                        style={{ width: `${barPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 pt-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 dark:bg-blue-400" />
              Régulier
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500 dark:bg-orange-400" />
              Supplémentaire
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-px w-3 bg-gray-400 dark:bg-gray-500" />
              {OVERTIME_DAILY}h
            </div>
          </div>
        </div>
      )}

      {activeTab === 'weekly' && !isLoading && !weeklySummary && (
        <p className="text-center text-gray-500 dark:text-gray-400 py-10">
          Aucune donnée disponible.
        </p>
      )}
      {confirmElement}
    </div>
  );
};

TimeHistorySection.displayName = 'TimeHistorySection';

export default TimeHistorySection;
