# Module 02 — Analyses

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/analytics.py` (1423 lignes, 25 endpoints — prefix `/analytics`), `frontend/src/pages/AnalyticsPage.tsx` (1228 lignes, 5 onglets), `frontend/src/api/analytics.ts` (210 lignes, 26 fonctions client)
> **Tables PostgreSQL** : `factures`, `projects`, `employees`, `produits`, `opportunities`, `devis`, `time_entries`, `formulaires`, `formulaire_lignes`, `materials`, `companies`, `fournisseurs`, `bons_commande`
> **Cadrage** : tableau de bord BI **read-only cross-modules** organise en 5 onglets (Vue Globale / Projets / Finances / RH / Stock) avec graphiques Recharts. Il **ne fait pas** de previsions ML, **ne genere pas** d alertes push, **n est pas** temps reel (F5 manuel), **n exporte pas** en PDF/Excel, **n offre pas** de drill-down clic-vers-liste, et **n est pas** configurable en UI (KPIs codes en dur).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (5 onglets)](#2-interface-5-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference (endpoints, formules, modeles)](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission

Fournir une **vue analytique consolidee** des activites du tenant en agregeant les donnees de 9 modules operationnels :

- **15 KPIs core** (`GET /analytics/kpis`) : revenus, projets, employes, alertes stock, pipeline, devis, factures
- **6 graphiques temporels** (AreaChart 12 mois) : revenus mensuels, revenus vs depenses, evolution projets, tendance heures, creation projets, marge
- **3 graphiques distribution** (donut + BarChart) : factures par statut, BT par statut, repartition departements
- **5 tableaux details** : profitabilite projets, productivite employes, alertes stock, top clients, top fournisseurs
- **Comparaison mois courant vs precedent** (`GET /analytics/trends`) avec tendance %
- **Aging comptes clients** en 4 buckets (0-30 / 31-60 / 61-90 / 90+ jours)
- **Selecteur de periode** global (30 / 90 / 180 / 365 jours)

Source : `AnalyticsPage.tsx:213` (composant principal).

### 1.2 Ce que le module ne fait PAS

- **Drill-down** : cliquer sur un KPI / graphique n ouvre pas la liste filtree.
- **Export PDF / Excel / CSV** : aucun bouton. Workaround = screenshot ou copy-paste.
- **Personnalisation** : pas de drag-drop, pas de dashboard par utilisateur, pas de filtres custom.
- **Predictions ML** : agregations historiques uniquement.
- **Alertes push** : pas d email / SMS / notification quand un KPI franchit un seuil.
- **Cache backend** : chaque requete relit la base.
- **Polling automatique** : pas de WebSocket / SSE. F5 manuel pour rafraichir.
- **Filtres avances** : seul filtre = `period_days`.
- **Comparatif multi-periodes** : uniquement mois courant vs precedent (pas de Y/Y, pas de QTD).
- **Dashboards partages** / lien public / integration BI externe.
- **Roles differencies** : meme vue pour tous les utilisateurs du tenant.
- **KPIs custom** : ajout requiert modification de code (`analytics.py` + `analytics.ts` + `AnalyticsPage.tsx`).

Pour analyses au-dela : exporter via API directe (chaque endpoint retourne JSON) et traiter dans Power BI / Metabase / Excel.

### 1.3 Acces

- Sidebar -> **Analyses** (icone `BarChart3`) — `Sidebar.tsx:38`
- URL : **`/analyses`** — `App.tsx:167`
- Lazy-loaded (`App.tsx:55`)
- Onglet par defaut : **Vue Globale**

> Distinct du Module 01 Tableau de bord (`/dashboard`, router `dashboard.py`, 5 endpoints, 12 KPI statiques). Le module Analyses ici est plus riche (25 endpoints, 5 onglets, selecteur periode, charts Recharts).

### 1.4 Permissions

- Tous les utilisateurs **authentifies du tenant** voient la meme page.
- **Pas de roles** dedies (pas de differenciation directeur / comptable / RH).
- **Super-admin sans tenant** : la plupart des endpoints retournent `{"items": []}` (ex. `analytics.py:184` pour `/projects/profitability`). L endpoint `/kpis` retourne `{"error": "Contexte tenant manquant"}` (`analytics.py:73-74`) — comportement legerement different.
- **Multi-tenant strict** : chaque endpoint applique `db.set_tenant(conn, user.schema)` au debut et `db.reset_tenant(conn)` dans `finally`.
- **Defensive try/except** : si table absente (vieux tenant non migre), endpoint loggue et retourne `{"items": []}` au lieu de crasher.

---

## 2. Interface (5 onglets)

Source : `AnalyticsPage.tsx:53-59` — array `ANALYTICS_TABS`.

| # | Cle           | Label        | Icone        | Contenu principal                                             |
|---|---------------|--------------|--------------|---------------------------------------------------------------|
| 1 | `vue_globale` | Vue Globale  | `Eye`        | 8 KPI + 3 area charts + 2 donuts (factures / BT)              |
| 2 | `projets`     | Projets      | `BarChart3`  | 4 KPI + table profitabilite + barres progression + evolution  |
| 3 | `finances`    | Finances     | `DollarSign` | 4 KPI + revenus/depenses + aging + pipeline + top clients     |
| 4 | `rh`          | RH           | `Users`      | 4 KPI + tendance heures + departement + table productivite    |
| 5 | `stock`       | Stock        | `Boxes`      | 4 KPI + valeur par categorie + alertes + top fournisseurs     |

### 2.1 Header global

- Titre « Analyses » (`AnalyticsPage.tsx:347`)
- **Selecteur de periode** : 4 options — `30 jours` (defaut), `90 jours`, `6 mois` (180 j), `1 an` (365 j) — `AnalyticsPage.tsx:33-38`
- Tab bar scrollable horizontalement en mobile
- `SkeletonPage` pendant le premier chargement

> Le selecteur s applique a `getKpis(days)`, `getProjectProfitability(max(days,90))`, `getEmployeeProductivity(days)`, `getDepartmentDistribution(days)`. Les charts mensuels (revenus/depenses, monthly-revenue, hours-trend, project-evolution) restent **fixes a 12 mois** quel que soit le selecteur.

### 2.2 Onglet « Vue Globale »

**Row 1 — 4 KPI** : Revenus (vert, trend `revenusTrendPct`), Soumissions envoyees (bleu, subtitle `${devisAcceptes} acceptees`), Projets actifs (mauve), Employes actifs (sarcelle).

**Row 2 — 4 KPI** : Pipeline commercial (mauve), Alertes stock (rouge si > 0), Revenus encaisses (vert), Solde du (rouge si > 0).

**Charts** :
- **Revenus mensuels** : AreaChart degrade vert, `getMonthlyRevenue()` -> `/analytics/monthly-revenue`, 12 mois remplis avec zeros (`_fill_months()`).
- **Revenus vs Depenses** : dual AreaChart vert + rouge, `getRevenueExpenses(365)` -> `/analytics/finance/revenue-expenses`.
- **Evolution des projets** : stacked AreaChart 3 series (`enCours` bleu, `termines` vert, `enAttente` jaune), `getProjectEvolution(365)`.

**Donuts** :
- Distribution factures par statut (count + montant) — `/analytics/invoices-by-status`
- BT par statut (`type_formulaire = 'BON_TRAVAIL'`) — `/analytics/bt-by-status`

> Les donuts utilisent `STATUS_COLORS` (couleur fixe par statut metier) — `AnalyticsPage.tsx:41-49`.

### 2.3 Onglet « Projets »

**4 KPI** : Projets total, En cours, Termines, Budget total (somme `profitability.budget`).

**Profitabilite** (BarChart vertical + table top 20) — source `getProjectProfitability(max(days,90))` -> `/analytics/projects/profitability`.

Colonnes table : Projet (`nomProjet`), Statut (badge), Budget, Cout (`coutMainOeuvre + coutMateriaux`), Marge (vert si >=0, rouge sinon), % (badge vert >=20%, jaune 0-20%, rouge <0%).

> **Calcul cout main d oeuvre** : `SUM(time_entries.total_hours * COALESCE(employees.taux_horaire, employees.salaire, 0))` avec cast text bilateral `te.project_id::text = p.id::text` pour eviter operator does not exist crash (`analytics.py:196-208`).

> **Calcul cout materiaux** : `SUM(materials.quantite * materials.prix_unitaire)` — V1 (`analytics.py:202`). La V2 `/project-profitability` (`analytics.py:640`) utilise `formulaire_lignes` au lieu de `materials`.

**Progression des projets** : barres horizontales top 20 (excluant ANNULE/CANCELLED) ordonnes par `pourcentage_completion DESC`. Couleur : vert >=100%, bleu 50-100%, jaune <50%.

**Creation par mois + Repartition statut** : AreaChart 12 mois + donut calcule cote frontend (`En cours` / `Termines` / `En attente`).

### 2.4 Onglet « Finances »

**4 KPI** : Revenus encaisses (trend), Solde du (rouge si >0, subtitle nb factures), Taux conversion devis (`devisAcceptes/devisTotal*100`), Pipeline commercial.

**Revenus vs Depenses (full-width)** : AreaChart 3 series (revenus / depenses / marge mauve) sur 12 mois. Backend `analytics.py:478-514` :
- Revenus = `SUM(factures.montant_total)` par mois (excluant `ANNULEE`)
- Depenses = `SUM(time_entries.total_hours * employees.taux_horaire)` par mois (cout main d oeuvre uniquement)
- Marge = revenus - depenses

> **Limite** : depenses ici n incluent QUE la main d oeuvre. Pas les achats fournisseurs (`bons_commande`), pas les charges generales. Pour vue depenses complete : Module 7 Comptabilite.

**Aging factures** (BarChart 4 buckets) — `/analytics/factures-aging` :
- `0-30 jours` (vert), `31-60` (jaune), `61-90` (orange), `90+` (rouge)
- Source : `(CURRENT_DATE - date_facture)` group by tranche, filtre `statut NOT IN ('PAYEE','ANNULEE')` AND `solde_du > 0`

**Pipeline commercial** (BarChart vertical + table) — `getSalesPipeline()` -> `/analytics/sales-pipeline` (preferentielle) ou fallback `getCommercialPipeline()`. Etapes ordonnees `PROSPECTION` -> `QUALIFICATION` -> `PROPOSITION` -> `NEGOCIATION` -> `GAGNE` -> `PERDU` (ORDER BY CASE statut SQL — `analytics.py:805-814`).

**Top clients (par CA)** : BarChart horizontal + table top 10. Source `getTopClients(365)` -> `/analytics/top-clients`. **CA = SUM(`projects.budget_total`)**, pas factures.

> Pour CA factures effectif : alternative `/analytics/top-clients-revenue` (non integre dans la page mais accessible via API).

### 2.5 Onglet « RH »

**4 KPI** : Employes actifs, Heures totales (somme frontend), Heures/jour moyen, Departements.

**Tendance heures travaillees (12 mois)** : dual AreaChart 2 axes Y (heures gauche, employes droit). Source `getHoursTrend(365)` -> `/analytics/hours-trend`. Agregation mensuelle depuis `time_entries` : `SUM(total_hours)`, `COUNT(DISTINCT employee_id)`, `COUNT(*)` (pointages).

**Repartition par departement** (donut) + **Heures par employe** (BarChart horizontal top 8).

> Le backend appelle `_ensure_departement_columns(cursor, schema)` (`analytics.py:24-40`) — `ALTER TABLE ADD COLUMN IF NOT EXISTS departement TEXT` sur `employees` + `formulaires` pour les vieux tenants. Memoization via `_departement_cols_ensured: set[str]`.

**Productivite detaillee** (table 7 colonnes) — `getEmployeeProductivity(days)` -> `/analytics/hr/productivity` :

| Colonne | Source                                                    |
|---------|-----------------------------------------------------------|
| Employe | `e.prenom || ' ' || e.nom`                                |
| Poste   | `e.poste`                                                 |
| Dept.   | `e.departement` (`Non assigne` si NULL)                   |
| Jours   | `COUNT(DISTINCT te.punch_in::DATE)`                       |
| Heures  | `SUM(te.total_hours)`                                     |
| h/jour  | `heuresTotales / joursTravailles` (vert >=7.5h, ambre >=6h, rouge sinon) |
| Projets | `COUNT(DISTINCT te.project_id)`                           |

Filtre : `statut = 'ACTIF'` AND `punch_in >= NOW() - period_days` AND `SUM(total_hours) > 0`. Limit 20.

### 2.6 Onglet « Stock »

**4 KPI** (source `/analytics/stock-summary`) : Produits actifs (subtitle `${total}`), Alertes stock (rouge si >0), Valeur totale, Categories.

**Valeur par categorie** (BarChart + Donut cote-a-cote) — `/analytics/stock-value`. Group by `COALESCE(NULLIF(categorie,''), 'Non categorise')`. Filtre `active = TRUE`.

**Alertes stock** (table) — `/analytics/inventory/alerts` :

| Colonne   | Source                                                     |
|-----------|------------------------------------------------------------|
| Produit   | `nom`                                                      |
| Categorie | `categorie`                                                |
| Stock     | `stockActuel` + `unite`                                    |
| Seuil     | `seuilAlerte` = `stock_minimum`                            |
| Niveau    | barre + badge `tauxStock %`                                |

`tauxStock = (stock_actuel / seuil_alerte) * 100`. Couleur : rouge <25%, jaune 25-50%, vert >=50%. Limit 20, tri `(stock_disponible / NULLIF(stock_minimum,0)) ASC`.

**Top fournisseurs** (BarChart horizontal + table) — `/analytics/top-suppliers` (limit 10). Source SQL : `fournisseurs LEFT JOIN bons_commande GROUP BY ORDER BY SUM(montant_total) DESC`.

---

## 3. Workflows pas-a-pas

### 3.1 Consulter la vue d ensemble

1. Sidebar -> **Analyses** -> URL `/analyses`.
2. La page lance `fetchData()` -> 9 requetes paralleles (`Promise.all` `AnalyticsPage.tsx:250-261`) + `fetchTabData('vue_globale')` (4 requetes additionnelles).
3. Lire les **8 KPI** en haut. Identifier le `trend %` sur Revenus (fleche verte si >0, rouge si <0).
4. Examiner les 3 area charts (revenus mensuels, revenus vs depenses, evolution projets).
5. Lire les 2 donuts (factures par statut, BT par statut).

> Pas de drill-down : cliquer sur un KPI ne navigue pas. Workaround : noter le count puis aller manuellement dans le module concerne.

### 3.2 Changer la periode d analyse

1. Selecteur en haut a droite : `30 jours` / `90 jours` / `6 mois` / `1 an`.
2. Le changement declenche `fetchData()` (KPIs + endpoints periodiques).
3. Les charts mensuels (12 mois fixes) ne reagissent PAS au selecteur.
4. La table profitabilite utilise `Math.max(days, 90)` -> minimum 90 jours.

### 3.3 Analyser la profitabilite des projets

1. Onglet **Projets**.
2. Tableau Rentabilite top 20 ordonnes par budget DESC.
3. Pour chaque ligne : verifier badge % (vert >=20%, jaune 0-20%, rouge <0%).
4. Identifier projets en deficit (marge negative en rouge).
5. Lire footer total : marge globale + ratio %.
6. Pour drill-down : Module 1 Projets -> ouvrir le projet.

> **Limite calcul** : seuls `time_entries` (main d oeuvre) et `materials` (materiaux directs) sont comptes. Bons de commande achats et factures fournisseurs PAS inclus.

### 3.4 Suivre la progression des projets

1. Onglet **Projets** -> bloc Progression.
2. Top 20 projets par `pourcentage_completion DESC` (excluant ANNULE).
3. Couleur barre : vert >=100%, bleu 50-100%, jaune <50%.
4. Identifier rapidement projets en retard ou stagnants.
5. Pour mise a jour : Module 1 Projets -> editer `pourcentage_completion`.

### 3.5 Comparer revenus vs depenses (12 mois)

1. Onglet **Vue Globale** ou **Finances**.
2. Lire AreaChart Revenus vs Depenses (vert + rouge superposes).
3. Identifier mois ou depenses > revenus.
4. En onglet Finances : ajout serie Marge mauve.
5. Pour analyse fine : `GET /analytics/finance/revenue-expenses?periodDays=365` puis Excel.

### 3.6 Surveiller le pipeline commercial

1. Onglet **Finances** -> bloc Pipeline.
2. BarChart vertical par etape (PROSPECTION -> ... -> GAGNE / PERDU).
3. Tableau associe : count + montant par etape + total.
4. Identifier etapes goulot (ex. trop d opportunites bloquees en PROPOSITION).
5. Pour drill-down : Module 3 CRM -> Opportunites -> filtrer par statut.

### 3.7 Detecter factures en retard

1. Onglet **Finances** -> bloc Vieillissement.
2. Lire BarChart 4 buckets (couleurs progressives vert -> rouge).
3. Valeur `90+ jours` rouge = risque creance irrecouvrable.
4. Detail : Module 7 Comptabilite -> filtre `statut='EN_RETARD'`.

### 3.8 Identifier les top clients

1. Onglet **Finances** -> bloc Top clients.
2. Top 10 par CA total des **budgets projets** (pas factures).
3. Strategie : Top 3 -> choyer ; 4-10 -> cross-sell ; hors top 10 -> reactiver.
4. Pour CA factures effectif : endpoint `/analytics/top-clients-revenue` via API.

### 3.9 Analyser la productivite RH

1. Onglet **RH**.
2. AreaChart Tendance heures (12 mois) : voir saisonnalite.
3. Donut Repartition par departement : charge par dept.
4. Tableau Productivite detaillee :
   - Identifier h/jour > 7.5h (vert) — productifs.
   - Reperer h/jour < 6h (rouge) — sous-utilisation, conges, mi-temps.
   - Cross-check `nbProjets`.
5. Footer : moyenne globale h/jour + total.

> Formule : `heures_par_jour = heures_totales / jours_travailles`. `jours_travailles = COUNT(DISTINCT punch_in::DATE)` -> jours sans pointage NON comptes.

### 3.10 Optimiser les niveaux de stock

1. Onglet **Stock**.
2. KPI Alertes stock > 0 -> produits sous le seuil.
3. Tableau Alertes stock : top 20 ordonnes par criticite (`stock/seuil` ASC).
4. Lire barre `tauxStock %` :
   - Rouge < 25% : critique, reapprovisionner immediatement.
   - Jaune 25-50% : attention, planifier achat.
   - Vert >= 50% : OK.
5. Croiser avec Top fournisseurs.
6. Action : Module 6 BC -> nouveau bon de commande.

### 3.11 Detecter une variation de revenus

1. KPI Revenus affiche `+X.X% vs mois prec.` (depuis `getTrends()`).
2. Calcul : `((current - previous) / previous) * 100`.
3. Si tendance < 0 (rouge), enquete : pipeline diminue ? factures en retard de saisie ? saisonnalite ?
4. Pour analyse historique : AreaChart Revenus mensuels (12 mois).

### 3.12 Exporter pour analyse externe

> Pas d export integre. Workarounds :

1. **Screenshot** d un graphique ou tableau.
2. **Copy-paste** tableau HTML vers Excel / Google Sheets.
3. **API directe** (power users) :
   - Recuperer token auth via DevTools.
   - `curl https://erp.constructo-ai.ca/api/analytics/projects/profitability?periodDays=365 -H "Authorization: Bearer <token>"`.
   - Traiter le JSON (cle `items`).
