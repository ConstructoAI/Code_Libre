/**
 * wallValidations.ts - Phase 11 Conformite Entrepreneur General Quebec
 *
 * Profil: EG Quebec, 40 ans terrain, RBQ certifie.
 * Vocabulaire: montants, lisses, jambages, linteaux, sheathing, composition.
 * Normes: CCQ 9.x, CNB 9.x, CSA O86, Novoclimat 2.0.
 *
 * Contient:
 * - Types etendus pour configuration EG (zone climatique, type batiment, coupe-feu, etc.)
 * - Constantes Quebec 2026: R-valeurs min, prix materiaux, taux CCQ, waste %
 * - Validations 11 a 20 (en complement des 10 de Phase 10 dans MursParametriquePanel)
 * - getRequiredRValue, detectRequiredFireRating
 * - calculateMurCost (estimation couts complete avec TPS/TVQ)
 */

import type {
  MurWall,
  MurOpening,
  MurPiece,
  MurValidation,
  MurStudSize,
} from './MursParametriquePanel';

// ============================================
// TYPES ETENDUS EG
// ============================================

export type MurWallType = 'porteur' | 'non-porteur';
export type MurWallLocation = 'exterieur' | 'interieur' | 'mitoyen' | 'garage-attache';
export type MurClimateZone =
  | 'montreal-laval'
  | 'quebec-estrie'
  | 'saguenay-trois-rivieres'
  | 'nord-du-quebec'
  | 'autre';
export type MurFireRating = 'aucun' | '45min' | '1h' | '2h';
export type MurBuildingType =
  | 'residentiel-neuf'
  | 'residentiel-renovation'
  | 'commercial'
  | 'institutionnel'
  | 'multi-logement';

export interface MurEgConfig {
  wallType: MurWallType;
  wallLocation: MurWallLocation;
  climateZone: MurClimateZone;
  useNovoclimat: boolean;
  fireRating: MurFireRating;
  buildingType: MurBuildingType;
  isNordique: boolean; // True if neige > 50 psf
}

// ============================================
// CONSTANTES QUEBEC 2026
// ============================================

// R-valeurs minimales par zone climatique (CNB Quebec partie 9, table 9.36)
// Source : CNB 2020 modifie Quebec, en vigueur depuis 2022 pour residentiel neuf.
export const R_VALUES_MIN: Record<MurClimateZone, { murExt: number; toit: number; sousSol: number }> = {
  'montreal-laval': { murExt: 24.5, toit: 41, sousSol: 17 },
  'quebec-estrie': { murExt: 24.5, toit: 46, sousSol: 17 },
  'saguenay-trois-rivieres': { murExt: 24.5, toit: 48, sousSol: 17 },
  'nord-du-quebec': { murExt: 28, toit: 50, sousSol: 20 },
  'autre': { murExt: 24.5, toit: 46, sousSol: 17 },
};

// Bonus Novoclimat 2.0 (au-dessus du min CNB)
export const R_VALUES_NOVOCLIMAT: Record<MurClimateZone, number> = {
  'montreal-laval': 30,
  'quebec-estrie': 35,
  'saguenay-trois-rivieres': 38,
  'nord-du-quebec': 40,
  'autre': 35,
};

// Espacement montants recommande par zone (charge neige influence dimensionnement)
export const STUD_SPACING_RECOMMENDED: Record<MurClimateZone, number> = {
  'montreal-laval': 16,
  'quebec-estrie': 16,
  'saguenay-trois-rivieres': 16,
  'nord-du-quebec': 12, // Charge neige > 50 psf, 12" o.c. recommande
  'autre': 16,
};

