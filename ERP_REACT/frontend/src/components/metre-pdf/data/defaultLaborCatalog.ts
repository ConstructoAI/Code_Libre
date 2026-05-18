/**
 * Default CCQ labor catalog — Corps de metier CCQ.
 * Taux horaire chargé (salaire + avantages sociaux) secteur ICI.
 * Mise à jour fournie par Sylvain Leduc le 2026-05-06.
 *
 * Structure:
 *  - Compagnon (taux principal du metier)
 *  - Apprenti par période (1 à 5 selon le metier — variable selon
 *    la convention CCQ pour chaque corps de métier)
 *  - Occupations (sans periodes d'apprentissage)
 *
 * NOTE: Si un metier a un nombre different de periodes apprenti, c'est
 * fidele aux regles CCQ. Mecanicien d'ascenseurs a 5 periodes, Couvreur 2,
 * Cimentier 2, Ferrailleur 1 (sans numero de période), etc.
 *
 * Le bump de LABOR_CATALOG_VERSION force le rechargement du catalogue
 * pour tous les utilisateurs au prochain ouverture du panel main d'oeuvre
 * (cf. store.ts lignes 2278-2290).
 */
import type { LaborTrade } from '../types';

export const LABOR_CATALOG_VERSION = '2026-05-06-CCQ';

