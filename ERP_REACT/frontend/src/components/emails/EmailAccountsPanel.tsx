/**
 * Configuration des comptes email (multi-comptes IMAP/SMTP/OAuth).
 * Port de _render_settings + _render_account_configuration de
 * modules/email_manager/email_ui.py.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Mail, Plus, Edit2, Trash2, Star, ZapOff, Zap, Check, X, Lock,
  AlertTriangle, Settings, Globe, RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useEmailsStore } from '@/store/useEmailsStore';
import * as emailsApi from '@/api/emails';
import type {
  EmailAccount, EmailProvider, AccountTestResult, AccountCreatePayload,
} from '@/api/emails';

interface FormState {
  accountName: string;
  emailAddress: string;
  provider: string;
  imapServer: string;
  imapPort: number;
  imapUseSsl: boolean;
  imapUsername: string;
  smtpServer: string;
  smtpPort: number;
  smtpUseTls: boolean;
  smtpUsername: string;
  password: string;
  signatureHtml: string;
  signatureText: string;
  syncEnabled: boolean;
  syncFolders: string;
  isDefault: boolean;
}

const EMPTY_FORM: FormState = {
  accountName: '',
  emailAddress: '',
  provider: 'Autre',
  imapServer: '',
  imapPort: 993,
  imapUseSsl: true,
  imapUsername: '',
  smtpServer: '',
  smtpPort: 587,
  smtpUseTls: true,
  smtpUsername: '',
  password: '',
  signatureHtml: '',
  signatureText: '',
  syncEnabled: false,
  syncFolders: 'INBOX',
  isDefault: false,
};

export function EmailAccountsPanel() {
  const {
    accounts, providers, isLoading, error, successMessage,
    fetchAccounts, fetchProviders, createAccount, updateAccount,
    deleteAccount, testAccount, restoreLegacyAccounts, startOauth,
    clearError, clearSuccess,
  } = useEmailsStore();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [testResult, setTestResult] = useState<{
    accountId: number;
    result: AccountTestResult;
  } | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [showOauthHelp, setShowOauthHelp] = useState(false);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    fetchAccounts();
    fetchProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providerByName = useMemo(() => {
    const map: Record<string, EmailProvider> = {};
    for (const p of providers) map[p.name] = p;
    return map;
  }, [providers]);

  const fillFromProvider = (name: string) => {
    const cfg = providerByName[name];
    if (!cfg) return;
    setForm((f) => ({
      ...f,
      provider: name,
      imapServer: cfg.imapServer,
      imapPort: cfg.imapPort,
      imapUseSsl: cfg.imapUseSsl,
      smtpServer: cfg.smtpServer,
      smtpPort: cfg.smtpPort,
      smtpUseTls: cfg.smtpUseTls,
    }));
  };

  const handleEmailBlur = async () => {
    if (!form.emailAddress || form.emailAddress.length < 5 || !form.emailAddress.includes('@')) return;
    setDetecting(true);
    try {
      const detected = await emailsApi.detectProvider(form.emailAddress);
      if (detected.provider !== 'Autre') {
        setForm((f) => ({
          ...f,
          provider: detected.provider,
          imapServer: detected.imapServer,
          imapPort: detected.imapPort,
          imapUseSsl: detected.imapUseSsl,
          smtpServer: detected.smtpServer,
          smtpPort: detected.smtpPort,
          smtpUseTls: detected.smtpUseTls,
          imapUsername: f.imapUsername || form.emailAddress,
          smtpUsername: f.smtpUsername || form.emailAddress,
        }));
      }
    } catch {
      // ignore
    } finally {
      setDetecting(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (account: EmailAccount) => {
    setEditingId(account.id);
    setForm({
      accountName: account.accountName || account.name || '',
      emailAddress: account.emailAddress,
      provider: account.provider || 'Autre',
      imapServer: account.imapServer || '',
      imapPort: account.imapPort || 993,
      imapUseSsl: account.imapUseSsl ?? true,
      imapUsername: account.imapUsername || account.emailAddress,
      smtpServer: account.smtpServer || '',
      smtpPort: account.smtpPort || 587,
      smtpUseTls: account.smtpUseTls ?? true,
      smtpUsername: account.smtpUsername || account.emailAddress,
      password: '',
      signatureHtml: account.signatureHtml || '',
      signatureText: account.signatureText || '',
      syncEnabled: !!account.syncEnabled,
      syncFolders: account.syncFolders || 'INBOX',
      isDefault: !!account.isDefault,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.accountName.trim() || !form.emailAddress.trim()) {
      return;
    }
    const payload: AccountCreatePayload = {
      accountName: form.accountName.trim(),
      emailAddress: form.emailAddress.trim(),
      provider: form.provider,
      imapServer: form.imapServer,
      imapPort: form.imapPort,
      imapUseSsl: form.imapUseSsl,
      imapUsername: form.imapUsername || form.emailAddress,
      smtpServer: form.smtpServer,
      smtpPort: form.smtpPort,
      smtpUseTls: form.smtpUseTls,
      smtpUsername: form.smtpUsername || form.emailAddress,
      password: form.password || undefined,
      syncEnabled: form.syncEnabled,
      syncFolders: form.syncFolders,
      signatureHtml: form.signatureHtml || undefined,
      signatureText: form.signatureText || undefined,
      isDefault: form.isDefault,
    };
    try {
      if (editingId) {
        await updateAccount(editingId, payload);
      } else {
        await createAccount(payload);
      }
      setShowForm(false);
    } catch {
      // erreur affichee via store
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const result = await testAccount(id);
      setTestResult({ accountId: id, result });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteAccount(id);
    setConfirmDelete(null);
  };

  const handleOauth = async (provider: 'google' | 'microsoft') => {
    try {
      const url = await startOauth(provider);
      window.location.href = url;
    } catch {
      // erreur via store
    }
  };

  const handleRestore = async () => {
    await restoreLegacyAccounts();
  };

  const provider = providerByName[form.provider];

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Comptes email
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Gerer vos comptes IMAP/SMTP, OAuth Gmail et Microsoft 365
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleRestore}
            disabled={isLoading}
            title="Reactiver les comptes IMAP/OAuth qui auraient ete desactives"
          >
            <RotateCw size={14} className="mr-1" /> Restaurer
          </Button>
          <Button onClick={openCreate}>
            <Plus size={14} className="mr-1" /> Nouveau compte
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error" onClose={clearError}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert type="success" onClose={clearSuccess}>
          {successMessage}
        </Alert>
      )}

      {/* OAuth quick start */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-blue-50/30 dark:bg-blue-900/10">
        <button
          onClick={() => setShowOauthHelp((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300"
        >
          <Globe size={14} /> Connexion rapide avec OAuth (recommande)
        </button>
        {showOauthHelp && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => handleOauth('google')}
              disabled={!providerByName['Gmail']?.oauthAvailable}
              title={
                providerByName['Gmail']?.oauthAvailable
                  ? 'Se connecter avec Google'
                  : 'GOOGLE_CLIENT_ID/SECRET non configures sur Render'
              }
            >
              Connecter Gmail (OAuth)
            </Button>
            <Button
              variant="outline"
              onClick={() => handleOauth('microsoft')}
              disabled={!providerByName['Microsoft365']?.oauthAvailable}
              title={
                providerByName['Microsoft365']?.oauthAvailable
                  ? 'Se connecter avec Microsoft'
                  : 'MS_CLIENT_ID/SECRET non configures sur Render'
              }
            >
              Connecter Microsoft 365 (OAuth)
            </Button>
            <p className="sm:col-span-2 text-xs text-gray-600 dark:text-gray-400">
              OAuth: pas besoin de mot de passe applicatif, refresh token
              automatique. Le bouton est grise tant que les credentials
              OAuth ne sont pas configures cote serveur.
            </p>
          </div>
        )}
      </div>

      {/* Liste des comptes */}
      {isLoading && accounts.length === 0 ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <Mail className="mx-auto mb-2" size={32} />
          <p>Aucun compte configure.</p>
          <p className="text-sm">Cliquez sur "Nouveau compte" pour commencer.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white truncate">
                      {acc.accountName || acc.name || acc.emailAddress}
                    </span>
                    {acc.isDefault && (
                      <Badge color="amber" size="sm">
                        <Star size={10} className="mr-0.5" /> Defaut
                      </Badge>
                    )}
                    {acc.provider && (
                      <Badge color="blue" size="sm">{acc.provider}</Badge>
                    )}
                    {acc.hasOauth && (
                      <Badge color="green" size="sm">OAuth</Badge>
                    )}
                    {acc.hasPassword && !acc.hasOauth && (
                      <Badge color="gray" size="sm">
                        <Lock size={10} className="mr-0.5" /> Mot de passe
                      </Badge>
                    )}
                    {acc.syncEnabled ? (
                      <Badge color="green" size="sm">
                        <Zap size={10} className="mr-0.5" /> Sync auto
                      </Badge>
                    ) : (
                      <Badge color="gray" size="sm">
                        <ZapOff size={10} className="mr-0.5" /> Sync off
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 truncate">
                    {acc.emailAddress}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    IMAP {acc.imapServer || '-'}:{acc.imapPort || '-'} -
                    SMTP {acc.smtpServer || '-'}:{acc.smtpPort || '-'}
                  </p>
                  {acc.lastSyncAt && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                      Derniere sync: {acc.lastSyncAt}
                      {acc.lastSyncStatus && (
                        <> -- {acc.lastSyncStatus}</>
                      )}
                    </p>
                  )}
                  {acc.lastSyncError && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                      {acc.lastSyncError}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(acc.id)}
                    disabled={testingId === acc.id}
                    title="Tester la connexion IMAP/SMTP"
                  >
                    {testingId === acc.id ? <Spinner size="sm" /> : <Settings size={12} />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(acc)}
                    title="Modifier"
                  >
                    <Edit2 size={12} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmDelete(acc.id)}
                    title="Desactiver"
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
              {testResult?.accountId === acc.id && (
                <div className="mt-3 p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-xs">
                  <div className="flex items-center gap-2">
                    {testResult.result.imap.ok ? (
                      <Check size={12} className="text-green-600" />
                    ) : (
                      <X size={12} className="text-red-600" />
                    )}
                    <span className="font-medium">IMAP</span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {testResult.result.imap.ok
                        ? 'Connexion OK'
                        : testResult.result.imap.error}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {testResult.result.smtp.ok ? (
                      <Check size={12} className="text-green-600" />
                    ) : (
                      <X size={12} className="text-red-600" />
                    )}
                    <span className="font-medium">SMTP</span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {testResult.result.smtp.ok
                        ? 'Connexion OK'
                        : testResult.result.smtp.error}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal creation/edition */}
      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? 'Modifier le compte' : 'Nouveau compte email'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Nom du compte"
              value={form.accountName}
              onChange={(e) => setForm({ ...form, accountName: e.target.value })}
              required
              placeholder="Ex: Gmail principal"
            />
            <Input
              label="Adresse email"
              type="email"
              value={form.emailAddress}
              onChange={(e) => setForm({ ...form, emailAddress: e.target.value })}
              onBlur={handleEmailBlur}
              required
              disabled={!!editingId}
              placeholder="vous@exemple.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Fournisseur {detecting && <span className="text-xs text-gray-500">(detection en cours...)</span>}
            </label>
            <Select
              value={form.provider}
              onChange={(e) => fillFromProvider(e.target.value)}
              options={providers.map((p) => ({ value: p.name, label: p.name }))}
            />
            {provider?.instructions && (
              <p className="text-xs text-gray-500 mt-1">{provider.instructions}</p>
            )}
            {provider?.helpUrl && (
              <a
                href={provider.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                Guide de configuration {provider.name}
              </a>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-sm font-medium mb-2 text-gray-900 dark:text-white">
              IMAP (reception)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                label="Serveur"
                value={form.imapServer}
                onChange={(e) => setForm({ ...form, imapServer: e.target.value })}
                required
                placeholder="imap.gmail.com"
              />
              <Input
                label="Port"
                type="number"
                value={form.imapPort}
                onChange={(e) => setForm({ ...form, imapPort: parseInt(e.target.value, 10) || 993 })}
              />
              <Input
                label="Utilisateur"
                value={form.imapUsername}
                onChange={(e) => setForm({ ...form, imapUsername: e.target.value })}
                placeholder="(par defaut = email)"
              />
            </div>
            <label className="inline-flex items-center gap-2 mt-2 text-sm text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={form.imapUseSsl}
                onChange={(e) => setForm({ ...form, imapUseSsl: e.target.checked })}
              />
              SSL
            </label>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-sm font-medium mb-2 text-gray-900 dark:text-white">
              SMTP (envoi)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                label="Serveur"
                value={form.smtpServer}
                onChange={(e) => setForm({ ...form, smtpServer: e.target.value })}
                required
                placeholder="smtp.gmail.com"
              />
              <Input
                label="Port"
                type="number"
                value={form.smtpPort}
                onChange={(e) => setForm({ ...form, smtpPort: parseInt(e.target.value, 10) || 587 })}
              />
              <Input
                label="Utilisateur"
                value={form.smtpUsername}
                onChange={(e) => setForm({ ...form, smtpUsername: e.target.value })}
                placeholder="(par defaut = email)"
              />
            </div>
            <label className="inline-flex items-center gap-2 mt-2 text-sm text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={form.smtpUseTls}
                onChange={(e) => setForm({ ...form, smtpUseTls: e.target.checked })}
              />
              STARTTLS
            </label>
          </div>

          <Input
            label={
              editingId
                ? 'Nouveau mot de passe (laisser vide pour conserver)'
                : 'Mot de passe applicatif'
            }
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={editingId ? '(inchange)' : ''}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Textarea
              label="Signature HTML"
              value={form.signatureHtml}
              onChange={(e) => setForm({ ...form, signatureHtml: e.target.value })}
              rows={3}
              placeholder="<p>Cordialement,<br>Mon equipe</p>"
            />
            <Textarea
              label="Signature texte"
              value={form.signatureText}
              onChange={(e) => setForm({ ...form, signatureText: e.target.value })}
              rows={3}
              placeholder="-- Cordialement, Mon equipe"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.syncEnabled}
                onChange={(e) => setForm({ ...form, syncEnabled: e.target.checked })}
              />
              Synchronisation auto
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Compte par defaut
            </label>
            <Input
              label="Dossiers a sync"
              value={form.syncFolders}
              onChange={(e) => setForm({ ...form, syncFolders: e.target.value })}
              placeholder="INBOX"
            />
          </div>

          {!editingId && !form.password && (
            <Alert type="warning">
              <AlertTriangle size={14} className="inline mr-1" />
              Aucun mot de passe fourni. Utilisez OAuth (boutons en haut)
              ou saisissez un mot de passe applicatif pour activer
              IMAP/SMTP.
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowForm(false)}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Spinner size="sm" /> : (editingId ? 'Enregistrer' : 'Creer')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation suppression */}
      <Modal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Desactiver ce compte ?"
        size="sm"
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Le compte sera desactive (soft-delete). Les emails restent accessibles
          en lecture mais le compte ne pourra plus envoyer ni synchroniser.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="outline"
            onClick={() => setConfirmDelete(null)}
          >
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => confirmDelete !== null && handleDelete(confirmDelete)}
          >
            Desactiver
          </Button>
        </div>
      </Modal>
    </div>
  );
}