4. **BI externe** : Power BI / Metabase peuvent connecter PostgreSQL en read-only.

---

## 4. Reference

### 4.1 Liste exhaustive des 25 endpoints

Source : `analytics.py` (lignes 67 a 1382). Tous en GET sous prefix `/analytics`.

| # | URL                                  | Ligne | Periode (defaut)        | Limit       | Role                                                |
|---|--------------------------------------|-------|-------------------------|-------------|-----------------------------------------------------|
| 1 | `/kpis`                              | 67    | 30 j (1-365)            | n/a         | 15 KPIs core agreges                                |
| 2 | `/projects/profitability`            | 177   | 90 j (1-730)            | 20 (1-50)   | Budget vs couts par projet (V1, table `materials`) |
| 3 | `/projects/evolution`                | 246   | 365 j (30-730)          | n/a         | Distribution mensuelle statuts projets             |
| 4 | `/commercial/pipeline`               | 293   | n/a (statut != PERDU)   | n/a         | Funnel opportunites (4 metriques par etape)        |
| 5 | `/hr/productivity`                   | 346   | 30 j (1-365)            | 20 (1-50)   | Productivite par employe (8 metriques)             |
| 6 | `/hr/departments`                    | 410   | 30 j (1-365)            | n/a         | Heures par departement                             |
| 7 | `/finance/revenue-expenses`          | 462   | 365 j (30-730)          | n/a         | Revenus vs depenses + marge mensuelle              |
| 8 | `/inventory/alerts`                  | 532   | n/a                     | 20          | Top 20 produits low-stock avec `taux_stock`        |
| 9 | `/top-clients`                       | 582   | 365 j (30-730)          | 15 (1-50)   | Top clients par CA budgets projets                 |
| 10| `/project-profitability`             | 640   | n/a                     | 20          | V2 — `formulaire_lignes` au lieu de `materials`    |
| 11| `/workstation-load`                  | 703   | n/a                     | n/a         | BT en cours par departement                        |
| 12| `/project-progress`                  | 744   | n/a                     | 20          | Top projets par `pourcentage_completion`           |
| 13| `/sales-pipeline`                    | 789   | n/a (tous statuts)      | n/a         | Distribution opportunites (count + montant)        |
| 14| `/top-clients-revenue`               | 839   | n/a                     | 10          | Top clients par CA factures (pas budgets)          |
| 15| `/employee-productivity`             | 886   | n/a                     | 20          | V2 simplifiee employees + heures + nb projets      |
| 16| `/stock-alerts`                      | 936   | n/a                     | n/a         | V2 stock alerts avec `code_produit`                |
| 17| `/top-suppliers`                     | 981   | n/a                     | 10          | Top fournisseurs par achats (`bons_commande`)      |
| 18| `/monthly-revenue`                   | 1026  | 12 mois fixe            | n/a         | Revenus mensuels (rempli avec zeros)               |
| 19| `/stock-value`                       | 1065  | n/a                     | n/a         | Valeur stock par categorie                         |
| 20| `/trends`                            | 1110  | mois courant vs prec.   | n/a         | Comparaison % revenus + devis                      |
| 21| `/invoices-by-status`                | 1196  | n/a                     | n/a         | Donut factures (count + montant)                   |
| 22| `/bt-by-status`                      | 1239  | n/a                     | n/a         | Donut BT (`type_formulaire = 'BON_TRAVAIL'`)       |
| 23| `/hours-trend`                       | 1281  | 365 j (30-730)          | n/a         | Heures mensuelles + nb employes + nb pointages    |
| 24| `/factures-aging`                    | 1331  | n/a                     | n/a         | Aging 4 buckets (0-30/31-60/61-90/90+)             |
| 25| `/stock-summary`                     | 1382  | n/a                     | n/a         | 5 KPIs stock (totalProduits, actifs, categories, valeur, alertes) |

