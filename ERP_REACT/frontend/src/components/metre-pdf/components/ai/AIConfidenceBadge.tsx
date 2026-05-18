import React from 'react';

interface Props {
  confidence: number; // 0..1
  className?: string;
}

/**
 * Badge affichant le pourcentage de confiance d'une detection IA.
 * - >= 85%: vert (haute confiance)
 * - >= 70%: ambre (moyenne)
 * - < 70%: rose (basse, a verifier)
 */
export const AIConfidenceBadge: React.FC<Props> = ({ confidence, className = '' }) => {
  // Guard against NaN / Infinity which would yield "NaN%" badge text.
  const safeConf = Number.isFinite(confidence) ? confidence : 0;
  const pct = Math.round(safeConf * 100);
  let bg = 'bg-rose-100 text-rose-700';
  if (safeConf >= 0.85) bg = 'bg-emerald-100 text-emerald-700';
  else if (safeConf >= 0.7) bg = 'bg-amber-100 text-amber-700';

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${bg} ${className}`}
      title={`Confiance IA: ${pct}%`}
    >
      {pct}%
    </span>
  );
};

export default AIConfidenceBadge;
