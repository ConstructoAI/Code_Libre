import { useToolbarState } from '../hooks/useToolbarState';
import { useMetreStore } from '../store';
import { AIDetectButton } from './ai/AIDetectButton';
import { AIQuickInventoryButton } from './ai/AIQuickInventoryButton';
import type { Tool } from '../types';
import {
  FolderOpen,
  MousePointer2,
  Ruler,
  PenTool,
  Square,
  Triangle,
  Spline,
  Compass,
  Hash,
  CircleDot,
  Scale,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize,
  Magnet,
  Grid3x3,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2,
  AlignHorizontalJustifyCenter,
  Table2,
  ImageDown,
  Type,
  ArrowUpRight,
  Cloud,
  Pencil,
  Highlighter,
  StickyNote,
  MessageSquare,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Calculator,
  TrendingUp,
  HardHat,
  FilePlus2,
  Stamp,
  BrickWall,
  Package,
  FileText,
  Loader2,
} from 'lucide-react';
import { useCallback, useRef, useState, useEffect, ChangeEvent } from 'react';
import { exportAllAnnotated } from '../utils/exportPng';
import { generateBlankTemplatePdf } from '../utils/blankTemplate';

interface ToolDef {
  key: Tool;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { key: 'calibrate', label: 'Calibrer', shortcut: 'K', icon: <Scale size={16} /> },
  { key: 'select', label: 'Sélection', shortcut: 'V', icon: <MousePointer2 size={16} /> },
  { key: 'distance', label: 'Distance', shortcut: 'D', icon: <Ruler size={16} /> },
  { key: 'area', label: 'Surface', shortcut: 'A', icon: <PenTool size={16} /> },
  { key: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: <Square size={16} /> },
  { key: 'perimeter', label: 'Périmètre', shortcut: 'P', icon: <Triangle size={16} /> },
  { key: 'polyline', label: 'Polyligne', shortcut: 'L', icon: <Spline size={16} /> },
  { key: 'angle', label: 'Angle', shortcut: 'N', icon: <Compass size={16} /> },
  { key: 'count', label: 'Comptage', shortcut: 'C', icon: <Hash size={16} /> },
  { key: 'circle', label: 'Cercle', shortcut: 'I', icon: <CircleDot size={16} /> },
  { key: 'dimension', label: 'Cotation', shortcut: 'X', icon: <AlignHorizontalJustifyCenter size={16} /> },
  { key: 'pan', label: 'Déplacer', shortcut: 'H', icon: <Hand size={16} /> },
];

const ANNOTATION_TOOLS: ToolDef[] = [
  { key: 'text', label: 'Texte', shortcut: 'T', icon: <Type size={16} /> },
  { key: 'arrow', label: 'Flèche', shortcut: 'W', icon: <ArrowUpRight size={16} /> },
  { key: 'cloud', label: 'Nuage révision', shortcut: 'Q', icon: <Cloud size={16} /> },
  { key: 'freehand', label: 'Main levée', shortcut: 'F', icon: <Pencil size={16} /> },
  { key: 'highlight', label: 'Surligner', shortcut: 'G', icon: <Highlighter size={16} /> },
  { key: 'note', label: 'Note', shortcut: 'E', icon: <StickyNote size={16} /> },
  { key: 'callout', label: 'Bulle texte', shortcut: 'B', icon: <MessageSquare size={16} /> },
];

interface TopToolbarProps {
  onGenerateSoumission?: () => void;
  onGenerateSoumissionBom?: () => void | Promise<void>;
  isGeneratingSoumissionBom?: boolean;
}

