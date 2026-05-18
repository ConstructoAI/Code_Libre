/**
 * B2B Client Portal - Commandes (Orders)
 * Order history with status badges and detail view.
 */

import { useEffect, useState } from 'react';
import { Package, ArrowLeft, ChevronRight } from 'lucide-react';
import { useB2bPortalStore } from '@/store/useB2bPortalStore';

const STATUS_COLORS: Record<string, string> = {
  EN_ATTENTE: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
  CONFIRMEE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
  EN_PREPARATION: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300',
  EXPEDIEE: 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300',
  LIVREE: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300',
  ANNULEE: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300',
};

export default function B2bCommandesPage() {
  const { commandes, currentCommande, isLoading, fetchCommandes, fetchCommande } = useB2bPortalStore();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => { fetchCommandes(); }, [fetchCommandes]);

  const handleSelect = (id: number) => {
    setSelectedId(id);
    useB2bPortalStore.setState({ currentCommande: null });
    fetchCommande(id);
  };

  if (selectedId && currentCommande) {
    return (
      <div className="space-y-6">
        <button onClick={() => { setSelectedId(null); useB2bPortalStore.setState({ currentCommande: null }); }} className="flex items-center gap-1 text-sm text-[#0078D4] hover:underline">
          <ArrowLeft size={16} /> Retour aux commandes
        </button>
        <div className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#323130] dark:text-[#f3f2f1]">Commande {currentCommande.numero}</h2>
              <p className="text-xs text-[#605e5c]">{currentCommande.dateCommande ? new Date(currentCommande.dateCommande).toLocaleDateString('fr-CA') : ''}</p>
            </div>
            <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[currentCommande.statut] || 'bg-gray-100'}`}>{currentCommande.statut}</span>
          </div>
          {/* Lines */}
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="border-b border-[#edebe9] dark:border-[#3b3a39] text-[#605e5c]">
                <th className="text-left py-2">Produit</th>
                <th className="text-right py-2">Qté</th>
                <th className="text-right py-2">Prix unit.</th>
                <th className="text-right py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {currentCommande.lignes?.map((l) => (
                <tr key={l.id} className="border-b border-[#f3f2f1] dark:border-[#3b3a39]">
                  <td className="py-2 text-[#323130] dark:text-[#f3f2f1]">{l.nomProduit || l.codeProduit || `#${l.produitId}`}</td>
                  <td className="py-2 text-right">{l.quantite}</td>
                  <td className="py-2 text-right">{(l.prixUnitaire || 0).toFixed(2)} $</td>
                  <td className="py-2 text-right font-medium">{(l.montantLigne || 0).toFixed(2)} $</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 pt-4 border-t border-[#edebe9] dark:border-[#3b3a39] space-y-1 text-sm text-right">
            <p><span className="text-[#605e5c]">Sous-total:</span> {(currentCommande.sousTotal || 0).toFixed(2)} $</p>
            <p><span className="text-[#605e5c]">TPS (5%):</span> {(currentCommande.tps || 0).toFixed(2)} $</p>
            <p><span className="text-[#605e5c]">TVQ (9.975%):</span> {(currentCommande.tvq || 0).toFixed(2)} $</p>
            <p className="text-base font-bold"><span className="text-[#605e5c]">Total TTC:</span> {(currentCommande.totalTtc || 0).toFixed(2)} $</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1]">Mes commandes</h1>
      {isLoading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : commandes.length === 0 ? (
        <div className="text-center py-16 text-[#605e5c]">
          <Package size={48} className="mx-auto mb-4 text-[#a19f9d]" />
          <p className="text-lg font-medium">Aucune commande</p>
        </div>
      ) : (
        <div className="space-y-3">
          {commandes.map((cmd) => (
            <button
              key={cmd.id}
              onClick={() => handleSelect(cmd.id)}
              className="w-full text-left bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] p-4 hover:border-[#0078D4] transition-colors flex items-center gap-4"
            >
              <Package size={20} className="text-[#0078D4] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1]">{cmd.numero}</p>
                <p className="text-xs text-[#605e5c]">{cmd.dateCommande ? new Date(cmd.dateCommande).toLocaleDateString('fr-CA') : ''}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[cmd.statut] || 'bg-gray-100'}`}>{cmd.statut}</span>
              <p className="text-sm font-bold text-[#323130] dark:text-[#f3f2f1]">{(cmd.totalTtc || 0).toFixed(2)} $</p>
              <ChevronRight size={16} className="text-[#a19f9d]" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
