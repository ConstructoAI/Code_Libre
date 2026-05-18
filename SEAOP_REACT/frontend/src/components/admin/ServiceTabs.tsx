/**
 * SEAOP React Frontend - Admin Estimation Requests Panel
 *
 * Displays all estimation requests submitted via the public wizard.
 * The admin (Sylvain) reviews each, sends a manual estimation by email,
 * and marks the request as processed. Formerly a 4-type tab panel —
 * now simplified to a single list since only the Estimation service
 * remains.
 */

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  Calculator,
  RefreshCw,
  CheckCircle,
  XCircle,
  Download,
  File as FileIcon,
  Mail,
  MailCheck,
  Phone,
  MapPin,
  Clock,
  Send,
  Zap,
  X,
  FolderDown,
  Image as ImageIcon,
} from 'lucide-react';
import {
  adminListEstimationRequests,
  adminGetEstimationRequest,
  adminUpdateEstimationRequest,
  adminDownloadEstimationPlan,
  adminGetEmailStatus,
  adminSendTestEmail,
  adminResendClientEmail,
  type EmailStatusResponse,
} from '@/api/services';
import { Input } from '@/components/ui/Input';
import { Badge, type BadgeColor } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { formatDate } from '@/utils/format';

// ============ Status Helpers ============

const STATUS_COLORS: Record<string, BadgeColor> = {
  nouvelle: 'blue',
  en_analyse: 'yellow',
  estimation_envoyee: 'green',
  refusee: 'red',
  archivee: 'gray',
};

const STATUS_LABELS: Record<string, string> = {
  nouvelle: 'Nouvelle',
  en_analyse: 'En analyse',
  estimation_envoyee: 'Estimation envoyée',
  refusee: 'Refusée',
  archivee: 'Archivée',
};

function getStatusColor(statut: string): BadgeColor {
  return STATUS_COLORS[statut] ?? 'gray';
}

function getStatusLabel(statut: string): string {
  return STATUS_LABELS[statut] ?? statut;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 o';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${(mb ?? 0).toFixed(1)} Mo`;
  return `${(bytes / 1024).toFixed(0)} Ko`;
}

interface PlanMeta {
  id: string;
  filename: string;
  size: number;
}

// ============ Component ============