// Prix materiaux Quebec 2026 (CAD, prix entrepreneur HT, pas detail)
export const PRICES_QC_2026 = {
  // SPF (Spruce-Pine-Fir) - $/piece
  spf_2x4_8: 4.00,
  spf_2x4_10: 4.95,
  spf_2x4_12: 5.90,
  spf_2x6_8: 6.25,
  spf_2x6_10: 7.80,
  spf_2x6_12: 9.40,
  spf_2x8_8: 9.50,
  spf_2x8_10: 11.85,
  spf_2x8_12: 14.20,
  spf_2x10_8: 13.20,
  spf_2x10_10: 16.50,
  spf_2x10_12: 19.80,
  // LVL (Laminated Veneer Lumber) 11 7/8" - $/pi lineaire
  lvl_per_lf: 8.50,
  // Gypse - $/feuille 4x8
  gypse_5_8_4x8: 16.00,
  gypse_1_2_4x8: 14.00,
  gypse_resistant_feu_5_8: 22.00, // Type X
  // Isolant fibre de verre/laine roche - $/pi2
  isolant_batt_r20_pi2: 1.85,
  isolant_batt_r24_pi2: 2.25,
  isolant_batt_r28_pi2: 2.75,
  // Membranes - $/pi2
  membrane_tyvek_pi2: 0.65,
  membrane_bitume_pi2: 0.85,
  // Sheathing - $/feuille 4x8
  osb_15_32_4x8: 22.00,
  osb_19_32_4x8: 28.00,
  contreplaque_5_8_4x8: 42.00,
  // Quincaillerie
  vis_structure_kg: 8.50, // Vis #10 x 3"
  clous_2_5po_kg: 5.20, // Clous 2 1/2" pneumatiques
};

// Taux CCQ 2026 (charpentier menuisier secteur residentiel)
export const CCQ_RATES_2026 = {
  charpentier_menuisier: 88.38, // $/h taux brut 2026 (avec avantages sociaux)
  charpentier_chantier: 50.21, // $/h taux salarial 2026
  contingence_neuf_pct: 12,
  contingence_renovation_pct: 15,
  admin_pct: 8,
  profit_pct: 10,
};

// Waste % par materiau (perte chantier typique)
export const WASTE_PCT = {
  bois: 10, // 10% perte coupes/defauts
  gypse: 15, // 15% (feuilles 4x8 a couper)
  isolant: 20, // 20% (16" o.c. vs 24" precoupe)
  membranes: 10,
  sheathing: 10,
};

// Taxes Quebec 2026
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

// Conversions
const SQIN_PER_SQFT = 144;

// ============================================
// HELPERS
// ============================================

// Get R-value requise selon zone, emplacement et Novoclimat
export function getRequiredRValue(
  zone: MurClimateZone,
  location: MurWallLocation,
  useNovoclimat: boolean,
): number {
  if (location === 'interieur') return 0; // Pas d'exigence thermique interieur
  if (location === 'mitoyen') return 0; // Mitoyen: priorite acoustique/coupe-feu
  if (useNovoclimat) return R_VALUES_NOVOCLIMAT[zone];
  // Garage attache et exterieur: meme exigence enveloppe
  return R_VALUES_MIN[zone].murExt;
}

// Detect le coupe-feu requis automatiquement selon emplacement et type batiment
export function detectRequiredFireRating(
  wallLocation: MurWallLocation,
  buildingType: MurBuildingType,
): MurFireRating {
  // Garage attache: separation 45 min minimum CNB 9.10.9.16 (gypse 5/8" type X 1 ply)
  if (wallLocation === 'garage-attache') return '45min';

  // Mur mitoyen multi-logement: 2h CNB 9.10.9 (2 plis type X chaque cote)
  if (wallLocation === 'mitoyen' && buildingType === 'multi-logement') return '2h';

  // Mur mitoyen residentiel jumele: 1h
  if (wallLocation === 'mitoyen') return '1h';

  // Commercial / institutionnel: 1h par defaut sur murs porteurs
  if (buildingType === 'commercial' || buildingType === 'institutionnel') return '1h';

  return 'aucun';
}

// Calcul R-value estime selon studType + isolation (approximation R-3.2/po laine)
function estimateActualRValue(studType: MurStudSize): number {
  // Cavite isolation moyenne par stud size (assumption batt standard)
  const cavityR: Record<MurStudSize, number> = {
    '2x4': 14, // 3.5" cavite -> R-14 batt
    '2x6': 20, // 5.5" cavite -> R-20 batt
    '2x8': 28, // 7.25" cavite -> R-28 batt
  };
  return cavityR[studType];
}

// ============================================
// VALIDATIONS EG (11 a 20)
// ============================================

/**
 * Validations enrichies selon profil EG Quebec.
 * En complement des 10 validations de validateWallCCQ (Phase 10).
 * Retourne UNIQUEMENT les validations EG (11-20).
 */
