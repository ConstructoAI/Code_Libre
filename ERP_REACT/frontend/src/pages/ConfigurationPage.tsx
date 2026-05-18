/**
 * ERP React Frontend - Configuration Page
 * Tabs: Profil, Utilisateurs (admin), Entreprise config, Abonnement, Webhooks (admin).
 */

import React, { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import {
  User, Users, Building2, Save, Plus, Edit3, Key, XCircle,
  CheckCircle, Shield, RefreshCw, CreditCard, Zap, ExternalLink,
  AlertTriangle, Clock, Link2, Upload, Trash2, Image as ImageIcon,
  RotateCcw, Palette,
} from 'lucide-react';
import { useConfigStore } from '@/store/useConfigStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useStripeStore } from '@/store/useStripeStore';
import type { TenantUser, ConfigEntry, DocumentTheme } from '@/api/config';
import { getWebhooks, getDocumentTheme, updateDocumentTheme, resetDocumentTheme } from '@/api/config';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';

const IntegrationPage = lazy(() => import('@/pages/IntegrationPage'));

type TabKey = 'profil' | 'utilisateurs' | 'entreprise' | 'apparence' | 'abonnement' | 'integrations';

const TABS: { key: TabKey; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { key: 'profil', label: 'Profil', icon: <User size={16} /> },
  { key: 'utilisateurs', label: 'Utilisateurs', icon: <Users size={16} />, adminOnly: true },
  { key: 'entreprise', label: 'Entreprise', icon: <Building2 size={16} /> },
  { key: 'apparence', label: 'Apparence', icon: <Palette size={16} />, adminOnly: true },
  { key: 'abonnement', label: 'Abonnement', icon: <CreditCard size={16} /> },
  { key: 'integrations', label: 'Int\u00e9grations', icon: <Link2 size={16} /> },
];

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrateur' },
  { value: 'user', label: 'Utilisateur' },
  { value: 'employee', label: 'Employé' },
  { value: 'comptable', label: 'Comptable' },
  { value: 'gestionnaire', label: 'Gestionnaire' },
];

const CONFIG_CATEGORIES = ['General', 'Facturation', 'IA', 'Notifications'];

