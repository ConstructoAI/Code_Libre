# Module 01 — Tableau de bord & Statistiques

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/dashboard.py` (248 lignes, 5 endpoints), `backend/routers/analytics.py` (1424 lignes, 25 endpoints), `frontend/src/pages/DashboardPage.tsx` (339 lignes, 12 KPI cards), `frontend/src/pages/AnalyticsPage.tsx` (1228 lignes, 5 onglets)
> **Library graphiques** : **Recharts** (AreaChart, BarChart, PieChart, ResponsiveContainer)

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface Dashboard + Analytics](#2-interface-dashboard-analytics)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference (KPIs, endpoints)](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Centraliser les **KPIs operationnels** (12 cartes Dashboard) et les **analyses approfondies** (25 endpoints Analytics groupes en 5 onglets) pour piloter l entreprise :
- Vue rapide (Dashboard) : projets en cours, factures en retard, alertes stock, top fournisseurs
- Vue analytique (Analytics) : revenus / depenses / marges, profitabilite projets, productivite RH, valeur stock
- Filtres temporels (30 / 90 / 180 / 365 jours)
- Alertes visuelles D365-style (rouge / jaune / bleu)

### 1.2 2 pages distinctes

| Page              | URL              | Public cible                    | Vue                                |
|-------------------|------------------|---------------------------------|------------------------------------|
| **Dashboard**     | `/dashboard`     | Operationnels (vue quotidienne) | Statique : 12 KPI + alertes + top 5 |
| **Analytics**     | `/analytics`     | Direction (analyse approfondie) | 5 onglets, 25 endpoints, Recharts  |

### 1.3 Acces

- Sidebar -> **Tableau de bord** (icone LayoutDashboard) -> URL `/dashboard`
- Sidebar -> **Analytics** (icone TrendingUp) -> URL `/analytics`
- Souvent l ecran d accueil par defaut apres login.

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant voient les **memes vues** (pas de differenciation par role).
- Super-admin sans tenant : recoit `DashboardStats()` vide (zero data).
- Pas de filtrage par utilisateur (vue globale du tenant).

---

## 2. Interface (Dashboard + Analytics)

### 2.1 Page `/dashboard`

#### 2.1.1 Layout

Vue **statique** (pas de filtre temporel global, pas de personalisation).

Sections :
1. **Bandeau d alertes** (haut de page) — D365-style compact bars
2. **12 KPI cards** (3 rows x 4 cols responsive)
3. **Tableau Projets par statut** (count + barre %)
4. **Tableau Revenus mensuels** (6 derniers mois)
5. **Tableau Top 5 fournisseurs** (par volume d achats)

#### 2.1.2 12 KPI Cards

**Row 1** :
- **Projets en cours** (count + tendance vs total)
- **Entreprises** (count companies)
- **Employes actifs** (count statut=ACTIF)
- **Soumissions** (count + accepted count)

**Row 2** :
- **Factures** (count)
- **Solde du** (en rouge si > 0$)
- **Produits** (count inventaire actif)
- **Fournisseurs** (count)

**Row 3** :
- **Bons de travail** (count + en cours)
- **Projets termines** (count)
- **Soumissions brouillon** (draft count)
- **Alertes** (count total alertes)

#### 2.1.3 Bandeau d alertes (D365-style)

3 categories d alertes :
- **devis_urgents** : devis avec `date_prevu <= TODAY + 7` ET statut `Envoye` ou `En attente` -> **rouge** (`#fde7e9`)
- **stock_bas** : produits avec `stock_disponible <= stock_minimum AND stock_minimum > 0` -> **jaune** (`#fff4ce`)
- **factures_retard** : factures avec `date_echeance < TODAY` ET statut NOT IN (PAYEE, ANNULEE) -> **rouge**

Chaque alerte affiche : icone (AlertCircle / AlertTriangle), titre + count + premieres infos.

#### 2.1.4 Tableau Top 5 Fournisseurs

Source : `GET /dashboard/top-suppliers`

Colonnes :
- Fournisseur (`fournisseur_nom` denormalise)
- **Nb commandes** (`nb_commandes`)
- **Total achats $** (`total_achats` decimal)

### 2.2 Page `/analytics` (5 onglets)

#### 2.2.1 Selecteur de periode global

Dropdown en haut : `30 jours` (defaut) / `90 jours` / `180 jours` / `365 jours`.

Applique a tous les endpoints qui acceptent `period_days` (KPIs, profitability, productivity, revenue/expense, hours_trend, top_clients).

