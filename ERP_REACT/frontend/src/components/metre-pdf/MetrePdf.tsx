import './metre-pdf.css';
import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import TopToolbar from './components/TopToolbar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import BottomBar from './components/BottomBar';
import PDFViewer from './components/PDFViewer';
import MeasurementCanvas from './components/MeasurementCanvas';
import ZoomControls from './components/ZoomControls';
import PageNavigator from './components/PageNavigator';
import CalibrationModal from './components/CalibrationModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import MetreSavedBar from './components/MetreSavedBar';
import {
  useMetreStore,
  flushPendingSavesToStorage,
  mapServerComponent,
  loadConsolidationMode,
  saveConsolidationMode,
  type SoumissionConsolidationMode,
} from './store';
import {
  computeBomSectionsForState,
  autoSelectActiveComposites,
} from './utils/bomComputation';
import type { ProductComponent } from './types';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@/store/useAuthStore';
import type { ClientInfo, SoumissionItem } from './components/SoumissionModal';
import ClientInfoCard from '../devis/ClientInfoCard';
import * as companiesApi from '../../api/companies';
import type { Company, Contact } from '../../api/companies';
import * as metreApi from './api';
import type { MetreLibraryEntry } from './api';

// Lazy-loaded modals — only downloaded when user opens them
const ProductCatalog = lazy(() => import('./components/ProductCatalog'));
const SummaryPanel = lazy(() => import('./components/SummaryPanel'));
const CalculatorPanel = lazy(() => import('./components/CalculatorPanel'));
const SlopeConverterPanel = lazy(() => import('./components/SlopeConverterPanel'));
const LaborCatalogPanel = lazy(() => import('./components/LaborCatalogPanel'));
const SymbolCatalogPanel = lazy(() => import('./components/SymbolCatalogPanel'));
const SoumissionModal = lazy(() => import('./components/SoumissionModal'));
const BomEstimationPanel = lazy(() => import('./components/BomEstimationPanel'));
const MetreLibraryModal = lazy(() => import('./components/MetreLibraryModal'));
const SaveMetreModal = lazy(() => import('./components/SaveMetreModal'));

interface MetrePdfProps {
  height?: string;
  devisId?: number;
  devisNom?: string;
  onApplyToDevis?: (items: SoumissionItem[], clientInfo: ClientInfo) => void;
  onCreateDevis?: (items: SoumissionItem[], clientInfo: ClientInfo) => void;
}