export default function ConfigurationPage() {
  // Check URL params for tab pre-selection (e.g. after Stripe redirect)
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'abonnement') return 'abonnement';
    return 'profil';
  });
  const authUser = useAuthStore((s) => s.user);
  const isAdmin = authUser?.role === 'admin' || authUser?.userType === 'super_admin';

  const {
    configEntries, users, profile,
    isLoading, error, successMessage,
    fetchConfig, updateConfig, fetchUsers, createUser, updateUser,
    changeUserPassword, deactivateUser,
    fetchProfile, updateProfile, changeOwnPassword,
    clearError, clearSuccess,
  } = useConfigStore();

  const stripeStore = useStripeStore();

  // Webhooks state
  const [_webhooks, setWebhooks] = useState<any[]>([]);
  const [_webhooksLoading, setWebhooksLoading] = useState(false);
  const [_showCreateWebhook] = useState(false);
  const [_webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookSuccess, setWebhookSuccess] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    setWebhooksLoading(true);
    try {
      const { data } = await getWebhooks();
      setWebhooks(data.items || data || []);
    } catch (e: any) {
      setWebhookError(e?.response?.data?.detail || 'Erreur lors du chargement des webhooks');
    } finally {
      setWebhooksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'profil') fetchProfile();
    else if (activeTab === 'utilisateurs' && isAdmin) fetchUsers();
    else if (activeTab === 'entreprise') fetchConfig();
    else if (activeTab === 'abonnement') {
      stripeStore.fetchSubscription();
      stripeStore.fetchCredits();
    }
  }, [activeTab, isAdmin, fetchProfile, fetchUsers, fetchConfig, fetchWebhooks]);

  // Auto-clear success after 3s
  useEffect(() => {
    if (successMessage) {
      const t = setTimeout(() => clearSuccess(), 3000);
      return () => clearTimeout(t);
    }
  }, [successMessage, clearSuccess]);

  useEffect(() => {
    if (stripeStore.successMessage) {
      const t = setTimeout(() => stripeStore.clearSuccess(), 3000);
      return () => clearTimeout(t);
    }
  }, [stripeStore.successMessage]);

  useEffect(() => {
    if (webhookSuccess) {
      const t = setTimeout(() => setWebhookSuccess(null), 3000);
      return () => clearTimeout(t);
    }
  }, [webhookSuccess]);

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  // Determine which error/success to show based on active tab
  const displayError = activeTab === 'abonnement' ? stripeStore.error : error;
  const displaySuccess = activeTab === 'abonnement' ? stripeStore.successMessage : successMessage;
  const handleClearError = activeTab === 'abonnement' ? stripeStore.clearError : clearError;
  const handleClearSuccess = activeTab === 'abonnement' ? stripeStore.clearSuccess : clearSuccess;

  return (
    <div className="space-y-6">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Configuration</h2>

      {displayError && <Alert type="error" onClose={handleClearError}>{displayError}</Alert>}
      {displaySuccess && <Alert type="success" onClose={handleClearSuccess}>{displaySuccess}</Alert>}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); clearError(); clearSuccess(); stripeStore.clearError(); stripeStore.clearSuccess(); }}
            className={`flex items-center gap-1.5 px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-seaop-primary-600 text-seaop-primary-600 dark:text-seaop-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {(isLoading || (activeTab === 'abonnement' && stripeStore.isLoading)) && (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      )}

      {/* TAB: Profil */}
      {activeTab === 'profil' && !isLoading && (
        <ProfilTab
          profile={profile}
          onUpdateProfile={updateProfile}
          onChangePassword={changeOwnPassword}
        />
      )}

      {/* TAB: Utilisateurs */}
      {activeTab === 'utilisateurs' && isAdmin && !isLoading && (
        <UtilisateursTab
          users={users}
          currentUserId={authUser?.userId ?? 0}
          onCreateUser={createUser}
          onUpdateUser={updateUser}
          onChangePassword={changeUserPassword}
          onDeactivateUser={deactivateUser}
          onRefresh={fetchUsers}
        />
      )}

      {/* TAB: Entreprise */}
      {activeTab === 'entreprise' && !isLoading && (
        <EntrepriseTab entries={configEntries} onUpdate={updateConfig} />
      )}

      {/* TAB: Apparence (thème couleurs des documents HTML) */}
      {activeTab === 'apparence' && isAdmin && (
        <ApparenceTab />
      )}

      {/* TAB: Abonnement */}
      {activeTab === 'abonnement' && !stripeStore.isLoading && (
        <AbonnementTab />
      )}

      {/* TAB: Integrations */}
      {activeTab === 'integrations' && (
        <Suspense fallback={<div className="flex justify-center py-12"><Spinner size="lg" /></div>}>
          <IntegrationPage />
        </Suspense>
      )}
    </div>
  );
}


// ============================================
// ABONNEMENT TAB
// ============================================

const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  trialing: 'blue',
  past_due: 'red',
  canceled: 'gray',
  canceling: 'yellow',
  incomplete: 'yellow',
  incomplete_expired: 'red',
  unpaid: 'red',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  trialing: 'Essai gratuit',
  past_due: 'Paiement en retard',
  canceled: 'Annule',
  canceling: 'Annulation en cours',
  incomplete: 'Incomplet',
  incomplete_expired: 'Expire',
  unpaid: 'Impaye',
};

function formatTimestamp(ts?: number): string {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function AbonnementTab() {
  const {
    subscription, credits,
    isProcessing,
    openCheckout, openPortal, cancelSubscription,
    rechargeCredits, fetchSubscription, fetchCredits,
  } = useStripeStore();

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [rechargeAmount, setRechargeAmount] = useState('10');
  const [showRechargeModal, setShowRechargeModal] = useState(false);

  const status = subscription?.status || 'unknown';
  const statusColor = STATUS_COLORS[status] || 'gray';
  const statusLabel = STATUS_LABELS[status] || status;

  const hasSubscription = subscription?.subscriptionId || subscription?.status;
  const isActive = status === 'active' || status === 'trialing';

  return (
    <div className="space-y-6">
      {/* Subscription Card */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CreditCard size={18} /> Abonnement
          </h3>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<RefreshCw size={14} />}
            onClick={() => { fetchSubscription(); fetchCredits(); }}
          >
            Rafraichir
          </Button>
        </div>

        {hasSubscription ? (
          <div className="space-y-6">
            {/* Status + Plan Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase font-medium">Statut</p>
                <div className="flex items-center gap-2">
                  <Badge color={statusColor as 'green' | 'blue' | 'red' | 'gray' | 'yellow'}>
                    {statusLabel}
                  </Badge>
                </div>
                {subscription?.cancelAtPeriodEnd && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                    <AlertTriangle size={12} />
                    Sera annule le {formatTimestamp(subscription.currentPeriodEnd)}
                  </p>
                )}
              </div>

              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase font-medium">Plan</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
                  {subscription?.planName || subscription?.planType || '--'}
                </p>
                {subscription?.planAmount != null && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {(subscription.planAmount / 100).toFixed(2)} $ / {subscription.planInterval === 'year' ? 'an' : 'mois'}
                  </p>
                )}
              </div>

              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase font-medium">Renouvellement</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-1">
                  <Clock size={16} className="text-gray-400" />
                  {formatTimestamp(subscription?.currentPeriodEnd)}
                </p>
                {subscription?.trialEnd && status === 'trialing' && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    Fin de l'essai: {formatTimestamp(subscription.trialEnd)}
                  </p>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                onClick={() => openPortal()}
                isLoading={isProcessing}
                leftIcon={<ExternalLink size={16} />}
              >
                Gérer mon abonnement
              </Button>

              {isActive && !subscription?.cancelAtPeriodEnd && (
                <Button
                  variant="secondary"
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={isProcessing}
                  leftIcon={<XCircle size={16} />}
                >
                  Annuler
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* No subscription */
          <div className="text-center py-8 space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <CreditCard size={28} className="text-gray-400" />
            </div>
            <div>
              <p className="text-gray-900 dark:text-white font-medium">Aucun abonnement actif</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Souscrivez à un plan pour accéder à toutes les fonctionnalités.
              </p>
            </div>
            <Button
              onClick={() => openCheckout('pro')}
              isLoading={isProcessing}
              leftIcon={<CreditCard size={16} />}
            >
              Souscrire maintenant
            </Button>
          </div>
        )}
      </Card>

      {/* AI Credits Card */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Zap size={18} /> Credits IA
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase font-medium">Solde actuel</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {credits?.isExempt ? (
                <span className="text-green-600 dark:text-green-400">Illimite</span>
              ) : (
                <>{(credits?.balance ?? 0).toFixed(2)} <span className="text-base font-normal text-gray-500">$</span></>
              )}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase font-medium">Utilisation ce mois</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {(credits?.usageThisMonth ?? 0).toFixed(2)} <span className="text-base font-normal text-gray-500">$</span>
            </p>
          </div>

          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase font-medium">Type de plan</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
              {credits?.planType || '--'}
            </p>
            {credits?.isExempt && (
              <Badge color="green">Credits illimites</Badge>
            )}
          </div>
        </div>

        {!credits?.isExempt && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            {/* Balance warning */}
            {credits && credits.balance < 2 && credits.balance > 0 && (
              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle size={16} />
                Solde bas. Rechargez vos crédits pour continuer à utiliser les fonctionnalités IA.
              </div>
            )}
            {credits && credits.balance <= 0 && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                <XCircle size={16} />
                Crédits IA épuisés. Rechargez pour utiliser les fonctionnalités IA.
              </div>
            )}

            <Button
              onClick={() => setShowRechargeModal(true)}
              disabled={isProcessing}
              leftIcon={<Zap size={16} />}
            >
              Recharger
            </Button>
          </div>
        )}
      </Card>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <Modal isOpen onClose={() => setShowCancelConfirm(false)} title="Annuler l'abonnement" size="sm">
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
              <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle size={16} />
                Attention
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                Votre abonnement restera actif jusqu'à la fin de la période en cours
                ({formatTimestamp(subscription?.currentPeriodEnd)}),
                puis sera désactivé. Vous perdrez l'accès aux fonctionnalités premium.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowCancelConfirm(false)}>
                Conserver
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  await cancelSubscription();
                  setShowCancelConfirm(false);
                }}
                isLoading={isProcessing}
                leftIcon={<XCircle size={16} />}
                className="!bg-[#E8919A] hover:!bg-[#d97b85]"
              >
                Confirmer l'annulation
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Recharge Modal */}
      {showRechargeModal && (
        <Modal isOpen onClose={() => setShowRechargeModal(false)} title="Recharger les credits IA" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Choisissez le montant de recharge. Le paiement sera effectué sur la méthode de paiement
              enregistrée dans votre compte Stripe.
            </p>

            {/* Quick amounts */}
            <div className="grid grid-cols-3 gap-2">
              {['10', '25', '50', '100', '200', '500'].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setRechargeAmount(amt)}
                  className={`p-3 rounded-lg border-2 text-center font-medium transition-colors ${
                    rechargeAmount === amt
                      ? 'border-seaop-primary-600 bg-seaop-primary-50 dark:bg-seaop-primary-900/20 text-seaop-primary-700 dark:text-seaop-primary-400'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {amt} $
                </button>
              ))}
            </div>

            <Input
              label="Montant personnalise ($)"
              type="number"
              value={rechargeAmount}
              onChange={(e) => setRechargeAmount(e.target.value)}
              placeholder="Min. 5.00"
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setShowRechargeModal(false)}>
                Annuler
              </Button>
              <Button
                onClick={async () => {
                  const amt = parseFloat(rechargeAmount);
                  if (isNaN(amt) || amt < 5 || amt > 500) return;
                  await rechargeCredits(amt);
                  setShowRechargeModal(false);
                }}
                isLoading={isProcessing}
                disabled={!rechargeAmount || isNaN(parseFloat(rechargeAmount)) || parseFloat(rechargeAmount) < 5 || parseFloat(rechargeAmount) > 500}
                leftIcon={<Zap size={16} />}
              >
                Recharger {rechargeAmount} $
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ============================================
// PROFIL TAB
// ============================================