#### 2.2.2 Onglet « Vue Globale »

**Row 1 KPIs (4)** :
- **Revenus** (vert) — `revenus_total` periode
- **Soumissions envoyees** (bleu) — `devis_envoyes`
- **Projets actifs** (mauve) — `projets_actifs`
- **Employes actifs** (sarcelle) — `employes_actifs`

**Row 2 KPIs (4)** :
- **Pipeline commercial** (mauve) — `opportunites_pipeline` count + valeur
- **Alertes stock** (rouge si > 0, vert sinon) — `alertes_stock`
- **Revenus encaisses** (vert) — `revenus_encaisses`
- **Solde du** (rouge si > 0, vert sinon) — `factures_solde_du`

**Graphiques** :
- **Revenus mensuels** : AreaChart avec degrade (12 derniers mois)
- **Revenus vs Depenses** : Dual AreaChart (vert revenus + rouge depenses)
- **Evolution des projets** : Stacked AreaChart (en_attente / en_cours / termines par mois)

**Distributions de statut** :
- Invoices by status (Pie/Donut)
- BT by status (Pie/Donut)

#### 2.2.3 Onglet « Projets »

- **Tableau profitabilite** : Nom projet, Budget, Cout main d oeuvre, Cout materiaux, Marge, Rentabilite %
- **Project progress bars** : Top 20 projets avec `pourcentage_completion`
- **Workstation load** : Charge par departement (BT EN_COURS uniquement)

Endpoints :
- `GET /analytics/projects/profitability`
- `GET /analytics/project-progress`
- `GET /analytics/workstation-load`

#### 2.2.4 Onglet « Finances »

- **Sales pipeline stages** : Bar chart avec valeur + probabilite par etape (PROSPECTION -> QUALIFICATION -> PROPOSITION -> NEGOCIATION -> GAGNE)
- **Monthly revenue area chart** : Revenus mensuels 12 derniers mois
- **Invoice aging** : 4 buckets (0-30 / 31-60 / 61-90 / 90+ jours)
- **Invoice status donut** : Repartition factures par statut

Endpoints :
- `GET /analytics/sales-pipeline`
- `GET /analytics/monthly-revenue`
- `GET /analytics/factures-aging`
- `GET /analytics/invoices-by-status`

#### 2.2.5 Onglet « RH »

- **Hours trend area chart** : Heures mensuelles + nb employes + nb pointages (12 derniers mois)
- **Hours bar chart** : Top employes par `heures_totales`
- **Productivity table** : Employe, Poste, Departement, Jours travailles, Heures totales, **Heures/jour moyen**, Nb projets
- **Footer summary** : totaux + moyennes

Endpoints :
- `GET /analytics/hours-trend?period_days=365`
- `GET /analytics/hr/productivity?period_days=30`
- `GET /analytics/hr/departments`
- `GET /analytics/employee-productivity`

#### 2.2.6 Onglet « Stock »

- **Stock summary KPIs** : Produits actifs, Alertes count, Valeur totale $, Categories count
- **Stock value by category** : Bar + Donut (`SUM(stock * COALESCE(cout_revient, prix_unitaire, 0))`)
- **Stock alerts table** : Produit, Categorie, Stock, Seuil, **Taux stock %** avec barre coloree (rouge < 25%, jaune < 50%, vert >= 50%)
- **Top suppliers** : Horizontal bar + table

Endpoints :
- `GET /analytics/stock-summary`
- `GET /analytics/stock-value`
- `GET /analytics/stock-alerts`
- `GET /analytics/top-suppliers`

---

## 3. Workflows pas-a-pas

### 3.1 Consulter le tableau de bord operationnel

1. Sidebar -> **Tableau de bord** (defaut a la connexion).
2. La page se charge avec :
   - `GET /dashboard` (12 KPI + alertes)
   - `GET /dashboard/charts` (projets par statut + revenus mensuels)
   - `GET /dashboard/top-suppliers` (top 5)
3. Visualiser les alertes en rouge en haut (devis urgents, stock bas, factures retard).
4. Lire les 12 KPIs pour vue rapide.
5. Click une alerte -> redirection vers la liste filtree (a verifier en prod — drill-down probablement non implemente).

> **Pas de polling automatique** : les donnees sont chargees a l ouverture de la page. Pour rafraichir : F5 ou clicker sur le bouton refresh (a verifier en prod).

### 3.2 Analyser la profitabilite des projets