export function validateWallEg(
  wall: MurWall,
  openings: MurOpening[],
  egConfig: MurEgConfig,
): MurValidation[] {
  const warnings: MurValidation[] = [];
  const { wallType, wallLocation, climateZone, useNovoclimat, buildingType, isNordique } = egConfig;

  // 11. Mur porteur sans doublage linteau pour grandes ouvertures
  if (wallType === 'porteur') {
    for (const op of openings) {
      if (op.width > 48 && op.width <= 72) {
        warnings.push({
          level: 'warning',
          code: 'EG CSA O86',
          message: `Ouverture ${op.width}" > 4' sur mur porteur: linteau LVL 11 7/8" ou doublage 2-2x10 obligatoire (CSA O86 dimensionnement).`,
        });
      }
    }
  }

  // 12. Mur exterieur sans isolation suffisante (2x4 en zone froide)
  if (wallLocation === 'exterieur' && wall.studType === '2x4' && climateZone !== 'montreal-laval') {
    warnings.push({
      level: 'warning',
      code: 'EG CNB 9.36',
      message: `Mur exterieur 2x4 en zone ${climateZone}: cavite insuffisante pour R-24+ requis. Passer en 2x6 ou ajouter isolant exterieur rigide.`,
    });
  }

  // 13. Coupe-feu manquant garage attache (gypse 5/8" type X)
  if (wallLocation === 'garage-attache') {
    warnings.push({
      level: 'error',
      code: 'EG CCQ I.2.4',
      message: 'Mur garage attache: gypse 5/8" type X obligatoire cote habitation (CCQ I.2.4 / CNB 9.10.9.16, separation 45 min).',
    });
  }

  // 14. Multi-logement coupe-feu 2h
  if (wallLocation === 'mitoyen' && buildingType === 'multi-logement') {
    warnings.push({
      level: 'error',
      code: 'EG CNB 9.10.9',
      message: 'Mur mitoyen multi-logement: 2h coupe-feu obligatoire (2 plis gypse 5/8" type X chaque cote + isolant cavite + scelles tous joints).',
    });
  }

  // 15. Zone nordique espacement trop large
  if (isNordique && wall.studSpacing > 12) {
    warnings.push({
      level: 'warning',
      code: 'EG CNB 9.4',
      message: `Zone nordique (neige > 50 psf): espacement montants ${wall.studSpacing}" o.c. trop large. Recommande 12" o.c. pour charge accumulee toiture.`,
    });
  }

  // 16. Tall wall sans entretoise mi-hauteur
  if (wall.studHeight > 120) {
    warnings.push({
      level: 'warning',
      code: 'EG CSA O86',
      message: `Mur haut (${wall.studHeight}" > 10'): considerer entretoise mi-hauteur, poutre intermediaire ou montants ingenieres (LSL/LVL).`,
    });
  }

  // 17. Mur porteur largeur ouverture > 6' (LVL ingenieur obligatoire)
  if (wallType === 'porteur') {
    for (const op of openings) {
      if (op.width > 72) {
        warnings.push({
          level: 'error',
          code: 'EG CSA O86',
          message: `Ouverture ${op.width}" > 6' sur mur porteur: poutre LVL dimensionnee par ingenieur OBLIGATOIRE (CSA O86 - depasse tables CNB).`,
        });
      }
    }
  }

  // 18. Renforcement coin exterieur (doublage)
  if (wallLocation === 'exterieur' && wall.doubleStuds === false) {
    warnings.push({
      level: 'info',
      code: 'EG Pratique',
      message: 'EG recommande doublage montants de coin sur mur exterieur (fixation gypse + revetement, rigidite assemblage).',
    });
  }

  // 19. Sheathing absent mur exterieur
  if (wallLocation === 'exterieur' && wall.hasSheathing === false) {
    warnings.push({
      level: 'error',
      code: 'EG CCQ 9.23',
      message: 'Sheathing structural OBLIGATOIRE sur mur exterieur (OSB 7/16" ou CDX 1/2" min). Resistance laterale + support revetement.',
    });
  }

  // 20. Isolation insuffisante mur exterieur
  if (wallLocation === 'exterieur') {
    const required = getRequiredRValue(climateZone, wallLocation, useNovoclimat);
    const estimated = estimateActualRValue(wall.studType);
    if (estimated < required) {
      warnings.push({
        level: 'error',
        code: 'EG CNB 9.36',
        message: `Isolation R-${estimated} estimee < R-${required} requis (zone ${climateZone}${useNovoclimat ? ' Novoclimat' : ''}). Augmenter cavite (2x6/2x8) ou ajouter isolant exterieur rigide.`,
      });
    }
  }

  return warnings;
}

// ============================================
// CALCUL COUTS COMPLET
// ============================================

