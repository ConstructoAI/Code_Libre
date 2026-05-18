/**
 * B2B Client Portal - Catalogue
 * Product grid with search, category filter, add to cart, favorites.
 */

import { useEffect, useState, useRef } from 'react';
import { Search, ShoppingCart, Heart } from 'lucide-react';
import { useB2bPortalStore } from '@/store/useB2bPortalStore';

export default function B2bCataloguePage() {
  const {
    catalogue, catalogueCategories, isLoading, error,
    fetchCatalogue, addToCart, favoris, fetchFavoris, toggleFavori,
  } = useB2bPortalStore();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categorie, setCategorie] = useState('');
  const [addedId, setAddedId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search input (400ms)
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => { fetchCatalogue({ search: debouncedSearch || undefined, categorie: categorie || undefined }); }, [fetchCatalogue, debouncedSearch, categorie]);
  useEffect(() => { fetchFavoris(); }, [fetchFavoris]);

  const favIds = new Set(favoris.map((f) => f.produitId));

  const handleAdd = async (produitId: number) => {
    await addToCart(produitId);
    setAddedId(produitId);
    setTimeout(() => setAddedId(null), 1500);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#323130] dark:text-[#f3f2f1]">Catalogue</h1>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#605e5c]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un produit..."
            className="w-full pl-9 pr-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1] focus:border-[#0078D4] outline-none"
          />
        </div>
        <select
          value={categorie}
          onChange={(e) => setCategorie(e.target.value)}
          className="px-3 py-2 border border-[#8a8886] dark:border-[#605e5c] rounded text-sm bg-white dark:bg-[#1b1a19] text-[#323130] dark:text-[#f3f2f1]"
        >
          <option value="">Toutes les catégories</option>
          {catalogueCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">{error}</div>}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : catalogue.length === 0 ? (
        <div className="text-center py-16 text-[#605e5c]">
          <p className="text-lg font-medium">Aucun produit trouvé</p>
          <p className="text-sm mt-1">Essayez une autre recherche ou catégorie</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {catalogue.map((p) => (
            <div key={p.id} className="bg-white dark:bg-[#292827] rounded-lg border border-[#edebe9] dark:border-[#3b3a39] p-4 flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#323130] dark:text-[#f3f2f1]">{p.nom}</h3>
                  {p.codeProduit && <p className="text-xs text-[#605e5c]">{p.codeProduit}</p>}
                </div>
                <button
                  onClick={() => toggleFavori(p.id, favIds.has(p.id))}
                  className={`p-1 rounded ${favIds.has(p.id) ? 'text-red-500' : 'text-[#a19f9d] hover:text-red-400'}`}
                >
                  <Heart size={16} fill={favIds.has(p.id) ? 'currentColor' : 'none'} />
                </button>
              </div>
              {p.description && <p className="text-xs text-[#605e5c] mb-2 line-clamp-2">{p.description}</p>}
              {p.categorie && (
                <span className="inline-block text-[10px] bg-[#deecf9] dark:bg-[#0078D4]/20 text-[#0078D4] px-2 py-0.5 rounded mb-2 w-fit">{p.categorie}</span>
              )}
              <div className="mt-auto flex items-center justify-between pt-3 border-t border-[#edebe9] dark:border-[#3b3a39]">
                <div>
                  <p className="text-lg font-bold text-[#323130] dark:text-[#f3f2f1]">
                    {p.prixUnitaire != null ? `${(p.prixUnitaire ?? 0).toFixed(2)} $` : '--'}
                  </p>
                  {p.unite && <p className="text-[10px] text-[#605e5c]">par {p.unite}</p>}
                </div>
                <button
                  onClick={() => handleAdd(p.id)}
                  disabled={addedId === p.id}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    addedId === p.id
                      ? 'bg-green-100 text-green-700'
                      : 'bg-[#0078D4] hover:bg-[#106EBE] text-white'
                  }`}
                >
                  <ShoppingCart size={14} />
                  {addedId === p.id ? 'Ajouté!' : 'Ajouter'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
