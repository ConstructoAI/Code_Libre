/**
 * SEAOP React Frontend - Star Rating Component
 * Interactive (when onChange provided) or read-only star display.
 */

import { useState } from 'react';
import clsx from 'clsx';
import { Star } from 'lucide-react';

interface Props {
  value: number;
  onChange?: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
}

const sizeStyles: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-7 w-7',
};

const valueSizeStyles: Record<NonNullable<Props['size']>, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl font-semibold',
};

function StarRating({ value, onChange, size = 'md', showValue = false }: Props) {
  const [hoverValue, setHoverValue] = useState<number>(0);
  const isEditable = typeof onChange === 'function';
  const displayValue = hoverValue > 0 ? hoverValue : value;

  return (
    <div className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const isFilled = star <= displayValue;

        return (
          <button
            key={star}
            type="button"
            disabled={!isEditable}
            onClick={() => isEditable && onChange(star)}
            onMouseEnter={() => isEditable && setHoverValue(star)}
            onMouseLeave={() => isEditable && setHoverValue(0)}
            className={clsx(
              'transition-colors duration-100 focus:outline-none',
              isEditable && 'cursor-pointer hover:scale-110 transition-transform',
              !isEditable && 'cursor-default',
            )}
            aria-label={`${star} étoile${star > 1 ? 's' : ''}`}
          >
            <Star
              className={clsx(
                sizeStyles[size],
                isFilled
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-none text-gray-300 dark:text-gray-600',
              )}
            />
          </button>
        );
      })}

      {showValue && (
        <span
          className={clsx(
            'ml-1.5 text-gray-700 dark:text-gray-300',
            valueSizeStyles[size],
          )}
        >
          {value > 0 ? (value ?? 0).toFixed(1) : '--'}
        </span>
      )}
    </div>
  );
}

StarRating.displayName = 'StarRating';

export { StarRating };
export type { Props as StarRatingProps };
