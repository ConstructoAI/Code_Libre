/**
 * SEAOP React Frontend - Formatting Utilities
 * Date, time, and currency formatting for French-Canadian locale.
 */

// ============ Date Formatting ============

/**
 * Format a date string as "23 mars 2026" (French locale, long day-month-year).
 * Returns '--' for null/empty input.
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '--';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleDateString('fr-CA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '--';
  }
}

/**
 * Format a date string as "23 mars 2026, 14:30" (French locale).
 * Returns '--' for null/empty input.
 */
export function formatDateTime(date: string | null | undefined): string {
  if (!date) return '--';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleDateString('fr-CA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--';
  }
}

/**
 * Format a date as relative time in French:
 * "il y a 5 min", "il y a 2 h", "hier", "il y a 3 jours", "il y a 2 sem."
 * Falls back to formatDate for dates older than 30 days.
 */
export function formatRelativeTime(date: string | null | undefined): string {
  if (!date) return '--';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '--';

    const now = new Date();
    const diffMs = now.getTime() - d.getTime();

    // Future dates
    if (diffMs < 0) return formatDate(date);

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffWeek = Math.floor(diffDay / 7);

    if (diffSec < 60) return "à l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    if (diffHour < 24) return `il y a ${diffHour} h`;
    if (diffDay === 1) return 'hier';
    if (diffDay < 7) return `il y a ${diffDay} jours`;
    if (diffWeek < 5) return `il y a ${diffWeek} sem.`;

    // Older than ~30 days: use full date
    return formatDate(date);
  } catch {
    return '--';
  }
}

// ============ Currency Formatting ============

/**
 * Format a number as Canadian French currency: "1 234,56 $"
 * Uses non-breaking spaces as group separator and comma as decimal.
 */
export function formatCurrency(amount: number): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '-- $';
  return (
    amount
      .toFixed(2)
      // Replace decimal point with comma
      .replace('.', ',')
      // Add space-based thousands separator
      .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0') + ' $'
  );
}

// ============ Deadline Helpers ============

/**
 * Calculate the number of days remaining until a deadline.
 * Returns null if the date is null/invalid.
 * Returns negative values for past deadlines.
 */
export function daysRemaining(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  try {
    const d = new Date(deadline);
    if (isNaN(d.getTime())) return null;

    const now = new Date();
    // Reset to midnight for day-level comparison
    now.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);

    const diffMs = d.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Format days remaining into a human-readable French string.
 * "3 jours restants", "Expire aujourd'hui", "Expire depuis 2 jours"
 */
export function formatDaysRemaining(deadline: string | null | undefined): string {
  const days = daysRemaining(deadline);
  if (days === null) return '--';
  if (days > 1) return `${days} jours restants`;
  if (days === 1) return 'Demain';
  if (days === 0) return "Expire aujourd'hui";
  if (days === -1) return 'Expire hier';
  return `Expire depuis ${Math.abs(days)} jours`;
}

// ============ String Formatting ============

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
export function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format a phone number as (xxx) xxx-xxxx.
 * Input can be in any format (digits extracted automatically).
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '--';
  const digits = phone.replace(/\D/g, '');
  // Remove leading country code 1
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) return phone; // Return as-is if not 10 digits
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}
