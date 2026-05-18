/**
 * ERP React Frontend - Maison Projet Zustand Store (Phase 15)
 *
 * Store multi-niveaux pour projet maison complete.
 * Permet de regrouper Plancher / Murs / Toiture / Revetement / FloorPlan
 * sous un meme projet, avec un ou plusieurs niveaux (Sous-sol, Niveau 1, 2...).
 *
 * Inspiration: Wall Builder Pro mobile app (gestion maison complete multi-etages).
 *
 * Persistance: localStorage cle 'maison-project-v1' via middleware zustand/persist.
 * Auto-save: chaque mutation declenche un debounce de 1s qui met a jour
 * updatedAt et synchronise savedProjects.
 *
 * Aucune dependance externe nouvelle (zustand 5 deja installe).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ============================================
// TYPES PUBLICS
// ============================================

export type LevelId = number;

export interface MaisonLevel {
  id: LevelId;
  name: string;
  heightFt: number;
  heightIn: number;
  order: number;
  plancher?: unknown;
  murs?: unknown[];
  toiture?: unknown;
  revetement?: unknown;
  floorPlan?: unknown;
}

export interface MaisonProject {
  id: string;
  name: string;
  clientName?: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
  levels: MaisonLevel[];
  totalSurfaceFt2?: number;
  totalCost?: number;
  notes?: string;
}

export interface MaisonProjectStore {
  // Etat
  currentProject: MaisonProject | null;
  currentLevelId: LevelId;
  savedProjects: MaisonProject[];

  // Actions Projet
  createProject: (name: string) => void;
  loadProject: (id: string) => boolean;
  saveCurrentProject: () => void;
  deleteSavedProject: (id: string) => void;
  renameProject: (newName: string) => void;
  exportProject: () => string;
  importProject: (jsonStr: string) => boolean;
  resetProject: () => void;

  // Actions Niveaux
  setCurrentLevel: (levelId: LevelId) => void;
  addLevel: (name?: string, heightFt?: number) => LevelId;
  removeLevel: (levelId: LevelId) => void;
  renameLevel: (levelId: LevelId, newName: string) => void;
  reorderLevels: (newOrder: LevelId[]) => void;
  duplicateLevel: (levelId: LevelId, newName: string) => LevelId;

  // Actions Categories
  updatePlancher: (levelId: LevelId, data: unknown) => void;
  updateMurs: (levelId: LevelId, walls: unknown[]) => void;
  updateToiture: (levelId: LevelId, data: unknown) => void;
  updateRevetement: (levelId: LevelId, data: unknown) => void;
  updateFloorPlan: (levelId: LevelId, plan: unknown) => void;

  // Selecteurs
  getCurrentLevel: () => MaisonLevel | null;
  getLevelById: (levelId: LevelId) => MaisonLevel | null;
  computeTotalSurface: () => number;
}

// ============================================
// CONSTANTES
// ============================================

const STORAGE_KEY = 'maison-project-v1';
const STORAGE_VERSION = 1;
const AUTOSAVE_DEBOUNCE_MS = 1000;

export const MAISON_LIMITS = {
  MIN_LEVELS: 1,
  MAX_LEVELS: 5,
  MIN_HEIGHT_IN: 72,   // 6 pieds
  MAX_HEIGHT_IN: 168,  // 14 pieds
  MIN_HEIGHT_FT: 6,
  MAX_HEIGHT_FT: 14,
  MIN_NAME_LENGTH: 1,
  MAX_NAME_LENGTH: 30,
  MAX_PROJECT_NAME_LENGTH: 80,
  DEFAULT_HEIGHT_FT: 8,
  DEFAULT_HEIGHT_IN: 0,
} as const;

// ============================================
// UTILS
// ============================================

function genUuid(): string {
  // Compatibilite navigateurs modernes + fallback simple
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback non cryptographique (collision improbable pour cet usage local)
  const rnd = () => Math.random().toString(16).slice(2, 10);
  return `${rnd()}-${rnd()}-${rnd()}-${rnd()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sanitizeLevelName(raw: string, fallback: string): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, MAISON_LIMITS.MAX_NAME_LENGTH);
}

function totalHeightInches(level: MaisonLevel): number {
  return clamp(
    level.heightFt * 12 + level.heightIn,
    MAISON_LIMITS.MIN_HEIGHT_IN,
    MAISON_LIMITS.MAX_HEIGHT_IN,
  );
}

function defaultLevel(id: LevelId, name: string, order: number): MaisonLevel {
  return {
    id,
    name,
    heightFt: MAISON_LIMITS.DEFAULT_HEIGHT_FT,
    heightIn: MAISON_LIMITS.DEFAULT_HEIGHT_IN,
    order,
    plancher: undefined,
    murs: [],
    toiture: undefined,
    revetement: undefined,
    floorPlan: undefined,
  };
}

function nextLevelId(levels: MaisonLevel[]): LevelId {
  // Sous-sol = 0 reserve. Niveau N occupe ID N. On choisit le plus petit
  // ID positif non utilise (1, 2, 3...).
  const usedIds = new Set(levels.map((l) => l.id));
  for (let candidate = 1; candidate <= MAISON_LIMITS.MAX_LEVELS; candidate += 1) {
    if (!usedIds.has(candidate)) return candidate;
  }
  // Si tous occupes (cas extreme), prendre max + 1
  const maxId = levels.reduce((m, l) => Math.max(m, l.id), 0);
  return maxId + 1;
}

function defaultLevelName(id: LevelId): string {
  if (id === 0) return 'Sous-sol';
  return `Niveau ${id}`;
}

function newProject(name: string): MaisonProject {
  const trimmedName = sanitizeLevelName(name, 'Nouveau projet maison');
  const firstLevel = defaultLevel(1, 'Niveau 1', 0);
  const ts = nowIso();
  return {
    id: genUuid(),
    name: trimmedName.length > 0 ? trimmedName : 'Nouveau projet maison',
    createdAt: ts,
    updatedAt: ts,
    levels: [firstLevel],
  };
}

function upsertSavedProject(
  list: MaisonProject[],
  project: MaisonProject,
): MaisonProject[] {
  const idx = list.findIndex((p) => p.id === project.id);
  if (idx === -1) return [project, ...list];
  const copy = list.slice();
  copy[idx] = project;
  return copy;
}

// ============================================
// AUTO-SAVE DEBOUNCE
// ============================================

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoSave(fn: () => void) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    try {
      fn();
    } catch (err) {
      // Erreur silencieuse en auto-save: ne pas faire crasher l'app
      // eslint-disable-next-line no-console
      console.warn('[useMaisonProjectStore] autosave error', err);
    }
  }, AUTOSAVE_DEBOUNCE_MS);
}

// ============================================
// STORE
// ============================================

export const useMaisonProjectStore = create<MaisonProjectStore>()(
  persist(
    (set, get) => {
      // Helper interne: mutation immutable sur le projet courant
      function mutateProject(
        mutator: (p: MaisonProject) => MaisonProject,
      ): MaisonProject | null {
        const { currentProject } = get();
        if (!currentProject) return null;
        const next: MaisonProject = mutator({
          ...currentProject,
          levels: currentProject.levels.map((l) => ({ ...l })),
        });
        next.updatedAt = nowIso();
        set({ currentProject: next });
        scheduleAutoSave(() => {
          const fresh = get().currentProject;
          if (fresh) {
            set((s) => ({ savedProjects: upsertSavedProject(s.savedProjects, fresh) }));
          }
        });
        return next;
      }

      function updateLevel(
        levelId: LevelId,
        patch: Partial<MaisonLevel>,
      ): void {
        // Clamp defensif des hauteurs si presentes dans le patch
        const safePatch: Partial<MaisonLevel> = { ...patch };
        if (typeof safePatch.heightFt === 'number') {
          safePatch.heightFt = clamp(
            safePatch.heightFt,
            MAISON_LIMITS.MIN_HEIGHT_FT,
            MAISON_LIMITS.MAX_HEIGHT_FT,
          );
        }
        if (typeof safePatch.heightIn === 'number') {
          safePatch.heightIn = clamp(safePatch.heightIn, 0, 11.99);
        }
        mutateProject((p) => ({
          ...p,
          levels: p.levels.map((l) => (l.id === levelId ? { ...l, ...safePatch } : l)),
        }));
      }

      return {
        // ----- Etat initial -----
        currentProject: null,
        currentLevelId: 1,
        savedProjects: [],

        // ----- Actions Projet -----
        createProject: (name) => {
          const project = newProject(name);
          set({
            currentProject: project,
            currentLevelId: project.levels[0]?.id ?? 1,
          });
          scheduleAutoSave(() => {
            const fresh = get().currentProject;
            if (fresh) {
              set((s) => ({ savedProjects: upsertSavedProject(s.savedProjects, fresh) }));
            }
          });
        },

        loadProject: (id) => {
          const target = get().savedProjects.find((p) => p.id === id);
          if (!target) return false;
          const cloned: MaisonProject = {
            ...target,
            levels: target.levels.map((l) => ({ ...l })),
          };
          const firstLevelId = cloned.levels[0]?.id ?? 1;
          set({
            currentProject: cloned,
            currentLevelId: firstLevelId,
          });
          return true;
        },

        saveCurrentProject: () => {
          const { currentProject } = get();
          if (!currentProject) return;
          const toSave: MaisonProject = {
            ...currentProject,
            updatedAt: nowIso(),
            levels: currentProject.levels.map((l) => ({ ...l })),
          };
          set((s) => ({
            currentProject: toSave,
            savedProjects: upsertSavedProject(s.savedProjects, toSave),
          }));
        },

        deleteSavedProject: (id) => {
          set((s) => ({
            savedProjects: s.savedProjects.filter((p) => p.id !== id),
            currentProject:
              s.currentProject?.id === id ? null : s.currentProject,
          }));
        },

        renameProject: (newName) => {
          const trimmed = (newName ?? '').trim();
          if (trimmed.length === 0) return;
          mutateProject((p) => ({
            ...p,
            name: trimmed.slice(0, MAISON_LIMITS.MAX_PROJECT_NAME_LENGTH),
          }));
        },

        exportProject: () => {
          const { currentProject } = get();
          if (!currentProject) return '';
          return JSON.stringify(currentProject, null, 2);
        },

        importProject: (jsonStr) => {
          try {
            const parsed = JSON.parse(jsonStr) as Partial<MaisonProject>;
            if (
              !parsed ||
              typeof parsed !== 'object' ||
              !Array.isArray(parsed.levels) ||
              typeof parsed.name !== 'string'
            ) {
              return false;
            }
            // Reconstruction defensive (on accepte les champs inconnus mais on garantit
            // la presence des champs requis)
            const sanitized: MaisonProject = {
              id: typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : genUuid(),
              name: parsed.name.slice(0, MAISON_LIMITS.MAX_PROJECT_NAME_LENGTH),
              clientName: typeof parsed.clientName === 'string' ? parsed.clientName : undefined,
              address: typeof parsed.address === 'string' ? parsed.address : undefined,
              createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : nowIso(),
              updatedAt: nowIso(),
              notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
              totalSurfaceFt2: typeof parsed.totalSurfaceFt2 === 'number' ? parsed.totalSurfaceFt2 : undefined,
              totalCost: typeof parsed.totalCost === 'number' ? parsed.totalCost : undefined,
              levels: parsed.levels
                .map((raw, idx): MaisonLevel | null => {
                  if (!raw || typeof raw !== 'object') return null;
                  const r = raw as Partial<MaisonLevel>;
                  const id = typeof r.id === 'number' ? r.id : idx + 1;
                  const rawHeightFt = typeof r.heightFt === 'number' ? r.heightFt : MAISON_LIMITS.DEFAULT_HEIGHT_FT;
                  const rawHeightIn = typeof r.heightIn === 'number' ? r.heightIn : MAISON_LIMITS.DEFAULT_HEIGHT_IN;
                  return {
                    id,
                    name: typeof r.name === 'string' && r.name.length > 0
                      ? r.name.slice(0, MAISON_LIMITS.MAX_NAME_LENGTH)
                      : defaultLevelName(id),
                    heightFt: clamp(rawHeightFt, MAISON_LIMITS.MIN_HEIGHT_FT, MAISON_LIMITS.MAX_HEIGHT_FT),
                    heightIn: clamp(rawHeightIn, 0, 11.99),
                    order: typeof r.order === 'number' ? r.order : idx,
                    plancher: r.plancher,
                    murs: Array.isArray(r.murs) ? r.murs : [],
                    toiture: r.toiture,
                    revetement: r.revetement,
                    floorPlan: r.floorPlan,
                  };
                })
                .filter((l): l is MaisonLevel => l !== null)
                .slice(0, MAISON_LIMITS.MAX_LEVELS),
            };
            if (sanitized.levels.length === 0) {
              sanitized.levels = [defaultLevel(1, 'Niveau 1', 0)];
            }
            set((s) => ({
              currentProject: sanitized,
              currentLevelId: sanitized.levels[0]?.id ?? 1,
              savedProjects: upsertSavedProject(s.savedProjects, sanitized),
            }));
            return true;
          } catch {
            return false;
          }
        },

        resetProject: () => {
          set({ currentProject: null, currentLevelId: 1 });
        },

        // ----- Actions Niveaux -----
        setCurrentLevel: (levelId) => {
          const { currentProject } = get();
          if (!currentProject) {
            set({ currentLevelId: levelId });
            return;
          }
          const exists = currentProject.levels.some((l) => l.id === levelId);
          if (!exists) return;
          set({ currentLevelId: levelId });
        },

        addLevel: (name, heightFt) => {
          let { currentProject } = get();
          if (!currentProject) {
            // Pas de projet : on en cree un proprement (avec autosave + savedProjects)
            get().createProject('Nouveau projet maison');
            currentProject = get().currentProject;
            if (!currentProject) return -1;
            return currentProject.levels[0]?.id ?? 1;
          }
          if (currentProject.levels.length >= MAISON_LIMITS.MAX_LEVELS) {
            return -1;
          }
          const newId = nextLevelId(currentProject.levels);
          const baseName = sanitizeLevelName(name ?? '', defaultLevelName(newId));
          const ft = typeof heightFt === 'number'
            ? clamp(heightFt, MAISON_LIMITS.MIN_HEIGHT_FT, MAISON_LIMITS.MAX_HEIGHT_FT)
            : MAISON_LIMITS.DEFAULT_HEIGHT_FT;
          const newLevel: MaisonLevel = {
            ...defaultLevel(newId, baseName, currentProject.levels.length),
            heightFt: ft,
            heightIn: 0,
          };
          mutateProject((p) => ({
            ...p,
            levels: [...p.levels, newLevel],
          }));
          return newId;
        },

        removeLevel: (levelId) => {
          const { currentProject, currentLevelId } = get();
          if (!currentProject) return;
          if (currentProject.levels.length <= MAISON_LIMITS.MIN_LEVELS) {
            return;
          }
          const remaining = currentProject.levels.filter((l) => l.id !== levelId);
          if (remaining.length === currentProject.levels.length) return;
          // Reordonner les positions (order)
          const reindexed = remaining
            .sort((a, b) => a.order - b.order)
            .map((l, idx) => ({ ...l, order: idx }));
          mutateProject((p) => ({ ...p, levels: reindexed }));
          if (currentLevelId === levelId) {
            const fallback = reindexed[0]?.id ?? 1;
            set({ currentLevelId: fallback });
          }
        },

        renameLevel: (levelId, newName) => {
          const trimmed = (newName ?? '').trim();
          if (trimmed.length < MAISON_LIMITS.MIN_NAME_LENGTH) return;
          updateLevel(levelId, {
            name: trimmed.slice(0, MAISON_LIMITS.MAX_NAME_LENGTH),
          });
        },

        reorderLevels: (newOrder) => {
          mutateProject((p) => {
            const map = new Map(p.levels.map((l) => [l.id, l]));
            const reordered: MaisonLevel[] = [];
            newOrder.forEach((id, idx) => {
              const lvl = map.get(id);
              if (lvl) {
                reordered.push({ ...lvl, order: idx });
                map.delete(id);
              }
            });
            // Ajout des niveaux non listes a la fin (defensif)
            let extraOrder = reordered.length;
            map.forEach((lvl) => {
              reordered.push({ ...lvl, order: extraOrder });
              extraOrder += 1;
            });
            return { ...p, levels: reordered };
          });
        },

        duplicateLevel: (levelId, newName) => {
          const { currentProject } = get();
          if (!currentProject) return -1;
          if (currentProject.levels.length >= MAISON_LIMITS.MAX_LEVELS) {
            return -1;
          }
          const src = currentProject.levels.find((l) => l.id === levelId);
          if (!src) return -1;
          const newId = nextLevelId(currentProject.levels);
          const duped: MaisonLevel = {
            ...src,
            id: newId,
            name: sanitizeLevelName(newName, `${src.name} (copie)`),
            order: currentProject.levels.length,
            // Deep-clone defensif des donnees imbriquees
            murs: Array.isArray(src.murs)
              ? (JSON.parse(JSON.stringify(src.murs)) as unknown[])
              : [],
            plancher: src.plancher
              ? (JSON.parse(JSON.stringify(src.plancher)) as unknown)
              : undefined,
            toiture: src.toiture
              ? (JSON.parse(JSON.stringify(src.toiture)) as unknown)
              : undefined,
            revetement: src.revetement
              ? (JSON.parse(JSON.stringify(src.revetement)) as unknown)
              : undefined,
            floorPlan: src.floorPlan
              ? (JSON.parse(JSON.stringify(src.floorPlan)) as unknown)
              : undefined,
          };
          mutateProject((p) => ({ ...p, levels: [...p.levels, duped] }));
          return newId;
        },

        // ----- Actions Categories -----
        updatePlancher: (levelId, data) => {
          updateLevel(levelId, { plancher: data });
        },
        updateMurs: (levelId, walls) => {
          updateLevel(levelId, { murs: Array.isArray(walls) ? walls : [] });
        },
        updateToiture: (levelId, data) => {
          updateLevel(levelId, { toiture: data });
        },
        updateRevetement: (levelId, data) => {
          updateLevel(levelId, { revetement: data });
        },
        updateFloorPlan: (levelId, plan) => {
          updateLevel(levelId, { floorPlan: plan });
        },

        // ----- Selecteurs -----
        getCurrentLevel: () => {
          const { currentProject, currentLevelId } = get();
          if (!currentProject) return null;
          return currentProject.levels.find((l) => l.id === currentLevelId) ?? null;
        },

        getLevelById: (levelId) => {
          const { currentProject } = get();
          if (!currentProject) return null;
          return currentProject.levels.find((l) => l.id === levelId) ?? null;
        },

        computeTotalSurface: () => {
          // Heuristique: si chaque niveau expose plancher.surfaceFt2, on additionne.
          // Sinon retourne totalSurfaceFt2 stocke ou 0.
          const { currentProject } = get();
          if (!currentProject) return 0;
          let sum = 0;
          for (const lvl of currentProject.levels) {
            const p = lvl.plancher as { surfaceFt2?: number } | undefined;
            if (p && typeof p.surfaceFt2 === 'number' && Number.isFinite(p.surfaceFt2)) {
              sum += p.surfaceFt2;
            }
          }
          if (sum > 0) return sum;
          return typeof currentProject.totalSurfaceFt2 === 'number'
            ? currentProject.totalSurfaceFt2
            : 0;
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Partialize: ne persiste que ce qui doit l'etre (evite de stocker les fns)
      partialize: (state) => ({
        currentProject: state.currentProject,
        currentLevelId: state.currentLevelId,
        savedProjects: state.savedProjects,
      }),
      // Migration future-proof
      migrate: (persistedState, version) => {
        if (version === STORAGE_VERSION) {
          return persistedState as Partial<MaisonProjectStore>;
        }
        // Pour une future v2, on ferait la migration ici.
        // eslint-disable-next-line no-console
        console.warn(`[useMaisonProjectStore] Unknown version ${version}, attempting compat read`);
        return persistedState as Partial<MaisonProjectStore>;
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.warn('[useMaisonProjectStore] hydration error', error);
        } else if (state && state.currentProject && !state.currentLevelId) {
          // Garantit une cle de niveau coherente apres rehydration
          state.currentLevelId = state.currentProject.levels[0]?.id ?? 1;
        }
      },
    },
  ),
);

// ============================================
// HELPERS EXPORTES POUR LES COMPOSANTS
// ============================================

/**
 * Indique si un niveau possede des donnees dans au moins une categorie.
 * Utilise pour l'affichage du point de completude dans MaisonLevelSelector.
 */