export default function ServiceTabs() {
  const [requests, setRequests] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notes, setNotes] = useState('');

  // SMTP diagnostic state
  const [emailStatus, setEmailStatus] = useState<EmailStatusResponse | null>(null);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{
    success: boolean;
    detail: string;
  } | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminListEstimationRequests();
      setRequests(data);
    } catch {
      setError('Impossible de charger les demandes d\'estimation');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    let cancelled = false;
    adminGetEmailStatus()
      .then((s) => {
        if (!cancelled) setEmailStatus(s);
      })
      .catch(() => {
        // Non-super-admins get 403 here — silently hide the diagnostic panel.
        if (!cancelled) setEmailStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSendTestEmail = useCallback(async () => {
    if (!testEmailTo.trim()) return;
    setTestEmailLoading(true);
    setTestEmailResult(null);
    try {
      const result = await adminSendTestEmail(testEmailTo.trim());
      setTestEmailResult({ success: result.success, detail: result.detail });
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string | Array<{ msg: string }> } };
      };
      const detail = axiosErr.response?.data?.detail;
      const message = Array.isArray(detail)
        ? detail.map((d) => d.msg).join(', ')
        : typeof detail === 'string'
          ? detail
          : "Erreur lors de l'envoi du courriel de test.";
      setTestEmailResult({ success: false, detail: message });
    } finally {
      setTestEmailLoading(false);
    }
  }, [testEmailTo]);

  const openDetail = useCallback(async (id: number) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await adminGetEstimationRequest(id);
      setDetail(data);
      setNotes(String(data.notesInternes ?? ''));
    } catch {
      setError('Impossible de charger la demande');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setNotes('');
    setResendResult(null);
  }, []);

  const handleUpdateStatus = useCallback(
    async (id: number, newStatut: string) => {
      try {
        await adminUpdateEstimationRequest(id, {
          statut: newStatut,
          notesInternes: notes || undefined,
        });
        await fetchRequests();
        if (selectedId === id) {
          const refreshed = await adminGetEstimationRequest(id);
          setDetail(refreshed);
        }
      } catch {
        setError('Erreur lors de la mise à jour');
      }
    },
    [notes, selectedId, fetchRequests],
  );

  const handleDownloadPlan = useCallback(
    async (id: number, plan: PlanMeta) => {
      try {
        await adminDownloadEstimationPlan(id, plan.id, plan.filename);
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Impossible de télécharger le plan.';
        setError(message);
      }
    },
    [],
  );

  /**
   * Trigger a download for a single photo stored as a base64 data URL.
   * Extracts the MIME subtype ("jpeg", "png", "webp") to build a
   * sensible filename. No backend round-trip needed — data URLs are
   * directly assignable to <a href="..." download>.
   */
  const handleDownloadPhoto = useCallback(
    (dataUrl: string, index: number, reference: string) => {
      try {
        const mimeMatch = /^data:(image\/[a-z+]+);/i.exec(dataUrl);
        const ext = mimeMatch
          ? mimeMatch[1].split('/')[1].replace('+xml', '').toLowerCase()
          : 'jpg';
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `${reference || 'photo'}-photo-${index + 1}.${ext}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Impossible de télécharger la photo.';
        setError(message);
      }
    },
    [],
  );

  /**
   * Download every attachment (photos + PDFs) sequentially with a short
   * delay between each. Browsers rate-limit rapid download triggers, so
   * we space them out by ~250 ms. The admin gets N separate "Save As"
   * files — simpler than zipping client-side (would require jszip).
   */
  const handleDownloadAll = useCallback(
    async (
      id: number,
      reference: string,
      photos: string[],
      plans: PlanMeta[],
    ) => {
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));
      try {
        for (let i = 0; i < photos.length; i++) {
          handleDownloadPhoto(photos[i], i, reference);
          await sleep(250);
        }
        for (const plan of plans) {
          await adminDownloadEstimationPlan(id, plan.id, plan.filename);
          await sleep(250);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Échec du téléchargement des pièces jointes.';
        setError(message);
      }
    },
    [handleDownloadPhoto],
  );

  /**
   * Re-send the confirmation email to the client. Useful when the initial
   * send was silently dropped (Gmail spam, SPF/DKIM issue). Shows a banner
   * with the target address and whether SMTP reported success.
   */
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendResult, setResendResult] = useState<{ sent: boolean; email: string } | null>(null);

  const handleResendClientEmail = useCallback(
    async (id: number) => {
      setResendingEmail(true);
      setResendResult(null);
      try {
        const result = await adminResendClientEmail(id);
        setResendResult(result);
      } catch (err: unknown) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Échec de l\'envoi de l\'email client.';
        setError(message);
      } finally {
        setResendingEmail(false);
      }
    },
    [],
  );

  // ============ Render ============

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-seaop-primary-600" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Demandes d&apos;estimation
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCw className="h-4 w-4" />}
          onClick={fetchRequests}
          disabled={isLoading}
        >
          Actualiser
        </Button>
      </div>

      {error && (
        <Alert type="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* SMTP diagnostic — lets the admin verify email delivery without Render logs */}
      {emailStatus && (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              {emailStatus.configured ? (
                <MailCheck className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              ) : (
                <Mail className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
              )}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Courriels — diagnostic
                </h4>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {emailStatus.configured ? (
                    <>
                      SMTP configuré sur <strong>{emailStatus.smtpHost}</strong>{' '}
                      — expéditeur{' '}
                      <strong>{emailStatus.smtpUser ?? '—'}</strong>. Alertes
                      admin envoyées à{' '}
                      <strong>{emailStatus.adminNotificationEmail}</strong>.
                    </>
                  ) : (
                    <>
                      SMTP <strong>non configuré</strong>. Les clients ne
                      reçoivent pas les courriels de confirmation. Définissez
                      SMTP_HOST, SMTP_USER et SMTP_PASSWORD dans les variables
                      d&apos;environnement du service Render SEAOP.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Envoyer un courriel de test à"
                type="email"
                placeholder="vous@exemple.com"
                value={testEmailTo}
                onChange={(e) => {
                  setTestEmailTo(e.target.value);
                  // Clear the stale Alert once the admin edits the address
                  if (testEmailResult) setTestEmailResult(null);
                }}
                disabled={!emailStatus.configured || testEmailLoading}
              />
            </div>
            <Button
              variant="secondary"
              leftIcon={<Send className="h-4 w-4" />}
              isLoading={testEmailLoading}
              onClick={handleSendTestEmail}
              disabled={!emailStatus.configured || !testEmailTo.trim()}
            >
              Envoyer le test
            </Button>
          </div>
          {testEmailResult && (
            <div className="mt-3">
              <Alert
                type={testEmailResult.success ? 'success' : 'error'}
                onClose={() => setTestEmailResult(null)}
              >
                {testEmailResult.detail}
              </Alert>
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            Aucune demande d&apos;estimation pour le moment.
          </div>
        </Card>
      ) : (
        <Card padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Référence
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Client
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Corps de métier
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Secteur
                  </th>
                  <th className="text-center py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Urgence
                  </th>
                  <th className="text-center py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Statut
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Date
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {requests.map((req, idx) => {
                  const id = Number(req.id ?? idx);
                  const statut = String(req.statut ?? 'nouvelle');
                  const ref = String(req.numeroReference ?? `EST-${id}`);
                  const nom = `${String(req.prenom ?? '')} ${String(req.nom ?? '')}`.trim() || '—';
                  const metier = String(req.corpsMetier ?? '—');
                  const secteur = String(req.secteur ?? '—');
                  const urgence = String(req.urgence ?? 'normal');
                  const date = String(req.dateCreation ?? '');
                  return (
                    <tr
                      key={id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-seaop-primary-600 dark:text-seaop-primary-400">
                        {ref}
                      </td>
                      <td className="py-3 px-4 text-gray-900 dark:text-gray-100">
                        <div>{nom}</div>
                        <div className="text-xs text-gray-500">{String(req.email ?? '')}</div>
                      </td>
                      <td className="py-3 px-4 text-gray-600 dark:text-gray-400">{metier}</td>
                      <td className="py-3 px-4 text-gray-600 dark:text-gray-400">{secteur}</td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 text-xs',
                            urgence === 'urgent'
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-gray-500',
                          )}
                        >
                          {urgence === 'urgent' ? <Zap size={12} /> : <Clock size={12} />}
                          {urgence === 'urgent' ? 'Urgent' : 'Normal'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge color={getStatusColor(statut)} size="sm">
                          {getStatusLabel(statut)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(date)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openDetail(id)}
                        >
                          Détails
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={selectedId !== null}
        title={
          detail?.numeroReference
            ? `Demande ${String(detail.numeroReference)}`
            : 'Détail de la demande'
        }
        onClose={closeDetail}
        size="lg"
      >
        {detailLoading ? (
          <div className="flex justify-center py-10">
            <Spinner size="md" />
          </div>
        ) : detail ? (
          <div className="space-y-4 text-sm">
            {/* Client info */}
            <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Client</h4>
              <div className="grid sm:grid-cols-2 gap-2 text-gray-600 dark:text-gray-400">
                <div>
                  <span className="font-medium">Nom : </span>
                  {String(detail.prenom ?? '')} {String(detail.nom ?? '')}
                </div>
                <div>
                  <span className="font-medium">Entreprise : </span>
                  {String(detail.entreprise ?? '—')}
                </div>
                <div className="flex items-center gap-1">
                  <Mail size={14} />
                  <a href={`mailto:${detail.email}`} className="text-seaop-primary-600 hover:underline">
                    {String(detail.email ?? '')}
                  </a>
                </div>
                <div className="flex items-center gap-1">
                  <Phone size={14} />
                  <a href={`tel:${detail.telephone}`} className="text-seaop-primary-600 hover:underline">
                    {String(detail.telephone ?? '')}
                  </a>
                </div>
              </div>
            </div>

            {/* Project info */}
            <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Projet</h4>
              <div className="grid sm:grid-cols-2 gap-2 text-gray-600 dark:text-gray-400">
                <div>
                  <span className="font-medium">Corps de métier : </span>
                  {String(detail.corpsMetier ?? '—')}
                </div>
                <div>
                  <span className="font-medium">Secteur : </span>
                  {String(detail.secteur ?? '—')}
                </div>
                <div>
                  <span className="font-medium">Type : </span>
                  {String(detail.typeProjet ?? '—')}
                </div>
                <div>
                  <span className="font-medium">Superficie : </span>
                  {String(detail.superficie ?? '—')}
                </div>
                <div>
                  <span className="font-medium">Budget : </span>
                  {String(detail.budgetEstime ?? '—')}
                </div>
                <div>
                  <span className="font-medium">Délai : </span>
                  {String(detail.delai ?? '—')}
                </div>
                <div>
                  <span className="font-medium">Urgence : </span>
                  {String(detail.urgence ?? '—')}
                </div>
                <div>
                  <span className="font-medium">Disponibilité : </span>
                  {String(detail.disponibilite ?? '—')}
                  {detail.dateSouhaitee ? ` (${String(detail.dateSouhaitee)})` : ''}
                </div>
              </div>
              {Boolean(detail.codePostal || detail.localisation) && (
                <div className="mt-2 flex items-center gap-1 text-gray-600 dark:text-gray-400">
                  <MapPin size={14} />
                  <span>
                    {String(detail.codePostal ?? '')} {String(detail.localisation ?? '')}
                  </span>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Description
              </h4>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {String(detail.description ?? '')}
              </p>
            </div>

            {/* Bulk download action — visible only if any attachment exists */}
            {((Array.isArray(detail.photos) && detail.photos.length > 0) ||
              (Array.isArray(detail.plans) && detail.plans.length > 0)) && (
              <div className="flex items-center justify-between rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-semibold">Pièces jointes&nbsp;:</span>{' '}
                  {Array.isArray(detail.photos) ? detail.photos.length : 0} photo(s)
                  {' · '}
                  {Array.isArray(detail.plans) ? detail.plans.length : 0} PDF
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<FolderDown className="h-4 w-4" />}
                  onClick={() => {
                    if (!selectedId) return;
                    const photos = Array.isArray(detail.photos)
                      ? (detail.photos as string[])
                      : [];
                    const plansRaw = Array.isArray(detail.plans)
                      ? (detail.plans as Array<Record<string, unknown>>)
                      : [];
                    const plans: PlanMeta[] = plansRaw
                      .map((raw) => ({
                        id: String(raw.id ?? ''),
                        filename: String(raw.filename ?? 'plan.pdf'),
                        size: Number(raw.size ?? 0),
                      }))
                      .filter((p) => p.id);
                    void handleDownloadAll(
                      selectedId,
                      String(detail.numeroReference ?? `req-${selectedId}`),
                      photos,
                      plans,
                    );
                  }}
                >
                  Tout télécharger
                </Button>
              </div>
            )}

            {/* Photos */}
            {Array.isArray(detail.photos) && detail.photos.length > 0 && (
              <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Photos ({(detail.photos as unknown[]).length})
                </h4>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {(detail.photos as string[]).map((src, idx) => (
                    <div
                      key={idx}
                      className="relative group rounded overflow-hidden border border-gray-200 dark:border-gray-700"
                    >
                      <a
                        href={src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                        title="Ouvrir dans un nouvel onglet"
                      >
                        <img
                          src={src}
                          alt={`photo ${idx + 1}`}
                          className="w-full h-20 object-cover group-hover:opacity-80"
                        />
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadPhoto(
                            src,
                            idx,
                            String(detail.numeroReference ?? `req-${selectedId ?? ''}`),
                          )
                        }
                        className="absolute bottom-1 right-1 rounded-full bg-white/90 dark:bg-gray-800/90 p-1.5 shadow opacity-0 group-hover:opacity-100 transition-opacity text-gray-700 dark:text-gray-200 hover:text-[#0078D4]"
                        aria-label={`Télécharger la photo ${idx + 1}`}
                        title="Télécharger"
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Plans PDF */}
            {Array.isArray(detail.plans) && detail.plans.length > 0 && (
              <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Plans PDF ({(detail.plans as unknown[]).length})
                </h4>
                <ul className="space-y-2">
                  {(detail.plans as Array<Record<string, unknown>>).map((raw) => {
                    const plan: PlanMeta = {
                      id: String(raw.id ?? ''),
                      filename: String(raw.filename ?? 'plan.pdf'),
                      size: Number(raw.size ?? 0),
                    };
                    if (!plan.id) return null;
                    return (
                      <li
                        key={plan.id}
                        className="flex items-center gap-3 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2"
                      >
                        <FileIcon className="h-5 w-5 text-red-600 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-gray-900 dark:text-gray-100">
                            {plan.filename}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatBytes(plan.size)}
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<Download className="h-4 w-4" />}
                          onClick={() =>
                            selectedId && handleDownloadPlan(selectedId, plan)
                          }
                        >
                          Télécharger
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Admin notes + actions */}
            <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Notes internes
              </h4>
              <Textarea
                rows={3}
                placeholder="Notes privées (non visibles par le client)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
              />
            </div>

            {resendResult && (
              <Alert
                type={resendResult.sent ? 'success' : 'error'}
                onClose={() => setResendResult(null)}
              >
                {resendResult.sent
                  ? `Email client renvoyé à ${resendResult.email}. Si le client ne le voit pas, vérifier son dossier Spam/Courrier indésirable.`
                  : `Échec du renvoi de l'email à ${resendResult.email}. Vérifier la configuration SMTP côté serveur.`}
              </Alert>
            )}

            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                variant="ghost"
                leftIcon={<X className="h-4 w-4" />}
                onClick={closeDetail}
              >
                Fermer
              </Button>
              <Button
                variant="secondary"
                leftIcon={<Mail className="h-4 w-4" />}
                onClick={() => selectedId && handleResendClientEmail(selectedId)}
                isLoading={resendingEmail}
                disabled={resendingEmail}
                title="Renvoyer la confirmation d'estimation au client"
              >
                Renvoyer au client
              </Button>
              <Button
                variant="secondary"
                leftIcon={<XCircle className="h-4 w-4" />}
                onClick={() => selectedId && handleUpdateStatus(selectedId, 'refusee')}
              >
                Refuser
              </Button>
              <Button
                variant="primary"
                leftIcon={<CheckCircle className="h-4 w-4" />}
                onClick={() => selectedId && handleUpdateStatus(selectedId, 'estimation_envoyee')}
              >
                Marquer comme envoyée
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-gray-500">Aucune donnée</div>
        )}
      </Modal>
    </div>
  );
}
