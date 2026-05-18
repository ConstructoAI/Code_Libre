/**
 * SEAOP React Frontend - Mes Projets Page
 * Client dashboard showing their own published appels d'offres.
 * Phase 2: view soumissions, accept/reject, messaging per lead.
 * Protected by ProtectedRoute (roles: ['client']) in App.tsx.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Briefcase,
  FileText,
  Clock,
  FolderOpen,
  PlusCircle,
  MessageSquare,
  X,
  ChevronLeft,
} from 'lucide-react';

import { useAuthStore } from '@/store/useAuthStore';
import { useLeadStore } from '@/store/useLeadStore';
import { useSoumissionStore } from '@/store/useSoumissionStore';
import { useMessageStore } from '@/store/useMessageStore';
import { LeadCard } from '@/components/leads/LeadCard';
import { SoumissionList } from '@/components/soumissions/SoumissionList';
import { ConversationList } from '@/components/messages/ConversationList';
import { ChatThread } from '@/components/messages/ChatThread';
import { EvaluationForm } from '@/components/evaluations/EvaluationForm';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import StatCard from '@/components/common/StatCard';
import { createEvaluation } from '@/api/evaluations';
import type { Lead } from '@/types';

export default function MesProjetsPage() {
  const { user } = useAuthStore();
  const { myLeads, isLoadingMyLeads, error, fetchMyLeads } = useLeadStore();
  const {
    soumissionsForLead,
    isLoadingSoumissions,
    fetchSoumissionsForLead,
    updateStatus,
    error: soumissionError,
  } = useSoumissionStore();
  const {
    conversations,
    currentMessages,
    isLoadingConversations,
    isLoadingMessages,
    fetchConversations,
    fetchConversation,
    sendMessage,
  } = useMessageStore();

  // Selected lead for viewing soumissions
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Messaging panel state
  const [showMessages, setShowMessages] = useState(false);
  const [selectedConvLeadId, setSelectedConvLeadId] = useState<number | undefined>();
  const [selectedConvEntrepreneurId, setSelectedConvEntrepreneurId] = useState<number | undefined>();

  // Evaluation modal state
  const [evaluateSoumissionId, setEvaluateSoumissionId] = useState<number | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  useEffect(() => {
    fetchMyLeads();
  }, [fetchMyLeads]);

  // When a lead is selected, fetch its soumissions
  useEffect(() => {
    if (selectedLead) {
      fetchSoumissionsForLead(selectedLead.id);
    }
  }, [selectedLead, fetchSoumissionsForLead]);

  // When messages panel opens, fetch conversations
  useEffect(() => {
    if (showMessages) {
      fetchConversations();
    }
  }, [showMessages, fetchConversations]);

  // Handle selecting a lead from the grid
  function handleViewLead(id: number) {
    const lead = myLeads.find((l) => l.id === id);
    if (lead) {
      setSelectedLead(lead);
    }
  }

  // Handle closing the lead detail panel
  function handleCloseLead() {
    setSelectedLead(null);
  }

  // Handle accept/reject soumission — capture lead id at click-time to avoid
  // a race where the user switches projects while the API call is in flight.
  async function handleAccept(id: number) {
    const leadIdAtTime = selectedLead?.id ?? null;
    try {
      await updateStatus(id, 'acceptee');
      toast.success('Soumission acceptée', {
        description: 'L\u2019entrepreneur a été notifié. Vous pouvez maintenant communiquer avec lui.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur';
      toast.error('Acceptation impossible', { description: message });
    }
    if (leadIdAtTime != null) {
      fetchSoumissionsForLead(leadIdAtTime);
    }
  }

  async function handleReject(id: number) {
    const leadIdAtTime = selectedLead?.id ?? null;
    try {
      await updateStatus(id, 'refusee');
      toast.success('Soumission refusée', {
        description: 'L\u2019entrepreneur a été notifié.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur';
      toast.error('Refus impossible', { description: message });
    }
    if (leadIdAtTime != null) {
      fetchSoumissionsForLead(leadIdAtTime);
    }
  }

  async function handleAward(id: number) {
    if (!selectedLead) return;
    // Capture the lead id at click-time — the user may switch projects while the
    // API call is in flight, so we must not rely on selectedLead.id after await.
    const leadIdAtTime = selectedLead.id;
    try {
      await useSoumissionStore.getState().awardSoumission(id, leadIdAtTime);
      toast.success('Contrat attribué', {
        description: 'L\u2019entrepreneur retenu a été notifié. Les autres soumissions ont été refusées.',
      });
      fetchSoumissionsForLead(leadIdAtTime);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur';
      toast.error('Attribution impossible', { description: message });
    }
  }

  // Handle soumission detail (could open evaluation for accepted ones)
  function handleViewDetails(id: number) {
    const soum = soumissionsForLead.find((s) => s.id === id);
    if (soum && soum.statut === 'acceptee') {
      setEvaluateSoumissionId(id);
    }
  }

  // Handle evaluation submission
  async function handleEvaluationSubmit(data: {
    soumissionId: number;
    note: number;
    commentaire?: string;
  }) {
    setIsEvaluating(true);
    try {
      await createEvaluation(data);
      setEvaluateSoumissionId(null);
      toast.success('Évaluation envoyée', {
        description: 'Merci ! Votre évaluation aidera les autres clients.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\u2019envoi';
      toast.error('Évaluation non envoyée', { description: message });
    } finally {
      setIsEvaluating(false);
    }
  }

  // Handle selecting a conversation
  function handleSelectConversation(leadId: number, entrepreneurId: number) {
    setSelectedConvLeadId(leadId);
    setSelectedConvEntrepreneurId(entrepreneurId);
    fetchConversation(leadId, entrepreneurId);
  }

  // Handle sending a message
  async function handleSendMessage(message: string) {
    if (selectedConvLeadId && selectedConvEntrepreneurId) {
      try {
        await sendMessage(selectedConvLeadId, selectedConvEntrepreneurId, message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Message non envoyé';
        toast.error('Envoi impossible', { description: msg });
      }
    }
  }

  // Derived stats
  const totalProjets = myLeads.length;
  const avecSoumissions = myLeads.filter(
    (l) => (l.nbSoumissions ?? 0) > 0,
  ).length;
  const enCours = myLeads.filter(
    (l) => l.statut === 'nouveau' || l.statut === 'en_cours',
  ).length;

  // Get the name of the other party in the selected conversation
  const selectedConversation = conversations.find(
    (c) => c.leadId === selectedConvLeadId && c.entrepreneurId === selectedConvEntrepreneurId,
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Mes appels d&apos;offres
        </h1>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<MessageSquare className="h-4 w-4" />}
          onClick={() => setShowMessages(!showMessages)}
        >
          Messages
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total projets"
          value={totalProjets}
          icon={<Briefcase className="h-5 w-5" />}
        />
        <StatCard
          label="Avec soumissions"
          value={avecSoumissions}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
          label="En cours"
          value={enCours}
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      {/* Error */}
      {(error || soumissionError) && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error || soumissionError}
        </div>
      )}

      {/* ===== Messages Panel (slide-in) ===== */}
      {showMessages && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
          <div className="flex flex-col sm:flex-row h-[70vh] sm:h-[500px]">
            {/* Left: Conversation list */}
            <div className={`w-full sm:w-80 shrink-0 border-b sm:border-b-0 sm:border-r border-gray-200 dark:border-gray-700 overflow-y-auto ${selectedConvLeadId && selectedConvEntrepreneurId ? 'hidden sm:block' : ''}`}>
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Conversations
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowMessages(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    aria-label="Fermer les messages"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <ConversationList
                conversations={conversations}
                selectedLeadId={selectedConvLeadId}
                selectedEntrepreneurId={selectedConvEntrepreneurId}
                onSelect={handleSelectConversation}
                isLoading={isLoadingConversations}
              />
            </div>

            {/* Right: Chat thread */}
            <div className={`flex-1 min-w-0 ${selectedConvLeadId && selectedConvEntrepreneurId ? '' : 'hidden sm:flex'}`}>
              {selectedConvLeadId && selectedConvEntrepreneurId ? (
                <div className="flex flex-col h-full">
                  {/* Mobile back button */}
                  <button
                    type="button"
                    onClick={() => { setSelectedConvLeadId(undefined); setSelectedConvEntrepreneurId(undefined); }}
                    className="sm:hidden flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 min-h-[44px]"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Retour aux conversations
                  </button>
                  <div className="flex-1 min-h-0">
                    <ChatThread
                      messages={currentMessages}
                      currentUserType={user?.userType ?? 'client'}
                      currentUserId={user?.userId ?? 0}
                      onSend={handleSendMessage}
                      isLoading={isLoadingMessages}
                      otherPartyName={selectedConversation?.otherPartyName ?? undefined}
                      leadNom={selectedConversation?.leadNumeroReference ?? undefined}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                  <p className="text-sm">Sélectionnez une conversation</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Selected Lead Detail (soumissions view) ===== */}
      {selectedLead ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCloseLead}
              leftIcon={<ChevronLeft className="h-4 w-4" />}
            >
              Retour
            </Button>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Soumissions pour: {selectedLead.nom || `Projet ${selectedLead.numeroReference || selectedLead.id}`}
            </h2>
          </div>
          <SoumissionList
            soumissions={soumissionsForLead}
            isClientView
            onAccept={handleAccept}
            onReject={handleReject}
            onAward={handleAward}
            onViewDetails={handleViewDetails}
            isLoading={isLoadingSoumissions}
          />
        </div>
      ) : (
        <>
          {/* Loading */}
          {isLoadingMyLeads ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : myLeads.length > 0 ? (
            /* Projects Grid */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {myLeads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onView={handleViewLead}
                />
              ))}
            </div>
          ) : (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FolderOpen className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
                Vous n&apos;avez pas encore publié de projet
              </p>
              <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
                Publiez votre premier appel d&apos;offres pour recevoir des soumissions
              </p>
              <Link
                to="/nouveau-projet"
                className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-seaop-primary-600 text-white font-medium hover:bg-seaop-primary-700 transition-colors duration-200 dark:bg-seaop-primary-500 dark:hover:bg-seaop-primary-600"
              >
                <PlusCircle className="h-5 w-5" />
                Déposer un projet
              </Link>
            </div>
          )}
        </>
      )}

      {/* ===== Evaluation Modal ===== */}
      <Modal
        isOpen={evaluateSoumissionId !== null}
        onClose={() => setEvaluateSoumissionId(null)}
        title="Évaluer l'entrepreneur"
        size="md"
      >
        {evaluateSoumissionId !== null && (
          <EvaluationForm
            soumissionId={evaluateSoumissionId}
            onSubmit={handleEvaluationSubmit}
            isLoading={isEvaluating}
          />
        )}
      </Modal>
    </div>
  );
}