export interface MurCostEstimate {
  materiaux: {
    bois: number;
    gypse: number;
    isolant: number;
    sheathing: number;
    membranes: number;
    quincaillerie: number;
    total: number;
  };
  mainOeuvre: {
    heuresEstimees: number;
    nbHommes: number;
    tauxHoraire: number;
    total: number;
  };
  fraisGeneraux: {
    contingence: number;
    admin: number;
    profit: number;
  };
  sousTotal: number;
  tps: number;
  tvq: number;
  totalTtc: number;
  perPi2: number;
}

// Prix unitaire SPF par studType et longueur (8 pi)
function getStudPrice(studType: MurStudSize, lengthIn: number): number {
  // Choisir longueur standard (8', 10', 12') >= longueur requise
  const lengthFt = lengthIn / 12;
  const stdLengths = [8, 10, 12];
  const pickedLen = stdLengths.find((l) => l >= lengthFt) ?? 12;

  const key = `spf_${studType}_${pickedLen}` as keyof typeof PRICES_QC_2026;
  const price = PRICES_QC_2026[key];
  return typeof price === 'number' ? price : PRICES_QC_2026.spf_2x6_8;
}

// Prix isolant batt par R-value requis (interpolation lineaire entre les paliers)
function getIsolantPricePerSqFt(rRequired: number): number {
  if (rRequired <= 0) return 0;
  if (rRequired <= 20) return PRICES_QC_2026.isolant_batt_r20_pi2;
  if (rRequired <= 24) return PRICES_QC_2026.isolant_batt_r24_pi2;
  return PRICES_QC_2026.isolant_batt_r28_pi2;
}

/**
 * Calcule le cout total estime d'un mur avec materiaux + main-d'oeuvre + frais + taxes.
 * Profil EG: prix entrepreneur Quebec 2026, waste %, contingences, CCQ 88.38$/h.
 */
