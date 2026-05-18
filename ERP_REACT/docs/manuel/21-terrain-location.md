# Module 21 — Location (Equipements + Pret de main-d oeuvre)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/secondary.py` section `/rental/*` (lignes 3596-5381, 27 endpoints), `frontend/src/pages/LocationPage.tsx` (1757 lignes, 6 onglets), `frontend/src/api/location.ts`
> **Tables PostgreSQL** : `location_items`, `location_contrats`, `location_contrat_lignes`, `location_retours`, `employee_location`, `location_contrats_employes`, `location_employes_heures`
> **Cadrage** : module de **location commerciale d equipements** (excavatrices, grues, nacelles, etc.) **a des clients**, plus **pret de main-d oeuvre** (employes loues a un autre entrepreneur). Distinct du Module 19 Immobilier (location residentielle), Module 10 Magasin (inventaire interne) et Module 22 Maintenance (entretien equipements).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (6 onglets)](#2-interface-6-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference (champs, statuts, calculs)](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Gerer le cycle complet de **location commerciale** dans une entreprise de construction :

- **Catalogue** d equipements louables avec etat, tarification multi-periode, caution, assurance.
- **Contrats** de location (clients entreprises/contacts) avec lignes detaillees, calcul automatique HT + TPS + TVQ + total, gestion de la caution.
- **Retours** d equipements avec inspection comparative (etat avant/apres), calcul des frais (reparation, nettoyage, retard).
- **Pret de main-d oeuvre** : configuration des employes louables avec metier CCQ, taux horaire/journalier, contrats de pret, saisie des heures.
- **Statistiques** : repartition par statut, par etat, top clients par revenu.
- **5 endpoints IA Claude** : chat, recommandation, analyse contrat, checklist, comparaison location-vs-achat.

### 1.2 Ce que le module ne fait PAS

> **Important** : focalise sur location commerciale d equipements (sortie/retour avec dates) et pret de main-d oeuvre. Il **n implemente pas** :

- Location de logements / unites residentielles (Module 19 Immobilier).
- Maintenance des equipements (Module 22 Maintenance).
- Reservations avec calendrier visuel d occupation par equipement.
- **Detection automatique des conflits** de reservation (chevauchements non detectes).
- **Generation automatique de facture** : statut `FACTURE` est juste un label, aucune facture creee dans Module 7.
- **Suivi GPS / IoT**, **photos** des equipements, **portail client**, **notifications** automatiques.
- **Tarification degressive automatique** : colonnes DDL existent mais non exposees ni calculees.
- **Workflow d approbation** des contrats avant `EN_COURS`.
- **Lien avec la paie** : heures saisies non propagees dans Module 9 (`payroll_entries`).

### 1.3 Acces & permissions

- Sidebar -> **Location** (icone HardHat) — `Sidebar.tsx:73`.
- URL : `/location`. Onglet par defaut : Tableau de bord.
- Tous les utilisateurs authentifies du tenant peuvent CRUD toutes les entites Location.
- **Suppression** :
  - Item louable : soft-delete (`actif = FALSE`), bloquee si dans contrat actif (BROUILLON/EN_COURS/ACTIF/RESERVE) -> HTTP 400.
  - Contrat : autorisee uniquement pour `BROUILLON` ou `ANNULE` -> cascade sur lignes + retours. HTTP 400 sinon.
- **IA** : guarde par `check_ai_guard()` + `_check_credits()`. HTTP 402 si solde insuffisant, HTTP 403 si acces refuse, HTTP 503 si module non disponible.
- Pas de roles dedies (gerant location, inspecteur retour, livreur).

---

## 2. Interface (6 onglets)

Source : `LocationPage.tsx:172-179`.

| # | Cle              | Label              | Icone        | Contenu principal                                                |
|---|------------------|--------------------|--------------|-------------------------------------------------------------------|
| 1 | `dashboard`      | Tableau de bord    | BarChart3    | KPIs (4 cards) + 5 derniers contrats + repartition par categorie |
| 2 | `catalogue`      | Catalogue (N)      | HardHat      | CRUD items louables, filtres categorie/etat/recherche            |
| 3 | `contrats`       | Contrats (N)       | FileText     | Liste + creation + detail (lignes, totaux, changement statut)    |
| 4 | `retours`        | Retours            | RotateCcw    | Contrats actifs + lignes non retournees + retours completes      |
| 5 | `employes`       | Employes           | Users        | 4 sous-onglets : Tableau de bord, Employes, Contrats, Heures     |
| 6 | `statistiques`   | Statistiques       | ClipboardList | KPIs (5 cards) + repartitions + top 10 clients par revenu       |

> Le compteur `(N)` est dynamique base sur `items.length` et `contracts.length`.

### 2.1 Tableau de bord

Source : `LocationPage.tsx:259-321`.

**KPIs (4 StatCards pastel)** :

- **Equipements** : `items.length`.
- **Disponibles** : items avec `disponible !== false` ET `etat !== 'REPARATION'`.
- **Contrats actifs** : `stats.actifs` (backend) ou fallback comptage local.
- **Montant total** : `stats.montantTotal`.

**Sections** : 5 derniers contrats + Equipements par categorie (aggregation locale).

### 2.2 Catalogue

Source : `LocationPage.tsx:325-560`.

**Toolbar** : bouton **Ajouter un item**, recherche libre (nom + N/S + marque + modele + categorie), filtres Categorie (10 valeurs) et Etat (6 valeurs).

**Tableau** : Equipement, N/S, Categorie, Etat (Badge), Dispo, Tarif/jour, Tarif/sem, Tarif/mois, Actions. Tri via `useSortable`. Vue mobile : cards condensees.

**Modale creation/modification** :

- **Identification** : Nom *, Numero serie, Categorie (dropdown), Etat (dropdown).
- **Caracteristiques** : Marque, Modele, Annee fabrication, Quantite totale.
- **Valeurs** : Valeur d achat, Valeur de remplacement.
- **Tarification** : Tarif journalier / hebdomadaire / mensuel (tous optionnels).
- **Caution & assurance** : Caution requise, Assurance requise (checkbox).
- **Texte libre** : Description, Conditions de location, Notes.

> **Champs DDL non exposes** : `tarif_degressif_actif`, `seuil_degressif_jours`, `reduction_degressif_pourcent` (logique non implementee), `quantite_disponible` (calcul auto).

**Suppression** : confirmation JS, soft-delete cote backend (`actif=FALSE`, `disponible=FALSE`). HTTP 400 si item dans contrat actif.

### 2.3 Contrats

Source : `LocationPage.tsx:564-935`.

**Toolbar** : bouton **Nouveau contrat**, recherche libre, filtre Statut (8 valeurs : Tous / Brouillon / Reserve / En cours / Retourne / Facture / Annule / En retard).

**Tableau** : Contrat (`LOC-NNNNN`), Client, Debut, Fin prevue, Statut (Badge), Montant TTC, Detail. Cliquer sur la ligne ouvre le detail.

**Modale creation contrat** :

- **Client** * (texte libre, stocke dans `client_nom_cache`).
- **Type de client** : `ENTREPRISE` / `CONTACT` (informatif).
- **Dates** : debut (defaut aujourd hui si vide), fin prevue.
- **Type de duree** : `JOUR` / `SEMAINE` / `MOIS` / `FORFAIT`.
- **Nombre de periodes**, **Lieu de livraison**.
- **Conditions particulieres**, **Notes**.

> Le numero contrat est genere automatiquement au pattern `LOC-NNNNN` (5 chiffres avec padding zeros). Le contrat est cree au statut `BROUILLON`.
>
> Caution, responsable_id, project_id, client_company_id, client_contact_id existent en DDL et acceptes par le POST mais **non saisis dans la modale UI**.

**Modale detail (`size="xl"`)** :

- **Header** : Client, Periode, Statut (select editable inline), Lieu livraison, Conditions.
- **Lignes** : tableau (Item, Qte, Tarif, Type, Remise, Montant, Supprimer).
- **Ajouter une ligne** (formulaire inline) : Equipement (dropdown), Quantite, Tarif unitaire, Type tarif, Remise %.
- **Totaux** : Sous-total HT, TPS (5%), TVQ (9.975%), Total TTC.
- **Supprimer ce contrat** : visible uniquement si `BROUILLON` ou `ANNULE`.

> Le changement de statut declenche un `PUT /rental/contracts/{id}` puis refetch detail. **Pas de validation des transitions** : n importe quel statut peut etre choisi.

### 2.4 Retours

Source : `LocationPage.tsx:939-1166`.

**Section 1 - Contrats actifs en attente** : filtre local statut IN (ACTIF, EN_COURS, RESERVE). Bouton **Voir les lignes** charge le detail. Pour chaque ligne avec `dateRetourReelle` non remplie : bouton **Enregistrer retour**.

**Section 2 - Retours completes** : tableau (Contrat, Item, Date retour, Etat avant, Etat apres, Frais total = reparation+nettoyage+retard).

**Modale inspection retour** :

- Etat sortie (Badge readonly).
- **Etat apres retour** (5 valeurs sans NEUF).
- **Dommages constates** (textarea).
- **Frais reparation / nettoyage / retard** ($).
- **Commentaires**.

> Le `POST /rental/returns` met a jour la ligne (`date_retour_reelle = NOW()`, `etat_retour`) et **passe le contrat a `RETOURNE` automatiquement** si toutes les lignes sont retournees. Sinon le contrat reste dans son statut courant.

### 2.5 Employes (4 sous-onglets)

Source : `LocationPage.tsx:1170-1638`. Implemente la **location de main-d oeuvre** (employe « prete » a un autre entrepreneur). Distinct de Module 9.

#### 2.5.1 Tableau de bord

6 KPIs : Total employes, En location, Disponibles, Contrats actifs, Heures totales, Montant facture (source `GET /rental/employees/stats`).

#### 2.5.2 Employes

Liste tabulaire des employes configures, filtre par metier CCQ (12 valeurs). Colonnes : Nom, Metier, Statut location, Taux horaire/journalier, Configurer.

**Modale Configurer** : Disponible pour location (checkbox), Statut location, Metier principal (12 valeurs CCQ : Charpentier-menuisier, Electricien, Plombier, Soudeur, Operateur equipement lourd, Grutier, Briqueteur-macon, Peintre, Mecanicien de chantier, Manoeuvre, Contremaitre, Autre), Taux horaire/journalier, Notes.

> Liste alimentee par `employee_location` JOIN `employees`. Si un employe n a jamais ete configure, il **n apparait pas** — il faut creer la fiche via `PUT /rental/employees/{id}/config` (UPSERT). **Limitation UI** : pas de bouton « Ajouter un employe a la location ».

#### 2.5.3 Contrats

Liste des contrats de pret (numero `EMP-NNNNN`). Colonnes : Numero, Employe, Statut, Dates, Tarif (avec type), Heures P/R, Montant facture, dropdown statut.

**Modale Nouveau contrat employe** : Employe * (filtre par disponible), Date debut * + Date fin prevue *, Type tarif, Tarif unitaire, Heures prevues, Lieu travail, Description mission, Notes.

> Statuts : `BROUILLON` / `EN_COURS` / `TERMINE` / `FACTURE` / `ANNULE`.
>
> **Synchronisation statut employe** (`secondary.py:4729-4740`) : contrat -> `EN_COURS`/`ACTIF` passe l employe a `EN_LOCATION` ; contrat -> `TERMINE`/`ANNULE`/`FACTURE` repasse l employe a `DISPONIBLE`.

#### 2.5.4 Heures

**Formulaire** : Contrat employe * (filtre par EN_COURS/ACTIF), Date de travail *, Heures normales / supplementaires (au moins une > 0), Description des taches.

**Saisies recentes** : tableau local en memoire (20 dernieres saisies) — feedback UI seulement.

> A chaque saisie, le backend incremente `heures_reelles` du contrat : `heures_reelles = COALESCE(heures_reelles, 0) + total_heures`. **Pas de calcul automatique du `montant_facture`**.

### 2.6 Statistiques

Source : `LocationPage.tsx:1642-1757`.

**5 KPIs** : Total contrats, Actifs, Termines (TERMINE+RETOURNE), Equipements loues (count distinct sur lignes des contrats actifs), Revenu total.

**Repartitions** : Contrats par statut + Equipements par etat (barres de progression).

**Top 10 clients par revenu** : aggregation locale par `clientNomCache`, somme `montantTotal`.

---

## 3. Workflows pas-a-pas

### 3.1 Creer un equipement louable

1. Onglet **Catalogue** -> bouton **Ajouter un item**.
2. Saisir **Nom** *, choisir **Categorie** (10 valeurs : Excavatrice, Grue, Chargeuse, Compacteur, Echafaudage, Betonniere, Generatrice, Nacelle, Outil, Autre).
3. Saisir N/S, Marque, Modele, Annee fabrication.
4. Choisir **Etat** (NEUF / EXCELLENT / BON / ACCEPTABLE / USURE / REPARATION).
5. Saisir **Quantite totale** (defaut 1) — le backend met `quantite_disponible = quantite_totale` automatiquement.
6. Renseigner les tarifs (journalier, hebdomadaire, mensuel — tous optionnels).
7. Saisir Valeur d achat / remplacement (utiles pour assurance).
8. Indiquer **Caution requise** ($) et cocher **Assurance requise** si applicable.
9. **Creer**.

> `POST /rental/items` retourne `{ id, message }`. L item est immediatement actif et disponible.

### 3.2 Creer un contrat de location

1. Onglet **Contrats** -> bouton **Nouveau contrat**.
2. Saisir **Client** * (texte libre dans `client_nom_cache`).
3. Choisir **Type de client** (ENTREPRISE / CONTACT — informatif).
4. **Date debut** (defaut aujourd hui si vide), **Date fin prevue**.
5. **Type de duree** + **Nombre de periodes**.
6. **Lieu de livraison**, **Conditions particulieres**, **Notes**.
7. **Creer**.

> `POST /rental/contracts` retourne `{ id, numero_contrat: "LOC-NNNNN", message }`. Statut initial `BROUILLON`.

### 3.3 Ajouter des lignes a un contrat

1. Cliquer sur la ligne dans le tableau -> ouverture detail.
2. Section **Ajouter une ligne** : choisir Equipement (dropdown), Quantite (>= 1), Tarif unitaire (par periode), Type tarif (JOUR/SEMAINE/MOIS/FORFAIT), Remise % (0-100).
3. **Ajouter**.

> Le backend calcule :
> - `duree = _compute_ligne_duree(date_sortie, date_retour_prevue, tarif_type, fallback=duree_nombre)`
>   - JOUR : `delta_jours`
>   - SEMAINE : `ceil(delta_jours / 7)`
>   - MOIS : `ceil(delta_jours / 30)`
>   - Sinon : `max(1, fallback)`
> - `montant_ligne = round(tarif_unitaire * quantite * duree * (1 - remise/100), 2)`
>
> Apres ajout, `_recalculate_contrat_totaux` met a jour HT, TPS (5%), TVQ (9.975%) et total du contrat.

### 3.4 Modifier le statut d un contrat

1. Ouvrir le detail. Dans le header, dropdown **Statut** -> choisir parmi BROUILLON / RESERVE / EN_COURS / RETOURNE / FACTURE / ANNULE / EN_RETARD.
2. Modification appliquee immediatement (`PUT /rental/contracts/{id}`).

> **Pas de validation des transitions** : sequence logique recommandee BROUILLON -> RESERVE -> EN_COURS -> RETOURNE -> FACTURE.
>
> **Auto-transition** : passage a `RETOURNE` automatiquement quand toutes les lignes ont une `date_retour_reelle`.

### 3.5 Enregistrer un retour d equipement

1. Onglet **Retours** -> reperer un contrat actif.
2. Cliquer **Voir les lignes**.
3. Pour chaque ligne non retournee, cliquer **Enregistrer retour**.
4. Modale **Inspection** : Etat apres (5 valeurs sans NEUF), Dommages constates, Frais reparation / nettoyage / retard, Commentaires.
5. **Enregistrer le retour**.

> Le backend (`POST /rental/returns`) :
> - Insere une ligne dans `location_retours`.
> - Met a jour la ligne : `date_retour_reelle = NOW()`, `etat_retour`.
> - Si TOUTES les lignes ont `date_retour_reelle` -> contrat passe a `RETOURNE` + `date_fin_reelle = NOW()`.
> - Reponse inclut `contrat_complet: true/false`.

### 3.6 Configurer un employe pour location

1. Onglet **Employes** -> sous-onglet **Employes**.
2. Cliquer **Configurer** pour un employe.
3. Modale : Disponible pour location, Statut, Metier principal (12 CCQ), Taux horaire/journalier, Notes.
4. **Enregistrer**.

> `PUT /rental/employees/{id}/config` est un **UPSERT**. Pour un employe absent de la liste, il faut connaitre l `employee_id` (cf. Module 9) et appeler l API directement la premiere fois.

### 3.7 Creer un contrat de pret de main-d oeuvre

1. Onglet **Employes** -> sous-onglet **Contrats** -> bouton **Nouveau contrat employe**.
2. Choisir **Employe** * (filtre par disponible), **Date debut** *, **Date fin prevue** *.
3. Type de tarif + Tarif unitaire + Heures prevues.
4. Lieu de travail, Description mission, Notes.
5. **Creer** -> `POST /rental/employees/contracts` retourne `{ id, numero_contrat: "EMP-NNNNN" }`.

> Pas de calcul automatique du `montant_estime_ht` cote backend (champ DDL existe mais non rempli par l endpoint create).

### 3.8 Saisir des heures

1. Onglet **Employes** -> sous-onglet **Heures**.
2. Choisir **Contrat employe** * (filtre EN_COURS/ACTIF), Date de travail *, Heures normales / supplementaires (au moins une > 0), Description.
3. **Enregistrer**.

> Le backend incremente `heures_reelles` du contrat (`COALESCE(heures_reelles, 0) + total_heures`). Le `montant_facture` reste a saisir manuellement via PUT.

### 3.9 Activer un contrat employe (sync statut)

1. Onglet **Contrats** (employes) -> dropdown statut -> **En cours**.
2. Backend passe le contrat ET l `employee_location` a `EN_LOCATION` automatiquement.

> A la fin : passer a TERMINE/ANNULE/FACTURE -> employe repasse a `DISPONIBLE`.

### 3.10 Supprimer un contrat (BROUILLON ou ANNULE)

1. Ouvrir le detail.
2. Si statut = BROUILLON ou ANNULE, le bouton **Supprimer ce contrat** est visible.
3. Confirmer (window.confirm).

> Cascade delete : lignes + retours + contrat. Pour les autres statuts, alternative : passer le contrat a `ANNULE` puis supprimer.

### 3.11 Recommander des equipements pour un projet (IA)

`POST /rental/ia/recommander` avec `{ description_projet, budget?, duree_jours? }` -> Claude **Opus** retourne JSON (`equipements_essentiels`, `equipements_optionnels`, `cout_estime`, `conseils`). Couts deduits des credits IA (markup 30%).

### 3.12 Analyser un contrat avec IA

`POST /rental/ia/analyser-contrat` avec `{ contrat_id }`. Le backend recupere le contrat + lignes (avec `item_nom`, `item_categorie`) et appelle Claude **Opus** -> JSON : `score_contrat (0-100)`, `resume`, `points_forts`, `risques`, `recommandations`, `analyse_tarification`, `duree_optimale_suggeree`.

### 3.13 Generer une checklist d inspection (IA)

`POST /rental/ia/checklist` avec `{ equipement_type, duree_location }` -> Claude **Sonnet** retourne markdown : checklist couvrant inspection pre-location, verification, inspection retour, securite CNESST, documents requis, certifications operateur.

### 3.14 Comparer location vs achat (IA)

`POST /rental/ia/location-vs-achat` avec `{ equipement, prix_achat, tarif_location_jour, utilisation_jours_an }` -> Claude **Sonnet** retourne JSON : `recommandation` (ACHAT/LOCATION), `seuil_rentabilite_jours`, `cout_annuel_location`, `cout_annuel_achat`, `economie_annuelle`, `analyse_5_ans`, `facteurs_decisifs`, `conclusion`.

### 3.15 Chat IA contextuel

`POST /rental/ia/chat` avec `{ question, context? }` -> Claude **Sonnet** repond en streaming. Utile pour questions ouvertes sur tarification, certifications, normes CNESST.

---

## 4. Reference

### 4.1 Statuts par entite

| Entite              | Statuts (verbatim)                                                                              | Defaut       |
|---------------------|--------------------------------------------------------------------------------------------------|--------------|
| Item louable        | `actif` (bool) + `disponible` (bool) + `etat` (NEUF / EXCELLENT / BON / ACCEPTABLE / USURE / REPARATION) | `actif=TRUE`, `disponible=TRUE`, `etat='BON'` |
| Contrat location    | `BROUILLON`, `RESERVE`, `EN_COURS`, `RETOURNE`, `FACTURE`, `ANNULE`, `EN_RETARD` (frontend ajoute aussi `ACTIF`) | `BROUILLON` |
| Employe location    | `DISPONIBLE`, `EN_LOCATION`, `INDISPONIBLE`, `EN_CONGE`                                          | `DISPONIBLE` |
| Contrat employe     | `BROUILLON`, `EN_COURS`, `TERMINE`, `FACTURE`, `ANNULE` (frontend accepte aussi `ACTIF`)         | `BROUILLON` |

### 4.2 Categories d equipement (UI)

10 valeurs hardcodees (`LocationPage.tsx:46-58`) :

`Excavatrice`, `Grue`, `Chargeuse`, `Compacteur`, `Echafaudage`, `Betonniere`, `Generatrice`, `Nacelle`, `Outil`, `Autre`.

> Le champ `categorie` accepte n importe quelle chaine cote DDL. La liste UI est juste une suggestion.

### 4.3 Etats d equipement

| Etat        | Couleur Badge | Indication                                |
|-------------|---------------|-------------------------------------------|
| `NEUF`      | green         | Equipement neuf jamais utilise            |
| `EXCELLENT` | green         | Tres bon etat, presque neuf               |
| `BON`       | blue          | Etat normal, fonctionnel sans defaut      |
| `ACCEPTABLE`| yellow        | Usure visible mais fonctionnel            |
| `USURE`     | yellow        | Usure marquee, prochain remplacement      |
| `REPARATION`| red           | En reparation, non disponible             |

### 4.4 Types de tarifs (TARIF_TYPES)

| Code      | Label       | Calcul duree                        |
|-----------|-------------|-------------------------------------|
| `JOUR`    | Par jour    | Delta jours dates                   |
| `SEMAINE` | Par semaine | `math.ceil(delta_jours / 7)`        |
| `MOIS`    | Par mois    | `math.ceil(delta_jours / 30)`       |
| `FORFAIT` | Forfait     | Quantite manuelle (fallback duree)  |

> Le code backend mentionne aussi `HEURE` (`secondary.py:4101`) mais absent du dropdown UI.

### 4.5 Schema des tables principales

#### `location_items` (DDL `secondary.py:976-1006`)

Champs principaux : `id`, `nom`*, `description`, `categorie`, `numero_serie`, `marque`, `modele`, `annee_fabrication`, `etat` (defaut `BON`), `disponible` (defaut TRUE), `quantite_totale`/`quantite_disponible` (defaut 1), `valeur_achat`/`valeur_remplacement`, `tarif_journalier`/`tarif_hebdomadaire`/`tarif_mensuel`, `caution_requise` (defaut 0), `assurance_requise` (defaut FALSE), `conditions_location`, `notes`, `actif` (defaut TRUE — soft-delete).

> **Champs DDL non utilises** : `tarif_degressif_actif`, `seuil_degressif_jours`, `reduction_degressif_pourcent` (logique non implementee).
>
> `quantite_disponible` est initialisee = `quantite_totale` au CREATE.

#### `location_contrats` (DDL `secondary.py:1008-1039`)

Champs principaux : `id`, `numero_contrat` UNIQUE (format `LOC-NNNNN`), `client_type` (defaut `ENTREPRISE`), `client_company_id`/`client_contact_id`/`client_nom_cache`, `project_id`, `responsable_id`, `statut` (defaut `BROUILLON`), `date_debut`/`date_fin_prevue`/`date_fin_reelle`, `duree_type` (defaut `JOUR`)/`duree_nombre`, `montant_ht`/`montant_tps`/`montant_tvq`/`montant_total` (recalcules), `taux_tps` (5.0)/`taux_tvq` (9.975) — **stockes mais non utilises**, `caution_montant`/`caution_recue`, `conditions_particulieres`, `lieu_livraison`/`lieu_retour`, `notes`.

> `client_company_id`, `client_contact_id`, `project_id`, `responsable_id` sont des FK informatives **non saisies dans la modale UI**.
>
> `date_fin_reelle` est auto-rempli quand le contrat passe a `RETOURNE`.

#### `location_contrat_lignes`

Champs : `id`, `contrat_id`*, `location_item_id`*, `quantite` (defaut 1), `tarif_unitaire`, `tarif_type` (defaut `JOUR`), `remise_pourcent` (0-100), `montant_ligne` (recalcule), `date_sortie`/`date_retour_prevue`/`date_retour_reelle`, `etat_sortie`/`etat_retour`, `notes_sortie`/`notes_retour`.

> Pas de FK explicite cote DDL.

#### Autres tables

- `location_retours` : audit log des retours (contrat_id, ligne_id, location_item_id, date_retour, etat_avant/apres, dommages, frais_reparation/nettoyage/retard, commentaires).
- `employee_location` : config par employe (UNIQUE `employee_id`, disponible_location, statut_location, metier_principal, taux_horaire/journalier, certifications_json, notes).
- `location_contrats_employes` : contrats pret main-d oeuvre (numero `EMP-NNNNN`, employee_id, dates, tarif, heures_prevues/reelles, montant_estime_ht/facture, lieu_travail, description_mission).
- `location_employes_heures` : saisies quotidiennes (contrat_id, date_travail, heures_normales/supplementaires, description_taches, valide).

### 4.6 Calcul des montants (formules)

```
duree = _compute_ligne_duree(date_sortie, date_retour_prevue, tarif_type, fallback=duree_nombre)
  - Si dates fournies et delta_jours > 0:
    - JOUR: delta_jours
    - SEMAINE: ceil(delta_jours / 7)
    - MOIS: ceil(delta_jours / 30)
  - Sinon: max(1, fallback)

montant_ligne = round(tarif_unitaire * quantite * duree * (1 - remise_pourcent/100), 2)

montant_ht (contrat) = SUM(montant_ligne) sur lignes
montant_tps = round(montant_ht * 0.05, 2)
montant_tvq = round(montant_ht * 0.09975, 2)
montant_total = round(montant_ht + montant_tps + montant_tvq, 2)
```

> **Note** : les taux TPS/TVQ sont **hardcodes** (`0.05` et `0.09975`) dans `_recalculate_contrat_totaux`, **independamment** des colonnes `taux_tps` et `taux_tvq` qui sont stockees mais non utilisees.

### 4.7 Endpoints (27 au total)

#### Items (4)

| Endpoint                      | Description                                              |
|-------------------------------|----------------------------------------------------------|
| `GET /rental/items`           | Liste paginee + filtres `categorie`, `etat`, `disponible` |
| `POST /rental/items`          | Creation                                                  |
| `PUT /rental/items/{id}`      | Mise a jour (whitelist `_ALLOWED_ITEM_COLS`)             |
| `DELETE /rental/items/{id}`   | Soft-delete (bloquee si dans contrat actif)              |

#### Contrats (5) + Lignes (3)

| Endpoint                                                | Description                                          |
|---------------------------------------------------------|------------------------------------------------------|
| `GET /rental/contracts`                                 | Liste paginee + filtre `statut`                      |
| `POST /rental/contracts`                                | Creation (auto-numero `LOC-NNNNN`)                   |
| `GET /rental/contracts/{id}`                            | Detail avec lignes + `item_nom`                      |
| `PUT /rental/contracts/{id}`                            | Maj (whitelist `_ALLOWED_CONTRAT_COLS`)              |
| `DELETE /rental/contracts/{id}`                         | Cascade delete (BROUILLON/ANNULE seulement)          |
| `POST /rental/contracts/{id}/lignes`                    | Ajout ligne + recalc totaux                          |
| `PUT /rental/contracts/{id}/lignes/{ligne_id}`          | Maj ligne + recalc montant_ligne                     |
| `DELETE /rental/contracts/{id}/lignes/{ligne_id}`       | Suppression + recalc totaux                          |

#### Retours (2) + Stats (1)

| Endpoint                  | Description                                                                |
|---------------------------|----------------------------------------------------------------------------|
| `POST /rental/returns`    | Creation retour + maj ligne + auto-`RETOURNE` si toutes lignes retournees  |
| `GET /rental/returns`     | Liste avec jointures contrat + item                                        |
| `GET /rental/statistics`  | Total, actifs, par statut, montant HT/total, equipements_loues             |

#### Employes (4 lecture/config + 3 contrats employes)

| Endpoint                                          | Description                              |
|---------------------------------------------------|------------------------------------------|
| `GET /rental/employees`                           | Liste avec filtres `disponible_only`, `metier` |
| `PUT /rental/employees/{id}/config`               | UPSERT config employe                    |
| `GET /rental/employees/contracts`                 | Liste contrats employes (filtres)        |
| `GET /rental/employees/stats`                     | Stats globales pret main-d oeuvre        |
| `POST /rental/employees/contracts`                | Creation (auto-numero `EMP-NNNNN`)       |
| `PUT /rental/employees/contracts/{id}`            | Maj + sync statut employe                |
| `POST /rental/employees/contracts/{id}/heures`    | Saisie heures + incrementation `heures_reelles` |

#### IA (5)

| Endpoint                              | Modele Claude  | Description                                            |
|---------------------------------------|----------------|--------------------------------------------------------|
| `POST /rental/ia/chat`                | Sonnet 4       | Chat libre sur location/equipements                    |
| `POST /rental/ia/recommander`         | Opus 4         | Recommandation d equipements pour un projet            |
| `POST /rental/ia/analyser-contrat`    | Opus 4         | Analyse 360 d un contrat (score, risques, recos)       |
| `POST /rental/ia/checklist`           | Sonnet 4       | Generation checklist d inspection                      |
| `POST /rental/ia/location-vs-achat`   | Sonnet 4       | Comparaison location vs achat (seuil rentabilite)      |

> Tous appliquent : `check_ai_guard()`, `_check_credits()`, tracking via `track_ai_usage` + `_deduct_credits` (markup 30%).

### 4.8 Validations & limites

| Regle                                                   | Effet                                          |
|---------------------------------------------------------|------------------------------------------------|
| `nom` item vide                                         | HTTP 422 (Pydantic)                            |
| `tarif_unitaire` ligne < 0                              | HTTP 422 (Pydantic `ge=0`)                     |
| `quantite` ligne < 1                                    | HTTP 422                                       |
| `remise_pourcent` hors [0, 100]                         | HTTP 422                                       |
| Suppression item dans contrat actif                     | HTTP 400 « equipement utilise dans N contrat(s) actif(s) » |
| Suppression contrat hors `BROUILLON`/`ANNULE`           | HTTP 400 « Seuls les contrats BROUILLON ou ANNULE peuvent etre supprimes » |
| POST ligne sur contrat inexistant                       | HTTP 404                                       |
| POST retour sur ligne/contrat invalides                 | HTTP 404                                       |
| PUT contrat sans champs                                 | HTTP 400 « Aucun champ a mettre a jour »       |
| IA sans credits                                         | HTTP 402                                       |
| IA sans acces (`check_ai_guard`)                        | HTTP 403                                       |
| IA module non dispo                                     | HTTP 503                                       |
| IA Anthropic 413 / 529                                  | HTTP 413 / HTTP 503                            |

---

## 5. Integrations & FAQ

### 5.1 Integration CRM (Module 3)

> **Limitee**. Les colonnes `client_company_id` et `client_contact_id` existent dans `location_contrats` mais ne sont **pas** renseignees par la modale UI (qui n utilise que le texte libre `client_nom_cache`). Pour lier un contrat a une entreprise du CRM, passer par l API directement.

### 5.2 Integration Projets (Module 1)

`project_id` dans `location_contrats` mais non saisi via l UI. Pour rattacher un contrat a un projet, passer par API.

### 5.3 Integration Comptabilite / Factures (Module 7)

> **Pas d ecriture journal automatique**. Le statut `FACTURE` change le statut sans creer de facture dans Module 7. Reporter manuellement HT/TPS/TVQ/Total.

### 5.4 Integration Inventaire / Magasin (Module 10)

> **Module distinct**. Les `location_items` ne sont **pas** lies a `produits`. Si un meme item doit etre dans les deux logiques, le creer en double.

### 5.5 Integration Maintenance (Module 24)

> **Pas d integration explicite**. L etat `REPARATION` indique qu un equipement est en reparation, mais aucun lien automatique vers un BT maintenance. Suivi manuel : passer l etat a `REPARATION` quand un BT est ouvert, repasser a `BON` apres cloture.

### 5.6 Integration Immobilier (Module 11)

> **Distincts**. Module 19 gere les unites residentielles avec champs `locataire_*` mais sans cycle bail formel. Module 21 gere la location commerciale d equipements avec contrats / lignes / totaux taxes.

### 5.7 Integration Employes / Paie (Module 9)

- `employee_location` JOIN `employees` pour recuperer nom, prenom, email, telephone.
- Les **heures saisies** dans `location_employes_heures` ne sont **PAS** propagees dans la paie (`payroll_entries`). Comptabilite parallele dediee au pret de main-d oeuvre.
- Pour facturer le client : saisir manuellement le `montant_facture` sur le contrat employe via PUT.

### 5.8 Integration IA / Credits

- 5 endpoints IA, **3 sur Sonnet 4** (chat, checklist, location-vs-achat), **2 sur Opus 4** (recommander, analyser-contrat).
- **System prompt unique** : `LOCATION_AI_SYSTEM_PROMPT` (`secondary.py:1310+`) couvrant types d equipements, regles CCQ/CNESST, tarification, contrats, securite.
- Couts deduits des credits prepayes (`tenant_settings.ai_credits_balance_usd`), tracking dans `ai_usage` (features `location_chat`, `location_recommander`, `location_analyser_contrat`, `location_checklist`, `location_compare_achat`). Markup 30%.

### 5.9 Integration Calendrier

- **Aucune** : pas d export iCal / Google Calendar des dates de sortie/retour.
- Pas de notifications automatiques sur retards.
- Pas de detection automatique de double-reservation.

### 5.10 FAQ

**Q : Comment savoir si un equipement est deja loue sur une periode ?**
R : **Pas de detection automatique**. L UI affiche `disponible: true/false` (boolean simple, mis a jour manuellement). Si un equipement est dans une ligne avec `date_retour_reelle = NULL`, il est implicitement loue, mais aucune verification de chevauchement n est faite a la creation. Bonne pratique : verifier l onglet Retours -> contrats actifs -> lignes non retournees.

**Q : Le module facture-t-il automatiquement le contrat a la fin ?**
R : **NON**. Faire passer le contrat au statut `FACTURE` change seulement le statut. Aucune facture n est creee dans Module 7. Recopiage manuel des montants.

**Q : Comment gerer un retard de retour ?**
R : Manuellement. Passer le contrat a `EN_RETARD` via le dropdown statut, puis lors du retour saisir `frais_retard` ($) dans la modale d inspection.

**Q : Comment gerer la caution ?**
R : Le champ `caution_montant` est sur le contrat (saisi via PUT) et `caution_recue` (boolean) indique si elle a ete recue. **Pas d ecriture comptable automatique**. La caution n est pas integree au calcul `montant_total`.

**Q : Le module gere-t-il les tarifs degressifs ?**
R : **Pas dans l UI**. Les colonnes DDL `tarif_degressif_actif`, `seuil_degressif_jours`, `reduction_degressif_pourcent` existent dans `location_items` mais **ne sont pas exposees** ni utilisees dans le calcul. Pour appliquer une remise, utiliser le champ `remise_pourcent` au niveau de la **ligne** (pas de l item).

**Q : Comment imprimer un contrat / un bon de sortie ?**
R : **Aucun endpoint d impression / export PDF**. Capture d ecran ou export CSV a developper si besoin.

**Q : Y a-t-il un workflow d approbation des contrats ?**
R : **NON**. N importe quel utilisateur peut creer un contrat et le faire passer a `EN_COURS` directement.

**Q : Que se passe-t-il si je supprime un contrat avec des retours enregistres ?**
R : DELETE bloque pour tout statut autre que `BROUILLON` ou `ANNULE`. Si le contrat est dans ces statuts, cascade delete : lignes + retours puis contrat.

**Q : Comment les heures saisies se traduisent-elles en facturation ?**
R : Les heures incrementent `heures_reelles` du contrat employe. Le `montant_facture` est saisi manuellement (PUT). Formule suggeree : `montant_facture = heures_reelles * tarif_unitaire` (selon `tarif_type`).

**Q : Le retour partiel est-il supporte ?**
R : **Oui**. Chaque ligne du contrat est retournee individuellement. Le contrat passe automatiquement a `RETOURNE` quand TOUTES les lignes ont `date_retour_reelle`.

**Q : Comment configurer un nouvel employe pour la location s il n apparait pas dans la liste ?**
R : La liste affiche uniquement les employes ayant deja une entree dans `employee_location`. `PUT /rental/employees/{id}/config` est un UPSERT : il cree la fiche au premier appel. Cote UI, il faut connaitre l `employee_id` (Module 9). **Limitation** : pas de bouton « Ajouter un employe a la location » dans la page actuelle.

**Q : Un employe peut-il etre dans 2 contrats simultanes ?**
R : Techniquement oui (aucune contrainte unique sur `employee_id` dans `location_contrats_employes`), mais le `statut_location` ne peut etre que `EN_LOCATION` pour un seul contrat (le dernier qui passe a `EN_COURS` ecrase). Gerer manuellement.

**Q : L IA peut-elle proposer une tarification basee sur le marche ?**
R : Partiellement, via `POST /rental/ia/analyser-contrat` qui retourne `analyse_tarification`. C est une analyse qualitative produite par Claude, pas une integration avec une base de tarifs reels.

**Q : Comment exporter les statistiques ?**
R : **Pas d export integre**. Copier-coller ou utiliser `GET /rental/statistics` directement via l API.

**Q : Que faire si un equipement passe en `REPARATION` pendant qu il est en location ?**
R : Le champ `etat` peut etre modifie a tout moment, mais cela n affecte pas les contrats en cours. Pour signaler un dommage : enregistrer un retour avec `dommages_constates` + `frais_reparation` puis modifier l etat de l item a `REPARATION`. Suivi manuel.

---

## 6. Recap one-pager

- **Module focus** : location commerciale d equipements (excavatrices, grues, nacelles, etc.) **ET** pret de main-d oeuvre.
- **6 onglets** : Tableau de bord, Catalogue, Contrats, Retours, Employes (4 sous-onglets), Statistiques.
- **27 endpoints** dans `/rental/*` (lignes 3596-5381 de `secondary.py`).
- **7 tables PostgreSQL** : `location_items`, `location_contrats`, `location_contrat_lignes`, `location_retours`, `employee_location`, `location_contrats_employes`, `location_employes_heures`.
- **Statuts contrat** : BROUILLON -> RESERVE -> EN_COURS -> RETOURNE -> FACTURE (+ ANNULE / EN_RETARD).
- **Statuts employe** : DISPONIBLE / EN_LOCATION / INDISPONIBLE / EN_CONGE (sync auto avec statut contrat).
- **Etats equipement** : NEUF / EXCELLENT / BON / ACCEPTABLE / USURE / REPARATION.
- **Calcul** : `montant_ligne = tarif * qty * duree * (1 - remise%)`, totaux contrat = HT + TPS 5% + TVQ 9.975% (taux **hardcodes**).
- **Auto-retour contrat** : passage a `RETOURNE` quand toutes les lignes ont `date_retour_reelle`.
- **Numerotation auto** : `LOC-NNNNN` (contrats) et `EMP-NNNNN` (contrats employes).
- **5 endpoints IA** : chat (Sonnet), recommander (Opus), analyser-contrat (Opus), checklist (Sonnet), location-vs-achat (Sonnet) — markup 30%.
- **Soft-delete items**, suppression contrat bloquee hors BROUILLON/ANNULE.
- **Pas de detection conflits** de reservation.
- **Pas de facturation auto** vers Module 7.
- **Pas d integration** avec Module 9 (heures non propagees en paie).
- **Pas d export PDF** des contrats.
- **Pas de tarif degressif** dans le calcul.
- **Pas de calendrier** ni notification automatique.

---

**Documentation generee a partir du code** : `secondary.py` (lignes 3596-5381, 27 endpoints, 7 tables), `LocationPage.tsx` (1757 lignes, 6 onglets), `location.ts`.

**Manuels lies** :
- Module 1 (Projets — `project_id` informatif) — `01-projets.md`
- Module 3 (CRM — `client_company_id` / `client_contact_id` informatifs) — `03-crm.md`
- Module 7 (Factures — facturation manuelle apres location) — `07-factures.md`
- Module 9 (Employes — `employee_id` jointure pour pret main-d oeuvre) — `09-employes.md`
- Module 10 (Inventaire — distinct, pas de lien) — `10-inventaire.md`
- Module 19 (Immobilier — distinct, location residentielle) — `11-immobilier.md`
- Module 25 (IA — credits IA partages) — `12-ia.md`
- Module 22 (Maintenance — distinct, etat REPARATION suivi manuel) — `24-maintenance.md`
