/**
 * RapportsModal.tsx
 * Phase 18 - Modal Rapports unifie multi-onglets pour Constructo AI.
 *
 * Agregation centrale des 4 calculateurs (Plancher, Murs, Toiture, Revetement)
 * en un seul modal de visualisation et export. Inspire de l'experience Wall
 * Builder Pro avec 2 niveaux d'onglets (categorie + sous-vue) et un footer
 * d'actions standardisees.
 *
 * Composant autonome : importe les types des 4 calculateurs existants mais ne
 * modifie aucun de leurs fichiers source. Aucune dependance externe nouvelle.
 *
 * Auteur : Agent Phase 18
 * Cible : React 18.3.1 + TypeScript strict + Tailwind 3
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Hammer,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  Maximize2,
  Printer,
  Search,
  Share2,
  TriangleAlert,
  X,
} from 'lucide-react';

// === Imports types Plancher ===
import {
  formatFraction as formatFractionPlancher,
  type PlancherMaterialRow,
  type PlancherMaterials,
  type PlancherPiece,
  type PlancherSnapshot,
} from './PlancherPanel';

// === Imports types et fonctions Murs ===
import {
  computeWall,
  formatFraction as formatFractionMur,
  generateCutList as generateCutListMur,
  tallyPieces as tallyPiecesMur,
  type MurCounts,
  type MurCutListItem,
  type MurOpening,
  type MurPiece,
  type MurWall,
} from './MursParametriquePanel';

// === Imports types Toiture ===
import {
  formatFraction as formatFractionToiture,
  type ToitureMaterials,
  type ToiturePiece,
  type ToitureSnapshot,
} from './ToiturePanel';

// === Imports types et fonctions Revetement ===
import {
  formatFraction as formatFractionRev,
  type RevetementCutListItem,
  type RevetementMaterials,
  type RevetementSnapshot,
  type RevetementType,
} from './RevetementPanel';

// ============================================
// TYPES PUBLICS
// ============================================

export type RapportTabId = 'plancher' | 'murs' | 'toiture' | 'revetement';
export type RapportSubTabId = 'materiaux' | 'cutlist' | 'plans';

export interface RapportMurEntry {
  id: number;
  name: string;
  wall: MurWall;
  openings: MurOpening[];
  pieces: MurPiece[];
  svgRef?: React.RefObject<SVGSVGElement>;
}

export interface RapportPlancherData {
  snapshot: PlancherSnapshot;
  svgRef?: React.RefObject<SVGSVGElement>;
}

export interface RapportToitureData {
  snapshot: ToitureSnapshot;
  svgRef?: React.RefObject<SVGSVGElement>;
}

export interface RapportRevetementData {
  snapshot: RevetementSnapshot;
  svgRef?: React.RefObject<SVGSVGElement>;
}

export interface RapportsModalProps {
  // Donnees par categorie (toutes optionnelles)
  plancher?: RapportPlancherData;
  murs?: RapportMurEntry[];
  toiture?: RapportToitureData;
  revetement?: RapportRevetementData;

  // Metadonnees projet
  projectName?: string;
  clientName?: string;
  projectAddress?: string;

  // Etat
  isOpen: boolean;
  onClose: () => void;
  initialTab?: RapportTabId;
  initialSubTab?: RapportSubTabId;

  // Callbacks
  onPrintPdf?: (tabId: RapportTabId) => void | Promise<void>;
  onSaveImage?: (tabId: RapportTabId) => void | Promise<void>;
  onSharePdf?: (tabId: RapportTabId) => void | Promise<void>;
}

// ============================================
// HELPERS LOCAUX (formatage uniforme)
// ============================================

const REVETEMENT_LABELS: Record<RevetementType, string> = {
  'planche-1x4': 'Planche 1x4',
  'planche-1x6': 'Planche 1x6',
  'vinyle-4': 'Vinyle 4 po',
  'vinyle-5': 'Vinyle 5 po',
  hardie: 'Fibrociment Hardie',
  brique: 'Brique modulaire',
  pierre: 'Pierre naturelle',
};

// Conversion pouces decimaux vers libelle ft+po simple (ne casse pas si <12)
function inchesToFtInLabel(decimalIn: number, formatFrac: (n: number) => string): string {
  if (decimalIn == null || isNaN(decimalIn) || decimalIn <= 0) return "0'";
  const totalIn = Math.round(decimalIn * 16) / 16;
  const ft = Math.floor(totalIn / 12);
  const inc = totalIn - ft * 12;
  if (inc === 0) return `${ft}'`;
  return `${ft}' ${formatFrac(inc)}`;
}

// Formate un nombre avec 2 decimales et separateur d'espace pour milliers
function formatNumber(n: number, decimals = 1): string {
  if (n == null || isNaN(n)) return '0';
  return n.toLocaleString('fr-CA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCurrency(n: number): string {
  if (n == null || isNaN(n)) return '0,00 $';
  return `${n.toLocaleString('fr-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} $ CAD`;
}

// Echappe les caracteres HTML pour interpolation sure dans document.write
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c] ?? c);
}

// Convertit un SVG dans une RefObject en data URL PNG via canvas
async function svgRefToPngDataUrl(
  svgRef: React.RefObject<SVGSVGElement> | undefined,
  scale = 2,
): Promise<string | null> {
  if (!svgRef || !svgRef.current) return null;
  try {
    const svgEl = svgRef.current;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    // Permet d'eviter un canvas "tainted" si le SVG reference des images externes
    img.crossOrigin = 'anonymous';
    return await new Promise<string | null>((resolve) => {
      img.onload = () => {
        const rect = svgEl.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * scale));
        const h = Math.max(1, Math.round(rect.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try {
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  } catch (err) {
    return null;
  }
}

// ============================================
// CONSTANTS UI
// ============================================

const TAB_ICONS: Record<RapportTabId, typeof Home> = {
  plancher: LayoutGrid,
  murs: Hammer,
  toiture: Home,
  revetement: Layers,
};

const TAB_LABELS: Record<RapportTabId, string> = {
  plancher: 'Plancher',
  murs: 'Murs',
  toiture: 'Toiture',
  revetement: 'Revetement',
};

const SUBTAB_LABELS: Record<RapportSubTabId, string> = {
  materiaux: 'Materiaux',
  cutlist: 'Liste de coupe',
  plans: 'Plans',
};

const ALL_TABS: RapportTabId[] = ['plancher', 'murs', 'toiture', 'revetement'];
const ALL_SUBTABS: RapportSubTabId[] = ['materiaux', 'cutlist', 'plans'];

// ============================================
// COMPOSANT PRINCIPAL
// ============================================

export default function RapportsModal(props: RapportsModalProps): JSX.Element | null {
  const {
    plancher,
    murs,
    toiture,
    revetement,
    projectName,
    clientName,
    projectAddress,
    isOpen,
    onClose,
    initialTab,
    initialSubTab,
    onPrintPdf,
    onSaveImage,
    onSharePdf,
  } = props;

  // === Disponibilite par tab (au moins 1 donnee) ===
  const availability: Record<RapportTabId, boolean> = useMemo(
    () => ({
      plancher: !!plancher && (plancher.snapshot?.pieces?.length ?? 0) > 0,
      murs: !!murs && murs.length > 0,
      toiture: !!toiture && (toiture.snapshot?.pieces?.length ?? 0) > 0,
      revetement: !!revetement && (revetement.snapshot?.elevations?.length ?? 0) > 0,
    }),
    [plancher, murs, toiture, revetement],
  );

  // Premier tab disponible (fallback)
  const firstAvailableTab: RapportTabId = useMemo(() => {
    for (const t of ALL_TABS) {
      if (availability[t]) return t;
    }
    return 'plancher';
  }, [availability]);

  const [activeTab, setActiveTab] = useState<RapportTabId>(initialTab ?? firstAvailableTab);
  const [activeSubTab, setActiveSubTab] = useState<RapportSubTabId>(initialSubTab ?? 'materiaux');
  const [search, setSearch] = useState('');
  const [expandAll, setExpandAll] = useState(true);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [zoomLabel, setZoomLabel] = useState<string>('');

  // Callback stable pour eviter de casser memoization React.memo des Content components
  const handleZoom = useCallback((url: string, label: string) => {
    setZoomImage(url);
    setZoomLabel(label);
  }, []);

  const modalRef = useRef<HTMLDivElement>(null);

  // === Lock scroll arriere-plan a l'ouverture (effet isole, deps stables) ===
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // === Reset etats a l'ouverture (tab initial / sous-tab initial) ===
  useEffect(() => {
    if (!isOpen) return;
    // Ajuster le tab initial si celui passe n'est pas dispo
    if (initialTab && availability[initialTab]) {
      setActiveTab(initialTab);
    } else if (!availability[activeTab]) {
      setActiveTab(firstAvailableTab);
    }
    if (initialSubTab) setActiveSubTab(initialSubTab);
  }, [isOpen, initialTab, initialSubTab, availability, activeTab, firstAvailableTab]);

  // === Echap ferme modal ===
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomImage) {
          setZoomImage(null);
          setZoomLabel('');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, zoomImage]);

  // === Handlers actions footer ===
  const handlePrint = useCallback(() => {
    if (onPrintPdf) {
      void onPrintPdf(activeTab);
    } else {
      window.print();
    }
  }, [activeTab, onPrintPdf]);

  const handleSaveImage = useCallback(async () => {
    if (onSaveImage) {
      await onSaveImage(activeTab);
      return;
    }
    // Fallback : convertir le SVG du tab actif en PNG et le telecharger
    let ref: React.RefObject<SVGSVGElement> | undefined;
    if (activeTab === 'plancher') ref = plancher?.svgRef;
    else if (activeTab === 'toiture') ref = toiture?.svgRef;
    else if (activeTab === 'revetement') ref = revetement?.svgRef;
    else if (activeTab === 'murs' && murs && murs.length > 0) ref = murs[0]?.svgRef;

    const dataUrl = await svgRefToPngDataUrl(ref, 2);
    if (dataUrl) {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `rapport-${activeTab}-${Date.now()}.png`;
      link.click();
    }
  }, [activeTab, murs, onSaveImage, plancher, revetement, toiture]);

  const handleShare = useCallback(async () => {
    if (onSharePdf) {
      await onSharePdf(activeTab);
      return;
    }
    // Fallback : tente Web Share API
    const hasShareApi = typeof navigator !== 'undefined' && 'share' in navigator;
    if (!hasShareApi) {
      // Aucun callback fourni et aucun support Web Share : prevenir l'utilisateur
      // au lieu d'echouer silencieusement.
      window.alert(
        'Partage non disponible sur ce navigateur. Utilisez Imprimer PDF pour sauvegarder le rapport.',
      );
      return;
    }
    try {
      await (navigator as Navigator & { share: (data: { title: string; text: string }) => Promise<void> }).share({
        title: `Rapport ${TAB_LABELS[activeTab]} - ${projectName ?? 'Projet Constructo AI'}`,
        text: `Rapport de calcul ${TAB_LABELS[activeTab]} genere via Constructo AI.`,
      });
    } catch {
      /* annule par utilisateur */
    }
  }, [activeTab, onSharePdf, projectName]);

  const handleBackdropClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  // Empeche la propagation des clics dans le contenu vers le backdrop
  const stopPropagation = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  // === Navigation clavier sur les tabs niveau 1 ===
  const handleTabKey = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>, idx: number) => {
      const enabledTabs = ALL_TABS.filter((t) => availability[t]);
      const currentEnabledIdx = enabledTabs.indexOf(activeTab);
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = (currentEnabledIdx + 1) % Math.max(1, enabledTabs.length);
        if (enabledTabs[nextIdx]) setActiveTab(enabledTabs[nextIdx]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIdx = (currentEnabledIdx - 1 + enabledTabs.length) % Math.max(1, enabledTabs.length);
        if (enabledTabs[prevIdx]) setActiveTab(enabledTabs[prevIdx]);
      }
      void idx;
    },
    [activeTab, availability],
  );

  // === Compteurs pour badges ===
  const counts: Record<RapportTabId, number> = useMemo(
    () => ({
      plancher: plancher?.snapshot?.pieces?.filter((p: PlancherPiece) => p.type === 'solive' || p.type === 'solive-bordure').length ?? 0,
      murs: murs?.length ?? 0,
      toiture: toiture?.snapshot?.pieces?.length ?? 0,
      revetement: revetement?.snapshot?.elevations?.length ?? 0,
    }),
    [plancher, murs, toiture, revetement],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rapports-modal-title"
    >
      <div
        ref={modalRef}
        className="relative bg-white shadow-2xl w-full h-full md:w-[92%] md:h-[92vh] md:max-w-7xl md:rounded-2xl flex flex-col overflow-hidden"
        onClick={stopPropagation}
      >
        {/* === HEADER === */}
        <header className="sticky top-0 z-10 bg-gradient-to-r from-blue-700 to-indigo-700 text-white px-4 md:px-6 py-3 md:py-4 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-6 h-6 md:w-7 md:h-7 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="rapports-modal-title" className="text-lg md:text-xl font-bold truncate">
                Rapports
              </h2>
              {(projectName || clientName || projectAddress) && (
                <p className="text-xs md:text-sm text-blue-100 truncate">
                  {[projectName, clientName, projectAddress].filter(Boolean).join(' - ')}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le modal rapports"
            className="text-white hover:bg-white/20 rounded-full p-2 transition-colors"
          >
            <X className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </header>

        {/* === TABS NIVEAU 1 === */}
        <nav
          className="sticky top-0 z-[5] bg-white border-b border-gray-200 px-2 md:px-4 py-2 overflow-x-auto"
          role="tablist"
          aria-label="Categories de rapport"
        >
          <div className="flex gap-2 min-w-max">
            {ALL_TABS.map((tab, idx) => {
              const Icon = TAB_ICONS[tab];
              const isActive = activeTab === tab;
              const isAvailable = availability[tab];
              const baseClasses =
                'flex items-center gap-2 px-3 md:px-4 py-2 rounded-full font-medium text-sm md:text-base transition-all select-none whitespace-nowrap';
              const stateClasses = !isAvailable
                ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                : isActive
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200';
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`rapports-panel-${tab}`}
                  id={`rapports-tab-${tab}`}
                  tabIndex={isActive ? 0 : -1}
                  disabled={!isAvailable}
                  onClick={() => isAvailable && setActiveTab(tab)}
                  onKeyDown={(e) => handleTabKey(e, idx)}
                  className={`${baseClasses} ${stateClasses}`}
                >
                  <Icon className="w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
                  <span>{TAB_LABELS[tab]}</span>
                  {isAvailable && counts[tab] > 0 && (
                    <span
                      className={`ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[10px] md:text-xs font-bold rounded-full ${
                        isActive ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {counts[tab]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* === TABS NIVEAU 2 (sous-tabs) === */}
        <div className="bg-white border-b border-gray-200 px-2 md:px-6">
          <div className="flex gap-4 md:gap-8 overflow-x-auto" role="tablist" aria-label="Sous-vues">
            {ALL_SUBTABS.map((sub) => {
              const isActive = activeSubTab === sub;
              return (
                <button
                  key={sub}
                  type="button"
                  role="tab"
                  id={`rapports-subtab-${sub}`}
                  aria-selected={isActive}
                  aria-controls={`rapports-subpanel-${sub}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveSubTab(sub)}
                  className={`relative py-3 text-sm md:text-base font-medium transition-colors whitespace-nowrap ${
                    isActive ? 'text-gray-900 font-bold' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {SUBTAB_LABELS[sub]}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 right-0 bottom-0 h-0.5 bg-amber-500 rounded-t"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* === BARRE OUTILS (recherche + expand/reduce sur cutlist) === */}
        {activeSubTab === 'cutlist' && (
          <div className="bg-gray-50 border-b border-gray-200 px-4 md:px-6 py-2 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-md">
              <Search
                className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer par utilisation..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
              />
            </div>
            <button
              type="button"
              onClick={() => setExpandAll((v) => !v)}
              className="text-xs md:text-sm font-medium text-amber-700 hover:text-amber-900 flex items-center gap-1"
            >
              {expandAll ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {expandAll ? 'Tout reduire' : 'Tout developper'}
            </button>
          </div>
        )}

        {/* === BODY (contenu scrollable) === */}
        <main
          className="flex-1 overflow-y-auto bg-gray-50 px-3 md:px-6 py-4"
          role="tabpanel"
          id={`rapports-subpanel-${activeSubTab}`}
          aria-labelledby={`rapports-subtab-${activeSubTab}`}
          data-rapports-panel={`rapports-panel-${activeTab}`}
        >
          {!availability[activeTab] && (
            <EmptyState
              tabId={activeTab}
              message="Aucune donnee disponible pour cette categorie."
            />
          )}

          {availability[activeTab] && activeTab === 'plancher' && plancher && (
            <PlancherContent
              data={plancher}
              subTab={activeSubTab}
              search={search}
              expandAll={expandAll}
              onZoom={handleZoom}
            />
          )}

          {availability[activeTab] && activeTab === 'murs' && murs && (
            <MursContent
              entries={murs}
              subTab={activeSubTab}
              search={search}
              expandAll={expandAll}
              onZoom={handleZoom}
            />
          )}

          {availability[activeTab] && activeTab === 'toiture' && toiture && (
            <ToitureContent
              data={toiture}
              subTab={activeSubTab}
              search={search}
              expandAll={expandAll}
              onZoom={handleZoom}
            />
          )}

          {availability[activeTab] && activeTab === 'revetement' && revetement && (
            <RevetementContent
              data={revetement}
              subTab={activeSubTab}
              search={search}
              expandAll={expandAll}
              onZoom={handleZoom}
            />
          )}
        </main>

        {/* === FOOTER ACTIONS === */}
        <footer className="bg-white border-t border-gray-200 px-3 md:px-6 py-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-3 md:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md shadow-sm transition-colors"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            Imprimer PDF
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSaveImage();
            }}
            className="inline-flex items-center gap-2 px-3 md:px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-md shadow-sm transition-colors"
          >
            <ImageIcon className="w-4 h-4" aria-hidden="true" />
            Enregistrer Image
          </button>
          <button
            type="button"
            onClick={() => {
              void handleShare();
            }}
            className="inline-flex items-center gap-2 px-3 md:px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-md shadow-sm transition-colors"
          >
            <Share2 className="w-4 h-4" aria-hidden="true" />
            Partager PDF
          </button>
        </footer>

        {/* === ZOOM MODAL INTERNE (vue agrandie d'un plan) === */}
        {zoomImage && (
          <div
            className="absolute inset-0 z-30 bg-black/85 flex items-center justify-center p-4"
            onClick={() => {
              setZoomImage(null);
              setZoomLabel('');
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Vue agrandie"
          >
            <div className="relative max-w-full max-h-full" onClick={stopPropagation}>
              <button
                type="button"
                onClick={() => {
                  setZoomImage(null);
                  setZoomLabel('');
                }}
                aria-label="Fermer le zoom"
                className="absolute -top-12 right-0 text-white hover:bg-white/20 rounded-full p-2"
              >
                <X className="w-6 h-6" />
              </button>
              {zoomLabel && (
                <p className="absolute -top-10 left-0 text-white text-sm font-medium truncate max-w-xs md:max-w-md">
                  {zoomLabel}
                </p>
              )}
              <img
                src={zoomImage}
                alt={zoomLabel || 'Plan agrandi'}
                className="max-w-[90vw] max-h-[80vh] object-contain bg-white rounded-lg shadow-2xl"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// COMPOSANTS INTERNES - SECTIONS GENERIQUES
// ============================================

function EmptyState(props: { tabId: RapportTabId; message: string }): JSX.Element {
  const { tabId, message } = props;
  const Icon = TAB_ICONS[tabId];
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 text-gray-400">
      <Icon className="w-12 h-12 mb-3" aria-hidden="true" />
      <p className="text-sm md:text-base">{message}</p>
      <p className="text-xs mt-2 text-gray-300">
        Utilisez le calculateur {TAB_LABELS[tabId]} pour generer un rapport.
      </p>
    </div>
  );
}

interface SectionCardProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

function SectionCard(props: SectionCardProps): JSX.Element {
  const { title, subtitle, icon, children, footer } = props;
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm mb-3 overflow-hidden">
      <header className="px-3 md:px-4 py-2 md:py-3 bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 flex items-center gap-2">
        {icon}
        <div>
          <h3 className="text-sm md:text-base font-bold text-gray-900">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      </header>
      <div className="p-3 md:p-4">{children}</div>
      {footer && <footer className="px-3 md:px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs md:text-sm text-gray-600">{footer}</footer>}
    </section>
  );
}

// === Tableau materiaux generique ===
interface MaterialRowDisplay {
  qty: number | string;
  size: string;
  length: string;
  use: string;
}

interface MaterialTableProps {
  rows: MaterialRowDisplay[];
  emptyText?: string;
}

function MaterialTable(props: MaterialTableProps): JSX.Element {
  const { rows, emptyText = 'Aucun materiau pour cette categorie.' } = props;
  if (rows.length === 0) {
    return <p className="text-xs text-gray-400 italic py-2">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs md:text-sm table-auto border-collapse">
        <thead>
          <tr className="bg-amber-50 text-amber-900 uppercase text-[10px] md:text-xs">
            <th className="px-2 py-1.5 text-left border border-amber-100 font-bold">Qte</th>
            <th className="px-2 py-1.5 text-left border border-amber-100 font-bold">Taille</th>
            <th className="px-2 py-1.5 text-left border border-amber-100 font-bold">Longueur</th>
            <th className="px-2 py-1.5 text-left border border-amber-100 font-bold">Utiliser</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-2 py-1.5 border border-gray-100 font-mono font-bold text-gray-900">{r.qty}</td>
              <td className="px-2 py-1.5 border border-gray-100 text-gray-700">{r.size}</td>
              <td className="px-2 py-1.5 border border-gray-100 text-gray-700 font-mono">{r.length}</td>
              <td className="px-2 py-1.5 border border-gray-100 text-gray-600">{r.use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// === Thumbnail SVG + actions ===
interface PlanThumbProps {
  label: string;
  svgRef?: React.RefObject<SVGSVGElement>;
  onZoom?: (url: string, label: string) => void;
}

const PlanThumb = memo(function PlanThumb(props: PlanThumbProps): JSX.Element {
  const { label, svgRef, onZoom } = props;
  const [preview, setPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Genere le preview avec retry exponentiel pour absorber le timing de montage du SVG parent
  // (svgRef.current peut etre encore null au premier render).
  // Delais : 200/400/800/1600/3200ms cumules ~6.2s avant abandon.
  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const delayMs = (retry: number) => 200 * Math.pow(2, retry);
    const tryGenerate = async (retry = 0): Promise<void> => {
      if (cancelled) return;
      if (!svgRef?.current) {
        if (retry < 5) {
          timerId = setTimeout(() => {
            void tryGenerate(retry + 1);
          }, delayMs(retry));
        }
        return;
      }
      setIsLoading(true);
      const url = await svgRefToPngDataUrl(svgRef, 1.5);
      if (cancelled) return;
      if (url) {
        setPreview(url);
        setIsLoading(false);
      } else if (retry < 5) {
        setIsLoading(false);
        timerId = setTimeout(() => {
          void tryGenerate(retry + 1);
        }, delayMs(retry));
      } else {
        setIsLoading(false);
      }
    };
    void tryGenerate();
    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [svgRef]);

  const handleDownload = useCallback(async () => {
    let url = preview;
    if (!url) {
      url = await svgRefToPngDataUrl(svgRef, 2);
    }
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${label.replace(/[^a-z0-9-_]/gi, '_')}.png`;
      link.click();
    }
  }, [label, preview, svgRef]);

  const handlePrintOne = useCallback(() => {
    if (!preview) return;
    const w = window.open('', '_blank');
    if (!w) return;
    // Echappe label ET preview (data URL controlee mais on garde la discipline)
    // afin d'eviter toute injection HTML par le titre.
    const safeLabel = escapeHtml(label);
    const safeSrc = escapeHtml(preview);
    w.document.write(
      `<html><head><title>${safeLabel}</title></head><body style="margin:0;padding:20px;text-align:center;"><img src="${safeSrc}" alt="${safeLabel}" style="max-width:100%;"/></body></html>`,
    );
    w.document.close();
    setTimeout(() => w.print(), 400);
  }, [label, preview]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <div className="bg-gray-100 aspect-[4/3] flex items-center justify-center relative">
        {preview ? (
          <button
            type="button"
            onClick={() => onZoom?.(preview, label)}
            aria-label={`Agrandir ${label}`}
            className="w-full h-full bg-white relative group"
          >
            <img src={preview} alt={label} className="w-full h-full object-contain" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
              <Maximize2 className="w-7 h-7 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </span>
          </button>
        ) : isLoading ? (
          <span className="text-xs text-gray-400 animate-pulse">Generation...</span>
        ) : (
          <span className="text-xs text-gray-400">Plan non disponible</span>
        )}
      </div>
      <div className="px-3 py-2 border-t border-gray-100">
        <p className="text-xs md:text-sm font-medium text-gray-800 truncate" title={label}>
          {label}
        </p>
        <div className="flex gap-2 mt-1.5">
          <button
            type="button"
            onClick={handlePrintOne}
            disabled={!preview}
            className="flex-1 text-[10px] md:text-xs px-2 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed text-blue-700 rounded inline-flex items-center justify-center gap-1"
          >
            <Printer className="w-3 h-3" aria-hidden="true" />
            Imprimer
          </button>
          <button
            type="button"
            onClick={() => {
              void handleDownload();
            }}
            disabled={!svgRef?.current}
            className="flex-1 text-[10px] md:text-xs px-2 py-1 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-700 rounded inline-flex items-center justify-center gap-1"
          >
            <Download className="w-3 h-3" aria-hidden="true" />
            Sauver
          </button>
        </div>
      </div>
    </div>
  );
});

// ============================================
// CONTENU SPECIFIQUE - PLANCHER
// ============================================

interface PlancherContentProps {
  data: RapportPlancherData;
  subTab: RapportSubTabId;
  search: string;
  expandAll: boolean;
  onZoom: (url: string, label: string) => void;
}

const PlancherContent = memo(function PlancherContent(props: PlancherContentProps): JSX.Element {
  const { data, subTab, search, expandAll, onZoom } = props;
  const { snapshot, svgRef } = data;
  const { dims, config, pieces, materials } = snapshot;

  // Surface du plancher en pieds carres
  const surfaceFt2 = useMemo(() => {
    const Lin = dims.lengthFt * 12 + dims.lengthIn;
    const Win = dims.widthFt * 12 + dims.widthIn;
    return (Lin * Win) / 144;
  }, [dims]);

  // Total solives + bordures
  const totalJoists = useMemo(
    () => pieces.filter((p) => p.type === 'solive' || p.type === 'solive-bordure').length,
    [pieces],
  );

  // Materiaux concatenes en lignes generiques
  const materialRows = useMemo<MaterialRowDisplay[]>(() => {
    const all: PlancherMaterialRow[] = [
      ...materials.joists,
      ...materials.blocking,
      ...materials.subfloorPanels,
      ...materials.hangers,
    ];
    return all.map((r) => ({
      qty: r.qty,
      size: r.size,
      length: r.length,
      use: r.use,
    }));
  }, [materials]);

  if (subTab === 'materiaux') {
    return (
      <>
        <SectionCard
          title="Materiaux - Plancher"
          subtitle={`Type solives: ${config.joistType} | Espacement: ${config.spacing} po`}
          icon={<LayoutGrid className="w-5 h-5 text-amber-600" />}
          footer={`Total: ${totalJoists} solives, ${formatNumber(surfaceFt2)} ft2 de plancher`}
        >
          <MaterialTable rows={materialRows} />
        </SectionCard>
      </>
    );
  }

  if (subTab === 'cutlist') {
    // Groupage par utilisation
    const filtered = pieces.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.label.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q) ||
        config.joistType.toLowerCase().includes(q)
      );
    });

    const grouped = new Map<string, PlancherPiece[]>();
    for (const p of filtered) {
      const key =
        p.type === 'solive-bordure'
          ? 'Solives de bordure'
          : p.type === 'solive'
            ? 'Solives intermediaires'
            : p.type === 'blocking'
              ? 'Blocage'
              : 'Panneaux sous-plancher';
      const list = grouped.get(key) ?? [];
      list.push(p);
      grouped.set(key, list);
    }

    return (
      <>
        {Array.from(grouped.entries()).map(([cat, list]) => (
          <SectionCard
            key={cat}
            title={cat}
            subtitle={`${list.length} item(s)`}
            icon={<LayoutGrid className="w-5 h-5 text-amber-600" />}
          >
            {expandAll && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs md:text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-700 uppercase text-[10px]">
                      <th className="px-2 py-1.5 text-left border border-gray-200">Etiquette</th>
                      <th className="px-2 py-1.5 text-left border border-gray-200">Type</th>
                      <th className="px-2 py-1.5 text-left border border-gray-200">Longueur</th>
                      <th className="px-2 py-1.5 text-right border border-gray-200">Qte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p, i) => (
                      <tr key={p.id ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-2 py-1 border border-gray-100 font-bold text-amber-700">{p.label}</td>
                        <td className="px-2 py-1 border border-gray-100">{p.type}</td>
                        <td className="px-2 py-1 border border-gray-100 font-mono">
                          {inchesToFtInLabel(p.lengthIn, formatFractionPlancher)}
                        </td>
                        <td className="px-2 py-1 border border-gray-100 text-right font-mono">{p.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        ))}
        {grouped.size === 0 && <p className="text-sm text-gray-400 italic">Aucune piece ne correspond.</p>}
      </>
    );
  }

  // PLANS
  return (
    <>
      <SectionCard
        title="Plans - Plancher"
        subtitle="Vue de dessus du plancher avec disposition des solives"
        icon={<LayoutGrid className="w-5 h-5 text-amber-600" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PlanThumb
            label={`Plan De Plancher (${formatNumber(surfaceFt2)} ft2)`}
            svgRef={svgRef}
            onZoom={onZoom}
          />
        </div>
      </SectionCard>
    </>
  );
});

// ============================================
// CONTENU SPECIFIQUE - MURS
// ============================================

interface MursContentProps {
  entries: RapportMurEntry[];
  subTab: RapportSubTabId;
  search: string;
  expandAll: boolean;
  onZoom: (url: string, label: string) => void;
}

const MursContent = memo(function MursContent(props: MursContentProps): JSX.Element {
  const { entries, subTab, search, expandAll, onZoom } = props;

  // Pieces calculees a la volee si non fournies (utilise computeWall)
  const enrichedEntries = useMemo(() => {
    return entries.map((e) => {
      let pieces = e.pieces;
      if (!pieces || pieces.length === 0) {
        try {
          const r = computeWall(e.wall, e.openings);
          pieces = r.pieces;
        } catch {
          pieces = [];
        }
      }
      const counts = tallyPiecesMur(pieces);
      const cutList = generateCutListMur(pieces);
      return { ...e, pieces, counts, cutList };
    });
  }, [entries]);

  // Total LF + surface murs
  const totalWallLF = useMemo(
    () => enrichedEntries.reduce((sum, m) => sum + m.wall.length / 12, 0),
    [enrichedEntries],
  );
  const totalWallSurface = useMemo(
    () =>
      enrichedEntries.reduce((sum, m) => sum + (m.wall.length * (m.wall.studHeight + 3)) / 144, 0),
    [enrichedEntries],
  );

  if (subTab === 'materiaux') {
    // Agregation totale des cutlists en tableau materiaux
    const rows: MaterialRowDisplay[] = [];
    for (const entry of enrichedEntries) {
      for (const item of entry.cutList) {
        rows.push({
          qty: item.qty,
          size: item.size,
          length: inchesToFtInLabel(item.length, formatFractionMur),
          use: `${entry.name} - ${item.use}`,
        });
      }
    }

    // Totaux compteurs cumulatifs
    const totalCounts: MurCounts = enrichedEntries.reduce<MurCounts>(
      (acc, e) => ({
        studs: acc.studs + e.counts.studs,
        kings: acc.kings + e.counts.kings,
        jacks: acc.jacks + e.counts.jacks,
        cripples: acc.cripples + e.counts.cripples,
        headers: acc.headers + e.counts.headers,
        sills: acc.sills + e.counts.sills,
        plates: acc.plates + e.counts.plates,
        blockings: acc.blockings + e.counts.blockings,
      }),
      { studs: 0, kings: 0, jacks: 0, cripples: 0, headers: 0, sills: 0, plates: 0, blockings: 0 },
    );

    return (
      <>
        <SectionCard
          title={`Materiaux - Murs (${enrichedEntries.length} mur(s))`}
          subtitle={`Surface totale ${formatNumber(totalWallSurface)} ft2, ${formatNumber(totalWallLF)} pi lineaires`}
          icon={<Hammer className="w-5 h-5 text-amber-600" />}
          footer={`Total: ${enrichedEntries.length} murs inclus, ${formatNumber(totalWallLF)} LF, ${formatNumber(totalWallSurface)} ft2 - Montants:${totalCounts.studs} Linteaux:${totalCounts.headers} Allege:${totalCounts.sills} Bloc:${totalCounts.blockings}`}
        >
          <MaterialTable rows={rows} />
        </SectionCard>
      </>
    );
  }

  if (subTab === 'cutlist') {
    return (
      <>
        {enrichedEntries.map((entry) => {
          const filtered = entry.cutList.filter((it) => {
            if (!search) return true;
            const q = search.toLowerCase();
            return (
              it.label.toLowerCase().includes(q) ||
              it.size.toLowerCase().includes(q) ||
              it.use.toLowerCase().includes(q)
            );
          });
          return (
            <SectionCard
              key={entry.id}
              title={`MUR ${entry.id} - ${entry.name}`}
              subtitle={`Longueur: ${inchesToFtInLabel(entry.wall.length, formatFractionMur)} | Hauteur: ${inchesToFtInLabel(entry.wall.studHeight, formatFractionMur)} | ${entry.counts.studs} montants`}
              icon={<Hammer className="w-5 h-5 text-amber-600" />}
            >
              {expandAll && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs md:text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-700 uppercase text-[10px]">
                        <th className="px-2 py-1.5 text-left border border-gray-200">Code</th>
                        <th className="px-2 py-1.5 text-right border border-gray-200">Qte</th>
                        <th className="px-2 py-1.5 text-left border border-gray-200">Taille</th>
                        <th className="px-2 py-1.5 text-left border border-gray-200">Longueur</th>
                        <th className="px-2 py-1.5 text-left border border-gray-200">Utilisation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((it, i) => (
                        <tr key={`${it.label}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-2 py-1 border border-gray-100 font-bold text-amber-700">{it.label}</td>
                          <td className="px-2 py-1 border border-gray-100 text-right font-mono">{it.qty}</td>
                          <td className="px-2 py-1 border border-gray-100">{it.size}</td>
                          <td className="px-2 py-1 border border-gray-100 font-mono">
                            {inchesToFtInLabel(it.length, formatFractionMur)}
                          </td>
                          <td className="px-2 py-1 border border-gray-100 text-gray-600">{it.use}</td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-2 py-2 text-center text-gray-400 italic text-xs">
                            Aucun resultat pour ce filtre.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          );
        })}
      </>
    );
  }

  // PLANS - liste les murs comme thumbnails
  return (
    <>
      <SectionCard
        title={`Plans De Mur Exterieur (${enrichedEntries.length} murs)`}
        subtitle="Cliquez sur un plan pour l'agrandir"
        icon={<Hammer className="w-5 h-5 text-amber-600" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {enrichedEntries.map((entry) => (
            <PlanThumb
              key={entry.id}
              label={`Plan De Mur ${entry.id} - ${entry.name}`}
              svgRef={entry.svgRef}
              onZoom={onZoom}
            />
          ))}
        </div>
      </SectionCard>
    </>
  );
});

// ============================================
// CONTENU SPECIFIQUE - TOITURE
// ============================================

interface ToitureContentProps {
  data: RapportToitureData;
  subTab: RapportSubTabId;
  search: string;
  expandAll: boolean;
  onZoom: (url: string, label: string) => void;
}

const ToitureContent = memo(function ToitureContent(props: ToitureContentProps): JSX.Element {
  const { data, subTab, search, expandAll, onZoom } = props;
  const { snapshot, svgRef } = data;
  const { dims, config, pieces, materials, calculations } = snapshot;

  const surfaceFt2 = calculations?.surfaceFt2 ?? 0;
  const ridgeLF = calculations?.perimeterEavesLF ?? 0;
  const rakeLF = calculations?.perimeterRakeLF ?? 0;

  if (subTab === 'materiaux') {
    const mats: ToitureMaterials = materials;
    const rows: MaterialRowDisplay[] = [
      {
        qty: mats.ridge.qty,
        size: mats.ridge.type,
        length: inchesToFtInLabel(mats.ridge.lengthIn, formatFractionToiture),
        use: 'Faitage (RG)',
      },
      {
        qty: mats.rafters.qty,
        size: mats.rafters.type,
        length: inchesToFtInLabel(mats.rafters.lengthIn, formatFractionToiture),
        use: 'Chevrons communs (R2)',
      },
      {
        qty: mats.fascia.qty,
        size: mats.fascia.type,
        length: inchesToFtInLabel(mats.fascia.lengthIn, formatFractionToiture),
        use: 'Planche de rive (fascia)',
      },
      {
        qty: mats.sheathingPanels.qty,
        size: mats.sheathingPanels.type,
        length: mats.sheathingPanels.sizeIn,
        use: 'Voligeage (panneaux OSB / contreplaque)',
      },
      {
        qty: mats.shingleBundles.bundles,
        size: mats.shingleBundles.type,
        length: `${mats.shingleBundles.squares} carre(s)`,
        use: 'Bardeaux',
      },
      {
        qty: mats.underlayment.rolls,
        size: mats.underlayment.type,
        length: '~400 ft2/rouleau',
        use: 'Sous-couche',
      },
      {
        qty: mats.dripEdge.pieces,
        size: mats.dripEdge.type,
        length: '10 pi',
        use: 'Bordure d\'egout (drip edge)',
      },
    ];

    return (
      <>
        <SectionCard
          title="Materiaux - Toiture"
          subtitle={`Type: ${config.type} | Pente: ${config.pitch} | Zone: ${config.zone}`}
          icon={<Home className="w-5 h-5 text-amber-600" />}
          footer={`Total: ${formatNumber(surfaceFt2)} ft2 de toiture, ${formatNumber(ridgeLF)} LF eaves, ${formatNumber(rakeLF)} LF rake`}
        >
          <MaterialTable rows={rows} />
        </SectionCard>
      </>
    );
  }

  if (subTab === 'cutlist') {
    const filtered = pieces.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.label.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });

    const grouped = new Map<string, ToiturePiece[]>();
    const catLabel: Record<ToiturePiece['category'], string> = {
      ridge: 'Faitage',
      fascia: 'Planches de rive',
      'rafter-common': 'Chevrons communs',
      'rafter-pignon': 'Chevrons renforces / pignon',
      sheathing: 'Voligeage',
    };
    for (const p of filtered) {
      const cat = catLabel[p.category];
      const list = grouped.get(cat) ?? [];
      list.push(p);
      grouped.set(cat, list);
    }

    return (
      <>
        {Array.from(grouped.entries()).map(([cat, list]) => (
          <SectionCard
            key={cat}
            title={cat}
            subtitle={`${list.length} type(s) de piece`}
            icon={<Home className="w-5 h-5 text-amber-600" />}
          >
            {expandAll && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs md:text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-700 uppercase text-[10px]">
                      <th className="px-2 py-1.5 text-left border border-gray-200">Etiquette</th>
                      <th className="px-2 py-1.5 text-left border border-gray-200">Type</th>
                      <th className="px-2 py-1.5 text-left border border-gray-200">Longueur</th>
                      <th className="px-2 py-1.5 text-right border border-gray-200">Qte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p, i) => (
                      <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-2 py-1 border border-gray-100 font-bold text-amber-700">{p.label}</td>
                        <td className="px-2 py-1 border border-gray-100">{p.type}</td>
                        <td className="px-2 py-1 border border-gray-100 font-mono">
                          {inchesToFtInLabel(p.lengthIn, formatFractionToiture)}
                        </td>
                        <td className="px-2 py-1 border border-gray-100 text-right font-mono">{p.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        ))}
        {grouped.size === 0 && <p className="text-sm text-gray-400 italic">Aucune piece ne correspond.</p>}
      </>
    );
  }

  // PLANS
  return (
    <>
      <SectionCard
        title="Plans - Toiture"
        subtitle={`Vue en coupe et plan, ${formatNumber(surfaceFt2)} ft2 de surface couverte`}
        icon={<Home className="w-5 h-5 text-amber-600" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PlanThumb
            label={`Plan Coupe Toiture - ${config.type} pente ${config.pitch}`}
            svgRef={svgRef}
            onZoom={onZoom}
          />
        </div>
        <div className="mt-3 text-xs text-gray-500 space-y-1">
          <p>
            Ridge: {formatNumber(dims.ridgeLengthFt + dims.ridgeLengthIn / 12)} pi | Portee:{' '}
            {formatNumber(dims.spanFt + dims.spanIn / 12)} pi
          </p>
          <p>Debord: {dims.overhangIn} po | Debord pignon: {dims.overhangPignonIn} po</p>
        </div>
      </SectionCard>
    </>
  );
});

// ============================================
// CONTENU SPECIFIQUE - REVETEMENT
// ============================================

interface RevetementContentProps {
  data: RapportRevetementData;
  subTab: RapportSubTabId;
  search: string;
  expandAll: boolean;
  onZoom: (url: string, label: string) => void;
}

const RevetementContent = memo(function RevetementContent(props: RevetementContentProps): JSX.Element {
  const { data, subTab, search, expandAll, onZoom } = props;
  const { snapshot, svgRef } = data;
  const { elevations, config, materials, totalSurfaceFt2, totalCost } = snapshot;

  if (subTab === 'materiaux') {
    const m: RevetementMaterials = materials;
    const rows: MaterialRowDisplay[] = [];

    // Ligne revetement principal
    rows.push({
      qty: m.revetement.qty,
      size: REVETEMENT_LABELS[m.revetement.type],
      length: m.revetement.units,
      use: `Revetement (${formatNumber(m.revetement.surfaceFt2)} ft2)`,
    });

    // Membrane
    if (m.membrane.rolls > 0) {
      rows.push({
        qty: m.membrane.rolls,
        size: 'Tyvek 9x100',
        length: '900 ft2/rouleau',
        use: `Pare-air (${formatNumber(m.membrane.surfaceFt2)} ft2)`,
      });
    }

    // Soffite
    if (m.soffite.panels > 0) {
      rows.push({
        qty: m.soffite.panels,
        size: config.soffiteType,
        length: '12 pi typique',
        use: `Soffite (${formatNumber(m.soffite.surfaceFt2)} ft2)`,
      });
    }

    // Fascia
    if (m.fascia.pieces > 0) {
      rows.push({
        qty: m.fascia.pieces,
        size: config.fasciaType,
        length: config.fasciaType === 'aluminium' ? '12 pi' : '16 pi',
        use: `Fascia (${formatNumber(m.fascia.lengthLF)} LF)`,
      });
    }

    // Solins
    if (m.solins.count > 0) {
      rows.push({
        qty: m.solins.count,
        size: 'Aluminium',
        length: '-',
        use: `Solins (${m.solins.types.join(', ')})`,
      });
    }

    // Brique
    if (m.brique) {
      rows.push({
        qty: m.brique.briques,
        size: 'Brique modulaire',
        length: '-',
        use: 'Briques (incl. pertes)',
      });
      rows.push({
        qty: m.brique.sacsMortier,
        size: 'Sac mortier',
        length: '-',
        use: 'Mortier brique',
      });
    }

    return (
      <>
        <SectionCard
          title="Materiaux - Revetement"
          subtitle={`Type principal: ${REVETEMENT_LABELS[config.type]} | Direction: ${config.direction}`}
          icon={<Layers className="w-5 h-5 text-amber-600" />}
          footer={
            <div className="flex flex-wrap items-center gap-4">
              <span>Surface totale: {formatNumber(totalSurfaceFt2)} ft2</span>
              <span className="font-bold text-emerald-700">
                Cout estime: {formatCurrency(totalCost)}
              </span>
            </div>
          }
        >
          <MaterialTable rows={rows} />
        </SectionCard>
      </>
    );
  }

  if (subTab === 'cutlist') {
    const cutItems: RevetementCutListItem[] = materials.revetement.cutList ?? [];
    const filtered = cutItems.filter((c) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        String(c.lengthFt).includes(q) ||
        REVETEMENT_LABELS[config.type].toLowerCase().includes(q)
      );
    });

    return (
      <>
        <SectionCard
          title={`Liste de coupe - ${REVETEMENT_LABELS[config.type]}`}
          subtitle="Optimisation par longueur standard 8' / 10' / 12' / 14' / 16'"
          icon={<Layers className="w-5 h-5 text-amber-600" />}
        >
          {expandAll && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs md:text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-700 uppercase text-[10px]">
                    <th className="px-2 py-1.5 text-left border border-gray-200">Longueur</th>
                    <th className="px-2 py-1.5 text-right border border-gray-200">Quantite</th>
                    <th className="px-2 py-1.5 text-right border border-gray-200">Pieds lineaires</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c.lengthFt} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-1 border border-gray-100 font-bold text-amber-700">
                        {c.lengthFt}&apos;
                      </td>
                      <td className="px-2 py-1 border border-gray-100 text-right font-mono">{c.count}</td>
                      <td className="px-2 py-1 border border-gray-100 text-right font-mono">
                        {formatNumber(c.lengthFt * c.count, 0)} pi
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-2 text-center text-gray-400 italic text-xs">
                        {cutItems.length === 0
                          ? 'Aucune liste de coupe pour ce type (vinyle/brique/pierre).'
                          : 'Aucun resultat pour ce filtre.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Detail par elevation */}
        <SectionCard
          title="Repartition par elevation"
          subtitle={`${elevations.length} elevation(s)`}
          icon={<Layers className="w-5 h-5 text-amber-600" />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-700 uppercase text-[10px]">
                  <th className="px-2 py-1.5 text-left border border-gray-200">Elevation</th>
                  <th className="px-2 py-1.5 text-left border border-gray-200">Dimensions</th>
                  <th className="px-2 py-1.5 text-right border border-gray-200">Ouvertures</th>
                  <th className="px-2 py-1.5 text-right border border-gray-200">Surface nette (ft2)</th>
                </tr>
              </thead>
              <tbody>
                {elevations.map((el, i) => {
                  const Lft = el.lengthFt + el.lengthIn / 12;
                  const Hft = el.heightFt + el.heightIn / 12;
                  const gross = Lft * Hft;
                  const openSurface = el.openings.reduce((s, op) => {
                    return s + (op.widthIn / 12) * (op.heightIn / 12) * op.count;
                  }, 0);
                  const net = Math.max(0, gross - openSurface);
                  return (
                    <tr key={el.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-1 border border-gray-100 font-bold">{el.label}</td>
                      <td className="px-2 py-1 border border-gray-100 font-mono">
                        {formatNumber(Lft)}&apos; x {formatNumber(Hft)}&apos;
                      </td>
                      <td className="px-2 py-1 border border-gray-100 text-right">
                        {el.openings.reduce((s, op) => s + op.count, 0)}
                      </td>
                      <td className="px-2 py-1 border border-gray-100 text-right font-mono">
                        {formatNumber(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </>
    );
  }

  // PLANS
  return (
    <>
      <SectionCard
        title={`Plans Elevations (${elevations.length})`}
        subtitle="Vue de chaque facade avec ouvertures"
        icon={<Layers className="w-5 h-5 text-amber-600" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PlanThumb
            label={`Plan Revetement - ${REVETEMENT_LABELS[config.type]}`}
            svgRef={svgRef}
            onZoom={onZoom}
          />
        </div>
        <div className="mt-3 text-xs text-gray-500 space-y-1">
          {elevations.map((el) => {
            const Lft = el.lengthFt + el.lengthIn / 12;
            const Hft = el.heightFt + el.heightIn / 12;
            return (
              <p key={el.id}>
                <span className="font-bold text-gray-700">{el.label}:</span>{' '}
                {formatNumber(Lft)}&apos; x {formatNumber(Hft)}&apos; - {el.openings.length} ouverture(s)
              </p>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
});

// ============================================
// EXPORTS UTILITAIRES (pour reutilisation Phase 19)
// ============================================

export {
  inchesToFtInLabel,
  formatNumber,
  formatCurrency,
  svgRefToPngDataUrl,
  TAB_LABELS,
  SUBTAB_LABELS,
  REVETEMENT_LABELS,
};

// Re-exports helpers pour faciliter consumers (sans creer de cycles)
export type { PlancherMaterials, ToitureMaterials, RevetementMaterials, MurCutListItem };
// Re-exports pour referrer aux versions utilisees ici
export { formatFractionMur, formatFractionPlancher, formatFractionToiture, formatFractionRev };

// Sentinels pour ouvrir avec tab specifique (debogage)
export const RAPPORT_TABS = ALL_TABS;
export const RAPPORT_SUBTABS = ALL_SUBTABS;

// Indicators visuels (lucide) re-exportes pour usages externes coherents
export { AlertTriangle as RapportWarningIcon, TriangleAlert as RapportErrorIcon };
