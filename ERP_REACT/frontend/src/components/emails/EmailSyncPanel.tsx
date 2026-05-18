/**
 * Synchronisation IMAP — port de _render_sync (modules/email_manager/email_ui.py).
 * 3 boutons (new / 50 derniers / tous) + historique.
 */

import { useEffect, useState } from 'react';
import {
  RefreshCw, Inbox, Download, AlertCircle, Check, X, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { useEmailsStore } from '@/store/useEmailsStore';
import type { SyncMode } from '@/api/emails';

export function EmailSyncPanel() {
  const {
    accounts, syncHistory, isSyncing, error, successMessage,
    fetchAccounts, syncAccount, syncAllAccounts, fetchSyncHistory,
    clearError, clearSuccess,
  } = useEmailsStore();

  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    fetchAccounts();
    fetchSyncHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSyncAll = async (mode: SyncMode) => {
    if (mode === 'all' && !confirmAll) {
      setConfirmAll(true);
      return;
    }
    setConfirmAll(false);
    await syncAllAccounts(mode);
    await fetchSyncHistory();
  };

  const handleSyncOne = async (id: number, mode: SyncMode) => {
    await syncAccount(id, mode);
    await fetchSyncHistory();
  };

  // Aligne avec le filtre backend `(provider IS NULL OR provider <> 'INTERNAL')`
  // dans sync_all_accounts. Les comptes restaures par restoreLegacyAccounts
  // peuvent avoir provider=NULL (tenants tres anciens).
  const externalAccounts = accounts.filter(
    (a) => (!a.provider || a.provider !== 'INTERNAL') && a.active !== false,
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Synchronisation
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Recevoir les emails IMAP depuis vos comptes externes
        </p>
      </div>

      {error && <Alert type="error" onClose={clearError}>{error}</Alert>}
      {successMessage && (
        <Alert type="success" onClose={clearSuccess}>{successMessage}</Alert>
      )}

      {/* Boutons sync globale */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <p className="text-sm font-medium mb-3 text-gray-900 dark:text-white">
          Synchroniser tous les comptes
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Button
            variant="outline"
            onClick={() => handleSyncAll('new')}
            disabled={isSyncing || externalAccounts.length === 0}
          >
            {isSyncing ? <Spinner size="sm" /> : <Inbox size={14} className="mr-1" />}
            Nouveaux uniquement
          </Button>
          <Button
            onClick={() => handleSyncAll('recent')}
            disabled={isSyncing || externalAccounts.length === 0}
          >
            {isSyncing ? <Spinner size="sm" /> : <Download size={14} className="mr-1" />}
            50 derniers emails
          </Button>
          <Button
            variant={confirmAll ? 'danger' : 'outline'}
            onClick={() => handleSyncAll('all')}
            disabled={isSyncing || externalAccounts.length === 0}
          >
            {isSyncing ? <Spinner size="sm" /> : <AlertCircle size={14} className="mr-1" />}
            {confirmAll ? 'Confirmer ?' : 'Tous (max 200)'}
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          - <strong>Nouveaux</strong>: emails non lus depuis la derniere sync.
          <br />
          - <strong>50 derniers</strong>: rattrapage initial (lus + non lus).
          <br />
          - <strong>Tous</strong>: maximum 200 emails par compte (relancer si plus).
        </p>
        {externalAccounts.length === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
            Aucun compte IMAP/OAuth configure. La synchronisation ne s'applique
            pas au compte interne.
          </p>
        )}
      </div>

      {/* Sync individuel */}
      {externalAccounts.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <p className="text-sm font-medium px-4 py-3 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
            Synchroniser un compte specifique
          </p>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {externalAccounts.map((acc) => (
              <div
                key={acc.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {acc.accountName || acc.emailAddress}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {acc.emailAddress}
                    {acc.lastSyncAt && (
                      <> -- derniere: {acc.lastSyncAt}</>
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSyncOne(acc.id, 'new')}
                  disabled={isSyncing}
                >
                  {isSyncing ? <Spinner size="sm" /> : <RefreshCw size={12} className="mr-1" />}
                  Nouveaux
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSyncOne(acc.id, 'recent')}
                  disabled={isSyncing}
                >
                  {isSyncing ? <Spinner size="sm" /> : <Download size={12} className="mr-1" />}
                  50 derniers
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historique */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Historique des synchronisations
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchSyncHistory}
          >
            <RefreshCw size={12} className="mr-1" /> Actualiser
          </Button>
        </div>
        {syncHistory.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-500">
            Aucune synchronisation enregistree
          </p>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
            {syncHistory.map((log) => (
              <div key={log.id} className="px-4 py-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  {log.syncStatus === 'SUCCESS' && (
                    <Badge color="green" size="sm">
                      <Check size={10} className="mr-0.5" /> OK
                    </Badge>
                  )}
                  {log.syncStatus === 'ERROR' && (
                    <Badge color="red" size="sm">
                      <X size={10} className="mr-0.5" /> Erreur
                    </Badge>
                  )}
                  {log.syncStatus === 'RUNNING' && (
                    <Badge color="blue" size="sm">
                      <Clock size={10} className="mr-0.5" /> En cours
                    </Badge>
                  )}
                  <span className="font-medium text-gray-900 dark:text-white truncate max-w-xs">
                    {log.accountName || log.emailAddress || `#${log.accountId}`}
                  </span>
                  {typeof log.newEmailsCount === 'number' && (
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      +{log.newEmailsCount} email(s)
                    </span>
                  )}
                  {!!log.errorsCount && (
                    <span className="text-xs text-red-600 dark:text-red-400">
                      {log.errorsCount} erreur(s)
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Demarrage: {log.syncStartedAt}
                  {log.syncCompletedAt && (
                    <> -- Fin: {log.syncCompletedAt}</>
                  )}
                </p>
                {log.errorMessage && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                    {log.errorMessage}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