### 4.2 Modele AnalyticsKpis (15 champs)

Source : `analytics.ts:7-23`.

| Champ                  | Source SQL (resume)                                                                |
|------------------------|------------------------------------------------------------------------------------|
| `revenusTotal`         | `SUM(factures.montant_total) WHERE statut != 'ANNULEE' AND date_facture >= NOW() - period_days` |
| `projetsActifs`        | `COUNT(projects WHERE statut IN ('EN COURS','EN_COURS','EN ATTENTE','EN_ATTENTE'))` |
| `projetsTermines`      | `COUNT(projects WHERE statut IN ('TERMINE','TERMINÉ','COMPLETED'))`                |
| `projetsTotal`         | `COUNT(projects)`                                                                  |
| `employesActifs`       | `COUNT(employees WHERE UPPER(statut) = 'ACTIF')`                                   |
| `alertesStock`         | `COUNT(produits WHERE active=TRUE AND stock_disponible <= stock_minimum AND stock_minimum > 0)` |
| `opportunitesPipeline` | `COUNT(opportunities WHERE statut IN ('PROSPECTION','QUALIFICATION','PROPOSITION','NEGOCIATION'))` |
| `valeurPipeline`       | `SUM(opportunities.montant_estime)` (memes statuts)                               |
| `devisTotal`           | `COUNT(devis WHERE date_creation >= NOW() - period_days)`                          |
| `devisAcceptes`        | `COUNT(devis WHERE statut IN ('ACCEPTE','ACCEPTÉE','ACCEPTED'))`                   |
| `devisEnvoyes`         | `COUNT(devis WHERE statut IN ('ENVOYE','ENVOYÉ','ENVOYEE','SENT'))`                |
| `devisValeurTotale`    | `SUM(CAST(devis.investissement_total AS REAL))`                                    |
| `facturesTotal`        | `COUNT(factures)`                                                                  |
| `facturesSoldeDu`      | `SUM(factures.solde_du WHERE statut NOT IN ('PAYEE','PAYÉE','ANNULEE','ANNULÉE'))` |
| `revenusEncaisses`     | `SUM(factures.montant_total WHERE statut IN ('PAYEE','PAYÉE'))`                    |