function ProfilTab({
  profile,
  onUpdateProfile,
  onChangePassword,
}: {
  profile: ReturnType<typeof useConfigStore.getState>['profile'];
  onUpdateProfile: (data: { fullName?: string; email?: string }) => Promise<void>;
  onChangePassword: (pw: string) => Promise<void>;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName || '');
      setEmail(profile.email || '');
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    await onUpdateProfile({ fullName, email });
  };

  const handleChangePw = async () => {
    setPwError('');
    if (newPw.length < 6) {
      setPwError('Le mot de passe doit avoir au moins 6 caracteres');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('Les mots de passe ne correspondent pas');
      return;
    }
    try {
      await onChangePassword(newPw);
      setNewPw('');
      setConfirmPw('');
    } catch {
      // error handled by store
    }
  };

  if (!profile) {
    return <p className="text-gray-400 text-center py-6">Chargement du profil...</p>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Profile Info */}
      <Card>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <User size={18} /> Informations personnelles
        </h3>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Badge color={profile.isAdmin ? 'purple' : 'blue'}>{profile.role}</Badge>
            <span className="text-sm text-gray-500 dark:text-gray-400">@{profile.username}</span>
          </div>
          <Input
            label="Nom complet"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button
            onClick={handleSaveProfile}
            leftIcon={<Save size={16} />}
          >
            Enregistrer
          </Button>
        </div>
      </Card>

      {/* Password Change */}
      <Card>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Key size={18} /> Changer le mot de passe
        </h3>
        <div className="space-y-4">
          <Input
            label="Nouveau mot de passe"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="Min. 6 caracteres"
          />
          <Input
            label="Confirmer le mot de passe"
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
          {pwError && <p className="text-sm text-red-600 dark:text-red-400">{pwError}</p>}
          <Button
            onClick={handleChangePw}
            disabled={!newPw || !confirmPw}
            leftIcon={<Key size={16} />}
          >
            Modifier le mot de passe
          </Button>
        </div>
      </Card>
    </div>
  );
}


// ============================================
// UTILISATEURS TAB
// ============================================

