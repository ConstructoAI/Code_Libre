import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

interface SaveMetreModalProps {
  open: boolean;
  onClose: () => void;
  /** Initial values when renaming an existing métré (else empty for new). */
  initialName?: string;
  initialDescription?: string;
  /** Title shown in the modal header. */
  title?: string;
  /** Confirm button label. */
  confirmLabel?: string;
  /** Async confirm — modal stays open while it runs, closes on success. */
  onConfirm: (values: { name: string; description: string }) => Promise<void>;
}

/** Naming dialog used by:
 *   - "Nouveau métré" (initial name + description empty)
 *   - "Renommer le métré" (pre-filled with current values)
 *   - "Sauvegarder en tant que…" (pre-filled, creates a new project)
 */
export default function SaveMetreModal({
  open,
  onClose,
  initialName = '',
  initialDescription = '',
  title = 'Nouveau métré',
  confirmLabel = 'Créer',
  onConfirm,
}: SaveMetreModalProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form on every open transition
  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
      setError(null);
      // Autofocus the name input after the modal renders.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, initialName, initialDescription]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Le nom est obligatoire');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ name: trimmed, description: description.trim() });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-700 dark:text-neutral-300">
            Nom du métré <span className="text-red-500">*</span>
          </label>
          <Input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex : Habitat-Design — Charland (revêtement)"
            maxLength={255}
            error={error ?? undefined}
            disabled={submitting}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-700 dark:text-neutral-300">
            Description (facultative)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes, contexte du projet, références au plan…"
            disabled={submitting}
            rows={3}
            className="w-full rounded-lg border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:opacity-50"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={submitting || !name.trim()}>
            {submitting ? 'Sauvegarde…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
