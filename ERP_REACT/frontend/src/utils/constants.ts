/**
 * ERP React Frontend - Constants
 * ERP-specific constants for the construction ERP.
 */

// Security
export const SECURITY_CONFIG = {
  passwordMinLength: 8,
  sessionTimeout: 28800, // 8 hours
  maxFileSize: 50 * 1024 * 1024, // 50 MB
  maxFilesPerUpload: 5,
};

// Quebec taxes
export const TPS_RATE = 5.0;
export const TVQ_RATE = 9.975;

// Project statuses
export const STATUTS_PROJET: Record<string, { label: string; color: string; bgClass: string }> = {
  'En attente': { label: 'En attente', color: 'gray', bgClass: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
  'En cours': { label: 'En cours', color: 'blue', bgClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  'Terminé': { label: 'Terminé', color: 'green', bgClass: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  'Annulé': { label: 'Annulé', color: 'red', bgClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  'Suspendu': { label: 'Suspendu', color: 'yellow', bgClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
};

// Devis statuses
export const STATUTS_DEVIS: Record<string, { label: string; color: string; bgClass: string }> = {
  'Brouillon': { label: 'Brouillon', color: 'gray', bgClass: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
  'Envoyé': { label: 'Envoyé', color: 'blue', bgClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  'Accepté': { label: 'Accepté', color: 'green', bgClass: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  'Refusé': { label: 'Refusé', color: 'red', bgClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  'Expiré': { label: 'Expiré', color: 'yellow', bgClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
};

// Invoice statuses
export const STATUTS_FACTURE: Record<string, { label: string; color: string; bgClass: string }> = {
  'BROUILLON': { label: 'Brouillon', color: 'gray', bgClass: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
  'ENVOYEE': { label: 'Envoyée', color: 'blue', bgClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  'PAYEE': { label: 'Payée', color: 'green', bgClass: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  'EN_RETARD': { label: 'En retard', color: 'red', bgClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  'ANNULEE': { label: 'Annulée', color: 'yellow', bgClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
};

// Employee statuses
export const STATUTS_EMPLOYE: Record<string, { label: string; color: string; bgClass: string }> = {
  'ACTIF': { label: 'Actif', color: 'green', bgClass: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  'INACTIF': { label: 'Inactif', color: 'red', bgClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  'EN_CONGE': { label: 'En congé', color: 'yellow', bgClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
};

// File formats
export const FORMATS_AUTORISES = {
  plans: '.pdf,.dwg,.dxf,.dgn',
  documents: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv',
  photos: '.jpg,.jpeg,.png,.gif,.bmp,.webp,.heic',
};
