/**
 * Bouton "Rediger avec IA" pour la modal Nouveau Message.
 *
 * Permet a l'utilisateur de rediger un email FROM SCRATCH a partir
 * d'instructions libres en francais. Utilise /ai/draft avec le contexte
 * BD du destinataire (si fourni) pour personnaliser.
 *
 * UX:
 *   1. User clique "Rediger avec IA"
 *   2. Modal interne s'ouvre: textarea instructions + select ton + champ
 *      destinataire (auto-prefilled si user a deja rempli "A:")
 *   3. User valide -> POST /emails/ai/draft -> reponse JSON {sujet, corps,
 *      versionCourte, meilleurMomentEnvoi, raw?}
 *   4. Le sujet et corps sont appliques au compose modal parent
 *   5. User peut editer puis envoyer
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Bot, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/Alert';
import { Textarea } from '@/components/ui/Textarea';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import * as emailsApi from '@/api/emails';
import type { AITone, AIDraftResponse } from '@/api/emails';

interface Props {
  recipientEmail?: string;  // Pré-rempli depuis "A:" du compose
  onApply: (subject: string, body: string) => void;
}

export function EmailAIComposeButton({ recipientEmail, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [tone, setTone] = useState<AITone>('professionnel');
  const [recipient, setRecipient] = useState(recipientEmail || '');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<AIDraftResponse | null>(null);

  // Compteur d'appels: chaque generation incremente. Seule la reponse de
  // l'appel le plus recent est appliquee. Couvre le cas close+reopen avant
  // arrivee de la reponse precedente (un simple booleen cancelled serait
  // remis a false par handleOpen et laisserait la stale response s'appliquer).
  const genIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup au unmount: abort la requete IA en flight (eviter de gaspiller
  // des credits Anthropic si la modal compose parent est demontee avant la
  // reponse).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleOpen = () => {
    setOpen(true);
    setError(null);
    setGenerated(null);
    setGenerating(false);
    // Toujours synchroniser depuis la prop pour eviter qu'un destinataire
    // saisi precedemment reste si l'utilisateur a vide le champ "A:" entre
    // deux ouvertures (sinon contexte CRM serait recupere pour la mauvaise
    // personne).
    setRecipient(recipientEmail || '');
  };

  const handleClose = () => {
    // Invalide tous les appels en flight et abort la requete reseau.
    genIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setInstructions('');
    setGenerated(null);
    setError(null);
    setGenerating(false);
  };

  const _extractError = (err: unknown): string => {
    if (err && typeof err === 'object' && 'response' in err) {
      const r = (err as { response?: { data?: { detail?: string } } }).response;
      if (r?.data?.detail) return r.data.detail;
    }
    if (err instanceof Error) return err.message;
    return 'Erreur IA';
  };

  const handleGenerate = async () => {
    if (instructions.trim().length < 5) {
      setError('Instructions trop courtes (minimum 5 caracteres)');
      return;
    }
    // Annule l'appel precedent s'il est encore en cours (re-clic rapide).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myGenId = ++genIdRef.current;

    setError(null);
    setGenerating(true);
    setGenerated(null);
    try {
      const res = await emailsApi.aiDraftEmail(
        instructions.trim(),
        recipient.trim() || undefined,
        tone,
        controller.signal,
      );
      if (myGenId !== genIdRef.current) return;
      setGenerated(res);
    } catch (err) {
      if (myGenId !== genIdRef.current) return;
      // axios.isCancel ou name === 'CanceledError' -> on a abort, silencieux.
      if (err && typeof err === 'object' && (
        (err as { name?: string }).name === 'CanceledError'
        || (err as { code?: string }).code === 'ERR_CANCELED'
      )) {
        return;
      }
      setError(_extractError(err));
    } finally {
      if (myGenId === genIdRef.current) setGenerating(false);
    }
  };

  const handleApply = (useShortVersion: boolean) => {
    if (!generated) return;
    const subject = generated.sujet || '';
    const body = useShortVersion && generated.versionCourte
      ? generated.versionCourte
      : (generated.corps || '');
    onApply(subject, body);
    handleClose();
  };

  const hasParseable = Boolean(generated && (generated.sujet || generated.corps));
  const hasOnlyRaw = Boolean(
    generated && !generated.sujet && !generated.corps && generated.raw,
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleOpen}
        className="w-full justify-center text-sm"
      >
        <Sparkles size={14} className="mr-1 text-purple-600 dark:text-purple-300" />
        Rediger avec IA
      </Button>

      <Modal
        isOpen={open}
        onClose={handleClose}
        title="Rediger avec IA Construction"
        size="lg"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Bot size={16} className="text-purple-600 dark:text-purple-300" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              L'IA redige un email professionnel adapte au contexte construction Quebec.
              {recipient && ' Le contexte CRM du destinataire sera utilise.'}
            </span>
            <Badge color="purple" size="sm">Claude</Badge>
          </div>

          {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

          {/* Inputs */}
          <Textarea
            label="Instructions (que voulez-vous communiquer ?)"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            placeholder="Ex: Relance pour le devis du projet Residence Laval, demander une reponse cette semaine. Mentionner que les couts materiaux ont augmente de 5% depuis l'envoi."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              label="Destinataire (optionnel, pour personnaliser via CRM)"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="client@exemple.com"
            />
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
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              <X size={14} className="mr-1" /> Annuler
            </Button>
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={generating || instructions.trim().length < 5}
            >
              {generating ? <Loader2 size={14} className="animate-spin mr-1" /> : <Sparkles size={14} className="mr-1" />}
              Generer
            </Button>
          </div>

          {/* Resultat parseable (sujet/corps) */}
          {hasParseable && generated && (
            <div className="rounded-lg border border-purple-200 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10 p-3 space-y-2">
              <p className="text-sm font-medium text-purple-900 dark:text-purple-200">
                Email genere
              </p>
              {generated.sujet && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Sujet:</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {generated.sujet}
                  </p>
                </div>
              )}
              {generated.corps && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Corps:</p>
                  <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto bg-white dark:bg-gray-900 rounded p-2 border border-gray-200 dark:border-gray-700">
                    {generated.corps}
                  </pre>
                </div>
              )}
              {generated.meilleurMomentEnvoi && (
                <p className="text-xs text-gray-500 italic">
                  Conseil IA: meilleur moment d'envoi -- {generated.meilleurMomentEnvoi}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleApply(false)}
                  disabled={!generated.corps}
                >
                  Utiliser cette version
                </Button>
                {generated.versionCourte && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleApply(true)}
                  >
                    Utiliser la version courte
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Fallback: Claude a renvoye du texte non parseable */}
          {hasOnlyRaw && generated?.raw && (
            <Alert type="warning">
              L'IA n'a pas retourne un JSON parseable. Texte brut (extrait):{' '}
              {generated.raw.slice(0, 300)}
              {generated.raw.length > 300 ? '...' : ''}
            </Alert>
          )}

          {/* Cas degenere: generated est set mais aucun champ utile */}
          {generated && !hasParseable && !hasOnlyRaw && (
            <Alert type="warning">
              Aucune reponse exploitable de l'IA. Reformulez vos instructions
              et reessayez.
            </Alert>
          )}
        </div>
      </Modal>
    </>
  );
}