> Matching statuts **case-insensitive** via `UPPER(statut)`, accepte variantes FR/EN avec/sans accents.

### 4.3 Modeles secondaires

```
ProjectProfitability  : { id, nomProjet, statut, budget, coutMainOeuvre, coutMateriaux, coutTotal, marge, margePct }
EmployeeProductivity  : { id, employe, poste, departement, joursTravailles, heuresTotales, heuresMoyennes, heuresParJour, nbProjets }
RevenueExpense        : { mois, revenus, depenses, marge, margePct }
StockAlert            : { id, nom, categorie, stockActuel, seuilAlerte, unite, tauxStock }
TopClient             : { id, client, typeEntreprise, nbProjets, caTotal, caMoyen, dernierProjet }
FacturesAging         : { tranche, count, solde }
StockSummary          : { totalProduits, produitsActifs, categories, valeurTotale, alertes }
HoursTrend            : { mois, heures, employes, pointages }
PipelineItem          : { statut, nombre, valeurTotale, valeurMoyenne, probaMoyenne }
StatusDistribution    : { statut, count, montant? }
DepartmentDistribution: { departement, nbEmployes, heuresTotales }
ProjectEvolution      : { mois, enAttente, enCours, termines, total }
```

### 4.4 Validations Pydantic

| Endpoint                      | period_days | limit       |
|-------------------------------|-------------|-------------|
| `/kpis`                       | 1 - 365     | n/a         |
| `/projects/profitability`     | 1 - 730     | 1 - 50      |
| `/projects/evolution`         | 30 - 730    | n/a         |
| `/hr/productivity`            | 1 - 365     | 1 - 50      |
| `/hr/departments`             | 1 - 365     | n/a         |
| `/finance/revenue-expenses`   | 30 - 730    | n/a         |
| `/top-clients`                | 30 - 730    | 1 - 50      |
| `/hours-trend`                | 30 - 730    | n/a         |

