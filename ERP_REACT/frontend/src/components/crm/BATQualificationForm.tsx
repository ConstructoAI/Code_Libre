/**
 * Grille de Pointage B.A.T. (Budget, Autorite, Timing, Compatibilite)
 * Score sur 100 points pour qualifier les prospects construction Quebec.
 */

import { useState, useEffect, useMemo } from 'react';
import * as crmApi from '@/api/crm';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';

interface Question {
  id: string;
  label: string;
  max: number;
  options: { label: string; points: number }[];
}

interface Section {
  key: string;
  label: string;
  icon: string;
  subtitle: string;
  max: number;
  questions: Question[];
}

const SECTIONS: Section[] = [
  {
    key: 'A', label: 'Budget', icon: '💰', subtitle: 'Évaluation de la capacité financière', max: 25,
    questions: [
      {
        id: 'A1', label: 'Le client a-t-il identifié un budget précis?', max: 10,
        options: [
          { label: 'Oui, réaliste pour le projet', points: 10 },
          { label: 'Oui, mais légèrement sous le marché', points: 5 },
          { label: 'Vague ou "à déterminer"', points: 2 },
          { label: 'Refuse de répondre', points: 0 },
          { label: 'Complètement irréaliste', points: -5 },
        ],
      },
      {
        id: 'A2', label: 'Le financement est-il en place?', max: 10,
        options: [
          { label: 'Approuvé et en place', points: 10 },
          { label: 'En cours d\'approbation', points: 5 },
          { label: 'Prévu mais non commencé', points: 2 },
          { label: 'Pas prévu ou flou', points: 0 },
        ],
      },
      {
        id: 'A3', label: 'Historique financier apparent', max: 5,
        options: [
          { label: 'Propriétaire établi, projet cohérent', points: 5 },
          { label: 'Incertain', points: 2 },
          { label: 'Signaux de difficultés', points: 0 },
        ],
      },
    ],
  },
  {
    key: 'B', label: 'Autorité', icon: '📊', subtitle: 'Identification des décideurs', max: 25,
    questions: [
      {
        id: 'B1', label: 'Le décideur principal est-il identifié?', max: 10,
        options: [
          { label: 'Parle au décideur unique', points: 10 },
          { label: 'Décideurs multiples, tous engagés', points: 7 },
          { label: 'Décideur secondaire, promet d\'impliquer l\'autre', points: 3 },
          { label: 'Décideur absent ou flou', points: 0 },
        ],
      },
      {
        id: 'B2', label: 'Disponibilité des décideurs pour la visite', max: 10,
        options: [
          { label: 'Tous confirmés', points: 10 },
          { label: 'Principal confirmé, autres probables', points: 5 },
          { label: 'Incertain', points: 0 },
        ],
      },
      {
        id: 'B3', label: 'Processus décisionnel', max: 5,
        options: [
          { label: 'Décision autonome du ménage', points: 5 },
          { label: 'Implique famille élargie ou autres', points: 2 },
          { label: 'Comité, conseil, etc.', points: 0 },
        ],
      },
    ],
  },
  {
    key: 'C', label: 'Timing', icon: '⏱️', subtitle: 'Échéancier et urgence du projet', max: 25,
    questions: [
      {
        id: 'C1', label: 'Échéancier de démarrage souhaité', max: 10,
        options: [
          { label: 'Dans les 30 jours', points: 10 },
          { label: 'Dans 1-3 mois', points: 8 },
          { label: 'Dans 3-6 mois', points: 5 },
          { label: 'Dans 6-12 mois', points: 2 },
          { label: 'Plus d\'un an ou "un jour"', points: 0 },
        ],
      },
      {
        id: 'C2', label: 'Motivation / Urgence', max: 10,
        options: [
          { label: 'Besoin concret et pressant', points: 10 },
          { label: 'Projet désiré avec motivation claire', points: 7 },
          { label: '"Ce serait bien de..."', points: 3 },
          { label: 'Exploration sans urgence', points: 0 },
        ],
      },
      {
        id: 'C3', label: 'Disponibilité pour le processus', max: 5,
        options: [
          { label: 'Flexible et disponible', points: 5 },
          { label: 'Quelques contraintes', points: 3 },
          { label: 'Très limité', points: 0 },
        ],
      },
    ],
  },
  {
    key: 'D', label: 'Compatibilité', icon: '🎯', subtitle: 'Adéquation avec notre expertise', max: 25,
    questions: [
      {
        id: 'D1', label: 'Type de projet vs notre expertise', max: 10,
        options: [
          { label: 'Dans notre spécialité', points: 10 },
          { label: 'Adjacent à notre expertise', points: 5 },
          { label: 'Hors de notre zone de confort', points: 0 },
        ],
      },
      {
        id: 'D2', label: 'Qualité de la communication', max: 5,
        options: [
          { label: 'Excellente, claire, professionnelle', points: 5 },
          { label: 'Correcte', points: 3 },
          { label: 'Difficile ou agressive', points: 0 },
        ],
      },
      {
        id: 'D3', label: 'Attentes du client', max: 5,
        options: [
          { label: 'Réalistes et bien informées', points: 5 },
          { label: 'Partiellement réalistes', points: 3 },
          { label: 'Irréalistes', points: 0 },
        ],
      },
      {
        id: 'D4', label: 'Feeling général', max: 5,
        options: [
          { label: 'Très bon feeling', points: 5 },
          { label: 'Neutre', points: 3 },
          { label: 'Mauvais feeling', points: 0 },
        ],
      },
    ],
  },
];

