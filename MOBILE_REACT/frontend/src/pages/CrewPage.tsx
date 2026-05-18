/**
 * CrewPage - Statut des équipes sur chantier
 * Affiche les projets avec les membres présents et leur statut de pointage.
 */

import { useEffect, useState } from 'react';
import { Users, MapPin, Clock, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useCrewStore } from '@/store/useCrewStore';
import { usePunchStore } from '@/store/usePunchStore';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { formatElapsedMinutes } from '@/utils/format';
import type { CrewProject, CrewMember } from '@/types';

function CrewPage() {
  // Selecteurs Zustand individuels (anti-pattern destructuring v5 = risque React #185).
  const projects = useCrewStore((s) => s.projects);
  const isLoading = useCrewStore((s) => s.isLoading);
  const error = useCrewStore((s) => s.error);
  const fetchCrew = useCrewStore((s) => s.fetchCrew);
  const clearError = useCrewStore((s) => s.clearError);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchCrew();
  }, [fetchCrew]);

  const toggleExpand = (projectId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const approveEntry = usePunchStore((s) => s.approveEntry);

  const handleApprove = async (member: CrewMember) => {
    if (member.timeEntryId) {
      await approveEntry(member.timeEntryId);
      await fetchCrew();
    }
  };

  return (
    <div className="min-h-full bg-transparent dark:bg-[#1b1a19]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-seaop-primary-600 dark:text-seaop-primary-400" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              Équipe sur chantier
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchCrew()}
            isLoading={isLoading}
          >
            Rafraîchir
          </Button>
        </div>
      </header>

      <main className="px-4 py-4 space-y-3 max-w-lg mx-auto">
        {/* Error */}
        {error && (
          <Alert type="error" onDismiss={clearError}>
            {error}
          </Alert>
        )}

        {/* Loading */}
        {isLoading && projects.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && projects.length === 0 && (
          <div className="text-center py-16">
            <MapPin className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Aucun projet avec des membres actifs
            </p>
          </div>
        )}

        {/* Project cards */}
        {projects.map((project: CrewProject) => {
          const isExpanded = expandedIds.has(project.projectId);

          return (
            <div
              key={project.projectId}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Project header (tap to expand) */}
              <button
                type="button"
                onClick={() => toggleExpand(project.projectId)}
                className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-gray-50 dark:active:bg-gray-750 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {project.projectNom}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge
                      variant={project.totalOnSite > 0 ? 'success' : 'default'}
                    >
                      <MapPin className="h-3 w-3" />
                      {project.totalOnSite} / {project.totalAssigned}
                    </Badge>
                    {project.canApprove && (
                      <Badge variant="info">Approbateur</Badge>
                    )}
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-5 w-5 text-gray-400 shrink-0 ml-2" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-gray-400 shrink-0 ml-2" />
                )}
              </button>

              {/* Members list */}
              {isExpanded && (
                <div className="border-t border-gray-100 dark:border-gray-700">
                  {project.members.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500">
                      Aucun membre assigné
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {project.members.map((member: CrewMember) => (
                        <li
                          key={member.employeeId}
                          className="px-4 py-3 flex items-center gap-3"
                        >
                          {/* Punched in/out indicator */}
                          <span
                            className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                              member.isPunchedIn
                                ? 'bg-green-500'
                                : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                            title={member.isPunchedIn ? 'Pointé' : 'Absent'}
                          />

                          {/* Name & details */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {member.prenom} {member.nom}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                              {member.poste && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {member.poste}
                                </span>
                              )}
                              {member.numeroBt && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  BT {member.numeroBt}
                                </span>
                              )}
                              {member.isPunchedIn && member.elapsedMinutes != null && (
                                <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                                  <Clock className="h-3 w-3" />
                                  {formatElapsedMinutes(member.elapsedMinutes)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Approve button */}
                          {project.canApprove && !member.validated && member.timeEntryId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleApprove(member)}
                              leftIcon={<Check className="h-4 w-4" />}
                              className="text-green-600 dark:text-green-400 shrink-0"
                            >
                              <span className="sr-only sm:not-sr-only">
                                Approuver
                              </span>
                            </Button>
                          )}

                          {/* Validated indicator */}
                          {member.validated && (
                            <Badge variant="success">
                              <Check className="h-3 w-3" />
                              Validé
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}

export default CrewPage;
