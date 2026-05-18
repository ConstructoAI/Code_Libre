/**
 * Mobile React Frontend - Formatting Utilities
 * Date, time, and currency formatting for French-Canadian locale.
 * Shared with ERP_REACT.
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

export function formatTime(date: string | null | undefined): string {
  if (!date) return '--';
  try {
    // Backend timestamps are UTC without timezone suffix (TIMESTAMP WITHOUT TIME ZONE)
    // Append 'Z' so new Date() parses as UTC; toLocaleTimeString converts to Montreal
    const raw = date;
    const iso = raw.endsWith('Z') || raw.includes('+') ? raw : raw + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleTimeString('fr-CA', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Montreal',
    });
  } catch {
    return '--';
  }
}

export function formatRelativeTime(date: string | null | undefined): string {
  if (!date) return '--';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '--';

    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
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

    return formatDate(date);
  } catch {
    return '--';
  }
}

export function formatCurrency(amount: number): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '-- $';
  return (
    amount
      .toFixed(2)
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0') + ' $'
  );
}

export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '--';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
}

export function formatElapsedMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '--';
  if (minutes < 0) minutes = 0;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}

export function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '--';
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) return phone;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}
