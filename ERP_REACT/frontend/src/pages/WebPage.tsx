/**
 * ERP React Frontend - Web Page
 * Recherche web en temps reel, analyse de page, recherche+analyse combinee.
 * Utilise les outils Claude web_search_20260209 + web_fetch_20250910 via le backend.
 * Conserve les liens utiles construction Quebec comme section supplementaire.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Globe, Search, FileText, ExternalLink, Shield, HardHat,
  DollarSign, Building2, Scale, Landmark, BookOpen, Loader2,
  Clock, X, History, Zap, Link,
} from 'lucide-react';
import { useWebStore } from '@/store/useWebStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import type { WebResult, WebCitation } from '@/api/web';

// ============ Types ============

type TabKey = 'search' | 'fetch' | 'search-fetch' | 'history' | 'links';

// ============ Links data (kept from original) ============

interface WebLink {
  title: string;
  description: string;
  url: string;
  icon: React.ReactNode;
  color: string;
}

const LIENS_UTILES: WebLink[] = [
  {
    title: 'Commission de la construction du Quebec (CCQ)',
    description: 'Conventions collectives, formations, avantages sociaux et relations de travail dans la construction.',
    url: 'https://www.ccq.org',
    icon: <HardHat size={20} />,
    color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  },
  {
    title: 'Regie du batiment du Quebec (RBQ)',
    description: "Licences d'entrepreneur, normes de construction, securite du public et conformite reglementaire.",
    url: 'https://www.rbq.gouv.qc.ca',
    icon: <Shield size={20} />,
    color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
  },
  {
    title: 'CNESST',
    description: 'Sante et securite du travail, normes du travail, equite salariale et indemnisation.',
    url: 'https://www.cnesst.gouv.qc.ca',
    icon: <Scale size={20} />,
    color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
  },
  {
    title: 'Revenu Quebec',
    description: "Impots, taxes (TPS/TVQ), retenues a la source, credits d'impot pour la construction.",
    url: 'https://www.revenuquebec.ca',
    icon: <DollarSign size={20} />,
    color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  },
  {
    title: 'Code de construction du Quebec',
    description: 'Codes et normes en vigueur pour la construction et la renovation au Quebec.',
    url: 'https://www.rbq.gouv.qc.ca/lois-reglements-et-codes',
    icon: <BookOpen size={20} />,
    color: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400',
  },
  {
    title: 'Registre des entreprises du Quebec (REQ)',
    description: "Recherche d'entreprises, immatriculation et declarations annuelles.",
    url: 'https://www.registreentreprises.gouv.qc.ca',
    icon: <Building2 size={20} />,
    color: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
  },
  {
    title: 'Verificateur de licences RBQ',
    description: "Verifier la licence d'un entrepreneur ou d'un constructeur-proprietaire.",
    url: 'https://www.rbq.gouv.qc.ca/services-en-ligne/licence/registre-des-detenteurs-de-licence',
    icon: <Shield size={20} />,
    color: 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400',
  },
  {
    title: 'Plan Quebec',
    description: 'Infrastructure, investissements publics et programmes gouvernementaux en construction.',
    url: 'https://www.quebec.ca/gouvernement/politiques-orientations/plan-quebecois-infrastructures',
    icon: <Landmark size={20} />,
    color: 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400',
  },
];

// ============ Tab definitions ============

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'search', label: 'Recherche Web', icon: Search },
  { key: 'fetch', label: 'Analyse de Page', icon: FileText },
  { key: 'search-fetch', label: 'Recherche + Analyse', icon: Zap },
  { key: 'history', label: 'Historique', icon: History },
  { key: 'links', label: 'Liens utiles', icon: ExternalLink },
];

// ============ Result display component ============

function ResultCard({ result, label }: { result: WebResult; label: string }) {
  return (
    <div className="mt-4 space-y-4">
      {/* Stats bar */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
        {result.searchCount > 0 && (
          <span className="flex items-center gap-1">
            <Search size={12} /> {result.searchCount} recherche(s)
          </span>
        )}
        {result.fetchCount > 0 && (
          <span className="flex items-center gap-1">
            <FileText size={12} /> {result.fetchCount} analyse(s)
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock size={12} /> {result.elapsedSeconds}s
        </span>
        <span>
          {result.inputTokens + result.outputTokens} tokens
        </span>
        <span>
          {(result.costUsd ?? 0).toFixed(4)} $ USD
        </span>
      </div>

      {/* Main result text */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 prose prose-sm dark:prose-invert max-w-none">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{label}</h4>
        <div className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">
          {result.text || 'Aucun resultat textuel.'}
        </div>
      </div>

      {/* Citations */}
      {result.citations.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <h5 className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">
            Sources ({result.citations.length})
          </h5>
          <ul className="space-y-1">
            {result.citations.map((c: WebCitation, i: number) => (
              <li key={i}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <ExternalLink size={10} className="shrink-0" />
                  {c.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============ Link card component ============

function LinkCard({ link }: { link: WebLink }) {
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" className="block group">
      <Card hover className="h-full transition-all duration-200">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 p-2.5 rounded-xl ${link.color}`}>
            {link.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {link.title}
              </h3>
              <ExternalLink size={12} className="shrink-0 text-gray-400 group-hover:text-blue-500 transition-colors" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
              {link.description}
            </p>
          </div>
        </div>
      </Card>
    </a>
  );
}

// ============ Domain filter component ============

function DomainFilter({
  filterType,
  setFilterType,
  domains,
  setDomains,
}: {
  filterType: 'none' | 'allow' | 'block';
  setFilterType: (v: 'none' | 'allow' | 'block') => void;
  domains: string;
  setDomains: (v: string) => void;
}) {
  return (
    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Filtrage de domaines</p>
      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={() => setFilterType('none')}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            filterType === 'none'
              ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          Aucun
        </button>
        <button
          type="button"
          onClick={() => setFilterType('allow')}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            filterType === 'allow'
              ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          Autoriser
        </button>
        <button
          type="button"
          onClick={() => setFilterType('block')}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            filterType === 'block'
              ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          Bloquer
        </button>
      </div>
      {filterType !== 'none' && (
        <Input
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder="Ex: quebec.ca, canada.ca, rbq.gouv.qc.ca"
          className="text-xs"
        />
      )}
    </div>
  );
}

// ============ Main component ============

export default function WebPage() {
  const {
    searchResult, fetchResult, searchFetchResult,
    searchHistory,
    isSearching, isFetching, isSearchFetching,
    error,
    webSearch, webFetch, webSearchFetch,
    fetchHistory, clearResult, clearError,
  } = useWebStore();

  const [activeTab, setActiveTab] = useState<TabKey>('search');

  // Search tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMaxUses, setSearchMaxUses] = useState(5);
  const [searchFilterType, setSearchFilterType] = useState<'none' | 'allow' | 'block'>('none');
  const [searchDomains, setSearchDomains] = useState('');

  // Fetch tab state
  const [fetchUrl, setFetchUrl] = useState('');
  const [fetchMaxTokens, setFetchMaxTokens] = useState(100000);
  const [fetchCitations, setFetchCitations] = useState(true);
  const [fetchFilterType, setFetchFilterType] = useState<'none' | 'allow' | 'block'>('none');
  const [fetchDomains, setFetchDomains] = useState('');

  // Search+Fetch tab state (only "allow" filtering — backend doesn't support blockedDomains on this endpoint)
  const [sfQuery, setSfQuery] = useState('');
  const [sfMaxSearch, setSfMaxSearch] = useState(3);
  const [sfMaxFetch, setSfMaxFetch] = useState(2);
  const [sfAllowDomains, setSfAllowDomains] = useState('');

  // Load history when switching to history tab
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory(50);
    }
  }, [activeTab, fetchHistory]);

  // Clear error after 8s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 8000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  // Parse domains helper
  const parseDomains = useCallback((input: string): string[] | undefined => {
    if (!input.trim()) return undefined;
    return input.split(',').map((d) => d.trim()).filter(Boolean);
  }, []);

  // Handlers
  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    webSearch({
      query: searchQuery.trim(),
      maxUses: searchMaxUses,
      allowedDomains: searchFilterType === 'allow' ? parseDomains(searchDomains) : undefined,
      blockedDomains: searchFilterType === 'block' ? parseDomains(searchDomains) : undefined,
    });
  }, [searchQuery, searchMaxUses, searchFilterType, searchDomains, webSearch, parseDomains]);

  const handleFetch = useCallback(() => {
    if (!fetchUrl.trim()) return;
    webFetch({
      url: fetchUrl.trim(),
      maxUses: 5,
      enableCitations: fetchCitations,
      maxContentTokens: fetchMaxTokens,
      allowedDomains: fetchFilterType === 'allow' ? parseDomains(fetchDomains) : undefined,
      blockedDomains: fetchFilterType === 'block' ? parseDomains(fetchDomains) : undefined,
    });
  }, [fetchUrl, fetchCitations, fetchMaxTokens, fetchFilterType, fetchDomains, webFetch, parseDomains]);

  const handleSearchFetch = useCallback(() => {
    if (!sfQuery.trim()) return;
    webSearchFetch({
      query: sfQuery.trim(),
      maxSearchUses: sfMaxSearch,
      maxFetchUses: sfMaxFetch,
      allowedDomains: parseDomains(sfAllowDomains),
    });
  }, [sfQuery, sfMaxSearch, sfMaxFetch, sfAllowDomains, webSearchFetch, parseDomains]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <Globe size={24} className="text-blue-600" />
          Web - Recherche et Analyse
        </h2>
      </div>

      {/* Error alert */}
      {error && (
        <Alert type="error" onClose={clearError}>
          {error}
        </Alert>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              type="button"
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ===== TAB: Recherche Web ===== */}
      {activeTab === 'search' && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>Recherche web en temps réel</strong> - Claude recherche sur internet et fournit une réponse avec les sources citées.
            </p>
          </div>

          <Textarea
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ex: Quelles sont les dernières innovations en construction modulaire au Québec?"
            rows={3}
          />

          <div className="flex items-center gap-4">
            <label className="text-sm text-gray-600 dark:text-gray-400">
              Max recherches:
              <input
                type="range"
                min={1}
                max={10}
                value={searchMaxUses}
                onChange={(e) => setSearchMaxUses(Number(e.target.value))}
                className="ml-2 w-24 align-middle"
              />
              <span className="ml-1 font-medium">{searchMaxUses}</span>
            </label>
          </div>

          <DomainFilter
            filterType={searchFilterType}
            setFilterType={setSearchFilterType}
            domains={searchDomains}
            setDomains={setSearchDomains}
          />

          <div className="flex gap-2">
            <Button onClick={handleSearch} disabled={isSearching || !searchQuery.trim()}>
              {isSearching ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-1" />
                  Recherche en cours...
                </>
              ) : (
                <>
                  <Search size={16} className="mr-1" />
                  Rechercher
                </>
              )}
            </Button>
            {searchResult && (
              <Button variant="outline" onClick={() => clearResult('search')}>
                <X size={16} className="mr-1" />
                Effacer
              </Button>
            )}
          </div>

          {isSearching && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Spinner size="sm" />
              Recherche web en cours, cela peut prendre quelques secondes...
            </div>
          )}

          {searchResult && <ResultCard result={searchResult} label="Resultat de la recherche" />}
        </div>
      )}

      {/* ===== TAB: Analyse de Page ===== */}
      {activeTab === 'fetch' && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>Analyse de page web ou PDF</strong> - Claude récupère et analyse en détail le contenu d'une URL spécifique.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link size={16} className="text-gray-400 shrink-0" />
            <Input
              value={fetchUrl}
              onChange={(e) => setFetchUrl(e.target.value)}
              placeholder="https://exemple.com/page-a-analyser"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm text-gray-600 dark:text-gray-400">
              Tokens max:
              <input
                type="range"
                min={10000}
                max={200000}
                step={10000}
                value={fetchMaxTokens}
                onChange={(e) => setFetchMaxTokens(Number(e.target.value))}
                className="ml-2 w-32 align-middle"
              />
              <span className="ml-1 font-medium">{(fetchMaxTokens / 1000).toFixed(0)}K</span>
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={fetchCitations}
                onChange={(e) => setFetchCitations(e.target.checked)}
                className="rounded border-gray-300"
              />
              Citations
            </label>
          </div>

          <DomainFilter
            filterType={fetchFilterType}
            setFilterType={setFetchFilterType}
            domains={fetchDomains}
            setDomains={setFetchDomains}
          />

          <div className="flex gap-2">
            <Button onClick={handleFetch} disabled={isFetching || !fetchUrl.trim()}>
              {isFetching ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-1" />
                  Analyse en cours...
                </>
              ) : (
                <>
                  <FileText size={16} className="mr-1" />
                  Analyser
                </>
              )}
            </Button>
            {fetchResult && (
              <Button variant="outline" onClick={() => clearResult('fetch')}>
                <X size={16} className="mr-1" />
                Effacer
              </Button>
            )}
          </div>

          {isFetching && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Spinner size="sm" />
              Recuperation et analyse de la page en cours...
            </div>
          )}

          {fetchResult && <ResultCard result={fetchResult} label="Analyse de la page" />}
        </div>
      )}

      {/* ===== TAB: Recherche + Analyse ===== */}
      {activeTab === 'search-fetch' && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>Recherche web + analyse approfondie</strong> - Claude recherche d'abord les informations pertinentes, puis analyse en détail les meilleures sources trouvées.
            </p>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Cette fonction utilise plus de ressources car elle combine recherche web ET analyse détaillée des sources. Temps de réponse plus long (30-60 secondes).
            </p>
          </div>

          <Textarea
            value={sfQuery}
            onChange={(e) => setSfQuery(e.target.value)}
            placeholder="Ex: Analyse détaillée des normes de construction sismique au Québec en 2025"
            rows={3}
          />

          <div className="flex flex-wrap items-center gap-6">
            <label className="text-sm text-gray-600 dark:text-gray-400">
              Max recherches:
              <input
                type="range"
                min={1}
                max={5}
                value={sfMaxSearch}
                onChange={(e) => setSfMaxSearch(Number(e.target.value))}
                className="ml-2 w-20 align-middle"
              />
              <span className="ml-1 font-medium">{sfMaxSearch}</span>
            </label>

            <label className="text-sm text-gray-600 dark:text-gray-400">
              Max analyses:
              <input
                type="range"
                min={1}
                max={5}
                value={sfMaxFetch}
                onChange={(e) => setSfMaxFetch(Number(e.target.value))}
                className="ml-2 w-20 align-middle"
              />
              <span className="ml-1 font-medium">{sfMaxFetch}</span>
            </label>
          </div>

          <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
              Domaines autorises (optionnel)
            </p>
            <Input
              value={sfAllowDomains}
              onChange={(e) => setSfAllowDomains(e.target.value)}
              placeholder="Ex: quebec.ca, canada.ca, rbq.gouv.qc.ca"
              className="text-xs"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSearchFetch} disabled={isSearchFetching || !sfQuery.trim()}>
              {isSearchFetching ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-1" />
                  Recherche approfondie en cours...
                </>
              ) : (
                <>
                  <Zap size={16} className="mr-1" />
                  Rechercher et Analyser
                </>
              )}
            </Button>
            {searchFetchResult && (
              <Button variant="outline" onClick={() => clearResult('searchFetch')}>
                <X size={16} className="mr-1" />
                Effacer
              </Button>
            )}
          </div>

          {isSearchFetching && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Spinner size="sm" />
              Recherche approfondie en cours, cela peut prendre 30-60 secondes...
            </div>
          )}

          {searchFetchResult && <ResultCard result={searchFetchResult} label="Analyse approfondie" />}
        </div>
      )}

      {/* ===== TAB: Historique ===== */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Historique de vos recherches web recentes.
            </p>
            <Button variant="outline" size="sm" onClick={() => fetchHistory(50)}>
              <Search size={14} className="mr-1" />
              Rafraichir
            </Button>
          </div>

          {searchHistory.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <History size={48} className="mx-auto mb-3 opacity-50" />
              <p>Aucune recherche dans l'historique.</p>
              <p className="text-xs mt-1">Vos recherches apparaîtront ici après utilisation.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {searchHistory.map((item) => (
                <div
                  key={item.id}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      item.searchType === 'search'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : item.searchType === 'fetch'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    }`}>
                      {item.searchType === 'search' ? 'Recherche' : item.searchType === 'fetch' ? 'Analyse' : 'Recherche + Analyse'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString('fr-CA') : ''}
                    </span>
                    {item.citationsCount > 0 && (
                      <span className="text-xs text-gray-400">{item.citationsCount} source(s)</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.query}</p>
                  {item.resultPreview && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {item.resultPreview}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: Liens utiles ===== */}
      {activeTab === 'links' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Organismes gouvernementaux, outils en ligne et ressources essentielles pour le secteur de la construction au Quebec.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {LIENS_UTILES.map((link) => (
              <LinkCard key={link.url} link={link} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
