/**
 * SEAOP React Frontend - Urgency Calculation
 * Ported from the Python backend urgency logic.
 * Calculates urgency level based on submission deadline and desired start date.
 */

import type { UrgencyLevel } from '@/types';
import { URGENCY_CONFIG } from './constants';
import type { UrgencyConfig } from './constants';

/**
 * Calculate the urgency level of a lead based on its dates.
 *
 * Logic (matching Python backend):
 *   - If date_limite_soumissions is within 3 days  -> 'critique'
 *   - If date_limite_soumissions is within 7 days  -> 'eleve'
 *   - If date_debut_souhaite is within 14 days     -> 'eleve'
 *   - If date_limite_soumissions is within 14 days  -> 'normal'
 *   - If date_debut_souhaite is within 30 days     -> 'normal'
 *   - Otherwise                                     -> 'faible'
 *
 * Returns 'normal' if both dates are null/invalid.
 */
export function calculateUrgency(
  dateLimiteSoumissions: string | null | undefined,
  dateDebutSouhaite: string | null | undefined,
): UrgencyLevel {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  let daysToDeadline: number | null = null;
  let daysToStart: number | null = null;

  // Parse submission deadline
  if (dateLimiteSoumissions) {
    try {
      const deadline = new Date(dateLimiteSoumissions);
      if (!isNaN(deadline.getTime())) {
        deadline.setHours(0, 0, 0, 0);
        daysToDeadline = Math.ceil(
          (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
      }
    } catch {
      // Invalid date, leave as null
    }
  }

  // Parse desired start date
  if (dateDebutSouhaite) {
    try {
      const startDate = new Date(dateDebutSouhaite);
      if (!isNaN(startDate.getTime())) {
        startDate.setHours(0, 0, 0, 0);
        daysToStart = Math.ceil(
          (startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
      }
    } catch {
      // Invalid date, leave as null
    }
  }

  // No dates -> default to 'normal'
  if (daysToDeadline === null && daysToStart === null) {
    return 'normal';
  }

  // Deadline-based urgency (highest priority)
  if (daysToDeadline !== null) {
    // Past deadline or within 3 days -> critique
    if (daysToDeadline <= 3) return 'critique';
    // Within 7 days -> eleve
    if (daysToDeadline <= 7) return 'eleve';
    // Within 14 days -> normal
    if (daysToDeadline <= 14) return 'normal';
  }

  // Start-date-based urgency
  if (daysToStart !== null) {
    // Start within 14 days -> eleve
    if (daysToStart <= 14) return 'eleve';
    // Start within 30 days -> normal
    if (daysToStart <= 30) return 'normal';
  }

  return 'faible';
}

/**
 * Get the visual configuration for an urgency level.
 * Returns the default 'normal' config for unknown levels.
 */
export function getUrgencyConfig(level: UrgencyLevel | string): UrgencyConfig {
  return URGENCY_CONFIG[level] || URGENCY_CONFIG['normal'];
}

/**
 * Get urgency with both the calculated level and its display config.
 * Convenience function combining calculateUrgency + getUrgencyConfig.
 */
export function getUrgencyInfo(
  dateLimiteSoumissions: string | null | undefined,
  dateDebutSouhaite: string | null | undefined,
): { level: UrgencyLevel; config: UrgencyConfig } {
  const level = calculateUrgency(dateLimiteSoumissions, dateDebutSouhaite);
  const config = getUrgencyConfig(level);
  return { level, config };
}

/**
 * Sort comparator for urgency levels (critique first, faible last).
 * Usage: items.sort((a, b) => compareUrgency(a.urgency, b.urgency))
 */
export function compareUrgency(
  a: UrgencyLevel | string,
  b: UrgencyLevel | string,
): number {
  const order: Record<string, number> = {
    critique: 0,
    eleve: 1,
    normal: 2,
    faible: 3,
  };
  const aOrder = order[a] ?? 2;
  const bOrder = order[b] ?? 2;
  return aOrder - bOrder;
}