export const DEFAULT_LABOR_CATALOG: LaborTrade[] = [
  // ============================================================
  // CORPS DE METIERS
  // ============================================================

  // --- Briqueteur-maçon ---
  { id: 'ccq-briqueteur-macon', trade: 'Briqueteur-maçon', sector: 'ICI', hourlyRate: 88.38, nbPersons: 1, color: '#b45309' },
  { id: 'ccq-briqueteur-macon-app1', trade: 'Briqueteur-maçon', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 62.46, nbPersons: 1, color: '#b45309' },
  { id: 'ccq-briqueteur-macon-app2', trade: 'Briqueteur-maçon', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 68.72, nbPersons: 1, color: '#b45309' },
  { id: 'ccq-briqueteur-macon-app3', trade: 'Briqueteur-maçon', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 78.09, nbPersons: 1, color: '#b45309' },

  // --- Calorifugeur ---
  { id: 'ccq-calorifugeur', trade: 'Calorifugeur', sector: 'ICI', hourlyRate: 87.54, nbPersons: 1, color: '#0d9488' },
  { id: 'ccq-calorifugeur-app1', trade: 'Calorifugeur', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 61.90, nbPersons: 1, color: '#0d9488' },
  { id: 'ccq-calorifugeur-app2', trade: 'Calorifugeur', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 68.10, nbPersons: 1, color: '#0d9488' },
  { id: 'ccq-calorifugeur-app3', trade: 'Calorifugeur', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 77.36, nbPersons: 1, color: '#0d9488' },

  // --- Carreleur ---
  { id: 'ccq-carreleur', trade: 'Carreleur', sector: 'ICI', hourlyRate: 87.60, nbPersons: 1, color: '#14b8a6' },
  { id: 'ccq-carreleur-app1', trade: 'Carreleur', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 61.98, nbPersons: 1, color: '#14b8a6' },
  { id: 'ccq-carreleur-app2', trade: 'Carreleur', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 68.16, nbPersons: 1, color: '#14b8a6' },
  { id: 'ccq-carreleur-app3', trade: 'Carreleur', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 77.42, nbPersons: 1, color: '#14b8a6' },

  // --- Charpentier-menuisier ---
  { id: 'ccq-charpentier-menuisier', trade: 'Charpentier-menuisier', sector: 'ICI', hourlyRate: 86.51, nbPersons: 1, color: '#d97706' },
  { id: 'ccq-charpentier-menuisier-app1', trade: 'Charpentier-menuisier', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 61.33, nbPersons: 1, color: '#d97706' },
  { id: 'ccq-charpentier-menuisier-app2', trade: 'Charpentier-menuisier', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 67.38, nbPersons: 1, color: '#d97706' },
  { id: 'ccq-charpentier-menuisier-app3', trade: 'Charpentier-menuisier', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 76.49, nbPersons: 1, color: '#d97706' },

  // --- Chaudronnier ---
  { id: 'ccq-chaudronnier', trade: 'Chaudronnier', sector: 'ICI', hourlyRate: 87.54, nbPersons: 1, color: '#92400e' },
  { id: 'ccq-chaudronnier-app1', trade: 'Chaudronnier', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 61.90, nbPersons: 1, color: '#92400e' },
  { id: 'ccq-chaudronnier-app2', trade: 'Chaudronnier', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 68.10, nbPersons: 1, color: '#92400e' },
  { id: 'ccq-chaudronnier-app3', trade: 'Chaudronnier', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 77.36, nbPersons: 1, color: '#92400e' },

  // --- Cimentier-applicateur (2 periodes apprenti) ---
  { id: 'ccq-cimentier', trade: 'Cimentier-applicateur', sector: 'ICI', hourlyRate: 86.47, nbPersons: 1, color: '#78716c' },
  { id: 'ccq-cimentier-app1', trade: 'Cimentier-applicateur', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 67.39, nbPersons: 1, color: '#78716c' },
  { id: 'ccq-cimentier-app2', trade: 'Cimentier-applicateur', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 76.46, nbPersons: 1, color: '#78716c' },

  // --- Couvreur (2 periodes apprenti) ---
  { id: 'ccq-couvreur', trade: 'Couvreur', sector: 'ICI', hourlyRate: 90.32, nbPersons: 2, color: '#ef4444' },
  { id: 'ccq-couvreur-app1', trade: 'Couvreur', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 70.09, nbPersons: 2, color: '#ef4444' },
  { id: 'ccq-couvreur-app2', trade: 'Couvreur', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 79.74, nbPersons: 2, color: '#ef4444' },

  // --- Électricien (4 periodes apprenti) ---
  { id: 'ccq-electricien', trade: 'Électricien', sector: 'ICI', hourlyRate: 89.59, nbPersons: 1, color: '#eab308' },
  { id: 'ccq-electricien-app1', trade: 'Électricien', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 57.09, nbPersons: 1, color: '#eab308' },
  { id: 'ccq-electricien-app2', trade: 'Électricien', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 63.32, nbPersons: 1, color: '#eab308' },
  { id: 'ccq-electricien-app3', trade: 'Électricien', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 69.65, nbPersons: 1, color: '#eab308' },
  { id: 'ccq-electricien-app4', trade: 'Électricien', specialty: 'Apprenti P4', sector: 'ICI', hourlyRate: 79.13, nbPersons: 1, color: '#eab308' },

  // --- Ferblantier ---
  { id: 'ccq-ferblantier', trade: 'Ferblantier', sector: 'ICI', hourlyRate: 88.88, nbPersons: 1, color: '#6366f1' },
  { id: 'ccq-ferblantier-app1', trade: 'Ferblantier', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 62.73, nbPersons: 1, color: '#6366f1' },
  { id: 'ccq-ferblantier-app2', trade: 'Ferblantier', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 69.06, nbPersons: 1, color: '#6366f1' },
  { id: 'ccq-ferblantier-app3', trade: 'Ferblantier', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 78.51, nbPersons: 1, color: '#6366f1' },

  // --- Ferrailleur (1 apprenti sans periode numerotee) ---
  { id: 'ccq-ferrailleur', trade: 'Ferrailleur', sector: 'ICI', hourlyRate: 88.59, nbPersons: 2, color: '#64748b' },
  { id: 'ccq-ferrailleur-app', trade: 'Ferrailleur', specialty: 'Apprenti', sector: 'ICI', hourlyRate: 78.27, nbPersons: 2, color: '#64748b' },

  // --- Frigoriste (4 periodes apprenti) ---
  { id: 'ccq-frigoriste', trade: 'Frigoriste', sector: 'ICI', hourlyRate: 87.41, nbPersons: 1, color: '#06b6d4' },
  { id: 'ccq-frigoriste-app1', trade: 'Frigoriste', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 55.66, nbPersons: 1, color: '#06b6d4' },
  { id: 'ccq-frigoriste-app2', trade: 'Frigoriste', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 61.81, nbPersons: 1, color: '#06b6d4' },
  { id: 'ccq-frigoriste-app3', trade: 'Frigoriste', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 68.00, nbPersons: 1, color: '#06b6d4' },
  { id: 'ccq-frigoriste-app4', trade: 'Frigoriste', specialty: 'Apprenti P4', sector: 'ICI', hourlyRate: 77.24, nbPersons: 1, color: '#06b6d4' },

  // --- Grutier classe A (2 periodes apprenti) ---
  { id: 'ccq-grutier-a', trade: 'Grutier - classe A', sector: 'ICI', hourlyRate: 85.45, nbPersons: 1, color: '#dc2626' },
  { id: 'ccq-grutier-a-app1', trade: 'Grutier - classe A', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 66.63, nbPersons: 1, color: '#dc2626' },
  { id: 'ccq-grutier-a-app2', trade: 'Grutier - classe A', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 75.57, nbPersons: 1, color: '#dc2626' },

  // --- Grutier classe B (2 periodes apprenti) ---
  { id: 'ccq-grutier-b', trade: 'Grutier - classe B', sector: 'ICI', hourlyRate: 83.63, nbPersons: 1, color: '#b91c1c' },
  { id: 'ccq-grutier-b-app1', trade: 'Grutier - classe B', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 65.34, nbPersons: 1, color: '#b91c1c' },
  { id: 'ccq-grutier-b-app2', trade: 'Grutier - classe B', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 74.02, nbPersons: 1, color: '#b91c1c' },

  // --- Installateur de systèmes de sécurité ---
  { id: 'ccq-installateur-securite', trade: 'Installateur de systèmes de sécurité', sector: 'ICI', hourlyRate: 75.61, nbPersons: 1, color: '#16a34a' },
  { id: 'ccq-installateur-securite-app1', trade: 'Installateur de systèmes de sécurité', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 54.96, nbPersons: 1, color: '#16a34a' },
  { id: 'ccq-installateur-securite-app2', trade: 'Installateur de systèmes de sécurité', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 59.87, nbPersons: 1, color: '#16a34a' },
  { id: 'ccq-installateur-securite-app3', trade: 'Installateur de systèmes de sécurité', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 67.29, nbPersons: 1, color: '#16a34a' },

  // --- Mécanicien d'ascenseurs (5 periodes apprenti — P4 et P5 au meme taux) ---
  { id: 'ccq-mecanicien-ascenseurs', trade: 'Mécanicien d\'ascenseurs', sector: 'ICI', hourlyRate: 94.12, nbPersons: 1, color: '#7c3aed' },
  { id: 'ccq-mecanicien-ascenseurs-app1', trade: 'Mécanicien d\'ascenseurs', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 59.03, nbPersons: 1, color: '#7c3aed' },
  { id: 'ccq-mecanicien-ascenseurs-app2', trade: 'Mécanicien d\'ascenseurs', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 65.86, nbPersons: 1, color: '#7c3aed' },
  { id: 'ccq-mecanicien-ascenseurs-app3', trade: 'Mécanicien d\'ascenseurs', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 72.70, nbPersons: 1, color: '#7c3aed' },
  { id: 'ccq-mecanicien-ascenseurs-app4', trade: 'Mécanicien d\'ascenseurs', specialty: 'Apprenti P4', sector: 'ICI', hourlyRate: 82.97, nbPersons: 1, color: '#7c3aed' },
  { id: 'ccq-mecanicien-ascenseurs-app5', trade: 'Mécanicien d\'ascenseurs', specialty: 'Apprenti P5', sector: 'ICI', hourlyRate: 82.97, nbPersons: 1, color: '#7c3aed' },

  // --- Mécanicien de chantier ---
  { id: 'ccq-mecanicien-chantier', trade: 'Mécanicien de chantier', sector: 'ICI', hourlyRate: 87.54, nbPersons: 1, color: '#9333ea' },
  { id: 'ccq-mecanicien-chantier-app1', trade: 'Mécanicien de chantier', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 61.90, nbPersons: 1, color: '#9333ea' },
  { id: 'ccq-mecanicien-chantier-app2', trade: 'Mécanicien de chantier', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 68.10, nbPersons: 1, color: '#9333ea' },
  { id: 'ccq-mecanicien-chantier-app3', trade: 'Mécanicien de chantier', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 77.36, nbPersons: 1, color: '#9333ea' },

  // --- Mécanicien de machines lourdes ---
  { id: 'ccq-mecanicien-machines', trade: 'Mécanicien de machines lourdes', sector: 'ICI', hourlyRate: 85.97, nbPersons: 1, color: '#be123c' },
  { id: 'ccq-mecanicien-machines-app1', trade: 'Mécanicien de machines lourdes', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 60.99, nbPersons: 1, color: '#be123c' },
  { id: 'ccq-mecanicien-machines-app2', trade: 'Mécanicien de machines lourdes', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 67.00, nbPersons: 1, color: '#be123c' },
  { id: 'ccq-mecanicien-machines-app3', trade: 'Mécanicien de machines lourdes', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 76.03, nbPersons: 1, color: '#be123c' },

  // --- Mécanicien protection-incendie (4 periodes apprenti) ---
  { id: 'ccq-mecanicien-protection', trade: 'Mécanicien protection-incendie', sector: 'ICI', hourlyRate: 87.54, nbPersons: 1, color: '#b91c1c' },
  { id: 'ccq-mecanicien-protection-app1', trade: 'Mécanicien protection-incendie', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 55.73, nbPersons: 1, color: '#b91c1c' },
  { id: 'ccq-mecanicien-protection-app2', trade: 'Mécanicien protection-incendie', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 61.90, nbPersons: 1, color: '#b91c1c' },
  { id: 'ccq-mecanicien-protection-app3', trade: 'Mécanicien protection-incendie', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 68.10, nbPersons: 1, color: '#b91c1c' },
  { id: 'ccq-mecanicien-protection-app4', trade: 'Mécanicien protection-incendie', specialty: 'Apprenti P4', sector: 'ICI', hourlyRate: 77.36, nbPersons: 1, color: '#b91c1c' },

  // --- Monteur-assembleur ---
  { id: 'ccq-monteur-assembleur', trade: 'Monteur-assembleur', sector: 'ICI', hourlyRate: 89.96, nbPersons: 1, color: '#475569' },
  { id: 'ccq-monteur-assembleur-app1', trade: 'Monteur-assembleur', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 63.39, nbPersons: 1, color: '#475569' },
  { id: 'ccq-monteur-assembleur-app2', trade: 'Monteur-assembleur', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 69.83, nbPersons: 1, color: '#475569' },
  { id: 'ccq-monteur-assembleur-app3', trade: 'Monteur-assembleur', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 79.43, nbPersons: 1, color: '#475569' },

  // --- Monteur mécanicien (vitrier) ---
  { id: 'ccq-monteur-mecanicien-vitrier', trade: 'Monteur mécanicien (vitrier)', sector: 'ICI', hourlyRate: 86.13, nbPersons: 1, color: '#0ea5e9' },
  { id: 'ccq-monteur-mecanicien-vitrier-app1', trade: 'Monteur mécanicien (vitrier)', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 61.12, nbPersons: 1, color: '#0ea5e9' },
  { id: 'ccq-monteur-mecanicien-vitrier-app2', trade: 'Monteur mécanicien (vitrier)', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 67.14, nbPersons: 1, color: '#0ea5e9' },
  { id: 'ccq-monteur-mecanicien-vitrier-app3', trade: 'Monteur mécanicien (vitrier)', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 76.17, nbPersons: 1, color: '#0ea5e9' },

  // --- Operateur d'equipement lourd classe A (1 apprenti sans periode) ---
  { id: 'ccq-operateur-equip-a', trade: 'Opér. d\'équipement lourd - cl. A', sector: 'ICI', hourlyRate: 81.78, nbPersons: 1, color: '#f59e0b' },
  { id: 'ccq-operateur-equip-a-app', trade: 'Opér. d\'équipement lourd - cl. A', specialty: 'Apprenti', sector: 'ICI', hourlyRate: 72.45, nbPersons: 1, color: '#f59e0b' },

  // --- Operateur d'equipement lourd classe B ---
  { id: 'ccq-operateur-equip-b', trade: 'Opér. d\'équipement lourd - cl. B', sector: 'ICI', hourlyRate: 80.42, nbPersons: 1, color: '#d97706' },
  { id: 'ccq-operateur-equip-b-app', trade: 'Opér. d\'équipement lourd - cl. B', specialty: 'Apprenti', sector: 'ICI', hourlyRate: 71.31, nbPersons: 1, color: '#d97706' },

  // --- Operateur de pelles mecaniques classe A ---
  { id: 'ccq-operateur-pelle-a', trade: 'Opér. de pelles mécaniques - A', sector: 'ICI', hourlyRate: 85.45, nbPersons: 1, color: '#92400e' },
  { id: 'ccq-operateur-pelle-a-app', trade: 'Opér. de pelles mécaniques - A', specialty: 'Apprenti', sector: 'ICI', hourlyRate: 75.57, nbPersons: 1, color: '#92400e' },

  // --- Operateur de pelles mecaniques classe B ---
  { id: 'ccq-operateur-pelle-b', trade: 'Opér. de pelles mécaniques - B', sector: 'ICI', hourlyRate: 83.63, nbPersons: 1, color: '#78350f' },
  { id: 'ccq-operateur-pelle-b-app', trade: 'Opér. de pelles mécaniques - B', specialty: 'Apprenti', sector: 'ICI', hourlyRate: 74.02, nbPersons: 1, color: '#78350f' },

  // --- Operateur de pompe a beton classe A ---
  { id: 'ccq-operateur-pompe-beton-a', trade: 'Opér. de pompe à béton - cl. A', sector: 'ICI', hourlyRate: 85.41, nbPersons: 1, color: '#525252' },
  { id: 'ccq-operateur-pompe-beton-a-app1', trade: 'Opér. de pompe à béton - cl. A', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 75.56, nbPersons: 1, color: '#525252' },

  // --- Operateur de pompe a beton classe B ---
  { id: 'ccq-operateur-pompe-beton-b', trade: 'Opér. de pompe à béton - cl. B', sector: 'ICI', hourlyRate: 82.15, nbPersons: 1, color: '#404040' },
  { id: 'ccq-operateur-pompe-beton-b-app1', trade: 'Opér. de pompe à béton - cl. B', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 75.56, nbPersons: 1, color: '#404040' },

  // --- Parqueteur-sableur ---
  { id: 'ccq-parqueteur-sableur', trade: 'Parqueteur-sableur', sector: 'ICI', hourlyRate: 86.51, nbPersons: 1, color: '#a16207' },
  { id: 'ccq-parqueteur-sableur-app1', trade: 'Parqueteur-sableur', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 61.33, nbPersons: 1, color: '#a16207' },
  { id: 'ccq-parqueteur-sableur-app2', trade: 'Parqueteur-sableur', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 67.38, nbPersons: 1, color: '#a16207' },
  { id: 'ccq-parqueteur-sableur-app3', trade: 'Parqueteur-sableur', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 76.49, nbPersons: 1, color: '#a16207' },

  // --- Peintre ---
  { id: 'ccq-peintre', trade: 'Peintre', sector: 'ICI', hourlyRate: 82.59, nbPersons: 1, color: '#a855f7' },
  { id: 'ccq-peintre-app1', trade: 'Peintre', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 58.99, nbPersons: 1, color: '#a855f7' },
  { id: 'ccq-peintre-app2', trade: 'Peintre', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 64.65, nbPersons: 1, color: '#a855f7' },
  { id: 'ccq-peintre-app3', trade: 'Peintre', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 73.16, nbPersons: 1, color: '#a855f7' },

  // --- Plâtrier ---
  { id: 'ccq-platrier', trade: 'Plâtrier', sector: 'ICI', hourlyRate: 85.48, nbPersons: 1, color: '#c2410c' },
  { id: 'ccq-platrier-app1', trade: 'Plâtrier', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 60.71, nbPersons: 1, color: '#c2410c' },
  { id: 'ccq-platrier-app2', trade: 'Plâtrier', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 66.67, nbPersons: 1, color: '#c2410c' },
  { id: 'ccq-platrier-app3', trade: 'Plâtrier', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 75.62, nbPersons: 1, color: '#c2410c' },

  // --- Poseur de revêtements souples ---
  { id: 'ccq-poseur-revet-souples', trade: 'Poseur de revêtements souples', sector: 'ICI', hourlyRate: 81.14, nbPersons: 1, color: '#8b5cf6' },
  { id: 'ccq-poseur-revet-souples-app1', trade: 'Poseur de revêtements souples', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 58.10, nbPersons: 1, color: '#8b5cf6' },
  { id: 'ccq-poseur-revet-souples-app2', trade: 'Poseur de revêtements souples', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 63.65, nbPersons: 1, color: '#8b5cf6' },
  { id: 'ccq-poseur-revet-souples-app3', trade: 'Poseur de revêtements souples', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 71.93, nbPersons: 1, color: '#8b5cf6' },

  // --- Poseur de systèmes intérieurs ---
  { id: 'ccq-poseur-syst-int', trade: 'Poseur de systèmes intérieurs', sector: 'ICI', hourlyRate: 86.51, nbPersons: 1, color: '#f97316' },
  { id: 'ccq-poseur-syst-int-app1', trade: 'Poseur de systèmes intérieurs', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 61.33, nbPersons: 1, color: '#f97316' },
  { id: 'ccq-poseur-syst-int-app2', trade: 'Poseur de systèmes intérieurs', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 67.38, nbPersons: 1, color: '#f97316' },
  { id: 'ccq-poseur-syst-int-app3', trade: 'Poseur de systèmes intérieurs', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 76.49, nbPersons: 1, color: '#f97316' },

  // --- Tireur de joints (plâtrier) ---
  { id: 'ccq-tireur-joints-platrier', trade: 'Tireur de joints (plâtrier)', sector: 'ICI', hourlyRate: 84.56, nbPersons: 1, color: '#ec4899' },
  { id: 'ccq-tireur-joints-platrier-app1', trade: 'Tireur de joints (plâtrier)', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 60.15, nbPersons: 1, color: '#ec4899' },
  { id: 'ccq-tireur-joints-platrier-app2', trade: 'Tireur de joints (plâtrier)', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 66.02, nbPersons: 1, color: '#ec4899' },
  { id: 'ccq-tireur-joints-platrier-app3', trade: 'Tireur de joints (plâtrier)', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 74.83, nbPersons: 1, color: '#ec4899' },

  // --- Tireur de joints (peintre) ---
  { id: 'ccq-tireur-joints-peintre', trade: 'Tireur de joints (peintre)', sector: 'ICI', hourlyRate: 84.56, nbPersons: 1, color: '#db2777' },
  { id: 'ccq-tireur-joints-peintre-app1', trade: 'Tireur de joints (peintre)', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 60.15, nbPersons: 1, color: '#db2777' },
  { id: 'ccq-tireur-joints-peintre-app2', trade: 'Tireur de joints (peintre)', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 66.02, nbPersons: 1, color: '#db2777' },
  { id: 'ccq-tireur-joints-peintre-app3', trade: 'Tireur de joints (peintre)', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 74.83, nbPersons: 1, color: '#db2777' },

  // --- Tuyauteur (4 periodes apprenti) ---
  { id: 'ccq-tuyauteur', trade: 'Tuyauteur', sector: 'ICI', hourlyRate: 87.54, nbPersons: 1, color: '#3b82f6' },
  { id: 'ccq-tuyauteur-app1', trade: 'Tuyauteur', specialty: 'Apprenti P1', sector: 'ICI', hourlyRate: 55.73, nbPersons: 1, color: '#3b82f6' },
  { id: 'ccq-tuyauteur-app2', trade: 'Tuyauteur', specialty: 'Apprenti P2', sector: 'ICI', hourlyRate: 61.90, nbPersons: 1, color: '#3b82f6' },
  { id: 'ccq-tuyauteur-app3', trade: 'Tuyauteur', specialty: 'Apprenti P3', sector: 'ICI', hourlyRate: 68.10, nbPersons: 1, color: '#3b82f6' },
  { id: 'ccq-tuyauteur-app4', trade: 'Tuyauteur', specialty: 'Apprenti P4', sector: 'ICI', hourlyRate: 77.36, nbPersons: 1, color: '#3b82f6' },

  // ============================================================
  // OCCUPATIONS (sans periodes d'apprentissage)
  // ============================================================

  { id: 'ccq-boutefeu', trade: 'Boutefeu', sector: 'ICI', hourlyRate: 78.05, nbPersons: 1, color: '#991b1b' },
  { id: 'ccq-conducteur-camion-a', trade: 'Conducteur de camion - classe A', sector: 'ICI', hourlyRate: 76.11, nbPersons: 1, color: '#1e40af' },
  { id: 'ccq-conducteur-camion-b', trade: 'Conducteur de camion - classe B', sector: 'ICI', hourlyRate: 74.72, nbPersons: 1, color: '#1d4ed8' },
  { id: 'ccq-conducteur-camion-c', trade: 'Conducteur de camion - classe C', sector: 'ICI', hourlyRate: 74.19, nbPersons: 1, color: '#2563eb' },
  { id: 'ccq-foreur', trade: 'Foreur', sector: 'ICI', hourlyRate: 79.74, nbPersons: 1, color: '#854d0e' },
  { id: 'ccq-arpenteur', trade: 'Homme d\'instrument (arpenteur)', sector: 'ICI', hourlyRate: 79.27, nbPersons: 1, color: '#22c55e' },
  { id: 'ccq-manoeuvre-journalier', trade: 'Manœuvre (journalier)', sector: 'ICI', hourlyRate: 74.71, nbPersons: 1, color: '#a3a3a3' },
  { id: 'ccq-manoeuvre-spec', trade: 'Manœuvre spécialisé', sector: 'ICI', hourlyRate: 76.06, nbPersons: 1, color: '#737373' },
  { id: 'ccq-manoeuvre-spec-carreleur', trade: 'Manœuvre spécialisé (carreleur)', sector: 'ICI', hourlyRate: 77.19, nbPersons: 1, color: '#525252' },
  { id: 'ccq-operateur-levage-a', trade: 'Opér. d\'appareils de levage - cl. A', sector: 'ICI', hourlyRate: 80.77, nbPersons: 1, color: '#ca8a04' },
  { id: 'ccq-operateur-levage-b', trade: 'Opér. d\'appareils de levage - cl. B', sector: 'ICI', hourlyRate: 78.74, nbPersons: 1, color: '#a16207' },
  { id: 'ccq-operateur-pompes-compres', trade: 'Opér. de pompes et compresseurs', sector: 'ICI', hourlyRate: 79.59, nbPersons: 1, color: '#0891b2' },
  { id: 'ccq-operateur-usines', trade: 'Op. d\'usines fixes ou mobiles', sector: 'ICI', hourlyRate: 75.18, nbPersons: 1, color: '#0e7490' },
  { id: 'ccq-soudeur', trade: 'Soudeur', sector: 'ICI', hourlyRate: 84.29, nbPersons: 1, color: '#e11d48' },
  { id: 'ccq-soudeur-tuyauterie', trade: 'Soudeur en tuyauterie', sector: 'ICI', hourlyRate: 87.54, nbPersons: 1, color: '#be123c' },
  { id: 'ccq-gas-fitter', trade: 'Spécialiste en branchement d\'immeubles (gas fitter)', sector: 'ICI', hourlyRate: 87.54, nbPersons: 1, color: '#9d174d' },
];
