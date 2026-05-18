# Module 9 — Employes / RH / Pointage

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/employees.py` (CRUD + pointage + competences), `backend/routers/payroll.py` (paie complete avec DAS Quebec), `backend/routers/gps.py` (geofencing — PAS integre au pointage), `frontend/src/pages/EmployeesPage.tsx` (liste + detail), `frontend/src/pages/PointagePage.tsx` (5 onglets pointage + paie)
> **Tables PostgreSQL** : `employees`, `time_entries`, `competences`, `payroll_runs`, `payroll_entries`, `payroll_periods`, `vehicles`, `gps_locations`, `geofences`

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface Employes + Pointage](#2-interface-employes-pointage)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference (statuts, deductions, calculs)](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Gerer la **base employes**, les **pointages chantier** (time entries) et la **paie complete** d une entreprise de construction quebecoise :
- Fiches employes avec poste, departement, taux horaire, NIP de pointage
- Pointage IN/OUT par employe avec rattachement projet/BT/operation
- Validation des heures par superviseur (`can_approve_timecards`)
- Calcul de paie complet avec deductions a la source (RRQ 6.4%, RQAP 0.494%, AE 1.32%, impots federal et provincial progressifs)
- Charges employeur (RRQ, RQAP, AE, CNESST 1.80%, FSS 1.65%, **CCQ 12.5%** pour secteur construction)
- Heures supplementaires x1.5 au-dela des seuils
- Gestion des cycles de paie (HEBDOMADAIRE / BI_HEBDO / MENSUEL)
- Suivi competences/certifications par employe

### 1.2 5 statuts employe (STATUTS)

Source : `employees.py:48`

`ACTIF` / `CONGE` / `FORMATION` / `ARRET_TRAVAIL` / `INACTIF`

| Statut          | Couleur badge | Inclusion paie | Visible defaut ? |
|-----------------|---------------|----------------|------------------|
| `ACTIF`         | vert          | OUI            | OUI              |
| `CONGE`         | jaune         | NON (a verifier) | OUI            |
| `FORMATION`     | bleu          | NON            | OUI              |
| `ARRET_TRAVAIL` | orange        | NON            | OUI              |
| `INACTIF`       | gris          | NON            | NON (filtre par defaut) |

> La generation paie (`POST /payroll/generate`) ne traite QUE les employes `ACTIF`.

### 1.3 5 types de contrat (TYPES_CONTRAT)

Source : `employees.py:49`

`CDI` / `CDD` / `TEMPORAIRE` / `STAGE` / `APPRENTISSAGE` (defaut `CDI`).

### 1.4 11 departements

Source : `employees.py:42-46`

`CHANTIER`, `STRUCTURE_BETON`, `CHARPENTE_BOIS`, `FINITION`, `MECANIQUE_BATIMENT`, `ELECTRICITE`, `INGENIERIE`, `QUALITE_CONFORMITE`, `ADMINISTRATION`, `COMMERCIAL`, `DIRECTION`.

> **6 departements « construction »** (CCQ applicable) : `CHANTIER`, `STRUCTURE_BETON`, `CHARPENTE_BOIS`, `FINITION`, `MECANIQUE_BATIMENT`, `ELECTRICITE`. Pour ces employes, la cotisation CCQ employeur de 12.5% s applique.

### 1.5 3 cycles de paie (TYPES_PERIODE)

Source : `payroll.py:485-492`

| Cycle           | Seuil heures supp           | Usage typique                    |
|-----------------|-----------------------------|----------------------------------|
| `HEBDOMADAIRE`  | 40h / semaine               | Construction (norme)             |
| `BI_HEBDO`      | 80h / 2 semaines            | Bureau / administration          |
| `MENSUEL`       | 173.33h / mois (40*52/12)   | Cadres, salaire annuel           |

Au-dela du seuil : multiplicateur **1.5x** sur taux horaire (`OVERTIME_MULTIPLIER = 1.5`).

### 1.6 Acces

- Sidebar -> **Employes** (icone Users) -> URL `/employees`
- Sidebar -> **Pointage** (icone Clock) -> URL `/pointage`
- Auto-ouverture employe : `/employees?open={employee_id}`

### 1.7 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD employes et time entries.
- **Validation des heures** : reservee aux employes avec `can_approve_timecards = true` (flag boolean dans la fiche).
- **Aucun mode self-service employe** (pas de portail employe pour pointer ses propres heures depuis son compte).
- Pas de roles formels « Manager / Employe » — toute la logique est dans le flag `can_approve_timecards`.

---

## 2. Interface (Employes + Pointage)

### 2.1 Page `/employees` (liste + detail)

**Layout** : split panel (liste a gauche / detail a droite sur desktop, full-width sur mobile).

#### 2.1.1 Liste employes

Colonnes :
- **Nom** (prenom + nom)
- **Poste** (texte libre)
- **Departement** (badge colore)
- **Statut** (badge : ACTIF / CONGE / FORMATION / ARRET_TRAVAIL / INACTIF)
- **Email**, **Telephone**

Actions globales :
- **+ Nouvel employe** (modale creation)
- **Exporter CSV**
- Recherche (nom, email)
- Filtre departement (dropdown)
- Carte KPI : Total employes, Actifs, par departement

#### 2.1.2 Vue Detail employe (panneau droit)

Affiche :
- Nom complet, poste, departement, statut
- Coordonnees (email, telephone)
- Date d embauche
- Type de contrat (CDI / CDD / etc.)
- **Taux horaire** + **Salaire** (si renseignes)
- Notes
- **NIP de pointage** : badge « Configure » ou « Non configure » (NIP hashe avec bcrypt cote backend)
- **Peut approuver les heures** : badge si `can_approve_timecards = true`

**Section Competences** :
- Liste des competences/certifications de l employe
- Champs : nom competence, niveau, date obtention, statut certifie
- Ajouter / supprimer une competence

**Section Pointages recents** :
- 5 derniers pointages
- Lien vers Pointage pour voir l historique complet

**Boutons** : Modifier, Supprimer.

> **Pas d onglets** dans la vue Detail employe — toutes les infos sont sur une seule vue verticale.

### 2.2 Page `/pointage` (5 onglets)

Source : `PointagePage.tsx:31` — `type TabKey = 'pointages' | 'vue_semaine' | 'par_projet' | 'paie' | 'paie_ccq'`

#### 2.2.1 Onglet « Pointages »

Tableau time entries triables :
- **Employe**
- **Client** (depuis projet associe)
- **Projet**
- **BT Numero** (formulaire BT associe)
- **Operation** (operation BT associee)
- **Punch In** (datetime)
- **Punch Out** (datetime)
- **Heures** (auto-calcule)
- **Validee** (badge OUI/NON)

Filtres :
- Statut : `Valide`, `Non valide`, `Facture`
- Recherche (employe, projet)

Actions par ligne :
- **Valider** (icone CheckCircle, si non validee)
- **Modifier** (icone Edit) -> modale d edition
- **Supprimer** (icone Trash2) avec confirmation

Bouton **+ Nouveau pointage** -> modale creation.

#### 2.2.2 Onglet « Vue semaine »

Vue calendrier hebdomadaire :
- 7 colonnes : Lundi a Dimanche
- Lignes : entries de la semaine groupees par jour
- Total heures par jour + total semaine
- Boutons **Semaine precedente** / **Semaine suivante**

#### 2.2.3 Onglet « Par projet »

Cartes projets expandables :
- En-tete : nom projet, total heures, nombre d employes
- Click pour deplier -> repartition par employe (nom + heures sur ce projet)

#### 2.2.4 Onglet « Paie » (synthese simple)

Vue paie simplifiee (sans DAS detaillees) :
- Filtre periode (defaut : 30 derniers jours)
- Tableau : Employe, Poste, Departement, **Total heures**, Taux horaire, **Brut**, Deductions estimees, **Net**
- Total general en pied de tableau

Endpoint : `GET /employees/payroll-summary?days=30`

#### 2.2.5 Onglet « Paie CCQ » (paie complete avec DAS)

Vue paie complete avec deductions a la source detaillees :

**Gestion des periodes** :
- Bouton **+ Creer periode**
- Selecteur **Periode active** (dropdown)
- Bouton **Generer paie** (declenche `POST /payroll/generate`)
- Bouton **Cloturer periode** -> statut `FERMEE` (irreversible — pas de re-generation)

**Tableau payroll entries** :
- Employe, Departement
- **Heures regulieres** / **Heures supplementaires** (auto-calcule selon seuil periode)
- **Brut** (= taux * regulieres + taux * 1.5 * supp)
- **Total deductions** (impots + cotisations sociales)
- **Salaire net**
- **Charges employeur** (RRQ employeur + RQAP + AE + CNESST + FSS + CCQ si applicable)
- Bouton **Fiche de paie** (icone FileText) -> modale detail complete

**Modale Fiche de paie** :
- En-tete : employe, periode, taux horaire, heures
- Section **Salaire brut** : detail regulier + supp
- Section **Deductions employe** :
  - Impot federal (palier + montant + taux effectif)
  - Impot provincial (palier + montant + taux effectif)
  - RRQ (6.4%)
  - RQAP (0.494%)
  - AE (1.32%)
  - **Total deductions**
- Section **Salaire net**
- Section **Charges employeur** :
  - RRQ employeur (6.4%, miroir)
  - RQAP employeur (0.692%, 1.4x employe)
  - AE employeur (1.848%, 1.4x employe)
  - CNESST (1.80%, fixe)
  - FSS (1.65%)
  - CCQ (12.5%, si departement construction)
  - **Total charges**
- Section **Cout total employeur** = brut + charges

> **Pas de bouton Imprimer fiche de paie** dans cette version. Pour archivage : screenshot ou copie manuelle.

### 2.3 Page Liste vehicules / GPS

URL : `/gps` (cf. module Logistique).

> **Le module GPS gere les vehicules et les geofences**, mais **PAS le pointage employe**. Pas d integration check-in chantier via GPS dans cette version.

---

## 3. Workflows pas-a-pas

### 3.1 Creer un employe

1. Page Employes -> bouton **+ Nouvel employe**.
2. Modale formulaire :
   - **Prenom** (obligatoire)
   - **Nom** (obligatoire)
   - **Email**, **Telephone** (optionnels)
   - **Poste** (texte libre — pas d enum)
   - **Departement** (dropdown 11 valeurs)
   - **Statut** (dropdown 5 valeurs — defaut `ACTIF`)
   - **Type contrat** (dropdown 5 valeurs — defaut `CDI`)
   - **Date embauche** (optionnel)
   - **Salaire** (optionnel — float >= 0)
   - **Taux horaire** (optionnel — float >= 0)
   - **Notes** (optionnel)
   - **NIP code** (optionnel — 4 chiffres, hashe avec bcrypt)
   - **Peut approuver les heures** (checkbox — defaut FALSE)
3. **Enregistrer** -> `POST /employees`.
4. L employe apparait dans la liste avec statut `ACTIF`.

### 3.2 Modifier un employe

1. Vue Detail employe -> bouton **Modifier**.
2. Modale (memes champs).
3. **Enregistrer** -> `PUT /employees/{employee_id}`.

### 3.3 Configurer le NIP de pointage

1. Vue Detail employe -> Modifier -> champ **NIP code** (4 chiffres).
2. Backend hash le NIP avec bcrypt avant stockage (`employees.pin_code_hash`).
3. Le NIP permet a l employe de pointer via une borne tactile chantier (si configuree — UI non documentee dans cette version).

### 3.4 Ajouter une competence/certification

1. Vue Detail employe -> section Competences -> **+ Ajouter competence**.
2. Champs :
   - **Nom competence** (ex. `Carte CCQ`, `RBQ Specialisee`, `Permis classe 5`, `Soudure CWB`)
   - **Niveau** (ex. `Apprenti`, `Compagnon`, `Maitre`)
   - **Date obtention**
   - **Certifie** (boolean — true si certification valide)
3. **Enregistrer** -> POST competence.

### 3.5 Pointer manuellement (creer un time entry)

1. Page Pointage -> onglet **Pointages** -> bouton **+ Nouveau pointage**.
2. Modale :
   - **Employe** (dropdown — obligatoire)
   - **Projet** (dropdown — optionnel)
   - **Punch In** (datetime-local)
   - **Punch Out** (datetime-local)
   - **Notes**
   - **Facturable** (checkbox — defaut TRUE)
3. **Enregistrer** -> `POST /employees/time-entries`.
4. Backend :
   - Si `total_hours` non fourni ET `punch_in` ET `punch_out` : auto-calcul `(punch_out - punch_in).total_seconds() / 3600` (arrondi a 2 decimales).
   - Validation : `punch_out >= punch_in` (sinon HTTP 400).
   - INSERT dans `time_entries`.

### 3.6 Pointer sur un BT (avec operation)

1. Onglet Pointages -> +Nouveau ou Modifier un entry -> dropdown **BT** -> selection BT.
2. Si BT selectionne, dropdown **Operation** se remplit avec les operations du BT.
3. Selection operation -> `formulaire_bt_id` + `operation_id` stockes sur le time entry.
4. Permet ensuite l agregation heures par BT et par operation (Module Bons de Travail — mais sans auto-incrementation des heures reelles d operation, cf. Module 5 BT FAQ).

### 3.7 Modifier un time entry

1. Onglet Pointages -> ligne entry -> icone **Edit** -> modale.
2. Modifier champs (employe, projet, punch_in, punch_out, BT, operation, notes, billable, validated).
3. **Enregistrer** -> `PUT /employees/time-entries/{entry_id}`.
4. Si `punch_in` ou `punch_out` modifies : recalcul auto `total_hours`.

### 3.8 Supprimer un time entry

1. Onglet Pointages -> ligne -> icone **Trash2** -> confirmation.
2. `DELETE /employees/time-entries/{entry_id}`.
3. Hard delete (pas de soft-delete).

### 3.9 Valider (approuver) un time entry

1. Connexion en tant qu employe avec `can_approve_timecards = true`.
2. Onglet Pointages -> ligne non validee -> bouton **Valider**.
3. `PUT /employees/time-entries/{entry_id}/validate`.
4. Backend : SET `validated = TRUE`, `validated_by = current_user_id`, `validated_at = CURRENT_TIMESTAMP`.
5. Le badge passe a « Validee ».

> **Pas d action de bulk validation** (pas de bouton « Valider tous les pointages de la semaine »). Une approbation par entry.

### 3.10 Creer une periode de paie

1. Page Pointage -> onglet **Paie CCQ** -> bouton **+ Creer periode**.
2. Champs :
   - **Date debut**, **Date fin** (dates)
   - **Date paiement** (date prevue de versement)
   - **Numero periode**, **Annee** (numerotation interne)
   - **Type periode** (HEBDOMADAIRE / BI_HEBDO / MENSUEL)
3. **Enregistrer** -> `POST /payroll/periods` -> statut `OUVERTE`.

### 3.11 Generer la paie pour une periode

1. Onglet Paie CCQ -> selectionner periode `OUVERTE` -> bouton **Generer paie**.
2. `POST /payroll/generate` avec `period_id`.
3. Backend :
   - Recupere tous les employes `statut = ACTIF`.
   - Pour chaque employe :
     - Somme `time_entries.total_hours` sur la periode.
     - Split regulier/supp selon seuil periode (40h hebdo / 80h bi / 173.33h mensuel).
     - Appelle `calculate_full_payroll()` :
       - Brut = `taux * regulieres + taux * 1.5 * supp`
       - Calcul DAS (impots + RRQ + RQAP + AE)
       - Calcul charges employeur (RRQ + RQAP + AE + CNESST + FSS + CCQ si applicable)
     - INSERT `payroll_entries`.
   - UPDATE `payroll_runs` avec totaux.
4. Liste payroll entries affichee.

### 3.12 Re-generer une paie (en cas d erreur)

1. Tant que la periode est `OUVERTE` : possible de relancer **Generer paie**.
2. Backend supprime les entries existantes et recree (status BROUILLON).
3. Une fois la periode `FERMEE` : impossible de regenerer.

### 3.13 Cloturer une periode de paie

1. Onglet Paie CCQ -> selectionner periode `OUVERTE` -> bouton **Cloturer periode**.
2. Confirmation -> `PUT /payroll/periods/{period_id}/close`.
3. UPDATE `statut = FERMEE`, `processed_at`, `processed_by`.
4. **Irreversible** : aucun bouton « Reouvrir » dans cette version. Pour corriger, creer une nouvelle periode d ajustement.

### 3.14 Voir la fiche de paie detaillee d un employe

1. Onglet Paie CCQ -> ligne employe -> bouton **Fiche de paie** (icone FileText).
2. `GET /payroll/entries/{entry_id}` -> retourne le detail complet.
3. Modale affiche :
   - Salaire brut (regulier + supp)
   - Toutes les deductions employe avec paliers d impots
   - Salaire net
   - Toutes les charges employeur
   - Cout total employeur
4. Pas de bouton Imprimer/PDF dans cette version — copier-coller manuel ou screenshot.

### 3.15 Exporter les pointages CSV

1. Onglet Pointages -> bouton **Exporter CSV** (haut de page) ou utiliser endpoint :
2. `GET /employees/time-entries/export-csv?date_debut=...&date_fin=...`
3. Telecharge un CSV avec : Employe, Date, Punch In, Punch Out, Heures, Projet, BT, Operation, Validee, Facturable, Notes.

### 3.16 Voir les heures par projet (rapport)

1. Onglet **Par projet** -> liste projets avec total heures.
2. Click sur un projet -> deplie les employes ayant pointe sur ce projet.
3. Endpoint : `GET /employees/time-entries/by-project?project_id=X`.

### 3.17 Vue hebdomadaire (timesheet)

1. Onglet **Vue semaine** -> grille 7 jours.
2. Endpoint : `GET /employees/time-entries/weekly?date_start=YYYY-MM-DD`.
3. Navigation Precedente / Suivante semaine.

---

## 4. Reference

### 4.1 Statuts employe

`["ACTIF", "CONGE", "FORMATION", "ARRET_TRAVAIL", "INACTIF"]` — defaut `ACTIF`.

Source : `employees.py:48`.

### 4.2 Types de contrat

`["CDI", "CDD", "TEMPORAIRE", "STAGE", "APPRENTISSAGE"]` — defaut `CDI`.

### 4.3 Departements

`CHANTIER, STRUCTURE_BETON, CHARPENTE_BOIS, FINITION, MECANIQUE_BATIMENT, ELECTRICITE, INGENIERIE, QUALITE_CONFORMITE, ADMINISTRATION, COMMERCIAL, DIRECTION`.

### 4.4 Cycles de paie et seuils heures supp

| Type periode    | Seuil heures supp | Multiplicateur supp |
|-----------------|-------------------|---------------------|
| `HEBDOMADAIRE`  | **40h / semaine** | x1.5                |
| `BI_HEBDO`      | **80h / 2 sem**   | x1.5                |
| `MENSUEL`       | **173.33h / mois**| x1.5                |

Constante : `OVERTIME_MULTIPLIER = 1.5` (`payroll.py:73`).

### 4.5 Paliers d impots Quebec 2026 (codees en dur)

#### 4.5.1 Federal (`FEDERAL_BRACKETS`)

| Tranche annuelle    | Taux  |
|---------------------|-------|
| 0 - 55 867 $        | 15%   |
| 55 867 - 111 733 $  | 20.5% |
| 111 733 - 154 906 $ | 26%   |
| 154 906 - 220 000 $ | 29%   |
| > 220 000 $         | 33%   |

Montant personnel federal : **16 129 $** (deduit avant calcul).

#### 4.5.2 Provincial Quebec (`PROVINCIAL_BRACKETS`)

| Tranche annuelle    | Taux   |
|---------------------|--------|
| 0 - 49 275 $        | 14%    |
| 49 275 - 98 540 $   | 19%    |
| 98 540 - 119 910 $  | 24%    |
| > 119 910 $         | 25.75% |

Montant personnel provincial : **17 183 $**.

> Le calcul annualise le brut de la periode (multiplie par nombre de periodes/an), applique les paliers, puis deannualise pour la periode courante.

### 4.6 Cotisations sociales employe (DAS)

| Cotisation | Taux    | Plafond annuel | Source           |
|------------|---------|----------------|------------------|
| **RRQ**    | 6.40%   | 68 500 $       | `payroll.py:54`  |
| **RQAP**   | 0.494%  | 94 000 $       | `payroll.py:56`  |
| **AE**     | 1.32%   | 65 700 $       | `payroll.py:58`  |

### 4.7 Charges employeur

| Charge        | Taux   | Source           | Notes                                   |
|---------------|--------|------------------|-----------------------------------------|
| RRQ employeur | 6.40%  | `payroll.py:63`  | Miroir employe                          |
| RQAP employeur| 0.692% | `payroll.py:64`  | 1.4 x employe                           |
| AE employeur  | 1.848% | `payroll.py:65`  | 1.4 x employe                           |
| **CNESST**    | 1.80%  | `payroll.py:66`  | Fixe (varie selon industrie en realite) |
| **FSS**       | 1.65%  | `payroll.py:67`  | Fonds des services de sante             |
| **CCQ**       | 12.50% | `payroll.py:69`  | Si departement construction             |

### 4.8 Endpoints principaux

#### Employes (`/employees`)

| Methode | URL                                       | Role                                    |
|---------|-------------------------------------------|-----------------------------------------|
| GET     | `/employees`                              | Liste paginee + filtres + recherche     |
| POST    | `/employees`                              | Creer                                   |
| GET     | `/employees/{employee_id}`                | Detail (avec competences + recents pointages) |
| PUT     | `/employees/{employee_id}`                | Modifier                                |
| GET     | `/employees/statistics`                   | Stats par statut + departement          |
| GET     | `/employees/payroll-summary?days=30`      | Synthese paie simple                    |

#### Pointage (`/employees/time-entries`)

| Methode | URL                                                     | Role                                  |
|---------|---------------------------------------------------------|---------------------------------------|
| GET     | `/employees/time-entries`                               | Liste filtree (employee_id, project_id, bt_id) |
| POST    | `/employees/time-entries`                               | Creer entry (auto-calcul heures)      |
| PUT     | `/employees/time-entries/{entry_id}`                    | Modifier                              |
| DELETE  | `/employees/time-entries/{entry_id}`                    | Supprimer (hard)                      |
| PUT     | `/employees/time-entries/{entry_id}/validate`           | Valider/approuver                     |
| GET     | `/employees/time-entries/weekly?date_start=YYYY-MM-DD`  | Vue semaine                           |
| GET     | `/employees/time-entries/by-project`                    | Heures groupees par projet            |
| GET     | `/employees/time-entries/export-csv`                    | Export CSV                            |

#### Paie (`/payroll`)

| Methode | URL                                       | Role                                       |
|---------|-------------------------------------------|--------------------------------------------|
| GET     | `/payroll/periods`                        | Liste periodes                             |
| POST    | `/payroll/periods`                        | Creer periode                              |
| PUT     | `/payroll/periods/{period_id}/close`      | Cloturer periode (irreversible)            |
| GET     | `/payroll/calculate/{employee_id}`        | Calcul DAS pour 1 employe (ad hoc)         |
| POST    | `/payroll/generate`                       | Generer paie pour tous ACTIF de la periode |
| GET     | `/payroll/entries`                        | Liste entries avec filtre periode          |
| GET     | `/payroll/entries/{entry_id}`             | Detail fiche de paie                       |

### 4.9 Tables PostgreSQL

| Table              | Role                                            |
|--------------------|-------------------------------------------------|
| `employees`        | Fiches employes (PIN bcrypt, can_approve flag)  |
| `competences`      | Competences/certifications par employe          |
| `time_entries`     | Pointages (employee_id, project_id, bt_id, op_id, punch_in/out, hours, validated) |
| `payroll_periods`  | Periodes de paie (OUVERTE / FERMEE)             |
| `payroll_runs`     | Run de generation paie (totaux)                 |
| `payroll_entries`  | Fiches de paie individuelles                    |
| `vehicles`         | (module GPS — Logistique)                       |
| `gps_locations`    | (module GPS — chantiers, entrepots)             |
| `geofences`        | (module GPS — geofences chantier)               |

### 4.10 Validations & limites

| Regle                                  | Effet                                                  |
|----------------------------------------|--------------------------------------------------------|
| `prenom` ou `nom` vide                 | HTTP 400                                               |
| `statut` hors `STATUTS`                | HTTP 400                                               |
| `type_contrat` hors `TYPES_CONTRAT`    | HTTP 400                                               |
| `salaire < 0` ou `taux_horaire < 0`    | Pydantic refuse (`Field(..., ge=0)`)                   |
| `punch_out < punch_in`                 | HTTP 400 lors de creation/update time entry            |
| Validation par employe sans `can_approve` | (logique frontend uniquement — verifier en prod)    |
| Generer paie sur periode `FERMEE`      | HTTP 400 « Periode fermee »                            |
| Cloturer periode deja FERMEE           | HTTP 400 ou pas d effet                                |

---

## 5. Integrations & FAQ

### 5.1 Integration Projets

- Champ `time_entries.project_id` (optionnel) -> FK `projects.id`.
- L onglet **Pointage** d un projet (Module 1) affiche les heures pointees sur ce projet.
- Cout employe agrege automatiquement dans Module 1 -> onglet Financiers (`getProjectFinancials`).

### 5.2 Integration Bons de Travail

- Champs `time_entries.formulaire_bt_id` + `operation_id` (optionnels) -> FK `formulaires` (BT) + `operations`.
- **PAS d auto-incrementation** des `operations.heures_reelles` depuis Pointage (cf. Module 5 BT FAQ — limitation connue).
- Pour reporter les heures pointees vers les operations BT, **edition manuelle** necessaire dans la modale operation.

### 5.3 Integration Comptabilite (Paie)

- L endpoint `POST /accounting/sync-depenses` agrege les `time_entries` validees par periode -> cree ecritures journal type `SALAIRE` :
  - Debit `5200` (Main d oeuvre directe)
  - Credit `2300` (Salaires a payer)
- Cout = `taux_horaire * SUM(heures)` par employe sur la periode.
- **Pas de lien automatique** entre `payroll_entries` et `journal_entries` — l import comptable se fait via `sync-depenses` independamment de la generation paie CCQ.

### 5.4 Integration GPS / Vehicules

- Module GPS independant (`gps.py`) gere :
  - Vehicules (avec position GPS dernier point, historique 168h max)
  - Locations sauvegardees (chantiers, entrepots)
  - Geofences (zones surveillees, alertes entree/sortie)
- **Pas d integration avec le pointage** : les pointages (time entries) ne declenchent pas et ne consultent pas les positions GPS.
- Pas de check-in/check-out chantier via GPS dans cette version.

### 5.5 Integration Conformite (RBQ / CCQ / CSST)

- Le module Conformite (router `conformite.py` separe) gere :
  - Cartes CCQ employes (numero, classification, validite)
  - Licences RBQ entreprise
  - Attestations CSST/CNESST
- **Pas de lien direct** avec le module Employes — la cotisation CCQ 12.5% s applique selon le `departement` de l employe (heuristique cote payroll), pas selon une carte CCQ valide.

### 5.6 FAQ

**Q : Comment generer les T4 / RL-1 / Releves d emploi ?**
R : **Pas implemente** dans cette version. Les `payroll_entries` contiennent toutes les donnees necessaires (brut annuel, deductions par type) — exporter manuellement ou utiliser un logiciel de paie tiers (Nethris, Desjardins, ADP, etc.) pour generer les declarations annuelles.

**Q : Y a-t-il une application mobile pour le pointage chantier ?**
R : **NON dans cette version**. Aucun endpoint `/mobile/...` ni interface mobile native. Le pointage se fait manuellement via la page Pointage (web) — eventuellement via une borne tactile chantier avec le NIP de l employe (UI a verifier en prod).

**Q : Le pointage se fait-il par GPS automatiquement ?**
R : **NON**. Le module GPS existe (`gps.py`) avec geofences et tracking de vehicules, mais n est PAS integre au pointage. Les time entries sont saisies manuellement (punch_in / punch_out datetime).

**Q : Peut-on gerer les conges payes / vacances ?**
R : **Pas de module dedie**. Le statut `CONGE` existe pour marquer un employe en conge, mais aucun suivi des heures de conges (banque, accumulation, approbation, deduction de paie) n est implemente. Solution actuelle : creer un statut `CONGE` ponctuel ou utiliser le champ `notes`.

**Q : Comment fonctionne l auto-calcul des heures ?**
R : Si vous fournissez `punch_in` ET `punch_out` SANS `total_hours`, le backend calcule automatiquement : `total_hours = (punch_out - punch_in) / 3600` (en heures, arrondi 2 decimales). Validation : `punch_out >= punch_in` (sinon HTTP 400).

**Q : Les pauses sont-elles deduites automatiquement ?**
R : **NON**. L employe doit pointer Punch Out + Punch In a chaque pause (ou les deduire manuellement de `total_hours`). Pas de regle automatique « 30 min de pause non payee si journee > 6h ».

**Q : Comment gerer les heures supplementaires ?**
R : **Auto-calcul** lors de la generation de paie (`POST /payroll/generate`) :
- Le backend somme les heures de la periode par employe.
- Compare au seuil (40h hebdo / 80h bi / 173.33h mensuel).
- Heures > seuil = supplementaires, payees a 1.5x.
- Saisie manuelle non requise — basee uniquement sur `total_hours` des time entries.

**Q : Le NIP de pointage permet-il de pointer depuis un kiosque chantier ?**
R : Le NIP est stocke (hashe bcrypt) sur `employees.pin_code_hash`, ce qui suggere une UI kiosque. **L UI kiosque n a pas ete documentee dans cette refonte** — verifier en prod si une page `/kiosk` ou similaire existe.

**Q : Tous les employes peuvent-ils approuver les heures ?**
R : NON. Seuls les employes avec `can_approve_timecards = true` voient le bouton **Valider** sur les time entries. La logique exacte d enforcement backend devrait etre verifiee (cote frontend la valisation est gardee, cote backend pas explicit middleware visible).

**Q : Les paliers d impots sont-ils mis a jour chaque annee ?**
R : NON automatiquement. Les paliers 2026 sont **codes en dur** dans `payroll.py:36-52`. Pour mettre a jour pour 2027+, modifier le code et redeployer.

**Q : Les charges CCQ s appliquent a tous les employes ?**
R : NON. La charge CCQ 12.5% s applique uniquement aux employes dont le `departement` est dans la liste construction (`CHANTIER`, `STRUCTURE_BETON`, `CHARPENTE_BOIS`, `FINITION`, `MECANIQUE_BATIMENT`, `ELECTRICITE`). Pour les autres departements (administration, commercial, direction), CCQ = 0.

**Q : Comment corriger une fiche de paie deja generee ?**
R : Si la periode est `OUVERTE` : modifier les time entries -> relancer **Generer paie** (les entries sont supprimees et recreees). Si la periode est `FERMEE` : creer une nouvelle periode d ajustement avec une seule entry corrective.

**Q : Les time entries cloturees / facturees sont-elles modifiables ?**
R : Pas de blocage dur. Le champ `is_billed` indique qu un entry a ete inclus dans une facturation, mais l UI peut quand meme le modifier. Bonne pratique : ne pas modifier les entries facturees pour preserver la coherence comptable.

**Q : Y a-t-il un calendrier visuel des affectations chantier ?**
R : **NON**. Pas de vue calendrier des employes par chantier dans cette version. La vue **Par projet** dans Pointage donne une vue agregee post-facto (qui a pointe ou) mais pas pre-affectation.

**Q : Comment exporter la liste des employes ?**
R : Page Employes -> bouton **Exporter CSV** en haut de page. Telecharge un CSV avec tous les champs employes (sans NIP hash).

**Q : Le module gere-t-il les sous-traitants ?**
R : NON via le module Employes. Les sous-traitants sont geres comme des `companies` type `SOUS_TRAITANT` (Module CRM). Les heures de sous-traitance sont saisies via les Bons de Travail (champ `fournisseur` sur operation).

---

## 6. Recap one-pager

- **5 statuts** : ACTIF (defaut, seul inclus en paie) / CONGE / FORMATION / ARRET_TRAVAIL / INACTIF.
- **5 types contrat** : CDI (defaut) / CDD / TEMPORAIRE / STAGE / APPRENTISSAGE.
- **11 departements** dont **6 construction** (CCQ 12.5%) : CHANTIER / STRUCTURE_BETON / CHARPENTE_BOIS / FINITION / MECANIQUE_BATIMENT / ELECTRICITE.
- **3 cycles paie** : HEBDOMADAIRE 40h / BI_HEBDO 80h / MENSUEL 173.33h, supp x1.5.
- **DAS Quebec 2026** : RRQ 6.4% (max 68 500$), RQAP 0.494% (max 94 000$), AE 1.32% (max 65 700$), impot federal progressif 15-33%, provincial 14-25.75%.
- **Charges employeur** : RRQ 6.4% + RQAP 0.692% + AE 1.848% + CNESST 1.80% + FSS 1.65% + CCQ 12.5% (si construction).
- **Auto-calcul heures** : `(punch_out - punch_in) / 3600` si `total_hours` non fourni.
- **5 onglets Pointage** : Pointages / Vue semaine / Par projet / Paie (simple) / Paie CCQ (complete avec DAS).
- **Validation heures** : reservee aux employes avec `can_approve_timecards = true`.
- **NIP pointage** : 4 chiffres hashe bcrypt (UI kiosque a verifier).
- **Periode FERMEE** : irreversible, pas de regeneration.
- **Pas de T4/RL-1/Releve emploi** generes automatiquement.
- **Pas de mobile app** pour pointage.
- **Pas de GPS check-in/out** (geofences existent mais non integres pointage).
- **Pas de gestion conges** complete (statut CONGE seulement, sans banque heures).
- **Pas de calendrier d affectations** chantier.

---

**Documentation generee a partir du code** : `employees.py`, `payroll.py`, `gps.py` (info GPS), `EmployeesPage.tsx`, `PointagePage.tsx`.

**Manuels lies** :
- Module 1 (Projets — heures par projet) — `01-projets.md`
- Module 5 (Bons de Travail — operations sans auto-pointage) — `05-bons-de-travail.md`
- Module 7 (Comptabilite — sync-depenses salaires) — `07-factures.md`
- Module 28 (Administration — RBQ/CCQ/CNESST) — `14-administration.md`