1. Sidebar -> **Analytics** -> onglet **Projets**.
2. Selectionner periode (defaut 30 jours).
3. Tableau profitabilite affiche :
   - Pour chaque projet : Budget initial, Cout main d oeuvre (calcule depuis `time_entries` + `taux_horaire`), Cout materiaux (lignes BT/BC), Marge ($), Rentabilite (%)
4. Identifier les projets avec marge < 10% pour action corrective.

### 3.3 Suivre la productivite RH

1. Analytics -> onglet **RH** -> selectionner periode.
2. Lecture du graphique **Hours trend** : evolution heures mensuelles + nb employes actifs.
3. Tableau **Productivity** trie par heures totales :
   - Identifier employes avec heures/jour > 9h (potentiel surcharge)
   - Identifier employes avec heures/jour < 6h (potentiel sous-utilisation)
4. Footer summary : moyenne globale + total tenant.

### 3.4 Gerer les alertes stock

1. Dashboard -> bandeau alertes -> count `stock_bas`.
2. Detail des produits : Analytics -> onglet **Stock** -> tableau **Stock alerts**.
3. Pour chaque produit en alerte :
   - Identifier le `taux_stock %` (pourcentage du seuil)
   - Couleur barre indique urgence (rouge < 25% = critique)
4. Reapprovisionner via Module 6 (BC) au fournisseur principal (cf. champ `fournisseur_principal` produit).

### 3.5 Pilotage commercial (pipeline)

1. Analytics -> onglet **Finances** -> graphique **Sales pipeline**.
2. Visualiser le funnel par etape : `PROSPECTION` / `QUALIFICATION` / `PROPOSITION` / `NEGOCIATION` / `GAGNE` / `PERDU`.
3. Pour chaque etape : count + montant total + probabilite ponderee.
4. Identifier les etapes goulot (ex. trop d opportunites bloquees en `PROPOSITION`).

### 3.6 Surveiller les factures en retard

1. Dashboard -> bandeau alertes -> count `factures_retard`.
2. Detail : Analytics -> onglet **Finances** -> **Invoice aging** (4 buckets).
3. Action : aller dans Module 7 (Comptabilite) -> filtrer par statut `EN_RETARD` ou date_echeance < TODAY.

### 3.7 Identifier les top clients

1. Analytics -> onglet **Vue Globale** ou **Finances**.
2. Tableau Top clients par CA (depuis `GET /analytics/top-clients`).
3. Analyser :
   - Nb projets / client
   - CA total / CA moyen
   - Date dernier projet
4. Actions : reactiver les clients dormants, choyer les top contributeurs.

### 3.8 Analyser la valeur d inventaire

1. Analytics -> onglet **Stock** -> KPI **Valeur totale $**.
2. Graphique **Stock value by category** : repartition par categorie.
3. Identifier les categories sur-stockees (capital immobilise) ou sous-stockees.

### 3.9 Identifier la charge de travail par departement

1. Analytics -> onglet **Projets** -> bloc **Workstation load**.
2. Tableau : departement + count BT en cours.
3. Identifier les departements en surcharge (capacite a augmenter) ou en sous-activite.

### 3.10 Comparer les revenus actuels vs precedents

1. Analytics -> onglet **Vue Globale** (ou via endpoint direct `/analytics/trends`).
2. Affichage : revenus du mois courant vs mois precedent + tendance % (positive ou negative).
3. Permet de detecter rapidement les variations significatives.

---

## 4. Reference

### 4.1 Endpoints Dashboard (`/dashboard`)

| Methode | URL                              | Role                                     |
|---------|----------------------------------|------------------------------------------|
| GET     | `/dashboard`                     | 12 KPIs consolides + alertes             |
| GET     | `/dashboard/activity`            | Activite recente (timeline — minimale)   |
| GET     | `/dashboard/alerts`              | Alertes urgentes (devis/stock/factures)  |
| GET     | `/dashboard/charts`              | Donnees graphiques (projets statut + revenus mensuels + BT statut) |
| GET     | `/dashboard/top-suppliers`       | Top 5 fournisseurs par volume            |

### 4.2 Endpoints Analytics (`/analytics`) — 25 endpoints

#### KPIs core

- `GET /analytics/kpis?period_days=30` — 16 KPIs agreges

#### Projets

- `GET /analytics/projects/profitability` — Budget vs couts reels
- `GET /analytics/projects/evolution` — Distribution mensuelle des statuts
- `GET /analytics/project-profitability` — V2 avec lignes formulaires
- `GET /analytics/project-progress` — Pourcentage completion top 20

