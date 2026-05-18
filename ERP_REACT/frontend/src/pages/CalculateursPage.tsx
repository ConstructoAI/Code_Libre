/**
 * ERP React - Calculateurs Page (refonte complete)
 * 13 calculateurs construction Quebec + sous-calculs + IA Claude Opus 4.6
 * + persistance historique par tenant + ressources + conversions.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3, Building2, Calculator, CheckCircle2, ChevronDown, ChevronRight,
  ChevronUp, DollarSign, Droplets, Flame, Frame, HardHat,
  History as HistoryIcon, Home, Layers, Menu, Minus, Paintbrush, PenTool,
  Plus, Ruler, Send, Sparkles, Trash2, Weight, Wind, Wrench, X, XCircle,
  Zap, ZoomIn, ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { useCalculatorsStore } from '@/store/useCalculatorsStore';
import type { CalculatorHistoryItem } from '@/api/calculators';
import MasterProCalculator from '@/components/calculateurs/MasterProCalculator';
import MursParametriquePanel from '@/components/calculateurs/MursParametriquePanel';

// ============================================
// TYPES
// ============================================

type TabKey = 'dashboard' | 'calculateurs' | 'ia' | 'historique' | 'structural' | 'conversions';
type CalcId =
  | 'concrete' | 'stairs' | 'electrical' | 'roofing' | 'painting'
  | 'plumbing' | 'hvac' | 'welding' | 'bending' | 'metal-weight'
  | 'taxes' | 'charge-tributaire' | 'charge-tributaire-complete'
  | 'master-pro' | 'murs-parametrique';

// ============================================
// METADATA
// ============================================

const CALC_DEFS: { id: CalcId; name: string; icon: JSX.Element; category: string; color: string; description: string }[] = [
  { id: 'master-pro', name: 'Construction Master Pro', icon: <Calculator size={18} />, category: 'Polyvalent', color: 'bg-[#5C6E91]', description: 'Calculatrice universelle pieds-pouces : pitch, rise, run, escaliers, arc, conversions' },
  { id: 'concrete',  name: 'Béton',             icon: <Building2 size={18} />,  category: 'Structure', color: 'bg-[#7BAFD4]',  description: 'Volume, dosage CSA A23.1, armature, cure, excavation' },
  { id: 'stairs',    name: 'Escaliers',         icon: <Layers size={18} />,     category: 'Structure', color: 'bg-[#7BAFD4]',  description: 'Dimensions CCQ 9.8, Blondel, matériaux, garde-corps' },
  { id: 'murs-parametrique', name: 'Murs paramétrique', icon: <Frame size={18} />, category: 'Structure', color: 'bg-[#7BAFD4]', description: 'Charpente murale: montants, jambages, linteaux, ouvertures' },
  { id: 'charge-tributaire-complete', name: 'Analyse structurale', icon: <Ruler size={18} />, category: 'Structure', color: 'bg-[#7BAFD4]', description: 'Poutre/linteau CNBC/CSA O86' },
  { id: 'roofing',   name: 'Toiture',           icon: <Home size={18} />,       category: 'Enveloppe', color: 'bg-[#7DC4A5]',  description: 'Surface, bardeaux, ventilation, solins, gouttières' },
  { id: 'painting',  name: 'Peinture',          icon: <Paintbrush size={18} />, category: 'Enveloppe', color: 'bg-[#7DC4A5]',  description: 'Surface, DFT, point de rosée, dilution' },
  { id: 'electrical',name: 'Électricité',       icon: <Zap size={18} />,        category: 'Mécanique', color: 'bg-[#B09BD8]',  description: 'Calibrage câble CCE, charge résidentielle, éclairage' },
  { id: 'plumbing',  name: 'Plomberie',         icon: <Droplets size={18} />,   category: 'Mécanique', color: 'bg-[#B09BD8]',  description: 'DFU, WSFU, Hazen-Williams, chauffe-eau' },
  { id: 'hvac',      name: 'CVAC',              icon: <Wind size={18} />,       category: 'Mécanique', color: 'bg-[#B09BD8]',  description: 'Charge thermique ASHRAE, conduits, CFM, HRV/ERV' },
  { id: 'welding',   name: 'Soudure',           icon: <Flame size={18} />,      category: 'Métal',     color: 'bg-[#F0B07A]',  description: 'CSA W47.1, heat input, préchauffage, électrodes' },
  { id: 'bending',   name: 'Pliage métal',      icon: <Wrench size={18} />,     category: 'Métal',     color: 'bg-[#F0B07A]',  description: 'Développement, tonnage, springback, rayon min' },
  { id: 'metal-weight', name: 'Poids métal',    icon: <Weight size={18} />,     category: 'Métal',     color: 'bg-[#F0B07A]',  description: 'Poids + 20 matériaux + profilés W/C' },
  { id: 'taxes',     name: 'Taxes Québec',      icon: <DollarSign size={18} />, category: 'Finances',  color: 'bg-[#7DC4B5]',  description: 'TPS 5% + TVQ 9.975%' },
  { id: 'charge-tributaire', name: 'Paie employé', icon: <DollarSign size={18} />, category: 'Finances', color: 'bg-[#7DC4B5]', description: 'Déductions + charges employeur Québec' },
];

const CATEGORIES = [
  { label: 'Polyvalent', color: 'bg-[#5C6E91]', ids: ['master-pro'] as CalcId[] },
  { label: 'Structure',  color: 'bg-[#7BAFD4]', ids: ['concrete', 'stairs', 'murs-parametrique', 'charge-tributaire-complete'] as CalcId[] },
  { label: 'Enveloppe',  color: 'bg-[#7DC4A5]', ids: ['roofing', 'painting'] as CalcId[] },
  { label: 'Mécanique',  color: 'bg-[#B09BD8]', ids: ['electrical', 'plumbing', 'hvac'] as CalcId[] },
  { label: 'Métal',      color: 'bg-[#F0B07A]', ids: ['welding', 'bending', 'metal-weight'] as CalcId[] },
  { label: 'Finances',   color: 'bg-[#7DC4B5]', ids: ['taxes', 'charge-tributaire'] as CalcId[] },
];

function fmt(n: number | undefined | null, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('fr-CA', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

// ============================================
// SHARED COMPONENTS
// ============================================

interface FieldRowProps {
  label: string;
  children: JSX.Element;
}
function FieldRow({ label, children }: FieldRowProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}

interface ResultBoxProps {
  label: string;
  value: string | number;
  unit?: string;
  highlight?: boolean;
}
function ResultBox({ label, value, unit, highlight }: ResultBoxProps) {
  return (
    <div className={`p-3 rounded-lg border ${highlight ? 'bg-[#7BAFD4]/10 border-[#7BAFD4]/30 dark:bg-[#7BAFD4]/10 dark:border-[#7BAFD4]/30' : 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'}`}>
      <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">{label}</div>
      <div className="text-lg font-bold text-gray-900 dark:text-white">
        {typeof value === 'number' ? fmt(value) : value}
        {unit && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, color }: { label: string; value: string | number; icon: JSX.Element; color: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium">{label}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</div>
        </div>
        <div className={`p-3 rounded-lg ${color} text-white`}>{icon}</div>
      </div>
    </Card>
  );
}

function ConformityBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
      ok ? 'bg-[#7DC4A5]/20 text-[#4a9475] dark:bg-[#7DC4A5]/10 dark:text-[#7DC4A5]'
         : 'bg-[#E8919A]/20 text-[#b8616a] dark:bg-[#E8919A]/10 dark:text-[#E8919A]'
    }`}>
      {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {label || (ok ? 'Conforme' : 'Non conforme')}
    </span>
  );
}

// ============================================
// CALCULATOR PANELS
// ============================================

function ConcretePanel() {
  const { concreteResult, concreteDosageResult, concreteRebarResult, concreteCureResult,
    concreteExcavationResult, concreteTalusResult, concreteStairsResult,
    calcConcrete, calcConcreteDosage, calcConcreteRebar, calcConcreteCure,
    calcConcreteExcavation, calcConcreteTalus, calcConcreteStairs, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'volume' | 'dosage' | 'rebar' | 'cure' | 'excavation' | 'talus' | 'escalier'>('volume');
  const [v, setV] = useState({ longueur: 10, largeur: 5, epaisseur: 0.15, pertePct: 10, classeBeton: 'C-2' });
  const [d, setD] = useState({ volumeM3: 5, resistanceMpa: '25MPa' as const });
  const [r, setR] = useState({ longueurM: 10, largeurM: 5, enrobageMm: 50, espacementMm: 300, barreType: '15M' as const, nbLits: 2, pertePct: 10 });
  const [c, setC] = useState({ resistanceFinaleMpa: 25, ageJours: 7, temperatureC: 20, cimentType: 'GU' as const });
  const [e, setE] = useState({ longueurM: 5, largeurM: 4, profondeurM: 2, typeSol: 'terre_ordinaire' as const });
  const [t, setT] = useState({ profondeurM: 3, typeSol: 'sol_meuble' as const });
  const [s, setS] = useState({ hauteurTotaleMm: 2700, largeurM: 1, epaisseurDalleMm: 150, gironCibleMm: 280, hauteurMarcheCibleMm: 175 });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b border-gray-200 dark:border-gray-700 pb-2">
        {[
          ['volume', 'Volume'], ['dosage', 'Dosage CSA'], ['rebar', 'Armature'],
          ['cure', 'Cure ACI 209'], ['excavation', 'Excavation'], ['talus', 'Talus CNESST'], ['escalier', 'Escalier beton'],
        ].map(([key, label]) => (
          <button type="button" key={key} onClick={() => setSub(key as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === key ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {sub === 'volume' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Paramètres volume</h3>
            <div className="space-y-3">
              <FieldRow label="Longueur (m)"><Input type="number" value={v.longueur} onChange={(ev) => setV({ ...v, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Largeur (m)"><Input type="number" value={v.largeur} onChange={(ev) => setV({ ...v, largeur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Epaisseur (m)"><Input type="number" step="0.01" value={v.epaisseur} onChange={(ev) => setV({ ...v, epaisseur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Perte (%)"><Input type="number" value={v.pertePct} onChange={(ev) => setV({ ...v, pertePct: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Classe beton">
                <Select value={v.classeBeton} onChange={(ev) => setV({ ...v, classeBeton: ev.target.value })}
                  options={[{ value: 'C-1', label: 'C-1 (20 MPa intérieur)' }, { value: 'C-2', label: 'C-2 (25 MPa extérieur)' }, { value: 'C-3', label: 'C-3 (30 MPa commercial)' }, { value: 'C-4', label: 'C-4 (32 MPa structural)' }, { value: 'F-1', label: 'F-1 (25 MPa fondations)' }, { value: 'S-1', label: 'S-1 (35 MPa haute rés.)' }, { value: 'S-2', label: 'S-2 (40 MPa très haute)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcConcrete({ longueur: v.longueur, largeur: v.largeur, epaisseur: v.epaisseur, perte_pct: v.pertePct, classe_beton: v.classeBeton })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {concreteResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Volume" value={concreteResult.volumeTotalM3} unit="m3" highlight />
                <ResultBox label="Surface" value={concreteResult.surfaceM2} unit="m2" />
                <ResultBox label="Ciment" value={concreteResult.cimentKg} unit="kg" />
                <ResultBox label="Sable" value={concreteResult.sableKg} unit="kg" />
                <ResultBox label="Gravier" value={concreteResult.gravierKg} unit="kg" />
                <ResultBox label="Eau" value={concreteResult.eauLitres} unit="L" />
                <ResultBox label="Sacs 30kg" value={concreteResult.sacs30Kg} unit="sacs" />
                <ResultBox label="Coffrage" value={concreteResult.feuillesCoffrage4x8} unit="4x8" />
              </div>
            </Card>
          )}
        </div>
      )}

      {sub === 'dosage' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Dosage CSA A23.1</h3>
            <div className="space-y-3">
              <FieldRow label="Volume (m3)"><Input type="number" value={d.volumeM3} onChange={(ev) => setD({ ...d, volumeM3: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Résistance (MPa)">
                <Select value={d.resistanceMpa} onChange={(ev) => setD({ ...d, resistanceMpa: ev.target.value as typeof d.resistanceMpa })}
                  options={[{ value: '15MPa', label: '15 MPa' }, { value: '20MPa', label: '20 MPa' }, { value: '25MPa', label: '25 MPa' }, { value: '30MPa', label: '30 MPa' }, { value: '32MPa', label: '32 MPa' }, { value: '35MPa', label: '35 MPa' }, { value: '40MPa', label: '40 MPa' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcConcreteDosage({ volume_m3: d.volumeM3, resistance_mpa: d.resistanceMpa })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {concreteDosageResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="space-y-2">
                <div className="text-sm">Ratio: <strong>{concreteDosageResult.ratio}</strong></div>
                <div className="text-sm">E/C: <strong>{concreteDosageResult.ecRatio}</strong></div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <ResultBox label="Ciment" value={concreteDosageResult.quantitesTotales.cimentKg} unit="kg" highlight />
                  <ResultBox label="Sable" value={concreteDosageResult.quantitesTotales.sableKg} unit="kg" />
                  <ResultBox label="Gravier" value={concreteDosageResult.quantitesTotales.gravierKg} unit="kg" />
                  <ResultBox label="Eau" value={concreteDosageResult.quantitesTotales.eauLitres} unit="L" />
                  <ResultBox label="Sacs 30kg" value={concreteDosageResult.sacs30Kg} unit="sacs" />
                  <ResultBox label="Sacs 40kg" value={concreteDosageResult.sacs40Kg} unit="sacs" />
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {sub === 'rebar' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Armature CSA G30.18</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Longueur (m)"><Input type="number" value={r.longueurM} onChange={(ev) => setR({ ...r, longueurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Largeur (m)"><Input type="number" value={r.largeurM} onChange={(ev) => setR({ ...r, largeurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Enrobage (mm)"><Input type="number" value={r.enrobageMm} onChange={(ev) => setR({ ...r, enrobageMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Espacement (mm)"><Input type="number" value={r.espacementMm} onChange={(ev) => setR({ ...r, espacementMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Type de barre">
                <Select value={r.barreType} onChange={(ev) => setR({ ...r, barreType: ev.target.value as typeof r.barreType })}
                  options={['10M', '15M', '20M', '25M', '30M', '35M', '45M', '55M'].map(x => ({ value: x, label: x }))} />
              </FieldRow>
              <FieldRow label="Nb lits"><Input type="number" value={r.nbLits} onChange={(ev) => setR({ ...r, nbLits: parseInt(ev.target.value) || 1 })} /></FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcConcreteRebar({ longueur_m: r.longueurM, largeur_m: r.largeurM, enrobage_mm: r.enrobageMm, espacement_mm: r.espacementMm, barre_type: r.barreType, nb_lits: r.nbLits, perte_pct: r.pertePct })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {concreteRebarResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Barres long." value={concreteRebarResult.nbBarresLongitudinales} />
                <ResultBox label="Barres trans." value={concreteRebarResult.nbBarresTransversales} />
                <ResultBox label="Long. totale" value={concreteRebarResult.longueurTotaleM} unit="m" />
                <ResultBox label="Nb 6m standards" value={concreteRebarResult.nbBarresStandard6m} />
                <ResultBox label="Masse totale" value={concreteRebarResult.masseTotaleKg} unit="kg" highlight />
                <ResultBox label="Masse totale" value={concreteRebarResult.masseTotaleLb} unit="lb" />
              </div>
            </Card>
          )}
        </div>
      )}

      {sub === 'cure' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Cure et résistance (ACI 209)</h3>
            <div className="space-y-3">
              <FieldRow label="Résistance finale (MPa)"><Input type="number" value={c.resistanceFinaleMpa} onChange={(ev) => setC({ ...c, resistanceFinaleMpa: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Age (jours)"><Input type="number" value={c.ageJours} onChange={(ev) => setC({ ...c, ageJours: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Temperature (C)"><Input type="number" value={c.temperatureC} onChange={(ev) => setC({ ...c, temperatureC: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Type ciment">
                <Select value={c.cimentType} onChange={(ev) => setC({ ...c, cimentType: ev.target.value as typeof c.cimentType })}
                  options={[{ value: 'GU', label: 'GU/I - Usage general' }, { value: 'HE', label: 'HE/III - Haute resistance initiale' }, { value: 'MS', label: 'MS/II - Sulfate modere' }, { value: 'HS', label: 'HS/V - Sulfate eleve' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcConcreteCure({ resistance_finale_mpa: c.resistanceFinaleMpa, age_jours: c.ageJours, temperature_c: c.temperatureC, ciment_type: c.cimentType })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {concreteCureResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Résistance actuelle" value={concreteCureResult.resistanceCouranteMpa} unit="MPa" highlight />
                <ResultBox label="% de finale" value={concreteCureResult.pctResistanceFinale} unit="%" />
                <ResultBox label="Facteur maturité" value={concreteCureResult.facteurMaturite} />
                <ResultBox label="Âge effectif" value={concreteCureResult.ageEffectifJours} unit="j" />
                <ResultBox label="Cure min." value={concreteCureResult.tempsCureMinimumJours} unit="jours" />
                <ResultBox label="Ciment" value={concreteCureResult.description} />
              </div>
            </Card>
          )}
        </div>
      )}

      {sub === 'excavation' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Excavation avec foisonnement</h3>
            <div className="space-y-3">
              <FieldRow label="Longueur (m)"><Input type="number" value={e.longueurM} onChange={(ev) => setE({ ...e, longueurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Largeur (m)"><Input type="number" value={e.largeurM} onChange={(ev) => setE({ ...e, largeurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Profondeur (m)"><Input type="number" value={e.profondeurM} onChange={(ev) => setE({ ...e, profondeurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Type de sol">
                <Select value={e.typeSol} onChange={(ev) => setE({ ...e, typeSol: ev.target.value as typeof e.typeSol })}
                  options={[{ value: 'terre_ordinaire', label: 'Terre ordinaire (1.25)' }, { value: 'argile', label: 'Argile (1.30)' }, { value: 'sable', label: 'Sable (1.15)' }, { value: 'gravier', label: 'Gravier (1.12)' }, { value: 'roc', label: 'Roc (1.50)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcConcreteExcavation({ longueur_m: e.longueurM, largeur_m: e.largeurM, profondeur_m: e.profondeurM, type_sol: e.typeSol })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {concreteExcavationResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Vol. compact" value={concreteExcavationResult.volumeCompactM3} unit="m3" />
                <ResultBox label="Vol. foisonné" value={concreteExcavationResult.volumeFoisonneM3} unit="m3" highlight />
                <ResultBox label="Vol. foisonné" value={concreteExcavationResult.volumeFoisonneYd3} unit="yd3" />
                <ResultBox label="Camions (12yd3)" value={concreteExcavationResult.nbCamions12yd3} />
                <ResultBox label="Poids" value={concreteExcavationResult.poidsEstimeTonnes} unit="t" />
                <ResultBox label="Facteur" value={concreteExcavationResult.facteurFoisonnement} />
              </div>
            </Card>
          )}
        </div>
      )}

      {sub === 'talus' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Talus sécuritaire CNESST</h3>
            <div className="space-y-3">
              <FieldRow label="Profondeur (m)"><Input type="number" value={t.profondeurM} onChange={(ev) => setT({ ...t, profondeurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Type de sol">
                <Select value={t.typeSol} onChange={(ev) => setT({ ...t, typeSol: ev.target.value as typeof t.typeSol })}
                  options={[{ value: 'roc', label: 'Roc solide (84 deg)' }, { value: 'argile_dure', label: 'Argile dure (45 deg)' }, { value: 'argile_molle', label: 'Argile molle (34 deg)' }, { value: 'sable', label: 'Sable (34 deg)' }, { value: 'sol_meuble', label: 'Sol meuble (27 deg)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcConcreteTalus({ profondeur_m: t.profondeurM, type_sol: t.typeSol })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {concreteTalusResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <ResultBox label="Angle" value={concreteTalusResult.angleDegres} unit="deg" highlight />
                <ResultBox label="Ratio H:V" value={concreteTalusResult.ratioHV} />
                <ResultBox label="Distance H" value={concreteTalusResult.distanceHorizontaleM} unit="m" />
                <ResultBox label="Vol. suppl." value={concreteTalusResult.volumeAdditionnelM3} unit="m3/m" />
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <p className="font-medium">{concreteTalusResult.description}</p>
                {concreteTalusResult.exigencesCnesst.map((x, i) => <p key={`${i}-${x.slice(0, 20)}`}>• {x}</p>)}
              </div>
            </Card>
          )}
        </div>
      )}

      {sub === 'escalier' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Escalier béton (Blondel)</h3>
            <div className="space-y-3">
              <FieldRow label="Hauteur totale (mm)"><Input type="number" value={s.hauteurTotaleMm} onChange={(ev) => setS({ ...s, hauteurTotaleMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Largeur (m)"><Input type="number" value={s.largeurM} onChange={(ev) => setS({ ...s, largeurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Epaisseur dalle (mm)"><Input type="number" value={s.epaisseurDalleMm} onChange={(ev) => setS({ ...s, epaisseurDalleMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Giron (mm)"><Input type="number" value={s.gironCibleMm} onChange={(ev) => setS({ ...s, gironCibleMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Hauteur marche (mm)"><Input type="number" value={s.hauteurMarcheCibleMm} onChange={(ev) => setS({ ...s, hauteurMarcheCibleMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcConcreteStairs({ hauteur_totale_mm: s.hauteurTotaleMm, largeur_m: s.largeurM, epaisseur_dalle_mm: s.epaisseurDalleMm, giron_cible_mm: s.gironCibleMm, hauteur_marche_cible_mm: s.hauteurMarcheCibleMm })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {concreteStairsResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="mb-2"><ConformityBadge ok={concreteStairsResult.blondelConforme} label={concreteStairsResult.blondelConforme ? 'Blondel OK' : 'Hors Blondel'} /></div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Nb marches" value={concreteStairsResult.nbMarches} highlight />
                <ResultBox label="Hauteur m." value={concreteStairsResult.hauteurMarcheMm} unit="mm" />
                <ResultBox label="Giron" value={concreteStairsResult.gironMm} unit="mm" />
                <ResultBox label="2R+G" value={concreteStairsResult.blondel2rG} unit="mm" />
                <ResultBox label="Vol. total" value={concreteStairsResult.volumeTotalM3} unit="m3" highlight />
                <ResultBox label="Ciment" value={concreteStairsResult.cimentKg} unit="kg" />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function StairsPanel() {
  const { stairsResult, stairsGardeCorpsResult, calcStairs, calcStairsGardeCorps, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'dimensions' | 'garde'>('dimensions');
  const [f, setF] = useState({ hauteurTotale: 2700, gironCible: 260, hauteurMarcheCible: 180, usage: 'residentiel' as 'residentiel' | 'commercial', largeurM: 1 });
  const [g, setG] = useState({ longueurM: 3, hauteurMm: 965, espacementBarreauxMm: 100, usage: 'residentiel' as 'residentiel' | 'commercial' });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b pb-2">
        {[['dimensions', 'Dimensions CCQ'], ['garde', 'Garde-corps']].map(([k, l]) => (
          <button type="button" key={k} onClick={() => setSub(k as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === k ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{l}</button>
        ))}
      </div>
      {sub === 'dimensions' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Dimensions escalier (CCQ 9.8/3.4)</h3>
            <div className="space-y-3">
              <FieldRow label="Hauteur totale (mm)"><Input type="number" value={f.hauteurTotale} onChange={(ev) => setF({ ...f, hauteurTotale: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Giron cible (mm)"><Input type="number" value={f.gironCible} onChange={(ev) => setF({ ...f, gironCible: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Hauteur marche cible (mm)"><Input type="number" value={f.hauteurMarcheCible} onChange={(ev) => setF({ ...f, hauteurMarcheCible: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Largeur (m)"><Input type="number" value={f.largeurM} onChange={(ev) => setF({ ...f, largeurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Usage">
                <Select value={f.usage} onChange={(ev) => setF({ ...f, usage: ev.target.value as typeof f.usage })}
                  options={[{ value: 'residentiel', label: 'Residentiel (CCQ 9.8)' }, { value: 'commercial', label: 'Commercial (CCQ 3.4)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcStairs({ hauteur_totale: f.hauteurTotale, giron_cible: f.gironCible, hauteur_marche_cible: f.hauteurMarcheCible, usage: f.usage, largeur_m: f.largeurM })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {stairsResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="mb-2"><ConformityBadge ok={stairsResult.conformeCcq} label={stairsResult.conformeCcq ? 'Conforme CCQ' : 'Non conforme'} /></div>
              <div className="text-xs text-gray-600 mb-2">{stairsResult.codeLabel}</div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Nb marches" value={stairsResult.nbMarches} highlight />
                <ResultBox label="Hauteur m." value={stairsResult.hauteurMarcheMm} unit="mm" />
                <ResultBox label="Giron" value={stairsResult.gironMm} unit="mm" />
                <ResultBox label="2R+G" value={stairsResult.formule2rG} unit="mm" />
                <ResultBox label="Pente" value={stairsResult.penteDegres} unit="deg" />
                <ResultBox label="Ligne foulee" value={stairsResult.ligneFouleeMm} unit="mm" />
              </div>
              <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">Confort: {stairsResult.evaluationConfort}</div>
            </Card>
          )}
        </div>
      )}
      {sub === 'garde' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Garde-corps (CCQ 9.8.7)</h3>
            <div className="space-y-3">
              <FieldRow label="Longueur (m)"><Input type="number" value={g.longueurM} onChange={(ev) => setG({ ...g, longueurM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Hauteur (mm)"><Input type="number" value={g.hauteurMm} onChange={(ev) => setG({ ...g, hauteurMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Espacement barreaux (mm)"><Input type="number" value={g.espacementBarreauxMm} onChange={(ev) => setG({ ...g, espacementBarreauxMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Usage">
                <Select value={g.usage} onChange={(ev) => setG({ ...g, usage: ev.target.value as typeof g.usage })}
                  options={[{ value: 'residentiel', label: 'Residentiel' }, { value: 'commercial', label: 'Commercial' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcStairsGardeCorps({ longueur_m: g.longueurM, hauteur_mm: g.hauteurMm, espacement_barreaux_mm: g.espacementBarreauxMm, usage: g.usage })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {stairsGardeCorpsResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="mb-2 space-x-2">
                <ConformityBadge ok={stairsGardeCorpsResult.conformeHauteur} label="Hauteur" />
                <ConformityBadge ok={stairsGardeCorpsResult.conformeBarreaux} label="Barreaux" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Nb barreaux" value={stairsGardeCorpsResult.nbBarreaux} highlight />
                <ResultBox label="Nb poteaux" value={stairsGardeCorpsResult.nbPoteaux} />
                <ResultBox label="Main courante" value={stairsGardeCorpsResult.longueurMainCouranteM} unit="m" />
                <ResultBox label="Diamètre m.c." value={stairsGardeCorpsResult.diametreMainCouranteMm} unit="mm" />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ElectricalPanel() {
  const { electricalResult, electricalResidentialResult, electricalLightingResult, electricalGroundingResult,
    calcElectrical, calcElectricalResidential, calcElectricalLighting, calcElectricalGrounding, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'cable' | 'residential' | 'lighting' | 'grounding'>('cable');
  const [c, setC] = useState({ puissance: 1500, tension: 120, longueur: 15, fp: 1, chute: 3, conducteur: 'cuivre' as 'cuivre' | 'aluminium', circuit: 'monophase' as 'monophase' | 'triphase' });
  const [r, setR] = useState({ surface: 150, chauffage: 10, clim: 5, cuisiniere: 12, secheuse: 5, chauffeEau: 4.5, autres: 0 });
  const [l, setL] = useState({ surface: 30, typeLocal: 'salon', flux: 1600, uf: 0.5, mf: 0.8 });
  const [g, setG] = useState({ resistivite: 100, longueur: 3, diametre: 0.016, nbPiquets: 1 });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b pb-2">
        {[['cable', 'Cable'], ['residential', 'Charge CCE 8-200'], ['lighting', 'Eclairage'], ['grounding', 'Mise a terre']].map(([k, lab]) => (
          <button type="button" key={k} onClick={() => setSub(k as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{lab}</button>
        ))}
      </div>
      {sub === 'cable' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Calibrage câble (CCE 4-004)</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Puissance (W)"><Input type="number" value={c.puissance} onChange={(ev) => setC({ ...c, puissance: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Tension (V)"><Input type="number" value={c.tension} onChange={(ev) => setC({ ...c, tension: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Longueur (m)"><Input type="number" value={c.longueur} onChange={(ev) => setC({ ...c, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Fact. puissance"><Input type="number" step="0.1" value={c.fp} onChange={(ev) => setC({ ...c, fp: parseFloat(ev.target.value) || 1 })} /></FieldRow>
              <FieldRow label="Chute max (%)"><Input type="number" step="0.1" value={c.chute} onChange={(ev) => setC({ ...c, chute: parseFloat(ev.target.value) || 3 })} /></FieldRow>
              <FieldRow label="Conducteur"><Select value={c.conducteur} onChange={(ev) => setC({ ...c, conducteur: ev.target.value as typeof c.conducteur })} options={[{ value: 'cuivre', label: 'Cuivre' }, { value: 'aluminium', label: 'Aluminium' }]} /></FieldRow>
              <FieldRow label="Circuit"><Select value={c.circuit} onChange={(ev) => setC({ ...c, circuit: ev.target.value as typeof c.circuit })} options={[{ value: 'monophase', label: 'Monophase' }, { value: 'triphase', label: 'Triphase' }]} /></FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcElectrical({ puissance_watts: c.puissance, tension_volts: c.tension, longueur_cable_m: c.longueur, facteur_puissance: c.fp, chute_tension_max_pct: c.chute, conducteur: c.conducteur, type_circuit: c.circuit })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {electricalResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Courant" value={electricalResult.courantAmperes} unit="A" highlight />
                <ResultBox label="AWG" value={electricalResult.awgRecommande} highlight />
                <ResultBox label="Section" value={electricalResult.sectionRecommandeeMm2} unit="mm2" />
                <ResultBox label="Chute reelle" value={electricalResult.chuteTensionPct} unit="%" />
                <ResultBox label="Ampacite 75C" value={electricalResult.ampacite75} unit="A" />
                <ResultBox label="Disjoncteur" value={electricalResult.disjoncteurAmperes} unit="A" />
              </div>
              <div className="mt-2 text-xs">Conformite: <strong>{electricalResult.conformiteChute}</strong></div>
            </Card>
          )}
        </div>
      )}
      {sub === 'residential' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Charge résidentielle CCE Art. 8-200</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Surface (m2)"><Input type="number" value={r.surface} onChange={(ev) => setR({ ...r, surface: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Chauffage (kW)"><Input type="number" step="0.1" value={r.chauffage} onChange={(ev) => setR({ ...r, chauffage: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Clim (kW)"><Input type="number" step="0.1" value={r.clim} onChange={(ev) => setR({ ...r, clim: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Cuisiniere (kW)"><Input type="number" step="0.1" value={r.cuisiniere} onChange={(ev) => setR({ ...r, cuisiniere: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Secheuse (kW)"><Input type="number" step="0.1" value={r.secheuse} onChange={(ev) => setR({ ...r, secheuse: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Chauffe-eau (kW)"><Input type="number" step="0.1" value={r.chauffeEau} onChange={(ev) => setR({ ...r, chauffeEau: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Autres (kW)"><Input type="number" step="0.1" value={r.autres} onChange={(ev) => setR({ ...r, autres: parseFloat(ev.target.value) || 0 })} /></FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcElectricalResidential({ surface_habitable_m2: r.surface, chauffage_kw: r.chauffage, climatisation_kw: r.clim, cuisiniere_kw: r.cuisiniere, secheuse_kw: r.secheuse, chauffe_eau_kw: r.chauffeEau, autres_charges_kw: r.autres })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {electricalResidentialResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Total demande" value={electricalResidentialResult.totalDemandeKw} unit="kW" highlight />
                <ResultBox label="Courant 240V" value={electricalResidentialResult.courantService240v} unit="A" />
                <ResultBox label="Service recommande" value={electricalResidentialResult.calibreServiceRecommandeA} unit="A" highlight />
                <ResultBox label="Charge base" value={electricalResidentialResult.chargeBaseW} unit="W" />
                <ResultBox label="HVAC" value={electricalResidentialResult.hvacW} unit="W" />
                <ResultBox label="Article" value={electricalResidentialResult.articleCce} />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'lighting' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Éclairage (méthode lumens)</h3>
            <div className="space-y-3">
              <FieldRow label="Surface (m2)"><Input type="number" value={l.surface} onChange={(ev) => setL({ ...l, surface: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Type de local">
                <Select value={l.typeLocal} onChange={(ev) => setL({ ...l, typeLocal: ev.target.value })}
                  options={[{ value: 'salon', label: 'Salon (150 lux)' }, { value: 'cuisine', label: 'Cuisine (300 lux)' }, { value: 'chambre', label: 'Chambre (150 lux)' }, { value: 'bureau', label: 'Bureau (500 lux)' }, { value: 'atelier', label: 'Atelier (500 lux)' }, { value: 'commercial', label: 'Commercial (500 lux)' }, { value: 'industriel', label: 'Industriel (750 lux)' }, { value: 'couloir', label: 'Couloir (100 lux)' }, { value: 'salle_bain', label: 'Salle de bain (300 lux)' }]} />
              </FieldRow>
              <FieldRow label="Flux luminaire (lm)"><Input type="number" value={l.flux} onChange={(ev) => setL({ ...l, flux: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="UF (0.2-0.9)"><Input type="number" step="0.05" value={l.uf} onChange={(ev) => setL({ ...l, uf: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="MF (0.5-1.0)"><Input type="number" step="0.05" value={l.mf} onChange={(ev) => setL({ ...l, mf: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcElectricalLighting({ surface_m2: l.surface, type_local: l.typeLocal, flux_luminaire_lm: l.flux, uf: l.uf, mf: l.mf })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {electricalLightingResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Nb luminaires" value={electricalLightingResult.nbLuminaires} highlight />
                <ResultBox label="Lux requis" value={electricalLightingResult.luxRequis} />
                <ResultBox label="Disposition" value={electricalLightingResult.dispositionGrille} />
                <ResultBox label="Espacement" value={electricalLightingResult.espacementM} unit="m" />
                <ResultBox label="Flux total" value={electricalLightingResult.fluxTotalRequisLm} unit="lm" />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'grounding' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Mise à la terre (piquets)</h3>
            <div className="space-y-3">
              <FieldRow label="Resistivite sol (ohm.m)"><Input type="number" value={g.resistivite} onChange={(ev) => setG({ ...g, resistivite: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Longueur piquet (m)"><Input type="number" step="0.1" value={g.longueur} onChange={(ev) => setG({ ...g, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Diamètre (m)"><Input type="number" step="0.001" value={g.diametre} onChange={(ev) => setG({ ...g, diametre: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Nb piquets"><Input type="number" value={g.nbPiquets} onChange={(ev) => setG({ ...g, nbPiquets: parseInt(ev.target.value) || 1 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcElectricalGrounding({ resistivite_sol: g.resistivite, longueur_piquet_m: g.longueur, diametre_piquet_m: g.diametre, nb_piquets: g.nbPiquets })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {electricalGroundingResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="mb-2"><ConformityBadge ok={electricalGroundingResult.conformeHydroQuebec} label="Hydro-Quebec < 25 ohms" /></div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="R totale" value={electricalGroundingResult.resistanceTotaleOhms} unit="ohms" highlight />
                <ResultBox label="R par piquet" value={electricalGroundingResult.resistancePiquetUniqueOhms} unit="ohms" />
              </div>
              <div className="mt-2 text-xs">{electricalGroundingResult.recommandation}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalculateursPage() {
  return <CalculateursPageInner />;
}

function CalculateursPageInner() {
  const store = useCalculatorsStore();
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [selectedCalc, setSelectedCalc] = useState<CalcId | null>(null);

  useEffect(() => {
    store.fetchCalculators();
    store.fetchConstants();
    store.fetchResources();
    store.fetchConversions();
    store.fetchStructuralMaterials();
    store.fetchSnowLoads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-3 md:p-4 space-y-3 md:space-y-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Calculator className="text-blue-600 shrink-0" /> <span className="truncate">Calculateurs Construction</span>
          </h1>
          <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400 truncate hidden sm:block">15 calculateurs + IA Claude Opus 4.7 + historique multi-murs</p>
        </div>
      </div>

      {store.error && <Alert type="error" onClose={store.clearError}>{store.error}</Alert>}
      {store.successMessage && <Alert type="success" onClose={store.clearSuccess}>{store.successMessage}</Alert>}

      <div className="flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700 pb-2 -mx-3 px-3 md:mx-0 md:px-0">
        {[
          ['dashboard', 'Tableau de bord', <BarChart3 size={16} />],
          ['calculateurs', 'Calculateurs', <Calculator size={16} />],
          ['structural', 'Analyse structurale', <Ruler size={16} />],
          ['ia', 'Assistant IA', <Sparkles size={16} />],
          ['historique', 'Historique', <HistoryIcon size={16} />],
          ['conversions', 'Conversions', <PenTool size={16} />],
        ].map(([key, label, icon]) => (
          <button type="button" key={key as string} onClick={() => setTab(key as TabKey)}
            className={`flex items-center gap-2 px-3 md:px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 ${tab === key ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'}`}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab onSelect={(id) => { setSelectedCalc(id); setTab('calculateurs'); }} />}
      {tab === 'calculateurs' && <CalculateursTab selected={selectedCalc} onSelect={setSelectedCalc} />}
      {tab === 'structural' && <StructuralTab />}
      {tab === 'ia' && <IaTab />}
      {tab === 'historique' && <HistoriqueTab />}
      {tab === 'conversions' && <ConversionsTab />}
    </div>
  );
}

function DashboardTab({ onSelect }: { onSelect: (id: CalcId) => void }) {
  const { history, historyStats, fetchHistoryStats } = useCalculatorsStore();
  useEffect(() => { fetchHistoryStats(); }, [fetchHistoryStats]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Calculateurs" value={CALC_DEFS.length} icon={<Calculator size={20} />} color="bg-[#7BAFD4]" />
        <KpiCard label="Calculs sauves" value={historyStats?.total ?? 0} icon={<HistoryIcon size={20} />} color="bg-[#7DC4A5]" />
        <KpiCard label="Normes Quebec" value="10+" icon={<HardHat size={20} />} color="bg-[#B09BD8]" />
        <KpiCard label="IA Claude" value="6 outils" icon={<Sparkles size={20} />} color="bg-[#F0B07A]" />
      </div>
      {CATEGORIES.map((cat) => (
        <Card key={cat.label} className="p-4">
          <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">{cat.label}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cat.ids.map((id) => {
              const def = CALC_DEFS.find((d) => d.id === id);
              if (!def) return null;
              return (
                <button type="button" key={id} onClick={() => onSelect(id)}
                  className="p-4 text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md hover:border-blue-300 transition flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${def.color} text-white`}>{def.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white">{def.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{def.description}</div>
                  </div>
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

function CalculateursTab({ selected, onSelect }: { selected: CalcId | null; onSelect: (id: CalcId | null) => void }) {
  const [showSidebar, setShowSidebar] = useState(false);
  const selectedDef = selected ? CALC_DEFS.find((d) => d.id === selected) : null;

  const handleSelect = (id: CalcId | null) => {
    onSelect(id);
    setShowSidebar(false);
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Mobile: trigger button to open drawer */}
        <button type="button" onClick={() => setShowSidebar(true)}
          className="lg:hidden w-full p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex items-center justify-between hover:shadow-md transition">
          <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white min-w-0">
            <Menu size={16} className="text-gray-500 shrink-0" />
            {selectedDef ? (
              <span className="flex items-center gap-2 min-w-0">
                <span className={`p-0.5 rounded ${selectedDef.color} text-white shrink-0`}>{selectedDef.icon}</span>
                <span className="truncate">{selectedDef.name}</span>
              </span>
            ) : (
              <span>Choisir un calculateur</span>
            )}
          </span>
          <ChevronRight size={16} className="text-gray-400 shrink-0" />
        </button>

        {/* Desktop: inline sticky sidebar */}
        <div className="hidden lg:block lg:col-span-1">
          <Card className="p-3 sticky top-4">
            <div className="space-y-1">
              {CALC_DEFS.map((def) => (
                <button type="button" key={def.id} onClick={() => onSelect(def.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${selected === def.id ? 'bg-[#7BAFD4]/10 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4] border border-[#7BAFD4]/30' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  <span className={`p-1 rounded ${def.color} text-white`}>{def.icon}</span>
                  <span className="font-medium truncate">{def.name}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Content panel */}
        <div className="lg:col-span-3">
          {!selected && (
            <Card className="p-6 md:p-8 text-center">
              <PenTool size={48} className="mx-auto text-gray-400 mb-2" />
              <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
                <span className="hidden lg:inline">Sélectionnez un calculateur dans la liste à gauche.</span>
                <span className="lg:hidden">Touche le bouton ci-dessus pour choisir un calculateur.</span>
              </p>
            </Card>
          )}
        {selected === 'master-pro' && <MasterProCalculator />}
        {selected === 'concrete' && <ConcretePanel />}
        {selected === 'stairs' && <StairsPanel />}
        {selected === 'murs-parametrique' && <MursParametriquePanel />}
        {selected === 'electrical' && <ElectricalPanel />}
        {selected === 'roofing' && <RoofingPanel />}
        {selected === 'painting' && <PaintingPanel />}
        {selected === 'plumbing' && <PlumbingPanel />}
        {selected === 'hvac' && <HvacPanel />}
        {selected === 'welding' && <WeldingPanel />}
        {selected === 'bending' && <BendingPanel />}
        {selected === 'metal-weight' && <MetalWeightPanel />}
        {selected === 'taxes' && <TaxesPanel />}
        {selected === 'charge-tributaire' && <PaiePanel />}
        {selected === 'charge-tributaire-complete' && <StructuralTab />}
        </div>
      </div>

      {/* Mobile drawer */}
      {showSidebar && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowSidebar(false)} aria-hidden="true" />
          <aside className="fixed top-0 left-0 bottom-0 w-72 max-w-[85vw] bg-white dark:bg-gray-800 shadow-xl overflow-y-auto flex flex-col">
            <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
              <span className="font-bold text-gray-900 dark:text-white">Calculateurs</span>
              <button type="button" onClick={() => setShowSidebar(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                aria-label="Fermer">
                <X size={18} />
              </button>
            </div>
            <div className="p-3 space-y-1 flex-1 overflow-y-auto">
              {CALC_DEFS.map((def) => (
                <button type="button" key={def.id} onClick={() => handleSelect(def.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2 text-sm ${selected === def.id ? 'bg-[#7BAFD4]/10 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4] border border-[#7BAFD4]/30' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  <span className={`p-1 rounded ${def.color} text-white shrink-0`}>{def.icon}</span>
                  <span className="font-medium truncate">{def.name}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

// Placeholder panels - implemented below
function RoofingPanel() {
  const { roofingResult, roofingVentilationResult, roofingGuttersResult, roofingSnowLoadResult,
    calcRoofing, calcRoofingVentilation, calcRoofingGutters, calcRoofingSnowLoad, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'surface' | 'ventilation' | 'gouttieres' | 'neige'>('surface');
  const [f, setF] = useState({ longueur: 12, largeur: 8, pente: 4, debord: 0.3, perte: 15, type: 'bardeau_architect' });
  const [v, setV] = useState({ surface: 150, pareVapeur: true });
  const [g, setG] = useState({ surfaceToit: 120, perimetre: 40, type: '5po' as '4po' | '5po' | '6po' | '7po' });
  const [n, setN] = useState({ province: 'QC' as const, ville: 'Montreal', typeCouverture: 'bardeaux_asphalte' });
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b pb-2">
        {[['surface', 'Surface + bardeaux'], ['ventilation', 'Ventilation 1:300'], ['gouttieres', 'Gouttieres'], ['neige', 'Charge neige']].map(([k, l]) => (
          <button type="button" key={k} onClick={() => setSub(k as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === k ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{l}</button>
        ))}
      </div>
      {sub === 'surface' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Surface toiture</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Longueur (m)"><Input type="number" value={f.longueur} onChange={(ev) => setF({ ...f, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Largeur (m)"><Input type="number" value={f.largeur} onChange={(ev) => setF({ ...f, largeur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Pente (x:12)"><Input type="number" value={f.pente} onChange={(ev) => setF({ ...f, pente: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Debord (m)"><Input type="number" step="0.1" value={f.debord} onChange={(ev) => setF({ ...f, debord: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Perte (%)"><Input type="number" value={f.perte} onChange={(ev) => setF({ ...f, perte: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Materiau">
                <Select value={f.type} onChange={(ev) => setF({ ...f, type: ev.target.value })}
                  options={[{ value: 'bardeau_3tabs', label: 'Bardeau 3 tabs 20 ans' }, { value: 'bardeau_architect', label: 'Bardeau architectural 30 ans' }, { value: 'bardeau_premium', label: 'Bardeau premium 50 ans' }, { value: 'membrane_elastomere', label: 'Membrane elastomere' }, { value: 'membrane_tpo', label: 'Membrane TPO' }, { value: 'tole_galvanisee', label: 'Tole galvanisee' }]} />
              </FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcRoofing({ longueur_m: f.longueur, largeur_m: f.largeur, pente_ratio: f.pente, debord_m: f.debord, perte_pct: f.perte, type_materiau: f.type })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {roofingResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Surface totale" value={roofingResult.surfaceTotaleM2} unit="m2" highlight />
                <ResultBox label="Squares" value={roofingResult.nbSquares} />
                <ResultBox label="Paquets" value={roofingResult.nbPaquetsBardeaux} />
                <ResultBox label="Sous-couche" value={roofingResult.rouleauxSousCouche} unit="rl" />
                <ResultBox label="Membrane glace" value={roofingResult.membraneGlaceRouleaux} unit="rl" />
                <ResultBox label="Pente" value={roofingResult.penteDegres} unit="deg" />
                <ResultBox label="Coût matériau" value={roofingResult.coutMateriauCad} unit="$" />
                <ResultBox label="Coût total" value={roofingResult.coutTotalCad} unit="$" highlight />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'ventilation' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Ventilation combles (CCQ 9.19.1)</h3>
            <div className="space-y-3">
              <FieldRow label="Surface comble (m2)"><Input type="number" value={v.surface} onChange={(ev) => setV({ ...v, surface: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Pare-vapeur">
                <Select value={v.pareVapeur ? 'oui' : 'non'} onChange={(ev) => setV({ ...v, pareVapeur: ev.target.value === 'oui' })}
                  options={[{ value: 'oui', label: 'Avec pare-vapeur (1:300)' }, { value: 'non', label: 'Sans pare-vapeur (1:150)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcRoofingVentilation({ surface_comble_m2: v.surface, pare_vapeur: v.pareVapeur })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {roofingVentilationResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Ratio" value={roofingVentilationResult.ratioVentilation} highlight />
                <ResultBox label="NFA total" value={roofingVentilationResult.nfaTotalPo2} unit="po2" />
                <ResultBox label="Soffite" value={roofingVentilationResult.soffiteContinuPi} unit="pi" />
                <ResultBox label="Turbines 12po" value={roofingVentilationResult.nbTurbines12po} />
                <ResultBox label="Faitier" value={roofingVentilationResult.eventFaitierPi} unit="pi" />
                <ResultBox label="Article" value={roofingVentilationResult.articleCcq} />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'gouttieres' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Gouttières (CCQ 9.14.6)</h3>
            <div className="space-y-3">
              <FieldRow label="Surface toit (m2)"><Input type="number" value={g.surfaceToit} onChange={(ev) => setG({ ...g, surfaceToit: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Perimetre (m)"><Input type="number" value={g.perimetre} onChange={(ev) => setG({ ...g, perimetre: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Type">
                <Select value={g.type} onChange={(ev) => setG({ ...g, type: ev.target.value as typeof g.type })}
                  options={[{ value: '4po', label: '4 pouces (600 pi2)' }, { value: '5po', label: '5 pouces (1000 pi2)' }, { value: '6po', label: '6 pouces (1400 pi2)' }, { value: '7po', label: '7 pouces (2000 pi2)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcRoofingGutters({ surface_toit_m2: g.surfaceToit, perimetre_m: g.perimetre, type_gouttiere: g.type })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {roofingGuttersResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Nb descentes" value={roofingGuttersResult.nbDescentes} highlight />
                <ResultBox label="Longueur" value={roofingGuttersResult.longueurGouttieresM} unit="m" />
                <ResultBox label="Supports" value={roofingGuttersResult.nbSupports} />
                <ResultBox label="Angles" value={roofingGuttersResult.nbAngles} />
                <ResultBox label="Embouts" value={roofingGuttersResult.nbEmbouts} />
                <ResultBox label="Capacite" value={roofingGuttersResult.capaciteParDescentePi2} unit="pi2" />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'neige' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Charge de neige (CNBC 4.1.6)</h3>
            <div className="space-y-3">
              <FieldRow label="Province">
                <Select value={n.province} onChange={(ev) => setN({ ...n, province: ev.target.value as typeof n.province })}
                  options={[{ value: 'QC', label: 'Quebec' }, { value: 'ON', label: 'Ontario' }, { value: 'BC', label: 'Colombie-Britannique' }, { value: 'AB', label: 'Alberta' }]} />
              </FieldRow>
              <FieldRow label="Ville"><Input value={n.ville} onChange={(ev) => setN({ ...n, ville: ev.target.value })} /></FieldRow>
              <FieldRow label="Couverture">
                <Select value={n.typeCouverture} onChange={(ev) => setN({ ...n, typeCouverture: ev.target.value })}
                  options={[{ value: 'bardeaux_asphalte', label: 'Bardeaux asphalte' }, { value: 'membrane_elastomere', label: 'Membrane' }, { value: 'tole_galvanisee', label: 'Tole' }, { value: 'tuiles_beton', label: 'Tuiles beton' }, { value: 'ardoise', label: 'Ardoise' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcRoofingSnowLoad({ province: n.province, ville: n.ville, type_couverture: n.typeCouverture })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {roofingSnowLoadResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Neige" value={roofingSnowLoadResult.chargeNeigeKpa} unit="kPa" highlight />
                <ResultBox label="Neige" value={roofingSnowLoadResult.chargeNeigeLbPi2} unit="lb/pi2" />
                <ResultBox label="Charge morte" value={roofingSnowLoadResult.chargeMorteLbPi2} unit="lb/pi2" />
                <ResultBox label="Charge design" value={roofingSnowLoadResult.chargeDesignKpa} unit="kPa" highlight />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function PaintingPanel() {
  const { paintingResult, paintingDftResult, paintingDewPointResult,
    calcPainting, calcPaintingDft, calcPaintingDewPoint, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'surface' | 'dft' | 'rosee'>('surface');
  const [f, setF] = useState({ longueur: 5, largeur: 4, hauteur: 2.44, portes: 1, fenetres: 2, type: 'latex_interieur', surfaceType: 'gypse_peint' as const, methode: 'rouleau' as const, nbCouches: 2 });
  const [d, setD] = useState({ volumeMl: 1000, solides: 35, surfaceM2: 10 });
  const [r, setR] = useState({ tempAir: 20, humidite: 60, tempSurface: 18 });
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b pb-2">
        {[['surface', 'Quantite + cout'], ['dft', 'DFT film sec'], ['rosee', 'Point de rosee']].map(([k, l]) => (
          <button type="button" key={k} onClick={() => setSub(k as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === k ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{l}</button>
        ))}
      </div>
      {sub === 'surface' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Peinture - quantité et coût</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Longueur (m)"><Input type="number" value={f.longueur} onChange={(ev) => setF({ ...f, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Largeur (m)"><Input type="number" value={f.largeur} onChange={(ev) => setF({ ...f, largeur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Hauteur (m)"><Input type="number" step="0.1" value={f.hauteur} onChange={(ev) => setF({ ...f, hauteur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Nb portes"><Input type="number" value={f.portes} onChange={(ev) => setF({ ...f, portes: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Nb fenetres"><Input type="number" value={f.fenetres} onChange={(ev) => setF({ ...f, fenetres: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Nb couches"><Input type="number" value={f.nbCouches} onChange={(ev) => setF({ ...f, nbCouches: parseInt(ev.target.value) || 1 })} /></FieldRow>
              <FieldRow label="Type peinture">
                <Select value={f.type} onChange={(ev) => setF({ ...f, type: ev.target.value })}
                  options={[{ value: 'latex_interieur', label: 'Latex interieur' }, { value: 'latex_exterieur', label: 'Latex exterieur' }, { value: 'alkyde_interieur', label: 'Alkyde interieur' }, { value: 'epoxy_2k', label: 'Epoxy 2K' }, { value: 'polyurethane_2k', label: 'Polyurethane 2K' }, { value: 'peinture_plancher', label: 'Peinture plancher' }]} />
              </FieldRow>
              <FieldRow label="Surface">
                <Select value={f.surfaceType} onChange={(ev) => setF({ ...f, surfaceType: ev.target.value as typeof f.surfaceType })}
                  options={[{ value: 'gypse_neuf', label: 'Gypse neuf' }, { value: 'gypse_peint', label: 'Gypse peint' }, { value: 'bois_neuf', label: 'Bois neuf' }, { value: 'bois_peint', label: 'Bois peint' }, { value: 'beton_neuf', label: 'Béton neuf' }, { value: 'metal', label: 'Métal' }, { value: 'stucco', label: 'Stucco' }]} />
              </FieldRow>
              <FieldRow label="Méthode">
                <Select value={f.methode} onChange={(ev) => setF({ ...f, methode: ev.target.value as typeof f.methode })}
                  options={[{ value: 'rouleau', label: 'Rouleau' }, { value: 'pinceau', label: 'Pinceau' }, { value: 'airless', label: 'Airless' }, { value: 'hvlp', label: 'HVLP' }]} />
              </FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcPainting({ longueur_m: f.longueur, largeur_m: f.largeur, hauteur_m: f.hauteur, nb_portes: f.portes, nb_fenetres: f.fenetres, type_peinture: f.type, surface_type: f.surfaceType, methode: f.methode, nb_couches: f.nbCouches })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {paintingResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Surface totale" value={paintingResult.surfaceTotaleM2} unit="m2" />
                <ResultBox label="Litres total" value={paintingResult.litresTotal} unit="L" highlight />
                <ResultBox label="Gallons" value={paintingResult.gallonsTotal} unit="gal" />
                <ResultBox label="DFT theorique" value={paintingResult.dftUmTheorique} unit="um" />
                <ResultBox label="Coût HT" value={paintingResult.coutPeintureHt} unit="$" />
                <ResultBox label="Coût TTC" value={paintingResult.coutTotalTtc} unit="$" highlight />
                <ResultBox label="Coût/m2" value={paintingResult.coutParM2Ttc} unit="$/m2" />
                <ResultBox label="Recouvrement" value={paintingResult.tempsRecouvrementH} unit="h" />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'dft' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Épaisseur film sec (DFT)</h3>
            <div className="space-y-3">
              <FieldRow label="Volume applique (mL)"><Input type="number" value={d.volumeMl} onChange={(ev) => setD({ ...d, volumeMl: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Solides (%)"><Input type="number" value={d.solides} onChange={(ev) => setD({ ...d, solides: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Surface (m2)"><Input type="number" value={d.surfaceM2} onChange={(ev) => setD({ ...d, surfaceM2: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcPaintingDft({ volume_ml: d.volumeMl, solides_pct: d.solides, surface_m2: d.surfaceM2 })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {paintingDftResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="DFT" value={paintingDftResult.dftUm} unit="um" highlight />
                <ResultBox label="DFT" value={paintingDftResult.dftMils} unit="mils" />
                <ResultBox label="Couverture" value={paintingDftResult.couvertureTheoriqueM2L} unit="m2/L" />
              </div>
              <div className="mt-2 text-xs">{paintingDftResult.evaluation}</div>
            </Card>
          )}
        </div>
      )}
      {sub === 'rosee' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Point de rosée (Magnus)</h3>
            <div className="space-y-3">
              <FieldRow label="Temperature air (C)"><Input type="number" step="0.1" value={r.tempAir} onChange={(ev) => setR({ ...r, tempAir: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Humidite relative (%)"><Input type="number" value={r.humidite} onChange={(ev) => setR({ ...r, humidite: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Temperature surface (C)"><Input type="number" step="0.1" value={r.tempSurface} onChange={(ev) => setR({ ...r, tempSurface: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcPaintingDewPoint({ temperature_air_c: r.tempAir, humidite_relative_pct: r.humidite, temperature_surface_c: r.tempSurface })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {paintingDewPointResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="mb-2"><ConformityBadge ok={paintingDewPointResult.applicationSecuritaire} label={paintingDewPointResult.applicationSecuritaire ? 'Application OK' : 'Risque condensation'} /></div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Point de rosee" value={paintingDewPointResult.pointRoseeC} unit="C" highlight />
                <ResultBox label="Marge sécurité" value={paintingDewPointResult.margeSecuriteC} unit="C" />
              </div>
              <div className="mt-2 text-xs">{paintingDewPointResult.recommandation}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function PlumbingPanel() {
  const { plumbingResult, plumbingHazenResult, plumbingWaterHeaterResult, plumbingDrainSlopeResult,
    calcPlumbing, calcPlumbingHazenWilliams, calcPlumbingWaterHeater, calcPlumbingDrainSlope, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'dfu' | 'hazen' | 'heater' | 'slope'>('dfu');
  const [f, setF] = useState({ toilettes: 2, lavabos: 2, douches: 1, baignoires: 1, laveVaisselle: 1, machineLaver: 1, evierCuisine: 1, evierBar: 0, urinoir: 0, drainPlancher: 0 });
  const [h, setH] = useState({ debit: 10, longueur: 50, diametre: 1, materiau: 'cuivre' });
  const [w, setW] = useState({ chambres: 3, sallesBain: 2, personnes: 4 });
  const [s, setS] = useState({ diametre: 3, longueur: 10, pente: 2 });
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b pb-2">
        {[['dfu', 'DFU + WSFU'], ['hazen', 'Hazen-Williams'], ['heater', 'Chauffe-eau'], ['slope', 'Pente drain']].map(([k, l]) => (
          <button type="button" key={k} onClick={() => setSub(k as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === k ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{l}</button>
        ))}
      </div>
      {sub === 'dfu' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Unités de charge (CNP)</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Toilettes"><Input type="number" value={f.toilettes} onChange={(ev) => setF({ ...f, toilettes: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Lavabos"><Input type="number" value={f.lavabos} onChange={(ev) => setF({ ...f, lavabos: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Douches"><Input type="number" value={f.douches} onChange={(ev) => setF({ ...f, douches: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Baignoires"><Input type="number" value={f.baignoires} onChange={(ev) => setF({ ...f, baignoires: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Evier cuisine"><Input type="number" value={f.evierCuisine} onChange={(ev) => setF({ ...f, evierCuisine: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Lave-vaisselle"><Input type="number" value={f.laveVaisselle} onChange={(ev) => setF({ ...f, laveVaisselle: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Lave-linge"><Input type="number" value={f.machineLaver} onChange={(ev) => setF({ ...f, machineLaver: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Drain plancher"><Input type="number" value={f.drainPlancher} onChange={(ev) => setF({ ...f, drainPlancher: parseInt(ev.target.value) || 0 })} /></FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcPlumbing({ nb_toilettes: f.toilettes, nb_lavabos: f.lavabos, nb_douches: f.douches, nb_baignoires: f.baignoires, nb_evier_cuisine: f.evierCuisine, nb_lave_vaisselle: f.laveVaisselle, nb_machines_laver: f.machineLaver, nb_drain_plancher: f.drainPlancher })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {plumbingResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <ResultBox label="Total DFU" value={plumbingResult.totalDfu} highlight />
                <ResultBox label="Total WSFU" value={plumbingResult.totalWsfu} />
                <ResultBox label="Debit" value={plumbingResult.debitGpm} unit="GPM" />
                <ResultBox label="Debit" value={plumbingResult.debitLpm} unit="L/min" />
              </div>
              <div className="text-sm space-y-1">
                <div className="font-semibold">Drain recommande: <span className="text-blue-600">{plumbingResult.diametreDrain.pouces} ({plumbingResult.diametreDrain.mm} mm)</span></div>
                <div>{plumbingResult.code}</div>
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'hazen' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Perte de charge Hazen-Williams</h3>
            <div className="space-y-3">
              <FieldRow label="Debit (GPM)"><Input type="number" value={h.debit} onChange={(ev) => setH({ ...h, debit: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Longueur (pi)"><Input type="number" value={h.longueur} onChange={(ev) => setH({ ...h, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Diamètre (po)"><Input type="number" step="0.1" value={h.diametre} onChange={(ev) => setH({ ...h, diametre: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Materiau">
                <Select value={h.materiau} onChange={(ev) => setH({ ...h, materiau: ev.target.value })}
                  options={[{ value: 'cuivre', label: 'Cuivre (C=140)' }, { value: 'pex', label: 'PEX (C=140)' }, { value: 'cpvc', label: 'CPVC (C=140)' }, { value: 'pvc', label: 'PVC (C=140)' }, { value: 'acier_galv_neuf', label: 'Acier galv neuf (C=120)' }, { value: 'acier_galv_usage', label: 'Acier galv use (C=100)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcPlumbingHazenWilliams({ debit_gpm: h.debit, longueur_pi: h.longueur, diametre_pouce: h.diametre, materiau: h.materiau as 'cuivre' })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {plumbingHazenResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Perte de charge" value={plumbingHazenResult.perteChargePsi} unit="psi" highlight />
                <ResultBox label="Perte de charge" value={plumbingHazenResult.perteChargePi} unit="pi" />
                <ResultBox label="Vitesse" value={plumbingHazenResult.vitessePiS} unit="pi/s" />
                <ResultBox label="Coef. C" value={plumbingHazenResult.coefficientC} />
              </div>
              <div className="mt-2 text-xs">{plumbingHazenResult.evaluationVitesse}</div>
            </Card>
          )}
        </div>
      )}
      {sub === 'heater' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Chauffe-eau (dimensionnement)</h3>
            <div className="space-y-3">
              <FieldRow label="Nb chambres"><Input type="number" value={w.chambres} onChange={(ev) => setW({ ...w, chambres: parseInt(ev.target.value) || 1 })} /></FieldRow>
              <FieldRow label="Nb salles de bain"><Input type="number" value={w.sallesBain} onChange={(ev) => setW({ ...w, sallesBain: parseInt(ev.target.value) || 1 })} /></FieldRow>
              <FieldRow label="Nb personnes"><Input type="number" value={w.personnes} onChange={(ev) => setW({ ...w, personnes: parseInt(ev.target.value) || 1 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcPlumbingWaterHeater({ nb_chambres: w.chambres, nb_salles_bain: w.sallesBain, nb_personnes: w.personnes })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {plumbingWaterHeaterResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="mb-2"><ConformityBadge ok={plumbingWaterHeaterResult.adequat} label={plumbingWaterHeaterResult.adequat ? 'FHR adequat' : 'Sous-dimensionne'} /></div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Capacite" value={plumbingWaterHeaterResult.capaciteGallons} unit="gal" highlight />
                <ResultBox label="Capacite" value={plumbingWaterHeaterResult.capaciteLitres} unit="L" />
                <ResultBox label="FHR min" value={plumbingWaterHeaterResult.firstHourRatingMin} unit="gal" />
                <ResultBox label="Conso pointe" value={plumbingWaterHeaterResult.consommationPointeEstimee} unit="gal" />
              </div>
              <div className="mt-2 text-xs">{plumbingWaterHeaterResult.typeRecommande}</div>
            </Card>
          )}
        </div>
      )}
      {sub === 'slope' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Pente drain</h3>
            <div className="space-y-3">
              <FieldRow label="Diamètre (po)"><Input type="number" step="0.5" value={s.diametre} onChange={(ev) => setS({ ...s, diametre: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Longueur (m)"><Input type="number" value={s.longueur} onChange={(ev) => setS({ ...s, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Pente (%)"><Input type="number" step="0.1" value={s.pente} onChange={(ev) => setS({ ...s, pente: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcPlumbingDrainSlope({ diametre_pouce: s.diametre, longueur_m: s.longueur, pente_pct: s.pente })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {plumbingDrainSlopeResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="mb-2"><ConformityBadge ok={plumbingDrainSlopeResult.conformeCnp} label={plumbingDrainSlopeResult.conformeCnp ? 'Conforme CNP' : 'Non conforme'} /></div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Chute" value={plumbingDrainSlopeResult.chuteM} unit="m" highlight />
                <ResultBox label="Chute" value={plumbingDrainSlopeResult.chutePo} unit="po" />
                <ResultBox label="Pente recommandee" value={plumbingDrainSlopeResult.penteRecommandeePct} unit="%" />
              </div>
              <div className="mt-2 text-xs">{plumbingDrainSlopeResult.recommandation}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function HvacPanel() {
  const { hvacResult, hvacDuctResult, hvacCfmResult, hvacHrvResult, hvacCoolingResult,
    calcHvac, calcHvacDuct, calcHvacCfm, calcHvacHrv, calcHvacCooling, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'charge' | 'duct' | 'cfm' | 'hrv' | 'cooling'>('charge');
  const [f, setF] = useState({ surface: 150, hauteur: 2.44, isolation: 'moyenne' as const, zone: 'montreal' as const });
  const [d, setD] = useState({ cfm: 1000, type: 'residentiel_principal' as const });
  const [c, setC] = useState({ volume: 50, typePiece: 'salon' });
  const [h, setH] = useState({ surface: 150, chambres: 3, occupants: 4 });
  const [co, setCo] = useState({ surfaceVitree: 10, orientation: 'mixte' as const, shgc: 0.3, rayonnement: 700, occupants: 4, equipements: 500 });
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b pb-2">
        {[['charge', 'Charge thermique'], ['duct', 'Conduits'], ['cfm', 'CFM par piece'], ['hrv', 'HRV/ERV'], ['cooling', 'Climatisation']].map(([k, l]) => (
          <button type="button" key={k} onClick={() => setSub(k as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === k ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{l}</button>
        ))}
      </div>
      {sub === 'charge' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Charge thermique ASHRAE</h3>
            <div className="space-y-3">
              <FieldRow label="Surface (m2)"><Input type="number" value={f.surface} onChange={(ev) => setF({ ...f, surface: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Hauteur plafond (m)"><Input type="number" step="0.1" value={f.hauteur} onChange={(ev) => setF({ ...f, hauteur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Isolation">
                <Select value={f.isolation} onChange={(ev) => setF({ ...f, isolation: ev.target.value as typeof f.isolation })}
                  options={[{ value: 'faible', label: 'Faible (50 W/m2)' }, { value: 'moyenne', label: 'Moyenne (40)' }, { value: 'bonne', label: 'Bonne (30)' }, { value: 'excellente', label: 'Excellente (22)' }]} />
              </FieldRow>
              <FieldRow label="Zone climatique">
                <Select value={f.zone} onChange={(ev) => setF({ ...f, zone: ev.target.value as typeof f.zone })}
                  options={[{ value: 'montreal', label: 'Montreal (4500 DJ)' }, { value: 'quebec', label: 'Quebec (5100 DJ)' }, { value: 'gatineau', label: 'Gatineau (4700 DJ)' }, { value: 'sherbrooke', label: 'Sherbrooke (5000 DJ)' }, { value: 'saguenay', label: 'Saguenay (5600 DJ)' }, { value: 'rimouski', label: 'Rimouski (5200 DJ)' }, { value: 'val_dor', label: "Val-d'Or (6200 DJ)" }, { value: 'nord', label: 'Nord (6800 DJ)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcHvac({ surface_m2: f.surface, hauteur_plafond_m: f.hauteur, isolation: f.isolation, zone_climatique: f.zone })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {hvacResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Pertes design" value={hvacResult.pertesDesignW} unit="W" highlight />
                <ResultBox label="BTU/h" value={hvacResult.btuH} unit="BTU/h" highlight />
                <ResultBox label="Tonnage" value={hvacResult.tonnageClim} unit="tonnes" />
                <ResultBox label="CFM vent." value={hvacResult.cfmVentilation} />
                <ResultBox label="Volume" value={hvacResult.volumeM3} unit="m3" />
                <ResultBox label="BTU/pi2" value={hvacResult.btuParPi2} />
                <ResultBox label="Equip. reco" value={hvacResult.equipementRecommandeBtu} unit="BTU/h" />
                <ResultBox label="T hiver" value={hvacResult.tHiverC} unit="C" />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'duct' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Dimensionnement conduit rond</h3>
            <div className="space-y-3">
              <FieldRow label="CFM"><Input type="number" value={d.cfm} onChange={(ev) => setD({ ...d, cfm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Type">
                <Select value={d.type} onChange={(ev) => setD({ ...d, type: ev.target.value as typeof d.type })}
                  options={[{ value: 'residentiel_principal', label: 'Res. principal (600-900 FPM)' }, { value: 'residentiel_branche', label: 'Res. branche (400-600)' }, { value: 'commercial', label: 'Commercial (1000-1500)' }, { value: 'industriel', label: 'Industriel (1500-2500)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcHvacDuct({ cfm: d.cfm, type_circuit: d.type })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {hvacDuctResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="mb-2"><ConformityBadge ok={hvacDuctResult.conforme} label={hvacDuctResult.conforme ? 'Vitesse OK' : 'Hors plage'} /></div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Diamètre std" value={hvacDuctResult.diametreStandardPo} unit="po" highlight />
                <ResultBox label="Vitesse reelle" value={hvacDuctResult.vitesseReelleFpm} unit="FPM" />
                <ResultBox label="Recommande" value={hvacDuctResult.vitesseRecommandeeFpm} unit="FPM" />
                <ResultBox label="Aire section" value={hvacDuctResult.aireSectionPi2} unit="pi2" />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'cfm' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">CFM par changement d'air</h3>
            <div className="space-y-3">
              <FieldRow label="Volume piece (m3)"><Input type="number" value={c.volume} onChange={(ev) => setC({ ...c, volume: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Type piece">
                <Select value={c.typePiece} onChange={(ev) => setC({ ...c, typePiece: ev.target.value })}
                  options={[{ value: 'salon', label: 'Salon (4 ACH)' }, { value: 'chambre', label: 'Chambre (4)' }, { value: 'cuisine', label: 'Cuisine (8)' }, { value: 'salle_bain', label: 'Salle bain (8)' }, { value: 'sous_sol', label: 'Sous-sol (3)' }, { value: 'garage', label: 'Garage (6)' }, { value: 'atelier', label: 'Atelier (10)' }, { value: 'commercial', label: 'Commercial (6)' }, { value: 'restaurant', label: 'Restaurant (12)' }, { value: 'laboratoire', label: 'Laboratoire (15)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcHvacCfm({ volume_m3: c.volume, type_piece: c.typePiece })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {hvacCfmResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="CFM requis" value={hvacCfmResult.cfmRequis} highlight />
                <ResultBox label="ACH" value={hvacCfmResult.ach} />
                <ResultBox label="Volume" value={hvacCfmResult.volumePi3} unit="pi3" />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'hrv' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">HRV/ERV ASHRAE 62.2</h3>
            <div className="space-y-3">
              <FieldRow label="Surface (m2)"><Input type="number" value={h.surface} onChange={(ev) => setH({ ...h, surface: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Nb chambres"><Input type="number" value={h.chambres} onChange={(ev) => setH({ ...h, chambres: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Nb occupants"><Input type="number" value={h.occupants} onChange={(ev) => setH({ ...h, occupants: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcHvacHrv({ surface_m2: h.surface, nb_chambres: h.chambres, nb_occupants: h.occupants })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {hvacHrvResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="CFM recommande" value={hvacHrvResult.cfmRecommande} highlight />
                <ResultBox label="HRV recommande" value={hvacHrvResult.tailleHrvRecommandeeCfm} unit="CFM" highlight />
                <ResultBox label="62.2" value={hvacHrvResult.cfmMin622} />
                <ResultBox label="Occupants" value={hvacHrvResult.cfmOccupants} />
              </div>
              <div className="mt-2 text-xs">{hvacHrvResult.norme}</div>
            </Card>
          )}
        </div>
      )}
      {sub === 'cooling' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Climatisation (gains solaires)</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Surface vitree (m2)"><Input type="number" value={co.surfaceVitree} onChange={(ev) => setCo({ ...co, surfaceVitree: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Orientation">
                <Select value={co.orientation} onChange={(ev) => setCo({ ...co, orientation: ev.target.value as typeof co.orientation })}
                  options={[{ value: 'nord', label: 'Nord' }, { value: 'sud', label: 'Sud' }, { value: 'est', label: 'Est' }, { value: 'ouest', label: 'Ouest' }, { value: 'mixte', label: 'Mixte' }]} />
              </FieldRow>
              <FieldRow label="SHGC"><Input type="number" step="0.05" value={co.shgc} onChange={(ev) => setCo({ ...co, shgc: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Rayonnement (W/m2)"><Input type="number" value={co.rayonnement} onChange={(ev) => setCo({ ...co, rayonnement: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Occupants"><Input type="number" value={co.occupants} onChange={(ev) => setCo({ ...co, occupants: parseInt(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Equip. (W)"><Input type="number" value={co.equipements} onChange={(ev) => setCo({ ...co, equipements: parseFloat(ev.target.value) || 0 })} /></FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcHvacCooling({ surface_vitree_m2: co.surfaceVitree, orientation: co.orientation, shgc: co.shgc, rayonnement_w_m2: co.rayonnement, nb_occupants: co.occupants, equipements_w: co.equipements })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {hvacCoolingResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Gain total" value={hvacCoolingResult.gainTotalBtuH} unit="BTU/h" highlight />
                <ResultBox label="Tonnage" value={hvacCoolingResult.tonnageClimRequis} unit="t" highlight />
                <ResultBox label="Solaire" value={hvacCoolingResult.gainSolaireW} unit="W" />
                <ResultBox label="Occupants" value={hvacCoolingResult.gainOccupantsW} unit="W" />
                <ResultBox label="Équipements" value={hvacCoolingResult.gainEquipementsW} unit="W" />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function WeldingPanel() {
  const { weldingResult, weldingHeatInputResult, weldingPreheatResult,
    calcWelding, calcWeldingHeatInput, calcWeldingPreheat, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'angle' | 'heat' | 'preheat'>('angle');
  const [w, setW] = useState({ typeJoint: 'angle' as const, epaisseur: 6, longueur: 300, procede: 'SMAW' as const });
  const [h, setH] = useState({ tension: 25, amperage: 150, vitesse: 150 });
  const [p, setP] = useState({ c: 0.2, mn: 0.6, cr: 0, mo: 0, v: 0, ni: 0, cu: 0, epaisseur: 12 });
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b pb-2">
        {[['angle', 'Soudure angle'], ['heat', 'Heat Input'], ['preheat', 'Préchauffage CE']].map(([k, l]) => (
          <button type="button" key={k} onClick={() => setSub(k as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === k ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{l}</button>
        ))}
      </div>
      {sub === 'angle' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Soudure d'angle (CSA W47.1)</h3>
            <div className="space-y-3">
              <FieldRow label="Type joint">
                <Select value={w.typeJoint} onChange={(ev) => setW({ ...w, typeJoint: ev.target.value as typeof w.typeJoint })}
                  options={[{ value: 'angle', label: 'Angle' }, { value: 'bout_a_bout', label: 'Bout a bout' }, { value: 'en_T', label: 'En T' }, { value: 'recouvrement', label: 'Recouvrement' }]} />
              </FieldRow>
              <FieldRow label="Epaisseur (mm)"><Input type="number" value={w.epaisseur} onChange={(ev) => setW({ ...w, epaisseur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Longueur soudure (mm)"><Input type="number" value={w.longueur} onChange={(ev) => setW({ ...w, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Procede">
                <Select value={w.procede} onChange={(ev) => setW({ ...w, procede: ev.target.value as typeof w.procede })}
                  options={[{ value: 'SMAW', label: 'SMAW (baguette)' }, { value: 'GMAW', label: 'GMAW (MIG)' }, { value: 'FCAW', label: 'FCAW (fourre)' }, { value: 'GTAW', label: 'GTAW (TIG)' }, { value: 'SAW', label: 'SAW (arc submerge)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcWelding({ type_joint: w.typeJoint, epaisseur_mm: w.epaisseur, longueur_soudure_mm: w.longueur, procede: w.procede })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {weldingResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Gorge" value={weldingResult.gorgeMm} unit="mm" highlight />
                <ResultBox label="Jambe" value={weldingResult.jambeMm} unit="mm" />
                <ResultBox label="Volume" value={weldingResult.volumeSoudureCm3} unit="cm3" />
                <ResultBox label="Poids déposé" value={weldingResult.poidsMetalDeposeG} unit="g" />
                <ResultBox label="Consommation" value={weldingResult.consommationElectrodeG} unit="g" highlight />
                <ResultBox label="Facteur waste" value={weldingResult.facteurWaste} />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'heat' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Heat Input (kJ/mm)</h3>
            <div className="space-y-3">
              <FieldRow label="Tension (V)"><Input type="number" step="0.1" value={h.tension} onChange={(ev) => setH({ ...h, tension: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Amperage (A)"><Input type="number" value={h.amperage} onChange={(ev) => setH({ ...h, amperage: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Vitesse (mm/min)"><Input type="number" value={h.vitesse} onChange={(ev) => setH({ ...h, vitesse: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcWeldingHeatInput({ tension_v: h.tension, amperage_a: h.amperage, vitesse_mm_min: h.vitesse })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {weldingHeatInputResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Heat Input" value={weldingHeatInputResult.heatInputKjMm} unit="kJ/mm" highlight />
                <ResultBox label="Heat Input" value={weldingHeatInputResult.heatInputJMm} unit="J/mm" />
              </div>
              <div className="mt-2 text-xs">
                <div>Acier carbone: {weldingHeatInputResult.evaluationAcierCarbone}</div>
                <div>Inox/Alu: {weldingHeatInputResult.evaluationInoxAluminium}</div>
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'preheat' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Carbone équivalent (IIW)</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="C (%)"><Input type="number" step="0.01" value={p.c} onChange={(ev) => setP({ ...p, c: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Mn (%)"><Input type="number" step="0.01" value={p.mn} onChange={(ev) => setP({ ...p, mn: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Cr (%)"><Input type="number" step="0.01" value={p.cr} onChange={(ev) => setP({ ...p, cr: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Mo (%)"><Input type="number" step="0.01" value={p.mo} onChange={(ev) => setP({ ...p, mo: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="V (%)"><Input type="number" step="0.01" value={p.v} onChange={(ev) => setP({ ...p, v: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Ni (%)"><Input type="number" step="0.01" value={p.ni} onChange={(ev) => setP({ ...p, ni: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Cu (%)"><Input type="number" step="0.01" value={p.cu} onChange={(ev) => setP({ ...p, cu: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Epaisseur (mm)"><Input type="number" value={p.epaisseur} onChange={(ev) => setP({ ...p, epaisseur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcWeldingPreheat({ carbone_pct: p.c, manganese_pct: p.mn, chrome_pct: p.cr, molybdene_pct: p.mo, vanadium_pct: p.v, nickel_pct: p.ni, cuivre_pct: p.cu, epaisseur_mm: p.epaisseur })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {weldingPreheatResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="CE" value={weldingPreheatResult.carboneEquivalent} highlight />
                <ResultBox label="Risque" value={weldingPreheatResult.niveauRisqueFissuration} />
                <ResultBox label="Préchauffage" value={weldingPreheatResult.temperaturePrechauffageC} unit="C" highlight />
              </div>
              <div className="mt-2 text-xs font-mono">{weldingPreheatResult.formule}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function BendingPanel() {
  const { bendingResult, bendingSpringbackResult, bendingMinRadiusResult,
    calcBending, calcBendingSpringback, calcBendingMinRadius, isLoading } = useCalculatorsStore();
  const [sub, setSub] = useState<'dev' | 'springback' | 'rmin'>('dev');
  const [f, setF] = useState({ longueur: 500, epaisseur: 3, angle: 90, rayon: 3, largeur: 200, materiau: 'acier_doux_a36' });
  const [s, setS] = useState({ angle: 90, materiau: 'acier_doux_a36' });
  const [r, setR] = useState({ epaisseur: 3, materiau: 'acier_doux_a36' });
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b pb-2">
        {[['dev', 'Developpement'], ['springback', 'Springback'], ['rmin', 'Rayon min']].map(([k, l]) => (
          <button type="button" key={k} onClick={() => setSub(k as typeof sub)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${sub === k ? 'bg-[#7BAFD4]/20 text-[#4a7fa8] dark:bg-[#7BAFD4]/10 dark:text-[#9BC8E4]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>{l}</button>
        ))}
      </div>
      {sub === 'dev' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Développement + tonnage (Air Bending)</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Longueur (mm)"><Input type="number" value={f.longueur} onChange={(ev) => setF({ ...f, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Epaisseur (mm)"><Input type="number" value={f.epaisseur} onChange={(ev) => setF({ ...f, epaisseur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Angle (deg)"><Input type="number" value={f.angle} onChange={(ev) => setF({ ...f, angle: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Rayon int (mm)"><Input type="number" step="0.5" value={f.rayon} onChange={(ev) => setF({ ...f, rayon: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Largeur (mm)"><Input type="number" value={f.largeur} onChange={(ev) => setF({ ...f, largeur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Materiau">
                <Select value={f.materiau} onChange={(ev) => setF({ ...f, materiau: ev.target.value })}
                  options={[{ value: 'acier_doux_a36', label: 'Acier doux A36' }, { value: 'inox_304', label: 'Inox 304' }, { value: 'inox_316', label: 'Inox 316' }, { value: 'alu_6061_t6', label: 'Alu 6061-T6' }, { value: 'alu_5052_h32', label: 'Alu 5052-H32' }, { value: 'cuivre', label: 'Cuivre' }, { value: 'titane_gr2', label: 'Titane Grade 2' }, { value: 'galvanise', label: 'Galvanise' }]} />
              </FieldRow>
            </div>
            <Button className="mt-3" leftIcon={<Calculator size={16} />} onClick={() => calcBending({ longueur_piece_mm: f.longueur, epaisseur_mm: f.epaisseur, angle_pliage_deg: f.angle, rayon_interieur_mm: f.rayon, largeur_piece_mm: f.largeur, materiau: f.materiau })} isLoading={isLoading}>Calculer</Button>
          </Card>
          {bendingResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              {bendingResult.risqueFissure && <Alert type="warning">Rayon trop petit - risque de fissure!</Alert>}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <ResultBox label="Long. dev." value={bendingResult.longueurDeveloppeeMm} unit="mm" highlight />
                <ResultBox label="K-factor" value={bendingResult.kFactor} />
                <ResultBox label="Bend Allowance" value={bendingResult.bendAllowanceMm} unit="mm" />
                <ResultBox label="Bend Deduction" value={bendingResult.bendDeductionMm} unit="mm" />
                <ResultBox label="Tonnage" value={bendingResult.tonnageRequisKn} unit="kN" highlight />
                <ResultBox label="Ouverture V" value={bendingResult.ouvertureVMm} unit="mm" />
                <ResultBox label="Rayon min" value={bendingResult.rayonMinimumMm} unit="mm" />
                <ResultBox label="Springback 90" value={bendingResult.springback90Deg} unit="deg" />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'springback' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Compensation springback</h3>
            <div className="space-y-3">
              <FieldRow label="Angle voulu (deg)"><Input type="number" value={s.angle} onChange={(ev) => setS({ ...s, angle: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Materiau">
                <Select value={s.materiau} onChange={(ev) => setS({ ...s, materiau: ev.target.value })}
                  options={[{ value: 'acier_doux_a36', label: 'Acier doux (0.5 deg)' }, { value: 'inox_304', label: 'Inox 304 (2.0 deg)' }, { value: 'alu_6061_t6', label: 'Alu 6061 (3.0 deg)' }, { value: 'titane_gr2', label: 'Titane Gr2 (4.0 deg)' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcBendingSpringback({ angle_voulu_deg: s.angle, materiau: s.materiau })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {bendingSpringbackResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Angle a plier" value={bendingSpringbackResult.angleAPlierDeg} unit="deg" highlight />
                <ResultBox label="Springback" value={bendingSpringbackResult.springbackCalculeDeg} unit="deg" />
              </div>
            </Card>
          )}
        </div>
      )}
      {sub === 'rmin' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Rayon minimum (sans fissure)</h3>
            <div className="space-y-3">
              <FieldRow label="Epaisseur (mm)"><Input type="number" value={r.epaisseur} onChange={(ev) => setR({ ...r, epaisseur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
              <FieldRow label="Materiau">
                <Select value={r.materiau} onChange={(ev) => setR({ ...r, materiau: ev.target.value })}
                  options={[{ value: 'acier_doux_a36', label: 'Acier doux' }, { value: 'inox_304', label: 'Inox 304' }, { value: 'alu_6061_t6', label: 'Alu 6061-T6' }, { value: 'titane_gr2', label: 'Titane Gr2' }]} />
              </FieldRow>
              <Button leftIcon={<Calculator size={16} />} onClick={() => calcBendingMinRadius({ epaisseur_mm: r.epaisseur, materiau: r.materiau })} isLoading={isLoading}>Calculer</Button>
            </div>
          </Card>
          {bendingMinRadiusResult && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Résultats</h3>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="Rayon min" value={bendingMinRadiusResult.rayonMinimumMm} unit="mm" highlight />
                <ResultBox label="Rayon min" value={bendingMinRadiusResult.rayonMinimumPo} unit="po" />
                <ResultBox label="Facteur" value={bendingMinRadiusResult.facteurRmin} />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

const METAL_DIM_DEFAULTS: Record<string, Record<string, number>> = {
  plaque:       { longueur: 1000, largeur: 500, epaisseur: 10 },
  tube_rond:    { rayon_ext: 50, rayon_int: 40, longueur: 1000 },
  tube_carre:   { cote_ext: 80, epaisseur: 5, longueur: 1000 },
  barre_ronde:  { rayon: 25, longueur: 1000 },
  barre_carree: { cote: 40, longueur: 1000 },
  angle:        { aile_a: 75, aile_b: 75, epaisseur: 8, longueur: 1000 },
  poutre_i:     { hauteur: 200, largeur_aile: 100, epaisseur_ame: 8, epaisseur_aile: 12, longueur: 1000 },
  profil_w:     { longueur: 1000 },
  profil_c:     { longueur: 1000 },
};

function MetalWeightPanel() {
  const { metalWeightResult, calcMetalWeight, isLoading, constants } = useCalculatorsStore();
  const [forme, setForme] = useState<'plaque' | 'tube_rond' | 'barre_ronde' | 'tube_carre' | 'barre_carree' | 'angle' | 'poutre_i' | 'profil_w' | 'profil_c'>('plaque');
  const [materiau, setMateriau] = useState('acier_a36');
  const [dims, setDims] = useState<Record<string, number>>(METAL_DIM_DEFAULTS.plaque);
  const [sectionKey, setSectionKey] = useState('W200x22');
  const metauxList = constants?.metaux ? Object.entries(constants.metaux).map(([k, v]) => ({ value: k, label: v.label })) : [{ value: 'acier_a36', label: 'Acier A36' }];
  const profilsW = constants?.profilesW || [];
  const profilsC = constants?.profilesC || [];

  // Reset dimensions when forme changes
  useEffect(() => {
    setDims({ ...METAL_DIM_DEFAULTS[forme] });
  }, [forme]);

  // Sync sectionKey when forme OR profile list changes (async constants load)
  useEffect(() => {
    if (forme === 'profil_w') {
      const firstW = profilsW[0];
      if (firstW && !profilsW.includes(sectionKey)) {
        setSectionKey(firstW);
      }
    } else if (forme === 'profil_c') {
      const firstC = profilsC[0];
      if (firstC && !profilsC.includes(sectionKey)) {
        setSectionKey(firstC);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forme, profilsW, profilsC]);

  const handleCalc = () => {
    if (forme === 'profil_w' || forme === 'profil_c') {
      calcMetalWeight({ forme, materiau, dimensions: { section_key: sectionKey, longueur: dims.longueur || 1000 } });
    } else {
      calcMetalWeight({ forme, materiau, dimensions: dims });
    }
  };

  const getDimFields = () => {
    if (forme === 'plaque') return ['longueur', 'largeur', 'epaisseur'];
    if (forme === 'tube_rond') return ['rayon_ext', 'rayon_int', 'longueur'];
    if (forme === 'tube_carre') return ['cote_ext', 'epaisseur', 'longueur'];
    if (forme === 'barre_ronde') return ['rayon', 'longueur'];
    if (forme === 'barre_carree') return ['cote', 'longueur'];
    if (forme === 'angle') return ['aile_a', 'aile_b', 'epaisseur', 'longueur'];
    if (forme === 'poutre_i') return ['hauteur', 'largeur_aile', 'epaisseur_ame', 'epaisseur_aile', 'longueur'];
    return [];
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Poids métal (20+ matériaux)</h3>
        <div className="space-y-3">
          <FieldRow label="Forme">
            <Select value={forme} onChange={(ev) => setForme(ev.target.value as typeof forme)}
              options={[{ value: 'plaque', label: 'Plaque' }, { value: 'tube_rond', label: 'Tube rond' }, { value: 'tube_carre', label: 'Tube carre' }, { value: 'barre_ronde', label: 'Barre ronde' }, { value: 'barre_carree', label: 'Barre carree' }, { value: 'angle', label: 'Angle (L)' }, { value: 'poutre_i', label: 'Poutre I' }, { value: 'profil_w', label: 'Profile W (AISC)' }, { value: 'profil_c', label: 'Profile C (UPN)' }]} />
          </FieldRow>
          <FieldRow label="Materiau">
            <Select value={materiau} onChange={(ev) => setMateriau(ev.target.value)} options={metauxList} />
          </FieldRow>
          {(forme === 'profil_w' || forme === 'profil_c') && (
            <>
              <FieldRow label="Section">
                <Select value={sectionKey} onChange={(ev) => setSectionKey(ev.target.value)}
                  options={
                    (forme === 'profil_w' ? profilsW : profilsC).length > 0
                      ? (forme === 'profil_w' ? profilsW : profilsC).map(p => ({ value: p, label: p }))
                      : [{ value: '', label: 'Chargement...' }]
                  } />
              </FieldRow>
              <FieldRow label="Longueur (mm)"><Input type="number" value={dims.longueur || 1000} onChange={(ev) => setDims({ ...dims, longueur: parseFloat(ev.target.value) || 0 })} /></FieldRow>
            </>
          )}
          {forme !== 'profil_w' && forme !== 'profil_c' && getDimFields().map(key => (
            <FieldRow key={key} label={`${key.replace(/_/g, ' ')} (mm)`}>
              <Input type="number" value={dims[key] ?? 0} onChange={(ev) => setDims({ ...dims, [key]: parseFloat(ev.target.value) || 0 })} />
            </FieldRow>
          ))}
          <Button leftIcon={<Calculator size={16} />} onClick={handleCalc} isLoading={isLoading}>Calculer</Button>
        </div>
      </Card>
      {metalWeightResult && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Résultats</h3>
          <div className="grid grid-cols-2 gap-2">
            <ResultBox label="Poids" value={metalWeightResult.poidsKg ?? metalWeightResult.masseTotaleKg ?? 0} unit="kg" highlight />
            <ResultBox label="Poids" value={metalWeightResult.poidsLb ?? metalWeightResult.masseTotaleLb ?? 0} unit="lb" />
            {metalWeightResult.volumeM3 !== undefined && <ResultBox label="Volume" value={metalWeightResult.volumeM3} unit="m3" />}
            {metalWeightResult.densiteKgM3 && <ResultBox label="Densite" value={metalWeightResult.densiteKgM3} unit="kg/m3" />}
            {metalWeightResult.coutEstimeCad !== undefined && <ResultBox label="Coût" value={metalWeightResult.coutEstimeCad} unit="$" highlight />}
            {metalWeightResult.section && <ResultBox label="Section" value={metalWeightResult.section} />}
          </div>
        </Card>
      )}
    </div>
  );
}

function TaxesPanel() {
  const { taxesResult, calcTaxes, isLoading } = useCalculatorsStore();
  const [montant, setMontant] = useState(1000);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Taxes Québec (TPS + TVQ)</h3>
        <div className="space-y-3">
          <FieldRow label="Montant HT ($)"><Input type="number" value={montant} onChange={(ev) => setMontant(parseFloat(ev.target.value) || 0)} /></FieldRow>
          <Button leftIcon={<Calculator size={16} />} onClick={() => calcTaxes({ montant_ht: montant })} isLoading={isLoading}>Calculer</Button>
        </div>
      </Card>
      {taxesResult && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Résultats</h3>
          <div className="grid grid-cols-2 gap-2">
            <ResultBox label="HT" value={taxesResult.montantHt} unit="$" />
            <ResultBox label="TPS (5%)" value={taxesResult.tps} unit="$" />
            <ResultBox label="TVQ (9.975%)" value={taxesResult.tvq} unit="$" />
            <ResultBox label="TTC" value={taxesResult.totalTtc} unit="$" highlight />
          </div>
        </Card>
      )}
    </div>
  );
}

function PaiePanel() {
  const { chargeTributaireResult, calcChargeTributaire, isLoading } = useCalculatorsStore();
  const [salaire, setSalaire] = useState(55000);
  const [type, setType] = useState<'regulier' | 'construction_ccq'>('regulier');
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Charges de paie (Québec)</h3>
        <div className="space-y-3">
          <FieldRow label="Salaire brut ($)"><Input type="number" value={salaire} onChange={(ev) => setSalaire(parseFloat(ev.target.value) || 0)} /></FieldRow>
          <FieldRow label="Type employé">
            <Select value={type} onChange={(ev) => setType(ev.target.value as typeof type)}
              options={[{ value: 'regulier', label: 'Regulier' }, { value: 'construction_ccq', label: 'Construction CCQ' }]} />
          </FieldRow>
          <Button leftIcon={<Calculator size={16} />} onClick={() => calcChargeTributaire({ salaire_brut: salaire, type_employe: type })} isLoading={isLoading}>Calculer</Button>
        </div>
      </Card>
      {chargeTributaireResult && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Résultats</h3>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Déductions employé</div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="RRQ" value={chargeTributaireResult.deductionsEmploye.rrq} unit="$" />
                <ResultBox label="RQAP" value={chargeTributaireResult.deductionsEmploye.rqap} unit="$" />
                <ResultBox label="AE" value={chargeTributaireResult.deductionsEmploye.ae} unit="$" />
                <ResultBox label="Total deductions" value={chargeTributaireResult.deductionsEmploye.total} unit="$" highlight />
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Charges employeur</div>
              <div className="grid grid-cols-2 gap-2">
                <ResultBox label="CNESST" value={chargeTributaireResult.chargesEmployeur.cnesst} unit="$" />
                <ResultBox label="FSS" value={chargeTributaireResult.chargesEmployeur.fss} unit="$" />
                {chargeTributaireResult.chargesEmployeur.ccq !== undefined && <ResultBox label="CCQ" value={chargeTributaireResult.chargesEmployeur.ccq} unit="$" />}
                <ResultBox label="Total charges" value={chargeTributaireResult.chargesEmployeur.total} unit="$" highlight />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <ResultBox label="Salaire net" value={chargeTributaireResult.salaireNet} unit="$" highlight />
              <ResultBox label="Coût total" value={chargeTributaireResult.coutTotalEmployeur} unit="$" highlight />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function StructuralTab() {
  const { structuralResult, structuralMaterials, calcStructural, fetchStructuralMaterials, isLoading } = useCalculatorsStore();
  const [f, setF] = useState<{
    typeElement: 'poutre' | 'linteau' | 'colonne';
    typeMateriau: 'bois_dimensionnel' | 'lvl';
    section: string;
    plyCount: number;
    porteeMm: number;
    chargeMorteKpa: number;
    chargeViveKpa: number;
    chargeNeigeKpa: number;
    largeurTributaireM: number;
    typeUtilisation: 'plancher' | 'toit' | 'linteau';
  }>({
    typeElement: 'poutre',
    typeMateriau: 'bois_dimensionnel',
    section: '2x10',
    plyCount: 1,
    porteeMm: 3000,
    chargeMorteKpa: 0.5,
    chargeViveKpa: 1.9,
    chargeNeigeKpa: 0,
    largeurTributaireM: 3,
    typeUtilisation: 'plancher',
  });

  useEffect(() => { fetchStructuralMaterials(); }, [fetchStructuralMaterials]);

  const sections = useMemo(() => {
    if (f.typeMateriau === 'bois_dimensionnel') return structuralMaterials?.boisDimensionnel?.sections ?? [];
    return structuralMaterials?.lvl?.sections ?? [];
  }, [f.typeMateriau, structuralMaterials]);

  useEffect(() => {
    if (sections.length > 0 && !sections.includes(f.section)) {
      setF(prev => ({ ...prev, section: sections[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Ruler size={18} /> Analyse structurale (CNBC / CSA O86)</h3>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Type element">
            <Select value={f.typeElement} onChange={(ev) => setF({ ...f, typeElement: ev.target.value as typeof f.typeElement })}
              options={[{ value: 'poutre', label: 'Poutre' }, { value: 'linteau', label: 'Linteau' }, { value: 'colonne', label: 'Colonne' }]} />
          </FieldRow>
          <FieldRow label="Type materiau">
            <Select value={f.typeMateriau} onChange={(ev) => setF({ ...f, typeMateriau: ev.target.value as typeof f.typeMateriau })}
              options={[{ value: 'bois_dimensionnel', label: 'Bois dimensionnel (SPF)' }, { value: 'lvl', label: 'LVL' }]} />
          </FieldRow>
          <FieldRow label="Section">
            <Select value={f.section} onChange={(ev) => setF({ ...f, section: ev.target.value })}
              options={sections.map(s => ({ value: s, label: s }))} />
          </FieldRow>
          <FieldRow label="Ply count"><Input type="number" value={f.plyCount} onChange={(ev) => setF({ ...f, plyCount: parseInt(ev.target.value) || 1 })} /></FieldRow>
          <FieldRow label="Portee (mm)"><Input type="number" value={f.porteeMm} onChange={(ev) => setF({ ...f, porteeMm: parseFloat(ev.target.value) || 0 })} /></FieldRow>
          <FieldRow label="Largeur tributaire (m)"><Input type="number" step="0.1" value={f.largeurTributaireM} onChange={(ev) => setF({ ...f, largeurTributaireM: parseFloat(ev.target.value) || 0 })} /></FieldRow>
          <FieldRow label="Charge morte (kPa)"><Input type="number" step="0.1" value={f.chargeMorteKpa} onChange={(ev) => setF({ ...f, chargeMorteKpa: parseFloat(ev.target.value) || 0 })} /></FieldRow>
          <FieldRow label="Charge vive (kPa)"><Input type="number" step="0.1" value={f.chargeViveKpa} onChange={(ev) => setF({ ...f, chargeViveKpa: parseFloat(ev.target.value) || 0 })} /></FieldRow>
          <FieldRow label="Charge neige (kPa)"><Input type="number" step="0.1" value={f.chargeNeigeKpa} onChange={(ev) => setF({ ...f, chargeNeigeKpa: parseFloat(ev.target.value) || 0 })} /></FieldRow>
          <FieldRow label="Utilisation">
            <Select value={f.typeUtilisation} onChange={(ev) => setF({ ...f, typeUtilisation: ev.target.value as typeof f.typeUtilisation })}
              options={[{ value: 'plancher', label: 'Plancher (L/360)' }, { value: 'toit', label: 'Toit (L/180)' }, { value: 'linteau', label: 'Linteau (L/360)' }]} />
          </FieldRow>
        </div>
        <Button className="mt-3 w-full" leftIcon={<Calculator size={16} />}
          onClick={() => calcStructural({ type_element: f.typeElement, type_materiau: f.typeMateriau, section: f.section, ply_count: f.plyCount, portee_mm: f.porteeMm, charge_morte_kpa: f.chargeMorteKpa, charge_vive_kpa: f.chargeViveKpa, charge_neige_kpa: f.chargeNeigeKpa, largeur_tributaire_m: f.largeurTributaireM, type_utilisation: f.typeUtilisation })}
          isLoading={isLoading}>Analyser</Button>
      </Card>

      {structuralResult && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Résultats</h3>
          <div className={`p-3 rounded-lg mb-3 ${structuralResult.verification.globalOk ? 'bg-[#7DC4A5]/10 dark:bg-[#7DC4A5]/10' : 'bg-[#E8919A]/10 dark:bg-[#E8919A]/10'}`}>
            <div className="text-lg font-bold">{structuralResult.verification.verdict}</div>
            <div className="text-xs">{structuralResult.titre}</div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: structuralResult.svgDiagram }} className="mb-3" />
          <div className="grid grid-cols-2 gap-2">
            <ResultBox label="M max" value={structuralResult.efforts.mMaxKnm} unit="kNm" />
            <ResultBox label="V max" value={structuralResult.efforts.vMaxKn} unit="kN" />
            <ResultBox label="Delta" value={structuralResult.efforts.deltaMm} unit="mm" />
            <ResultBox label="Mr" value={structuralResult.resistanceCsaO86.mrKnm} unit="kNm" highlight />
            <ResultBox label="Vr" value={structuralResult.resistanceCsaO86.vrKn} unit="kN" />
            <ResultBox label="w ULS" value={structuralResult.combinaisonsCnbc.wUlsKnM} unit="kN/m" />
          </div>
          <div className="mt-3 space-y-1 text-xs">
            <div>Flexion: <strong>{(structuralResult.verification.flexion.ratio * 100).toFixed(1)}%</strong> {structuralResult.verification.flexion.ok ? '✓' : '✗'}</div>
            <div>Cisaillement: <strong>{(structuralResult.verification.cisaillement.ratio * 100).toFixed(1)}%</strong> {structuralResult.verification.cisaillement.ok ? '✓' : '✗'}</div>
            <div>Fleche: <strong>{(structuralResult.verification.fleche.ratio * 100).toFixed(1)}%</strong> {structuralResult.verification.fleche.ok ? '✓' : '✗'}</div>
          </div>
        </Card>
      )}
    </div>
  );
}

function IaTab() {
  const { aiChatHistory, isAiRunning, aiChat, clearAiChat, aiAnalyzeResult, aiRecommendResult,
    aiExplainNormResult, aiDiagnoseResult, aiOptimizeResult, aiAnalyze, aiRecommend, aiExplainNorm, aiDiagnose, aiOptimize } = useCalculatorsStore();
  const [aiSub, setAiSub] = useState<'chat' | 'analyze' | 'recommend' | 'norme' | 'diagnose' | 'optimize'>('chat');
  const [question, setQuestion] = useState('');
  const [selectedCalc, setSelectedCalc] = useState<string>('');
  const [objectif, setObjectif] = useState('');
  const [contraintes, setContraintes] = useState('');
  const [norme, setNorme] = useState('');
  const [probleme, setProbleme] = useState('');
  const [symptomes, setSymptomes] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap border-b border-gray-200 dark:border-gray-700 pb-2">
        {[
          ['chat', 'Chat Expert', <Send size={14} />],
          ['analyze', 'Analyser calcul', <Sparkles size={14} />],
          ['recommend', 'Recommandations', <Sparkles size={14} />],
          ['norme', 'Expliquer norme', <Sparkles size={14} />],
          ['diagnose', 'Diagnostic', <Sparkles size={14} />],
          ['optimize', 'Optimiser', <Sparkles size={14} />],
        ].map(([k, l, icon]) => (
          <button type="button" key={k as string} onClick={() => setAiSub(k as typeof aiSub)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg ${aiSub === k ? 'bg-[#B09BD8]/20 text-[#7a6ba8] dark:bg-[#B09BD8]/10 dark:text-[#c8b4e0]' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
            {icon} {l}
          </button>
        ))}
      </div>

      {aiSub === 'chat' && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">Chat expert construction Québec</h3>
            {aiChatHistory.length > 0 && <Button leftIcon={<Trash2 size={14} />} onClick={clearAiChat}>Effacer</Button>}
          </div>
          <div className="space-y-3 mb-3 max-h-96 overflow-y-auto">
            {aiChatHistory.length === 0 && <p className="text-sm text-gray-500">Posez une question a l'expert...</p>}
            {aiChatHistory.map((msg, i) => (
              <div key={`${msg.timestamp}-${msg.role}-${i}`} className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-[#7BAFD4]/10 dark:bg-[#7BAFD4]/10 ml-8' : 'bg-gray-50 dark:bg-gray-800 mr-8'}`}>
                <div className="text-xs font-semibold mb-1">{msg.role === 'user' ? 'Vous' : 'Claude Opus 4.6'}</div>
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Select value={selectedCalc} onChange={(ev) => setSelectedCalc(ev.target.value)}
              options={[{ value: '', label: 'General' }, ...CALC_DEFS.map(c => ({ value: c.id, label: c.name }))]} />
            <Input type="text" value={question} onChange={(ev) => setQuestion(ev.target.value)} placeholder="Posez votre question..." />
            <Button leftIcon={<Send size={14} />} isLoading={isAiRunning} onClick={() => { if (question.trim()) { aiChat({ question, calculator_id: selectedCalc || undefined }); setQuestion(''); } }}>Envoyer</Button>
          </div>
        </Card>
      )}

      {aiSub === 'norme' && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Expliquer une norme / article</h3>
          <div className="space-y-3">
            <FieldRow label="Norme ou article"><Input value={norme} onChange={(ev) => setNorme(ev.target.value)} placeholder="Ex: CCQ 9.8, CSA A23.1 Table 2, CCE 8-200" /></FieldRow>
            <Button leftIcon={<Sparkles size={16} />} isLoading={isAiRunning} onClick={() => { if (norme.trim()) aiExplainNorm({ norme }); }}>Expliquer</Button>
            {aiExplainNormResult && (
              <div className="mt-3 p-3 bg-[#B09BD8]/10 dark:bg-[#B09BD8]/10 rounded-lg space-y-2">
                <div className="font-bold">{aiExplainNormResult.titreOfficiel}</div>
                <div className="text-xs">{aiExplainNormResult.organismeEmetteur} - {aiExplainNormResult.versionAnnee}</div>
                <div className="text-sm whitespace-pre-wrap">{aiExplainNormResult.explication}</div>
                {aiExplainNormResult.exigencesPrincipales.length > 0 && (
                  <div>
                    <div className="font-semibold text-xs mt-2">Exigences principales:</div>
                    <ul className="list-disc list-inside text-xs">{aiExplainNormResult.exigencesPrincipales.map((e, i) => <li key={`${i}-${e.slice(0, 20)}`}>{e}</li>)}</ul>
                  </div>
                )}
                {aiExplainNormResult.note && <div className="text-xs text-amber-700 dark:text-amber-300 italic">Note: {aiExplainNormResult.note}</div>}
              </div>
            )}
          </div>
        </Card>
      )}

      {aiSub === 'recommend' && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Recommandations expertes</h3>
          <div className="space-y-3">
            <FieldRow label="Calculateur">
              <Select value={selectedCalc} onChange={(ev) => setSelectedCalc(ev.target.value)}
                options={CALC_DEFS.map(c => ({ value: c.id, label: c.name }))} />
            </FieldRow>
            <FieldRow label="Objectif"><Input value={objectif} onChange={(ev) => setObjectif(ev.target.value)} placeholder="Ex: escalier exterieur resistant au gel" /></FieldRow>
            <FieldRow label="Contraintes (optionnel)"><Input value={contraintes} onChange={(ev) => setContraintes(ev.target.value)} placeholder="Budget, délai, etc." /></FieldRow>
            <Button leftIcon={<Sparkles size={16} />} isLoading={isAiRunning}
              onClick={() => { if (selectedCalc && objectif.trim()) aiRecommend({ calculator_id: selectedCalc, objectif, contraintes }); }}>
              Obtenir recommandations
            </Button>
            {aiRecommendResult && (
              <div className="mt-3 p-3 bg-[#B09BD8]/10 dark:bg-[#B09BD8]/10 rounded-lg space-y-2">
                <div className="font-bold">{aiRecommendResult.approcheRecommandee}</div>
                {aiRecommendResult.etapes.length > 0 && (
                  <div>
                    <div className="font-semibold text-xs">Étapes:</div>
                    <ol className="list-decimal list-inside text-xs">{aiRecommendResult.etapes.map((e, i) => <li key={`${i}-${e.slice(0, 20)}`}>{e}</li>)}</ol>
                  </div>
                )}
                {aiRecommendResult.coutsEstimes && <div className="text-xs">Couts estimes: {aiRecommendResult.coutsEstimes}</div>}
              </div>
            )}
          </div>
        </Card>
      )}

      {aiSub === 'diagnose' && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Diagnostic de problème</h3>
          <div className="space-y-3">
            <FieldRow label="Calculateur">
              <Select value={selectedCalc} onChange={(ev) => setSelectedCalc(ev.target.value)}
                options={CALC_DEFS.map(c => ({ value: c.id, label: c.name }))} />
            </FieldRow>
            <FieldRow label="Probleme"><Input value={probleme} onChange={(ev) => setProbleme(ev.target.value)} placeholder="Decrivez le probleme" /></FieldRow>
            <FieldRow label="Symptomes"><Input value={symptomes} onChange={(ev) => setSymptomes(ev.target.value)} placeholder="Ce que vous observez" /></FieldRow>
            <Button leftIcon={<Sparkles size={16} />} isLoading={isAiRunning}
              onClick={() => { if (selectedCalc && probleme.trim()) aiDiagnose({ calculator_id: selectedCalc, probleme, symptomes }); }}>
              Diagnostiquer
            </Button>
            {aiDiagnoseResult && (
              <div className="mt-3 p-3 bg-[#B09BD8]/10 dark:bg-[#B09BD8]/10 rounded-lg space-y-2">
                <div className="font-bold">{aiDiagnoseResult.diagnosticPrincipal}</div>
                <div className="text-xs">Urgence: <strong>{aiDiagnoseResult.urgence}</strong></div>
                {aiDiagnoseResult.causesProbables.length > 0 && (
                  <div>
                    <div className="font-semibold text-xs">Causes probables:</div>
                    <ul className="list-disc list-inside text-xs">{aiDiagnoseResult.causesProbables.map((c, i) => <li key={`${i}-${c.slice(0, 20)}`}>{c}</li>)}</ul>
                  </div>
                )}
                {aiDiagnoseResult.interventionProfessionnelle && <div className="text-xs text-red-600 font-semibold">⚠ Intervention professionnelle recommandee</div>}
              </div>
            )}
          </div>
        </Card>
      )}

      {(aiSub === 'analyze' || aiSub === 'optimize') && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">{aiSub === 'analyze' ? 'Analyser un calcul' : 'Optimisation'}</h3>
          <p className="text-sm text-gray-600">Effectuez d'abord un calcul dans l'onglet Calculateurs, puis revenez ici pour l'analyser avec l'IA.</p>
          {aiSub === 'analyze' && aiAnalyzeResult && (
            <div className="mt-3 p-3 bg-[#B09BD8]/10 dark:bg-[#B09BD8]/10 rounded-lg space-y-2">
              <div className="font-bold">Score: {aiAnalyzeResult.scoreConformite}/100</div>
              <div className="text-sm">{aiAnalyzeResult.evaluationGlobale}</div>
            </div>
          )}
          {aiSub === 'optimize' && aiOptimizeResult && (
            <div className="mt-3 p-3 bg-[#B09BD8]/10 dark:bg-[#B09BD8]/10 rounded-lg space-y-2">
              <div className="font-bold">{aiOptimizeResult.recommandationFinale}</div>
              <div className="text-sm">{aiOptimizeResult.economiesPotentielles}</div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function HistoriqueTab() {
  const { history, historyStats, fetchHistory, fetchHistoryStats, deleteHistoryItem, clearHistoryAll } = useCalculatorsStore();
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    fetchHistory(filter || undefined);
    fetchHistoryStats();
  }, [filter, fetchHistory, fetchHistoryStats]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="Total calculs" value={historyStats?.total ?? 0} icon={<HistoryIcon size={20} />} color="bg-[#7BAFD4]" />
        <KpiCard label="Calculateurs utilises" value={historyStats?.parCalculateur?.length ?? 0} icon={<Calculator size={20} />} color="bg-[#7DC4A5]" />
        <KpiCard label="30 derniers jours" value={historyStats?.parJour30?.reduce((sum, j) => sum + j.count, 0) ?? 0} icon={<BarChart3 size={20} />} color="bg-[#B09BD8]" />
      </div>

      <Card className="p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="flex gap-2 items-center">
            <Select value={filter} onChange={(ev) => setFilter(ev.target.value)}
              options={[{ value: '', label: 'Tous les calculateurs' }, ...CALC_DEFS.map(c => ({ value: c.id, label: c.name }))]} />
          </div>
          {history.length > 0 && (
            <Button leftIcon={<Trash2 size={14} />} onClick={async () => {
              if (confirm('Effacer tout l historique?')) {
                await clearHistoryAll(filter || undefined);
                await fetchHistoryStats();
              }
            }}>
              Effacer tout
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">Aucun calcul dans l'historique.</p>
        ) : (
          <div className="space-y-2">
            {history.map((item) => <HistoryItem key={item.id} item={item} onDelete={deleteHistoryItem} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

function HistoryItem({ item, onDelete }: { item: CalculatorHistoryItem; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const calcDef = CALC_DEFS.find(c => c.id === item.calculatorId);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {calcDef && <span className={`p-1 rounded ${calcDef.color} text-white`}>{calcDef.icon}</span>}
            <div className="font-medium text-sm">{item.label}</div>
          </div>
          <div className="text-xs text-gray-500">{new Date(item.createdAt).toLocaleString('fr-CA')}</div>
          {item.notes && <div className="text-xs text-gray-600 mt-1">{item.notes}</div>}
        </div>
        <div className="flex gap-1">
          <Button onClick={() => setExpanded(!expanded)}>{expanded ? 'Masquer' : 'Détails'}</Button>
          <Button leftIcon={<Trash2 size={14} />} onClick={() => onDelete(item.id)} />
        </div>
      </div>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
          <div className="font-semibold mb-1">Inputs:</div>
          <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto">{JSON.stringify(item.inputs, null, 2)}</pre>
          <div className="font-semibold mb-1 mt-2">Resultats:</div>
          <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto">{JSON.stringify(item.results, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function ConversionsTab() {
  const { conversions } = useCalculatorsStore();
  if (!conversions) return <Spinner />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Object.entries(conversions).map(([category, factors]) => (
        <Card key={category} className="p-4">
          <h3 className="font-semibold mb-3 capitalize">{category}</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(factors).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">{key.replace(/_/g, ' ')}</span>
                <span className="font-mono text-gray-900 dark:text-gray-100">{typeof value === 'number' ? (value ?? 0).toFixed(5) : String(value)}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