function UtilisateursTab({
  users,
  currentUserId,
  onCreateUser,
  onUpdateUser,
  onChangePassword,
  onDeactivateUser,
  onRefresh,
}: {
  users: TenantUser[];
  currentUserId: number;
  onCreateUser: (data: {
    username: string; password: string; email?: string;
    fullName?: string; role?: string; isAdmin?: boolean;
  }) => Promise<void>;
  onUpdateUser: (id: number, data: {
    email?: string; fullName?: string; role?: string; isAdmin?: boolean;
  }) => Promise<void>;
  onChangePassword: (id: number, pw: string) => Promise<void>;
  onDeactivateUser: (id: number) => Promise<void>;
  onRefresh: () => void;
}) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [passwordUserId, setPasswordUserId] = useState<number | null>(null);

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Users size={18} /> Utilisateurs ({users.length})
          </h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" leftIcon={<RefreshCw size={14} />} onClick={onRefresh}>
              Rafraichir
            </Button>
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowCreateModal(true)}>
              Nouvel utilisateur
            </Button>
          </div>
        </div>
        {/* Desktop table */}
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Utilisateur</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Role</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Statut</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    <div className="flex items-center gap-2">
                      {u.isAdmin && <Shield size={14} className="text-purple-500" />}
                      {u.username}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {u.fullName || u.username}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.email || '--'}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={u.role === 'admin' ? 'purple' : 'blue'}>{u.role}</Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={u.active ? 'green' : 'red'}>
                      {u.active ? 'Actif' : 'Inactif'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditingUser(u)}
                        className="p-1.5 text-gray-400 hover:text-seaop-primary-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        title="Modifier"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => setPasswordUserId(u.id)}
                        className="p-1.5 text-gray-400 hover:text-amber-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        title="Changer mot de passe"
                      >
                        <Key size={14} />
                      </button>
                      {u.id !== currentUserId && u.active && (
                        <button
                          onClick={() => {
                            if (confirm(`Desactiver l'utilisateur ${u.username} ?`)) {
                              onDeactivateUser(u.id);
                            }
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          title="Desactiver"
                        >
                          <XCircle size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    Aucun utilisateur
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {users.map((u) => (
            <div key={u.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  {u.isAdmin && <Shield size={14} className="text-purple-500 shrink-0" />}
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{u.fullName || u.username}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge color={u.role === 'admin' ? 'purple' : 'blue'} size="sm">{u.role}</Badge>
                  <Badge color={u.active ? 'green' : 'red'} size="sm">{u.active ? 'Actif' : 'Inactif'}</Badge>
                </div>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <p>@{u.username}</p>
                {u.email && <p>{u.email}</p>}
              </div>
              <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => setEditingUser(u)}
                  className="p-1.5 text-gray-400 hover:text-seaop-primary-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="Modifier"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => setPasswordUserId(u.id)}
                  className="p-1.5 text-gray-400 hover:text-amber-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="Changer mot de passe"
                >
                  <Key size={14} />
                </button>
                {u.id !== currentUserId && u.active && (
                  <button
                    onClick={() => {
                      if (confirm(`Desactiver l'utilisateur ${u.username} ?`)) {
                        onDeactivateUser(u.id);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Desactiver"
                  >
                    <XCircle size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">Aucun utilisateur</p>
          )}
        </div>
      </Card>

      {/* Create User Modal */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onCreate={onCreateUser}
        />
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onUpdate={onUpdateUser}
        />
      )}

      {/* Change Password Modal */}
      {passwordUserId !== null && (
        <PasswordModal
          userId={passwordUserId}
          onClose={() => setPasswordUserId(null)}
          onChangePassword={onChangePassword}
        />
      )}
    </>
  );
}


// ============================================
// CREATE USER MODAL
// ============================================

function CreateUserModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: {
    username: string; password: string; email?: string;
    fullName?: string; role?: string; isAdmin?: boolean;
  }) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('user');
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) return;
    setSaving(true);
    try {
      await onCreate({ username, password, email, fullName, role, isAdmin });
      onClose();
    } catch {
      // error handled by store
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Nouvel utilisateur" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Nom d'utilisateur *"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ex: jdupont"
          />
          <Input
            label="Mot de passe *"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 6 caracteres"
          />
        </div>
        <Input
          label="Nom complet"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            options={ROLE_OPTIONS}
          />
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
              />
              Administrateur
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button
            onClick={handleSubmit}
            isLoading={saving}
            disabled={!username.trim() || !password.trim()}
            leftIcon={<Plus size={16} />}
          >
            Créer
          </Button>
        </div>
      </div>
    </Modal>
  );
}


// ============================================
// EDIT USER MODAL
// ============================================

function EditUserModal({
  user,
  onClose,
  onUpdate,
}: {
  user: TenantUser;
  onClose: () => void;
  onUpdate: (id: number, data: {
    email?: string; fullName?: string; role?: string; isAdmin?: boolean;
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState(user.email || '');
  const [fullName, setFullName] = useState(user.fullName || '');
  const [role, setRole] = useState(user.role || 'user');
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onUpdate(user.id, { email, fullName, role, isAdmin });
      onClose();
    } catch {
      // error handled by store
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Modifier: ${user.username}`} size="lg">
      <div className="space-y-4">
        <Input
          label="Nom complet"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            options={ROLE_OPTIONS}
          />
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
              />
              Administrateur
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} isLoading={saving} leftIcon={<Save size={16} />}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Modal>
  );
}


// ============================================
// PASSWORD MODAL
// ============================================

function PasswordModal({
  userId,
  onClose,
  onChangePassword,
}: {
  userId: number;
  onClose: () => void;
  onChangePassword: (id: number, pw: string) => Promise<void>;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setErr('');
    if (pw.length < 6) { setErr('Min. 6 caracteres'); return; }
    if (pw !== confirm) { setErr('Les mots de passe ne correspondent pas'); return; }
    setSaving(true);
    try {
      await onChangePassword(userId, pw);
      onClose();
    } catch {
      // error handled by store
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Changer le mot de passe" size="sm">
      <div className="space-y-4">
        <Input
          label="Nouveau mot de passe"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Min. 6 caracteres"
        />
        <Input
          label="Confirmer"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} isLoading={saving} disabled={!pw} leftIcon={<Key size={16} />}>
            Modifier
          </Button>
        </div>
      </div>
    </Modal>
  );
}


// ============================================
// ENTREPRISE CONFIG TAB
// ============================================

type EntrepriseSubTab = 'config' | 'informations';

const ENTREPRISE_INFO_FIELDS = [
  { key: 'company_name', label: 'Nom de l\'entreprise', placeholder: 'Construction ABC Inc.' },
  { key: 'company_address', label: 'Adresse', placeholder: '123 rue Principale' },
  { key: 'company_city', label: 'Ville', placeholder: 'Montreal' },
  { key: 'company_province', label: 'Province', placeholder: 'Quebec' },
  { key: 'company_postal_code', label: 'Code postal', placeholder: 'H1A 2B3' },
  { key: 'company_phone', label: 'Téléphone', placeholder: '514-555-1234' },
  { key: 'company_email', label: 'Email', placeholder: 'info@entreprise.com' },
  { key: 'company_website', label: 'Site web', placeholder: 'https://www.entreprise.com' },
  { key: 'company_rbq_number', label: 'Numéro RBQ', placeholder: '5734-1234-01' },
  { key: 'company_neq', label: 'Numéro NEQ', placeholder: '1234567890' },
  { key: 'company_tps_number', label: 'Numéro TPS', placeholder: '123456789 RT0001' },
  { key: 'company_tvq_number', label: 'Numéro TVQ', placeholder: '1234567890 TQ0001' },
];

function EntrepriseTab({
  entries,
  onUpdate,
}: {
  entries: ConfigEntry[];
  onUpdate: (cle: string, valeur: string) => Promise<void>;
}) {
  const [subTab, setSubTab] = useState<EntrepriseSubTab>('informations');
  const [infoValues, setInfoValues] = useState<Record<string, string>>({});
  const [infoLoading, setInfoLoading] = useState(true);
  const [logoSaving, setLogoSaving] = useState(false);

  // Load company info from entreprise_config or config entries
  useEffect(() => {
    const vals: Record<string, string> = {};
    for (const field of ENTREPRISE_INFO_FIELDS) {
      const entry = entries.find(e => e.cle === field.key);
      vals[field.key] = entry?.valeur || '';
    }
    setInfoValues(vals);
    setInfoLoading(false);
  }, [entries]);

  const currentLogo = entries.find(e => e.cle === 'company_logo_base64')?.valeur || '';

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1 * 1024 * 1024) {
      alert('Le logo ne doit pas depasser 1 Mo');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'].includes(file.type)) {
      alert('Format accepte: PNG, JPG, GIF, SVG, WEBP');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setLogoSaving(true);
      try {
        await onUpdate('company_logo_base64', dataUrl);
      } finally {
        setLogoSaving(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLogoDelete = async () => {
    setLogoSaving(true);
    try {
      await onUpdate('company_logo_base64', '');
    } finally {
      setLogoSaving(false);
    }
  };

  const [savingAll, setSavingAll] = useState(false);
  const [savedAll, setSavedAll] = useState(false);

  const handleSaveAll = async () => {
    setSavingAll(true);
    try {
      for (const field of ENTREPRISE_INFO_FIELDS) {
        const original = entries.find(e => e.cle === field.key)?.valeur || '';
        if ((infoValues[field.key] || '') !== original) {
          await onUpdate(field.key, infoValues[field.key] || '');
        }
      }
      setSavedAll(true);
      setTimeout(() => setSavedAll(false), 3000);
    } finally {
      setSavingAll(false);
    }
  };

  const hasChanges = ENTREPRISE_INFO_FIELDS.some((field) => {
    const original = entries.find(e => e.cle === field.key)?.valeur || '';
    return (infoValues[field.key] || '') !== original;
  });

  // Group by category
  const grouped: Record<string, ConfigEntry[]> = {};
  for (const cat of CONFIG_CATEGORIES) {
    grouped[cat] = [];
  }
  for (const entry of entries) {
    const cat = entry.categorie || 'General';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  }

  // Filter out empty categories
  const visibleCategories = CONFIG_CATEGORIES.filter(
    (cat) => grouped[cat] && grouped[cat].length > 0,
  );

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        <button onClick={() => setSubTab('informations')} className={`px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${subTab === 'informations' ? 'border-seaop-primary-600 text-seaop-primary-600' : 'border-transparent text-gray-500'}`}>
          Informations entreprise
        </button>
        <button onClick={() => setSubTab('config')} className={`px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${subTab === 'config' ? 'border-seaop-primary-600 text-seaop-primary-600' : 'border-transparent text-gray-500'}`}>
          Configuration systeme
        </button>
      </div>

      {/* Informations entreprise */}
      {subTab === 'informations' && (
        <Card>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Building2 size={18} /> Informations de l'entreprise
          </h3>
          {infoLoading ? (
            <div className="flex justify-center py-4"><Spinner size="md" /></div>
          ) : (
            <div className="space-y-3">
              {/* Logo upload */}
              <div className="pb-3 mb-3 border-b border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Logo de l'entreprise
                </label>
                <div className="flex items-center gap-4">
                  {currentLogo ? (
                    <img src={currentLogo} alt="Logo" className="h-[60px] max-w-[200px] object-contain rounded border border-gray-200 dark:border-gray-600 bg-white p-1" />
                  ) : (
                    <div className="h-[60px] w-[120px] flex items-center justify-center rounded border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
                      <ImageIcon size={24} className="text-gray-400" />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-colors ${logoSaving ? 'opacity-50 pointer-events-none' : 'bg-[#0078D4] text-white hover:bg-[#106EBE]'}`}>
                      <Upload size={14} />
                      {currentLogo ? 'Changer' : 'Télécharger'}
                      <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp" onChange={handleLogoUpload} className="hidden" />
                    </label>
                    {currentLogo && (
                      <Button size="sm" variant="ghost" onClick={handleLogoDelete} disabled={logoSaving} leftIcon={<Trash2 size={14} />}>
                        Retirer
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">PNG, JPG, SVG. Max 1 Mo. Recommande: 500x200px, fond transparent.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {ENTREPRISE_INFO_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Input
                      label={field.label}
                      value={infoValues[field.key] || ''}
                      onChange={(e) => setInfoValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-700 mt-2">
                <Button
                  variant="primary"
                  disabled={!hasChanges || savingAll}
                  isLoading={savingAll}
                  onClick={handleSaveAll}
                  leftIcon={<Save size={16} />}
                >
                  Sauvegarder
                </Button>
                {savedAll && (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle size={16} /> Informations sauvegardees
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Configuration systeme */}
      {subTab === 'config' && (
        <>
          {visibleCategories.length === 0 ? (
            <Card>
              <p className="text-gray-400 text-center py-6">
                Aucune configuration trouvée. Les entrées seront créées automatiquement par le système.
              </p>
            </Card>
          ) : (
            visibleCategories.map((cat) => (
              <Card key={cat}>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <Building2 size={18} />
                  {cat}
                </h3>
                <div className="space-y-3">
                  {grouped[cat].map((entry) => (
                    <ConfigEntryRow key={entry.cle} entry={entry} onUpdate={onUpdate} />
                  ))}
                </div>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}


function ConfigEntryRow({
  entry,
  onUpdate,
}: {
  entry: ConfigEntry;
  onUpdate: (cle: string, valeur: string) => Promise<void>;
}) {
  const [value, setValue] = useState(entry.valeur);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const changed = value !== entry.valeur;

  useEffect(() => {
    setValue(entry.valeur);
  }, [entry.valeur]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(entry.cle, value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <code className="text-xs font-mono text-seaop-primary-600 dark:text-seaop-primary-400 bg-seaop-primary-50 dark:bg-seaop-primary-900/20 px-1.5 py-0.5 rounded break-all">
            {entry.cle}
          </code>
          <Badge color="gray" size="sm">{entry.categorie}</Badge>
        </div>
        {entry.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{entry.description}</p>
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-seaop-primary-500 transition-colors"
        />
      </div>
      <div className="shrink-0 sm:pt-6 self-end sm:self-auto">
        {saved ? (
          <CheckCircle size={20} className="text-green-500" />
        ) : (
          <Button
            size="sm"
            variant={changed ? 'primary' : 'ghost'}
            disabled={!changed || saving}
            isLoading={saving}
            onClick={handleSave}
            leftIcon={<Save size={14} />}
          >
            Sauver
          </Button>
        )}
      </div>
    </div>
  );
}


// ============================================
// APPARENCE TAB (Document color theme)
// ============================================

/** Preset palettes surfaced as one-click "themes" in the UI. The default
 * Constructo blue palette is always first and serves as the reference. */
const THEME_PRESETS: Array<{ key: string; label: string; palette: DocumentTheme }> = [
  {
    key: 'constructo',
    label: 'Constructo Bleu',
    palette: {
      primary: '#1F4E79', primaryDark: '#163A5C', accent: '#2563EB', accentLight: '#93C5FD',
      headerText: '#FFFFFF', tableRowAlt: '#F8F9FA', infoBg: '#F8FAFC', border: '#E9ECEF',
    },
  },
  {
    key: 'foret',
    label: 'Vert Forêt',
    palette: {
      primary: '#166534', primaryDark: '#14532D', accent: '#15803D', accentLight: '#86EFAC',
      headerText: '#FFFFFF', tableRowAlt: '#F5F9F5', infoBg: '#F6FAF7', border: '#E5EDE5',
    },
  },
  {
    key: 'brique',
    label: 'Rouge Brique',
    palette: {
      primary: '#991B1B', primaryDark: '#7F1D1D', accent: '#DC2626', accentLight: '#FCA5A5',
      headerText: '#FFFFFF', tableRowAlt: '#FAF5F5', infoBg: '#FBF7F7', border: '#EDE3E3',
    },
  },
  {
    key: 'anthracite',
    label: 'Anthracite',
    palette: {
      primary: '#1F2937', primaryDark: '#111827', accent: '#4B5563', accentLight: '#9CA3AF',
      headerText: '#FFFFFF', tableRowAlt: '#F5F6F8', infoBg: '#F7F8FA', border: '#E3E5E9',
    },
  },
  {
    key: 'bourgogne',
    label: 'Bourgogne',
    palette: {
      primary: '#7F1D1D', primaryDark: '#4C0519', accent: '#BE123C', accentLight: '#FECDD3',
      headerText: '#FFFFFF', tableRowAlt: '#FAF4F5', infoBg: '#FBF6F7', border: '#EDE1E4',
    },
  },
  {
    key: 'ocean',
    label: 'Océan',
    palette: {
      primary: '#0C4A6E', primaryDark: '#0F3854', accent: '#0284C7', accentLight: '#7DD3FC',
      headerText: '#FFFFFF', tableRowAlt: '#F5F8FA', infoBg: '#F6FAFC', border: '#E1E9EE',
    },
  },
];

const THEME_FIELDS: Array<{ key: keyof DocumentTheme; label: string; hint: string }> = [
  { key: 'primary',      label: 'Couleur principale',    hint: 'Entête, bandeau titre, entêtes de tableaux' },
  { key: 'primaryDark',  label: 'Principale — foncée',   hint: 'Variante foncée (hover, accents intenses)' },
  { key: 'accent',       label: 'Accent',                hint: 'Bordure gauche info-box, sous-titres' },
  { key: 'accentLight',  label: 'Accent — clair',        hint: 'Numéro de document sur l’entête' },
  { key: 'headerText',   label: 'Texte entête',          hint: 'Texte sur fond couleur principale' },
  { key: 'tableRowAlt',  label: 'Lignes alternées',      hint: 'Fond des lignes paires du tableau' },
  { key: 'infoBg',       label: 'Fond sections info',    hint: 'Fond des info-boxes client/document' },
  { key: 'border',       label: 'Bordures',              hint: 'Bordures fines lignes et sections' },
];

/** Normalize a hex string to uppercase #RRGGBB for deterministic diff comparisons. */
function _normHex(value: string): string {
  const v = (value || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return ('#' + v.slice(1).split('').map((c) => c + c).join('')).toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  return v;
}

/** Compare two themes key-by-key after hex normalization. */
function _themesEqual(a: DocumentTheme, b: DocumentTheme): boolean {
  return THEME_FIELDS.every((f) => _normHex(a[f.key]) === _normHex(b[f.key]));
}

function ApparenceTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [theme, setTheme] = useState<DocumentTheme | null>(null);
  const [serverTheme, setServerTheme] = useState<DocumentTheme | null>(null);
  const [defaults, setDefaults] = useState<DocumentTheme | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getDocumentTheme();
      setTheme(res.theme);
      setServerTheme(res.theme);
      setDefaults(res.defaults);
    } catch (e: any) {
      setLoadError(e?.response?.data?.detail || 'Erreur lors du chargement du thème');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-clear success after 2.5s
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 2500);
      return () => clearTimeout(t);
    }
  }, [success]);

  const hasChanges = theme && serverTheme ? !_themesEqual(theme, serverTheme) : false;
  const isDefault = theme && defaults ? _themesEqual(theme, defaults) : false;
  const allValid = theme
    ? THEME_FIELDS.every((f) => /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(theme[f.key]))
    : false;

  const handleColorChange = (key: keyof DocumentTheme, value: string) => {
    if (!theme) return;
    setTheme({ ...theme, [key]: _normHex(value) });
  };

  const handlePreset = (preset: DocumentTheme) => {
    setTheme({ ...preset });
  };

  const handleSave = async () => {
    if (!theme) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await updateDocumentTheme(theme);
      setTheme(res.theme);
      setServerTheme(res.theme);
      setSuccess('Thème enregistré');
    } catch (e: any) {
      setSaveError(e?.response?.data?.detail || 'Erreur lors de la sauvegarde du thème');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Réinitialiser toutes les couleurs aux valeurs par défaut ?')) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await resetDocumentTheme();
      setTheme(res.theme);
      setServerTheme(res.theme);
      setSuccess('Thème réinitialisé aux valeurs par défaut');
    } catch (e: any) {
      setSaveError(e?.response?.data?.detail || 'Erreur lors de la réinitialisation');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (serverTheme) setTheme({ ...serverTheme });
    setSaveError(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }
  if (!theme) {
    // Loading finished but theme never populated (network error, offline, etc.).
    // Surface the real reason instead of spinning forever.
    return (
      <div className="space-y-4">
        <Alert type="error" onClose={() => { setLoadError(null); load(); }}>
          {loadError || 'Impossible de charger le thème des documents'}
        </Alert>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={14} />
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && <Alert type="error" onClose={() => setLoadError(null)}>{loadError}</Alert>}
      {saveError && <Alert type="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      {/* Presets */}
      <Card>
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Palette size={18} className="text-seaop-primary-600" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Apparence des documents</h3>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Personnalisez les couleurs de vos soumissions, factures, bons de commande, bons de travail et courriels envoyés aux clients.
            Les modifications s&apos;appliquent à tous les nouveaux documents générés.
          </p>
        </div>

        <div className="p-4 space-y-6">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3 block">
              Thèmes prédéfinis
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {THEME_PRESETS.map((preset) => {
                const selected = _themesEqual(theme, preset.palette);
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => handlePreset(preset.palette)}
                    disabled={saving}
                    className={`relative flex flex-col items-stretch rounded-lg border-2 overflow-hidden transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
                      selected
                        ? 'border-seaop-primary-500 ring-2 ring-seaop-primary-200 dark:ring-seaop-primary-900'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                    aria-pressed={selected}
                  >
                    <div
                      className="h-10 flex items-center justify-center text-[11px] font-semibold text-white"
                      style={{ background: preset.palette.primary }}
                    >
                      {preset.label}
                    </div>
                    <div className="flex h-4" aria-hidden="true">
                      <div className="flex-1" style={{ background: preset.palette.accent }} />
                      <div className="flex-1" style={{ background: preset.palette.accentLight }} />
                      <div className="flex-1" style={{ background: preset.palette.primaryDark }} />
                    </div>
                    {selected && (
                      <div className="absolute top-1 right-1 bg-white rounded-full p-0.5 shadow-sm">
                        <CheckCircle size={14} className="text-seaop-primary-600" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color pickers */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3 block">
              Personnalisation avancée
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {THEME_FIELDS.map((f) => {
                const raw = theme[f.key];
                const isValidHex = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw);
                return (
                  <div key={f.key} className="flex flex-col gap-1">
                    <label htmlFor={`theme-${f.key}`} className="text-xs font-medium text-gray-700 dark:text-gray-200">
                      {f.label}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`theme-${f.key}`}
                        type="color"
                        value={isValidHex ? _normHex(raw) : '#000000'}
                        onChange={(e) => handleColorChange(f.key, e.target.value)}
                        disabled={saving}
                        className="w-10 h-10 rounded border border-gray-300 dark:border-gray-600 cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`${f.label} — sélecteur de couleur`}
                      />
                      <input
                        type="text"
                        value={raw}
                        onChange={(e) => handleColorChange(f.key, e.target.value)}
                        disabled={saving}
                        placeholder="#RRGGBB"
                        maxLength={7}
                        aria-label={`${f.label} — valeur hex`}
                        aria-invalid={!isValidHex}
                        className={`flex-1 min-w-0 px-2 py-1.5 text-[11px] font-mono rounded border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                          isValidHex
                            ? 'border-gray-300 dark:border-gray-600 focus:ring-seaop-primary-500 focus:border-seaop-primary-500'
                            : 'border-red-500 focus:ring-red-500 focus:border-red-500'
                        }`}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 leading-tight">{f.hint}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live preview */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2 block">
              Aperçu
            </label>
            <ThemePreview theme={theme} />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!hasChanges || saving || !allValid}
              className="gap-1.5"
              title={!allValid ? 'Une ou plusieurs couleurs sont invalides' : undefined}
            >
              <Save size={14} />
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
            {hasChanges && (
              <Button variant="secondary" onClick={handleCancel} disabled={saving}>
                Annuler les changements
              </Button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleReset}
              disabled={saving || isDefault}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Revenir aux couleurs par défaut Constructo"
            >
              <RotateCcw size={13} />
              Réinitialiser aux défauts
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Lightweight soumission preview built inline from the live theme state.
 * The real PDF renders on the backend; this is a simplified visual proxy so
 * users can gauge color impact without generating a full document. */
function ThemePreview({ theme }: { theme: DocumentTheme }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white">
      <div className="flex" style={{ color: theme.headerText }}>
        <div className="flex-1 p-3" style={{ background: '#ffffff', color: '#333' }}>
          <div style={{ color: theme.primary, fontWeight: 800, fontSize: '14px' }}>Votre Entreprise</div>
          <div style={{ color: '#64748b', fontSize: '10px' }}>123 rue Principale, Montréal QC</div>
        </div>
        <div
          className="px-4 py-3 text-center flex flex-col justify-center"
          style={{ background: theme.primary, minWidth: 110 }}
        >
          <div style={{ fontSize: '14px', fontWeight: 800, letterSpacing: '1px' }}>DEVIS</div>
          <div style={{ color: theme.accentLight, fontSize: '10px', fontWeight: 600 }}>D-2026-001</div>
        </div>
      </div>
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${theme.primary} 0%, ${theme.accent} 50%, ${theme.primary} 100%)`,
        }}
      />
      <div className="p-3 grid grid-cols-2 gap-2">
        <div
          className="rounded p-2"
          style={{ background: theme.infoBg, borderLeft: `3px solid ${theme.accent}` }}
        >
          <div style={{ color: theme.accent, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>
            Client
          </div>
          <div style={{ color: theme.primary, fontWeight: 700, fontSize: '11px' }}>Jean Tremblay</div>
          <div style={{ color: '#334155', fontSize: '10px' }}>456 Chemin du Lac</div>
        </div>
        <div
          className="rounded p-2"
          style={{ background: theme.infoBg, borderLeft: `3px solid ${theme.accent}` }}
        >
          <div style={{ color: theme.accent, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>
            Détails
          </div>
          <div style={{ color: '#334155', fontSize: '10px' }}>Date : 2026-04-22</div>
          <div style={{ color: '#334155', fontSize: '10px' }}>Validité : 30 jours</div>
        </div>
      </div>
      <table className="w-full" style={{ fontSize: '10px' }}>
        <thead>
          <tr>
            <th
              style={{ background: theme.primary, color: theme.headerText, padding: '4px 8px', textAlign: 'left' }}
            >
              Description
            </th>
            <th
              style={{ background: theme.primary, color: theme.headerText, padding: '4px 8px', textAlign: 'right' }}
            >
              Montant
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: '4px 8px', borderBottom: `1px solid ${theme.border}` }}>Fourniture et installation</td>
            <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: `1px solid ${theme.border}` }}>1 250,00 $</td>
          </tr>
          <tr style={{ background: theme.tableRowAlt }}>
            <td style={{ padding: '4px 8px', borderBottom: `1px solid ${theme.border}` }}>Main-d&apos;œuvre</td>
            <td style={{ padding: '4px 8px', textAlign: 'right', borderBottom: `1px solid ${theme.border}` }}>850,00 $</td>
          </tr>
        </tbody>
      </table>
      <div className="flex justify-end p-2">
        <div
          style={{
            borderTop: `2px solid ${theme.primary}`,
            paddingTop: 4,
            color: theme.primary,
            fontWeight: 800,
            fontSize: '12px',
          }}
        >
          TOTAL TTC : 2 415,79 $
        </div>
      </div>
    </div>
  );
}
