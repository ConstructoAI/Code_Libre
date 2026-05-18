/**
 * Mobile React Frontend - Validation Functions
 * Shared with ERP_REACT.
 */

export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const pattern =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return pattern.test(email.trim());
}

export function validatePin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function validateRequired(value: string, fieldName: string): string | null {
  if (!value || !value.trim()) {
    return `${fieldName} est requis.`;
  }
  return null;
}
