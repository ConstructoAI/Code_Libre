/**
 * Fonds de Prevoyance - Sub-tab: Conseils IA (Claude)
 * Analyze a copropriete, chat with Loi 16 expert, suggest contribution amount.
 */
import { useState } from 'react';
import { Sparkles, Send, Calculator, Shield, FileText, Download } from 'lucide-react';
import * as fpApi from '@/api/fondsPrevoyance';
import type {
  Copropriete,
  FpAnalyseResult,
  IaContributionRecommendation,
} from '@/api/fondsPrevoyance';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { formatCurrency } from '@/utils/format';

interface Props {
  coproId: number | null;
  coproprietes: Copropriete[];
}

type IaSubTab = 'analyze' | 'chat' | 'rapport' | 'contribution';

export default function ConseilsIaTab({ coproId, coproprietes }: Props) {
  const [tab, setTab] = useState<IaSubTab>('analyze');

  // Analyze state
  const [analysis, setAnalysis] = useState<FpAnalyseResult | string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Chat state
  const [question, setQuestion] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatResponse, setChatResponse] = useState<string>('');

  // Rapport state
  const [rapportLoading, setRapportLoading] = useState(false);
  const [rapportText, setRapportText] = useState<string>('');

  // Contribution state
  const [coutRemplacement, setCoutRemplacement] = useState('');
  const [nombreUnites, setNombreUnites] = useState('');
  const [horizon, setHorizon] = useState('25');
  const [soldeActuel, setSoldeActuel] = useState('0');
  const [recommendation, setRecommendation] = useState<IaContributionRecommendation | string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!coproId) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fpApi.analyzeCopropriete(coproId);
      setAnalysis(res.analysis);
    } catch { /* handled */ }
    finally { setAnalyzing(false); }
  };

  const handleChat = async () => {
    if (!question.trim()) return;
    setChatLoading(true);
    setChatResponse('');
    try {
      const res = await fpApi.chatFp(question, {
        id_copropriete: includeContext && coproId ? coproId : undefined,
      });
      setChatResponse(res.response);
    } catch { /* handled */ }
    finally { setChatLoading(false); }
  };

  const handleRapport = async () => {
    if (!coproId) return;
    setRapportLoading(true);
    setRapportText('');
    try {
      const res = await fpApi.generateRapport(coproId);
      setRapportText(res.rapport);
    } catch { /* handled */ }
    finally { setRapportLoading(false); }
  };

  const handleDownloadRapport = () => {
    if (!rapportText) return;
    const blob = new Blob([rapportText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport-fonds-prevoyance-${coproId}-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSuggest = async () => {
    if (!coutRemplacement || !nombreUnites) return;
    setSuggestLoading(true);
    setRecommendation(null);
    try {
      const res = await fpApi.suggestContribution({
        cout_total_remplacement: Number(coutRemplacement),
        nombre_unites: Number(nombreUnites),
        horizon_annees: Number(horizon) || 25,
        solde_actuel: Number(soldeActuel) || 0,
      });
      setRecommendation(res.recommendation);
    } catch { /* handled */ }
    finally { setSuggestLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {([
          { key: 'analyze' as const, label: 'Analyse complète', icon: <Sparkles size={14} /> },
          { key: 'chat' as const, label: 'Chat expert', icon: <Send size={14} /> },
          { key: 'rapport' as const, label: 'Rapport complet', icon: <FileText size={14} /> },
          { key: 'contribution' as const, label: 'Suggestion contribution', icon: <Calculator size={14} /> },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === t.key
                ? 'border-purple-400 text-purple-700 dark:text-purple-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ==== ANALYZE ==== */}
      {tab === 'analyze' && (
        <div className="space-y-3">
          {!coproId ? (
            <div className="rounded-lg border border-amber-200 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-900/20 p-4 text-amber-800 dark:text-amber-200 text-sm">
              Sélectionnez une copropriété pour lancer l'analyse IA.
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Analyse complète basée sur les composantes, études et données de la copropriété.
                </div>
                <Button onClick={handleAnalyze} isLoading={analyzing} leftIcon={<Sparkles size={16} />}>
                  Lancer l'analyse
                </Button>
              </div>
              {analysis && typeof analysis === 'object' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                      <div className="text-xs text-gray-500 dark:text-gray-400">Score de santé</div>
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">{analysis.score_sante ?? '—'} / 100</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                      <div className="text-xs text-gray-500 dark:text-gray-400">Niveau de risque</div>
                      <div className="text-lg font-semibold capitalize text-gray-900 dark:text-white">
                        {analysis.niveau_risque || '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                      <div className="text-xs text-gray-500 dark:text-gray-400">Contribution adéquate</div>
                      <div className="text-lg font-semibold text-gray-900 dark:text-white">
                        {analysis.estimation_contribution_adequate != null
                          ? formatCurrency(analysis.estimation_contribution_adequate) + ' / an'
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {analysis.resume_situation && (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                      <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Résumé de la situation</div>
                      <div className="text-sm text-gray-900 dark:text-white">{analysis.resume_situation}</div>
                    </div>
                  )}

                  {analysis.points_attention && analysis.points_attention.length > 0 && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/10 p-3">
                      <div className="text-sm text-amber-700 dark:text-amber-300 mb-2">Points d'attention</div>
                      <ul className="list-disc list-inside text-sm text-amber-800 dark:text-amber-200 space-y-1">
                        {analysis.points_attention.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}

                  {analysis.recommandations_immediates && analysis.recommandations_immediates.length > 0 && (
                    <div className="rounded-lg border border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/10 p-3">
                      <div className="text-sm text-red-700 dark:text-red-300 mb-2">Recommandations immédiates</div>
                      <ul className="list-disc list-inside text-sm text-red-800 dark:text-red-200 space-y-1">
                        {analysis.recommandations_immediates.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}

                  {analysis.recommandations_moyen_terme && analysis.recommandations_moyen_terme.length > 0 && (
                    <div className="rounded-lg border border-blue-200 dark:border-blue-700/40 bg-blue-50 dark:bg-blue-900/10 p-3">
                      <div className="text-sm text-[#4A7FA8] dark:text-[#9BC8E4] mb-2">Recommandations moyen terme</div>
                      <ul className="list-disc list-inside text-sm text-blue-800 dark:text-blue-200 space-y-1">
                        {analysis.recommandations_moyen_terme.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}

                  {analysis.conformite_loi16 && (
                    <div className="rounded-lg border border-purple-200 dark:border-purple-700/40 bg-purple-50 dark:bg-purple-900/10 p-3">
                      <div className="flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300 mb-2">
                        <Shield size={14} /> Conformité Loi 16
                      </div>
                      <div className="space-y-1 text-sm text-purple-800 dark:text-purple-200">
                        <div>Étude à jour : {analysis.conformite_loi16.etude_a_jour ? 'Oui' : 'Non'}</div>
                        <div>Carnet requis : {analysis.conformite_loi16.carnet_requis ? 'Oui' : 'Non'}</div>
                        {analysis.conformite_loi16.prochaine_echeance && (
                          <div>Prochaine échéance : {analysis.conformite_loi16.prochaine_echeance}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {analysis.conseil_expert && (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                      <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Conseil d'expert</div>
                      <div className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{analysis.conseil_expert}</div>
                    </div>
                  )}
                </div>
              )}
              {analysis && typeof analysis === 'string' && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
                  {analysis}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ==== CHAT ==== */}
      {tab === 'chat' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800 space-y-3">
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                Posez une question à l'expert en fonds de prévoyance / Loi 16
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ex: Quelle est la différence entre une cotisation régulière et spéciale ?"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(e) => setIncludeContext(e.target.checked)}
                  disabled={!coproId}
                  className="rounded"
                />
                Inclure le contexte de la copropriété
              </label>
              <Button
                onClick={handleChat}
                isLoading={chatLoading}
                disabled={!question.trim()}
                leftIcon={<Send size={16} />}
              >
                Envoyer
              </Button>
            </div>
          </div>
          {chatResponse && (
            <div className="rounded-lg border border-purple-200 dark:border-purple-700/40 bg-purple-50 dark:bg-purple-900/10 p-3">
              <div className="text-sm text-purple-700 dark:text-purple-300 mb-2 font-medium">Réponse de l'expert IA</div>
              <div className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{chatResponse}</div>
            </div>
          )}
        </div>
      )}

      {/* ==== RAPPORT ==== */}
      {tab === 'rapport' && (
        <div className="space-y-3">
          {!coproId ? (
            <div className="rounded-lg border border-amber-200 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-900/20 p-4 text-amber-800 dark:text-amber-200 text-sm">
              Sélectionnez une copropriété pour générer un rapport complet.
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Rapport complet (Markdown) : synthèse, alertes, recommandations, plan d'entretien, échéancier, conformité Loi 16.
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleRapport}
                    isLoading={rapportLoading}
                    leftIcon={<FileText size={16} />}
                  >
                    Générer le rapport
                  </Button>
                  {rapportText && (
                    <Button variant="outline" onClick={handleDownloadRapport} leftIcon={<Download size={16} />}>
                      Télécharger (.md)
                    </Button>
                  )}
                </div>
              </div>
              {rapportText && (
                <div className="rounded-lg border border-purple-200 dark:border-purple-700/40 bg-purple-50 dark:bg-purple-900/10 p-4">
                  <div className="text-sm text-purple-700 dark:text-purple-300 mb-2 font-medium">Rapport de recommandations</div>
                  <pre className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap font-sans">{rapportText}</pre>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ==== CONTRIBUTION ==== */}
      {tab === 'contribution' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 space-y-3">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Suggestion de contribution annuelle optimale basée sur les paramètres du fonds.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Coût total de remplacement ($) *"
                type="number"
                step="0.01"
                value={coutRemplacement}
                onChange={(e) => setCoutRemplacement(e.target.value)}
              />
              <Input
                label="Nombre d'unités *"
                type="number"
                value={nombreUnites}
                onChange={(e) => setNombreUnites(e.target.value)}
              />
              <Input
                label="Horizon (années)"
                type="number"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value)}
              />
              <Input
                label="Solde actuel ($)"
                type="number"
                step="0.01"
                value={soldeActuel}
                onChange={(e) => setSoldeActuel(e.target.value)}
              />
              {coproprietes.length > 0 && (
                <div className="md:col-span-2">
                  <Select
                    label="Pré-remplir depuis une copropriété (optionnel)"
                    value=""
                    onChange={(e) => {
                      const c = coproprietes.find((c) => c.id === Number(e.target.value));
                      if (c) {
                        if (c.nombre_unites) setNombreUnites(c.nombre_unites.toString());
                        if (c.valeur_reconstruction) setCoutRemplacement(c.valeur_reconstruction.toString());
                      }
                    }}
                    options={[
                      { value: '', label: '-- Choisir --' },
                      ...coproprietes.map((c) => ({ value: c.id.toString(), label: c.nom_copropriete })),
                    ]}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleSuggest}
                isLoading={suggestLoading}
                disabled={!coutRemplacement || !nombreUnites}
                leftIcon={<Calculator size={16} />}
              >
                Suggérer une contribution
              </Button>
            </div>
          </div>
          {recommendation && typeof recommendation === 'object' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {recommendation.contribution_uniforme != null && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Contribution uniforme</div>
                    <div className="text-lg font-bold text-gray-900 dark:text-white">
                      {formatCurrency(recommendation.contribution_uniforme)}/an
                    </div>
                  </div>
                )}
                {recommendation.contribution_par_unite_mensuelle != null && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Par unité / mois</div>
                    <div className="text-lg font-bold text-gray-900 dark:text-white">
                      {formatCurrency(recommendation.contribution_par_unite_mensuelle)}
                    </div>
                  </div>
                )}
                {recommendation.adequation_actuelle != null && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Adéquation actuelle</div>
                    <div className="text-lg font-bold text-gray-900 dark:text-white">{recommendation.adequation_actuelle} %</div>
                  </div>
                )}
              </div>
              {recommendation.contribution_progressive && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">Contribution progressive (par phase)</div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>Années 1-5 : <span className="font-semibold text-gray-900 dark:text-white">{recommendation.contribution_progressive.annee_1_5 != null ? formatCurrency(recommendation.contribution_progressive.annee_1_5) : '—'}</span></div>
                    <div>Années 6-15 : <span className="font-semibold text-gray-900 dark:text-white">{recommendation.contribution_progressive.annee_6_15 != null ? formatCurrency(recommendation.contribution_progressive.annee_6_15) : '—'}</span></div>
                    <div>Années 16-25 : <span className="font-semibold text-gray-900 dark:text-white">{recommendation.contribution_progressive.annee_16_25 != null ? formatCurrency(recommendation.contribution_progressive.annee_16_25) : '—'}</span></div>
                  </div>
                </div>
              )}
              {recommendation.explication && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
                  {recommendation.explication}
                </div>
              )}
              {recommendation.avertissement && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  ⚠️ {recommendation.avertissement}
                </div>
              )}
            </div>
          )}
          {recommendation && typeof recommendation === 'string' && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
              {recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