> En dehors de ces bornes : HTTP 422.

### 4.5 Calculs cles

| KPI / metric           | Formule                                                                              |
|------------------------|--------------------------------------------------------------------------------------|
| Revenus periode        | `SUM(factures.montant_total) WHERE statut != 'ANNULEE' AND date_facture >= NOW() - days` |
| Solde du               | `SUM(factures.solde_du) WHERE statut NOT IN ('PAYEE','ANNULEE')`                     |
| Revenus encaisses      | `SUM(factures.montant_total) WHERE statut = 'PAYEE'`                                 |
| Cout main d oeuvre     | `SUM(time_entries.total_hours * COALESCE(employees.taux_horaire, salaire, 0))`       |
| Cout materiaux V1      | `SUM(materials.quantite * materials.prix_unitaire)`                                  |
| Cout materiaux V2      | `SUM(formulaire_lignes.montant_ligne)` joint sur formulaires.project_id              |
| Marge projet           | `budget - (cout_main_oeuvre + cout_materiaux)`                                       |
| Marge %                | `(marge / budget) * 100` si budget > 0, sinon 0                                      |
| Productivite employe   | `heures_totales / jours_travailles`                                                  |
| Valeur stock           | `SUM(stock_disponible * COALESCE(cout_revient, prix_unitaire, 0)) WHERE active=TRUE` |
| Taux stock %           | `(stock_disponible / stock_minimum) * 100`                                           |
| Aging                  | `CURRENT_DATE - date_facture` group en buckets 0-30 / 31-60 / 61-90 / 90+            |
| Trend revenus %        | `((current_month - previous_month) / previous_month) * 100`                          |
| Pipeline value         | `SUM(opportunities.montant_estime) WHERE statut NOT IN ('PERDU','GAGNE')`            |

