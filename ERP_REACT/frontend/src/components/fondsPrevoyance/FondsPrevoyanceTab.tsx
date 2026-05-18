/**
 * Fonds de Prevoyance (Loi 16) - Parent component
 *
 * Shared copropriete selector + 7 sub-tabs for all FP features.
 * Loaded as a tab inside ImmobilierPage.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Building2, Shield, Layers, FileSearch, Wrench, TrendingUp,
  FileCheck, Sparkles,
} from 'lucide-react';
import * as fpApi from '@/api/fondsPrevoyance';
import type { Copropriete, FpReferenceData } from '@/api/fondsPrevoyance';
import { Select } from '@/components/ui/Select';
import CoproprietesTab from './CoproprietesTab';
import ComposantesTab from './ComposantesTab';
import EtudesTab from './EtudesTab';
import CarnetEntretienTab from './CarnetEntretienTab';
import ProjectionsTab from './ProjectionsTab';
import AttestationsTab from './AttestationsTab';
import ConseilsIaTab from './ConseilsIaTab';

type FpSubTab =
  | 'coproprietes'
  | 'composantes'
  | 'etudes'
  | 'carnet'
  | 'projections'
  | 'attestations'
  | 'ia';

const SUB_TABS: { key: FpSubTab; label: string; icon: React.ReactNode; requiresCopro: boolean }[] = [
  { key: 'coproprietes', label: 'Copropriétés', icon: <Building2 size={16} />, requiresCopro: false },
  { key: 'composantes', label: 'Composantes', icon: <Layers size={16} />, requiresCopro: true },
  { key: 'etudes', label: 'Études', icon: <FileSearch size={16} />, requiresCopro: true },
  { key: 'carnet', label: "Carnet d'entretien", icon: <Wrench size={16} />, requiresCopro: true },
  { key: 'projections', label: 'Projections', icon: <TrendingUp size={16} />, requiresCopro: true },
  { key: 'attestations', label: 'Attestations', icon: <FileCheck size={16} />, requiresCopro: true },
  { key: 'ia', label: 'Conseils IA', icon: <Sparkles size={16} />, requiresCopro: false },
];

export default function FondsPrevoyanceTab() {
  const [subTab, setSubTab] = useState<FpSubTab>('coproprietes');
  const [coproprietes, setCoproprietes] = useState<Copropriete[]>([]);
  const [selectedCoproId, setSelectedCoproId] = useState<number | null>(null);
  const [reference, setReference] = useState<FpReferenceData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCoproprietes = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await fpApi.listCoproprietes({ per_page: 100 });
      setCoproprietes(items);
      if (items.length > 0 && selectedCoproId === null) {
        setSelectedCoproId(items[0].id);
      } else if (items.length === 0) {
        setSelectedCoproId(null);
      } else if (selectedCoproId && !items.some((c) => c.id === selectedCoproId)) {
        setSelectedCoproId(items[0].id);
      }
    } catch {
      /* handled by interceptor */
    } finally {
      setLoading(false);
    }
  }, [selectedCoproId]);

  useEffect(() => {
    fpApi.getReferenceData().then(setReference).catch(() => {});
    loadCoproprietes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTab = SUB_TABS.find((t) => t.key === subTab)!;
  const selectedCopro = coproprietes.find((c) => c.id === selectedCoproId) || null;

  return (
    <div className="space-y-4">
      {/* Header: banner */}
      <div className="rounded-xl bg-[#7BAFD4]/10 dark:bg-[#7BAFD4]/20 border border-[#7BAFD4]/30 dark:border-[#7BAFD4]/40 p-4 flex items-center gap-3">
        <Shield size={22} className="text-[#4A7FA8] dark:text-[#9BC8E4]" />
        <div>
          <div className="font-semibold text-gray-900 dark:text-white">
            Fonds de Prévoyance (Loi 16 du Québec)
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
            Étude obligatoire tous les 5 ans · Carnet d'entretien obligatoire · Période minimale 25 ans
          </div>
        </div>
      </div>

      {/* Sub-tabs navigation */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 scrollbar-none">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              subTab === tab.key
                ? 'border-[#4A7FA8] text-[#4A7FA8] dark:border-[#9BC8E4] dark:text-[#9BC8E4] font-medium'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Copropriete selector (visible for tabs that need one) */}
      {activeTab.requiresCopro && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-700 dark:text-gray-300 font-medium">Copropriété :</label>
          <div className="min-w-[280px]">
            <Select
              value={selectedCoproId?.toString() || ''}
              onChange={(e) => setSelectedCoproId(Number(e.target.value) || null)}
              options={[
                { value: '', label: '-- Sélectionnez une copropriété --' },
                ...coproprietes.map((c) => ({
                  value: c.id.toString(),
                  label: c.nom_copropriete,
                })),
              ]}
            />
          </div>
          {selectedCopro && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {selectedCopro.adresse_complete}
              {selectedCopro.nombre_unites ? ` · ${selectedCopro.nombre_unites} unités` : ''}
            </div>
          )}
        </div>
      )}

      {/* Tab content */}
      <div>
        {subTab === 'coproprietes' && (
          <CoproprietesTab
            coproprietes={coproprietes}
            reference={reference}
            loading={loading}
            onChanged={loadCoproprietes}
            onSelect={(id) => setSelectedCoproId(id)}
          />
        )}
        {subTab === 'composantes' && selectedCoproId && reference && (
          <ComposantesTab coproId={selectedCoproId} reference={reference} />
        )}
        {subTab === 'etudes' && selectedCoproId && reference && (
          <EtudesTab coproId={selectedCoproId} reference={reference} />
        )}
        {subTab === 'carnet' && selectedCoproId && reference && (
          <CarnetEntretienTab coproId={selectedCoproId} reference={reference} />
        )}
        {subTab === 'projections' && selectedCoproId && (
          <ProjectionsTab coproId={selectedCoproId} />
        )}
        {subTab === 'attestations' && selectedCoproId && reference && (
          <AttestationsTab coproId={selectedCoproId} reference={reference} />
        )}
        {subTab === 'ia' && (
          <ConseilsIaTab coproId={selectedCoproId} coproprietes={coproprietes} />
        )}
        {activeTab.requiresCopro && !selectedCoproId && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-900/20 p-4 text-amber-800 dark:text-amber-200 text-sm">
            Aucune copropriété disponible. Créez d'abord une copropriété dans l'onglet "Copropriétés".
          </div>
        )}
      </div>
    </div>
  );
}
