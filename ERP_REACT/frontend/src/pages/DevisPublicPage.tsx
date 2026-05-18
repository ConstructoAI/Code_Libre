/**
 * ERP React Frontend - Public Devis Page
 * Accessible without authentication via a token-based URL.
 * Allows client to view, accept (with drawn signature), or refuse a devis/soumission.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  FileText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Printer,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import * as devisApi from '@/api/devis';
import SignatureCanvas from '@/components/devis/SignatureCanvas';

type PageState = 'loading' | 'ready' | 'accepted' | 'refused' | 'error' | 'already_decided';

export default function DevisPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>('loading');
  const [html, setHtml] = useState('');
  const [devisInfo, setDevisInfo] = useState<{
    numero: string;
    titre: string;
    statut: string;
    enterpriseName: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Accept/Refuse form state
  const [showAccept, setShowAccept] = useState(false);
  const [showRefuse, setShowRefuse] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [refuseReason, setRefuseReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Zoom state
  const [zoom, setZoom] = useState(100);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMsg('Lien invalide');
      return;
    }

    devisApi
      .getPublicDevis(token)
      .then((res) => {
        setHtml(res.html);
        setDevisInfo({
          numero: res.devis.numeroDevis,
          titre: res.devis.nomProjet,
          statut: res.devis.statut,
          enterpriseName: res.enterpriseName,
        });
        if (res.devis.statut === 'Accepte' || res.devis.statut === 'Refuse') {
          setState('already_decided');
        } else {
          setState('ready');
        }
      })
      .catch(() => {
        setState('error');
        setErrorMsg("Cette soumission n'est pas disponible ou le lien est invalide.");
      });
  }, [token]);

  // Apply zoom to iframe content
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;
    const applyZoom = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          doc.body.style.transform = `scale(${zoom / 100})`;
          doc.body.style.transformOrigin = 'top left';
          doc.body.style.width = `${10000 / zoom}%`;
        }
      } catch {
        // cross-origin safety
      }
    };
    iframe.addEventListener('load', applyZoom);
    applyZoom();
    return () => iframe.removeEventListener('load', applyZoom);
  }, [zoom, html]);

  const handleAccept = async () => {
    if (!token || !signatureName.trim()) return;
    setActionLoading(true);
    setErrorMsg('');
    try {
      await devisApi.acceptDevis(token, signatureName.trim(), signatureData || undefined);
      setState('accepted');
      setShowAccept(false);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrorMsg(detail || "Erreur lors de l'acceptation de la soumission");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefuse = async () => {
    if (!token) return;
    setActionLoading(true);
    setErrorMsg('');
    try {
      await devisApi.refuseDevis(token, refuseReason.trim() || undefined);
      setState('refused');
      setShowRefuse(false);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrorMsg(detail || 'Erreur lors du refus de la soumission');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrint = useCallback(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.print();
      } catch {
        window.print();
      }
    } else {
      window.print();
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${devisInfo?.numero || 'soumission'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [html, devisInfo]);

  const zoomIn = () => setZoom((z) => Math.min(z + 15, 200));
  const zoomOut = () => setZoom((z) => Math.max(z - 15, 50));
  const zoomReset = () => setZoom(100);

  // ======================== LOADING ========================
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-500">Chargement de la soumission...</p>
        </div>
      </div>
    );
  }

  // ======================== ERROR ========================
  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <AlertTriangle size={48} className="mx-auto mb-4 text-yellow-500" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Soumission non disponible</h1>
          <p className="text-gray-500">{errorMsg}</p>
        </div>
      </div>
    );
  }

  // ======================== ALREADY DECIDED ========================
  if (state === 'already_decided') {
    const isAccepted = devisInfo?.statut === 'Accepte';
    return (
      <div className="min-h-screen bg-gray-50">
        <HeaderBar devisInfo={devisInfo}>
          <div
            className={`px-4 py-2 rounded-full text-sm font-semibold ${
              isAccepted ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {isAccepted ? 'Acceptée' : 'Refusée'}
          </div>
        </HeaderBar>

        <div className="max-w-4xl mx-auto px-6 py-8">
          <div
            className={`p-6 rounded-xl border-2 ${
              isAccepted ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
            }`}
          >
            {isAccepted ? (
              <div className="flex items-center gap-3">
                <CheckCircle size={32} className="text-green-500" />
                <div>
                  <h2 className="text-lg font-bold text-green-800">Soumission acceptée</h2>
                  <p className="text-green-600">Cette soumission a déjà été acceptée. Merci!</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <XCircle size={32} className="text-red-500" />
                <div>
                  <h2 className="text-lg font-bold text-red-800">Soumission refusée</h2>
                  <p className="text-red-600">Cette soumission a été refusée.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {html && (
          <div className="max-w-4xl mx-auto px-6 pb-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <iframe
                srcDoc={html}
                title="Soumission"
                className="w-full bg-white border-0"
                style={{ height: 'calc(100vh - 300px)', minHeight: '500px' }}
                sandbox="allow-same-origin allow-modals"
              />
            </div>
          </div>
        )}
        <Footer />
      </div>
    );
  }

  // ======================== ACCEPTED CONFIRMATION ========================
  if (state === 'accepted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={40} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Soumission acceptée!</h1>
          <p className="text-gray-500 mb-4">
            Merci d&apos;avoir accepté la soumission <strong>{devisInfo?.numero}</strong>.
            L&apos;entrepreneur a été notifié de votre décision.
          </p>
          <p className="text-sm text-gray-400">Signe par: {signatureName}</p>
          {signatureData && (
            <div className="mt-4 inline-block border border-gray-200 rounded-lg p-2 bg-white">
              <img src={signatureData} alt="Signature" className="h-16" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ======================== REFUSED CONFIRMATION ========================
  if (state === 'refused') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
            <XCircle size={40} className="text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Soumission refusée</h1>
          <p className="text-gray-500">
            La soumission <strong>{devisInfo?.numero}</strong> a été refusée. L&apos;entrepreneur a
            été notifié de votre décision.
          </p>
        </div>
      </div>
    );
  }

  // ======================== READY — MAIN VIEW ========================
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header */}
      <HeaderBar devisInfo={devisInfo}>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 shrink-0">
          <button
            onClick={() => {
              setShowRefuse(true);
              setShowAccept(false);
            }}
            className="px-5 py-2.5 rounded-lg border-2 border-red-200 bg-white text-red-600 font-semibold text-sm hover:bg-red-50 transition-colors"
          >
            Refuser
          </button>
          <button
            onClick={() => {
              setShowAccept(true);
              setShowRefuse(false);
              // Reset signature so canvas and state stay in sync on remount
              setSignatureData(null);
            }}
            className="px-5 py-2.5 rounded-lg bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition-colors"
          >
            Accepter la soumission
          </button>
        </div>
      </HeaderBar>

      {/* Error message */}
      {errorMsg && (
        <div className="max-w-4xl mx-auto px-6 pt-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errorMsg}
          </div>
        </div>
      )}

      {/* ===== ACCEPT FORM ===== */}
      {showAccept && (
        <div className="max-w-4xl mx-auto px-6 pt-6">
          <div className="p-6 bg-green-50 border-2 border-green-200 rounded-xl">
            <h3 className="text-lg font-bold text-green-800 mb-3">Accepter la soumission</h3>
            <p className="text-sm text-green-700 mb-4">
              En acceptant cette soumission, vous confirmez votre accord avec les termes et
              conditions presentes. Veuillez signer ci-dessous.
            </p>

            {/* Signature name */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-green-800 mb-1">
                Votre nom complet *
              </label>
              <input
                type="text"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                placeholder="Jean Tremblay"
                className="w-full px-4 py-2.5 rounded-lg border border-green-300 bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
              />
            </div>

            {/* Signature canvas */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-green-800 mb-1">
                Votre signature *
              </label>
              <SignatureCanvas
                onSignatureChange={setSignatureData}
                lineColor="#1a1a2e"
                lineWidth={2.5}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleAccept}
                disabled={!signatureName.trim() || !signatureData || actionLoading}
                className="px-6 py-2.5 rounded-lg bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {actionLoading ? 'En cours...' : "Confirmer l'acceptation"}
              </button>
              <button
                onClick={() => setShowAccept(false)}
                className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== REFUSE FORM ===== */}
      {showRefuse && (
        <div className="max-w-4xl mx-auto px-6 pt-6">
          <div className="p-6 bg-red-50 border-2 border-red-200 rounded-xl">
            <h3 className="text-lg font-bold text-red-800 mb-3">Refuser la soumission</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-red-800 mb-1">
                Raison du refus (optionnel)
              </label>
              <textarea
                value={refuseReason}
                onChange={(e) => setRefuseReason(e.target.value)}
                placeholder="Indiquez la raison de votre refus..."
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-red-300 bg-white focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRefuse}
                disabled={actionLoading}
                className="px-6 py-2.5 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {actionLoading ? 'En cours...' : 'Confirmer le refus'}
              </button>
              <button
                onClick={() => setShowRefuse(false)}
                className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOOLBAR: Zoom + Print + Download ===== */}
      {html && (
        <div className="max-w-4xl mx-auto px-6 pt-6">
          <div className="flex items-center justify-between bg-white border border-gray-200 rounded-t-xl px-4 py-2">
            {/* Zoom controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={zoomOut}
                disabled={zoom <= 50}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                title="Réduire"
              >
                <ZoomOut size={18} className="text-gray-600" />
              </button>
              <span className="text-xs text-gray-500 w-12 text-center font-medium">{zoom}%</span>
              <button
                onClick={zoomIn}
                disabled={zoom >= 200}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                title="Agrandir"
              >
                <ZoomIn size={18} className="text-gray-600" />
              </button>
              <button
                onClick={zoomReset}
                className="p-1.5 rounded hover:bg-gray-100 transition-colors ml-1"
                title="Réinitialiser le zoom"
              >
                <RotateCcw size={16} className="text-gray-500" />
              </button>
            </div>

            {/* Print & Download */}
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Printer size={16} />
                <span className="hidden sm:inline">Imprimer</span>
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Download size={16} />
                <span className="hidden sm:inline">Télécharger</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== HTML Document Viewer ===== */}
      {html && (
        <div className="max-w-4xl mx-auto px-6 pb-8">
          <div className="bg-white rounded-b-xl shadow-sm border border-t-0 border-gray-200 overflow-hidden">
            <iframe
              ref={iframeRef}
              srcDoc={html}
              title="Soumission"
              className="w-full bg-white border-0"
              style={{ height: 'calc(100vh - 280px)', minHeight: '500px' }}
              sandbox="allow-same-origin allow-modals"
            />
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}

// ======================== SUB-COMPONENTS ========================

function HeaderBar({
  devisInfo,
  children,
}: {
  devisInfo: { numero: string; titre: string; enterpriseName: string } | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <FileText size={24} className="text-blue-600 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">
              {devisInfo?.enterpriseName || 'Soumission'}
            </h1>
            <p className="text-sm text-gray-500 truncate">
              {devisInfo?.numero} — {devisInfo?.titre}
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="max-w-4xl mx-auto px-6 pb-8">
      <div className="text-center text-xs text-gray-400 mt-4">
        Propulse par Constructo AI — ERP AI Construction Quebec
      </div>
    </div>
  );
}