### 4.6 Library graphiques (Recharts)

Imports `AnalyticsPage.tsx:14-18`.

- `AreaChart` + `Area` (degrades `linearGradient`)
- `BarChart` + `Bar` (vertical et horizontal)
- `PieChart` + `Pie` + `Cell` (donut)
- `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`

### 4.7 Palette de couleurs

`AnalyticsPage.tsx:40` :

```
COLORS = ['#7BAFD4', '#7DC4A5', '#F6C87A', '#E8919A', '#B09BD8',
          '#D4A0B0', '#7DC4B5', '#F0B07A']
```

`STATUS_COLORS` (couleur fixe par statut metier — `AnalyticsPage.tsx:41-49`) :

| Statut(s)                                                          | Couleur          |
|--------------------------------------------------------------------|------------------|
| `PAYEE`, `TERMINE`, `COMPLETE`, `GAGNE`                            | vert `#7DC4A5`   |
| `EN_COURS`, `En cours`                                              | bleu `#7BAFD4`   |
| `EN_ATTENTE`, `En attente`, `EN_PAUSE`, `QUALIFICATION`, `PARTIELLE` | jaune/ambre     |
| `ENVOYEE`, `BROUILLON`, `PLANIFIE`                                  | bleu pale / gris |
| `ANNULEE`, `ANNULE`                                                 | gris `#B8C4CE`   |
| `PROSPECTION`                                                       | bleu pale        |
| `PROPOSITION`                                                       | mauve `#B09BD8`  |
| `NEGOCIATION`                                                       | orange `#F0B07A` |
| `PERDU`, `EN_RETARD`                                                | rouge `#E8919A`  |

### 4.8 Mecanismes defensifs (backend)

| Mecanisme                          | Implementation                                                            |
|------------------------------------|---------------------------------------------------------------------------|
| `_ensure_departement_columns()`    | `ALTER TABLE ADD COLUMN IF NOT EXISTS departement TEXT` sur `employees` + `formulaires` (`analytics.py:24-40`) |
| Memoization schema                 | `_departement_cols_ensured: set[str]` (module-level)                      |
| `_fill_months()`                   | Rempli mois manquants avec zeros pour timeline continue (`analytics.py:43-64`) |
| `CAST(x AS REAL)`                  | Sur `budget_total`, `investissement_total`                                |
| Cast text bilateral                | `te.project_id::text = p.id::text` (compat INT vs TEXT)                   |
| `try / except` defensif            | Catch `Exception` -> retourne `{"items": []}` ou zeros                    |
| Multi-tenant strict                | `db.set_tenant()` debut + `db.reset_tenant()` `finally`                   |
| Garde super-admin                  | `if not user.schema: return ...` debut chaque endpoint                    |

---

## 5. Integrations & FAQ

### 5.1 Modules sources consommes

Le module Analyses agrege les donnees de **9 modules operationnels** :

| Source              | Tables                                  | KPIs / charts                                     |
|---------------------|------------------------------------------|---------------------------------------------------|
| Module 1 Projets    | `projects`, `materials`                  | Profitabilite, evolution, progression, top clients budget |
| Module 3 CRM        | `companies`, `opportunities`             | Pipeline, top clients (CA factures)               |
| Module 4 Devis      | `devis`                                  | KPIs devis, taux conversion                       |
| Module 5 BT         | `formulaires`, `formulaire_lignes`       | BT par statut, workstation load, cout materiaux V2 |
| Module 6 BC         | `bons_commande`, `fournisseurs`          | Top fournisseurs                                  |
| Module 7 Factures   | `factures`                               | Revenus, solde du, aging, distribution            |
| Module 9 Employes   | `employees`, `time_entries`              | Productivite, departements, hours-trend, cout main d oeuvre |
| Module 10 Inventaire | `produits`                              | Alertes stock, valeur, summary, value categorie   |
| Module 19 Immobilier | (non consomme)                          | --- (a son propre dashboard immobilier separe)    |
| Module 25 IA        | (non consomme)                            | --- (stats dans `/ai/usage` separes)             |

