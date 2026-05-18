# Module 13 — Pointage (Time-tracking employes)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `frontend/src/pages/PointagePage.tsx` (1372 lignes, 5 onglets), `backend/routers/employees.py` (lignes 140-797 — sous-section pointage), `backend/routers/payroll.py` (855 lignes — paie liee), `frontend/src/api/employees.ts`, `frontend/src/api/payroll.ts`
> **Tables PostgreSQL** : `time_entries` (table principale), `employees` (FK employee_id), `projects` (FK project_id), `formulaires` (FK formulaire_bt_id pour BT), `operations` (FK operation_id), `payroll_periods`, `payroll_entries` (paie generee a partir des time_entries)
> **Cadrage** : ce module documente le **pointage cote DESKTOP ERP** (page `/pointage`). Pour la fiche employe et les details DAS/CCQ complets, voir le **Module 11 Employes**. Pour la liaison BT-operation, voir le **Module 12 Bons de Travail**.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (5 onglets)](#2-interface-5-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference (champs, statuts, endpoints)](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Le module **Pointage** (page `/pointage`) est le **poste de commande des heures travaillees** dans Constructo AI ERP. Il permet a une personne autorisee (admin, contremaitre, RH) de :

- Saisir des time entries (punch in / punch out) au nom des employes depuis le desktop.
- Rattacher chaque heure a un projet, a un bon de travail (BT) et a une operation precise.
- Valider (approuver) les pointages avant inclusion en facturation ou paie.
- Editer / supprimer un pointage tant qu il n a pas ete facture.
- Visualiser les heures par semaine (timesheet hebdo) et par projet (rapport agrege).
- Generer un resume paie rapide (7/14/30/90 jours, DAS estimees).
- Declencher la paie CCQ complete : creer periode -> generer fiches -> fermer (irreversible).
- Exporter les pointages en CSV (archive, import paie tiers).

> **Pointage = source de verite des heures.** Masse salariale, cout main d oeuvre, facturation client et paie CCQ s appuient TOUS sur la table `time_entries`. Une saisie incorrecte se propage en aval.

### 1.2 Ce que le module ne fait PAS

- **Aucune saisie self-service** par l employe (pas de bouton « Pointer maintenant »). Seul un admin/superviseur peut creer un entry en selectionnant un employe.
- **Aucune integration GPS / geofence** : module GPS existe mais ne declenche pas de pointage automatique.
- **Aucune deduction automatique de pause repas** (pas de regle « -30 min si > 6h »). Saisir 2 entries ou ajuster `total_hours` manuellement.
- **Aucune detection retard / absence** : enregistre seulement ce qui est saisi, pas de comparaison a un horaire planifie.
- **Aucun bouton « Valider tous »** (bulk validate) : une approbation par entry.
- **Aucun verrou backend** sur la validation : `PUT /validate` n exige pas `can_approve_timecards = TRUE`. Restriction frontend uniquement.
- **Aucune impression** de fiche de paie (pas de bouton PDF/print).
- **Aucune auto-incrementation** des `operations.heures_reelles` BT depuis le pointage (cf. Module 05).
- **Aucune re-ouverture** de periode FERMEE : verrouillage a vie. Corriger via periode d ajustement.

### 1.3 Acces

- Sidebar -> **Pointage** (icone Clock) -> URL `/pointage`
- Onglet par defaut : **Pointages**
- 5 onglets (cf. section 2)

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant peuvent **CRUD** les time entries (acces ouvert).
- La **validation** (bouton « Valider ») est **affichee** seulement aux utilisateurs avec `can_approve_timecards = TRUE` (cf. Module 11 section 1.7). **Restriction frontend uniquement** — le backend ne verifie pas ce flag.
- Pointages **factures** (`is_billed = 1`) : verrouilles backend (HTTP 400 sur modif/delete).
- **Fermeture de periode** irreversible : pas de role privilegie, tout utilisateur peut la cloturer. Bonne pratique : reserver au RH / comptable.

### 1.5 Coordination avec l app mobile

Constructo AI dispose d une **app mobile separee** (`MOBILE_REACT/`) pour le pointage chantier des employes terrain. Les deux outils :

- **Partagent la meme table `time_entries`** : les pointages mobiles apparaissent dans l onglet Pointages desktop des synchronisation.
- **Partagent la logique d auto-calcul** (`punch_out - punch_in`).
- **UI independantes** : pas d interaction directe entre les deux applications.

Pour la documentation mobile (NIP 4 chiffres, kiosque chantier) : voir le manuel separe MOBILE_REACT.

---

## 2. Interface (5 onglets)

Source : `PointagePage.tsx:31` — `type TabKey = 'pointages' | 'vue_semaine' | 'par_projet' | 'paie' | 'paie_ccq'`.

| # | Cle              | Label            | Icone        | Contenu principal                                                |
|---|------------------|------------------|--------------|------------------------------------------------------------------|
| 1 | `pointages`      | Pointages        | Clock        | Liste CRUD des time entries (defaut)                             |
| 2 | `vue_semaine`    | Vue Semaine      | CalendarDays | Timesheet hebdomadaire 7 jours                                   |
| 3 | `par_projet`     | Par Projet       | Briefcase    | Heures agregees par projet + drill-down employes                 |
| 4 | `paie`           | Resume paie      | DollarSign   | Synthese rapide (RRQ + RQAP + AE seulement)                      |
| 5 | `paie_ccq`       | Paie CCQ         | Calculator   | Paie complete avec DAS, charges employeur, fiches detaillees     |

Bouton global **Exporter** (icone Download) en haut a droite : telecharge l export CSV de toutes les entries du tenant (avec filtres optionnels).

### 2.1 Onglet « Pointages » (defaut)

Vue principale, tableau triable et redimensionnable. Colonnes :

| Colonne     | Source                                              |
|-------------|-----------------------------------------------------|
| Employe     | `e.prenom || ' ' || e.nom`                          |
| Client      | `companies.nom` via BT (`f.company_id`)             |
| Projet      | `projects.nom_projet`                               |
| BT          | `formulaires.numero_document`                       |
| Operation   | `COALESCE(operations.nom, operations.description)`  |
| Entree      | `time_entries.punch_in` (formate)                   |
| Sortie      | `time_entries.punch_out` (formate)                  |
| Heures      | `time_entries.total_hours` (auto-calcule)           |
| Valide      | Badge ou bouton **Valider**                         |
| Actions     | Icones Edit + Trash2                                |

**Barre de commande** : bouton **Nouveau pointage** (primary), recherche client-side (employe/client/projet/BT/operation/notes), filtre statut (`Tous` / `Valides` / `Non valides` / `Factures`).

**Colonne « Valide »** :
- Si `is_billed = TRUE` : badge bleu **« Facture »** (lecture seule).
- Sinon, si `validated = TRUE` : badge vert **« Valide »** avec coche.
- Sinon : bouton **« Valider »** cliquable.

**Actions** :
- Icone crayon (Pencil) = modifier. Disabled si `is_billed`.
- Icone poubelle (Trash2) = supprimer (avec confirmation). Disabled si `is_billed`.

**Pagination** : 20 entries/page. Cachee si recherche / filtre actif.

### 2.2 Onglet « Vue Semaine »

Vue timesheet hebdomadaire :

- En-tete : **Semaine precedente** (chevron gauche) | dates de la semaine affichee (`weekStart` au `weekEnd`) | **Semaine suivante** (chevron droite) | badge **Total: Xh** (somme de la semaine).
- Tableau a 7 lignes (lundi a dimanche) avec colonnes :
  - **Jour** (capitalise)
  - **Date** (YYYY-MM-DD)
  - **Nb Entrees** (count des time entries du jour)
  - **Total Heures** (somme `total_hours` du jour, en heures)
- Pied de tableau : **Total semaine** en gras, couleur primaire.

Endpoint : `GET /employees/time-entries/weekly?week_start=YYYY-MM-DD&employee_id=...`

> **Limite** : la vue agrege par jour mais **n affiche pas la liste des entries individuelles** dans le tableau (juste le count + total). Pour voir les entries d un jour, retourner a l onglet **Pointages** et trier par date.

### 2.3 Onglet « Par Projet »

Tableau agrege des heures par projet :

| Colonne      | Description                                              |
|--------------|----------------------------------------------------------|
| Projet       | Nom du projet (avec chevron pour deplier)                |
| Heures       | Somme `time_entries.total_hours` filtre sur `project_id` |
| Nb Employes  | `COUNT(DISTINCT employee_id)`                            |

Click sur une ligne projet -> **deplie** la liste des employes ayant pointe sur ce projet (icone Users + nom + heures de cet employe sur ce projet).

Endpoint : `GET /employees/time-entries/by-project` (limite : top 20 projets, tries par heures decroissantes).

### 2.4 Onglet « Resume paie »

Vue paie simplifiee, **sans DAS detaillees**.

**Filtre periode** (dropdown) : 7 / 14 / 30 (defaut) / 90 jours.

**Cartes de stats** (StatCard) :
- **Masse salariale brute** (somme des bruts sur la periode) — couleur bleue.
- **Employes** (nombre d employes ACTIF avec heures) — couleur verte.

**Tableau** :

| Colonne     | Calcul                                                 |
|-------------|--------------------------------------------------------|
| Employe     | `e.prenom || ' ' || e.nom`                             |
| Dept.       | `e.departement`                                        |
| Heures      | `SUM(te.total_hours)` sur la periode                   |
| Taux        | `COALESCE(e.taux_horaire, e.salaire, 0)` $/h           |
| Brut        | `Heures * Taux`                                        |
| Deductions  | `Brut * (RRQ 6.4% + RQAP 0.494% + AE 1.32%)` = ~8.21%  |
| Net         | `Brut - Deductions`                                    |

> **Important** : ces deductions sont **estimees** (RRQ + RQAP + AE seulement, sans impot federal / provincial / paliers). Pour les chiffres reels publiables, utiliser **l onglet Paie CCQ** (cf. 2.5).

Endpoint : `GET /employees/payroll-summary?period_days=30`.

Filtre interne : seuls les employes avec `statut = 'ACTIF'` sont inclus.

### 2.5 Onglet « Paie CCQ »

Vue paie complete avec DAS detaillees et charges employeur. Voir **Module 11 sections 2.2.5, 3.10-3.14, 4.5-4.7** pour la documentation complete (paliers d impots, taux RRQ/RQAP/AE/CNESST/FSS/CCQ, formules d annualisation).

**Organisation** :

1. **Selecteur de periode** (dropdown) : liste `payroll_periods`, format `YYYY-MM-DD au YYYY-MM-DD (TYPE) [FERME]` si applicable.
2. Bouton **+ Nouvelle periode** -> modale (date debut / date fin / type).
3. Si periode OUVERTE : boutons **Calculer paie** (icone Calculator) et **Fermer periode** (icone Lock rouge).
4. Si FERMEE : badge rouge **« Periode fermee »**, boutons caches.

**4 cartes de totaux** (visibles si entries > 0) : Employes / Masse brute / Masse nette / Cout employeur.

**Tableau** : Employe, Dept., H. Reg, H. Supp (orange si > 0), Brut, Deductions (rouge), Net (vert gras), Cout Empl. (violet), CCQ (badge Oui/Non), Fiche (bouton FileText).

**Modale Fiche de paie** (taille XL) :
- En-tete : nom, poste, departement, periode, type.
- Section **Heures** : regulieres / supplementaires / taux.
- 3 cartes : Salaire brut / Salaire net (vert) / Cout employeur (violet).
- Tableau **Deductions employe** : impot federal + provincial + RRQ 6.40% + RQAP 0.494% + AE 1.32% + Total.
- Tableau **Charges employeur** : RRQ 6.40% + RQAP 0.692% + AE 1.848% + CNESST 1.80% + FSS 1.65% + CCQ 12.5% (badge Applicable/N/A) + Total.

> **Pas de bouton Imprimer / PDF**. Pour archive : screenshot ou copier-coller.

---

## 3. Workflows pas-a-pas

### 3.1 Creer un pointage manuel (saisie admin)

1. Onglet **Pointages** -> bouton **Nouveau pointage**.
2. Modale, champs :
   - **Employe** * (dropdown obligatoire)
   - **Projet** (dropdown optionnel)
   - **Bon de travail** (dropdown optionnel, libelle BT + nom projet)
   - **Entree / Sortie (Punch In / Out)** (datetime-local)
   - **Notes** (textarea), **Facturable** (checkbox, defaut TRUE)
3. Si les 2 datetimes sont saisis : affichage temps reel **« Heures calculees: X.XXh »** (client : `(out - in) / 3600000`).
4. **Creer** -> `POST /employees/time-entries`. Backend :
   - Auto-calcul `total_hours` si non fourni : `(dt_out - dt_in).total_seconds() / 3600` arrondi 2 decimales.
   - Validation `punch_out >= punch_in` (sinon HTTP 400).
5. Le pointage apparait dans le tableau, **non valide** par defaut.

> **A noter** : la modale de creation **ne permet PAS de selectionner une operation BT**. Pour rattacher a une operation : creer avec le BT, puis utiliser **Modifier** (cf. 3.4).

### 3.2 Saisir une duree sans datetimes

Si la duree est connue mais pas les heures exactes : laisser Punch In/Out vides. Backend accepte avec `total_hours = NULL`. **Important** : un entry sans `total_hours` n est PAS comptabilise en paie.

> Recommandation : saisir des datetimes representatives (ex. 08:00-16:00 pour 8h) ou poster `total_hours` directement via API.

### 3.3 Auto-calcul des heures travaillees

Calcul a deux endroits avec resultat identique (arrondi 2 decimales) :

| Endroit              | Logique                                                          |
|----------------------|------------------------------------------------------------------|
| Frontend (UI)        | `Math.round((diff_ms / 3600000) * 100) / 100`                    |
| Backend (POST/PUT)   | `round((dt_out - dt_in).total_seconds() / 3600, 2)` si non fourni |

Le backend recalcule apres un PUT si datetime modifie ET `total_hours` non fourni explicitement. Pour override manuel : envoyer `total_hours` dans le payload.

### 3.4 Modifier un pointage (avec rattachement BT + operation)

1. Onglet Pointages -> ligne -> icone **crayon (Pencil)**.
2. Modale d edition pre-remplie. Champs editables (grille 2 colonnes) : Employe *, Projet, Bon de travail, Operation (cascade).
3. **Cascade BT -> Operations** : selectionner un BT -> appel `listOperations(btId)` -> dropdown Operation se remplit dynamiquement avec `op.nom || op.description || "Operation #ID"`. Pendant chargement, label « Operation (chargement...) » + dropdown disabled.
4. **Anti-collision** : compteur monotone (`loadOperationsSeqRef`) ignore les reponses obsoletes si l utilisateur change rapidement de BT.
5. Datetimes Entree / Sortie : input `datetime-local` avec `step="1"` (precision seconde). Heures calculees affichees en temps reel.
6. Champ **Type de travail** (texte libre), **Notes** (textarea), checkboxes **Facturable** + **Valide**.
7. Si `is_billed = TRUE` : avertissement orange « Deja facture — modifications refusees cote serveur ».
8. **Enregistrer** -> `PUT /employees/time-entries/{id}` (envoie uniquement les champs modifies). Si rien n a change : pas de requete, modale se ferme.
9. Backend valide : `punch_out >= punch_in`, operation appartient bien au BT (defense en profondeur cf. 3.5), refus si `is_billed`.

### 3.5 Verification operation / BT (defense en profondeur backend)

Le backend verifie qu une operation envoyee dans un PUT **appartient bien au BT** : `SELECT id FROM operations WHERE id = ? AND formulaire_bt_id = ?`. Si l operation n est pas trouvee dans ce BT : HTTP 400 « Operation introuvable ou n appartient pas a ce bon de travail ».

Si `operation_id` est fourni sans BT (ni en payload ni en base) : HTTP 400 « Une operation doit etre rattachee a un bon de travail ».

### 3.6 Valider / devalider un pointage

**2 methodes pour valider** :

- **Bouton dans la liste** : Onglet Pointages -> ligne avec badge orange **« Valider »** -> click -> `PUT /employees/time-entries/{id}/validate`. Backend : `UPDATE validated = TRUE, validated_by = current_user_id, validated_at = CURRENT_TIMESTAMP`. Badge passe en vert.
- **Modale d edition** : cocher **Valide** -> Enregistrer. Idem cote backend.

**Devalider** : uniquement via la modale d edition (decocher **Valide**). Le backend reset `validated_by = NULL`, `validated_at = NULL`.

> **Pas de bulk validate**. Une approbation par entry.

> Le backend `PUT /validate` **ne verifie PAS** `can_approve_timecards`. Restriction frontend uniquement (cf. FAQ 5.9).

### 3.7 Supprimer un pointage

1. Icone **poubelle** -> confirmation native -> `DELETE /employees/time-entries/{id}`.
2. Backend : verifie existence (sinon 404) + `is_billed = FALSE` (sinon HTTP 400 « Impossible de supprimer un pointage deja facture »).
3. **Hard delete** : pas de soft-delete, l entry disparait pour de bon.

### 3.8 Verrouillage automatique des pointages factures

Quand un time entry est inclus dans une facture (Module 07), le backend met `is_billed = 1`. Effets :

| Action       | Comportement si `is_billed = TRUE`                              |
|--------------|-----------------------------------------------------------------|
| Liste        | Badge bleu **« Facture »** dans la colonne Valide               |
| Modifier     | Icone crayon disabled + HTTP 400 backend                        |
| Supprimer    | Icone poubelle disabled + HTTP 400 backend                      |
| Valider      | Bouton cache cote frontend (badge « Facture » remplace tout)    |

> Pointage facture = **immuable**. Pour corriger : annuler la facture en amont, puis modifier le pointage.

### 3.9 Naviguer dans la vue semaine

Onglet **Vue Semaine** -> defaut = semaine en cours (lundi-dimanche). Chevrons gauche / droite : reculer / avancer de 7 jours. Endpoint : `GET /employees/time-entries/weekly?week_start=YYYY-MM-DD`. Backend calcule `week_end = week_start + 6 jours` et genere 7 lignes avec totaux.

### 3.10 Voir les heures par projet

Onglet **Par Projet** -> top 20 projets par heures decroissantes. Click sur ligne projet -> deplie les employes ayant pointe (sous-lignes grisees + heures par employe sur ce projet). Endpoint : `GET /employees/time-entries/by-project`.

> **Pas de filtre date** : agrege toutes les entries du tenant.

### 3.11 Generer le resume paie (rapide)

Onglet **Resume paie** -> dropdown periode (7 / 14 / 30 / 90 jours) -> `GET /employees/payroll-summary?period_days=N`. Backend filtre `statut = ACTIF`, joint `time_entries` sur la periode, calcule heures + brut + deductions estimees (RRQ 6.4% + RQAP 0.494% + AE 1.32% = ~8.21%) + net.

> **Calcul approximatif** : pas d impot, pas de paliers, pas de plafond cotisable. Pour chiffres publiables : Paie CCQ.

### 3.12 Creer une periode + calculer la paie + cloturer

> **Note** : ces 3 etapes sont documentees en detail dans le **Module 11 sections 3.10-3.14** (paie CCQ complete avec DAS, paliers d impots, charges employeur). Resume du flow declenche depuis cet onglet :

1. Bouton **+ Nouvelle periode** -> modale 3 champs (date debut, date fin, type) -> `POST /payroll/periods`. Statut initial `OUVERTE`.
2. Selectionner la periode -> bouton **Calculer paie** -> `POST /payroll/generate`. Recupere les employes ACTIF, somme leurs `time_entries.total_hours`, decoupe en regulier/supp, calcule DAS + charges, INSERT dans `payroll_entries`.
3. Re-executable tant que periode OUVERTE.
4. Bouton **Fermer periode** -> confirmation -> `PUT /payroll/periods/{id}/close`. **Irreversible**.
5. Voir le detail d une fiche : icone **FileText** dans la colonne Fiche -> modale XL avec heures, brut/net/cout, deductions employe (5 lignes), charges employeur (6 lignes dont CCQ).

### 3.13 Exporter les pointages en CSV

1. Bouton **Exporter** (icone Download) en haut a droite -> `GET /employees/time-entries/export-csv`.
2. Telecharge `pointages_export.csv` (UTF-8, separateur virgule). Colonnes : ID, Employe, Projet, BT Numero, Entree, Sortie, Heures, Type, Notes, Valide (Oui/Non).
3. Filtres optionnels via API directe (pas dans l UI desktop) : `employee_id`, `date_debut`, `date_fin` (YYYY-MM-DD).

> Cas d usage : import dans logiciel de paie tiers (Nethris, Desjardins, ADP), audit comptable, archive trimestrielle.

---

## 4. Reference

### 4.1 Champs principaux de la table `time_entries`

| Champ              | Type         | Role                                                                |
|--------------------|--------------|---------------------------------------------------------------------|
| `id`               | SERIAL PK    | Identifiant unique                                                  |
| `employee_id`      | INT FK       | Employe pointe (FK `employees.id`)                                  |
| `project_id`       | INT/TEXT FK  | Projet (FK `projects.id`, JOIN sur `::text`)                        |
| `formulaire_bt_id` | INT FK       | Bon de travail (FK `formulaires.id`)                                |
| `operation_id`     | INT FK       | Operation BT (FK `operations.id`)                                   |
| `punch_in`         | TIMESTAMP    | Heure de debut. Defaut `CURRENT_TIMESTAMP` si NULL a INSERT.        |
| `punch_out`        | TIMESTAMP    | Heure de fin. Doit etre >= `punch_in`.                              |
| `total_hours`      | DECIMAL(...) | Duree calculee ou saisie. >= 0. NULL si non calcule.                |
| `notes`            | TEXT         | Notes libres                                                        |
| `type_travail`     | TEXT         | Type texte libre (ex. Installation, Reparation)                     |
| `validated`        | BOOLEAN      | TRUE si valide par superviseur. Defaut FALSE.                       |
| `validated_by`     | INT FK       | User qui a valide (FK `erp_users.id`)                               |
| `validated_at`     | TIMESTAMP    | Date/heure de validation                                            |
| `billable`         | BOOLEAN      | TRUE = facturable au client. Defaut TRUE (cf. COALESCE en SELECT).  |
| `is_billed`        | INT/BOOL     | 1 si l entry a ete inclus dans une facture (verrou).                |
| `created_at`       | TIMESTAMP    | Date de creation. Defaut `CURRENT_TIMESTAMP`.                       |

### 4.2 Statuts visibles dans la liste

| Statut UI    | Condition                                          | Badge / Couleur                   |
|--------------|----------------------------------------------------|-----------------------------------|
| **Facture**  | `is_billed = 1`                                    | Badge bleu                        |
| **Valide**   | `validated = TRUE` ET `is_billed = 0`              | Badge vert (avec icone Check)     |
| **Non valide** | `validated = FALSE` ET `is_billed = 0`           | Bouton orange « Valider »         |

### 4.3 Filtres de l onglet Pointages

| Filtre        | Comportement client-side                           |
|---------------|----------------------------------------------------|
| Recherche     | Sous-chaine sur Employe + Client + Projet + BT + Operation + Notes |
| `valide`      | Garde uniquement `validated = TRUE`                |
| `non_valide`  | Garde uniquement `validated = FALSE`               |
| `facture`     | Garde uniquement `is_billed = TRUE`                |
| Tous (defaut) | Pas de filtre                                      |

### 4.4 Endpoints principaux du module

#### Pointage (CRUD et vues)

| Methode | URL                                                | Role                                  |
|---------|----------------------------------------------------|---------------------------------------|
| GET     | `/employees/time-entries`                          | Liste paginee + filtres `employee_id`, `project_id`, `bt_id` |
| POST    | `/employees/time-entries`                          | Creer entry (auto-calcul heures)      |
| PUT     | `/employees/time-entries/{id}`                     | Modifier (recalcul heures + validation BT/op) |
| DELETE  | `/employees/time-entries/{id}`                     | Supprimer (refus si `is_billed`)      |
| PUT     | `/employees/time-entries/{id}/validate`            | Valider/approuver (audit `validated_by`/`validated_at`) |
| GET     | `/employees/time-entries/weekly`                   | Vue 7 jours (param `week_start`, `employee_id`) |
| GET     | `/employees/time-entries/by-project`               | Heures groupees par projet (top 20)   |
| GET     | `/employees/time-entries/export-csv`               | Export CSV (filtres `employee_id`, `date_debut`, `date_fin`) |
| GET     | `/employees/payroll-summary`                       | Synthese paie simple (RRQ + RQAP + AE seulement) |

#### Paie CCQ (declenchee depuis l onglet Paie CCQ)

| Methode | URL                                                | Role                                       |
|---------|----------------------------------------------------|--------------------------------------------|
| GET     | `/payroll/periods`                                 | Liste periodes                             |
| POST    | `/payroll/periods`                                 | Creer periode                              |
| PUT     | `/payroll/periods/{id}/close`                      | Cloturer (irreversible)                    |
| POST    | `/payroll/generate`                                | Generer paie (regenerable si OUVERTE)      |
| GET     | `/payroll/entries`                                 | Liste fiches de paie (filtre `period_id`)  |
| GET     | `/payroll/entries/{id}`                            | Detail fiche de paie                       |

> Pour la doc complete des endpoints `/payroll/*`, voir **Module 11 section 4.8**.

### 4.5 Tables PostgreSQL utilisees

| Table              | Role                                                    |
|--------------------|---------------------------------------------------------|
| `time_entries`     | Source de verite des pointages (table principale)       |
| `employees`        | Employes (FK `employee_id`, taux horaire, departement)  |
| `projects`         | Projets (FK `project_id`)                               |
| `formulaires`      | Bons de travail (FK `formulaire_bt_id`)                 |
| `operations`       | Operations BT (FK `operation_id`)                       |
| `companies`        | Clients (JOIN via `formulaires.company_id`)             |
| `payroll_periods`  | Periodes de paie (OUVERTE / FERMEE)                      |
| `payroll_entries`  | Fiches de paie generees (consomme `time_entries`)       |

### 4.6 Validations et regles cote backend

| Regle                                              | Effet                                                |
|----------------------------------------------------|------------------------------------------------------|
| `punch_out < punch_in` (POST ou PUT)               | HTTP 400 « punch_out doit etre apres punch_in »      |
| `total_hours < 0`                                  | Pydantic `Field(..., ge=0)` -> HTTP 422              |
| Modification d un entry `is_billed = TRUE`         | HTTP 400 « Impossible de modifier un pointage deja facture » |
| Suppression d un entry `is_billed = TRUE`          | HTTP 400 « Impossible de supprimer un pointage deja facture » |
| `operation_id` sans BT (ni en payload ni en base)  | HTTP 400 « Une operation doit etre rattachee a un bon de travail » |
| `operation_id` avec BT, mais l operation n appartient pas au BT | HTTP 400 « Operation introuvable ou n appartient pas a ce bon de travail » |
| PUT vide (aucun champ)                             | HTTP 400 « Aucun champ a modifier »                  |
| Generation paie sur periode FERME                  | HTTP 400 (cote `payroll.py`)                         |
| Cloture d une periode deja FERMEE                  | HTTP 400 ou pas d effet (selon implementation)       |
| Defaut sur `billable` non specifie                 | TRUE (a l INSERT et au SELECT via COALESCE)          |

### 4.7 Auto-calcul heures — formules

| Source         | Formule                                                                  |
|----------------|--------------------------------------------------------------------------|
| **Frontend**   | `Math.round((diff_ms / 3600000) * 100) / 100`                            |
| **Backend POST** | `round((dt_out - dt_in).total_seconds() / 3600, 2)`                    |
| **Backend PUT** | Idem POST, lecture des valeurs en base si non fournies dans le payload  |

Format des datetimes acceptes : ISO 8601 (`YYYY-MM-DDTHH:MM:SS` avec ou sans timezone). Le suffixe `Z` est normalise en `+00:00`.

> Le backend utilise `datetime.fromisoformat()` (Python 3.11+) qui accepte les separateurs T et espace, ainsi que les offsets timezone.

### 4.8 Cycles de paie et seuils heures supplementaires

| Type periode    | Seuil heures supp | Periodes / an | Multiplicateur supp |
|-----------------|-------------------|---------------|---------------------|
| `HEBDOMADAIRE`  | 40h / semaine     | 52            | x1.5                |
| `BI_HEBDO`      | 80h / 2 sem       | 26            | x1.5                |
| `MENSUEL`       | 173.33h / mois    | 12            | x1.5                |

Constantes : `REGULAR_HOURS_WEEKLY = 40.0`, `OVERTIME_MULTIPLIER = 1.5` (`payroll.py:72-73`).

---

## 5. Integrations & FAQ

### 5.1 Integration Module 11 (Employes / RH)

- **Source** : la fiche employe (poste, departement, taux horaire, statut, can_approve_timecards).
- **Coordination** : la generation paie CCQ ne traite que les employes `statut = ACTIF`.
- Chaque time entry est lie a un employee_id (obligatoire). Si l employe est supprime : a verifier en prod (cascade ou refus selon FK).

### 5.2 Integration Module 12 (Bons de Travail)

- **FK** : `time_entries.formulaire_bt_id` -> `formulaires.id` (BT) et `time_entries.operation_id` -> `operations.id`.
- **Cascade UI** : selectionner un BT dans la modale d edition charge dynamiquement la liste des operations associees (cf. 3.4).
- **Limite connue** : pointer sur une operation **ne met PAS a jour** `operations.heures_reelles`. Cf. **Module 12 section 3.12** — saisie manuelle requise pour reporter les heures pointees vers les operations BT.
- Le numero BT (`formulaires.numero_document`) et le client (`companies.nom` via `formulaires.company_id`) apparaissent dans les colonnes du tableau Pointage.

### 5.3 Integration Module 09 (Projets) — cout main d oeuvre

- **FK** : `time_entries.project_id` -> `projects.id` (jointure cast `::text` pour compatibilite).
- L onglet **Par Projet** agrege les heures par projet (cf. 3.10).
- Le **cout employe** (heures * taux) est repercute dans la vue financiere du projet (Module 09 — `getProjectFinancials`).
- **Pas de filtre date** dans le rapport Par Projet (toutes les entries du tenant).

### 5.4 Integration Module 15 (Facturation)

- Les time entries `billable = TRUE` ET `validated = TRUE` peuvent etre **incluses dans une facture client**.
- Lors de la facturation : backend met `is_billed = 1` sur les entries selectionnees.
- Effet : le pointage devient **immuable** (cf. 3.8). Les icones edit/delete sont desactivees, le badge passe en bleu « Facture ».
- Pour devenir non facture : annuler / supprimer la facture (workflow cote Module 07).

### 5.5 Integration Module 15 (Comptabilite — sync depenses)

- L endpoint `POST /accounting/sync-depenses` agrege les `time_entries` validees par periode.
- Cree des ecritures de journal type SALAIRE :
  - Debit `5200` (Main d oeuvre directe)
  - Credit `2300` (Salaires a payer)
- **Independant de la generation paie CCQ** : les ecritures sont creees a partir des time entries directement, sans passer par `payroll_entries`.

### 5.6 Integration Paie CCQ (`/payroll/*`)

- L onglet **Paie CCQ** consomme les `time_entries` validees pour generer les fiches de paie.
- Pour le detail des taux DAS, paliers d impots et charges employeur, voir **Module 11 sections 4.5-4.7**.
- Cycle : creer periode -> calculer paie -> consulter fiches -> fermer periode (irreversible).
- Re-generation possible tant que la periode est OUVERTE.

### 5.7 Integration App Mobile (MOBILE_REACT)

- Constructo AI dispose d une **app mobile separee** pour le pointage chantier.
- Les deux outils **partagent la meme table `time_entries`**.
- L app mobile permet typiquement :
  - Pointage In/Out par l employe lui-meme via NIP 4 chiffres (`employees.pin_code_hash`, bcrypt).
  - Selection projet / BT / operation depuis le terrain.
- Les pointages mobiles **apparaissent dans l onglet Pointages desktop** des leur synchronisation.
- L ERP desktop **n a pas de bouton pour declencher la synchro** ni de vue specifique « pointages mobiles » : les entries sont melees indistinctement (le seul indice est le `created_at` ou des notes).
- Pour la documentation complete de l app mobile : consulter le manuel separe MOBILE_REACT (hors perimetre de ce manuel ERP).

### 5.8 Integration GPS / Vehicules

- **Aucune integration** dans cette version.
- Le module GPS (`gps.py`) gere les vehicules, locations sauvegardees et geofences, mais ne declenche **PAS** de pointage automatique.
- Pas de check-in / check-out chantier via geofence dans cette version.

### 5.9 FAQ

**Q : Pourquoi un employe ne peut-il pas pointer lui-meme depuis l ERP desktop ?**
R : Le module Pointage desktop est concu pour la **saisie admin / superviseur** (selection d un employe dans une liste deroulante). Pour le self-pointage : utiliser l **app mobile** MOBILE_REACT (NIP 4 chiffres).

**Q : Comment gerer les pauses repas non payees ?**
R : Aucune deduction automatique. 3 solutions :
- Creer 2 entries distinctes (08:00-12:00 + 13:00-17:00).
- Saisir directement un `total_hours` corrige (7.5 au lieu de 8).
- Ajouter une note et ajuster hors-systeme.

**Q : Que se passe-t-il si je modifie `punch_in` mais pas `total_hours` ?**
R : Backend recalcule automatiquement a partir du nouveau `punch_in` et de l ancien `punch_out`. Pour conserver `total_hours` independamment, l envoyer explicitement dans le payload PUT.

**Q : Peut-on pointer plusieurs employes en une seule operation ?**
R : **Non**. Une entry = un employe. Pour 10 employes : 10 POST successifs.

**Q : Le bouton « Valider » est-il vraiment reserve aux superviseurs ?**
R : **Cote frontend uniquement**. Le bouton est cache si `can_approve_timecards = FALSE`, mais l endpoint backend `PUT /validate` ne verifie pas le flag — un appel API direct reussira meme sans. Limitation connue.

**Q : Comment differencier un pointage desktop d un pointage mobile ?**
R : **Aucune indication explicite** dans `time_entries` (pas de colonne `source`). Indices : `created_at` ou `notes`. Convention possible : prefixer notes par `[MOBILE]`.

**Q : Que faire si un pointage a un `total_hours` aberrant (ex. 250h) ?**
R : Le backend ne valide pas de plafond superieur. Seul controle : `total_hours >= 0`. Pour detecter : tri descendant colonne Heures ou export CSV + Excel.

**Q : Peut-on rattacher une operation sans rattacher le BT ?**
R : **Non**. HTTP 400 « Une operation doit etre rattachee a un bon de travail ». Selectionner d abord le BT, puis l operation.

**Q : Comment savoir qui a valide un pointage ?**
R : Champs `validated_by` et `validated_at` remplis automatiquement, **mais pas exposes dans l UI desktop**. Verifier en base directement.

**Q : Le filtre Recherche / Statut est-il serveur ou client ?**
R : **Client uniquement**. Le backend pagine 20 entries/page sans filtres. Pour chercher dans tout le tenant : paginer plusieurs fois ou exporter CSV.

**Q : Peut-on importer des pointages en lot depuis un CSV ?**
R : **Pas d UI d import**. Pour un import en masse : POST /time-entries en boucle (script Python / Postman).

**Q : Les heures supplementaires apparaissent-elles dans Pointages ?**
R : **Non**. Le decoupage regulier/supp est calcule **a la generation de la paie** (Paie CCQ). Une entry de 45h apparait simplement comme `45h`.

**Q : Pourquoi deux vues paie (Resume paie + Paie CCQ) ?**
R : **Resume paie** = synthese rapide 7-90 jours sans periode formelle, deductions estimees. **Paie CCQ** = paie reelle avec periode, paliers d impots, charges employeur, fiches archivees. Pour chiffres publiables : Paie CCQ.

**Q : Comment supprimer un pointage facture par erreur ?**
R : Le backend refuse la suppression. Process : annuler la facture (Module 07), ce qui devrait remettre `is_billed = 0`, puis supprimer.

**Q : Comment tracker le temps total d un employe sur le mois courant ?**
R : Resume paie 30 jours, ou Vue Semaine x 4, ou API `GET /time-entries?employee_id=X` + filtrage manuel.

---

## 6. Recap one-pager

- **Page** : `/pointage` — 5 onglets (Pointages / Vue Semaine / Par Projet / Resume paie / Paie CCQ).
- **Saisie admin uniquement** : pas de self-service desktop. Pour self-service : app mobile MOBILE_REACT.
- **Auto-calcul heures** : `(punch_out - punch_in) / 3600`, arrondi 2 decimales (frontend + backend).
- **Cascade BT -> Operations** dans la modale d edition (chargement dynamique avec anti-collision).
- **Validation** : reservee aux `can_approve_timecards = TRUE` (frontend uniquement, pas de check backend).
- **Verrouillage facturation** : `is_billed = TRUE` -> immuable (modif/delete refuses HTTP 400).
- **Pas de bulk validate**, pas d UI d import CSV, pas d auto-incrementation des heures BT.
- **Vue semaine** : 7 jours lundi-dimanche avec totaux. Pas de detail entry par entry dans la grille.
- **Vue par projet** : top 20 projets, drill-down employes. Pas de filtre date.
- **Resume paie** : DAS estimees (RRQ + RQAP + AE = ~8.21%). Approximatif.
- **Paie CCQ** : calcul complet avec impots progressifs + paliers + plafonds + charges employeur + CCQ 12.5% si construction. Cf. Module 11 pour les details.
- **Periodes paie** : creer -> calculer (regenerable si OUVERTE) -> fermer (irreversible).
- **Export CSV** : 10 colonnes (ID, Employe, Projet, BT, Entree, Sortie, Heures, Type, Notes, Valide).
- **Pas d integration GPS** (geofences existent mais non liees au pointage).
- **Pas de gestion pauses automatique**, pas de detection retard / absence.
- **Pas de bouton Imprimer** sur la fiche de paie.
- **App mobile = table partagee** : les pointages mobiles apparaissent dans l onglet desktop sans indication explicite de la source.

---

**Documentation generee a partir du code** :
- `frontend/src/pages/PointagePage.tsx` (1372 lignes)
- `backend/routers/employees.py` lignes 140-797 (sous-section pointage)
- `backend/routers/payroll.py` (855 lignes — paie CCQ)
- `frontend/src/api/employees.ts` (interface TimeEntry, fonctions CRUD)
- `frontend/src/api/payroll.ts` (interface PayrollEntry, periodes)

**Manuels lies** :
- Module 12 (Bons de Travail — operations sans auto-pointage) — `05-bons-de-travail.md`
- Module 11 (Employes / RH / Pointage — fiche employe + paie CCQ details) — `09-employes.md`
- Module 09 (Projets — heures par projet) — `01-projets.md`
- Module 15 (Factures / Comptabilite — verrouillage facturation, sync depenses) — `07-factures.md`
- Manuel separe : MOBILE_REACT (app mobile pointage chantier)
