/**
 * MurConformiteEntrepreneur - Phase 11 panneau Conformite EG Quebec
 *
 * Composant collapsible integrable dans l'onglet Mur de MursParametriquePanel.
 * Affiche:
 * 1. Configuration EG (toggles + selectors): type mur, emplacement, zone, batiment, Novoclimat, coupe-feu
 * 2. R-valeur requise (info box) + isolant recommande
 * 3. Estimation couts (materiaux + main-d'oeuvre CCQ + frais + TPS/TVQ + cout/pi2)
 * 4. Validations EG 11-20 (en complement des 10 de Phase 10)
 * 5. Compositions predefinies (boutons d'application rapide)
 *
 * Profil EG: vocabulaire terrain, normes CCQ/CNB/CSA O86 explicites, pas d'emoji.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Layers, DollarSign,
  Hammer, Thermometer, Flame, Wrench, ClipboardList,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import type {
  MurWall,
  MurOpening,
  MurPiece,
  MurValidation,
} from './MursParametriquePanel';
import {
  validateWallEg,
  calculateMurCost,
  getRequiredRValue,
  detectRequiredFireRating,
  COMPOSITIONS_PRESETS,
  R_VALUES_MIN,
  R_VALUES_NOVOCLIMAT,
  CCQ_RATES_2026,
  type MurEgConfig,
  type MurWallType,
  type MurWallLocation,
  type MurClimateZone,
  type MurBuildingType,
  type MurFireRating,
  type MurCompositionPreset,
} from './wallValidations';

// ============================================
// PROPS
// ============================================

export interface MurConformiteEntrepreneurProps {
  wall: MurWall;
  openings: MurOpening[];
  pieces: MurPiece[];
  egConfig: MurEgConfig;
  onChangeConfig: (config: Partial<MurEgConfig>) => void;
  onApplyComposition?: (preset: MurCompositionPreset) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

// ============================================
// HELPERS
// ============================================

const ACCENT = '#7BAFD4';

function formatMoney(v: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function getFireRatingLabel(rating: MurFireRating): string {
  const map: Record<MurFireRating, string> = {
    'aucun': 'Aucun',
    '45min': '45 min',
    '1h': '1 heure',
    '2h': '2 heures',
  };
  return map[rating];
}

function getFireRatingColor(rating: MurFireRating): { bg: string; text: string; border: string } {
  if (rating === '2h') return { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-800 dark:text-red-200', border: 'border-red-300 dark:border-red-700' };
  if (rating === '1h') return { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-800 dark:text-orange-200', border: 'border-orange-300 dark:border-orange-700' };
  if (rating === '45min') return { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-200', border: 'border-amber-300 dark:border-amber-700' };
  return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', border: 'border-gray-300 dark:border-gray-600' };
}

const ZONE_LABELS: Record<MurClimateZone, string> = {
  'montreal-laval': 'Montreal / Laval',
  'quebec-estrie': 'Quebec / Estrie',
  'saguenay-trois-rivieres': 'Saguenay / Trois-Rivieres',
  'nord-du-quebec': 'Nord du Quebec',
  'autre': 'Autre',
};

const BUILDING_LABELS: Record<MurBuildingType, string> = {
  'residentiel-neuf': 'Residentiel neuf',
  'residentiel-renovation': 'Residentiel renovation',
  'commercial': 'Commercial',
  'institutionnel': 'Institutionnel',
  'multi-logement': 'Multi-logement',
};

const LOCATION_LABELS: Record<MurWallLocation, string> = {
  'exterieur': 'Exterieur',
  'interieur': 'Interieur',
  'mitoyen': 'Mitoyen',
  'garage-attache': 'Garage attache',
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function MurConformiteEntrepreneur({
  wall,
  openings,
  pieces,
  egConfig,
  onChangeConfig,
  onApplyComposition,
  isExpanded,
  onToggleExpanded,
}: MurConformiteEntrepreneurProps) {
  const [showCostDetails, setShowCostDetails] = useState(false);

  // ===== Computed values =====
  const validations = useMemo(
    () => validateWallEg(wall, openings, egConfig),
    [wall, openings, egConfig],
  );
  const costEstimate = useMemo(
    () => calculateMurCost(wall, pieces, egConfig),
    [wall, pieces, egConfig],
  );
  const requiredFireRating = useMemo(
    () => detectRequiredFireRating(egConfig.wallLocation, egConfig.buildingType),
    [egConfig.wallLocation, egConfig.buildingType],
  );
  const rRequired = useMemo(
    () => getRequiredRValue(egConfig.climateZone, egConfig.wallLocation, egConfig.useNovoclimat),
    [egConfig.climateZone, egConfig.wallLocation, egConfig.useNovoclimat],
  );

  // Sync fireRating auto-detected if "aucun" was set but a rating is required
  const showFireBadge = requiredFireRating !== 'aucun';

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
        style={{ background: `linear-gradient(to right, ${ACCENT}20, ${ACCENT}10)` }}
      >
        <span className="text-sm font-bold flex items-center gap-2" style={{ color: ACCENT }}>
          <Hammer className="w-4 h-4" />
          Conformite Entrepreneur General
        </span>
        <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
          {isExpanded ? 'Masquer les details' : 'Afficher les details'}
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {isExpanded && (
        <div className="p-4 space-y-4 border-t border-gray-100 dark:border-gray-700">
          {/* ===== 1. Configuration EG ===== */}
          <SubSection title="Configuration EG" icon={<Wrench className="w-4 h-4" />}>
            {/* Type mur: Porteur / Non-porteur */}
            <FieldGroup label="Type de mur">
              <ToggleGroup<MurWallType>
                value={egConfig.wallType}
                options={[
                  ['porteur', 'Porteur'],
                  ['non-porteur', 'Non-porteur'],
                ]}
                onChange={(v) => onChangeConfig({ wallType: v })}
              />
            </FieldGroup>

            {/* Emplacement: 4 boutons radio */}
            <FieldGroup label="Emplacement">
              <ToggleGroup<MurWallLocation>
                value={egConfig.wallLocation}
                options={[
                  ['exterieur', 'Exterieur'],
                  ['interieur', 'Interieur'],
                  ['mitoyen', 'Mitoyen'],
                  ['garage-attache', 'Garage attache'],
                ]}
                onChange={(v) => onChangeConfig({ wallLocation: v })}
              />
            </FieldGroup>

            {/* Zone climatique */}
            <FieldGroup label="Zone climatique">
              <select
                value={egConfig.climateZone}
                onChange={(e) => onChangeConfig({ climateZone: e.target.value as MurClimateZone })}
                className="w-full px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono font-bold text-gray-900 dark:text-white focus:outline-none focus:border-[#7BAFD4]"
              >
                {(Object.keys(ZONE_LABELS) as MurClimateZone[]).map((z) => (
                  <option key={z} value={z}>{ZONE_LABELS[z]}</option>
                ))}
              </select>
            </FieldGroup>

            {/* Type de batiment */}
            <FieldGroup label="Type de batiment">
              <select
                value={egConfig.buildingType}
                onChange={(e) => onChangeConfig({ buildingType: e.target.value as MurBuildingType })}
                className="w-full px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono font-bold text-gray-900 dark:text-white focus:outline-none focus:border-[#7BAFD4]"
              >
                {(Object.keys(BUILDING_LABELS) as MurBuildingType[]).map((b) => (
                  <option key={b} value={b}>{BUILDING_LABELS[b]}</option>
                ))}
              </select>
            </FieldGroup>

            {/* Novoclimat (visible si exterieur) */}
            {egConfig.wallLocation === 'exterieur' && (
              <FieldGroup label="Programme Novoclimat 2.0">
                <ToggleGroup<boolean>
                  value={egConfig.useNovoclimat}
                  options={[
                    [true, 'Oui'],
                    [false, 'Non'],
                  ]}
                  onChange={(v) => onChangeConfig({ useNovoclimat: v })}
                />
              </FieldGroup>
            )}

            {/* Zone nordique toggle */}
            <FieldGroup label="Zone nordique (neige > 50 psf)">
              <ToggleGroup<boolean>
                value={egConfig.isNordique}
                options={[
                  [true, 'Oui'],
                  [false, 'Non'],
                ]}
                onChange={(v) => onChangeConfig({ isNordique: v })}
              />
            </FieldGroup>

            {/* Badge coupe-feu auto-detecte */}
            {showFireBadge && (
              <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${getFireRatingColor(requiredFireRating).border} ${getFireRatingColor(requiredFireRating).bg}`}>
                <Flame className={`w-4 h-4 ${getFireRatingColor(requiredFireRating).text}`} />
                <div className="flex-1">
                  <div className={`text-xs font-bold ${getFireRatingColor(requiredFireRating).text}`}>
                    Coupe-feu auto-detecte: {getFireRatingLabel(requiredFireRating)}
                  </div>
                  <div className={`text-[10px] ${getFireRatingColor(requiredFireRating).text} opacity-80`}>
                    Selon emplacement {LOCATION_LABELS[egConfig.wallLocation]} + {BUILDING_LABELS[egConfig.buildingType]}
                  </div>
                </div>
              </div>
            )}
          </SubSection>

          {/* ===== 2. R-valeur requise ===== */}
          {egConfig.wallLocation === 'exterieur' && (
            <SubSection title="Isolation thermique requise" icon={<Thermometer className="w-4 h-4" />}>
              <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20">
                <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-bold text-blue-800 dark:text-blue-200">
                    R-{rRequired} minimum requis
                  </div>
                  <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Zone {ZONE_LABELS[egConfig.climateZone]}
                    {egConfig.useNovoclimat ? ' (Novoclimat 2.0)' : ' (CNB 9.36)'}.
                    {' '}Isolant batt recommande: R-{rRequired <= 20 ? '20 (5.5")' : rRequired <= 24 ? '24 (5.5" haute densite)' : '28 (7.25")'}.
                  </div>
                  <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-2 font-mono">
                    CNB min: R-{R_VALUES_MIN[egConfig.climateZone].murExt} | Novoclimat: R-{R_VALUES_NOVOCLIMAT[egConfig.climateZone]} | Sous-sol: R-{R_VALUES_MIN[egConfig.climateZone].sousSol} | Toit: R-{R_VALUES_MIN[egConfig.climateZone].toit}
                  </div>
                </div>
              </div>
            </SubSection>
          )}

          {/* ===== 3. Estimation des couts ===== */}
          <SubSection title="Estimation des couts" icon={<DollarSign className="w-4 h-4" />}>
            {/* Gros indicateur cout/pi2 */}
            <div className="bg-gradient-to-r from-[#7BAFD4]/20 to-[#7BAFD4]/10 dark:from-[#7BAFD4]/30 dark:to-[#7BAFD4]/20 border-2 border-[#7BAFD4]/40 rounded-xl p-4 text-center">
              <div className="text-xs uppercase tracking-wider font-semibold text-gray-600 dark:text-gray-400">
                Cout au pi2 (sous-total HT)
              </div>
              <div className="text-3xl font-bold mt-1" style={{ color: ACCENT }}>
                {formatMoney(costEstimate.perPi2)}/pi2
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Total TTC: <span className="font-bold text-gray-900 dark:text-white">{formatMoney(costEstimate.totalTtc)}</span>
              </div>
            </div>

            {/* Synthese par categorie */}
            <div className="space-y-1.5 mt-3">
              <CostRow label="Materiaux" value={costEstimate.materiaux.total} bold />
              <CostRow label="Main-d'oeuvre" value={costEstimate.mainOeuvre.total} bold sub={`${costEstimate.mainOeuvre.heuresEstimees} h x ${formatMoney(costEstimate.mainOeuvre.tauxHoraire)}/h (CCQ ${egConfig.buildingType === 'residentiel-renovation' ? 'reno' : 'neuf'})`} />
              <CostRow label="Contingence" value={costEstimate.fraisGeneraux.contingence} muted sub={`${egConfig.buildingType === 'residentiel-renovation' ? CCQ_RATES_2026.contingence_renovation_pct : CCQ_RATES_2026.contingence_neuf_pct}%`} />
              <CostRow label="Administration" value={costEstimate.fraisGeneraux.admin} muted sub={`${CCQ_RATES_2026.admin_pct}%`} />
              <CostRow label="Profit" value={costEstimate.fraisGeneraux.profit} muted sub={`${CCQ_RATES_2026.profit_pct}%`} />
              <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
              <CostRow label="Sous-total HT" value={costEstimate.sousTotal} bold accent />
              <CostRow label="TPS (5%)" value={costEstimate.tps} muted />
              <CostRow label="TVQ (9.975%)" value={costEstimate.tvq} muted />
              <div className="border-t-2 border-gray-300 dark:border-gray-600 my-2" />
              <CostRow label="Total TTC" value={costEstimate.totalTtc} bold accent />
            </div>

            {/* Bouton Details */}
            <button
              type="button"
              onClick={() => setShowCostDetails((v) => !v)}
              className="w-full mt-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition flex items-center justify-center gap-1.5"
            >
              {showCostDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showCostDetails ? 'Masquer le detail materiaux' : 'Detail materiaux'}
            </button>

            {showCostDetails && (
              <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg space-y-1.5 border border-gray-200 dark:border-gray-700">
                <CostRow label="Bois (montants/lisses/linteaux)" value={costEstimate.materiaux.bois} small />
                <CostRow label="Gypse" value={costEstimate.materiaux.gypse} small />
                <CostRow label="Isolant" value={costEstimate.materiaux.isolant} small />
                <CostRow label="Sheathing" value={costEstimate.materiaux.sheathing} small />
                <CostRow label="Membranes (pare-air/vapeur)" value={costEstimate.materiaux.membranes} small />
                <CostRow label="Quincaillerie (5% bois)" value={costEstimate.materiaux.quincaillerie} small />
              </div>
            )}
          </SubSection>

          {/* ===== 4. Validations EG ===== */}
          <SubSection title="Validations EG (Phase 11)" icon={<ClipboardList className="w-4 h-4" />}>
            {validations.length === 0 ? (
              <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                <span className="text-sm font-semibold text-green-800 dark:text-green-200">
                  Conforme aux exigences EG Quebec
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {[...validations]
                  .sort((a, b) => {
                    const order: Record<MurValidation['level'], number> = { error: 0, warning: 1, info: 2 };
                    return order[a.level] - order[b.level];
                  })
                  .map((v, i) => (
                    <EgValidationCard key={i} validation={v} />
                  ))}
              </div>
            )}
          </SubSection>

          {/* ===== 5. Compositions predefinies ===== */}
          <SubSection title="Compositions predefinies" icon={<Layers className="w-4 h-4" />}>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Applique une configuration type en un clic (mur + EG config).
            </p>
            <div className="grid grid-cols-1 gap-2">
              {COMPOSITIONS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onChangeConfig(preset.egConfigChanges);
                    if (onApplyComposition) onApplyComposition(preset);
                  }}
                  className="text-left px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-[#7BAFD4] hover:bg-[#7BAFD4]/5 dark:hover:bg-[#7BAFD4]/10 transition group"
                >
                  <div className="font-bold text-sm text-gray-900 dark:text-white group-hover:text-[#4a7fa8] dark:group-hover:text-[#9BC8E4]">
                    {preset.name}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {preset.description}
                  </div>
                </button>
              ))}
            </div>
          </SubSection>
        </div>
      )}
    </Card>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function SubSection({ title, icon, children }: {
  title: string; icon?: ReactNode; children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5 text-xs uppercase tracking-wider font-bold text-gray-700 dark:text-gray-300">
        {icon && <span style={{ color: ACCENT }}>{icon}</span>}
        <span>{title}</span>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function ToggleGroup<T extends string | boolean>({ value, options, onChange }: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="bg-gray-100 dark:bg-gray-700 p-1 rounded-lg grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, lbl]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`py-2 text-xs font-semibold rounded-md transition ${
            value === v
              ? 'bg-[#7BAFD4] shadow text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-gray-600/50'
          }`}
        >
          {lbl}
        </button>
      ))}
    </div>
  );
}

function CostRow({ label, value, bold, muted, accent, sub, small }: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
  accent?: boolean;
  sub?: string;
  small?: boolean;
}) {
  const labelClass = `${small ? 'text-[11px]' : 'text-xs'} ${muted ? 'text-gray-500 dark:text-gray-400' : bold ? 'text-gray-800 dark:text-gray-200 font-semibold' : 'text-gray-700 dark:text-gray-300'}`;
  const valueClass = `${small ? 'text-xs' : 'text-sm'} font-mono tabular-nums ${
    accent ? 'font-bold' : bold ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
  }`;
  return (
    <div className="flex items-baseline justify-between">
      <div className="flex flex-col">
        <span className={labelClass}>{label}</span>
        {sub && <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{sub}</span>}
      </div>
      <span className={valueClass} style={accent ? { color: ACCENT } : undefined}>
        {formatMoney(value)}
      </span>
    </div>
  );
}

function EgValidationCard({ validation }: { validation: MurValidation }) {
  const styles: Record<MurValidation['level'], { border: string; bg: string; text: string; badge: string; icon: ReactNode }> = {
    error: {
      border: 'border-red-300 dark:border-red-700',
      bg: 'bg-red-50 dark:bg-red-900/20',
      text: 'text-red-800 dark:text-red-200',
      badge: 'bg-red-200 dark:bg-red-800 text-red-900 dark:text-red-100',
      icon: <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />,
    },
    warning: {
      border: 'border-amber-300 dark:border-amber-700',
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      text: 'text-amber-800 dark:text-amber-200',
      badge: 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100',
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />,
    },
    info: {
      border: 'border-blue-300 dark:border-blue-700',
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      text: 'text-blue-800 dark:text-blue-200',
      badge: 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100',
      icon: <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />,
    },
  };
  const s = styles[validation.level];
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border ${s.border} ${s.bg}`}>
      <div className="pt-0.5">{s.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${s.badge}`}>
            {validation.code}
          </span>
        </div>
        <p className={`text-xs leading-snug ${s.text}`}>{validation.message}</p>
      </div>
    </div>
  );
}