### 5.2 Difference avec Module 01 Tableau de bord

| Aspect              | Module 01 Tableau de bord       | Module 02 Analyses                |
|---------------------|---------------------------------|-----------------------------------|
| URL                 | `/dashboard`                    | `/analyses`                       |
| Router backend      | `dashboard.py` (5 endpoints)    | `analytics.py` (25 endpoints)     |
| Onglets             | 0 (page statique)               | 5                                 |
| Selecteur periode   | NON                             | OUI (30/90/180/365)               |
| KPIs                | 12 cartes operationnelles       | 8 vue globale + autres repartis   |
| Alertes D365-style  | OUI (bandeau haut)              | NON                               |
| Charts              | Statique                        | 12+ Recharts riches               |

> Conseil : `/dashboard` pour vue **quotidienne operationnelle**, `/analyses` pour **analyse periodique approfondie**.

### 5.3 Performance et architecture

- **Aggregation 100% SQL** : `SUM`, `COUNT`, `GROUP BY`, `date_trunc`, `make_interval`. Aucune logique Python iterative.
- **Pas de cache** : pas de Redis, pas de materialized view. Chaque appel relit la base.
- **Connection pooling** : `db.get_conn()` + `conn.close()` `finally`. Connexions courtes.
- **Frontend** : React lazy loading, `Promise.all([...])` paralleles, `useIsMobile()` responsive.
- **Performance** : OK pour < 10k records par module. Au-dela : envisager materialized views.

### 5.4 Pas de polling automatique

- Frontend charge a l ouverture du composant (`useEffect` `AnalyticsPage.tsx:328`).
- Recharge declenchee uniquement sur changement de `period` ou d `activeTab`.
- Pas de WebSocket / SSE / setInterval -> F5 manuel pour rafraichir.

### 5.5 FAQ

**Q : Pourquoi `revenusTotal` (Vue Globale) differe-t-il de mes revenus dans Module 7 Comptabilite ?**
R : `revenusTotal` est filtre sur la **periode** selectionnee (defaut 30 j) ET exclut `ANNULEE`. Module 7 affiche probablement le cumul total. Pour comparer, regler selecteur sur `1 an` et exclure ANNULEE cote Module 7.

**Q : La courbe revenus mensuels reagit-elle au selecteur ?**
R : NON. Charts mensuels fixes a 12 mois (`getMonthlyRevenue()`, `getRevenueExpenses(365)`, `getHoursTrend(365)`, `getProjectEvolution(365)`). Seuls KPIs et certains tableaux (`profitability`, `productivity`, `departments`) reagissent.

**Q : Comment sont calculees les depenses dans le chart Revenus vs Depenses ?**
R : `SUM(time_entries.total_hours * COALESCE(employees.taux_horaire, salaire, 0))` par mois (`analytics.py:490-498`). **Limite** : main d oeuvre interne uniquement. Achats fournisseurs, sous-traitants, frais generaux NON inclus. Pour vue depenses complete : Module 7.

**Q : Pourquoi un projet apparait avec marge negative — comment corriger ?**
R : `cout_main_oeuvre + cout_materiaux > budget_total`. Causes : budget sous-estime, avenants non integres, sur-pointage time_entries, materiaux non factures au client. Action : Module 1 -> ouvrir le projet, comparer pointages reels et budget, ajuster ou facturer avenants.

**Q : Le module fait-il du forecast ?**
R : NON. Aucune projection. Donnees historiques uniquement. Pour forecast : exporter API + outil externe (Excel forecast, Power BI).

**Q : Comment ajouter un KPI custom ?**
R : Pas configurable en UI. Modification code requise : `analytics.py` (endpoint) + `analytics.ts` (typage + fonction) + `AnalyticsPage.tsx` (state + carte).

**Q : Les calculs sont-ils en temps reel ?**
R : OUI. Pas de cache. Chaque appel relit la base. Reflete l etat exact a la milliseconde de la requete.

**Q : Le top clients utilise-t-il budgets projets ou factures ?**
R : Bloc visible (`/top-clients`) utilise **budgets projets** (`SUM(projects.budget_total)`). Pour CA factures effectif : endpoint alternatif `/top-clients-revenue` (`SUM(factures.montant_total)`) accessible via API mais non integre dans la page.

**Q : Pourquoi les statuts factures matchent en `UPPER()` avec accents ?**
R : SQL accepte `'PAYEE'` ET `'PAYÉE'` ET `'ANNULEE'` ET `'ANNULÉE'` ET `'ANNULE'` (vieux tenants peuvent avoir donnees mixtes FR/sans accent/EN). Le `UPPER(statut)` permet match case-insensitive.

**Q : Comment interpreter `tauxStock %` dans alertes ?**
R : `(stock_disponible / stock_minimum) * 100`. Ex : 10 unites avec seuil 50 -> 20% (rouge critique) ; 25 avec seuil 50 -> 50% (jaune) ; 60 avec seuil 50 -> 120% (ne devrait pas apparaitre, l endpoint filtre `stock_disponible <= stock_minimum`).

