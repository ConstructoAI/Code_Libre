/**
 * Mobile React Frontend - Documents Hub Page
 * Entry point for 4 document types: Devis, Factures, BT, BC.
 * Shows stats cards per type, inspired by GestionPro.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Receipt,
  ClipboardList,
  ShoppingCart,
  ChevronRight,
  ArrowLeft,
  ScanLine,
} from 'lucide-react';
import { useDocumentsStore } from '@/store/useDocumentsStore';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import ReceiptScannerModal from '@/components/ReceiptScannerModal';

import type { DocType, DocumentStats } from '@/types';

interface DocTypeConfig {
  type: DocType;
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
}

const DOC_TYPES: DocTypeConfig[] = [
  {
    type: 'devis',
    label: 'Devis',
    icon: <FileText className="w-6 h-6" />,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
  },
  {
    type: 'factures',
    label: 'Factures',
    icon: <Receipt className="w-6 h-6" />,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
  },
  {
    type: 'bons-travail',
    label: 'Bons de travail',
    icon: <ClipboardList className="w-6 h-6" />,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
  },
  {
    type: 'bons-commande',
    label: 'Bons de commande',
    icon: <ShoppingCart className="w-6 h-6" />,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
  },
];

function StatsRow({ stats }: { stats: DocumentStats }) {
  const items = [
    { label: 'Total', value: stats.total, cls: 'bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white' },
    { label: 'Brouillon', value: stats.brouillon, cls: 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
    { label: 'En cours', value: (stats.enAttente || 0) + (stats.envoye || 0) + (stats.enCours || 0), cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' },
    { label: 'Terminé', value: (stats.accepte || 0) + (stats.termine || 0) + (stats.paye || 0), cls: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' },
  ];

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {items.map((item) => (
        <div key={item.label} className={`rounded-lg px-2 py-1.5 text-center ${item.cls}`}>
          <p className="text-[10px] font-medium opacity-70">{item.label}</p>
          <p className="text-lg font-bold">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export default function DocumentsHubPage() {
  const navigate = useNavigate();
  const { allStats, isLoading, error, fetchAllStats, clearError } = useDocumentsStore();
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    fetchAllStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-4 py-5 space-y-4 pb-24 relative">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Documents</h1>
      </div>

      {error && (
        <Alert type="error" onDismiss={clearError}>
          {error}
        </Alert>
      )}

      {isLoading && !allStats ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-3">
          {DOC_TYPES.map((config) => {
            const stats = allStats?.[config.type];
            return (
              <button
                key={config.type}
                onClick={() => navigate(`/documents/${config.type}`)}
                className={`w-full bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border ${config.borderColor} p-4 text-left active:scale-[0.98] transition-transform`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${config.bgColor} flex items-center justify-center ${config.color}`}>
                      {config.icon}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">{config.label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {stats ? `${stats.total} document${stats.total !== 1 ? 's' : ''}` : '--'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>

                {stats && stats.total > 0 && (
                  <StatsRow stats={stats} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* FAB Scanner recu (Phase 4A) */}
      <button
        type="button"
        onClick={() => setScannerOpen(true)}
        aria-label="Scanner un recu"
        className="fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 px-5 py-3.5 text-white font-semibold shadow-lg active:scale-95 transition-transform min-h-[56px]"
      >
        <ScanLine className="h-5 w-5" />
        <span className="text-sm">Scanner un recu</span>
      </button>

      <ReceiptScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onCreated={(bcId) => {
          // Refresh stats apres creation et naviguer vers le BC
          fetchAllStats();
          setTimeout(() => {
            navigate(`/documents/bons-commande/${bcId}`);
          }, 1500);
        }}
      />
    </div>
  );
}