export default function TopToolbar({
  onGenerateSoumission,
  onGenerateSoumissionBom,
  isGeneratingSoumissionBom = false,
}: TopToolbarProps = {}) {
  const {
    activeTool, setActiveTool,
    viewState, setViewState,
    snapEnabled, toggleSnap,
    orthoEnabled, toggleOrtho,
    gridEnabled, toggleGrid,
    undo, redo, undoStack, redoStack,
    showSummary, toggleSummary,
    showCalculator, toggleCalculator,
    showSlopeConverter, toggleSlopeConverter,
    showCatalog, toggleCatalog,
    showLaborCatalog, toggleLaborCatalog,
    showSymbolCatalog, toggleSymbolCatalog,
    selectedMeasurementIds,
    rotateMeasurement45, mirrorCopyMeasurement,
  } = useToolbarState();
  const hasSelection = selectedMeasurementIds.length > 0;

  // PHASE 1: AIDetectButton needs the persisted document id (numeric backend
  // id), the current 1-based page number, and a flag indicating whether the
  // page is calibrated (Claude Vision needs the px/unit ratio to convert
  // pixel detections into real-world values).
  const aiDocument = useMetreStore((s) => s.document);
  const aiDocumentId = aiDocument?.id != null && /^\d+$/.test(String(aiDocument.id))
    ? Number(aiDocument.id)
    : null;
  const aiPageNumber = useMetreStore((s) => s.currentPage);
  const aiCalibrated = useMetreStore((s) => s.calibration !== null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // CSS-only fullscreen: apply position:fixed styles to fill the viewport.
  // We avoid the native Fullscreen API entirely so that Escape never exits
  // fullscreen — Escape only cancels the active tool / deselects.
  const applyCssFullscreen = useCallback((active: boolean) => {
    const inIframe = window !== window.parent;
    if (inIframe) {
      // Iframe (Streamlit): style the parent container via window.frameElement
      try {
        const iframe = window.frameElement as HTMLIFrameElement | null;
        if (iframe?.parentElement) {
          if (active) {
            iframe.parentElement.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;background:#0d1117;';
            iframe.style.cssText = 'width:100%;height:100%;border:none;';
          } else {
            iframe.parentElement.style.cssText = '';
            iframe.style.cssText = '';
          }
          return;
        }
      } catch {}
      // Fallback: postMessage to parent
      window.parent.postMessage({ type: 'metre-fullscreen', active }, '*');
    } else {
      // Standalone: style #metre-app-root directly
      const el = document.getElementById('metre-app-root');
      if (el) {
        if (active) {
          el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;';
        } else {
          el.style.cssText = '';
        }
      }
    }
  }, []);

  useEffect(() => {
    // Listen for parent Streamlit frame confirming CSS fullscreen
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'metre-fullscreen-ack') {
        setIsFullscreen(e.data.active);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      applyCssFullscreen(true);
      setIsFullscreen(true);
    } else {
      applyCssFullscreen(false);
      setIsFullscreen(false);
    }
  }, [isFullscreen, applyCssFullscreen]);

  const handleExportPng = useCallback(async () => {
    // Defence-in-depth: the button is `disabled={exporting}` already (line 478)
    // so React prevents a double-click via the DOM. The early return guards
    // against any other path that might invoke this handler programmatically.
    if (exporting) return;
    setExporting(true);
    try {
      // Downloads up to 3 separate PNGs in sequence:
      //   1. {doc}-page-N-annote.png   (plan + measurements)
      //   2. {doc}-produits-detail.png (per-measurement product table, skipped if empty)
      //   3. {doc}-bom-detail.png      (composite/child/formula table, skipped if no composite)
      // Some browsers may prompt the user to "allow multiple downloads" the
      // first time this fires — that's the expected UX.
      const count = await exportAllAnnotated(3);
      if (count < 3) {
        // Tell the user explicitly which tables were skipped so a partial
        // export (1 or 2 files) doesn't look like a bug — Console hint plus a
        // browser-native alert that doesn't require a toast lib.
        const skipped = 3 - count;
        const reason =
          count === 0
            ? 'aucun document n\'est chargé (aucun PDF ni image actif)'
            : count === 1
              ? 'aucune mesure n\'a de produit associé et aucun composite n\'est utilisé'
              : 'certaines données sont vides (produits ou BOM)';
        // eslint-disable-next-line no-alert
        alert(
          `Export terminé : ${count}/3 fichier(s) téléchargé(s).\n` +
            `${skipped} fichier(s) ignoré(s) car ${reason}.`,
        );
      }
    } catch (err) {
      console.error('[handleExportPng] export failed:', err);
      // eslint-disable-next-line no-alert
      alert("Erreur lors de l'export PNG. Consulter la console pour les détails.");
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  const IMAGE_EXT = /\.(png|jpe?g|bmp|tiff?|webp)$/i;
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/bmp', 'image/webp', 'image/tiff']);

  const handleFileInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) { e.target.value = ''; return; }

    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) {
          const loadFn = (window as any).__metrePdfLoad;
          if (loadFn) loadFn(reader.result as ArrayBuffer);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (IMAGE_TYPES.has(file.type) || IMAGE_EXT.test(file.name)) {
      const loadFn = (window as any).__metreImageLoad;
      if (loadFn) loadFn(file);
    }
    e.target.value = '';
  }, []);

  const handleZoomIn = useCallback(() => {
    setViewState({ zoom: Math.min(viewState.zoom * 1.25, 10) });
  }, [viewState.zoom, setViewState]);

  const handleZoomOut = useCallback(() => {
    setViewState({ zoom: Math.max(viewState.zoom / 1.25, 0.1) });
  }, [viewState.zoom, setViewState]);

  const handleFitToPage = useCallback(() => {
    setViewState({ zoom: 1, offsetX: 0, offsetY: 0 });
  }, [setViewState]);

  const zoomPercent = Math.round(viewState.zoom * 100);

  return (
    <div className="h-11 bg-metre-surface border-b border-metre-border flex items-center px-2 gap-1 overflow-x-auto flex-shrink-0">
      {/* Open PDF */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.bmp,.tiff,.tif,.webp"
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />
      <button
        className="tool-btn"
        onClick={() => fileInputRef.current?.click()}
        title="Ouvrir un plan - PDF ou image (Ctrl+O)"
      >
        <FolderOpen size={16} />
      </button>
      <button
        className="tool-btn"
        onClick={() => {
          const buf = generateBlankTemplatePdf();
          const loadFn = (window as any).__metrePdfLoad;
          if (loadFn) loadFn(buf);
        }}
        title='Nouveau plan vierge (ARCH D 36"x24")'
      >
        <FilePlus2 size={16} />
      </button>

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* Measurement tools */}
      <div className="flex items-center gap-0.5">
        {TOOLS.map((tool) => (
          <button
            key={tool.key}
            className={`tool-btn ${activeTool === tool.key ? 'tool-btn-active' : ''}`}
            onClick={() => setActiveTool(tool.key)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* Annotation tools */}
      <div className="flex items-center gap-0.5">
        {ANNOTATION_TOOLS.map((tool) => (
          <button
            key={tool.key}
            className={`tool-btn ${activeTool === tool.key ? 'tool-btn-active' : ''}`}
            onClick={() => setActiveTool(tool.key)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* Transform tools (active only with selection) */}
      <div className="flex items-center gap-0.5">
        <button
          className="tool-btn"
          onClick={() => { for (const id of selectedMeasurementIds) rotateMeasurement45(id); }}
          disabled={!hasSelection}
          title="Pivoter 45° (R)"
        >
          <RotateCw size={16} className={!hasSelection ? 'opacity-30' : ''} />
        </button>
        <button
          className="tool-btn"
          onClick={() => { for (const id of selectedMeasurementIds) mirrorCopyMeasurement(id, 'horizontal'); }}
          disabled={!hasSelection}
          title="Copie miroir horizontal (M)"
        >
          <FlipHorizontal2 size={16} className={!hasSelection ? 'opacity-30' : ''} />
        </button>
        <button
          className="tool-btn"
          onClick={() => { for (const id of selectedMeasurementIds) mirrorCopyMeasurement(id, 'vertical'); }}
          disabled={!hasSelection}
          title="Copie miroir vertical (Shift+M)"
        >
          <FlipVertical2 size={16} className={!hasSelection ? 'opacity-30' : ''} />
        </button>
      </div>

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5">
        <button className="tool-btn" onClick={handleZoomOut} title="Zoom arrière (-)">
          <ZoomOut size={16} />
        </button>
        <span className="text-xs text-metre-muted min-w-[40px] text-center tabular-nums">
          {zoomPercent}%
        </span>
        <button className="tool-btn" onClick={handleZoomIn} title="Zoom avant (+)">
          <ZoomIn size={16} />
        </button>
        <button className="tool-btn" onClick={handleFitToPage} title="Ajuster à la page">
          <Maximize size={16} />
        </button>
      </div>

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* Snap, Ortho, Grid toggles */}
      <div className="flex items-center gap-0.5">
        <button
          className={`tool-btn ${snapEnabled ? 'tool-btn-active' : ''}`}
          onClick={toggleSnap}
          title="Accrochage (F3)"
        >
          <Magnet size={16} />
        </button>
        <button
          className={`tool-btn ${orthoEnabled ? 'tool-btn-active' : ''}`}
          onClick={toggleOrtho}
          title="Mode ortho (F8)"
        >
          <AlignHorizontalJustifyCenter size={16} />
        </button>
        <button
          className={`tool-btn ${gridEnabled ? 'tool-btn-active' : ''}`}
          onClick={toggleGrid}
          title="Grille (F7)"
        >
          <Grid3x3 size={16} />
        </button>
      </div>

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* Calculator toggle */}
      <button
        className={`tool-btn ${showCalculator ? 'tool-btn-active' : ''}`}
        onClick={toggleCalculator}
        title="Calculatrice Construction"
      >
        <Calculator size={16} />
      </button>

      {/* Slope converter toggle */}
      <button
        className={`tool-btn ${showSlopeConverter ? 'tool-btn-active' : ''}`}
        onClick={toggleSlopeConverter}
        title="Convertisseur de Pente (x/12, degrés, %)"
      >
        <TrendingUp size={16} />
      </button>

      {/* Product catalog toggle */}
      <button
        className={`tool-btn ${showCatalog ? 'tool-btn-active' : ''}`}
        onClick={toggleCatalog}
        title="Catalogue de Produits"
      >
        <Package size={16} />
      </button>

      {/* Labor catalog toggle */}
      <button
        className={`tool-btn ${showLaborCatalog ? 'tool-btn-active' : ''}`}
        onClick={toggleLaborCatalog}
        title="Corps de Métier CCQ (Main-d'œuvre)"
      >
        <HardHat size={16} />
      </button>

      {/* Mur tool */}
      <button
        className={`tool-btn ${activeTool === 'mur' ? 'tool-btn-active' : ''}`}
        onClick={() => setActiveTool('mur')}
        title="Mur – mesure clavier (J)"
      >
        <BrickWall size={16} />
      </button>

      {/* Symbol catalog toggle */}
      <button
        className={`tool-btn ${showSymbolCatalog ? 'tool-btn-active' : ''}`}
        onClick={toggleSymbolCatalog}
        title="Symboles Architecturaux (Portes, Fenêtres...)"
      >
        <Stamp size={16} />
      </button>

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* PHASE 1+2: AI Detect button (Claude Vision). Disabled when no
          backend-persisted document is loaded or when the current page is
          not calibrated. Opens a modal with 3 modes (generic / single
          section BOM / multi-section). */}
      <AIDetectButton
        documentId={aiDocumentId}
        pageNumber={aiPageNumber}
        disabled={!aiCalibrated}
        disabledReason={
          !aiDocumentId
            ? "Charger un document PDF (mode ERP) avant la detection IA"
            : !aiCalibrated
              ? "Calibrer l'echelle de la page avant la detection IA"
              : undefined
        }
      />

      {/* PHASE 3: AI Quick Inventory button. Alternative au mode markup
          overlay. Claude retourne une liste texte structuree (sans coords).
          Pas de calibration requise (lit les annotations du plan directement). */}
      <AIQuickInventoryButton
        documentId={aiDocumentId}
        pageNumber={aiPageNumber}
        disabledReason={
          !aiDocumentId
            ? "Charger un document PDF (mode ERP) avant l'inventaire IA"
            : undefined
        }
      />

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* Summary panel toggle */}
      <button
        className={`tool-btn ${showSummary ? 'tool-btn-active' : ''}`}
        onClick={toggleSummary}
        title="Résumé multi-pages"
      >
        <Table2 size={16} />
      </button>

      {/* Export annotated page + products detail + BOM detail as separate PNGs */}
      <button
        className="tool-btn"
        onClick={handleExportPng}
        disabled={exporting}
        aria-busy={exporting || undefined}
        title={
          exporting
            ? 'Export en cours…'
            : 'Exporter en PNG : plan annoté + détail produits + détail BOM (3 fichiers)'
        }
      >
        {exporting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ImageDown size={16} />
        )}
      </button>

      {/* Generate soumission from measurements (legacy: 1 produit par mesure) */}
      {onGenerateSoumission && (
        <button
          className="tool-btn"
          onClick={onGenerateSoumission}
          title="Générer une soumission (mesures avec produit associé)"
        >
          <FileText size={16} />
        </button>
      )}

      {/* Generate soumission from BOM composites (P3.4: calques liés au BOM)
          Export AUTO : ne prend pas en compte les overrides manuels saisis
          dans le panneau BOM (limitation MVP, voir code de handleOpenSoumissionBom). */}
      {onGenerateSoumissionBom && (
        <button
          className="tool-btn"
          onClick={() => { void onGenerateSoumissionBom(); }}
          disabled={isGeneratingSoumissionBom}
          aria-busy={isGeneratingSoumissionBom || undefined}
          aria-label={
            isGeneratingSoumissionBom
              ? 'Génération de la soumission BOM en cours'
              : 'Générer une soumission BOM automatique'
          }
          title={
            isGeneratingSoumissionBom
              ? 'Génération en cours…'
              : 'Générer une soumission BOM automatique (calques liés aux composites) — n\'inclut pas les overrides manuels du panneau BOM'
          }
          style={
            isGeneratingSoumissionBom
              ? { opacity: 0.6, cursor: 'wait' }
              : undefined
          }
        >
          {isGeneratingSoumissionBom ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Package size={16} />
          )}
        </button>
      )}

      <div className="flex-1" />

      {/* Fullscreen toggle */}
      <button
        className="tool-btn"
        onClick={handleToggleFullscreen}
        title={isFullscreen ? 'Quitter le plein écran (F11)' : 'Plein écran (F11)'}
      >
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>

      <div className="w-px h-6 bg-metre-border mx-2" />

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <button
          className="tool-btn"
          onClick={undo}
          disabled={undoStack.length === 0}
          title="Annuler (Ctrl+Z)"
        >
          <Undo2 size={16} className={undoStack.length === 0 ? 'opacity-30' : ''} />
        </button>
        <button
          className="tool-btn"
          onClick={redo}
          disabled={redoStack.length === 0}
          title="Rétablir (Ctrl+Y)"
        >
          <Redo2 size={16} className={redoStack.length === 0 ? 'opacity-30' : ''} />
        </button>
      </div>
    </div>
  );
}