**Q : Comment sont calcules les jours travailles d un employe ?**
R : `COUNT(DISTINCT te.punch_in::DATE)` — jours **uniques** avec au moins un pointage. Conges/RTT/weekends non pointes NON comptes. Donc h/jour = moyenne sur jours actifs uniquement.

**Q : Pourquoi 2 endpoints similaires `/projects/profitability` et `/project-profitability` ?**
R : Versions historiques. **V1** (`analytics.py:177`) : table `materials`, accepte `period_days` + `limit`. **V2** (`analytics.py:640`) : `formulaire_lignes` (BT), sans periode, LIMIT 20 fixe. Les deux coexistent pour compatibilite. La page utilise V1.

**Q : Pourquoi le tableau Workstation load n est pas affiche dans Projets ?**
R : Endpoint `/workstation-load` existe (`analytics.py:703-741`) mais NON appele dans la version actuelle de `AnalyticsPage.tsx`. Disponible pour usage futur ou via API directe.

**Q : Comment exporter tout l onglet en JSON unique ?**
R : NON. Chaque onglet appelle plusieurs endpoints separement. Pour export complet : appeler chaque endpoint individuellement (cf. section 4.1).

**Q : Y a-t-il un endpoint de health check / smoke test ?**
R : Non specifique a Analyses. Test pratique : appeler `/analytics/kpis` — retourne JSON ou data vide pour super-admin sans tenant. Confirme connection DB + multi-tenant operationnels.

**Q : Que se passe-t-il si une table requise n existe pas (vieux tenant) ?**
R : `try/except` defensif catch l erreur, log via `logger.error(...)`, retourne `{"items": []}` ou zeros. La page reste fonctionnelle, l onglet montre EmptyState. Resolution : appliquer migrations DB du tenant.

**Q : Comment auditer un calcul si je conteste un KPI ?**
R : 
1. DevTools -> Network -> filtre `analytics` -> voir reponse JSON brute.
2. Lire `analytics.py` (chaque endpoint contient son SQL embed).
3. Executer SQL directement (psql / pgAdmin) pour verifier.
4. Si discordance : ouvrir ticket avec valeurs attendues vs obtenues.

---

## 6. Recap one-pager

- **Module BI cross-modules read-only** consolidant 9 modules operationnels (different du Module 01 Tableau de bord operationnel quotidien).
- **5 onglets** : Vue Globale / Projets / Finances / RH / Stock.
- **25 endpoints backend** sous prefix `/analytics` (`analytics.py` 1423 lignes).
- **26 fonctions client** (`analytics.ts` 210 lignes).
- **Selecteur de periode** : 30 j (defaut) / 90 j / 6 mois / 1 an. Charts mensuels fixes 12 mois (ne reagissent pas au selecteur).
- **Library graphiques** : Recharts (AreaChart degrades, BarChart, PieChart donut).
- **15 KPIs core** : revenus, projets actifs/termines/total, employes actifs, alertes stock, pipeline (count + valeur), devis (4), factures (3).
- **Trends mois courant vs precedent** : revenus + devis avec %.
- **Aging factures** : 4 buckets 0-30 / 31-60 / 61-90 / 90+ jours.
- **Pipeline 6 etapes** : PROSPECTION -> QUALIFICATION -> PROPOSITION -> NEGOCIATION -> GAGNE / PERDU.
- **Profitabilite projets** : `budget - (cout_main_oeuvre + cout_materiaux)` + marge %. Cout main d oeuvre = `SUM(time_entries.total_hours * employees.taux_horaire)`. Cout materiaux V1 = `materials`, V2 = `formulaire_lignes`.
- **Productivite RH** : 8 metriques par employe. h/jour calcule sur jours actifs (avec pointage) uniquement.
- **Stock** : alertes avec taux %, valeur par categorie, summary 5 KPIs, top fournisseurs.
- **Aggregation 100% SQL** (pas de Python iteratif), defensive try/except, multi-tenant strict, memoization `_departement_cols_ensured`, time-filling `_fill_months()`.
- **Pas de cache backend** (Redis/materialized view) : chaque requete relit la base.
- **Pas de polling auto** : F5 manuel ou changer onglet/periode.
- **Pas de drill-down** : clic KPI ne navigue pas.
- **Pas d export PDF/CSV/Excel** integre : screenshot ou API directe.
- **Pas de personalisation** : layout fixe, KPIs codes en dur.
- **Pas de roles differencies** : meme vue pour tous.
- **Pas de forecast/ML** : agregations historiques uniquement.
- **Pas d alertes push** sur seuils.
- **Acces** : sidebar « Analyses » (BarChart3), URL `/analyses`, lazy-loaded.

---

**Documentation generee a partir du code** : `analytics.py` (1423 lignes, 25 endpoints), `AnalyticsPage.tsx` (1228 lignes, 5 onglets), `analytics.ts` (210 lignes, 26 fonctions).

**Manuels lies** :
- Module 01 (Tableau de bord — vue operationnelle complementaire) — `13-tableau-de-bord.md`
- Module 1 (Projets — source profitabilite) — `01-projets.md`
- Module 3 (CRM — source pipeline) — `03-crm.md`
- Module 4 (Devis — source taux conversion) — `04-devis.md`
- Module 7 (Factures — source revenus, aging) — `07-factures.md`
- Module 9 (Employes — source productivite RH) — `09-employes.md`
- Module 10 (Inventaire — source alertes stock) — `10-inventaire.md`