#### Commercial

- `GET /analytics/commercial/pipeline` — Funnel opportunites
- `GET /analytics/sales-pipeline` — Distribution par statut

#### RH

- `GET /analytics/hr/productivity?period_days=30` — Heures par employe
- `GET /analytics/hr/departments` — Distribution heures par departement
- `GET /analytics/employee-productivity` — V2 summary par employe
- `GET /analytics/hours-trend?period_days=365` — Tendance mensuelle

#### Finance

- `GET /analytics/finance/revenue-expenses` — Revenus vs depenses + marge
- `GET /analytics/monthly-revenue` — 12 derniers mois revenu
- `GET /analytics/trends` — Comparaison mois courant vs precedent
- `GET /analytics/invoices-by-status` — Donut factures
- `GET /analytics/factures-aging` — 4 buckets aging

#### Inventaire

- `GET /analytics/inventory/alerts` — Produits low-stock
- `GET /analytics/stock-alerts` — V2 avec taux_stock %
- `GET /analytics/stock-value` — Valeur par categorie
- `GET /analytics/stock-summary` — KPIs stock

#### Top lists

- `GET /analytics/top-clients?period_days=365` — Top par CA
- `GET /analytics/top-clients-revenue` — Top par revenu factures
- `GET /analytics/top-suppliers` — Top par achats
- `GET /analytics/workstation-load` — BT par departement
- `GET /analytics/bt-by-status` — Distribution BT statut

### 4.3 Library graphiques

**Recharts** (React chart library) — composants utilises :
- `AreaChart` (degradés)
- `BarChart` (barres horizontales/verticales)
- `PieChart` (donuts)
- `ResponsiveContainer`
- `XAxis, YAxis, CartesianGrid, Tooltip, Legend, Area, Bar, Pie, Cell`

**Palette couleurs** (codee en dur) :
```javascript
['#7BAFD4', '#7DC4A5', '#F6C87A', '#E8919A', '#B09BD8', '#D4A0B0', '#7DC4B5', '#F0B07A']
```

### 4.4 Calculs cles

| KPI                     | Formule                                                              |
|-------------------------|----------------------------------------------------------------------|
| Revenus total           | `SUM(factures.montant_ttc) WHERE created_at >= NOW() - period_days` |
| Revenus encaisses       | `SUM(factures.montant_paye) WHERE statut='PAYEE' OR PARTIELLEMENT`  |
| Solde du                | `SUM(factures.solde_du) WHERE statut NOT IN (PAYEE, ANNULEE)`        |
| Marge projet            | `Budget - (cout_main_oeuvre + cout_materiaux)`                       |
| Rentabilite projet %    | `(Marge / Budget) * 100`                                             |
| Cout main d oeuvre      | `SUM(time_entries.total_hours * employees.taux_horaire)`             |
| Cout materiaux          | `SUM(formulaire_lignes.montant) FROM BT du projet`                   |
| Productivite employe    | `total_hours / nb_jours_travailles`                                  |
| Valeur stock total      | `SUM(stock_disponible * COALESCE(cout_revient, prix_unitaire, 0))`   |
| Taux stock %            | `(stock_disponible / stock_minimum) * 100`                           |
| Aging buckets           | `0-30j`, `31-60j`, `61-90j`, `90+ j` depuis date_echeance            |

### 4.5 Filtres temporels

- Periode : **30 jours** (defaut), **90 jours**, **180 jours**, **365 jours**
- Cas particuliers : `hours-trend?period_days=365` (1 an), `top-clients?period_days=365`
- Validation backend : `1 <= period_days <= 365` ou `<= 730` selon endpoint
- Implementation SQL : `CURRENT_DATE - make_interval(days => %s)`

### 4.6 Couleurs alertes (D365-style)

| Severite | Couleur fond | Couleur bordure | Usage                          |
|----------|--------------|------------------|--------------------------------|
| `danger` | `#fde7e9`    | `#f1707b`        | Factures retard, stock critique |
| `warning`| `#fff4ce`    | `#f7d87c`        | Stock bas, devis urgents        |
| `info`   | `#deecf9`    | (auto)           | Information neutre              |

### 4.7 Couleurs barre stock (taux %)

- **Rouge** : `taux_stock < 25%` (critique)
- **Jaune** : `25% <= taux_stock < 50%` (attention)
- **Vert** : `taux_stock >= 50%` (OK)

### 4.8 Limites & validations