export default function MetrePdf({
  height = '85vh',
  devisId,
  devisNom,
  onApplyToDevis,
  onCreateDevis,
}: MetrePdfProps) {
  const {
    showLeftPanel, showRightPanel,
    showCatalog, showSummary, showCalculator,
    showSlopeConverter, showLaborCatalog, showSymbolCatalog,
    productsLoaded, fetchProducts,
    currentMetreProject, setCurrentMetreProject, closeMetreProject,
  } = useMetreStore(
    useShallow((s) => ({
      showLeftPanel: s.showLeftPanel,
      showRightPanel: s.showRightPanel,
      showCatalog: s.showCatalog,
      showSummary: s.showSummary,
      showCalculator: s.showCalculator,
      showSlopeConverter: s.showSlopeConverter,
      showLaborCatalog: s.showLaborCatalog,
      showSymbolCatalog: s.showSymbolCatalog,
      productsLoaded: s.productsLoaded,
      fetchProducts: s.fetchProducts,
      currentMetreProject: s.currentMetreProject,
      setCurrentMetreProject: s.setCurrentMetreProject,
      closeMetreProject: s.closeMetreProject,
    })),
  );

  // ERP context: shared via window.__ERP_CONTEXT__ so the metre-pdf module
  // (originally a standalone Streamlit app) knows it's running embedded in the
  // ERP. Without this, isERPMode() returns false everywhere → no backend
  // persistence (mesures, layers, calibration, products), composites hidden,
  // and localStorage keys are NOT tenant-prefixed (cross-tenant leak risk).
  // Assigned during render (idempotent) so children's lazy-loaded `useState`
  // initializers — which run bottom-up after this parent's render body but
  // before any effect — already see it on first mount.
  const userSchema = useAuthStore((s) => s.user?.schemaName);
  const userId = useAuthStore((s) => s.user?.userId);
  const userName = useAuthStore((s) => s.user?.displayName);
  const entrepriseId = useAuthStore((s) => s.tenant?.entrepriseId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (userSchema && userId) {
    window.__ERP_CONTEXT__ = {
      tenant_schema: userSchema,
      user_id: userId,
      user_name: userName,
      company_id: entrepriseId,
      project_name: devisNom,
      embedded: true,
    };
  } else if (
    typeof window !== 'undefined'
    && window.__ERP_CONTEXT__
    && !isAuthenticated
  ) {
    // Real logout: drop the stale context to prevent cross-tenant leaks into
    // isERPMode(), _tenantKey() and fetchProducts(). When isAuthenticated is
    // still true but schema/userId are momentarily undefined (re-render race
    // during checkAuth or user-store update), we keep the context to avoid
    // breaking in-flight loadDocumentData / push helpers.
    delete window.__ERP_CONTEXT__;
  }

  useEffect(() => {
    return () => {
      delete window.__ERP_CONTEXT__;
    };
  }, []);

  // Force-flush pending localStorage debounce timers if the user closes the
  // tab before the 1s debounce expires. Without this, the last sub-second of
  // measurements/layers traced just before close are lost — happens often
  // when reviewing a métré quickly. Only useful in standalone or local-only
  // mode (ERP-with-persisted-doc syncs each mutation directly to backend).
  useEffect(() => {
    const handler = () => {
      try { flushPendingSavesToStorage(); } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  /** Cross-tenant safety: when the authenticated user changes (logout, tenant
   *  switch), drop any saved métré reference held in the Zustand store —
   *  otherwise the next user would briefly see the previous tenant's métré
   *  name in the SavedBar before picking their own. The store survives
   *  component remounts (module-scoped), so this is the only place we can
   *  reset it tied to identity. We intentionally only react to userId/schema
   *  going FROM defined TO either-undefined-or-different. */
  const lastUserKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = userSchema && userId ? `${userSchema}:${userId}` : null;
    const prev = lastUserKeyRef.current;
    if (prev !== null && prev !== key) {
      // Identity changed — clear store-level métré state.
      useMetreStore.getState().closeMetreProject();
    }
    lastUserKeyRef.current = key;
  }, [userSchema, userId]);

  // --- Soumission modal state ---
  const [showSoumission, setShowSoumission] = useState(false);
  const [soumissionItems, setSoumissionItems] = useState<SoumissionItem[]>([]);

  // --- BOM live estimation panel ---
  // Local toggle (volontairement pas dans le store global pour rester
  // additif et sans toucher TopToolbar/store dans cette V1).
  const [showBomEstimation, setShowBomEstimation] = useState(false);

  // --- Saved métré (library + naming modals) ---
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  /** 'create' = brand new métré, 'rename' = update current métré name/desc. */
  const [saveMode, setSaveMode] = useState<'create' | 'rename'>('create');
  /** Set when the user picks a PDF before naming the métré: holds the buffer
   *  until the project is created on the backend, then auto-uploads it. */
  const pendingPdfRef = useRef<{ buffer: ArrayBuffer; filename: string } | null>(null);

  /** Suppression flag for the document-watching subscribe effect.
   *  Set to `true` during flows that explicitly drive the document lifecycle
   *  themselves (handleOpenMetre, handleSaveConfirm) so the auto-upload
   *  listener doesn't fire concurrently and create a duplicate document.
   *  Always reset to `false` in a `finally` block after the orchestrating
   *  flow completes. */
  const suppressAutoUploadRef = useRef(false);
  /** Per-project upload guard: prevents the rare case where `setDocument`
   *  fires twice for the same fake doc-${ts} id (e.g. PDFViewer remount race)
   *  from triggering two parallel uploadCachedPdfForProject calls. Cleared
   *  at most once per métré open. */
  const uploadingForProjectIdRef = useRef<number | null>(null);

  // --- Client info form (shown when no devis is connected) ---
  // Matches the behaviour in EstimationIA / Manuel tabs so the 3 creation flows
  // share the same UX. Pre-fills SoumissionModal on open.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [clientForm, setClientForm] = useState<ClientInfo>({
    nomProjet: '',
    clientCompanyId: undefined,
    clientContactId: undefined,
    clientNomDirect: '',
    poClient: '',
    datePrevu: '',
    dateSoumis: '',
    priorite: 'NORMAL',
    description: '',
  });

  useEffect(() => {
    if (devisId) return; // no need to load when connected to an existing devis
    Promise.all([
      companiesApi.listCompanies({ perPage: 100 }),
      companiesApi.listContacts({ perPage: 100 }),
    ]).then(([compRes, contRes]) => {
      setCompanies(compRes.items);
      setContacts(contRes.items);
    }).catch(() => {});
  }, [devisId]);

  // ── Saved métré handlers ─────────────────────────────────────────────
  // Implementation notes:
  //  - "Save" = create a metre_project on the backend. Once it exists, the
  //    store auto-syncs every measurement/layer/calibration mutation via
  //    the existing _push helpers (see store.ts). All we need to do here is
  //    create the project + upload the PDF binary if one is already loaded
  //    locally; the in-memory measurements then get re-pushed via store
  //    helpers wrapped below.
  //  - Re-pushing in-memory measurements after save: handled by the
  //    `_diffAndPushMeasurements` already used for undo/redo. We trigger it
  //    by reading the current array, swapping the document id (so
  //    `_hasPersistedDocument` returns true), then calling
  //    `pushAllInMemoryMeasurements()` which we add inline below.

  /** Re-push every in-memory measurement to the backend after we transitioned
   *  from local-only mode to backend-persisted mode (i.e. after an upload). */
  const pushAllInMemoryMeasurements = useCallback(async () => {
    const state = useMetreStore.getState();
    const docId = state.document?.id;
    if (!docId || !/^\d+$/.test(String(docId))) return;
    // Track failures across all 3 phases (calibration, layers, measurements).
    // We surface the count in uploadError so the user knows the métré is in
    // an inconsistent state — without this the catch blocks below silently
    // swallow per-item failures and the user sees a "Sauvegarde auto" green
    // checkmark while measurements are missing on the backend.
    let failCount = 0;
    let totalCount = 0;
    // Sync calibration first (so measurements have a calibration to attach to)
    const cal = state.calibration;
    if (cal) {
      totalCount += 1;
      try {
        const saved = await metreApi.setCalibration(docId, {
          pageNumber: cal.pageNumber,
          scaleFactor: cal.scaleFactor,
          unit: cal.unit,
          referenceLength: cal.referenceLength,
          pixelLength: cal.pixelLength,
        });
        const realCal = saved as unknown as Record<string, unknown>;
        useMetreStore.setState({
          calibration: {
            ...cal,
            id: String(realCal.id),
            documentId: String(docId),
          },
        });
      } catch (err) {
        failCount += 1;
        console.error('[MetrePdf] failed to push initial calibration:', err);
      }
    }
    // Layers next: each becomes a real backend layer; we patch the local id
    // and re-point measurements that referenced the local id.
    const layerIdMap = new Map<string, string>();
    for (const layer of state.layers) {
      if (/^\d+$/.test(layer.id)) continue;
      totalCount += 1;
      try {
        const created = await metreApi.createLayer(docId, {
          name: layer.name,
          color: layer.color,
          visible: layer.visible,
          locked: layer.locked,
        });
        const realId = String((created as unknown as Record<string, unknown>).id);
        layerIdMap.set(layer.id, realId);
      } catch (err) {
        failCount += 1;
        console.error('[MetrePdf] failed to push layer:', err);
      }
    }
    if (layerIdMap.size > 0) {
      useMetreStore.setState((s) => ({
        layers: s.layers.map((l) => ({ ...l, id: layerIdMap.get(l.id) ?? l.id })),
        measurements: s.measurements.map((m) => ({
          ...m,
          layer: layerIdMap.get(m.layer) ?? m.layer,
        })),
        activeLayerId: s.activeLayerId
          ? layerIdMap.get(s.activeLayerId) ?? s.activeLayerId
          : null,
      }));
    }
    // Measurements last (after layer ids are real). We POST each one then
    // patch the local id with the backend id. Done sequentially to keep the
    // load gentle on the backend; runs in the background — UI stays usable.
    const currentMeasurements = useMetreStore.getState().measurements;
    for (const m of currentMeasurements) {
      if (/^\d+$/.test(m.id)) continue; // already has a real id (shouldn't happen here)
      totalCount += 1;
      try {
        const layerIdNum = /^\d+$/.test(m.layer) ? parseInt(m.layer, 10) : null;
        const productIdNum = m.productId && /^\d+$/.test(m.productId)
          ? parseInt(m.productId, 10)
          : null;
        const created = await metreApi.createMeasurement(docId, {
          pageNumber: m.pageNumber,
          type: m.type,
          label: m.label,
          value: m.value,
          unit: m.unit,
          points: m.points,
          color: m.color,
          // Server expects layer_id / product_id as numeric ids
          layerId: layerIdNum,
          productId: productIdNum,
          quantity: m.quantity ?? null,
          metadataJson: {
            slopeFactor: m.slopeFactor,
            isDeduction: m.isDeduction,
            parentMeasurementId: m.parentMeasurementId,
            group: m.group,
            fontSize: m.fontSize,
            strokeWidth: m.strokeWidth,
            textContent: m.textContent,
            opacity: m.opacity,
            zOrder: m.zOrder,
            laborTradeId: m.laborTradeId,
            laborHours: m.laborHours,
            laborPersons: m.laborPersons,
            symbolBlockId: m.symbolBlockId,
            symbolRotation: m.symbolRotation,
            symbolScale: m.symbolScale,
          },
        } as unknown as Parameters<typeof metreApi.createMeasurement>[1]);
        const realId = String((created as unknown as Record<string, unknown>).id);
        useMetreStore.setState((s) => ({
          measurements: s.measurements.map((mm) =>
            mm.id === m.id ? { ...mm, id: realId, documentId: String(docId) } : mm
          ),
        }));
      } catch (err) {
        failCount += 1;
        console.error('[MetrePdf] failed to push measurement:', err);
      }
    }
    // Surface partial-failure count to the user. The MetreSavedBar reads
    // uploadError and shows a red banner so the user knows the metré is
    // inconsistent — without this the silent catches above hide the failure.
    if (failCount > 0) {
      useMetreStore.setState({
        uploadError: `${failCount} élément(s) sur ${totalCount} non sauvegardés (réessayez ou rechargez le métré)`,
      });
    }
  }, []);

  /** Upload the cached PDF buffer to the backend for the given project, set
   *  the document in the store with a real numeric id, then re-push all
   *  in-memory measurements/layers/calibration.
   *
   *  Guarded by `uploadingForProjectIdRef`: concurrent calls for the same
   *  project become no-ops, preventing duplicate uploads from races between
   *  handleSaveConfirm / handleOpenMetre / the subscribe listener. */
  const uploadCachedPdfForProject = useCallback(
    async (projectId: number) => {
      if (uploadingForProjectIdRef.current === projectId) {
        // Another upload for this project is already running — skip.
        return;
      }
      const buffer = pendingPdfRef.current?.buffer
        ?? useMetreStore.getState().pdfBuffer
        ?? null;
      const filename = pendingPdfRef.current?.filename
        ?? useMetreStore.getState().document?.filename
        ?? 'plan.pdf';
      if (!buffer) return;
      uploadingForProjectIdRef.current = projectId;
      const file = new File([buffer], filename, { type: 'application/pdf' });
      let needsRetrigger = false;
      let stale = false;
      try {
        const uploaded = await metreApi.uploadDocument(projectId, file);
        const doc = uploaded as unknown as Record<string, unknown>;
        const realId = String(doc.id);
        // Stale-check: the user may have closed the métré or switched to a
        // different project while uploadDocument was in flight. Patching the
        // document in either case would corrupt the now-active state (write
        // project-A's id onto project-B's document, or revive a closed doc).
        const stateNow = useMetreStore.getState();
        if (
          !stateNow.currentMetreProject
          || stateNow.currentMetreProject.id !== String(projectId)
          || !stateNow.document
        ) {
          stale = true;
          console.warn(
            '[MetrePdf] upload completed for stale project — discarding patch',
            { projectId, currentProjectId: stateNow.currentMetreProject?.id },
          );
          // Best-effort: ask backend to drop the orphan. Fire-and-forget.
          metreApi.deleteDocument(realId).catch((delErr) => {
            console.error('[MetrePdf] failed to delete orphan document:', delErr);
          });
          return;
        }
        // Patch the existing document in the store with the real backend id.
        // We bypass setDocument here to avoid wiping the in-memory measurements
        // (setDocument's wipe assumes a fresh document load).
        useMetreStore.setState((s) => {
          if (
            !s.document
            || !s.currentMetreProject
            || s.currentMetreProject.id !== String(projectId)
          ) {
            return {};
          }
          return {
            document: {
              ...s.document,
              id: realId,
              projectId: String(projectId),
              filename: (doc.filename as string) ?? s.document.filename,
              pageCount: (doc.pageCount as number) ?? s.document.pageCount,
            },
            // Clear any prior upload error from a previous failed attempt —
            // this upload succeeded so the badge should disappear.
            uploadError: null,
          };
        });
        pendingPdfRef.current = null;
        await pushAllInMemoryMeasurements();
        // If the user dragged a different PDF while this upload was running,
        // pdfBuffer now references a buffer that DIFFERS from the one we just
        // uploaded. Flag for re-trigger AFTER the finally clears the ref —
        // doing the revert setState inside the try would re-enter the
        // subscribe synchronously (Zustand notifies sync) and bail because
        // uploadingForProjectIdRef is still set.
        const latestBuffer = useMetreStore.getState().pdfBuffer;
        needsRetrigger = !!latestBuffer && latestBuffer !== buffer;
      } catch (err) {
        console.error('[MetrePdf] uploadCachedPdfForProject failed:', err);
        // Surface the failure in the store so MetreSavedBar can warn the user
        // — but only if the user is still on the same project. Otherwise the
        // banner would appear on the wrong métré.
        const stateOnErr = useMetreStore.getState();
        if (
          stateOnErr.currentMetreProject
          && stateOnErr.currentMetreProject.id === String(projectId)
        ) {
          useMetreStore.setState({
            uploadError: err instanceof Error ? err.message : 'Erreur de sauvegarde du PDF',
          });
        }
        throw err;
      } finally {
        // Project-scoped clear: only release the guard if it still belongs to
        // THIS upload. Otherwise a slow upload from a closed project could
        // clobber the guard of an upload that started for the next project.
        if (uploadingForProjectIdRef.current === projectId) {
          uploadingForProjectIdRef.current = null;
        }
      }
      if (stale) return;
      // Outside try/finally: ref is now null, so the subscribe re-entry
      // triggered by this setState can actually start the new upload.
      if (needsRetrigger) {
        useMetreStore.setState((s) => ({
          document: s.document ? { ...s.document, id: `doc-${Date.now()}` } : null,
        }));
      }
    },
    [pushAllInMemoryMeasurements],
  );

  // Reset upload-tracking refs whenever the active project changes (open
  // another métré, close, switch). Without this, refs from a previous métré
  // leak into the next: pendingPdfRef can hand its buffer to a new upload,
  // and uploadingForProjectIdRef can falsely block a legitimate new upload.
  useEffect(() => {
    return () => {
      pendingPdfRef.current = null;
      uploadingForProjectIdRef.current = null;
    };
  }, [currentMetreProject?.id]);

  const handleNewMetre = useCallback(() => {
    setSaveMode('create');
    setShowSaveModal(true);
  }, []);

  const handleOpenLibrary = useCallback(() => {
    setShowLibraryModal(true);
  }, []);

  const handleRenameMetre = useCallback(() => {
    if (!currentMetreProject) return;
    setSaveMode('rename');
    setShowSaveModal(true);
  }, [currentMetreProject]);

  const handleCloseMetre = useCallback(() => {
    if (!currentMetreProject) return;
    const uploadErr = useMetreStore.getState().uploadError;
    const warningLine = uploadErr
      ? `\n\nAttention : une sauvegarde a échoué (${uploadErr}). Vos dernières mesures peuvent ne pas être conservées.`
      : '';
    const ok = window.confirm(
      `Fermer le métré "${currentMetreProject.name}" ?\n\n` +
        `Patientez quelques secondes après votre dernière modification pour laisser les sauvegardes se terminer.` +
        warningLine,
    );
    if (!ok) return;
    closeMetreProject();
  }, [currentMetreProject, closeMetreProject]);

  /** SaveMetreModal confirm callback. Branches on saveMode. */
  const handleSaveConfirm = useCallback(
    async ({ name, description }: { name: string; description: string }) => {
      if (saveMode === 'rename') {
        if (!currentMetreProject) return;
        const updated = await metreApi.updateProject(currentMetreProject.id, {
          name,
          description,
        });
        const u = updated as unknown as Record<string, unknown>;
        setCurrentMetreProject({
          ...currentMetreProject,
          name: (u.name as string) ?? name,
          description: (u.description as string) ?? description,
        });
        return;
      }
      // Create flow: POST project, then upload any cached PDF, then push state.
      // Auto-link to the currently-selected devis (if any) so the métré
      // remembers which soumission it was used to populate.
      // We arm `suppressAutoUploadRef` so the document-watching subscribe
      // effect (registered just below) doesn't race with our explicit
      // `uploadCachedPdfForProject` call and create a duplicate document.
      suppressAutoUploadRef.current = true;
      try {
        const created = await metreApi.createProject({
          name,
          description,
          devisId: devisId ?? null,
        });
        const c = created as unknown as Record<string, unknown>;
        const newProject = {
          id: String(c.id),
          name: (c.name as string) ?? name,
          description: (c.description as string) ?? description,
          companyId: c.companyId != null ? String(c.companyId) : '',
          devisId: (c.devisId as number | null | undefined) ?? null,
          createdAt: (c.createdAt as string) ?? new Date().toISOString(),
          updatedAt: (c.updatedAt as string) ?? undefined,
        };
        setCurrentMetreProject(newProject);
        // If the user already loaded a PDF locally, upload it now
        const hasBuffer = !!useMetreStore.getState().pdfBuffer;
        if (hasBuffer) {
          try {
            await uploadCachedPdfForProject(parseInt(newProject.id, 10));
          } catch {
            // surface the error via SaveMetreModal
            throw new Error(
              'Le métré a été créé mais l’envoi du PDF a échoué. Réessayez avec « Renommer ».',
            );
          }
        }
      } finally {
        suppressAutoUploadRef.current = false;
      }
    },
    [saveMode, currentMetreProject, setCurrentMetreProject, uploadCachedPdfForProject, devisId],
  );

  /** Open a saved métré: load its PDF, then hydrate measurements/layers
   *  via the store's loadDocumentData (already runs on setDocument when
   *  doc.id is numeric).
   *
   *  Arms `suppressAutoUploadRef` for the entire flow because we transiently
   *  put the document in a fake-id + buffer-set state (when window.__metrePdfLoad
   *  runs) — without suppression, the subscribe effect would see this as
   *  "user picked a new PDF" and POST it, creating a duplicate document. */
  const handleOpenMetre = useCallback(
    async (entry: MetreLibraryEntry) => {
      suppressAutoUploadRef.current = true;
      try {
        // Close current métré first to wipe state cleanly
        const state = useMetreStore.getState();
        state.setDocument(null);

        // Set the project as current
        setCurrentMetreProject({
          id: String(entry.id),
          name: entry.name,
          description: entry.description ?? '',
          companyId: '',
          devisId: entry.devisId ?? null,
          createdAt: entry.createdAt ?? new Date().toISOString(),
          updatedAt: entry.updatedAt ?? undefined,
        });

        if (!entry.primaryDocumentId) {
          // Métré exists but no PDF uploaded yet — let the user load one and
          // PDFViewer will auto-upload via the active-project flow.
          return;
        }

        // Fetch the raw PDF and inject it via the global PDF loader exposed
        // by PDFViewer. We deliberately use the same code path as the file
        // picker so cache + remount logic stays identical.
        let buffer: ArrayBuffer;
        try {
          buffer = await metreApi.getDocumentFile(entry.primaryDocumentId);
        } catch (fetchErr: unknown) {
          // Most likely 404 (PDF orphaned/missing on disk). Revert the
          // partial state so the user isn't stranded with a project but
          // no document.
          useMetreStore.getState().closeMetreProject();
          const status = (fetchErr as { response?: { status?: number } })?.response?.status;
          if (status === 404) {
            throw new Error(
              'Le PDF de ce métré est introuvable sur le serveur. Le métré a peut-être été corrompu — supprimez-le ou recréez-le.',
            );
          }
          throw fetchErr;
        }
        const loader = (window as unknown as {
          __metrePdfLoad?: (src: ArrayBuffer | string) => Promise<void>;
        }).__metrePdfLoad;
        if (!loader) {
          // PDFViewer hasn't mounted yet (e.g. user opened the library modal
          // before the canvas finished initialising). Revert and ask retry.
          useMetreStore.getState().closeMetreProject();
          throw new Error(
            'Le visualiseur de PDF n’est pas encore prêt. Patientez un instant puis réessayez.',
          );
        }
        await loader(buffer);
        // Now that the doc is loaded with a fake id, swap to the real one
        // so loadDocumentData can hydrate measurements/layers/calibration.
        useMetreStore.setState((s) => ({
          document: s.document
            ? {
                ...s.document,
                id: String(entry.primaryDocumentId),
                projectId: String(entry.id),
                filename: entry.primaryDocumentOriginalFilename
                  ?? s.document.filename,
                pageCount: entry.primaryDocumentPageCount ?? s.document.pageCount,
              }
            : null,
        }));
        await useMetreStore.getState().loadDocumentData(
          String(entry.primaryDocumentId),
          1,
        );
      } catch (err) {
        console.error('[MetrePdf] handleOpenMetre failed:', err);
        throw err;
      } finally {
        suppressAutoUploadRef.current = false;
      }
    },
    [setCurrentMetreProject],
  );

  /** Watch for a PDF being loaded into the store while a métré is active
   *  but has no backend document yet — auto-upload it.
   *
   *  PDFViewer.loadPDF emits TWO store notifications: setDocument (which
   *  wipes pdfBuffer) then setPdfBuffer. The earlier `doc.id === prev?.id`
   *  guard caused the second notification to bail (id unchanged) and the
   *  first to bail (`!buffer` after the wipe), so the upload never fired
   *  and downstream pushes silently no-op'd via _hasPersistedDocument().
   *
   *  Now we react to ANY notification while both conditions are true; the
   *  uploadingForProjectIdRef inside uploadCachedPdfForProject dedupes
   *  concurrent calls. Skipped when `suppressAutoUploadRef.current` is true
   *  (handleOpenMetre / handleSaveConfirm drive the lifecycle themselves). */
  useEffect(() => {
    if (!currentMetreProject) return;
    const projectIdNum = parseInt(currentMetreProject.id, 10);
    if (!Number.isFinite(projectIdNum)) return;

    return useMetreStore.subscribe((state) => {
      if (suppressAutoUploadRef.current) return;
      const doc = state.document;
      if (!doc) return;
      // Skip if doc already has a real backend id (numeric).
      if (/^\d+$/.test(String(doc.id))) return;
      const buffer = state.pdfBuffer;
      if (!buffer) return;
      void uploadCachedPdfForProject(projectIdNum).catch((err) => {
        console.error('[MetrePdf] auto-upload after PDF pick failed:', err);
      });
    });
  }, [currentMetreProject, uploadCachedPdfForProject]);

  /** Convert current measurements + products into devis line items.
   *
   *  Three consolidation modes (`mode` param):
   *    - `detailed`               : one line per measurement (legacy behavior)
   *    - `by-product-and-layer`   : aggregate by (product, layer) — preserves layer organisation
   *    - `by-product`             : aggregate by product only — max consolidation, matches PDF "Résumé par produit"
   *
   *  Composite products are expanded:
   *    - `detailed` displayMode  : N child lines per measurement (consolidated by childProductId in non-detailed modes)
   *    - `summary` displayMode   : 1 aggregated parent line (consolidated by compositeId in non-detailed modes)
   *
   *  When consolidating, the unit price is computed as weighted average
   *  (Σ qty·price / Σ qty) so the line total remains exact even when source
   *  prices diverge (e.g. composites with priceOverride scaling). Lines with
   *  mismatched unit codes are kept separate.
   */
  const generateSoumissionItems = useCallback((mode: SoumissionConsolidationMode = 'detailed'): SoumissionItem[] => {
    const { measurements, products, layers, laborTrades } = useMetreStore.getState();
    const r2 = (n: number) => Math.round(n * 100) / 100;

    // Working list + parallel Map for O(1) lookup when consolidating.
    // Each entry tracks raw qty (pre-r2) so weighted averages stay accurate
    // across multiple additions.
    type WorkingItem = {
      description: string;
      quantite: number;            // raw, not rounded
      unite: string;
      prixUnitaire: number;        // raw weighted-average, not rounded
      categorie: string;
    };
    const working: WorkingItem[] = [];
    const consolidationIndex = new Map<string, number>();

    const pushOrMerge = (
      productKey: string,
      productCategory: string,
      layerCategory: string,
      consolidatedDescription: string,
      detailedDescription: string,
      quantite: number,
      unite: string,
      prixUnitaire: number,
    ) => {
      // Guard against NaN/Infinity which would silently corrupt every later
      // merge under the same key (weighted average becomes NaN forever). A
      // single bad measurement should at most lose its own line, never poison
      // the consolidation bucket. We accept negative quantities (legacy allowed
      // them for hand-tuned deductions) but reject non-finite values entirely.
      if (!Number.isFinite(quantite) || !Number.isFinite(prixUnitaire)) {
        return;
      }
      if (mode === 'detailed') {
        working.push({
          description: detailedDescription,
          quantite,
          unite,
          prixUnitaire,
          categorie: layerCategory,
        });
        return;
      }
      // Separator: NUL () is forbidden in product/layer names and is
      // never present in real data, so `${a}${b}` cannot collide with
      // any other (a, b) pair even when names contain pipes, slashes, etc.
      // Include the unit so we never fuse pi² with pi³ silently.
      const SEP = '';
      const key = mode === 'by-product-and-layer'
        ? `${productKey}${SEP}${layerCategory}${SEP}${unite}`
        : `${productKey}${SEP}${unite}`;
      const categorie = mode === 'by-product' ? productCategory : layerCategory;
      const existingIdx = consolidationIndex.get(key);
      if (existingIdx !== undefined) {
        const e = working[existingIdx];
        const totalQty = e.quantite + quantite;
        if (totalQty > 0) {
          // Weighted average — preserves Σ(qty·price) = Σ(montants), so the
          // consolidated total exactly matches the sum of detailed lines.
          e.prixUnitaire = (e.quantite * e.prixUnitaire + quantite * prixUnitaire) / totalQty;
        }
        // Note: if totalQty <= 0 we keep the previous prixUnitaire (no useful
        // weighted average possible) but still accumulate the quantity so the
        // line stays mathematically consistent with the source data.
        e.quantite = totalQty;
      } else {
        consolidationIndex.set(key, working.length);
        working.push({
          description: consolidatedDescription,
          quantite,
          unite,
          prixUnitaire,
          categorie,
        });
      }
    };

    // Pre-compute index maps so the per-measurement loop is O(M) instead of
    // O(M·P)/O(M·L). On tenants with thousands of products (MARIO catalog)
    // and hundreds of measurements this drops generation time from seconds
    // to milliseconds.
    const productById = new Map(products.map(p => [p.id, p]));
    const layerById = new Map(layers.map(l => [l.id, l]));
    const tradeById = new Map(laborTrades.map(t => [t.id, t]));

    // Pre-compute total deduction quantity per parent measurement. Deductions
    // are stored as separate measurements (m.isDeduction === true) linked back
    // via parentMeasurementId; the sum is subtracted from the parent gross
    // quantity so the soumission reflects the NET surface/length (matches the
    // PDF, Summary panel, and Right panel which all use getNetValue).
    const deductionsByParent = new Map<string, number>();
    for (const m of measurements) {
      if (m.isDeduction && m.parentMeasurementId) {
        const v = m.quantity ?? m.value;
        if (Number.isFinite(v)) {
          deductionsByParent.set(
            m.parentMeasurementId,
            (deductionsByParent.get(m.parentMeasurementId) ?? 0) + v,
          );
        }
      }
    }

    // Aggregate labor hours per trade across two MUTUALLY EXCLUSIVE sources:
    //   A. measurement-level override (m.laborTradeId / m.laborHours / m.laborPersons)
    //      — wins when present: the user has taken manual control of this measurement.
    //   B. composite product BOM default (product.laborTradeId × nbHommes × nbHrsParJour × nbJours)
    //      — used only when no per-measurement override exists.
    // Multiple measurements pointing to the same trade via per-measurement
    // override (source A) DO accumulate (e.g. 3 charpentier measurements at
    // 4h each → 12h). However, the composite-default labor (source B) is
    // applied AT MOST ONCE per composite product across all its measurements:
    // `nbHommes × nbHrsParJour × nbJours` represents the total assembly cost
    // of the composite, not a per-measurement multiplier. Without this dedup,
    // 3 measurements of the same composite would triple the labor line.
    const laborByTrade = new Map<string, number>();
    const compositeDefaultLaborApplied = new Set<string>();
    const addLaborHours = (tradeId: string | null | undefined, hours: number) => {
      if (!tradeId || !Number.isFinite(hours) || hours <= 0) return;
      laborByTrade.set(tradeId, (laborByTrade.get(tradeId) ?? 0) + hours);
    };

    for (const m of measurements) {
      if (!m.productId) continue;
      if (m.isDeduction) continue;
      const product = productById.get(m.productId);
      if (!product) continue;

      const layer = m.layer ? layerById.get(m.layer) : undefined;
      const layerCategory = layer?.name || product.category || 'General';
      // Net quantity = gross − Σ(child deductions); clamp at 0 to avoid
      // sending negative quantities downstream when over-deducted by mistake.
      const grossValue = m.quantity ?? m.value;
      // Skip measurements with non-finite values BEFORE running labor logic —
      // otherwise the composite labor default (source B) would be applied for
      // a measurement whose materials are silently dropped by pushOrMerge,
      // producing labor hours with no matching matériaux.
      if (!Number.isFinite(grossValue)) continue;
      const deducted = deductionsByParent.get(m.id) ?? 0;
      const netValue = Math.max(0, grossValue - deducted);
      const parentQty = netValue * (m.slopeFactor ?? 1);
      const label = m.label || product.name;

      // ── Labor source A — per-measurement override ──
      // Use != null tests so `laborHours = 0` (user intentionally zeroing the
      // labor on this measurement) is treated as an explicit override and the
      // composite default (source B) does NOT silently take over.
      if (m.laborTradeId && m.laborHours != null) {
        if (m.laborHours > 0) {
          const trade = tradeById.get(m.laborTradeId);
          const persons = m.laborPersons ?? trade?.nbPersons ?? 1;
          addLaborHours(m.laborTradeId, m.laborHours * persons);
        }
        // laborHours === 0 → explicit zero, no labor added, source B skipped.
      }
      // ── Labor source B — composite-product default (applied once per composite) ──
      else if (
        product.isComposite &&
        product.laborTradeId &&
        product.nbHommes &&
        product.nbHrsParJour &&
        product.nbJours &&
        !compositeDefaultLaborApplied.has(product.id)
      ) {
        compositeDefaultLaborApplied.add(product.id);
        addLaborHours(
          product.laborTradeId,
          product.nbHommes * product.nbHrsParJour * product.nbJours,
        );
      }

      // ── Composite product ──────────────────────────────────────
      if (product.isComposite && (product.components?.length ?? 0) > 0) {
        const components = product.components ?? [];
        const displayMode = product.displayMode ?? 'detailed';
        const parentWasteMul = 1 + ((product.wastePct ?? 0) / 100);
        // Effective parent quantity after applying parent waste. This multiplier
        // is applied in BOTH display modes to guarantee total equality (C1 fix).
        const effParentQty = parentQty * parentWasteMul;

        // Compute aggregated unit price from children (sum of child.price * qtyPerUnit * (1 + childWaste))
        const autoUnitPrice = components.reduce((sum, c) => {
          const childWaste = (c.childWastePct ?? 0) / 100;
          const childPrice = c.childPrice ?? 0;
          return sum + childPrice * c.quantityPerUnit * (1 + childWaste);
        }, 0);

        const unitPrice = product.priceOverride != null ? product.priceOverride : autoUnitPrice;

        // Edge case: detailed expansion silently loses priceOverride when all
        // child prices are 0 (autoUnitPrice === 0) AND the user has set a
        // non-zero priceOverride. In that case the detailed lines would sum
        // to 0, contradicting the summary view (which would show priceOverride
        // × qty). To preserve the invariant Σ(detailed) === summary, we
        // collapse this case to a single line. Doc'd as a known limitation.
        const detailedWouldDropOverride =
          autoUnitPrice === 0 &&
          product.priceOverride != null &&
          product.priceOverride !== 0;

        if (displayMode === 'summary' || detailedWouldDropOverride) {
          // Single aggregated line. Total = effParentQty * unitPrice.
          pushOrMerge(
            product.id,
            product.category || 'General',
            layerCategory,
            product.name,
            `${label} (assemblage ${components.length} produits)`,
            effParentQty,
            product.priceUnit || m.unit,
            unitPrice,
          );
        } else {
          // Detailed: one line per child, prefixed with composite label for traceability.
          // `scale` proportionally adjusts each child price so that the sum of
          // detailed lines matches the summary line when priceOverride is active.
          // When priceOverride === 0 explicitly, scale === 0 → all child prices
          // collapse to 0, which is the user-intended "free assembly" semantics.
          const scale = (product.priceOverride != null && autoUnitPrice > 0)
            ? (product.priceOverride / autoUnitPrice)
            : 1;
          for (const c of components) {
            const childWasteMul = 1 + ((c.childWastePct ?? 0) / 100);
            // effParentQty already includes parent wastePct → propagates to children.
            const childQty = effParentQty * c.quantityPerUnit * childWasteMul;
            const childPrice = (c.childPrice ?? 0) * scale;
            const childName = c.childName ?? 'Sous-produit';
            // Consolidation key falls back to childName when childProductId is
            // absent, so two ad-hoc child rows with the same display name still
            // merge sensibly.
            const childKey = c.childProductId ?? `__name__:${childName}`;
            const childProductCategory = (c.childProductId ? productById.get(c.childProductId) : undefined)?.category
              ?? product.category
              ?? 'General';
            pushOrMerge(
              childKey,
              childProductCategory,
              layerCategory,
              childName,
              `${label} › ${childName}`,
              childQty,
              c.childPriceUnit ?? product.priceUnit ?? 'un',
              childPrice,
            );
          }
        }
        continue;
      }

      // ── Simple product (legacy path) ──────────────────────────
      const wastePct = product.wastePct ?? 0;
      const adjustedQty = parentQty * (1 + wastePct / 100);
      // Use the `label` local (already fallback'd to product.name when m.label
      // is empty) instead of m.label directly — prevents "Produit — " trailing
      // when a measurement has no manual label.
      pushOrMerge(
        product.id,
        product.category || 'General',
        layerCategory,
        product.name,
        `${product.name} — ${label}`,
        adjustedQty,
        product.priceUnit || m.unit,
        product.price,
      );
    }

    // Convert working items to final SoumissionItem. Quantity and unit price
    // are rounded to 2 decimals for display; the line total is computed from
    // the RAW values (then rounded once) to match the legacy detailed-mode
    // output exactly and to keep Σ(montants) consistent across modes when
    // the same measurements are consolidated.
    const items: SoumissionItem[] = working.map(w => ({
      description: w.description,
      quantite: r2(w.quantite),
      unite: w.unite,
      prixUnitaire: r2(w.prixUnitaire),
      montantLigne: r2(w.quantite * w.prixUnitaire),
      categorie: w.categorie,
    }));

    // ── Append labor lines (one per trade with non-zero hours) ──
    // Sorted alphabetically by trade name for stable, predictable output —
    // same trade keeps its position across re-generations even if a measurement
    // is edited and re-orders the underlying Map iteration.
    const laborEntries = Array.from(laborByTrade.entries())
      .map(([tradeId, hours]) => {
        const trade = tradeById.get(tradeId);
        return trade ? { trade, hours } : null;
      })
      .filter((e): e is { trade: typeof laborTrades[number]; hours: number } => e !== null)
      .sort((a, b) => a.trade.trade.localeCompare(b.trade.trade, 'fr-CA'));

    for (const { trade, hours } of laborEntries) {
      const qty = r2(hours);
      if (qty <= 0) continue;
      // Skip trades whose hourly rate is 0/missing (volunteer / unset) or
      // corrupted (NaN/Infinity from a bad import) — would otherwise pollute
      // the quote with zero-amount or NaN lines.
      const rate = trade.hourlyRate ?? 0;
      if (!Number.isFinite(rate) || rate <= 0) continue;
      items.push({
        description: `Main-d'œuvre — ${trade.trade}${trade.specialty ? ` (${trade.specialty})` : ''}`,
        quantite: qty,
        unite: 'h',
        prixUnitaire: rate,
        montantLigne: r2(qty * rate),
        categorie: 'Main-d\'œuvre',
      });
    }

    return items;
  }, []);

  // Soumission consolidation mode (persisted per tenant in localStorage so the
  // user's preferred grouping survives reloads and tenant switches). Only
  // applies to the legacy "mesures avec produit associé" pipeline — the BOM
  // pipeline below has its own items shape and is NOT affected by the toggle.
  const [consolidationMode, setConsolidationModeState] = useState<SoumissionConsolidationMode>(() =>
    loadConsolidationMode(),
  );
  // Track which pipeline opened the modal so the consolidation toggle is only
  // wired when re-generating items would be safe (legacy path). For BOM-opened
  // modals, switching modes would silently swap BOM items for legacy items —
  // the toggle must stay hidden.
  const [soumissionSource, setSoumissionSource] = useState<'legacy' | 'bom'>('legacy');
  const handleConsolidationModeChange = useCallback(
    (next: SoumissionConsolidationMode) => {
      setConsolidationModeState(next);
      saveConsolidationMode(next);
      // Live preview: re-generate items so the modal updates without re-open.
      setSoumissionItems(generateSoumissionItems(next));
    },
    [generateSoumissionItems],
  );

  const handleOpenSoumission = useCallback(() => {
    setSoumissionSource('legacy');
    const items = generateSoumissionItems(consolidationMode);
    setSoumissionItems(items);
    setShowSoumission(true);
  }, [generateSoumissionItems, consolidationMode]);

  /**
   * Generate soumission items from BOM composites (P3.4).
   *
   * Difference from `handleOpenSoumission` (legacy):
   *   - Legacy: lit `measurement.product_id` direct -> 1 ligne par mesure.
   *   - BOM: pour chaque calque lié à un composite, génère N lignes (1 par
   *     child product) avec quantité = formule évaluée. Mode "détaillé"
   *     équivalent au bordereau live (BomEstimationPanel).
   *
   * Composites actifs :
   *   1. Tous les composites liés explicitement à au moins un calque (compositeId)
   *   2. Plus auto-sélection : composites dont au moins 1 input bomInputs
   *      correspond à un label de mesure tracée (fallback large pour ne pas
   *      manquer les composites sans calque lié)
   *
   * Note: ne génère PAS les lignes labor (la version legacy le fait, mais
   * dans le contexte BOM le travail est encore en évolution -- les composites
   * peuvent avoir labor_trade_id / nb_hommes / nb_jours mais l'expansion
   * cohérente avec les calques P3.4 reste à concevoir).
   */
  const [isGeneratingSoumissionBom, setIsGeneratingSoumissionBom] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleOpenSoumissionBom = useCallback(async () => {
    // Anti-double-click : si déjà en cours, ignore (Round 5 QA fix M2)
    if (isGeneratingSoumissionBom) return;
    // Mark this modal as BOM-sourced so the consolidation toggle (which would
    // re-run the LEGACY generateSoumissionItems) is hidden. Otherwise the
    // user could click a mode and silently swap BOM items for legacy items.
    setSoumissionSource('bom');
    setIsGeneratingSoumissionBom(true);
    try {
      const { measurements, products, layers, laborTrades } = useMetreStore.getState();
      const composites = products.filter((p) => p.isComposite);

      // Phase 1 — Pre-sélection large (sans components chargés) :
      // identifie les CANDIDATS pour le fetch. Utilise autoSelectActiveComposites
      // avec componentsByBom vide -> fallback bomInputs (broader match).
      const candidateIds = autoSelectActiveComposites(
        composites,
        layers,
        measurements,
        new Map(), // pas encore de components chargés
      );

      if (candidateIds.size === 0) {
        // Aucun candidat : ouvrir la modal vide.
        setSoumissionItems([]);
        setShowSoumission(true);
        return;
      }

      // Phase 2 — Fetch components des candidats (parallèle).
      // Cast via unknown comme BomEstimationPanel pour appliquer la coercion
      // Number() défensive sur quantityPerUnit (V12) — sinon DECIMAL/NUMERIC
      // string du backend pollue Number.isFinite() check downstream.
      const componentsByBom = new Map<string, ProductComponent[]>();
      const fetches = Array.from(candidateIds).map(async (id) => {
        try {
          const raw = await metreApi.listProductComponents(id);
          const components: ProductComponent[] = (
            raw as unknown as Record<string, unknown>[]
          ).map(mapServerComponent);
          componentsByBom.set(id, components);
        } catch (err) {
          console.warn(`[handleOpenSoumissionBom] Failed to load components for ${id}`, err);
        }
      });
      await Promise.all(fetches);

      // Phase 3 — Re-sélection PRÉCISE (avec components chargés) :
      // matche sur variables réellement utilisées dans les formules
      // (extractVariables) plutôt que sur bom_inputs (qui déclare souvent
      // 16 variables alors que les formules n'en utilisent que 2-4).
      // Aligne le comportement avec BomEstimationPanel.autoSelectedIds
      // (Round 5 QA fix C1).
      const activeIds = autoSelectActiveComposites(
        composites,
        layers,
        measurements,
        componentsByBom,
      );

      if (activeIds.size === 0) {
        setSoumissionItems([]);
        setShowSoumission(true);
        return;
      }

      // Phase 4 — Calcule les sections BOM (logique partagée avec le panel)
      const laborTradeById = new Map<string, typeof laborTrades[number]>();
      for (const t of laborTrades) laborTradeById.set(t.id, t);

      const { sections } = computeBomSectionsForState({
        composites,
        selectedIds: activeIds,
        componentsByBom,
        layers,
        measurements,
        manualInputs: {},
        laborTradeById,
      });

      // Phase 5 — Map sections -> SoumissionItem[]
      const childPriceById = new Map<string, number>();
      for (const product of products) {
        childPriceById.set(product.id, product.price ?? 0);
      }

      // Lookup bom.name parent par bomId (strippe le suffixe `:layerId` P3.4)
      // pour consolider toutes les sections d'un meme composite sous une
      // seule categorie dans la modal soumission (Round 6 QA fix M1).
      const compositeNameById = new Map<string, string>();
      for (const bom of composites) compositeNameById.set(bom.id, bom.name);

      const r2 = (n: number) => Math.round(n * 100) / 100;
      const items: SoumissionItem[] = [];
      for (const section of sections) {
        const parentBomId = section.bomId.split(':')[0];
        const parentBomName = compositeNameById.get(parentBomId) ?? section.bomName;
        for (const line of section.lines) {
          const childPrice = childPriceById.get(line.childProductId) ?? 0;
          // Filtre qty négatives ou non-finies (Round 5 QA fix qty negative).
          // Conserve qty = 0 pour visibilité (utilisateur voit la ligne mais
          // sait qu'aucune mesure ne l'a alimentée).
          if (!(Number.isFinite(line.quantity) && line.quantity >= 0)) continue;
          // Arrondi par unité : unité entière 'un' -> ceil (convention
          // construction : 1 boite, pas 0.43 boite). Autres -> 2 décimales.
          // (Round 6 QA fix M2)
          const rawQty = line.quantity;
          const qty =
            line.childPriceUnit === 'un' ? Math.ceil(rawQty) : r2(rawQty);
          // Signal visuel pour produits sans prix configuré (Round 6 QA suggestion)
          const priceFlag = childPrice === 0 ? ' [prix manquant]' : '';
          items.push({
            description: `${section.bomName} › ${line.childName}${priceFlag}`,
            quantite: qty,
            unite: line.childPriceUnit,
            prixUnitaire: r2(childPrice),
            montantLigne: r2(qty * childPrice),
            categorie: parentBomName,
          });
        }
      }

      setSoumissionItems(items);
      setShowSoumission(true);
    } finally {
      // Mounted guard : ne pas setState si composant démonté pendant l'async
      // (Round 6 QA fix robustesse — évite warning React 18)
      if (isMountedRef.current) {
        setIsGeneratingSoumissionBom(false);
      }
    }
  }, [isGeneratingSoumissionBom]);

  // Load products from server on mount (ERP mode) or mark as loaded (standalone).
  // Wait for ERP context to be set so isERPMode() returns true and fetchProducts
  // hits the backend instead of seeding from DEFAULT_CATALOG.
  useEffect(() => {
    if (!userSchema || !userId) return;
    if (!productsLoaded) {
      fetchProducts();
    }
  }, [userSchema, userId, productsLoaded, fetchProducts]);

  return (
    <div className="metre-pdf-root" style={{ height }}>
      <div id="metre-app-root" className="flex flex-col w-full h-full bg-metre-bg no-select">
        {/* Saved métré bar — primary persistence UX */}
        <MetreSavedBar
          onNew={handleNewMetre}
          onOpen={handleOpenLibrary}
          onRename={handleRenameMetre}
          onClose={handleCloseMetre}
        />
        {/* Connected devis banner */}
        {devisId && devisNom && (
          <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
              Devis connecte : <strong>{devisNom}</strong> — les items du métré seront ajoutés à ce devis
            </span>
          </div>
        )}
        {!devisId && (
          <div className="px-4 pt-3">
            <ClientInfoCard
              clientForm={clientForm}
              onChange={setClientForm}
              companies={companies}
              contacts={contacts}
              defaultOpen={false}
            />
          </div>
        )}
        {/* Top toolbar */}
        <TopToolbar
          onGenerateSoumission={handleOpenSoumission}
          onGenerateSoumissionBom={handleOpenSoumissionBom}
          isGeneratingSoumissionBom={isGeneratingSoumissionBom}
        />

        {/* Main area: left panel + viewer + right panel */}
        <div className="flex flex-1 overflow-hidden">
          {showLeftPanel && (
            <ErrorBoundary>
              <LeftPanel />
            </ErrorBoundary>
          )}

          {/* Center viewer area */}
          <div className="flex-1 relative flex flex-col">
            {/* PDF + Measurement canvas stacked */}
            <ErrorBoundary>
              <div className="flex-1 relative overflow-hidden bg-metre-canvas">
                <PDFViewer />
                <MeasurementCanvas />
                <ZoomControls />
              </div>
            </ErrorBoundary>

            {/* Page navigator below viewer */}
            <PageNavigator />
          </div>

          {showRightPanel && (
            <ErrorBoundary>
              <RightPanel />
            </ErrorBoundary>
          )}

          {showBomEstimation && (
            <ErrorBoundary>
              <Suspense
                fallback={
                  <div className="w-[420px] flex items-center justify-center text-xs text-metre-muted">
                    Chargement...
                  </div>
                }
              >
                <BomEstimationPanel onClose={() => setShowBomEstimation(false)} />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>

        {/* Floating toggle for BOM live estimation */}
        <button
          type="button"
          onClick={() => setShowBomEstimation((v) => !v)}
          className={`fixed right-4 bottom-16 z-30 px-3 py-2 rounded-full shadow-lg text-xs font-semibold transition-colors ${
            showBomEstimation
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-metre-surface text-metre-text border border-metre-border hover:bg-metre-panel'
          }`}
          title="Afficher / masquer le bordereau quantitatif BOM en direct"
        >
          BOM live
        </button>

        {/* Bottom status bar */}
        <BottomBar />

        {/* Calibration modal + lazy-loaded panels */}
        <ErrorBoundary>
          <CalibrationModal />
          <Suspense fallback={null}>
            {showCatalog && <ProductCatalog />}
            {showSummary && <SummaryPanel />}
            {showCalculator && <CalculatorPanel />}
            {showSlopeConverter && <SlopeConverterPanel />}
            {showLaborCatalog && <LaborCatalogPanel />}
            {showSymbolCatalog && <SymbolCatalogPanel />}
            {showSoumission && (
              <SoumissionModal
                open={showSoumission}
                onClose={() => setShowSoumission(false)}
                items={soumissionItems}
                devisId={devisId}
                initialClientInfo={!devisId ? clientForm : undefined}
                // Consolidation toggle is ONLY wired for the legacy pipeline.
                // The BOM pipeline (handleOpenSoumissionBom) produces items
                // through a different code path; exposing the toggle there
                // would let a click re-run generateSoumissionItems and silently
                // overwrite the BOM items with legacy ones.
                consolidationMode={soumissionSource === 'legacy' ? consolidationMode : undefined}
                onConsolidationModeChange={soumissionSource === 'legacy' ? handleConsolidationModeChange : undefined}
                onApplyToDevis={onApplyToDevis ? (items, info) => {
                  onApplyToDevis(items, info);
                  setShowSoumission(false);
                } : undefined}
                onCreateDevis={onCreateDevis ? (items, info) => {
                  onCreateDevis(items, info);
                  setShowSoumission(false);
                } : undefined}
              />
            )}
            {showLibraryModal && (
              <MetreLibraryModal
                open={showLibraryModal}
                onClose={() => setShowLibraryModal(false)}
                onOpen={handleOpenMetre}
              />
            )}
            {showSaveModal && (
              <SaveMetreModal
                open={showSaveModal}
                onClose={() => setShowSaveModal(false)}
                title={saveMode === 'rename' ? 'Renommer le métré' : 'Nouveau métré'}
                confirmLabel={saveMode === 'rename' ? 'Enregistrer' : 'Créer'}
                initialName={saveMode === 'rename' ? currentMetreProject?.name ?? '' : ''}
                initialDescription={
                  saveMode === 'rename' ? currentMetreProject?.description ?? '' : ''
                }
                onConfirm={handleSaveConfirm}
              />
            )}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
