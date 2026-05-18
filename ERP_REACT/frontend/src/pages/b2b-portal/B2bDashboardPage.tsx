/**
 * B2B Client Portal - Dashboard
 * KPI cards + quick actions.
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, FileText, Handshake, MessageSquare, ShoppingBag, PlusCircle } from 'lucide-react';
import { useB2bPortalStore } from '@/store/useB2bPortalStore';
import { useB2bAuthStore } from '@/store/useB2bAuthStore';

export default function B2bDashboardPage() {
  const { dashboard, isLoading, fetchDashboard } = useB2bPortalStore();
  const { clientUser } = useB2bAuthStore();

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const kpis = [
    { label: 'Commandes actives', value: dashboard?.commandesActives ?? '--', icon: Package, color: 'text-blue-600', to: '/b2b-portal/commandes' },
    { label: 'Demandes en cours', value: dashboard?.demandesEnCours ?? '--', icon: FileText, color: 'text-amber-600', to: '/b2b-portal/demandes' },
    { label: 'Contrats actifs', value: dashboard?.contratsActifs ?? '--', icon: Handshake, color: 'text-green-600', to: '/b2b-portal/demandes' },
    { label: 'Messages non lus', value: dashboard?.messagesNonLus ?? '--', icon: MessageSquare, color: 'text-purple-600', to: '/b2b-portal/messages' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1]">
          Bienvenue{clientUser ? `, ${clientUser.displayName || clientUser.email}` : ''}
        </h1>
        <p className="text-sm text-[#605e5c] mt-1">
          {clientUser?.companyNom && `Portail client de ${clientUser.companyNom}`}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Link
            key={kpi.label}
            to={kpi.to}
            className="bg-white dark:bg-[#292827] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3">
              <kpi.icon size={20} className={kpi.color} />
              <div>
                <p className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1]">
                  {isLoading ? '...' : kpi.value}
                </p>
                <p className="text-xs text-[#605e5c]">{kpi.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-[#323130] dark:text-[#f3f2f1] mb-4">Actions rapides</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            to="/b2b-portal/catalogue"
            className="flex items-center gap-3 p-4 bg-white dark:bg-[#292827] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] hover:border-[#0078D4] transition-colors"
          >
            <ShoppingBag size={20} className="text-[#0078D4]" />
            <div>
              <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1]">Parcourir le catalogue</p>
              <p className="text-xs text-[#605e5c]">Produits et matériaux</p>
            </div>
          </Link>
          <Link
            to="/b2b-portal/demandes"
            className="flex items-center gap-3 p-4 bg-white dark:bg-[#292827] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] hover:border-[#0078D4] transition-colors"
          >
            <PlusCircle size={20} className="text-[#0078D4]" />
            <div>
              <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1]">Demande de soumission</p>
              <p className="text-xs text-[#605e5c]">Nouveau projet</p>
            </div>
          </Link>
          <Link
            to="/b2b-portal/messages"
            className="flex items-center gap-3 p-4 bg-white dark:bg-[#292827] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] hover:border-[#0078D4] transition-colors"
          >
            <MessageSquare size={20} className="text-[#0078D4]" />
            <div>
              <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1]">Envoyer un message</p>
              <p className="text-xs text-[#605e5c]">Communiquer avec le fournisseur</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
