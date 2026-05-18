/**
 * Fonds de Prevoyance - Sub-tab: Projections financieres
 * Generates 3 scenarios (uniforme, progressif, variable) for a selected etude.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Play, Save, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import * as fpApi from '@/api/fondsPrevoyance';
import type { Etude, ProjectionsResult } from '@/api/fondsPrevoyance';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { formatCurrency } from '@/utils/format';

interface Props {
  coproId: number;
}

type ScenarioKey = 'uniforme' | 'progressif' | 'variable';

const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  uniforme: 'Contribution uniforme',
  progressif: 'Contribution progressive',
  variable: 'Contribution variable',
};

export default function ProjectionsTab({ coproId }: Props) {
  const [etudes, setEtudes] = useState<Etude[]>([]);
  const [selectedEtudeId, setSelectedEtudeId] = useState<number | null>(null);
  const [soldeInitial, setSoldeInitial] = useState('0');
  const [tauxInflation, setTauxInflation] = useState('2.5');
  const [tauxRendement, setTauxRendement] = useState('3.0');
  const [result, setResult] = useState<ProjectionsResult | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>('uniforme');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [etudesLoadError, setEtudesLoadError] = useState(false);

  // Reset state when copropriete changes — prevents orphaned etude_id writes.
  useEffect(() => {
    setSelectedEtudeId(null);
    setResult(null);
    setMessage(null);
    setSoldeInitial('0');
    setTauxInflation('2.5');
    setTauxRendement('3.0');
  }, [coproId]);

  const loadEtudes = useCallback(async () => {
    setEtudesLoadError(false);
    try {
      const res = await fpApi.listEtudes(coproId);
      setEtudes(res.items);
      if (res.items.length > 0 && selectedEtudeId === null) {
        setSelectedEtudeId(res.items[0].id);
        if (res.items[0].montant_fonds_actuel != null) {
          setSoldeInitial(res.items[0].montant_fonds_actuel.toString());
        }
        if (res.items[0].taux_inflation_suppose != null) {
          setTauxInflation(res.items[0].taux_inflation_suppose.toString());
        }
        if (res.items[0].taux_rendement_suppose != null) {
          setTauxRendement(res.items[0].taux_rendement_suppose.toString());
        }
      }
    } catch {
      setEtudesLoadError(true);
    }
  }, [coproId, selectedEtudeId]);

  useEffect(() => {
    loadEtudes();
  }, [loadEtudes]);

  const handleGenerate = async () => {
    if (!selectedEtudeId) return;
    setGenerating(true);
    setResult(null);
    setMessage(null);
    try {
      const res = await fpApi.generateProjections(selectedEtudeId, {
        id_copropriete: coproId,
        solde_initial: Number(soldeInitial) || 0,
        taux_inflation: Number(tauxInflation) || 2.5,
        taux_rendement: Number(tauxRendement) || 3.0,
      });
      setResult(res);
    } catch { /* handled */ }
    finally { setGenerating(false); }
  };

  const handleSaveScenario = async () => {
    if (!selectedEtudeId || !result) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fpApi.generateProjections(
        selectedEtudeId,
        {
          id_copropriete: coproId,
          solde_initial: Number(soldeInitial) || 0,
          taux_inflation: Number(tauxInflation) || 2.5,
          taux_rendement: Number(tauxRendement) || 3.0,
        },
        { save: true, scenario: selectedScenario },
      );
      setResult(res);
      setMessage(`Scénario "${SCENARIO_LABELS[selectedScenario]}" enregistré.`);
    } catch { /* handled */ }
    finally { setSaving(false); }
  };

  const etudesOptions = etudes.map((e) => ({
    value: e.id.toString(),
    label: `${e.date_etude?.slice(0, 10) || 'N/A'} — ${e.professionnel_responsable}`,
  }));

  const chartData = useMemo(() => {
    if (!result) return [];
    const u = result.uniforme.projections;
    const p = result.progressif.projections;
    const v = result.variable.projections;
    return u.map((_, i) => ({
      annee: u[i].annee,
      uniforme: u[i].solde_fin,
      progressif: p[i]?.solde_fin ?? 0,
      variable: v[i]?.solde_fin ?? 0,
    }));
  }, [result]);

  if (etudesLoadError) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-600/40 bg-red-50 dark:bg-red-900/20 p-4 text-red-800 dark:text-red-200 text-sm">
        Erreur lors du chargement des études. Actualisez la page ou vérifiez votre connexion.
      </div>
    );
  }

  if (etudes.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-900/20 p-4 text-amber-800 dark:text-amber-200 text-sm">
        Aucune étude trouvée. Créez d'abord une étude dans l'onglet "Études" avant de générer des projections.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Inputs */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select
            label="Étude"
            value={selectedEtudeId?.toString() || ''}
            onChange={(e) => setSelectedEtudeId(Number(e.target.value) || null)}
            options={etudesOptions}
          />
          <Input
            label="Solde initial ($)"
            type="number"
            step="0.01"
            value={soldeInitial}
            onChange={(e) => setSoldeInitial(e.target.value)}
          />
          <Input
            label="Taux inflation (%)"
            type="number"
            step="0.01"
            value={tauxInflation}
            onChange={(e) => setTauxInflation(e.target.value)}
          />
          <Input
            label="Taux rendement (%)"
            type="number"
            step="0.01"
            value={tauxRendement}
            onChange={(e) => setTauxRendement(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={handleGenerate}
            disabled={generating || saving || !selectedEtudeId}
            leftIcon={<Play size={16} />}
            isLoading={generating}
          >
            Générer les 3 scénarios
          </Button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          {/* Comparative chart (3 scenarios) */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
            <div className="text-sm text-gray-900 dark:text-white font-medium mb-2">
              Évolution du solde — comparaison des 3 scénarios
            </div>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="annee" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', color: '#111827', borderRadius: '6px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(v: number) => formatCurrency(v)}
                  />
                  <Legend wrapperStyle={{ color: '#4b5563' }} />
                  <Line type="monotone" dataKey="uniforme" stroke="#4A7FA8" strokeWidth={2} name="Uniforme" dot={false} />
                  <Line type="monotone" dataKey="progressif" stroke="#8b5cf6" strokeWidth={2} name="Progressif" dot={false} />
                  <Line type="monotone" dataKey="variable" stroke="#E8C17A" strokeWidth={2} name="Variable" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(['uniforme', 'progressif', 'variable'] as ScenarioKey[]).map((key) => {
              const s = result[key];
              const isSelected = selectedScenario === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedScenario(key)}
                  className={`text-left rounded-lg border p-4 transition-colors ${
                    isSelected
                      ? 'border-[#4A7FA8] bg-[#7BAFD4]/10 dark:border-[#9BC8E4] dark:bg-[#7BAFD4]/20'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center gap-2 text-gray-900 dark:text-white font-medium">
                    <TrendingUp size={16} className="text-[#4A7FA8] dark:text-[#9BC8E4]" />
                    {s.nom}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.description}</p>
                  <div className="mt-3 space-y-1 text-sm">
                    {key === 'uniforme' && 'contribution_annuelle' in s && (
                      <div className="text-gray-700 dark:text-gray-300">
                        Annuelle : <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(s.contribution_annuelle)}</span>
                      </div>
                    )}
                    {key === 'progressif' && 'contribution_initiale' in s && (
                      <>
                        <div className="text-gray-700 dark:text-gray-300">
                          Initiale : <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(s.contribution_initiale)}</span>
                        </div>
                        <div className="text-gray-700 dark:text-gray-300">
                          Finale : <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(s.contribution_finale)}</span>
                        </div>
                      </>
                    )}
                    {key === 'variable' && 'contribution_moyenne' in s && (
                      <>
                        <div className="text-gray-700 dark:text-gray-300">
                          Moyenne : <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(s.contribution_moyenne)}</span>
                        </div>
                        <div className="text-gray-500 dark:text-gray-400 text-xs">
                          Min {formatCurrency(s.contribution_minimale)} · Max {formatCurrency(s.contribution_maximale)}
                        </div>
                      </>
                    )}
                    <div className="text-gray-700 dark:text-gray-300">
                      Total 25 ans : <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(s.contribution_totale)}</span>
                    </div>
                    <div className="text-gray-700 dark:text-gray-300">
                      Solde final : <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(s.solde_final)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end items-center gap-2">
            {message && <div className="text-sm text-green-700 dark:text-green-400">{message}</div>}
            <Button
              onClick={handleSaveScenario}
              disabled={saving || generating || !selectedEtudeId}
              isLoading={saving}
              leftIcon={<Save size={16} />}
            >
              Enregistrer le scénario sélectionné
            </Button>
          </div>

          {/* Detailed projection table */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-sm text-gray-900 dark:text-white font-medium">
              Projection année par année — {SCENARIO_LABELS[selectedScenario]}
            </div>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 text-xs sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Année</th>
                    <th className="px-3 py-2 text-right">Solde début</th>
                    <th className="px-3 py-2 text-right">Contribution</th>
                    <th className="px-3 py-2 text-right">Rendement</th>
                    <th className="px-3 py-2 text-right">Dépenses</th>
                    <th className="px-3 py-2 text-right">Solde fin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {result[selectedScenario].projections.map((p) => (
                    <tr key={p.annee} className={p.depenses > 0 ? 'bg-amber-50 dark:bg-amber-900/10' : ''}>
                      <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white">{p.annee}</td>
                      <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">{formatCurrency(p.solde_debut)}</td>
                      <td className="px-3 py-1.5 text-right text-green-700 dark:text-green-400">{formatCurrency(p.contribution)}</td>
                      <td className="px-3 py-1.5 text-right text-[#4A7FA8] dark:text-[#9BC8E4]">{formatCurrency(p.rendement)}</td>
                      <td className="px-3 py-1.5 text-right text-orange-700 dark:text-orange-400">
                        {p.depenses > 0 ? formatCurrency(p.depenses) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(p.solde_fin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Depenses prevues */}
          {Object.keys(result.depenses_prevues).length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
              <div className="text-sm text-gray-900 dark:text-white font-medium mb-2">Dépenses prévues (par année de remplacement)</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                {Object.entries(result.depenses_prevues).sort(([a], [b]) => Number(a) - Number(b)).map(([annee, montant]) => (
                  <div key={annee} className="flex justify-between bg-gray-50 dark:bg-gray-900/40 rounded px-2 py-1">
                    <span className="text-gray-500 dark:text-gray-400">{annee}</span>
                    <span className="text-gray-900 dark:text-white font-medium">{formatCurrency(montant)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
