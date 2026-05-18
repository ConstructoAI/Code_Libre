/**
 * Mobile React Frontend - Dashboard Page
 * Mobile-first dashboard with quick action cards and punch status.
 * French-Canadian, 44px min tap targets.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  Users,
  MessageSquare,
  FolderOpen,
  Bot,
  FileText,
  CloudSun,
  ChevronRight,
  MapPin,
  Calculator,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { usePunchStore } from '@/store/usePunchStore';
import { useMessagesStore } from '@/store/useMessagesStore';
import { Alert } from '@/components/ui/Alert';
import { formatElapsedMinutes } from '@/utils/format';

interface QuickAction {
  label: string;
  icon: React.ReactNode;
  path: string;
  badge?: number;
  color: string;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const employee = useAuthStore((s) => s.employee);
  const { status, weeklySummary, error, fetchStatus, fetchWeeklySummary, clearError } = usePunchStore();
  const { unread, fetchUnread } = useMessagesStore();

  useEffect(() => {
    fetchStatus();
    fetchWeeklySummary(0);
    fetchUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Current date formatted
  const today = new Date().toLocaleDateString('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const quickActions: QuickAction[] = [
    {
      label: 'Pointage',
      icon: <Clock className="w-5 h-5" />,
      path: '/pointage',
      color: 'bg-blue-500',
    },
    {
      label: 'Équipe',
      icon: <Users className="w-5 h-5" />,
      path: '/equipe',
      color: 'bg-emerald-500',
    },
    {
      label: 'Messages',
      icon: <MessageSquare className="w-5 h-5" />,
      path: '/messages',
      badge: unread.totalUnread > 0 ? unread.totalUnread : undefined,
      color: 'bg-purple-500',
    },
    {
      label: 'Dossiers',
      icon: <FolderOpen className="w-5 h-5" />,
      path: '/dossiers',
      color: 'bg-amber-500',
    },
    {
      label: 'Documents',
      icon: <FileText className="w-5 h-5" />,
      path: '/documents',
      color: 'bg-indigo-500',
    },
    {
      label: 'Météo',
      icon: <CloudSun className="w-5 h-5" />,
      path: '/meteo',
      color: 'bg-sky-500',
    },
    {
      label: 'Assistant IA',
      icon: <Bot className="w-5 h-5" />,
      path: '/assistant',
      color: 'bg-seaop-primary-500',
    },
    {
      label: 'Calculatrice',
      icon: <Calculator className="w-5 h-5" />,
      path: '/calculatrice',
      color: 'bg-rose-500',
    },
  ];

  return (
    <div className="px-4 py-5 space-y-4 pb-24">
      {/* Error */}
      {error && (
        <Alert type="error" onDismiss={clearError}>
          {error}
        </Alert>
      )}

      {/* ── Greeting ──────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          Bonjour, {employee?.prenom || 'Employé'}!
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 capitalize">
          {today}
        </p>
      </div>

      {/* ── Punch Status Card ─────────────────────────────── */}
      <button
        onClick={() => navigate('/pointage')}
        className="mobile-card w-full bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-white/60 dark:border-gray-700 p-4 text-left active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center ${
                status?.isPunchedIn
                  ? 'bg-green-100 dark:bg-green-900/30'
                  : 'bg-gray-100 dark:bg-gray-700'
              }`}
            >
              <Clock
                className={`w-6 h-6 ${
                  status?.isPunchedIn
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">
                {status?.isPunchedIn ? 'En service' : 'Hors service'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {status?.isPunchedIn && status.elapsedMinutes != null
                  ? `Depuis ${formatElapsedMinutes(status.elapsedMinutes)}`
                  : 'Aucun pointage actif'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status?.isPunchedIn && (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
            )}
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </div>
        </div>

        {status?.isPunchedIn && status.activeEntry?.projectNom && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
              {status.activeEntry.projectNom}
              {status.activeEntry.numeroBt && ` - ${status.activeEntry.numeroBt}`}
            </p>
          </div>
        )}
      </button>

      {/* ── Quick Stats Row ───────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-white/60 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">
            Heures cette semaine
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {weeklySummary ? `${(weeklySummary.totalHours ?? 0).toFixed(1)}h` : '--'}
          </p>
        </div>
        <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-white/60 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">
            Messages non lus
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {unread.totalUnread}
          </p>
        </div>
      </div>

      {/* ── Quick Action Grid ─────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Actions rapides
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {quickActions.map((action) => (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              className="mobile-card bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-white/60 dark:border-gray-700 p-2 flex flex-col items-center gap-1.5 min-h-[44px] active:scale-[0.97] transition-transform text-center"
            >
              <div className="relative">
                <div
                  className={`w-9 h-9 rounded-lg ${action.color} flex items-center justify-center text-white shadow-sm`}
                >
                  {action.icon}
                </div>
                {action.badge != null && action.badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 shadow">
                    {action.badge > 99 ? '99+' : action.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 leading-tight line-clamp-2">
                {action.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
