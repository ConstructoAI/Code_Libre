/**
 * Panneau Assistant IA pour la lecture d'un email recu.
 *
 * 3 boutons:
 *   - "Analyser" -> urgence/type/sentiment + actions a faire
 *   - "Suggerer une reponse" -> 2 versions, l'utilisateur choisit/edite/envoie
 *   - "Repondre automatiquement" -> envoi sans validation (avec confirmation)
 *
 * Utilise le contexte BD CRM/ERP (devis, projets, factures, BT, opportunites,
 * historique emails) pour personnaliser les reponses.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Send, AlertTriangle, Check, Database,
  MessageCircleReply, Bot, Loader2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import * as emailsApi from '@/api/emails';
import type {
  EmailMessage, EmailAccount, AITone,
  AISuggestReplyResponse, AIAnalyzeResponse, AIAutoReplyResponse,
} from '@/api/emails';

interface Props {
  email: EmailMessage;
  accounts: EmailAccount[];
  onUseSuggestion: (subject: string, body: string, accountId?: number) => void;
}

export function EmailAIPanel({ email, accounts, onUseSuggestion }: Props) {
  const [tone, setTone] = useState<AITone>('professionnel');
  const [extraContext, setExtraContext] = useState('');
  const [accountId, setAccountId] = useState<number | undefined>(undefined);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyze, setAnalyze] = useState<AIAnalyzeResponse | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<AISuggestReplyResponse | null>(null);

  const [autoReplying, setAutoReplying] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [autoResult, setAutoResult] = useState<AIAutoReplyResponse | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Annulation reseau + invalidation par email.id pour eviter qu'une reponse
  // IA pour email A s'applique a l'UI de email B (race cross-emails). Le
  // simple reset de state ne suffit pas: la closure async garde sa reference
  // et ecrase quand meme l'UI au moment du resolve.
  const abortAnalyzeRef = useRef<AbortController | null>(null);
  const abortSuggestRef = useRef<AbortController | null>(null);
  const abortAutoRef = useRef<AbortController | null>(null);
  const currentEmailIdRef = useRef(email.id);

  useEffect(() => {
    currentEmailIdRef.current = email.id;
    abortAnalyzeRef.current?.abort();
    abortSuggestRef.current?.abort();
    abortAutoRef.current?.abort();
    abortAnalyzeRef.current = null;
    abortSuggestRef.current = null;
    abortAutoRef.current = null;

    setAnalyze(null);
    setSuggestions(null);
    setAutoResult(null);
    setError(null);
    setExtraContext('');
    setAccountId(undefined);
    setAnalyzing(false);
    setSuggesting(false);
    setAutoReplying(false);
    setConfirmAuto(false);
  }, [email.id]);

  // Cleanup au unmount: abort tous les appels IA en flight (eviter de
  // gaspiller des credits Anthropic + setState sur composant demonte si
  // l'utilisateur change de dossier ou ferme la page).
  useEffect(() => {
    return () => {
      abortAnalyzeRef.current?.abort();
      abortSuggestRef.current?.abort();
      abortAutoRef.current?.abort();
    };
  }, []);

  const _isCancelError = (err: unknown): boolean =>
    Boolean(err && typeof err === 'object' && (
      (err as { name?: string }).name === 'CanceledError'
      || (err as { code?: string }).code === 'ERR_CANCELED'
    ));

  const externalAccounts = useMemo(
    () => accounts.filter(
      (a) => a.active !== false && (!a.provider || a.provider !== 'INTERNAL'),
    ),
    [accounts],
  );

  const _extractError = (err: unknown): string => {
    if (err && typeof err === 'object' && 'response' in err) {
      const r = (err as { response?: { data?: { detail?: string } } }).response;
      if (r?.data?.detail) return r.data.detail;
    }
    if (err instanceof Error) return err.message;
    return 'Erreur IA';
  };

  const handleAnalyze = async () => {
    abortAnalyzeRef.current?.abort();
    const controller = new AbortController();
    abortAnalyzeRef.current = controller;
    const callEmailId = email.id;

    setError(null);
    setAnalyzing(true);
    try {
      const res = await emailsApi.aiAnalyzeEmail(callEmailId, controller.signal);
      if (callEmailId !== currentEmailIdRef.current) return;
      setAnalyze(res);
    } catch (err) {
      if (callEmailId !== currentEmailIdRef.current || _isCancelError(err)) return;
      setError(_extractError(err));
    } finally {
      if (callEmailId === currentEmailIdRef.current) setAnalyzing(false);
    }
  };

  const handleSuggest = async () => {
    abortSuggestRef.current?.abort();
    const controller = new AbortController();
    abortSuggestRef.current = controller;
    const callEmailId = email.id;

    setError(null);
    setSuggesting(true);
    try {
      const res = await emailsApi.aiSuggestReply(
        callEmailId, tone, extraContext.trim() || undefined, controller.signal,
      );
      if (callEmailId !== currentEmailIdRef.current) return;
      setSuggestions(res);
    } catch (err) {
      if (callEmailId !== currentEmailIdRef.current || _isCancelError(err)) return;
      setError(_extractError(err));
    } finally {
      if (callEmailId === currentEmailIdRef.current) setSuggesting(false);
    }
  };

  const handleAutoReply = async () => {
    abortAutoRef.current?.abort();
    const controller = new AbortController();
    abortAutoRef.current = controller;
    const callEmailId = email.id;

    setConfirmAuto(false);
    setError(null);
    setAutoReplying(true);
    setAutoResult(null);
    try {
      const res = await emailsApi.aiAutoReply(
        callEmailId, tone, accountId, extraContext.trim() || undefined, controller.signal,
      );
      if (callEmailId !== currentEmailIdRef.current) return;
      setAutoResult(res);
    } catch (err) {
      if (callEmailId !== currentEmailIdRef.current || _isCancelError(err)) return;
      setError(_extractError(err));
    } finally {
      if (callEmailId === currentEmailIdRef.current) setAutoReplying(false);
    }
  };

  return (
    <div className="rounded-lg border border-purple-200 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-purple-600 dark:text-purple-300" />
        <span className="text-sm font-medium text-purple-900 dark:text-purple-200">
          Assistant IA Construction
        </span>
        <Badge color="purple" size="sm">Claude</Badge>
      </div>

      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Options -- 1-col mobile, 2-col tablet, 3-col desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        <Select
          label="Ton"
          value={tone}
          onChange={(e) => setTone(e.target.value as AITone)}
          options={[
            { value: 'professionnel', label: 'Professionnel' },
            { value: 'cordial', label: 'Cordial' },
            { value: 'formel', label: 'Formel' },
          ]}
        />
        <Select
          label="Compte expediteur (auto-reply)"
          value={accountId !== undefined ? String(accountId) : ''}
          onChange={(e) => setAccountId(e.target.value ? parseInt(e.target.value, 10) : undefined)}
          options={[
            { value: '', label: 'Defaut (compte par defaut)' },
            ...externalAccounts.map((a) => ({
              value: String(a.id),
              label: `${a.accountName || a.emailAddress}`,
            })),
          ]}
        />
        <Textarea
          label="Contexte additionnel (optionnel)"
          value={extraContext}
          onChange={(e) => setExtraContext(e.target.value)}
          rows={2}
          placeholder="Ex: nous sommes en rupture sur ce produit"
        />
      </div>

      {/* 3 boutons IA -- 1-col mobile, 2-col tablet, 3-col desktop.
          Boutons full-width avec text-sm pour ne pas deborder mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleAnalyze}
          disabled={analyzing}
          className="w-full justify-center text-sm"
        >
          {analyzing ? <Spinner size="sm" /> : <Sparkles size={14} className="mr-1" />}
          Analyser
        </Button>
        <Button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting}
          className="w-full justify-center text-sm"
        >
          {suggesting ? <Spinner size="sm" /> : <MessageCircleReply size={14} className="mr-1" />}
          Suggerer une reponse
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => setConfirmAuto(true)}
          disabled={autoReplying}
          title="Envoie automatiquement la reponse de l'IA -- a utiliser avec parcimonie"
          className="w-full justify-center text-sm"
        >
          {autoReplying ? <Spinner size="sm" /> : <Send size={14} className="mr-1" />}
          Repondre auto
        </Button>
      </div>

      {/* Resultat ANALYZE */}
      {analyze && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-800 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {analyze.urgence && (
              <Badge color={
                analyze.urgence === 'haute' ? 'red'
                  : analyze.urgence === 'moyenne' ? 'amber' : 'green'
              } size="sm">
                Urgence: {analyze.urgence}
              </Badge>
            )}
            {analyze.type && <Badge color="blue" size="sm">{analyze.type}</Badge>}
            {analyze.sentiment && (
              <Badge color={
                analyze.sentiment === 'positif' ? 'green'
                  : analyze.sentiment === 'negatif' ? 'red' : 'gray'
              } size="sm">
                {analyze.sentiment}
              </Badge>
            )}
          </div>
          {analyze.resume && (
            <p className="text-sm text-gray-700 dark:text-gray-300">{analyze.resume}</p>
          )}
          {analyze.actionsRequises && analyze.actionsRequises.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Actions requises:
              </p>
              <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                {analyze.actionsRequises.map((a, i) => (
                  <li key={i}>
                    • {a.action} <span className="text-xs text-gray-500">({a.echeance})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analyze.alertes && analyze.alertes.length > 0 && (
            <div className="rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-2">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <AlertTriangle size={12} /> Alertes
              </p>
              {analyze.alertes.map((a, i) => (
                <p key={i} className="text-xs text-amber-700 dark:text-amber-300">• {a}</p>
              ))}
            </div>
          )}
          {/* Fallback si Claude a renvoye du texte non parseable */}
          {!analyze.urgence && !analyze.resume && !analyze.actionsRequises?.length
            && !analyze.alertes?.length && analyze.raw && (
              <Alert type="warning">
                Reponse IA non parseable: {analyze.raw.slice(0, 200)}...
              </Alert>
            )}
          {!analyze.urgence && !analyze.resume && !analyze.actionsRequises?.length
            && !analyze.alertes?.length && !analyze.raw && (
              <p className="text-xs text-gray-500">Aucune analyse disponible.</p>
            )}
        </div>
      )}

      {/* Resultat SUGGESTIONS */}
      {suggestions && (
        <div className="space-y-2">
          {suggestions.dbContextUsed && (
            <div className="flex items-center gap-1 text-xs text-purple-700 dark:text-purple-300">
              <Database size={12} />
              Donnees CRM utilisees pour personnaliser
            </div>
          )}
          {suggestions.contexteClient?.clientConnu && suggestions.contexteClient?.resume && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              <strong>Client:</strong> {suggestions.contexteClient.resume}
            </p>
          )}
          {suggestions.suggestions && suggestions.suggestions.length > 0 ? (
            suggestions.suggestions.map((s, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
              >
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {s.titre}
                    </span>
                    <Badge color="gray" size="sm">{s.longueur}</Badge>
                    {s.donneesUtilisees && s.donneesUtilisees.length > 0 && (
                      <Badge color="purple" size="sm">
                        {s.donneesUtilisees.slice(0, 2).join(', ')}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onUseSuggestion(s.sujet, s.corps, accountId)}
                  >
                    Utiliser
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mb-1">Sujet: {s.sujet}</p>
                <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
                  {s.corps}
                </pre>
              </div>
            ))
          ) : suggestions.raw ? (
            <Alert type="warning">
              IA n'a pas retourne un JSON parseable. Texte brut: {suggestions.raw.slice(0, 200)}...
            </Alert>
          ) : null}
          {Boolean(suggestions.aInclure?.length || suggestions.aEviter?.length) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {suggestions.aInclure && suggestions.aInclure.length > 0 && (
                <div className="rounded bg-green-50 dark:bg-green-900/20 p-2">
                  <p className="text-xs font-medium text-green-800 dark:text-green-300 mb-1">
                    A inclure
                  </p>
                  {suggestions.aInclure.map((x, i) => (
                    <p key={i} className="text-xs text-green-700 dark:text-green-300">• {x}</p>
                  ))}
                </div>
              )}
              {suggestions.aEviter && suggestions.aEviter.length > 0 && (
                <div className="rounded bg-red-50 dark:bg-red-900/20 p-2">
                  <p className="text-xs font-medium text-red-800 dark:text-red-300 mb-1">
                    A eviter
                  </p>
                  {suggestions.aEviter.map((x, i) => (
                    <p key={i} className="text-xs text-red-700 dark:text-red-300">• {x}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Resultat AUTO-REPLY */}
      {autoResult && (
        <div className={`rounded-lg border p-3 ${
          autoResult.sent
            ? 'border-green-200 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10'
            : 'border-red-200 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {autoResult.sent ? (
              <>
                <Check size={14} className="text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-green-800 dark:text-green-300">
                  Reponse envoyee automatiquement
                </span>
              </>
            ) : (
              <>
                <X size={14} className="text-red-600 dark:text-red-400" />
                <span className="text-sm font-medium text-red-800 dark:text-red-300">
                  Echec d'envoi
                </span>
              </>
            )}
            {autoResult.confiance && (
              <Badge color={
                autoResult.confiance === 'haute' ? 'green'
                  : autoResult.confiance === 'moyenne' ? 'amber' : 'red'
              } size="sm">
                Confiance: {autoResult.confiance}
              </Badge>
            )}
          </div>
          {autoResult.subject && (
            <p className="text-xs text-gray-600 dark:text-gray-400">Sujet: {autoResult.subject}</p>
          )}
          {autoResult.body && (
            <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans mt-1 max-h-48 overflow-y-auto">
              {autoResult.body}
            </pre>
          )}
          {autoResult.raisonConfiance && (
            <p className="text-xs text-gray-500 mt-1 italic">
              Note IA: {autoResult.raisonConfiance}
            </p>
          )}
          {autoResult.smtpError && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">SMTP error: {autoResult.smtpError}</p>
          )}
        </div>
      )}

      {/* Modal confirmation auto-reply */}
      <Modal
        isOpen={confirmAuto}
        onClose={() => setConfirmAuto(false)}
        title="Repondre automatiquement avec l'IA ?"
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            L'IA va <strong>generer ET envoyer</strong> une reponse a{' '}
            <strong>{email.emailFrom}</strong> sans validation manuelle.
          </p>
          <Alert type="warning">
            Cette action est <strong>irreversible</strong>. Verifiez que le contexte
            BD est suffisant et que la reponse n'engage pas de donnees critiques
            (montants, dates contractuelles, engagements legaux).
          </Alert>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setConfirmAuto(false)}>
              Annuler
            </Button>
            <Button type="button" variant="danger" onClick={handleAutoReply} disabled={autoReplying}>
              {autoReplying ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} className="mr-1" />}
              Confirmer et envoyer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
