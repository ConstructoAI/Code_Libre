/**
 * Mobile React Frontend - Constants
 * Mobile-specific constants for construction mobile app.
 */

export const OVERTIME_DAILY = 8.0;
export const OVERTIME_WEEKLY = 40.0;

export const SECURITY_CONFIG = {
  passwordMinLength: 8,
  pinLength: 4,
  maxPhotoSize: 5 * 1024 * 1024, // 5 MB
};

// Palette pastel harmonisee avec ERP Suivi (Gantt/Kanban/Calendrier)
export const STATUTS_DOSSIER: Record<string, { label: string; bgClass: string }> = {
  ouvert: { label: 'Ouvert', bgClass: 'bg-[#7BAFD4]/15 text-[#4A7FA8] dark:bg-[#7BAFD4]/20 dark:text-[#9BC8E4]' },
  en_cours: { label: 'En cours', bgClass: 'bg-[#F6C87A]/15 text-[#9E7B1E] dark:bg-[#F6C87A]/20 dark:text-[#F6D89A]' },
  ferme: { label: 'Fermé', bgClass: 'bg-[#7DC4A5]/15 text-[#4A9475] dark:bg-[#7DC4A5]/20 dark:text-[#9DD4B5]' },
  annule: { label: 'Annulé', bgClass: 'bg-[#E8919A]/15 text-[#B8616A] dark:bg-[#E8919A]/20 dark:text-[#E8A1AA]' },
};

export const STATUTS_ETAPE: Record<string, { label: string; bgClass: string }> = {
  TODO: { label: 'À faire', bgClass: 'bg-[#B8C4CE]/20 text-[#6B7B8A] dark:bg-[#B8C4CE]/15 dark:text-[#B8C4CE]' },
  IN_PROGRESS: { label: 'En cours', bgClass: 'bg-[#7BAFD4]/15 text-[#4A7FA8] dark:bg-[#7BAFD4]/20 dark:text-[#9BC8E4]' },
  DONE: { label: 'Terminé', bgClass: 'bg-[#7DC4A5]/15 text-[#4A9475] dark:bg-[#7DC4A5]/20 dark:text-[#9DD4B5]' },
};

export const PRIORITES: Record<string, { label: string; bgClass: string }> = {
  basse: { label: 'Basse', bgClass: 'bg-[#B8C4CE]/20 text-[#6B7B8A] dark:bg-[#B8C4CE]/15 dark:text-[#B8C4CE]' },
  normale: { label: 'Normale', bgClass: 'bg-[#7BAFD4]/15 text-[#4A7FA8] dark:bg-[#7BAFD4]/20 dark:text-[#9BC8E4]' },
  haute: { label: 'Haute', bgClass: 'bg-[#F0B07A]/15 text-[#A06A2A] dark:bg-[#F0B07A]/20 dark:text-[#F0C09A]' },
  urgente: { label: 'Urgente', bgClass: 'bg-[#E8919A]/15 text-[#B8616A] dark:bg-[#E8919A]/20 dark:text-[#E8A1AA]' },
};
