/**
 * SEAOP React Frontend - Evaluation Stats
 * Displays entrepreneur rating summary + recent comments.
 */

import { useEffect, useState } from 'react';
import { Star, MessageCircle } from 'lucide-react';

import type { Evaluation } from '@/types';
import { StarRating } from '@/components/ui/StarRating';
import { Spinner } from '@/components/ui/Spinner';
import { getEntrepreneurEvaluations } from '@/api/evaluations';
import { formatRelativeTime } from '@/utils/format';

interface Props {
  entrepreneurId: number;
}

interface EvalData {
  moyenne: number;
  count: number;
  comments: Evaluation[];
}

function EvaluationStats({ entrepreneurId }: Props) {
  const [data, setData] = useState<EvalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getEntrepreneurEvaluations(entrepreneurId);
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Erreur lors du chargement',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [entrepreneurId]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!data || data.count === 0) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <Star className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Aucune évaluation pour le moment
        </p>
      </div>
    );
  }

  // Show last 5 comments
  const recentComments = data.comments
    .filter((c) => c.commentaire)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {(data.moyenne ?? 0).toFixed(1)}
          </p>
          <StarRating value={data.moyenne} size="md" />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {data.count} évaluation{data.count !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Recent comments */}
      {recentComments.length > 0 && (
        <div className="space-y-3">
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            <MessageCircle className="h-4 w-4" />
            Commentaires récents
          </h4>
          <div className="space-y-2">
            {recentComments.map((eval_) => (
              <div
                key={eval_.id}
                className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <StarRating value={eval_.note} size="sm" />
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {formatRelativeTime(eval_.dateEvaluation)}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {eval_.commentaire}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

EvaluationStats.displayName = 'EvaluationStats';

export { EvaluationStats };
export type { Props as EvaluationStatsProps };
