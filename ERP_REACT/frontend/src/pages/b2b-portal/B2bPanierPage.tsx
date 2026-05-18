/**
 * B2B Client Portal - Panier (Cart) + Checkout
 * Cart items, quantity controls, TPS/TVQ breakdown, checkout form.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2, CheckCircle } from 'lucide-react';
import { useB2bPortalStore } from '@/store/useB2bPortalStore';

export default function B2bPanierPage() {
  const { panier, isLoading, error, successMessage, fetchPanier, updateCartItem, removeCartItem, checkout, clearSuccess } = useB2bPortalStore();
  const [showCheckout, setShowCheckout] = useState(false);
  const [adresse, setAdresse] = useState('');
  const [ville, setVille] = useState('');
  const [codePostal, setCodePostal] = useState('');
  const [notes, setNotes] = useState('');
  const [orderResult, setOrderResult] = useState<{ numero: string; totalTtc: number } | null>(null);

  useEffect(() => { fetchPanier(); }, [fetchPanier]);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await checkout({ adresseLivraison: adresse, villeLivraison: ville, codePostalLivraison: codePostal, notesClient: notes });
    if (res) {
      setOrderResult(res);
      setShowCheckout(false);
    }
  };

  if (orderResult) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckCircle size={64} className="text-green-500 mb-4" />
        <h1 className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1] mb-2">Commande confirmée!</h1>
        <p className="text-[#605e5c] mb-1">Numéro: <span className="font-mono font-bold">{orderResult.numero}</span></p>
        <p className="text-[#605e5c]">Total: <span className="font-bold">{(orderResult.totalTtc ?? 0).toFixed(2)} $</span></p>
        <button onClick={() => { setOrderResult(null); fetchPanier(); }} className="mt-6 px-6 py-2 bg-[#0078D4] text-white rounded text-sm font-medium hover:bg-[#106EBE]">
          Retour au panier
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1]">Mon panier</h1>

      {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded text-sm text-red-700 dark:text-red-300">{error}</div>}
      {successMessage && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 rounded text-sm text-green-700 dark:text-green-300 flex justify-between">
          <span>{successMessage}</span>
          <button onClick={clearSuccess}>&times;</button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : !panier || panier.nbItems === 0 ? (
        <div className="text-center py-16 text-[#605e5c]">
          <p className="text-lg font-medium">Votre panier est vide</p>
          <Link to="/b2b-portal/catalogue" className="inline-block mt-4 px-4 py-2 bg-[#0078D4] text-white rounded text-sm hover:bg-[#106EBE]">Parcourir le catalogue</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cart items */}
          <div className="lg:col-span-2 space-y-3">
            {panier.items.map((item) => (
              <div key={item.id} className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#323130] dark:text-[#f3f2f1] truncate">{item.produitNom || `Produit #${item.produitId}`}</p>
                  {item.codeProduit && <p className="text-xs text-[#605e5c]">{item.codeProduit}</p>}
                  <p className="text-xs text-[#605e5c] mt-1">{(item.prixUnitaire || 0).toFixed(2)} $ / {item.unite || 'unité'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateCartItem(item.id, item.quantite - 1)} disabled={item.quantite <= 1} className="p-1 rounded border border-[#edebe9] hover:bg-[#f3f2f1] dark:border-[#3b3a39] disabled:opacity-30">
                    <Minus size={14} />
                  </button>
                  <span className="text-sm font-medium w-8 text-center">{item.quantite}</span>
                  <button onClick={() => updateCartItem(item.id, item.quantite + 1)} className="p-1 rounded border border-[#edebe9] hover:bg-[#f3f2f1] dark:border-[#3b3a39]">
                    <Plus size={14} />
                  </button>
                </div>
                <p className="text-sm font-bold text-[#323130] dark:text-[#f3f2f1] w-20 text-right">
                  {((item.prixUnitaire || 0) * item.quantite).toFixed(2)} $
                </p>
                <button onClick={() => removeCartItem(item.id)} className="p-1 text-red-400 hover:text-red-600">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="bg-white dark:bg-[#292827] rounded border border-[#edebe9] dark:border-[#3b3a39] p-4 h-fit">
            <h3 className="text-sm font-semibold text-[#323130] dark:text-[#f3f2f1] mb-3">Résumé</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-[#605e5c]">Sous-total</span><span>{(panier.sousTotal ?? 0).toFixed(2)} $</span></div>
              <div className="flex justify-between"><span className="text-[#605e5c]">TPS (5%)</span><span>{(panier.tps ?? 0).toFixed(2)} $</span></div>
              <div className="flex justify-between"><span className="text-[#605e5c]">TVQ (9.975%)</span><span>{(panier.tvq ?? 0).toFixed(2)} $</span></div>
              <div className="flex justify-between pt-2 border-t border-[#edebe9] dark:border-[#3b3a39] font-bold text-base">
                <span>Total TTC</span><span>{(panier.totalTtc ?? 0).toFixed(2)} $</span>
              </div>
            </div>
            {!showCheckout ? (
              <button onClick={() => setShowCheckout(true)} className="w-full mt-4 py-2 bg-[#0078D4] text-white rounded text-sm font-medium hover:bg-[#106EBE]">
                Commander
              </button>
            ) : (
              <form onSubmit={handleCheckout} className="mt-4 space-y-3">
                <input type="text" value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="Adresse de livraison"
                  className="w-full px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
                <div className="flex gap-2">
                  <input type="text" value={ville} onChange={(e) => setVille(e.target.value)} placeholder="Ville"
                    className="flex-1 px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
                  <input type="text" value={codePostal} onChange={(e) => setCodePostal(e.target.value)} placeholder="Code postal"
                    className="w-28 px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
                </div>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optionnel)" rows={2}
                  className="w-full px-3 py-2 border border-[#8a8886] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]" />
                <button type="submit" disabled={isLoading} className="w-full py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                  {isLoading ? 'Traitement...' : 'Confirmer la commande'}
                </button>
                <button type="button" onClick={() => setShowCheckout(false)} className="w-full py-2 text-sm text-[#605e5c] hover:text-[#323130]">
                  Annuler
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