| Regle                                  | Effet                                              |
|----------------------------------------|----------------------------------------------------|
| `period_days < 1` ou `> 730`           | Pydantic refuse (HTTP 422)                         |
| `limit > 50`                           | Pydantic refuse                                    |
| Tenant non configure (super-admin)     | Retourne `DashboardStats()` vide (zero)            |
| Aucune donnee sur la periode           | Retourne tableaux vides + zeros                    |
| Aggregation sur table absente          | Try/except defensif (retourne 0)                   |

---

## 5. Integrations & FAQ

### 5.1 Integration tous les modules

Le Dashboard et Analytics consomment des donnees de **tous les modules** de l ERP :

| Source                | Donnees consommees                                                    |
|-----------------------|-----------------------------------------------------------------------|
| Module 1 Projets      | count par statut, budget, dates, progression                          |
| Module 2 Suivi        | (vues distinctes — pas d agregation directe)                          |
| Module 3 CRM          | opportunites pipeline (etapes + valeurs)                              |
| Module 4 Devis        | count, montant, conversion                                            |
| Module 5 BT           | count par statut, lignes -> cout materiaux projet                     |
| Module 6 BC           | count, montant, top fournisseurs                                      |
| Module 7 Comptabilite | factures (status / aging / revenus), ecritures journal                |
| Module 8 Dossiers     | (pas d agregation directe)                                            |
| Module 9 Employes     | count actifs, productivity, time_entries -> cout main d oeuvre        |
| Module 10 Inventaire  | stock alerts, valeur, top categories                                  |
| Module 19 Immobilier  | (pas d integration dans Analytics — Dashboard immobilier separe)      |
| Module 25 IA          | (pas integre dans Dashboard — stats IA separees dans /ai/usage)       |

### 5.2 Performance

- **Aggregation 100% SQL** : tous les KPIs sont calcules en base via `SUM`, `COUNT`, `GROUP BY`, `date_trunc`. Aucune logique Python iterative cote backend.
- **Defensive try/except** : si une table n existe pas (vieux tenant non migre), le KPI retourne 0 plutot que de crasher.
- **Memoization du schema** : `_departement_cols_ensured` set evite la verification ALTER repetee.
- **Time-filling** : helper `_fill_months()` rempli les mois sans donnee avec zeros (timeline continue).
- **Type casting** : `CAST(x AS REAL)` partout pour eviter les NUMERIC vs INT issues.

### 5.3 Pas de cache backend

- Pas de cache Redis ou memoization globale.
- Chaque requete relit la base.
- Performance OK pour < 10k records par module. Pour gros volumes : envisager materialized views PostgreSQL.

### 5.4 Pas de polling automatique

- Le frontend charge les donnees a l ouverture de la page ou au changement d onglet/periode.
- Pas de WebSocket, pas de Server-Sent Events sur Dashboard.
- Pour vue temps reel : F5 manuel.

### 5.5 FAQ

**Q : Pourquoi le Dashboard est-il statique sans selecteur de periode ?**
R : Par design, le Dashboard est une vue **operationnelle quotidienne** : KPIs courants (projets en cours = NOW), alertes (factures en retard a aujourd hui). Pour les vues retroactives, utiliser Analytics avec son selecteur de periode.

**Q : Combien de temps faut-il pour charger un onglet Analytics avec beaucoup de donnees ?**
R : Generalement < 2s pour un tenant avec 1000 projets / 10k pointages / 5k factures. Au-dela : observer les logs backend pour identifier les requetes lentes (probablement aging factures ou productivity RH).

**Q : Comment exporter les donnees du Dashboard en PDF/Excel ?**
R : **Pas implemente**. Workaround : screenshot du navigateur ou copy-paste des tableaux. Pour les power users : appel direct a l API et traitement script.

**Q : Le KPI Solde du inclut-il les factures fournisseurs (achats) ?**
R : NON. `Solde du` = SUM(`solde_du`) des factures `type_destinataire = client` UNIQUEMENT. Les factures fournisseurs ont leur propre comptabilite (passif).

**Q : Les revenus encaisses incluent-ils les retenues de garantie ?**
R : Le calcul `montant_paye` exclut les retenues (qui sont en compte 1150 separe). Pour voir les retenues a recevoir : Module 7 Comptabilite -> onglet Retenues.

