# Module 27 — Web (Recherche Web Integree)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/web.py` (507 lignes, 4 endpoints, prefix `/web`, tag `Recherche Web`), `frontend/src/pages/WebPage.tsx` (5 onglets), `frontend/src/api/web.ts`, `frontend/src/store/useWebStore.ts`
> **Tables PostgreSQL (schema tenant)** : `web_search_history` (creee dynamiquement au premier appel, pas de migration officielle)
> **Cadrage** : interface de recherche web alimentee par les **outils Claude** (`web_search_20260209` + `web_fetch_20250910`). Il n y a **PAS** d integration directe avec Google, Bing, SerpAPI ou Brave : tout passe par l API Anthropic (Claude Opus 4.7). Pour une recherche dans les donnees internes du tenant (projets, factures...), utiliser le Module 25 IA via le tool `recherche_bd`.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (5 onglets)](#2-interface-5-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Permettre une **recherche web en temps reel** et une **analyse de pages web ou PDF** directement depuis l ERP :
- **Recherche web** : poser une question -> Claude interroge le web et synthetise une reponse avec sources citees.
- **Analyse de page** : fournir une URL -> Claude recupere le contenu, le resume et identifie les points cles.
- **Recherche + analyse combinee** : Claude cherche des sources, selectionne 1-2 prometteuses, puis les analyse en profondeur.
- **Historique** persiste par tenant (table `web_search_history`).
- **Liens utiles construction Quebec** : raccourcis vers les organismes officiels (CCQ, RBQ, CNESST, etc.).

### 1.2 Fournisseur de search

> **IMPORTANT** : ce module **ne s appuie PAS** sur un fournisseur classique (Google Custom Search, Bing, SerpAPI, Brave, DuckDuckGo). Il utilise **exclusivement les outils web natifs Claude** d Anthropic :
- `web_search_20260209` : recherche web cote serveur Anthropic (moteur exact non expose).
- `web_fetch_20250910` : recuperation et analyse du contenu d une URL.

**Cle API utilisee** : `ANTHROPIC_API_KEY` (variable d environnement, partagee avec le Module 25 IA). **Aucun fallback** vers un autre fournisseur si Anthropic est indisponible -> HTTP 503.

### 1.3 Modele Claude

Source : `web.py:31-32`

```
WEB_AI_MODEL = "claude-opus-4-7"
WEB_AI_MAX_TOKENS = 30000
```

Opus est utilise pour la qualite superieure de synthese. Cout 5x plus eleve que Sonnet : pricing `$0.015 / 1K input` + `$0.075 / 1K output`, markup x1.30.

### 1.4 Geolocalisation

Toutes les recherches incluent un `user_location` fixe (`web.py:196-202`) : `Montreal / Quebec / CA / America/Montreal`. Oriente Claude vers des resultats francophones et locaux. **Pas configurable** par UI.

### 1.5 Acces et permissions

- Sidebar -> **Web** (icone `Globe`), URL `/web`, onglet par defaut **Recherche Web**.
- Tous les utilisateurs authentifies du tenant peuvent utiliser le module (sous reserve de credits).
- Chaque appel passe par `check_ai_guard` + `_check_credits` + `_deduct_credits` + `track_ai_usage` (importees depuis `routers/ai.py`).
- Tenants exemptes (`{1, 105, 172}` codes en dur dans `ai.py`) : utilisation sans deduction.
- Erreurs : 503 si `ANTHROPIC_API_KEY` absent, 402 si credits insuffisants, 403 si AI guard refuse.

---

## 2. Interface (5 onglets)

Source : `WebPage.tsx:98-104` — array `TABS`.

| # | Cle              | Label                  | Icone        | Endpoint backend          |
|---|------------------|------------------------|--------------|---------------------------|
| 1 | `search`         | Recherche Web          | Search       | `POST /web/search`        |
| 2 | `fetch`          | Analyse de Page        | FileText     | `POST /web/fetch`         |
| 3 | `search-fetch`   | Recherche + Analyse    | Zap          | `POST /web/search-fetch`  |
| 4 | `history`        | Historique             | History      | `GET /web/history`        |
| 5 | `links`          | Liens utiles           | ExternalLink | (liens statiques)         |

### 2.1 Onglet « Recherche Web »

Recherche libre type Google :
- **Textarea** pour la question (3 lignes par defaut).
- **Slider Max recherches** : 1 a 10 (defaut 5). Limite les appels web search que Claude peut faire.
- **Filtrage de domaines** : 3 modes (`Aucun` / `Autoriser` / `Bloquer`) + champ texte (domaines separes par virgules). Max 10 domaines.
- Bouton **Rechercher** -> `POST /web/search`. Spinner pendant l execution.
- **Resultat** : carte avec stats (nb recherches/analyses, secondes, tokens, cout USD), texte de synthese, sources citees (titre cliquable + URL externe).

### 2.2 Onglet « Analyse de Page »

Analyse approfondie d une URL specifique :
- Champ **URL** (validation backend : doit commencer par `http://` ou `https://`, sinon HTTP 400).
- **Slider Tokens max** : 10K a 200K (paliers 10K, defaut 100K). Plafond backend 200K.
- **Checkbox Citations** (defaut active).
- **Filtrage de domaines** : meme widget que Recherche.
- Bouton **Analyser** -> `POST /web/fetch`.
- Le prompt force une analyse structuree en 4 sections (`web.py:303-310`) : Resume / Points cles / Contexte / Recommandations.

### 2.3 Onglet « Recherche + Analyse »

Mode combine (le plus puissant et le plus couteux) :
- **Textarea** pour la question.
- **Slider Max recherches** : 1 a 5 (defaut 3). **Slider Max analyses** : 1 a 5 (defaut 2).
- **Champ Domaines autorises** : applique aux 2 outils. **Pas de mode `Bloquer`** sur ce endpoint.
- Bandeau ambre rappelant que cette fonction est plus longue (30-60 secondes) et plus couteuse.
- Bouton **Rechercher et Analyser** -> `POST /web/search-fetch`.
- Le prompt force Claude a suivre un processus en 4 etapes : recherche -> identification 1-2 sources -> fetch -> synthese (`web.py:394-405`).

### 2.4 Onglet « Historique »

- Bouton **Rafraichir** -> `GET /web/history?limit=50`.
- Liste paginee chronologique decroissante (jusqu a `limit`, plafond 100).
- Pour chaque entree : badge type (`Recherche` bleu / `Analyse` vert / `Recherche + Analyse` violet), date locale FR-CA, compteur sources, requete (tronquee 500 char en base), apercu (500 char).
- Si vide : message « Aucune recherche dans l'historique. ».

> **Pas de bouton de suppression** ni d export depuis l UI. Pas de filtre par date / type / utilisateur.

### 2.5 Onglet « Liens utiles »

8 raccourcis statiques (definis dans `WebPage.tsx:37-94`) vers les organismes officiels du Quebec :

| Organisme                                       | URL                                                                                           |
|-------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Commission de la construction du Quebec (CCQ)   | https://www.ccq.org                                                                           |
| Regie du batiment du Quebec (RBQ)               | https://www.rbq.gouv.qc.ca                                                                    |
| CNESST                                          | https://www.cnesst.gouv.qc.ca                                                                 |
| Revenu Quebec                                   | https://www.revenuquebec.ca                                                                   |
| Code de construction du Quebec                  | https://www.rbq.gouv.qc.ca/lois-reglements-et-codes                                           |
| Registre des entreprises du Quebec (REQ)        | https://www.registreentreprises.gouv.qc.ca                                                    |
| Verificateur de licences RBQ                    | https://www.rbq.gouv.qc.ca/services-en-ligne/licence/registre-des-detenteurs-de-licence       |
| Plan Quebec                                     | https://www.quebec.ca/gouvernement/politiques-orientations/plan-quebecois-infrastructures     |

Liens ouverts dans un nouvel onglet (`target="_blank"`). Liste fixe — pas configurable via UI.

---

## 3. Workflows pas-a-pas

### 3.1 Effectuer une recherche web simple

1. Sidebar -> **Web** -> onglet **Recherche Web**.
2. Saisir la question (ex. « Nouvelles regles RBQ 2025 sur les permis residentiel »).
3. (Optionnel) Ajuster le slider **Max recherches** (1-10). Plus eleve = plus complet mais plus cher.
4. (Optionnel) Activer **Filtrage de domaines** : modes `Autoriser` (n autorise que les domaines listes) ou `Bloquer` (les exclut), mutuellement exclusifs.
5. Cliquer **Rechercher** -> `POST /web/search`.
6. Backend : verifie credits + AI guard, construit le tool `web_search_20260209` avec `user_location = Montreal/QC/CA`, appelle Claude Opus 4.7 en streaming (temperature 0.1), parse la reponse (texte + citations + compteurs), calcule cout, deduit credits, track usage (`feature='web_search'`), insere dans `web_search_history` (type `search`).
7. Resultat affiche : texte synthetique, sources cliquables, stats (tokens / cout / temps).

### 3.2 Analyser une page web ou un PDF

1. Onglet **Analyse de Page** -> coller l URL complete (ex. `https://www.cnesst.gouv.qc.ca/.../guide-EPI.pdf`).
2. (Optionnel) Ajuster **Tokens max** (10K-200K), decocher **Citations**, filtrer par domaines.
3. Cliquer **Analyser** -> `POST /web/fetch`.
4. Backend : valide URL (`http(s)://`), construit le tool `web_fetch_20250910` avec `citations.enabled` + `max_content_tokens`, envoie a Claude le prompt structure (Resume / Points cles / Contexte / Recommandations), track + deduit credits, history (type `fetch`).
5. Resultat : analyse en 4 sections, sources avec titre `Analyse detaillee` + URL.

### 3.3 Recherche + analyse combinee

1. Onglet **Recherche + Analyse** -> saisir une question type investigation (« Analyse detaillee des normes sismiques au Quebec en 2025 »).
2. Ajuster sliders : Max recherches (1-5, defaut 3) + Max analyses (1-5, defaut 2).
3. (Optionnel) Saisir des domaines autorises (uniquement mode `allow`, pas de `block`).
4. Cliquer **Rechercher et Analyser** -> `POST /web/search-fetch`.
5. Backend : construit 2 tools (`web_search` + `web_fetch` avec `max_content_tokens=50000` hard-code), envoie un prompt en 4 etapes (recherche -> identification -> fetch -> synthese), track + deduit credits, history (type `search_fetch`).
6. Resultat structure : Synthese / Points cles avec details / Sources citees.

> **Cout typique indicatif** : recherche simple (~3000 + 1500 tokens) ~= `0.21 USD`. Recherche+analyse complete (~8000 + 4000) ~= `0.55 USD`.

### 3.4 Consulter l historique

Onglet **Historique** -> chargement automatique au switch (50 plus recentes par defaut). Bouton **Rafraichir** pour recharger. **Pas de relance directe** : copier-coller la requete dans l onglet correspondant pour re-executer.

### 3.5 Filtrer par domaines specifiques

**Cas 1 — restreindre aux sources gouvernementales du Quebec** : Onglet Recherche Web -> mode **Autoriser** -> saisir `quebec.ca, gouv.qc.ca, ccq.org, rbq.gouv.qc.ca, cnesst.gouv.qc.ca`. Limite : 10 domaines max.

**Cas 2 — exclure des sources non fiables** : mode **Bloquer** -> saisir `quora.com, reddit.com, yahoo.answers`.

> **Limites** : modes `Autoriser` / `Bloquer` mutuellement exclusifs (`web.py:204-208` priorise `allowed`). Sur **Recherche + Analyse** : seul `allowed_domains` supporte (pas de `blocked`).

### 3.6 Acceder a un organisme via Liens utiles

Onglet **Liens utiles** -> cliquer sur la carte (CCQ, RBQ, CNESST, etc.) -> ouverture dans un nouvel onglet. Combinable avec **Analyse de Page** : copier une URL specifique du site puis l analyser.

### 3.7 Suivre les couts du module

Le module **n a pas son propre tableau de bord**. Aller sur Module 25 IA -> **Stats consommation** -> filtrer par feature : `web_search`, `web_fetch`, `web_search_fetch`.

---

## 4. Reference

### 4.1 Endpoints router Web (`/web`)

| Methode | URL                | Pydantic body / Query                                                          | Tracking feature       |
|---------|--------------------|--------------------------------------------------------------------------------|------------------------|
| POST    | `/web/search`      | `WebSearchRequest` : `query`, `max_uses=5`, `allowed_domains?`, `blocked_domains?` | `web_search`           |
| POST    | `/web/fetch`       | `WebFetchRequest` : `url`, `max_uses=5`, `allowed_domains?`, `blocked_domains?`, `enable_citations=true`, `max_content_tokens=100000` | `web_fetch` |
| POST    | `/web/search-fetch`| `WebSearchFetchRequest` : `query`, `max_search_uses=3`, `max_fetch_uses=2`, `allowed_domains?` | `web_search_fetch`  |
| GET     | `/web/history`     | Query `limit` (defaut 20, max 100)                                             | (lecture seule)        |

### 4.2 Format de reponse (POST endpoints)

```json
{
  "text": "Synthese ou analyse en texte structure.",
  "citations": [{"title": "...", "url": "https://..."}],
  "search_count": 3,
  "fetch_count": 1,
  "input_tokens": 4521,
  "output_tokens": 1834,
  "cost_usd": 0.2680,
  "elapsed_seconds": 18.42,
  "credit_balance": 9.7320
}
```

`/web/history` retourne `{"items": [{id, user_id, search_type, query, result_preview, citations_count, created_at}, ...]}`.

### 4.3 Tools Anthropic utilises

| Tool                    | Version           | Role                                              |
|-------------------------|-------------------|---------------------------------------------------|
| `web_search_20260209`   | Anthropic (server-side) | Recherche web temps reel + sources citees    |
| `web_fetch_20250910`    | Anthropic (server-side) | Recuperation contenu d une URL + analyse     |

> Ces tools sont **executes cote serveur Anthropic** (server tool use). Aucun appel HTTP direct du backend ERP vers un fournisseur de search.

### 4.4 Modele et couts

| Parametre              | Valeur (hard-code)          |
|------------------------|-----------------------------|
| `WEB_AI_MODEL`         | `claude-opus-4-7`           |
| `WEB_AI_MAX_TOKENS`    | `30000`                     |
| `temperature`          | `0.1` (precision)           |
| Pricing input          | `$0.015 / 1K tokens`        |
| Pricing output         | `$0.075 / 1K tokens`        |
| Markup interne         | `x1.30` (CAD/USD + marge)   |

**Formule cout** : `cost_usd = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30`

### 4.5 Limites et plafonds

| Limite                                    | Valeur            |
|-------------------------------------------|-------------------|
| `max_uses` web_search / web_fetch (single endpoint) | 10      |
| `max_search_uses` / `max_fetch_uses` (combine) | 5            |
| `max_content_tokens` (fetch)              | 200 000           |
| `max_content_tokens` (search-fetch)       | 50 000 (hard-code)|
| Domaines `allowed` / `blocked`            | 10 max chacun     |
| `max_tokens` reponse Claude               | 30 000            |
| Temperature                               | 0.1 (fixe)        |
| Limit historique (query param)            | 100 max           |
| Tronquage `query` / `result_preview` en base | 500 caracteres |

### 4.6 Validations et erreurs

| Cas                                       | HTTP | Message                                           |
|-------------------------------------------|------|---------------------------------------------------|
| `ANTHROPIC_API_KEY` absent / SDK manquant | 503  | `Service IA non disponible`                       |
| `query` vide                              | 400  | `La requete de recherche est vide`                |
| `url` vide                                | 400  | `L'URL est vide`                                  |
| URL ne commence pas par `http(s)://`      | 400  | `L'URL doit commencer par http:// ou https://`    |
| AI guard refuse (tenant suspendu)         | 403  | `Acces IA refuse`                                 |
| Solde IA <= 0 ET non exempt               | 402  | `Credits IA insuffisants`                         |
| Erreur Anthropic / Exception              | 500  | `Erreur lors de la recherche web` (variante)      |

### 4.7 Table PostgreSQL (schema tenant)

#### `web_search_history`

Creee dynamiquement (idempotent `CREATE TABLE IF NOT EXISTS`) au premier appel d un endpoint POST. **Pas de migration officielle**.

```sql
CREATE TABLE IF NOT EXISTS web_search_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    search_type VARCHAR(30) NOT NULL,  -- 'search' | 'fetch' | 'search_fetch'
    query TEXT NOT NULL,                -- tronque a 500 char a l insert
    result_preview TEXT,                -- tronque a 500 char a l insert
    citations_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> **Pas d index** sur `created_at` ni sur `user_id` -> performances correctes tant que la table reste petite (< 10K lignes).
> **Pas de FK** vers `users` (`user_id` est un INTEGER libre).
> **Pas de purge automatique** : prevoir un DELETE manuel par DBA si necessaire.

### 4.8 Flux d execution (sequence)

```
User -> WebPage.tsx (handleSearch / handleFetch / handleSearchFetch)
      -> useWebStore (set isSearching=true)
      -> webApi.webSearch / webFetch / webSearchFetch
      -> POST /web/{search,fetch,search-fetch}
      -> check_ai_guard(user) + _check_credits(user)
      -> anthropic.messages.stream(model=opus-4-7, tools=[...])  [server tool use]
      -> _parse_web_response(response)  [extraction texte + citations + compteurs]
      -> track_ai_usage + _deduct_credits + _save_search_history
      -> Return JSON {text, citations, ..., cost_usd, credit_balance}
```

---

## 5. Integrations & FAQ

### 5.1 Integration IA centrale (Module 12)

Le module **reutilise** les fonctions du Module 25 IA : `check_ai_guard`, `_check_credits`, `_deduct_credits`, `track_ai_usage` (insertion dans `ai_usage_tracking` du schema public). Les 3 features Web apparaissent dans les stats du Module 25 : `web_search`, `web_fetch`, `web_search_fetch`. Couts agreges visibles dans `GET /ai/usage` et `GET /ai/usage/monthly`.

### 5.2 Integration credits prepayes / Stripe

- Memes credits que tout l ERP (table `ai_prepaid_credits` schema public).
- **Auto-recharge Stripe** : si solde < `MIN_BALANCE_THRESHOLD = 0.10 USD`, declenche une charge `PREPAID_RECHARGE_AMOUNT = 10.00 USD`.
- **Tenants exemptes** (`{1, 105, 172}` codes en dur dans `ai.py:35`) : utilisation gratuite.

### 5.3 Multi-tenant et recherche interne

- Toutes les insertions dans `web_search_history` passent par `db.set_tenant(conn, user.schema)` -> `db.reset_tenant(conn)`. Cloisonnement par schema PostgreSQL.
- L API Anthropic ne voit pas le tenant_id (juste les prompts).
- **Recherche interne ERP NON integree** : pour chercher dans les donnees du tenant (projets, clients, factures), utiliser le Module 25 IA -> tool `recherche_bd`.

### 5.4 Export

**Aucun export** dedie : pas de PDF, pas de CSV de l historique, pas de markdown. Workaround : copier-coller depuis l UI ou impression du navigateur (Ctrl+P).

### 5.5 Comparaison fournisseurs search

| Fournisseur classique | Integre ? | Notes                                                              |
|-----------------------|-----------|--------------------------------------------------------------------|
| Google Custom Search  | NON       | Pas d API Google CSE configuree                                    |
| Bing Web Search       | NON       | Pas d API Bing                                                     |
| SerpAPI               | NON       | Pas de cle SerpAPI                                                 |
| Brave Search          | NON       | Pas de cle Brave                                                   |
| DuckDuckGo            | NON       | Pas d API DuckDuckGo                                               |
| **Anthropic web_search** | **OUI** | Seul fournisseur utilise (`web_search_20260209`)                  |

> **Pas de fallback** : si Anthropic est indisponible, HTTP 503 et il n y a pas de moteur alternatif.

### 5.6 FAQ

**Q : Quel moteur de recherche est utilise sous le capot ?**
R : Les outils web natifs Claude (`web_search_20260209` + `web_fetch_20250910`). Le moteur reel utilise par Anthropic n est pas expose publiquement. **Aucune integration directe** avec Google, Bing, SerpAPI, Brave, DuckDuckGo.

**Q : Pourquoi Opus et pas Sonnet ?**
R : Opus pour la qualite superieure de synthese sur recherches web. Cout 5x plus eleve que Sonnet.

**Q : Combien coute une recherche typique ?**
R : Recherche simple (~3000+1500 tokens) : `~0.21 USD`. Analyse de page longue (~6000+3000) : `~0.41 USD`. Recherche+analyse complete (~8000+4000) : `~0.55 USD`.

**Q : Puis-je utiliser un autre fournisseur (ex. SerpAPI) ?**
R : Pas dans la version actuelle. Le code est cable directement sur les tools Anthropic. Modification requise pour ajouter un fallback.

**Q : La geolocalisation Montreal/Quebec est-elle modifiable ?**
R : Pas via UI. Code en dur (`web.py:196-202`). Pour un tenant hors Quebec : modification de code requise.

**Q : Le module respecte-t-il robots.txt ?**
R : C est Anthropic qui gere le respect des conditions d acces. Le backend ERP ne fait pas de requete HTTP directe vers les sites tiers.

**Q : Que se passe-t-il si je depasse le `max_uses` configure ?**
R : Les valeurs au-dela des plafonds sont **silencieusement clampees** cote backend. Le slider UI est deja borne.

**Q : Le filtrage `allowed_domains` + `blocked_domains` peut-il etre combine ?**
R : NON. Mutuellement exclusifs (priorite a `allowed`). Sur **Recherche + Analyse** : seul `allowed_domains` supporte.

**Q : L historique peut-il etre filtre / cherche / supprime via UI ?**
R : NON. Consultable via Module 28 ou SQL direct. Suppression manuelle par DBA si necessaire.

**Q : Le streaming est-il visible cote frontend ?**
R : NON. Le backend utilise `messages.stream` mais le frontend attend la reponse complete (JSON one-shot). Le streaming backend est requis par Anthropic pour les operations tool-use longues (>10 min).

**Q : Y a-t-il un cache des resultats ?**
R : NON. Chaque appel re-execute la recherche. Pour eviter les couts redondants : consulter d abord l historique.

**Q : Les sources/citations retournees sont-elles fiables ?**
R : Les URLs proviennent de l API Anthropic. **Aucune validation** cote backend ERP. Valider visuellement avant de cliquer.

**Q : Recherches en anglais / autres langues ?**
R : OUI. Claude est multilingue. Le `user_location = Montreal/QC/CA` oriente francophone mais ne bloque pas.

**Q : Sauvegarder une recherche dans un dossier projet ?**
R : Pas de bouton dedie. Workaround : copier-coller dans une note de Module 8 (Dossiers).

**Q : Recherches automatiques (cron) ?**
R : NON. Tout est a la demande. Pas de scheduler.

**Q : Combien de temps une recherche prend-elle ?**
R : Recherche simple 5-15s, analyse de page 8-25s, recherche+analyse 30-60s. Champ `elapsed_seconds` dans la reponse.

**Q : Mes recherches sont-elles partagees avec Anthropic ?**
R : OUI. Anthropic offre un engagement contractuel : donnees **pas utilisees pour entrainement** sauf opt-in. Verifier conformite PIPEDA / Loi 25 si donnees personnelles.

---

## 6. Recap one-pager

- **Module focus** : recherche web + analyse de pages via les outils Claude (`web_search_20260209` + `web_fetch_20250910`).
- **Fournisseur unique** : API Anthropic. **PAS** de Google / Bing / SerpAPI / Brave / DuckDuckGo. **Aucun fallback** — HTTP 503 si Anthropic indisponible.
- **Modele** : `claude-opus-4-7` (premium, $0.015 in / $0.075 out / 1K tokens, markup x1.30).
- **5 onglets** : Recherche Web / Analyse de Page / Recherche + Analyse / Historique / Liens utiles.
- **4 endpoints** : `POST /web/search`, `POST /web/fetch`, `POST /web/search-fetch`, `GET /web/history`.
- **Geolocalisation fixe** : Montreal/Quebec/CA.
- **Filtrage domaines** : 3 modes (Aucun / Autoriser / Bloquer), max 10, mutuellement exclusifs. Endpoint `search-fetch` : seulement `allowed_domains`.
- **Plafonds** : `max_uses` 10 (single) ou 5 (combine), `max_content_tokens` 200K, reponse 30K tokens, temperature 0.1 fixe.
- **Credits IA** : memes que Module 25, deduction par appel (formule Opus), auto-recharge Stripe a $0.10.
- **3 features tracking** : `web_search`, `web_fetch`, `web_search_fetch` dans `ai_usage_tracking`.
- **Historique tenant-scope** : table `web_search_history` (auto-creee, pas de migration), 500 char max query/preview, pas de purge auto.
- **8 liens utiles** : CCQ, RBQ, CNESST, Revenu Quebec, Code de construction, REQ, Verificateur licences RBQ, Plan Quebec.
- **Pas de streaming UI**, pas de cache, pas d export, pas de recherche interne ERP (utiliser Module 25 -> `recherche_bd`), pas de scheduler.
- **Tenant isolation** : RLS via PostgreSQL schema + `set_tenant`/`reset_tenant`.

---

**Documentation generee a partir du code** : `web.py` (507 lignes), `WebPage.tsx` (706 lignes, 5 onglets), `web.ts` (79 lignes), `useWebStore.ts` (100 lignes).

**Manuels lies** :
- Module 25 (IA — credits prepayes + tracking) — `12-ia.md`
- Module 28 (Administration — gestion Stripe + tenants exemptes) — `14-administration.md`
- Module 8 (Dossiers — sauvegarde manuelle des resultats web) — `08-dossiers.md`
