/**
 * SEAOP React Frontend - Admin Entrepreneur Management Table
 * Lists all entrepreneurs with filtering, status toggle, and credit modification.
 */

import { useEffect, useState } from 'react';
import { Shield, ShieldOff, CreditCard, RefreshCw, BadgeCheck } from 'lucide-react';
import { useAdminStore } from '@/store/useAdminStore';
import { Badge, type BadgeColor } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { Modal } from '@/components/ui/Modal';

// ============ Status Helpers ============

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'actif', label: 'Actif' },
  { value: 'inactif', label: 'Inactif' },
  { value: 'suspendu', label: 'Suspendu' },
];

function getStatutColor(statut: string): BadgeColor {
  switch (statut) {
    case 'actif':
      return 'green';
    case 'inactif':
      return 'gray';
    case 'suspendu':
      return 'red';
    default:
      return 'gray';
  }
}

function getStatutLabel(statut: string): string {
  switch (statut) {
    case 'actif':
      return 'Actif';
    case 'inactif':
      return 'Inactif';
    case 'suspendu':
      return 'Suspendu';
    default:
      return statut;
  }
}

// ============ Component ============

export default function EntrepreneurTable() {
  const { entrepreneurs, isLoading, error, fetchEntrepreneurs, updateEntrepreneur, verifyRbq, clearError } =
    useAdminStore();
  const [filter, setFilter] = useState('');
  const [creditModalId, setCreditModalId] = useState<number | null>(null);
  const [creditValue, setCreditValue] = useState('');

  useEffect(() => {
    fetchEntrepreneurs(filter || undefined);
  }, [fetchEntrepreneurs, filter]);

  async function handleToggleStatus(id: number, currentStatut: string) {
    const newStatut = currentStatut === 'actif' ? 'suspendu' : 'actif';
    await updateEntrepreneur(id, { statut: newStatut });
  }

  async function handleUpdateCredits() {
    if (creditModalId === null) return;
    const credits = parseInt(creditValue, 10);
    if (isNaN(credits) || credits < 0) return;
    await updateEntrepreneur(creditModalId, { creditsRestants: credits });
    setCreditModalId(null);
    setCreditValue('');
  }

  return (
    <div className="space-y-4">
      {/* Header & Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Gestion des entrepreneurs
        </h3>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <Select
            options={STATUS_FILTER_OPTIONS}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full sm:w-48"
          />
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => fetchEntrepreneurs(filter || undefined)}
            disabled={isLoading}
          >
            Actualiser
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error" onClose={clearError}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : entrepreneurs.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            Aucun entrepreneur trouvé
          </div>
        </Card>
      ) : (
        <>
          {/* Mobile: Card list (< lg) */}
          <div className="space-y-3 lg:hidden" role="list" aria-label="Entrepreneurs (vue mobile/tablette)">
            {entrepreneurs.map((ent, idx) => {
              const id = Number(ent.id ?? 0);
              const statut = String(ent.statut ?? 'inactif');
              const key = ent.id != null ? `ent-${ent.id}` : `ent-idx-${idx}`;

              return (
                <Card key={key} padding="sm">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 dark:text-gray-100 break-words">
                          {String(ent.nomEntreprise ?? '--')}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 break-words">
                          {String(ent.nomContact ?? '--')}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
                          {String(ent.email ?? '--')}
                        </div>
                      </div>
                      <Badge color={getStatutColor(statut)} size="sm">
                        {getStatutLabel(statut)}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-gray-500 dark:text-gray-400">RBQ</div>
                        <div className="font-mono text-gray-700 dark:text-gray-300 flex items-center gap-1 break-all">
                          {String(ent.numeroRbq ?? '--')}
                          {Boolean(ent.rbqVerifie) && (
                            <BadgeCheck className="h-3.5 w-3.5 text-green-500 shrink-0" aria-label="RBQ vérifiée" />
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 dark:text-gray-400">Abonnement</div>
                        <Badge color="blue" size="sm">
                          {String(ent.abonnement ?? 'N/A')}
                        </Badge>
                      </div>
                      <div>
                        <div className="text-gray-500 dark:text-gray-400">Crédits</div>
                        <div className="text-gray-700 dark:text-gray-300">
                          {String(ent.creditsRestants ?? 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 dark:text-gray-400">Évaluation</div>
                        <div className="text-gray-700 dark:text-gray-300">
                          {ent.evaluationsMoyenne
                            ? Number(ent.evaluationsMoyenne).toFixed(1)
                            : '--'}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                      <Button
                        variant={statut === 'actif' ? 'danger' : 'primary'}
                        size="sm"
                        leftIcon={
                          statut === 'actif' ? (
                            <ShieldOff className="h-3.5 w-3.5" />
                          ) : (
                            <Shield className="h-3.5 w-3.5" />
                          )
                        }
                        onClick={() => handleToggleStatus(id, statut)}
                      >
                        {statut === 'actif' ? 'Suspendre' : 'Activer'}
                      </Button>
                      {Boolean(ent.numeroRbq) && !ent.rbqVerifie && (
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}
                          onClick={() => verifyRbq(id)}
                        >
                          Vérifier RBQ
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<CreditCard className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setCreditModalId(id);
                          setCreditValue(String(ent.creditsRestants ?? 0));
                        }}
                      >
                        Crédits
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Desktop: Table (lg+) */}
          <Card padding="sm" className="hidden lg:block">
            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Entreprise
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Contact
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Email
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      RBQ
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Abonnement
                    </th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Crédits
                    </th>
                    <th className="text-center py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Statut
                    </th>
                    <th className="text-center py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Évaluation
                    </th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {entrepreneurs.map((ent, idx) => {
                    const id = Number(ent.id ?? 0);
                    const statut = String(ent.statut ?? 'inactif');
                    const key = ent.id != null ? `ent-${ent.id}` : `ent-idx-${idx}`;

                    return (
                      <tr
                        key={key}
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                      >
                        <td className="py-3 px-4 font-medium text-gray-900 dark:text-gray-100">
                          {String(ent.nomEntreprise ?? '--')}
                        </td>
                        <td className="py-3 px-4 text-gray-600 dark:text-gray-400">
                          {String(ent.nomContact ?? '--')}
                        </td>
                        <td className="py-3 px-4 text-gray-600 dark:text-gray-400">
                          {String(ent.email ?? '--')}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-gray-600 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            {String(ent.numeroRbq ?? '--')}
                            {Boolean(ent.rbqVerifie) && (
                              <BadgeCheck className="h-3.5 w-3.5 text-green-500" aria-label="RBQ vérifiée" />
                            )}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge color="blue" size="sm">
                            {String(ent.abonnement ?? 'N/A')}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-400">
                          {String(ent.creditsRestants ?? 0)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge color={getStatutColor(statut)} size="sm">
                            {getStatutLabel(statut)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center text-gray-600 dark:text-gray-400">
                          {ent.evaluationsMoyenne
                            ? Number(ent.evaluationsMoyenne).toFixed(1)
                            : '--'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant={statut === 'actif' ? 'danger' : 'primary'}
                              size="sm"
                              leftIcon={
                                statut === 'actif' ? (
                                  <ShieldOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Shield className="h-3.5 w-3.5" />
                                )
                              }
                              onClick={() => handleToggleStatus(id, statut)}
                            >
                              {statut === 'actif' ? 'Suspendre' : 'Activer'}
                            </Button>
                            {Boolean(ent.numeroRbq) && !ent.rbqVerifie && (
                              <Button
                                variant="secondary"
                                size="sm"
                                leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}
                                onClick={() => verifyRbq(id)}
                              >
                                Vérifier RBQ
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              leftIcon={<CreditCard className="h-3.5 w-3.5" />}
                              onClick={() => {
                                setCreditModalId(id);
                                setCreditValue(String(ent.creditsRestants ?? 0));
                              }}
                            >
                              Crédits
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Credit Modification Modal */}
      <Modal
        isOpen={creditModalId !== null}
        title="Modifier les crédits"
        onClose={() => {
          setCreditModalId(null);
          setCreditValue('');
        }}
      >
        <div className="space-y-4">
          <Input
            label="Nombre de crédits"
            type="number"
            value={creditValue}
            onChange={(e) => setCreditValue(e.target.value)}
            min={0}
          />
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setCreditModalId(null);
                setCreditValue('');
              }}
            >
              Annuler
            </Button>
            <Button onClick={handleUpdateCredits}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