export function levelHasData(level: MaisonLevel | null | undefined): boolean {
  if (!level) return false;
  if (level.plancher) return true;
  if (Array.isArray(level.murs) && level.murs.length > 0) return true;
  if (level.toiture) return true;
  if (level.revetement) return true;
  if (level.floorPlan) return true;
  return false;
}

/**
 * Indique si un niveau a les 3 categories structurelles principales remplies
 * (plancher + murs + toiture). Utilise pour le point vert de completude.
 */
export function levelIsComplete(level: MaisonLevel | null | undefined): boolean {
  if (!level) return false;
  const hasPlancher = !!level.plancher;
  const hasMurs = Array.isArray(level.murs) && level.murs.length > 0;
  const hasToiture = !!level.toiture;
  return hasPlancher && hasMurs && hasToiture;
}

/**
 * Hauteur formatee d'un niveau, ex: "8' 0\"".
 */
export function formatLevelHeight(level: MaisonLevel): string {
  const ft = Math.max(0, Math.floor(level.heightFt));
  const inch = Math.max(0, Math.round(level.heightIn));
  return `${ft}' ${inch}"`;
}

/**
 * Hauteur totale d'un niveau en pouces, clampee aux limites.
 */
export function levelHeightInches(level: MaisonLevel): number {
  return totalHeightInches(level);
}