export function calculateMurCost(
  wall: MurWall,
  pieces: MurPiece[],
  egConfig: MurEgConfig,
): MurCostEstimate {
  // ===== Surface du mur (pi2) =====
  const wallSurfaceSqIn = wall.length * (wall.studHeight + 4.5); // length x (stud + 3 plates)
  const wallSurfaceSqFt = wallSurfaceSqIn / SQIN_PER_SQFT;

  // ===== Bois: somme prix par piece selon studType + longueur =====
  let boisRaw = 0;
  for (const p of pieces) {
    if (p.kind === 'stud' || p.kind === 'king' || p.kind === 'jack' || p.kind === 'cripple') {
      boisRaw += getStudPrice(wall.studType, p.h);
    } else if (p.kind === 'plate' || p.kind === 'extraplate') {
      // Lisses: prix par section 8' (couper si besoin)
      const nb8FtSections = Math.ceil(p.w / 96);
      boisRaw += getStudPrice(wall.studType, 96) * nb8FtSections;
    } else if (p.kind === 'header') {
      // Linteau: si grosse ouverture, considerer LVL (lvl_per_lf)
      if (p.w > 48) {
        boisRaw += (p.w / 12) * PRICES_QC_2026.lvl_per_lf;
      } else {
        // Sinon doublage 2x10 SPF
        boisRaw += getStudPrice('2x8', p.w) * 2; // approximation 2-2x8 ou 2-2x10
      }
    } else if (p.kind === 'sill' || p.kind === 'blocking') {
      const nb8FtSections = Math.ceil(p.w / 96);
      boisRaw += getStudPrice(wall.studType, 96) * nb8FtSections;
    }
  }
  const bois = boisRaw * (1 + WASTE_PCT.bois / 100);

  // ===== Gypse: 1 cote interieur toujours, 2 cotes si mitoyen/garage-attache, +5/8 type X si requis =====
  let gypseSqFt = wallSurfaceSqFt; // 1 cote interieur par defaut
  let gypseUnitPrice = PRICES_QC_2026.gypse_1_2_4x8 / 32; // 32 pi2 par feuille 4x8

  if (egConfig.fireRating !== 'aucun' || egConfig.wallLocation === 'garage-attache') {
    gypseUnitPrice = PRICES_QC_2026.gypse_resistant_feu_5_8 / 32;
  }

  if (egConfig.wallLocation === 'mitoyen') {
    gypseSqFt = wallSurfaceSqFt * 2; // les deux cotes
    if (egConfig.buildingType === 'multi-logement') {
      gypseSqFt *= 2; // 2 plis chaque cote = 4 plis total
    }
  } else if (egConfig.wallLocation === 'garage-attache') {
    // Garage attache: gypse type X cote habitation + gypse standard cote garage (CCQ I.2.4)
    gypseSqFt = wallSurfaceSqFt * 2;
  }
  const gypse = gypseSqFt * gypseUnitPrice * (1 + WASTE_PCT.gypse / 100);

  // ===== Isolant: surface mur x prix selon R requis =====
  const rRequired = getRequiredRValue(egConfig.climateZone, egConfig.wallLocation, egConfig.useNovoclimat);
  const isolantPriceSqFt = getIsolantPricePerSqFt(rRequired);
  const isolant = wallSurfaceSqFt * isolantPriceSqFt * (1 + WASTE_PCT.isolant / 100);

  // ===== Sheathing: si mur exterieur =====
  let sheathing = 0;
  if (wall.hasSheathing && egConfig.wallLocation === 'exterieur') {
    const sheathPrice = wall.sheathingThickness === '7/16' || wall.sheathingThickness === '1/2'
      ? PRICES_QC_2026.osb_15_32_4x8
      : PRICES_QC_2026.osb_19_32_4x8;
    sheathing = (wallSurfaceSqFt / 32) * sheathPrice * (1 + WASTE_PCT.sheathing / 100);
  }

  // ===== Membranes: pare-air + pare-vapeur si exterieur =====
  let membranes = 0;
  if (egConfig.wallLocation === 'exterieur') {
    membranes = wallSurfaceSqFt * PRICES_QC_2026.membrane_tyvek_pi2 * (1 + WASTE_PCT.membranes / 100);
  }

  // ===== Quincaillerie: 5% du bois =====
  const quincaillerie = bois * 0.05;

  const totalMateriaux = bois + gypse + isolant + sheathing + membranes + quincaillerie;

  // ===== Main-d'oeuvre =====
  // Estimation: charpentier moyenne 4-6 h par mur 8' standard
  // Multiplier par facteurs: ouvertures (+0.5h chacune), hauteur (>10' x1.3), porteur (+20%)
  let heuresBase = (wall.length / 96) * 5; // 5h par section 8'
  heuresBase += 0.5 * pieces.filter((p) => p.kind === 'header').length;
  if (wall.studHeight > 120) heuresBase *= 1.3;
  if (egConfig.wallType === 'porteur') heuresBase *= 1.2;
  if (egConfig.wallLocation === 'mitoyen' && egConfig.buildingType === 'multi-logement') heuresBase *= 1.5;

  const tauxHoraire = CCQ_RATES_2026.charpentier_menuisier;
  const nbHommes = 2; // Typique 2 charpentiers
  const totalMainOeuvre = heuresBase * tauxHoraire;

  // ===== Frais generaux =====
  const baseAvantFrais = totalMateriaux + totalMainOeuvre;
  const contingencePct = egConfig.buildingType === 'residentiel-renovation'
    ? CCQ_RATES_2026.contingence_renovation_pct
    : CCQ_RATES_2026.contingence_neuf_pct;
  const contingence = baseAvantFrais * (contingencePct / 100);
  const admin = baseAvantFrais * (CCQ_RATES_2026.admin_pct / 100);
  const profit = baseAvantFrais * (CCQ_RATES_2026.profit_pct / 100);

  const sousTotal = baseAvantFrais + contingence + admin + profit;
  const tps = sousTotal * TPS_RATE;
  const tvq = sousTotal * TVQ_RATE;
  const totalTtc = sousTotal + tps + tvq;

  const perPi2 = wallSurfaceSqFt > 0 ? sousTotal / wallSurfaceSqFt : 0;

  return {
    materiaux: {
      bois: Math.round(bois * 100) / 100,
      gypse: Math.round(gypse * 100) / 100,
      isolant: Math.round(isolant * 100) / 100,
      sheathing: Math.round(sheathing * 100) / 100,
      membranes: Math.round(membranes * 100) / 100,
      quincaillerie: Math.round(quincaillerie * 100) / 100,
      total: Math.round(totalMateriaux * 100) / 100,
    },
    mainOeuvre: {
      heuresEstimees: Math.round(heuresBase * 10) / 10,
      nbHommes,
      tauxHoraire,
      total: Math.round(totalMainOeuvre * 100) / 100,
    },
    fraisGeneraux: {
      contingence: Math.round(contingence * 100) / 100,
      admin: Math.round(admin * 100) / 100,
      profit: Math.round(profit * 100) / 100,
    },
    sousTotal: Math.round(sousTotal * 100) / 100,
    tps: Math.round(tps * 100) / 100,
    tvq: Math.round(tvq * 100) / 100,
    totalTtc: Math.round(totalTtc * 100) / 100,
    perPi2: Math.round(perPi2 * 100) / 100,
  };
}

