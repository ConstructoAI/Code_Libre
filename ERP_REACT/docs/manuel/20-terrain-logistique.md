# Module 20 — Logistique (Livraisons / Flotte / Equipements / Coordination)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/secondary.py` (section `/logistics/*` lignes 725-3571), `frontend/src/pages/LogistiquePage.tsx` (1373 lignes, 6 onglets), `frontend/src/api/logistics.ts`
> **Tables PostgreSQL** : `logistics_deliveries`, `logistics_delivery_items`, `logistics_equipment`, `logistics_equipment_reservations`, `logistics_equipment_maintenance`, `logistics_vehicles`, `logistics_vehicle_trips`, `logistics_site_coordination`, `logistics_alerts`
> **Cadrage** : module **operationnel** logistique chantier (livraisons + flotte + equipements + coordination) pour ERP construction Quebec. Couvre la maintenance des **equipements de la flotte logistique** et les alertes preventives. Pour la maintenance generale chantier (fiches d intervention complexes), voir Module 22 Maintenance. Pour la **location** d equipements aux clients (contrats avec calcul TPS/TVQ), voir Module 21 Location.


> **BUG BACKEND signale** : le code backend (`secondary.py:928, 3094, 3352`) interroge `WHERE statut = 'en_maintenance'` alors que le frontend POST `'maintenance'` (sans le prefixe `en_`). Consequence : les KPI 'en_maintenance' comptent toujours 0 sauf si on modifie en BD directement. Bug a corriger cote code (alignement statuts frontend/backend).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (6 onglets)](#2-interface-6-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Couvrir les operations logistiques d un chantier ou d une flotte d entreprise de construction :

- **Livraisons** entrantes/sortantes (planification + tracking + items detailles + zones de stockage)
- **Flotte vehicules** (camionnettes, camions, remorques) avec suivi kilometrage, consommation, deplacements
- **Equipements** mobiles (grues, excavatrices, betonnieres, generatrices) avec reservations par chantier + historique maintenance
- **Coordination chantier** (creneaux livraison beton, arrivee grue, coulee, fermeture rue, reunions)
- **Alertes** preventives (maintenance equipement, inspection, expiration assurance vehicule)
- **IA Claude** : 4 endpoints dedies (analyser, chat, rapport, optimiser) bases sur prompt expert logistique Quebec
- **Sous-onglet GPS / Carte** affichant les positions des vehicules connectes (donnees du module GPS, en lecture)

### 1.2 Ce que le module ne fait PAS

> **Important** : module **operationnel** focus coordination + suivi quotidien. Il n implemente **pas** :

- **Geocoding / routage automatique** livraisons (pas d API Maps)
- **Optimisation tournees** (TSP, VRP) — IA peut suggerer mais pas calculer mathematiquement
- **Tracking GPS temps reel** ecrit dans Logistique : lecture GPS vient du module Carte/GPS separe (`/api/gps/*`)
- **Generation BL PDF** (pas d export imprimable)
- **Workflow approbation livraison** (pas de roles, pas de signature electronique)
- **Detection chevauchements** reservations (deux reservations en parallele acceptees sans erreur)
- **Notifications email/push** (alertes en base seulement)
- **Calcul automatique** couts carburant total / amortissement vehicule
- **Codes-barres / QR codes** (champ `code` = identifiant texte, pas visuel)
- **Multi-localisations** par equipement (un equipement = une `localisation_actuelle` texte)
- **Synchronisation comptable** des couts vers `journal_entries`

Pour la facturation des locations aux clients (contrats avec lignes, TPS/TVQ, retours, dommages) : voir Module 21 (Location).

### 1.3 Acces

- Sidebar -> **Logistique** (icones Truck / Package)
- URL : `/logistique`
- 6 onglets (cf. section 2)
- Onglet par defaut : **Tableau de bord**

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD livraisons, equipements, vehicules, coordinations.
- **IA logistique** : 4 endpoints gardes par `check_ai_guard()` + `_check_credits()`.
- Pas de roles dedies. Pas de soft-delete.

### 1.5 Modeles IA utilises

| Endpoint                    | Modele                       | Max tokens | Markup cout |
|-----------------------------|------------------------------|------------|-------------|
| `/logistics/ia/analyser`    | `claude-opus-4-20250514`     | 4096       | +30%        |
| `/logistics/ia/chat`        | `claude-sonnet-4-20250514`   | 4096       | +30%        |
| `/logistics/ia/rapport`     | `claude-sonnet-4-20250514`   | 8192       | +30%        |
| `/logistics/ia/optimiser`   | `claude-sonnet-4-20250514`   | 4096       | +30%        |

Cout Opus : `(input * 0.015 + output * 0.075) / 1000 * 1.30` USD.
Cout Sonnet : `(input * 0.003 + output * 0.015) / 1000 * 1.30` USD.

> Le **chat** + **rapport** + **optimiser** utilisent Sonnet (rapide / abordable). Seul **analyser** utilise Opus (analyse JSON profonde + score 0-100).

---

## 2. Interface (6 onglets)

Source : `LogistiquePage.tsx:148-155`.

| # | Cle             | Label              | Icone        | Contenu principal                                       |
|---|-----------------|--------------------|--------------| --------------------------------------------------------|
| 1 | `dashboard`     | Tableau de bord    | BarChart3    | KPI 4 cartes + details 3 cartes + alertes actives       |
| 2 | `deliveries`    | Livraisons         | Package      | CRUD livraisons (avec items detailles)                  |
| 3 | `equipment`     | Equipements        | Wrench       | CRUD equipements + reservations + historique maintenance|
| 4 | `vehicles`      | Vehicules          | Truck        | CRUD vehicules + trips                                  |
| 5 | `coordination`  | Coordination       | ClipboardList| Activites coordonnees sur chantier                      |
| 6 | `gps`           | GPS / Carte        | MapPin       | Lecture positions vehicules + lieux + geofences + routes|

> Les onglets affichent les compteurs en temps reel (ex. `Livraisons (12)`, `Equipements (8)`).

### 2.1 Onglet « Tableau de bord »

Source : `LogistiquePage.tsx:192-283`. Recupere `GET /logistics/statistics` + `GET /logistics/alerts?statut=active`.

**4 cartes KPI StatCard** : Livraisons planifiees (bleu) / Equipements disponibles (vert) / Vehicules disponibles (teal) / Alertes actives (rouge si > 0, jaune sinon).

**3 cartes details secondaires** :
- Livraisons : planifiees, en_cours, cette_semaine
- Equipements : disponibles, en_utilisation, maintenance
- Vehicules : disponibles, en_deplacement, KM total cumule

**Section Alertes actives** : liste des alertes non traitees, triees par priorite. Couleurs : haute = rouge `#E8919A`, moyenne = orange `#F0B07A`, basse = jaune `#F6C87A`. Affiche message + date echeance.

### 2.2 Onglet « Livraisons »

#### 2.2.1 Tableau livraisons

Colonnes (triables via `useSortable`) :
- **Reference** (`reference`, format `LIV-NNNNN` — ex. `LIV-83421`)
- **Type** (`typeLivraison`)
- **Zone** (`zoneStockage`)
- **Statut** (selecteur inline editable : `planifiee`, `en_cours`, `livree`, `annulee`)
- **Date prevue** (`datePrevue`)
- **Actions** : bouton Supprimer (poubelle)

Filtres / actions :
- **+ Nouvelle livraison** -> modale creation
- Recherche texte (reference, type, zone, notes)
- Filtre par statut (Tous / Planifiee / En cours / Livree / Annulee)
- Pagination (20 par page)

#### 2.2.2 Modale creation

Champs : **Date prevue** (obligatoire), Heure prevue, Type (Fournisseur/Chantier/Transfert/Retour/Collecte), Zone de stockage, Notes.

> **Champs API non exposes UI** : `projectId` et `fournisseurId` (acceptes par API mais pas dans la modale).

#### 2.2.3 Items de livraison

Une livraison possede des **items** detailles via `GET /logistics/deliveries/{id}` qui retourne `delivery + items[]`. Champs item (`logistics_delivery_items`) : `description`, `quantite_prevue`, `quantite_recue`, `unite` (m3/kg/etc.), `conforme` (boolean defaut TRUE), `notes`.

**Endpoints** : `POST .../{id}/items` (ajouter), `DELETE .../{id}/items/{itemId}` (retirer). Pas d UI standard pour saisir les items — API exposee mais UI affiche seulement la liste maitre.

> **Cascade DELETE** : suppression livraison cascade sur ses items (FK ON DELETE CASCADE).

### 2.3 Onglet « Equipements »

#### 2.3.1 Tableau equipements

Colonnes :
- **Code** (`code` monospace, format `EQP-NNNNN`)
- **Nom** (`nom`)
- **Categorie** (badge bleu — `Grue`, `Excavatrice`, `Chargeuse`, `Echafaudage`, `Compacteur`, `Betonniere`, `Generatrice`, `Autre`)
- **Statut** (selecteur inline : `disponible`, `en_utilisation`, `maintenance`, `reserve`)
- **Localisation** (`localisationActuelle` texte)
- **Cout/jour** (`coutJournalier` formate $)
- **Actions** : Supprimer

Filtres :
- Recherche texte (code, nom, categorie, localisation, notes)
- Filtre par categorie (8 valeurs)
- Filtre par statut (4 valeurs)
- Pagination 20/page

> **Cliquer sur une ligne** = selectionner l equipement et afficher la section **Maintenance** en bas du tableau (cf. 2.3.4).

#### 2.3.2 Modale creation equipement

Champs : **Nom** (obligatoire), Categorie (8 valeurs), Type possession (Propriete/Location), Cout journalier $, Cout mensuel $, Localisation actuelle, Notes.

> **Code auto** : `EQP-NNNNN` (backend `_gen_numero("EQP")`). **Statut defaut** : `disponible`. **Champs DB non saisis UI** : `description`, `fournisseur_location_id`, `date_acquisition`, `date_fin_location`, `valeur_achat`, `prochaine_maintenance`, `prochaine_inspection`, `heures_utilisation`. Edition uniquement via API directe ou patches DB.

#### 2.3.3 Reservations equipement

Endpoints : `GET /logistics/equipment/{id}/reservations` et `POST .../reservations`. Champs : `project_id` (optionnel), `date_debut` (obligatoire), `date_fin` (obligatoire DDL, optionnel API), `responsable`, `statut` (defaut `reservee`), `notes`.

> **Pas d UI standard** pour saisir les reservations : API exposee, mais l UI active uniquement la maintenance sous le tableau equipements. Reservations creables via API directe ou ajout UI futur.
> **Pas de detection chevauchement** : deux reservations sur memes dates / meme equipement acceptees sans erreur. Verification visuelle requise.

#### 2.3.4 Section Maintenance equipement

Apparait en bas de l onglet Equipements quand un equipement est selectionne (clic ligne).

Source : `LogistiquePage.tsx:642-687`.

Tableau :
- **Date** (`dateIntervention`)
- **Type** (badge purple : `maintenance` / `inspection` / `reparation` / `certification`)
- **Technicien**
- **Cout** ($)
- **Conforme** (icone CheckCircle vert ou AlertTriangle rouge)
- **Actions** : Supprimer

Bouton **+ Ajouter intervention** -> modale.

Modale champs :
- **Type d intervention** (dropdown : Maintenance preventive / Inspection / Reparation / Certification)
- **Date intervention** (obligatoire)
- **Technicien**
- **Cout** ($)
- **Prochaine date** (date — propage automatiquement sur `equipment.prochaine_maintenance`)
- **Conforme** (checkbox, defaut coche)
- **Description** (textarea)

> **Effet de bord important** : si `prochaine_date` est saisie a la creation d une intervention, le backend met aussi a jour `logistics_equipment.prochaine_maintenance` avec cette valeur (declenche la prochaine alerte automatique).

### 2.4 Onglet « Vehicules »

#### 2.4.1 Tableau vehicules

Colonnes :
- **Vehicule** (concatenation `marque + modele`)
- **Immatriculation** (UNIQUE)
- **Type** (`typeVehicule` : Camionnette / Camion leger / Camion lourd / Fourgonnette / Remorque / Voiture / Autre)
- **Statut** (selecteur inline : `disponible`, `en_deplacement`, `maintenance`, `hors_service`)
- **KM** (`kilometrage`)
- **Actions** : Supprimer

Filtres :
- Recherche texte (immatriculation, marque, modele, type)
- Filtre par statut

> Pas de pagination cote frontend pour vehicules (tout charge en memoire — Liste complete via `GET /logistics/vehicles`). Adequat pour des flottes de taille moyenne.

#### 2.4.2 Modale creation vehicule

Champs : **Immatriculation** (obligatoire UNIQUE), Marque/Modele/Annee, Type vehicule (7 valeurs), Capacite charge + Unite (kg/lb/tonnes), Kilometrage, Consommation (L/100km), Cout/km ($), Notes.

> **Statut par defaut** : `disponible`. **Champs DB non exposes UI** : `conducteur_attritre_id`, `date_prochain_entretien`, `date_prochaine_inspection`, `assurance_expiration`. Pour activer alertes auto assurance (cf. 2.7), renseigner `assurance_expiration` directement en base — `VehicleUpdate` Pydantic ne gere pas ce champ (limitation).

#### 2.4.3 Trips (Deplacements vehicule)

Endpoints : `GET .../trips` (historique), `POST .../trips` (creer). Champs trip : `project_id` (optionnel), `date_depart` (NOW auto), `date_retour` (NULL au depart), `km_depart`, `km_retour`, `destination`, `motif`, `carburant_litres`, `cout_carburant`, `conducteur_id`, `notes`.

> **Pas d UI standard** pour saisir les trips : API exposee. Pas de section UI dediee aux trips. Lecture API ou extensions futures.
> **Cloture deplacement (`km_retour`, `cout_carburant`)** : pas d endpoint PUT — les trips sont append-only.

### 2.5 Onglet « Coordination »

#### 2.5.1 Tableau coordination

Colonnes :
- **Date** (`dateCoordination`)
- **Type** (badge bleu — `Livraison beton`, `Livraison materiaux`, `Arrivee grue`, `Coulee beton`, `Installation equipement`, `Inspection`, `Reunion de chantier`, `Fermeture de rue`, `Autre`)
- **Horaire** (heure debut - heure fin)
- **Zone** (`zoneConcernee`)
- **Responsable**
- **Statut** (selecteur inline : `planifie`, `en_cours`, `termine`, `annule`)
- **Actions** : Supprimer

Filtres :
- Recherche texte (type, zone, responsable, notes)
- Filtre par statut
- Pagination 20/page

#### 2.5.2 Modale creation

Champs : **Date** (obligatoire), **Type d activite** (obligatoire, 9 valeurs), Heure debut/fin, Zone concernee, Responsable, Notes.

> **Reference auto** : `COORD-NNNNN`. **Statut defaut** : `planifie`. **Champs DB non exposes UI** : `acces_requis`, `contraintes`, `sequence_ordre`.

### 2.6 Onglet « GPS / Carte »

Source : `LogistiquePage.tsx:1116-1372`. Recupere les donnees du module GPS via `gpsApi.*` (pas `logisticsApi`).

4 sous-onglets : **Vehicules GPS** (`GET /api/gps/vehicles`, lecture), **Lieux** (`GET /api/gps/locations`, lecture + creation locale), **Geofences** (lecture), **Routes** (lecture).

Affichage : tableaux simples (lat/lng/vitesse/derniere position pour vehicules ; nom/type/lat-lng pour lieux ; type zone + rayon + alertes pour geofences).

> **Sous-onglet Lieux** offre un bouton « Ajouter lieu » avec modale. Autres sous-onglets en lecture seule.
> **Pas de carte interactive integree** : coordonnees affichees au format texte/monospace. Pour une carte, voir module Carte separe.

### 2.7 Alertes automatiques

Endpoint : `POST /logistics/alerts/generate`. Pas de bouton UI standard — appelable via API ou cron. Genere 3 types d alertes en idempotent (pas de doublon si alerte active existe deja) :

| Type alerte            | Source                            | Echeance    | Priorite                         |
|------------------------|-----------------------------------|-------------|----------------------------------|
| `maintenance_prevue`   | `equipment.prochaine_maintenance` | <= 7 jours  | `haute` si <= 2j sinon `normale` |
| `inspection_requise`   | `equipment.prochaine_inspection`  | <= 7 jours  | `haute` si <= 2j sinon `normale` |
| `assurance_expiration` | `vehicle.assurance_expiration`    | <= 30 jours | `haute` si <= 7j sinon `normale` |

Traitement : `PUT /logistics/alerts/{id}` body `{statut: 'traitee', traite_par: 'Nom'}`. `date_traitement = CURRENT_TIMESTAMP` automatiquement.

---

## 3. Workflows pas-a-pas

### 3.1 Planifier une livraison (entrante)

1. Logistique -> onglet **Livraisons** -> bouton **+ Nouvelle livraison** -> saisir date prevue (obligatoire), heure, type (`Fournisseur` pour materiaux entrants), zone de stockage, notes.
2. **Creer** -> `POST /logistics/deliveries`. Backend genere `reference = LIV-NNNNN`, statut `planifiee`.

### 3.2 Ajouter des items detailles a une livraison

> API exposee, UI standard limitee — utiliser un client API.

1. `POST /logistics/deliveries/{id}/items` body : `{description, quantite_prevue, unite}`.
2. Repeter pour chaque item.
3. **Suppression item** : `DELETE /logistics/deliveries/{id}/items/{item_id}`.

### 3.3 Suivre l etat d une livraison

1. Onglet Livraisons -> tableau, colonne **Statut**.
2. Selecteur inline : changer `planifiee` -> `en_cours` (camion en route) -> `livree` (recue) ou `annulee`.
3. Le `PUT /logistics/deliveries/{id}` envoie uniquement le statut + notes (champs whitelist limites).
4. Pas de date_effective auto-saisie a `livree` (limite — saisir manuellement en BD si besoin).

### 3.4 Supprimer une livraison

1. Tableau -> bouton poubelle.
2. Confirmation -> `DELETE /logistics/deliveries/{id}`.
3. **Cascade** : tous les `delivery_items` lies sont supprimes automatiquement (FK ON DELETE CASCADE).

### 3.5 Creer un equipement

1. Onglet **Equipements** -> bouton **+ Nouvel equipement** -> remplir nom (obligatoire), categorie, type possession, cout journalier/mensuel, localisation, notes (cf. section 2.3.2).
2. **Creer** -> `POST /logistics/equipment`. Backend genere `code = EQP-NNNNN`, statut par defaut `disponible`.

### 3.6 Reserver un equipement pour un projet

> API exposee, UI standard limitee.

1. `POST /logistics/equipment/{id}/reservations` body : `{project_id?, date_debut, date_fin?, responsable?, notes?}`.
2. Statut par defaut `reservee`. Lister via `GET .../reservations`.
3. **Verifier conflits manuellement** : aucune detection automatique de chevauchement.

### 3.7 Enregistrer une intervention de maintenance equipement

1. Onglet Equipements -> **cliquer sur la ligne** d un equipement (surlignage bleu).
2. Section Maintenance apparait en bas -> bouton **+ Ajouter intervention**.
3. Modale (cf. 2.3.4) : type (maintenance/inspection/reparation/certification), date (obligatoire), technicien, cout, prochaine date, conforme, description.
4. **Creer** -> `POST /logistics/equipment/{id}/maintenance`. Backend INSERT + **si `prochaine_date`** renseignee : UPDATE `logistics_equipment.prochaine_maintenance` (declenche prochaines alertes auto).

### 3.8 Modifier ou supprimer une maintenance

- **Modifier** : `PUT /logistics/maintenance/{maintenance_id}` (endpoint racine, pas par equipement).
- **Supprimer** : icone poubelle dans le tableau Maintenance -> `DELETE /logistics/maintenance/{maintenance_id}`.

> Attention : la suppression d une maintenance ne reinitialise PAS `equipment.prochaine_maintenance` (qui reste sur la valeur derniere `prochaine_date` posee).

### 3.9 Lister les alertes maintenance/inspection a venir

1. `GET /logistics/maintenance/alertes` -> retourne les equipements dont `prochaine_maintenance` ou `prochaine_inspection` est <= 7 jours.
2. Reponse : tableau d objets `{id, code, nom, type, date_echeance, urgence}`.
3. `urgence = 'haute'` si <= 2 jours, sinon `'normale'`.

### 3.10 Ajouter un vehicule a la flotte

1. Onglet **Vehicules** -> bouton **+ Nouveau vehicule** -> remplir immatriculation (obligatoire UNIQUE), marque/modele/annee, type, capacite + unite, kilometrage initial, consommation, cout/km, notes (cf. 2.4.2).
2. **Creer** -> `POST /logistics/vehicles`. Statut par defaut `disponible`.

### 3.11 Mettre a jour le kilometrage / statut vehicule

1. Tableau Vehicules -> selecteur statut inline (`disponible` / `en_deplacement` / `maintenance` / `hors_service`).
2. Pour le kilometrage : `PUT /logistics/vehicles/{id}` body `{kilometrage: 45000}` (whitelist : seuls `statut`, `kilometrage`, `notes` sont modifiables via PUT — les autres champs vehicule ne sont pas editables apres creation).

### 3.12 Demarrer un trip vehicule

> API exposee, UI standard limitee.

1. `POST /logistics/vehicles/{id}/trips` body : `{project_id?, destination, motif?, km_depart?}`.
2. Backend insere `date_depart = NOW()`, `date_retour = NULL`.
3. **Pas d endpoint PUT** pour cloturer le trip (`km_retour`, `date_retour`, `cout_carburant`) — limitation actuelle.

### 3.13 Planifier une activite de coordination chantier

1. Onglet **Coordination** -> bouton **+ Nouvelle activite** -> saisir date (obligatoire), type d activite (obligatoire, 9 valeurs), heure debut/fin, zone, responsable, notes (cf. 2.5.2).
2. **Creer** -> `POST /logistics/coordination`. Backend genere `reference = COORD-NNNNN`, statut `planifie`.

### 3.14 Generer manuellement les alertes preventives

1. Appeler `POST /logistics/alerts/generate` (pas de bouton UI dans `LogistiquePage.tsx` standard — a integrer ou appeler via cron).
2. Backend parcourt :
   - Equipements avec `prochaine_maintenance <= +7 jours` -> alerte `maintenance_prevue`
   - Equipements avec `prochaine_inspection <= +7 jours` -> alerte `inspection_requise`
   - Vehicules avec `assurance_expiration <= +30 jours` -> alerte `assurance_expiration`
3. **Idempotent** : ne cree pas de doublons (verifie qu une alerte active du meme `(reference_type, reference_id, type_alerte)` n existe pas deja).
4. Reponse : `{generated: 5, message: '5 alerte(s) generee(s)'}`.

### 3.15 Traiter une alerte

1. Tableau de bord -> section Alertes actives (lecture).
2. Pour traiter (pas de bouton UI standard — utiliser API) : `PUT /logistics/alerts/{id}` body `{statut: "traitee", traite_par: "Nom"}`.
3. Backend met `date_traitement = CURRENT_TIMESTAMP` automatiquement.

### 3.16 Analyser la logistique avec IA (Opus, JSON score)

1. `POST /logistics/ia/analyser` (sans body).
2. Backend verifie `check_ai_guard(user)` (HTTP 403 sinon) + `_check_credits(user)` (HTTP 402 sinon).
3. Recupere stats + 20 dernieres livraisons + tous equipements + tous vehicules. Appelle **Claude Opus 4** (max 4096 tokens).
4. Reponse JSON avec sections : `score_logistique` (0-100), `resume`, `points_forts` (liste), `points_amelioration` (liste), `analyse_livraisons`, `analyse_equipements`, `analyse_vehicules`, `recommandations_prioritaires` (liste).
5. Tracking : `track_ai_usage(user, 'logistique_analyser', ...)` + deduction credits.

### 3.17 Chat IA logistique

1. `POST /logistics/ia/chat` body : `{question: "...", context?: "..."}`.
2. Modele : Claude Sonnet 4 (rapide et abordable).
3. Reponse texte libre + usage tokens + cout.

### 3.18 Generer un rapport logistique IA (Markdown 8 sections)

1. `POST /logistics/ia/rapport` (sans body).
2. Backend recupere les 50 dernieres livraisons + tous equipements + tous vehicules. Sonnet 4 (max 8192 tokens).
3. Rapport Markdown 8 sections : Resume executif / Analyse des livraisons / Analyse des equipements / Analyse de la flotte / Plan d action / Gains potentiels / KPIs recommandes / Conclusion.
4. Reponse : `{rapport: "<markdown>", usage: {...}}`. Telechargeable / exportable cote frontend.

### 3.19 Optimiser une operation logistique IA

1. `POST /logistics/ia/optimiser` body : `{besoin: "...", nombre_vehicules?, nombre_equipements?, nombre_livraisons_semaine?}`.
2. Sonnet 4 retourne JSON structure : `titre_solution`, `description`, `etapes` (liste), `ressources_necessaires` (liste), `benefices_attendus` (liste), `risques` (liste), `indicateurs_succes` (liste), `alternatives` (liste).

### 3.20 Consulter les vehicules sur la carte GPS

1. Onglet **GPS / Carte** -> sous-onglet **Vehicules GPS**.
2. Appel `GET /api/gps/vehicles` -> recupere positions actuelles + vitesse + derniere position.
3. Tableau lecture seule. Pour modifier les positions, utiliser le module GPS / Carte (separe).

### 3.21 Ajouter un lieu GPS

1. Onglet GPS -> sous-onglet **Lieux** -> bouton **Ajouter lieu** -> nom (obligatoire), latitude/longitude (obligatoires), type, ville.
2. `POST /api/gps/locations` (endpoint module GPS, pas Logistique).

---

## 4. Reference

### 4.1 Statuts par entite

| Entite              | Statuts (verbatim cote frontend / backend)                    |
|---------------------|---------------------------------------------------------------|
| Livraison           | `planifiee`, `en_cours`, `livree`, `annulee`                  |
| Equipement          | `disponible`, `en_utilisation`, `maintenance`, `reserve`      |
| Vehicule            | `disponible`, `en_deplacement`, `maintenance`, `hors_service` |
| Coordination        | `planifie`, `en_cours`, `termine`, `annule`                   |
| Reservation equipement | `reservee` (defaut, autres possibles non standardises)     |
| Maintenance equipement | conforme = boolean                                          |
| Alerte              | `active`, `traitee` (par PUT)                                 |
| Priorite alerte     | `haute`, `moyenne` (rare), `normale`                          |

### 4.2 Types et categories

| Champ                  | Valeurs                                                                 |
|------------------------|-------------------------------------------------------------------------|
| **Type livraison**     | `Fournisseur`, `Chantier`, `Transfert`, `Retour`, `Collecte`            |
| **Categorie equipement** | `Grue`, `Excavatrice`, `Chargeuse`, `Echafaudage`, `Compacteur`, `Betonniere`, `Generatrice`, `Autre` |
| **Type possession equipement** | `propriete`, `location`                                       |
| **Type vehicule**      | `Camionnette`, `Camion leger`, `Camion lourd`, `Fourgonnette`, `Remorque`, `Voiture`, `Autre` |
| **Unite capacite**     | `kg`, `lb`, `tonnes`                                                    |
| **Type activite coordination** | `Livraison beton`, `Livraison materiaux`, `Arrivee grue`, `Coulee beton`, `Installation equipement`, `Inspection`, `Reunion de chantier`, `Fermeture de rue`, `Autre` |
| **Type intervention maintenance** | `maintenance` (preventive), `inspection`, `reparation`, `certification` |
| **Type alerte**        | `maintenance_prevue`, `inspection_requise`, `assurance_expiration`      |

### 4.3 Endpoints livraisons

| Methode | URL                                                    | Role                                |
|---------|--------------------------------------------------------|-------------------------------------|
| GET     | `/logistics/deliveries`                                | Liste paginee + filtre statut       |
| GET     | `/logistics/deliveries/{id}`                           | Detail livraison + items[]          |
| POST    | `/logistics/deliveries`                                | Creer livraison (auto reference)    |
| PUT     | `/logistics/deliveries/{id}`                           | Modifier (whitelist : statut, notes)|
| DELETE  | `/logistics/deliveries/{id}`                           | Supprimer (cascade items)           |
| POST    | `/logistics/deliveries/{id}/items`                     | Ajouter item                        |
| DELETE  | `/logistics/deliveries/{id}/items/{itemId}`            | Retirer item                        |

### 4.4 Endpoints equipements + maintenance + reservations

| Methode | URL                                                    | Role                                |
|---------|--------------------------------------------------------|-------------------------------------|
| GET     | `/logistics/equipment`                                 | Liste paginee + filtres categorie/statut |
| GET     | `/logistics/equipment/{id}`                            | Detail equipement                   |
| POST    | `/logistics/equipment`                                 | Creer (auto code EQP-NNNNN)         |
| PUT     | `/logistics/equipment/{id}`                            | Modifier (whitelist : nom, categorie, statut, localisation, notes) |
| DELETE  | `/logistics/equipment/{id}`                            | Supprimer (cascade reservations + maintenance) |
| GET     | `/logistics/equipment/{id}/reservations`               | Liste reservations                  |
| POST    | `/logistics/equipment/{id}/reservations`               | Creer reservation                   |
| GET     | `/logistics/equipment/{id}/maintenance`                | Historique maintenance              |
| POST    | `/logistics/equipment/{id}/maintenance`                | Ajouter intervention (+ propage prochaine_date) |
| PUT     | `/logistics/maintenance/{id}`                          | Modifier intervention               |
| DELETE  | `/logistics/maintenance/{id}`                          | Supprimer intervention              |
| GET     | `/logistics/maintenance/alertes`                       | Equipements avec maintenance/inspection due <= 7j |

### 4.5 Endpoints vehicules + trips

| Methode | URL                                                    | Role                                |
|---------|--------------------------------------------------------|-------------------------------------|
| GET     | `/logistics/vehicles`                                  | Liste (sans pagination)             |
| POST    | `/logistics/vehicles`                                  | Creer vehicule                      |
| PUT     | `/logistics/vehicles/{id}`                             | Modifier (whitelist : statut, kilometrage, notes) |
| DELETE  | `/logistics/vehicles/{id}`                             | Supprimer (cascade trips)           |
| GET     | `/logistics/vehicles/{id}/trips`                       | Historique trips                    |
| POST    | `/logistics/vehicles/{id}/trips`                       | Creer trip (date_depart = NOW)      |

### 4.6 Endpoints coordination + alertes + IA + statistiques

| Methode | URL                                                    | Role                                |
|---------|--------------------------------------------------------|-------------------------------------|
| GET     | `/logistics/coordination`                              | Liste paginee + filtres project/statut |
| POST    | `/logistics/coordination`                              | Creer (auto reference COORD-NNNNN)  |
| PUT     | `/logistics/coordination/{id}`                         | Modifier (whitelist : statut, notes)|
| DELETE  | `/logistics/coordination/{id}`                         | Supprimer                           |
| GET     | `/logistics/alerts`                                    | Liste alertes (filtre statut/priorite, top 50) |
| PUT     | `/logistics/alerts/{id}`                               | Marquer traitee (auto-set date_traitement) |
| POST    | `/logistics/alerts/generate`                           | Generation idempotente (3 sources)  |
| POST    | `/logistics/ia/analyser`                               | IA Opus -> JSON score 0-100         |
| POST    | `/logistics/ia/chat`                                   | IA Sonnet -> reponse texte libre    |
| POST    | `/logistics/ia/rapport`                                | IA Sonnet -> rapport Markdown 8 sections |
| POST    | `/logistics/ia/optimiser`                              | IA Sonnet -> recommandation JSON    |
| GET     | `/logistics/statistics`                                | KPI consolides (4 categories)       |

### 4.7 Tables PostgreSQL

| Table                                  | Role                                                |
|----------------------------------------|-----------------------------------------------------|
| `logistics_deliveries`                 | Livraisons (auto reference UNIQUE)                  |
| `logistics_delivery_items`             | Items detailles par livraison (FK CASCADE)          |
| `logistics_equipment`                  | Equipements (auto code UNIQUE)                      |
| `logistics_equipment_reservations`     | Reservations equipement par projet (FK CASCADE)     |
| `logistics_equipment_maintenance`      | Historique interventions (FK CASCADE)               |
| `logistics_vehicles`                   | Flotte (immatriculation UNIQUE)                     |
| `logistics_vehicle_trips`              | Trips append-only (FK CASCADE)                      |
| `logistics_site_coordination`          | Activites chantier coordonnees (auto reference)     |
| `logistics_alerts`                     | Alertes preventives (idempotent generation)         |

### 4.8 Champs cles tables principales

**`logistics_equipment`** (cles) : `id`, `code` (UNIQUE EQP-NNNNN), `nom` (NOT NULL), `description`, `categorie`, `type_possession` (propriete/location), `fournisseur_location_id`, `cout_journalier`, `cout_mensuel`, `date_acquisition`, `date_fin_location`, `valeur_achat`, `statut` (defaut disponible), `localisation_actuelle`, `project_id_actuel`, `prochaine_maintenance` (alertes auto), `prochaine_inspection` (alertes auto), `heures_utilisation`, `notes`, `created_at`, `updated_at`.

**`logistics_vehicles`** (cles) : `id`, `immatriculation` (UNIQUE), `marque`, `modele`, `annee`, `type_vehicule`, `capacite_charge`, `unite_capacite`, `kilometrage`, `consommation_moyenne` (L/100km), `cout_km`, `statut` (defaut disponible), `conducteur_attritre_id`, `date_prochain_entretien`, `date_prochaine_inspection`, `assurance_expiration` (alertes auto), `notes`, `created_at`, `updated_at`.

**`logistics_alerts`** (cles) : `id`, `type_alerte` (maintenance_prevue / inspection_requise / assurance_expiration), `reference_type` (equipment | vehicle), `reference_id` (FK logique), `message` (NOT NULL), `priorite` (defaut normale), `date_alerte`, `date_echeance`, `statut` (defaut active), `traite_par`, `date_traitement`.

### 4.9 Validations & limites

| Regle                                      | Effet                                                  |
|--------------------------------------------|--------------------------------------------------------|
| `immatriculation` doublon vehicule         | HTTP 500 (UNIQUE constraint, pas de message custom)    |
| `code` doublon equipement                  | Tres rare car genere aleatoire EQP-NNNNN (collision possible mais peu probable) |
| `reference` doublon livraison              | Idem (LIV-NNNNN aleatoire)                             |
| Update sans champs                         | HTTP 400 « Aucun champ a mettre a jour »               |
| DELETE entite inexistante                  | HTTP 404                                               |
| IA sans credits                            | HTTP 402 « Credits IA insuffisants »                   |
| IA sans acces tenant                       | HTTP 403                                               |
| IA service indispo                         | HTTP 503                                               |
| IA payload trop volumineux (>413)          | HTTP 413                                               |
| IA Anthropic surcharge (529)               | HTTP 503                                               |
| Reservation chevauchante                   | **Aucune validation** (autorise)                       |
| Trip cloture (`km_retour`)                 | **Pas d endpoint PUT** — append-only                   |
| Update livraison hors `statut/notes`       | Champs ignores (whitelist serree)                      |
| Update equipement hors 5 champs            | Champs ignores (whitelist : nom/categorie/statut/localisation/notes) |
| Update vehicule hors 3 champs              | Champs ignores (whitelist : statut/kilometrage/notes)  |

### 4.10 Format references auto-generees + priorite alertes

**References** (source : `_gen_numero(prefix)` -> `f"{prefix}-{random.randint(10000, 99999)}"`) : Livraison `LIV-NNNNN`, Equipement `EQP-NNNNN`, Coordination `COORD-NNNNN`. **Aleatoires** (pas sequentiels). Risque de collision faible (~1/90000) — UNIQUE rejette en DB si doublon.

**Logique priorite alerte** :
- `maintenance_prevue` / `inspection_requise` : `haute` si echeance <= +2 jours, sinon `normale` (toujours <= +7 jours).
- `assurance_expiration` : `haute` si echeance <= +7 jours, sinon `normale` (toujours <= +30 jours).

**Couleurs statut frontend** (source : `LogistiquePage.tsx:117-125` `statutColor`) : `green` (livr/dispon/termin/complet), `blue` (en_cours/en_dep/activ/en_util), `yellow` (planif/reserv), `red` (annul/hors), `purple` (maint), `gray` (autre).

---

## 5. Integrations & FAQ

### 5.1 Integration Projets (Module 1)

- **References faibles** : `delivery.project_id`, `equipment.project_id_actuel`, `reservation.project_id`, `trip.project_id`, `coordination.project_id` -> FK logiques vers `projects.id`.
- **Pas de cascade** : delete projet ne supprime PAS les entites Logistique liees (les `project_id` deviennent orphelins).
- **Pas de jointure** dans les listes : `project_id` brut, frontend doit resoudre les noms via `GET /projects/{id}`.

### 5.2 Integration CRM / Fournisseurs (Module 3)

- `delivery.fournisseur_id` -> FK logique vers `companies.id`. Pas de jointure auto.
- `equipment.fournisseur_location_id` (DB seulement, non expose UI) -> idem.

### 5.3 Integration Inventaire (Module 10)

- `delivery_items.inventory_item_id` (DB) -> FK logique vers `produits.id`.
- **Pas de mise a jour stock auto** au passage `livree` : creation manuelle separee de mouvements ENTREE (cf. Module 10 workflow 3.3). Bonne pratique : referencer `LIV-NNNNN` dans le motif.

### 5.4 Integration Comptabilite (Module 7)

- **Aucune integration directe**. Les couts (cout journalier equipement, cout carburant trip, cout maintenance) ne sont PAS convertis en ecritures de journal. Comptabilisation manuelle dans Module 7 ou export CSV.

### 5.5 Integration Maintenance (Module 24)

> **Chevauchement controle** : Logistique gere la maintenance des **equipements de la flotte logistique** (camions, grues, excavatrices) via `logistics_equipment_maintenance`. Module **24 Maintenance** couvre la maintenance generale des **equipements chantier** au sens large avec fiches d intervention plus complexes.

**Quand utiliser quel module ?**
- **Logistique > Equipements > Maintenance** : equipement de la flotte interne. Workflow integre avec alertes auto + propagation `prochaine_date`.
- **Module 22 Maintenance** : suivi global, fiches detaillees, planification long terme, BT multi-equipements, certifications complexes.

> Les deux modules ne partagent pas la meme table. Pour une vue consolidee, consulter chaque module separement.

### 5.6 Integration Location (Module 23)

> **Chevauchement controle** : Logistique gere les **equipements possedes ou loues PAR l entreprise** (champ `type_possession`). Module **23 Location** gere les **contrats de location** que l entreprise propose A SES CLIENTS (sortante) ou contracte CHEZ SES FOURNISSEURS (entrante).

**Quand utiliser quel module ?**
- **Logistique > Equipements** : declarer un equipement disponible dans la flotte interne, gerer reservations par projet et maintenance.
- **Module 21 Location** : creer un contrat formel (`location_contrats`) avec lignes facturees TPS/TVQ, dates sortie/retour, caution, retours, dommages.

> Tables distinctes : `logistics_equipment` (Logistique) vs `location_items` + `location_contrats` (Location).

### 5.7 Integration GPS / Carte

- L onglet **GPS** de Logistique consomme directement `GET /api/gps/*` (module GPS separe).
- Modification des positions / geofences / routes : faire dans le module GPS dedie.
- L association vehicule Logistique <-> vehicule GPS se fait par `immatriculation` (champ commun, pas FK explicite).

### 5.8 Integration IA Claude

- 4 endpoints dedies (`/logistics/ia/analyser`, `/chat`, `/rapport`, `/optimiser`).
- Tous gardes par `check_ai_guard()` + `_check_credits()`.
- Modeles : Opus 4 (analyser) ou Sonnet 4 (chat / rapport / optimiser).
- Tracking dans `ai_usage` table (feature = `logistique_*`).
- Markup cout : +30% sur les prix Anthropic.
- **Prompt systeme** : expert logistique construction Quebec (SAAQ, MTQ, CNESST, reglements municipaux livraisons, heures autorisees).

### 5.9 FAQ

**Q : Une livraison `livree` met-elle automatiquement a jour le stock dans Inventaire ?**
R : **NON**. Apres reception physique, creer manuellement un mouvement ENTREE dans Module 10 avec reference `LIV-NNNNN` dans le motif.

**Q : Peut-on planifier des livraisons recurrentes (ex. beton chaque vendredi) ?**
R : **NON**. Pas de templates ni de regle de recurrence. Saisir manuellement chaque livraison ou utiliser un script API.

**Q : Comment generer un bon de livraison PDF ?**
R : **Pas implemente**. Aucun export PDF / impression natif. Pour un BL papier, utiliser un module externe ou exporter via API.

**Q : Le module bloque-t-il deux reservations sur les memes dates ?**
R : **NON**. Aucune validation de chevauchement. Verifier visuellement la liste des reservations avant de creer.

**Q : Les heures d utilisation d un equipement (`heures_utilisation`) sont-elles incrementees automatiquement ?**
R : **NON**. Champ DB present mais non incremente automatiquement par les reservations ou trips. Mise a jour manuelle requise via API.

**Q : Comment recevoir une notification email quand une alerte est generee ?**
R : **Pas d email automatique**. Les alertes sont stockees en base et affichees dans le tableau de bord. Pour notifier par email, integrer un cron + SMTP custom.

**Q : Les alertes sont-elles regeneerees automatiquement ?**
R : **NON par defaut**. L appel `POST /logistics/alerts/generate` est manuel ou via cron job externe. Aucun planificateur interne.

**Q : Une fois une alerte traitee, peut-elle etre regeneeree ?**
R : **OUI**. La generation est idempotente uniquement sur les alertes `active`. Une alerte `traitee` n est plus consideree -> une nouvelle alerte du meme type peut etre creee si la condition est encore vraie. Bonne pratique : reporter `prochaine_maintenance` apres l intervention.

**Q : Le module gere-t-il les conducteurs et leurs permis ?**
R : **PARTIELLEMENT**. Champ `conducteur_attritre_id` existe en DB mais non expose dans l UI. Pas de gestion classes de permis ni dates expiration cote Logistique. Utiliser Module Employes.

**Q : Comment integrer Google Maps / route GPS ?**
R : **Pas integre dans Logistique**. Le module GPS associe consomme des donnees brutes de positions. Pour un calcul d itineraire ou une carte, prevoir un module Carte dedie ou un service externe.

**Q : Combien de livraisons / equipements maximum supportes ?**
R : Pas de limite hard-codee. Pagination 20/page. Pour > 1000 entites, prevoir des index DB sur `statut`, `categorie`, `created_at`.

**Q : Les coordinations chantier ont-elles une integration calendrier (iCal) ?**
R : **NON**. Aucune sortie iCal / Google Calendar. Ajouter manuellement au Calendrier (`/calendar`).

**Q : Comment cloturer un trip vehicule (km_retour, cout_carburant, date_retour) ?**
R : **Pas d endpoint PUT trip**. Les trips sont append-only. Limitation actuelle — modifier en base si besoin.

**Q : Les couts journaliers / mensuels equipement servent-ils a quelque chose ?**
R : **Affichage uniquement** dans la liste. Pas d agregation automatique vers Comptabilite. Donnees a exploiter via analyses externes.

**Q : Peut-on uploader un document (photo, certificat) sur une intervention maintenance ?**
R : Le champ `documents` existe sur `logistics_equipment_maintenance` (texte URL/chemin) mais pas d upload binaire. Stocker l URL d un fichier heberge ailleurs (Module 8 Dossiers, Drive externe).

---

## 6. Recap one-pager

- **6 onglets** : Tableau de bord / Livraisons / Equipements / Vehicules / Coordination / GPS-Carte.
- **9 tables** : `logistics_deliveries`, `logistics_delivery_items`, `logistics_equipment`, `logistics_equipment_reservations`, `logistics_equipment_maintenance`, `logistics_vehicles`, `logistics_vehicle_trips`, `logistics_site_coordination`, `logistics_alerts`.
- **35+ endpoints** `/logistics/*` (CRUD + maintenance + reservations + trips + alerts + 4 IA + statistics).
- **4 statuts livraison** : `planifiee` -> `en_cours` -> `livree` / `annulee`.
- **4 statuts equipement** : `disponible` / `en_utilisation` / `maintenance` / `reserve`.
- **4 statuts vehicule** : `disponible` / `en_deplacement` / `maintenance` / `hors_service`.
- **4 statuts coordination** : `planifie` / `en_cours` / `termine` / `annule`.
- **3 types alerte** : `maintenance_prevue` / `inspection_requise` / `assurance_expiration`.
- **2 priorites** : `haute` (urgent <= 2j ou 7j selon type) / `normale`.
- **Auto-generation references** : `LIV-NNNNN`, `EQP-NNNNN`, `COORD-NNNNN` (random 10000-99999).
- **Whitelists PUT serrees** :
  - Livraison : `statut`, `notes`
  - Equipement : `nom`, `categorie`, `statut`, `localisation_actuelle`, `notes`
  - Vehicule : `statut`, `kilometrage`, `notes`
  - Coordination : `statut`, `notes`
- **Cascade FK** : delete livraison -> delete items ; delete equipement -> delete reservations + maintenance ; delete vehicule -> delete trips.
- **Maintenance equipement** : INSERT propage `prochaine_date` sur `equipment.prochaine_maintenance` (declenche alertes auto).
- **Generation alertes idempotente** : `POST /logistics/alerts/generate` (pas de doublons, basee sur 3 sources : maintenance / inspection / assurance).
- **4 endpoints IA** :
  - `analyser` (Opus 4) -> JSON score 0-100
  - `chat` (Sonnet 4) -> reponse libre
  - `rapport` (Sonnet 4) -> Markdown 8 sections
  - `optimiser` (Sonnet 4) -> JSON recommandation
- **Onglet GPS** : LECTURE SEULE des donnees `gps_*` (module separe), sauf creation de Lieux possible inline.
- **PAS de PUT trip** (append-only). **PAS de detection conflit reservation**. **PAS de notification email** alertes. **PAS d integration Maps** automatique. **PAS d auto-update stock** Inventaire. **PAS d ecriture journal** auto Comptabilite.
- **Modele IA** : Opus 4 + Sonnet 4 (markup +30% cout). Anthropic API guardee par `check_ai_guard` + `_check_credits`.

---

**Documentation generee a partir du code** : `secondary.py` lignes 725-3571 (section /logistics/*), `LogistiquePage.tsx` (1373 lignes, 6 onglets), `logistics.ts`.

**Manuels lies** :
- Module 1 (Projets — `project_id` references) — `01-projets.md`
- Module 3 (CRM / Fournisseurs — `fournisseur_id` references) — `03-crm.md`
- Module 10 (Inventaire — mouvements stock manuels apres livraison) — `10-inventaire.md`
- Module 21 (Location — contrats clients/fournisseurs distincts) — `23-location.md`
- Module 22 (Maintenance — fiches generales chantier) — `24-maintenance.md`
- Module 23 (Carte / GPS — donnees positions vehicules) — manuel separe a venir
