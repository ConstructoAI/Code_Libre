/**
 * SEAOP React Frontend - Constants
 * Mirrors config_seaop.py and seaop_config.py values for use in the UI.
 */

// ============ Project Types ============

export const TYPES_PROJETS = [
  'Travaux de construction',
  'Rénovation de bâtiments publics',
  'Infrastructure routière',
  'Aménagement urbain',
  'Systèmes informatiques',
  'Services professionnels',
  'Fournitures et équipements',
  "Services d'entretien",
  "Travaux d'ingénierie",
  'Consultations spécialisées',
  'Autre',
] as const;

export type TypeProjet = (typeof TYPES_PROJETS)[number];

// ============ Budget Ranges ============

export const TRANCHES_BUDGET = [
  'Moins de 25 000$',
  '25 000$ - 100 000$',
  '100 000$ - 500 000$',
  '500 000$ - 1 000 000$',
  'Plus de 1 000 000$',
  'À déterminer selon soumissions',
] as const;

export type TrancheBudget = (typeof TRANCHES_BUDGET)[number];

// ============ Delivery Timelines ============

export const DELAIS_REALISATION = [
  'Urgent (moins de 1 mois)',
  'Court terme (1-3 mois)',
  'Moyen terme (3-6 mois)',
  'Long terme (6-12 mois)',
  'Pluriannuel (plus de 12 mois)',
  'Selon calendrier projet',
] as const;

export type DelaiRealisation = (typeof DELAIS_REALISATION)[number];

// ============ Project Statuses ============

export interface StatusConfig {
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
}

// Palette pastel harmonisee avec ERP Suivi (Gantt/Kanban/Calendrier)
export const STATUTS_PROJET: Record<string, StatusConfig> = {
  nouveau: {
    label: 'Nouveau',
    color: '#7BAFD4',
    bgColor: 'rgba(123,175,212,0.15)',
    textColor: '#4A7FA8',
  },
  en_cours: {
    label: 'En cours',
    color: '#F6C87A',
    bgColor: 'rgba(246,200,122,0.15)',
    textColor: '#9E7B1E',
  },
  ferme: {
    label: 'Fermé',
    color: '#B8C4CE',
    bgColor: 'rgba(184,196,206,0.20)',
    textColor: '#6B7B8A',
  },
  attribue: {
    label: 'Attribué',
    color: '#7DC4A5',
    bgColor: 'rgba(125,196,165,0.15)',
    textColor: '#4A9475',
  },
  annule: {
    label: 'Annulé',
    color: '#E8919A',
    bgColor: 'rgba(232,145,154,0.15)',
    textColor: '#B8616A',
  },
};

// ============ Soumission Statuses ============

export const STATUTS_SOUMISSION: Record<string, StatusConfig> = {
  envoyee: {
    label: 'Envoyée',
    color: '#8B9FD4',
    bgColor: 'rgba(139,159,212,0.15)',
    textColor: '#5B6FA4',
  },
  vue: {
    label: "Vue par l'organisme",
    color: '#B09BD8',
    bgColor: 'rgba(176,155,216,0.15)',
    textColor: '#7A6BA8',
  },
  en_evaluation: {
    label: 'En évaluation',
    color: '#F6C87A',
    bgColor: 'rgba(246,200,122,0.15)',
    textColor: '#9E7B1E',
  },
  acceptee: {
    label: 'Acceptée',
    color: '#7DC4A5',
    bgColor: 'rgba(125,196,165,0.15)',
    textColor: '#4A9475',
  },
  refusee: {
    label: 'Refusée',
    color: '#E8919A',
    bgColor: 'rgba(232,145,154,0.15)',
    textColor: '#B8616A',
  },
};

// ============ Urgency Configuration ============

export interface UrgencyConfig {
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
  icon: string;
}

export const URGENCY_CONFIG: Record<string, UrgencyConfig> = {
  faible: {
    label: 'Faible',
    color: '#B8C4CE',
    bgColor: 'rgba(184,196,206,0.20)',
    textColor: '#6B7B8A',
    icon: 'clock',
  },
  normal: {
    label: 'Normal',
    color: '#7BAFD4',
    bgColor: 'rgba(123,175,212,0.15)',
    textColor: '#4A7FA8',
    icon: 'info',
  },
  eleve: {
    label: 'Élevé',
    color: '#F0B07A',
    bgColor: 'rgba(240,176,122,0.15)',
    textColor: '#A06A2A',
    icon: 'alert-triangle',
  },
  critique: {
    label: 'Critique',
    color: '#E8919A',
    bgColor: 'rgba(232,145,154,0.15)',
    textColor: '#B8616A',
    icon: 'alert-circle',
  },
};

// ============ Security Config ============

export const SECURITY_CONFIG = {
  passwordMinLength: 8,
  sessionTimeout: 3600,
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  maxFilesPerUpload: 5,
} as const;

// ============ Allowed File Formats ============

export const FORMATS_AUTORISES = {
  plans: ['pdf', 'dwg', 'dxf', 'png', 'jpg', 'jpeg'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'],
  photos: ['png', 'jpg', 'jpeg', 'gif', 'bmp'],
} as const;

// ============ Status Arrays (for iteration) ============

export const STATUTS_PROJET_LIST = [
  'nouveau',
  'en_cours',
  'ferme',
  'attribue',
  'annule',
] as const;

export const STATUTS_SOUMISSION_LIST = [
  'envoyee',
  'vue',
  'en_evaluation',
  'acceptee',
  'refusee',
] as const;

export const URGENCY_LEVELS = [
  'faible',
  'normal',
  'eleve',
  'critique',
] as const;