function getCategorie(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 50) return 'B';
  if (score >= 25) return 'C';
  return 'D';
}

function getAction(score: number): string {
  if (score >= 90) return 'Priorité maximale - Visite dans les 48-72h';
  if (score >= 75) return 'Priorité haute - Planifier visite rapidement';
  if (score >= 50) return 'Potentiel - Approfondir la qualification';
  if (score >= 25) return 'Tiède - Maintenir le contact, nourrir';
  return 'Froid - Pas prioritaire';
}

function getCategorieColor(cat: string): 'green' | 'blue' | 'yellow' | 'red' | 'gray' {
  if (cat === 'A+' || cat === 'A') return 'green';
  if (cat === 'B') return 'yellow';
  if (cat === 'C') return 'red';
  return 'gray';
}

export default function BATQualificationForm({
  opportunityId,
  onSaved,
}: {
  opportunityId: number;
  onSaved?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ A: true, B: true, C: true, D: true });

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await crmApi.getBATQualification(opportunityId);
        if (res.exists && res.reponsesGrille) {
          const stored = typeof res.reponsesGrille === 'string'
            ? JSON.parse(res.reponsesGrille)
            : res.reponsesGrille;
          setAnswers(stored);
          setNotes(res.notesQualification || '');
        }
      } catch { /* first time */ }
      finally { setIsLoading(false); }
    };
    load();
  }, [opportunityId]);

  const scores = useMemo((): Record<string, number> & { total: number; A: number; B: number; C: number; D: number } => {
    const sectionScores: Record<string, number> = {};
    for (const section of SECTIONS) {
      let sectionTotal = 0;
      for (const q of section.questions) {
        const val = answers[q.id];
        if (val !== undefined) sectionTotal += val;
      }
      sectionScores[section.key] = Math.max(0, sectionTotal);
    }
    const total = Object.values(sectionScores).reduce((a, b) => a + b, 0);
    return { ...sectionScores, total } as Record<string, number> & { total: number; A: number; B: number; C: number; D: number };
  }, [answers]);

  const categorie = getCategorie(scores.total);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await crmApi.saveBATQualification({
        opportunityId,
        scoreBudget: scores.A || 0,
        scoreAutorite: scores.B || 0,
        scoreTiming: scores.C || 0,
        scoreCompatibilite: scores.D || 0,
        scoreTotal: scores.total,
        categorie,
        reponsesGrille: answers,
        notesQualification: notes || undefined,
      });
      setSuccess('Qualification enregistrée');
      onSaved?.();
    } catch {
      setError('Erreur lors de la sauvegarde');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-6"><Spinner size="md" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Grille de Pointage B.A.T.
      </h4>

      {SECTIONS.map((section) => (
        <div key={section.key} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setOpenSections((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <span>{section.icon} Section {section.key}: {section.label} (max {section.max} pts)</span>
            <span className="font-semibold text-seaop-primary-600">{scores[section.key] || 0}/{section.max}</span>
          </button>

          {openSections[section.key] && (
            <div className="px-4 py-3 space-y-4">
              <p className="text-xs text-gray-400 italic">{section.subtitle}</p>
              {section.questions.map((q) => (
                <div key={q.id}>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                    {q.id}. {q.label} <span className="text-gray-400 font-normal">(max {q.max} pts)</span>
                  </p>
                  <div className="space-y-1 ml-2">
                    {q.options.map((opt, idx) => (
                      <label key={idx} className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer py-1.5 min-h-[44px]">
                        <input
                          type="radio"
                          name={q.id}
                          checked={answers[q.id] === opt.points}
                          onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.points }))}
                          className="text-seaop-primary-600 focus:ring-seaop-primary-500 mt-0.5 w-4 h-4 shrink-0"
                        />
                        {opt.label} ({opt.points > 0 ? '+' : ''}{opt.points} pts)
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Score total */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className={`p-3 sm:p-4 rounded-lg text-center ${
          scores.total >= 75 ? 'bg-green-50 dark:bg-green-900/20' :
          scores.total >= 50 ? 'bg-yellow-50 dark:bg-yellow-900/20' :
          'bg-red-50 dark:bg-red-900/20'
        }`}>
          <p className={`text-2xl sm:text-3xl font-bold ${
            scores.total >= 75 ? 'text-green-600' :
            scores.total >= 50 ? 'text-yellow-600' :
            'text-red-500'
          }`}>
            {scores.total} / 100 pts
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Catégorie: <Badge color={getCategorieColor(categorie)}>{categorie}</Badge>
          </p>
        </div>
        <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-medium">Action recommandée:</span> {getAction(scores.total)}
          </p>
        </div>
      </div>

      <Textarea
        label="Notes de qualification (optionnel)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
      />

      <div className="flex justify-end gap-3">
        <Button onClick={handleSave} isLoading={isSaving}>
          Enregistrer la Qualification
        </Button>
      </div>
    </div>
  );
}
