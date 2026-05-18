/**
 * ERP React Frontend - Validation Functions
 * Input validation for forms: email, phone, postal code, password.
 */

import { SECURITY_CONFIG } from './constants';

/**
 * Validate an email address using an RFC-compliant regex.
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  // RFC 5322 simplified pattern
  const pattern =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return pattern.test(email.trim());
}

/**
 * Validate a Quebec/Canadian phone number.
 * Accepts: xxx-xxx-xxxx, (xxx) xxx-xxxx, xxx xxx xxxx, xxxxxxxxxx, +1xxxxxxxxxx
 */
export function validatePhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, '');
  // 10 digits, or 11 digits starting with 1 (country code)
  if (digits.length === 10) return true;
  if (digits.length === 11 && digits.startsWith('1')) return true;
  return false;
}

/**
 * Validate a Canadian postal code.
 * Format: A1A 1A1 (with optional space)
 */
export function validatePostalCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  const pattern = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
  return pattern.test(code.trim());
}

/**
 * Validate password strength.
 * Returns an object with validity flag and a user-facing message.
 */
export function validatePassword(password: string): {
  valid: boolean;
  message: string;
} {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Le mot de passe est requis.' };
  }

  if (password.length < SECURITY_CONFIG.passwordMinLength) {
    return {
      valid: false,
      message: `Le mot de passe doit contenir au moins ${SECURITY_CONFIG.passwordMinLength} caracteres.`,
    };
  }

  // Optional strength checks (informational, not blocking)
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);

  if (!hasUpper || !hasLower || !hasDigit) {
    return {
      valid: true,
      message:
        'Mot de passe accepte. Pour plus de securite, utilisez des majuscules, minuscules et chiffres.',
    };
  }

  return { valid: true, message: 'Mot de passe valide.' };
}

/**
 * Validate that a required string field is not empty.
 */
export function validateRequired(value: string, fieldName: string): string | null {
  if (!value || !value.trim()) {
    return `${fieldName} est requis.`;
  }
  return null;
}

/**
 * Validate a monetary amount (must be a positive number).
 */
export function validateMontant(montant: number): string | null {
  if (isNaN(montant) || montant <= 0) {
    return 'Le montant doit etre un nombre positif.';
  }
  return null;
}

/**
 * Validate a rating (1-5).
 */
export function validateNote(note: number): string | null {
  if (!Number.isInteger(note) || note < 1 || note > 5) {
    return 'La note doit etre un entier entre 1 et 5.';
  }
  return null;
}