**Q : Pourquoi mon top supplier affiche un fournisseur que je n ai pas ?**
R : Les BC sont rattaches au `fournisseur_id` au moment de la creation. Si le fournisseur a ete renomme depuis, son ancien `nom_fournisseur` denormalise dans `bons_commande.fournisseur_nom` apparait toujours.

**Q : Les KPIs sont-ils calcules en temps reel ?**
R : OUI. Chaque appel a un endpoint Analytics relit la base. Pas de cache. Donc les KPIs refletent l etat exact a la milliseconde de la requete.

**Q : Comment ajouter un KPI personnalise ?**
R : Necessite **modification de code** : ajouter un endpoint dans `analytics.py`, exposer dans `analytics.ts` API client, integrer dans `AnalyticsPage.tsx`. Pas de configuration UI pour ajouter des KPIs custom.

**Q : Comment partager un graphique Analytics avec un client externe ?**
R : Pas de fonction « partager ». Workaround : screenshot ou copier les donnees dans un email/document. Pour vue partagee permanente : utiliser le module Dossiers avec lien public (mais ne montre que les documents joints, pas les KPI).

**Q : Le Dashboard differencie-t-il les vues admin / employe ?**
R : NON. Tous les utilisateurs voient le meme Dashboard avec les memes 12 KPIs (vue tenant globale). Pas de filtrage par utilisateur ou par role.

**Q : Comment surveiller les KPIs en continu (vue mur d ecran) ?**
R : Necessite refresh manuel (F5) toutes les X secondes/minutes. Pas de polling auto. Pour vue 24/7 : ouvrir une fenetre dediee + script auto-refresh navigateur (extensions tierces).

**Q : Les donnees historiques sont-elles purgees au-dela de 365 jours ?**
R : NON. Toutes les donnees historiques sont conservees indefiniment en base. La limite 365j s applique uniquement au **filtre d affichage** (period_days). Pour analyser au-dela : appel API direct avec `period_days > 365` (refuse au-dela 730 par validation Pydantic).

**Q : Le drill-down (clic sur KPI) est-il implemente ?**
R : **PAS dans cette version**. Cliquer sur un KPI n ouvre pas la liste detaillee filtree. Workaround : noter le count puis aller manuellement dans le module concerne avec le bon filtre.

**Q : Comment ajouter une alerte personnalisee (ex. CA mensuel < 50000$) ?**
R : **PAS configurable** en UI. Necessite ajout de logique dans `dashboard.py` -> `_get_alerts()`.

---

## 6. Recap one-pager

- **2 pages** : Dashboard (vue operationnelle, 12 KPI, statique) + Analytics (vue analytique, 5 onglets, 25 endpoints, selecteur periode).
- **5 onglets Analytics** : Vue Globale / Projets / Finances / RH / Stock.
- **Library** : Recharts (AreaChart, BarChart, PieChart, ResponsiveContainer).
- **Periode Analytics** : 30 / 90 / 180 / 365 jours (defaut 30).
- **Aggregation 100% SQL** (pas de Python iteratif).
- **Defensive try/except** sur tables manquantes.
- **Memoization schema** sur ALTER colonnes (`_departement_cols_ensured`).
- **Pas de cache** Redis ni materialized views (recalcule a chaque requete).
- **Pas de polling auto** : F5 manuel pour rafraichir.
- **Pas de drill-down** : click KPI ne navigue pas vers liste filtree.
- **Pas de personalisation** : layout fixe, pas de drag-drop widgets.
- **Pas de roles/vues** : meme Dashboard pour tous les utilisateurs du tenant.
- **Pas d export PDF/CSV** : workaround screenshot.
- **Alertes D365-style** 3 categories : devis_urgents (rouge), stock_bas (jaune), factures_retard (rouge).
- **Couleur barres stock** : rouge < 25%, jaune < 50%, vert >= 50%.
- **Top 5 fournisseurs** sur Dashboard, top 10 sur Analytics.
- **Comparaison trends** : mois courant vs precedent avec %.
- **Pas integration Immobilier ni IA** dans Analytics central (modules avec leurs propres dashboards).

---

**Documentation generee a partir du code** : `dashboard.py`, `analytics.py`, `DashboardPage.tsx`, `AnalyticsPage.tsx`, `analytics.ts`, `dashboard.ts`.

**Manuels lies** :
- Tous les autres modules (Dashboard agrege leurs donnees)
- Module 7 (Comptabilite — separation revenus/depenses) — `07-factures.md`
- Module 9 (Employes — productivity RH) — `09-employes.md`
- Module 10 (Inventaire — stock alerts) — `10-inventaire.md`