// ============================================
// COMPOSITIONS PREDEFINIES
// ============================================

export interface MurCompositionPreset {
  id: string;
  name: string;
  description: string;
  wallChanges: Partial<MurWall>;
  egConfigChanges: Partial<MurEgConfig>;
}

export const COMPOSITIONS_PRESETS: MurCompositionPreset[] = [
  {
    id: 'ext-residentiel-r24',
    name: 'Mur ext residentiel R-24',
    description: '2x6 16" o.c., sheathing OSB 7/16", isolant R-24, gypse 1/2".',
    wallChanges: {
      studType: '2x6',
      studSpacing: 16,
      hasSheathing: true,
      sheathingThickness: '7/16',
    },
    egConfigChanges: {
      wallType: 'porteur',
      wallLocation: 'exterieur',
      useNovoclimat: false,
      fireRating: 'aucun',
    },
  },
  {
    id: 'ext-novoclimat-r30',
    name: 'Mur ext Novoclimat R-30',
    description: '2x6 + furring strapping, isolant cavite R-24 + R-6 exterieur.',
    wallChanges: {
      studType: '2x6',
      studSpacing: 16,
      hasSheathing: true,
      sheathingThickness: '1/2',
      doubleStuds: true,
    },
    egConfigChanges: {
      wallType: 'porteur',
      wallLocation: 'exterieur',
      useNovoclimat: true,
      fireRating: 'aucun',
    },
  },
  {
    id: 'garage-attache-1h',
    name: 'Mur garage attache 1h',
    description: 'Gypse 5/8" type X cote habitation, isolant R-20, sheathing structural.',
    wallChanges: {
      studType: '2x6',
      studSpacing: 16,
      hasSheathing: true,
      sheathingThickness: '1/2',
    },
    egConfigChanges: {
      wallType: 'porteur',
      wallLocation: 'garage-attache',
      useNovoclimat: false,
      fireRating: '1h',
    },
  },
  {
    id: 'mitoyen-2h',
    name: 'Mur mitoyen 2h',
    description: '2 plis gypse 5/8" type X chaque cote, isolant insonorisant, scelles joints.',
    wallChanges: {
      studType: '2x6',
      studSpacing: 16,
      doubleStuds: true,
      hasBlocking: true,
    },
    egConfigChanges: {
      wallType: 'porteur',
      wallLocation: 'mitoyen',
      useNovoclimat: false,
      fireRating: '2h',
      buildingType: 'multi-logement',
    },
  },
  {
    id: 'cloison-interieure-2x4',
    name: 'Cloison interieure 2x4',
    description: 'Configuration minimum: 2x4 16" o.c., gypse 1/2" chaque cote.',
    wallChanges: {
      studType: '2x4',
      studSpacing: 16,
      hasSheathing: false,
      doubleStuds: false,
    },
    egConfigChanges: {
      wallType: 'non-porteur',
      wallLocation: 'interieur',
      useNovoclimat: false,
      fireRating: 'aucun',
    },
  },
  {
    id: 'tall-wall-2x8',
    name: 'Tall wall 2x8',
    description: 'Mur > 10\' hauteur: 2x8 12" o.c., entretoise mi-hauteur, blocage horizontal.',
    wallChanges: {
      studType: '2x8',
      studSpacing: 12,
      studHeight: 144,
      hasBlocking: true,
      blockingSpacing: 48,
      doubleStuds: true,
    },
    egConfigChanges: {
      wallType: 'porteur',
      wallLocation: 'exterieur',
      useNovoclimat: false,
      fireRating: 'aucun',
    },
  },
];

// ============================================
// DEFAULT EG CONFIG
// ============================================

export const DEFAULT_EG_CONFIG: MurEgConfig = {
  wallType: 'porteur',
  wallLocation: 'exterieur',
  climateZone: 'montreal-laval',
  useNovoclimat: false,
  fireRating: 'aucun',
  buildingType: 'residentiel-neuf',
  isNordique: false,
};
