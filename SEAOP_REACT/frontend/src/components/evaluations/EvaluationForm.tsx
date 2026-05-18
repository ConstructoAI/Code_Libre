/**
 * SEAOP React Frontend - Evaluation Form
 * Form to rate an entrepreneur after a soumission.
 */

import { useState } from 'react';
import { Send } from 'lucide-react';

import { StarRating } from '@/components/ui/StarRating';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';

interface Props {
  soumissionId: number;
  onSubmit: (data: {
    soumissionId: number;
    note: number;
    commentaire?: string;
  }) => Promise<void>;
  isLoading?: boolean;
}

function EvaluationForm({ soumissionId, onSubmit, isLoading = false }: Props) {
  const [note, setNote] = useState(0);
  const [commentaire, setCommentaire] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (note === 0) {
      setError('Veuillez attribuer une note (1 à 5 étoiles)');
      return;
    }

    await onSubmit({
      soumissionId,
      note,
      ...(commentaire.trim() && { commentaire: commentaire.trim() }),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Star rating */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Note *
        </label>
        <StarRating value={note} onChange={setNote} size="lg" showValue />
        {error && (
          <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      {/* Comment */}
      <Textarea
        label="Commentaire (optionnel)"
        placeholder="Partagez votre expérience avec cet entrepreneur..."
        rows={4}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
      />

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          isLoading={isLoading}
          leftIcon={<Send className="h-4 w-4" />}
        >
          Soumettre l'évaluation
        </Button>
      </div>
    </form>
  );
}

EvaluationForm.displayName = 'EvaluationForm';

export { EvaluationForm };
export type { Props as EvaluationFormProps };
