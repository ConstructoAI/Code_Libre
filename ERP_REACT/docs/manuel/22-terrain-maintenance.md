# Module 22 — Maintenance (preventive et corrective des equipements)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/secondary.py` (sections Maintenance lignes 1366-7549, 41 endpoints), `frontend/src/pages/MaintenancePage.tsx` (1566 lignes, 9 onglets), `frontend/src/api/maintenance.ts` (444 lignes)
> **Tables PostgreSQL** : `maintenance_types`, `maintenance_planification`, `maintenance_demandes`, `maintenance_interventions`, `maintenance_pieces`, `maintenance_historique`, `maintenance_compteurs`, `maintenance_alertes` (8 tables auto-creees via `_ensure_maintenance_tables`)
> **Cadrage** : ce module gere la **maintenance preventive et corrective** de tous les equipements (chantier, flotte, outillage). Il gere les compteurs (heures/km/cycles), les planifications recurrentes, les demandes/interventions, les pieces consommees, les alertes automatiques, l'historique et 6 endpoints IA Claude. **Distinct** des bons de travail employes (Module 5) et de la logistique flotte (Module 22), bien que tous referent a des equipements.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (9 onglets)](#2-interface-9-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations--faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Gerer le cycle complet de la maintenance des equipements de construction :

- **Catalogue Types** : procedures-types (frequence, duree, cout, competences).
- **Planifier** maintenances recurrentes par equipement (frequence : jours/semaines/mois/heures d'utilisation/km) avec calcul auto prochaine echeance.
- **Suivre les compteurs** (heures/km/cycles) — saisie manuelle.
- **Recevoir demandes** (corrective/preventive/urgente) avec numero `MR-NNNNN` et cycle de statuts.
- **Executer interventions** rattachees a une demande (technicien interne ou fournisseur externe, duree, observations, recommandations).
- **Consommer pieces** rattachees a demande/intervention (lien optionnel inventaire avec decrement auto stock).
- **Generer alertes** preventives (seuil configurable, max 500 par appel).
- **Conserver historique** par equipement (auto-insertion a la cloture).
- **Assister via 6 endpoints IA Claude** : chat expert, diagnostic de panne, plan preventif, analyse d'intervention, checklist, estimation de cout.

### 1.2 Ce que le module ne fait PAS

> **Important** : ce module est centre sur les **equipements et le materiel**, pas sur la planification du travail des employes.

Le module **n implemente pas** :
- **Bons de travail** (BT) employes (Module 5 `production.py`) — les BT planifient le travail humain sur chantier ; les demandes maintenance planifient les interventions sur equipements.
- **Pointage temps** sur une intervention — pas d'integration `time_entries`. Heures `duree_heures` / `temps_reel_heures` saisies manuellement.
- **Generation de PDF imprimable** : pas d'endpoint `generate-html` (contrairement aux BT/Factures).
- **Workflow d approbation** formel — tout utilisateur authentifie peut creer/cloturer.
- **Notifications email / SMS** automatiques — les alertes vivent uniquement dans la table `maintenance_alertes` + onglet Alertes.
- **Calendrier integre** — les demandes ne s'affichent pas dans `/calendar`.
- **Mise a jour auto des compteurs** depuis capteurs IoT — saisie manuelle uniquement.
- **Lien direct compteur-planification** basee sur l'usage : `frequence_type = HEURES_UTILISATION` / `KILOMETRES` ne lit pas le dernier compteur (workflow manuel).
- **Gestion d'un parc unifie** : `equipement_id` refere a 3 sources (`INVENTORY` / `LOCATION` / `VEHICULE`) sans table commune ; pas de lookup auto du nom.
- **Multi-techniciens** par intervention : un seul `technicien_id` OU `fournisseur_id` par intervention.

### 1.3 Acces

- Sidebar -> **Maintenance** (icone Wrench).
- URL : `/maintenance`.
- Onglet par defaut : **Tableau de bord**.
- 9 onglets (cf. section 2).

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD toutes les entites Maintenance.
- **IA** : guardee par `check_ai_guard()` + `_check_credits()` avant chaque appel.
- Pas de roles dedies « technicien maintenance », « gestionnaire flotte ».

### 1.5 Distinction avec d'autres modules

| Module                  | Couvre                                                                            |
|-------------------------|-----------------------------------------------------------------------------------|
| **24 Maintenance**      | Equipements (chantier + flotte + outillage), preventif + correctif, compteurs, IA |
| 22 Logistique           | Flotte (vehicules / equipements livraison), deploiement operationnel              |
| 5 Bons de travail (BT)  | Travail humain planifie sur chantier (operations, lignes, assignations)           |
| 10 Inventaire           | Produits / pieces detachees (stock)                                               |

> **Chevauchement Logistique** : `/logistics/equipment/{id}/maintenance` (M20) = mini-vue maintenance flotte (table `logistics_equipment_maintenance`). Ce module (`/maintenance/*`) couvre **tous** les equipements avec un schema riche (planification + compteurs + alertes + IA). En pratique : Logistique pour vue rapide vehicule, Maintenance pour gestion complete.

---

## 2. Interface (9 onglets)

Source : `MaintenancePage.tsx:147-157` — array `tabs`.

| # | Cle              | Label                  | Icone           | Contenu principal                                              |
|---|------------------|------------------------|-----------------|----------------------------------------------------------------|
| 1 | `dashboard`      | Tableau de bord        | BarChart3       | KPIs + demandes urgentes + planifications dues + alertes      |
| 2 | `types`          | Types                  | Settings        | Catalogue des procedures-types de maintenance                  |
| 3 | `planification`  | Planification (N)      | Calendar        | Maintenances recurrentes par equipement                        |
| 4 | `demandes`       | Demandes (N)           | ClipboardList   | Demandes de maintenance (cycle de statuts)                     |
| 5 | `interventions`  | Interventions (N)      | Wrench          | Interventions executees (rattachees a une demande)             |
| 6 | `pieces`         | Pieces                 | Package         | Pieces consommees                                              |
| 7 | `alertes`        | Alertes (N)            | Bell            | Alertes preventives generees automatiquement                   |
| 8 | `historique`     | Historique             | History         | Historique chronologique par equipement                        |
| 9 | `stats`          | Statistiques           | BarChart3       | KPIs detailles + repartition statut/priorite                   |

> Les badges `(N)` sur les onglets affichent dynamiquement le nombre courant : Planification = `planificationsRetard`, Demandes = `enAttente`, Interventions = `enCours`, Alertes = `alertesNonLues`.

### 2.1 Onglet « Tableau de bord »

4 cartes KPI (StatCard pastel) :
- **Interventions ce mois** (compteur `interventions_mois`)
- **En cours** (`en_cours`, demandes statut `EN_COURS`)
- **En attente** (`en_attente`, demandes statut `DEMANDE`/`APPROUVE`/`PLANIFIE`/`EN_ATTENTE_PIECES`)
- **Alertes non lues** (`alertes_non_lues`)

3 cartes de listes (top 5) :
- **Demandes urgentes** (priorite `CRITIQUE` ou `HAUTE`)
- **Planifications dues** (`prochaine_maintenance` <= aujourd'hui, statut actif)
- **Dernieres alertes** (toutes priorites)

### 2.2 Onglet « Types »

Catalogue des **procedures-types** de maintenance (ex. « Vidange moteur 250h », « Inspection electrique annuelle »).

Colonnes tableau : Nom, Categorie (`PREVENTIVE`/`CORRECTIVE`/`PREDICTIVE`), Frequence (jours), Duree estimee (h), Cout estime ($), Actions.

Modale creation : tous les champs ci-dessus + description + competences requises + checklist JSON + pieces requises JSON (les 2 derniers stockes mais non exposes dans l'UI v2.0). Filtres : recherche + categorie.

> **Soft-delete** : suppression met `actif = FALSE`. Filtre par defaut `actif_only = TRUE` cache les desactives.

### 2.3 Onglet « Planification »

Planifications recurrentes par equipement.

Colonnes tableau : Nom, Equipement (Type+ID), Frequence (valeur + `JOURS`/`SEMAINES`/`MOIS`/`HEURES_UTILISATION`/`KILOMETRES`), Derniere, Prochaine (auto-calculee si vide), Priorite (`BASSE`/`NORMALE`/`HAUTE`/`CRITIQUE`). Badge **Retard** rouge si `prochaine_maintenance < today`.

Modale creation : champs ci-dessus + Type de maintenance (FK optionnel) + description + seuil alerte (defaut 7) + notes. Filtres : recherche + priorite.

> **Calcul auto prochaine maintenance** (si vide a la creation) :
> - `JOURS` : `derniere + valeur jours` ; `SEMAINES` : `+ valeur * 7` ; `MOIS` : `+ valeur * 30` (approximatif, non calendaire).
> - `HEURES_UTILISATION` / `KILOMETRES` : **non calcule**, saisie manuelle.

> **Validation** : `frequence_valeur > 0` requis (HTTP 400 sinon). **Soft-delete** : `actif = FALSE` + `updated_at = NOW()`.

### 2.4 Onglet « Demandes »

Demandes de maintenance (corrective, preventive ou urgente).

Colonnes tableau : **Numero** `MR-NNNNN` (mono), Titre (auto-rempli a 80 caracteres si vide), Type (`CORRECTIVE`/`PREVENTIVE`/`URGENTE`), Priorite, Statut (badge couleur, cf. 4.1), Date.

Modale creation : titre + description (obligatoire) + symptomes + type + priorite + equipement + cout estime. Filtres : recherche + statut.

**Modale Detail (Eye)** : 4 sections — (1) Infos lecture seule, (2) Mise a jour Statut/Cout reel/Solution, (3) Pieces (cf. 2.6), (4) Interventions (cf. 2.5).

> **Suppression bloquee** si statut `EN_COURS` ou `TERMINE` (HTTP 400). Pour supprimer : passer d'abord en `DEMANDE`/`APPROUVE`/`PLANIFIE`/`EN_ATTENTE_PIECES`/`ANNULE`.

> **Cascade DELETE** : supprimer une demande supprime aussi ses `maintenance_pieces` et `maintenance_interventions` (DELETE physique sur les enfants).

### 2.5 Onglet « Interventions »

Interventions executees pour une demande. Colonnes : Numero demande parent (mono), Type (texte libre, ex. `Revision`, `Reparation`), Description, Duree (h), Statut (`EN_COURS`/`TERMINE`/`REPORTE`), Date. Modale edit : Statut + Duree + Observations. Filtres : recherche + statut.

> **Pas de creation depuis cet onglet** : les interventions se creent depuis la modale Detail d'une demande (cf. 2.4).

> **Auto-update demande** :
> - **Creation** intervention : demande `DEMANDE`/`APPROUVE`/`PLANIFIE` -> `EN_COURS` + `date_debut = NOW()`.
> - **Update** intervention `statut = TERMINE` : demande -> `TERMINE` + `date_fin = NOW()` + INSERT `maintenance_historique` (type `MAINTENANCE`, copie equipement/description/cout reel/temps reel).

### 2.6 Onglet « Pieces »

Pieces consommees lors d'une demande/intervention. Colonnes (lecture + suppression) : Nom, Reference, Demande parente (`#ID`), Quantite (defaut 1), Cout unitaire, Cout total (auto = `quantite * cout_unitaire` si vide). Total general en haut a droite. Filtres : recherche.

> **Pas d'ajout depuis cet onglet** : les pieces se creent depuis la modale Detail d'une demande (section Pieces).

> **Lien inventaire** : si `inventory_item_id` fourni a la creation, `UPDATE inventory_items SET quantite = GREATEST(0, quantite - %s)`. Le decrement n'est **PAS reverse** a la suppression (contrairement aux BT du Module 5).

### 2.7 Onglet « Alertes »

Alertes preventives generees a partir des planifications dont la prochaine maintenance approche.

Vue cartes : Badge priorite + Titre + Message + Type + Date alerte/echeance.

Boutons :
- **Lue** (Eye) si non lue : `PUT /alertes/{id} {lue: true}`.
- **Traiter** (CheckCircle2) si non traitee : `PUT /alertes/{id} {traitee: true, lue: true}` (ajoute `date_traitement = NOW()`).
- Badge **Traitee** (vert) si traitee.

Filtres : checkbox **Non lues seulement** + `<select>` priorite.

#### Bouton « Generer alertes »

`POST /maintenance/alertes/generate` :
1. Cree (si absent) un INDEX UNIQUE partiel `idx_maint_alertes_dedup` sur `(planification_id, type_alerte) WHERE traitee = FALSE AND planification_id IS NOT NULL` (race-safe via SAVEPOINT).
2. Selectionne les planifications actives avec `prochaine_maintenance <= CURRENT_DATE + seuil_alerte_jours` (defaut 7) ET sans alerte non traitee existante (LEFT JOIN anti-duplicate).
3. Pour chaque eligible : `MAINTENANCE_RETARD` si date passee, sinon `MAINTENANCE_DUE`. Titre = `Retard: {nom}` ou `Due: {nom}`.
4. Batch INSERT avec `ON CONFLICT DO NOTHING`. Max 500 alertes par appel.
5. Retourne `{generated: N, message: "N alertes generees"}`.

> **Tri serveur** : priorite (`CRITIQUE` -> `HAUTE` -> `NORMALE` -> autres) puis `date_alerte DESC`.

### 2.8 Onglet « Historique »

Historique chronologique des evenements par equipement. Vue cartes : Badge type evenement (`MAINTENANCE`/`PANNE`/`INSPECTION`/`REMPLACEMENT`/`MISE_EN_SERVICE`/`MISE_HORS_SERVICE`), Equipement, Description, Date + Technicien + Cout + Duree.

Modale **Nouvelle entree** : Type equipement + ID (obligatoire) + Type evenement (obligatoire) + Description + Cout + Technicien. Filtres : recherche + type evenement.

> **Auto-insertion** : une entree `MAINTENANCE` est creee automatiquement a la cloture d'une demande (`TERMINE` direct ou via intervention `TERMINE`). Copie `equipement_type`/`equipement_id`/`description`/`cout_reel`/`temps_reel_heures`.

> **Pas de modification/suppression** : aucun endpoint `PUT`/`DELETE`. Pour corriger : ajouter une entree complementaire.

### 2.9 Onglet « Statistiques »

10 cartes KPI : Total demandes, En cours (`EN_COURS`), En attente (statuts pre-execution), Terminees ce mois, Cout reel total, Cout estime total, Planifications actives, Planifications retard, Alertes non lues, Interventions ce mois.

2 panneaux : **Repartition par statut** (compteur par statut), **Repartition par priorite**.

> KPIs calcules a la volee par `GET /maintenance/statistics` (10 SELECT COUNT). Pas de cache.

---

## 3. Workflows pas-a-pas

### 3.1 Definir un type de maintenance

1. Onglet **Types** -> **+ Nouveau type**.
2. Saisir : **Nom** (obligatoire), description, categorie (`PREVENTIVE`/`CORRECTIVE`/`PREDICTIVE`), frequence (jours), duree estimee (h), cout estime ($), competences requises.
3. **Creer** -> `POST /maintenance/types`. Le type devient referencable depuis les planifications.

### 3.2 Planifier une maintenance recurrente

1. Onglet **Planification** -> **+ Nouvelle planification**.
2. Saisir : **Nom planification** (obligatoire), Type equipement (`INVENTORY`/`LOCATION`/`VEHICULE`), **ID equipement** (obligatoire), Type de maintenance (FK optionnel), Frequence (valeur + type), Derniere maintenance, Prochaine (optionnelle — auto-calculee pour `JOURS`/`SEMAINES`/`MOIS` si vide), Seuil alerte (jours, defaut 7), Priorite.
3. **Creer** -> `POST /maintenance/planification`. Le calcul auto applique `prochaine = derniere + frequence_valeur * {1/7/30} jours`. Pour `HEURES_UTILISATION`/`KILOMETRES`, saisir manuellement.

### 3.3 Suivre les compteurs d'un equipement

1. `POST /maintenance/compteurs` (pas d'UI dediee v2.0 — via API).
2. Body : type equipement + ID, type compteur (defaut `HEURES`), valeur actuelle. Date releve auto = `NOW()` si vide.

> Aucun lien automatique entre compteur et planification — comparer manuellement le dernier compteur avec le seuil pour les frequences a usage.

### 3.4 Creer une demande corrective (panne)

1. Onglet **Demandes** -> **+ Nouvelle demande**.
2. Saisir : Titre (auto-rempli a 80 caracteres de description si vide), **Description** (obligatoire), Symptomes, Type (`CORRECTIVE` defaut), Priorite, Type+ID equipement, Cout estime.
3. **Creer** -> `POST /maintenance/requests`. Backend genere `numero_demande = MR-NNNNN`, statut initial `DEMANDE`.

### 3.5 Approuver / planifier une demande

1. Onglet **Demandes** -> Eye -> modale Detail -> section **Mise a jour**.
2. Changer Statut `DEMANDE` -> `APPROUVE` -> `PLANIFIE` -> Enregistrer (`PUT /maintenance/requests/{id}`).

> Aucune validation backend sur les transitions : toute valeur dans la liste des 7 statuts est acceptee. L'UI structure le workflow.

### 3.6 Demarrer une intervention sur une demande

1. Modale Detail demande -> section **Interventions** -> **+ Nouvelle**.
2. Saisir : Type intervention (texte libre), **Description travaux** (obligatoire). `POST /maintenance/interventions`.
3. **Effets auto** : statut intervention `EN_COURS` ; si demande etait `DEMANDE`/`APPROUVE`/`PLANIFIE`, son statut passe `EN_COURS` + `date_debut = NOW()`.

### 3.7 Cloturer une intervention (et la demande)

1. Onglet **Interventions** -> icone Edit -> modale Modifier.
2. Statut `EN_COURS` -> `TERMINE` (ou `REPORTE`), Duree (heures), Observations -> `PUT /maintenance/interventions/{id}`.
3. **Effets auto au TERMINE** : demande parent passe `TERMINE` + `date_fin = NOW()` (sauf si deja `TERMINE`/`ANNULE`) + INSERT `maintenance_historique` (type `MAINTENANCE`, copie equipement / description / `cout_reel` / `temps_reel_heures`).

### 3.8 Ajouter une piece consommee

1. Modale Detail demande -> section **Pieces** -> **+ Ajouter**.
2. Saisir : **Nom piece** (obligatoire), Reference, Quantite (defaut 1), Cout unitaire. `POST /maintenance/pieces` calcule `cout_total = quantite * cout_unitaire`.
3. **Effet auto** : si `inventory_item_id` fourni (champ non expose dans modale v2.0), `UPDATE inventory_items SET quantite = GREATEST(0, quantite - quantite_piece)`.

> **Pas de re-credit auto** : `DELETE /maintenance/pieces/{id}` ne re-credite **pas** l'inventaire (contrairement aux lignes BT, Module 5).

### 3.9 Cloturer manuellement une demande

1. Modale Detail -> Mise a jour : Statut `TERMINE`, Cout reel, Solution -> `PUT /maintenance/requests/{id}`.
2. **Effet auto** : INSERT `maintenance_historique` (type `MAINTENANCE`).

> Les deux chemins (cloture manuelle ou via intervention `TERMINE`) inserent une entree historique.

### 3.10 Generer les alertes preventives

1. Onglet **Alertes** -> bouton **Generer alertes** -> `POST /maintenance/alertes/generate`.
2. Backend selectionne les planifications actives avec `prochaine_maintenance <= today + seuil_alerte_jours` (defaut 7) ET sans alerte non traitee active. Cree `MAINTENANCE_DUE` (futur) ou `MAINTENANCE_RETARD` (date passee). Max 500 alertes par appel. INDEX UNIQUE partiel + `ON CONFLICT DO NOTHING` evite les doublons.
3. Toast : `N alertes generees`.

> **A declencher regulierement** : aucun cron auto. Recommandation : 1x par jour ouvre (manuellement ou via scheduler externe).

### 3.11 Traiter une alerte

1. Onglet **Alertes** -> carte.
2. Bouton **Lue** : `lue = TRUE`. Bouton **Traiter** : `traitee = TRUE` + `lue = TRUE` + `date_traitement = NOW()`.
3. Une fois traitee, badge **Traitee** vert ; sort des compteurs `alertes_non_lues`.

> Tant que l'alerte non traitee existe pour une planification, `generate-alertes` ne creera pas de doublon (idempotent).

### 3.12-3.17 Endpoints IA Claude

Tous les endpoints IA suivent le meme pattern : verification credits (`check_ai_guard` + `_check_credits`), appel Claude, tracking `ai_usage`, deduction credits, retour `{result, usage: {input_tokens, output_tokens, cost_usd, model}}`. Les reponses JSON sont nettoyees des fences ` ``` ` ; en cas de parsing JSON echec : `{raw: "...", error: "Reponse non-JSON"}` (HTTP 200).

| Endpoint                       | Modele             | Body                                                       | Sortie                                                                                                  |
|--------------------------------|--------------------|------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `POST /ia/chat`                | claude-sonnet-4-6  | `{question, context?}`                                     | Texte libre (`response`)                                                                                |
| `POST /ia/diagnose`            | claude-opus-4-7    | `{equipement, symptomes, historique?}`                     | JSON : diagnostic probable, causes (probabilite), urgence, actions immediates, reparation, pieces, cout, prevention |
| `POST /ia/preventive`          | claude-opus-4-7    | `{equipement, utilisation, derniere_maintenance?}`         | JSON : taches (frequence/duree/pieces), inspections, pieces stock, cout annuel, benefices, alertes      |
| `POST /ia/analyze-intervention`| claude-opus-4-7    | `{demande_id?}` OU `{equipement, type_maintenance, ...}`   | JSON : score 0-100, points positifs, ameliorations, risques, verifications pre, outils, securite       |
| `POST /ia/checklist`           | claude-sonnet-4-6  | `{type_maintenance, equipement}`                           | Texte formate avec cases a cocher (EPI, LOTO, inspections, taches, verifs, documentation)               |
| `POST /ia/estimate-cost`       | claude-opus-4-7    | `{equipement, probleme, urgence?}`                         | JSON : pieces (liste+total), main d'oeuvre, frais, total min/max/probable, delai, options, recommandation |

> **Particularite analyze-intervention** : si `demande_id` fourni, le backend enrichit depuis la BD (titre, description, type, priorite, date planifiee, temps estime, cout estime, equipement).

> **Chat stateless** : pas d'historique conversationnel (chaque appel independant). L'UI doit gerer la concatenation cote client si necessaire.

> **Estimation cost** : tous montants en CAD.

### 3.18 Saisir manuellement une entree historique

1. Onglet **Historique** -> **+ Nouvelle entree**.
2. Type+ID equipement (obligatoire), Type evenement (obligatoire), Description, Cout, Technicien -> `POST /maintenance/historique`. Date auto = `NOW()` si vide.

> Cas d'usage : mise en service / hors service, panne hors processus formel, inspection externe.

---

## 4. Reference

### 4.1 Statuts demande (7 valeurs)

Source : `MaintenancePage.tsx:38-52` — `STATUT_COLORS` + `STATUT_OPTIONS`.

| Statut DB           | Couleur badge | Usage                                              |
|---------------------|---------------|----------------------------------------------------|
| `DEMANDE`           | jaune         | Statut initial a la creation                       |
| `APPROUVE`          | bleu          | Validee par le gestionnaire                        |
| `PLANIFIE`          | teal          | Date d'execution arretee                           |
| `EN_COURS`          | vert          | Intervention demarree (auto a la 1re intervention) |
| `EN_ATTENTE_PIECES` | ambre         | Bloquee en attendant approvisionnement             |
| `TERMINE`           | vert          | Cloturee (auto au TERMINE intervention)            |
| `ANNULE`            | gris          | Abandonnee                                         |

> **Aucune validation backend** sur les transitions — l'UI structure le workflow.

### 4.2 Statuts intervention (3 valeurs) | Priorites (4) | Types equipement (3)

**Statuts intervention** : `EN_COURS` (defaut) / `TERMINE` / `REPORTE`.

**Priorites** : `BASSE` (gris) / `NORMALE` (bleu, defaut) / `HAUTE` (jaune) / `CRITIQUE` (rouge).

**Types equipement** : `INVENTORY` (Module 10 Inventaire) / `LOCATION` (location chantier) / `VEHICULE` (Module 20 Logistique flotte). **Pas de lookup auto** du nom — l'UI affiche `INVENTORY #42` (type + id).

### 4.5 Types d'evenement historique (6 valeurs)

Source : `MaintenancePage.tsx:94-101` — `TYPE_EVENEMENT_OPTIONS`.

`MAINTENANCE` (auto a la cloture, vert) / `PANNE` (rouge) / `INSPECTION` (bleu) / `REMPLACEMENT` / `MISE_EN_SERVICE` / `MISE_HORS_SERVICE`.

### 4.6 Types d'alerte (5 valeurs) | Frequences (5) | Categories type (3) | Types maintenance (3)

| Type alerte               | Auto-genere ?                                |
|---------------------------|----------------------------------------------|
| `MAINTENANCE_DUE`         | OUI (planification dans seuil)               |
| `MAINTENANCE_RETARD`      | OUI (planification depassee)                 |
| `PANNE`/`INSPECTION_REQUISE`/`GARANTIE_EXPIRATION` | NON (creation manuelle)         |

| Frequence planification | Auto-calcul prochaine ?                    |
|-------------------------|--------------------------------------------|
| `JOURS`                 | OUI : `derniere + valeur jours`             |
| `SEMAINES`              | OUI : `derniere + valeur * 7 jours`         |
| `MOIS`                  | OUI : `derniere + valeur * 30 jours` (approx.) |
| `HEURES_UTILISATION` / `KILOMETRES` | NON (saisie manuelle)            |

**Categories type maintenance** (`maintenance_types`) : `PREVENTIVE` (defaut) / `CORRECTIVE` / `PREDICTIVE`.

**Types maintenance demande** (`maintenance_demandes.type_maintenance`) : `CORRECTIVE` (defaut) / `PREVENTIVE` / `URGENTE`.

### 4.10 Format numero demande

`MR-NNNNN` (5 chiffres aleatoires entre 10000 et 99999, genere via `_gen_numero("MR")`). **Pas race-safe** sur l'unicite — collision possible (probabilite ~1/90000 par creation). Si doublon, recreer la demande.

### 4.11 Endpoints principaux (41 endpoints)

| Entite              | Endpoints                                                                             |
|---------------------|---------------------------------------------------------------------------------------|
| Types               | `GET POST /maintenance/types` + `PUT DELETE /{id}` (5)                                |
| Planification       | `GET POST /maintenance/planification` + `PUT DELETE /{id}` + `GET /preventive` (legacy alias) (5) |
| Demandes            | `GET POST /maintenance/requests` + `GET PUT DELETE /{id}` (5)                         |
| Interventions       | `GET POST /maintenance/interventions` + `GET PUT DELETE /{id}` (5)                    |
| Pieces              | `GET POST /maintenance/pieces` + `DELETE /{id}` (3)                                   |
| Historique          | `GET POST /maintenance/historique` (2)                                                |
| Compteurs           | `GET POST /maintenance/compteurs` (2)                                                 |
| Alertes             | `GET POST /maintenance/alertes` + `PUT /{id}` + `POST /alertes/generate` (4)          |
| Statistics          | `GET /maintenance/statistics` (1)                                                     |
| **IA Claude (6)**   | `POST /maintenance/ia/{chat,diagnose,preventive,analyze-intervention,checklist,estimate-cost}` |

### 4.12 Tables PostgreSQL (8 tables)

Source : `secondary.py:1438-1598` — DDL `_DDL_MAINTENANCE_*` + `_ensure_maintenance_tables`.

| Table                       | Role                                                        |
|-----------------------------|-------------------------------------------------------------|
| `maintenance_types`         | Catalogue procedures-types                                  |
| `maintenance_planification` | Maintenances recurrentes par equipement                     |
| `maintenance_demandes`      | Demandes (numerotees `MR-NNNNN`)                            |
| `maintenance_interventions` | Interventions executees (FK demande_id)                     |
| `maintenance_pieces`        | Pieces consommees (FK demande_id ou intervention_id)        |
| `maintenance_historique`    | Historique chronologique par equipement                     |
| `maintenance_compteurs`     | Releves compteurs (heures / km / cycles)                    |
| `maintenance_alertes`       | Alertes generees                                            |

> **Table separee** : `logistics_equipment_maintenance` (Module 20 Logistique) — vue mini-maintenance des equipements de flotte uniquement, schema plus simple. Independante des 8 tables ci-dessus.

### 4.13 Modeles IA Claude (cout indicatif)

| Endpoint                   | Modele             | Tarif input/output (USD/1k tokens) |
|----------------------------|--------------------|------------------------------------|
| `/ia/chat`, `/ia/checklist`| claude-sonnet-4-6  | 0.003 / 0.015                      |
| `/ia/diagnose`, `/ia/preventive`, `/ia/analyze-intervention`, `/ia/estimate-cost` | claude-opus-4-7 | 0.015 / 0.075 |

> Multiplicateur 1.30 applique. Tracking dans `ai_usage` (feature = `maintenance_<endpoint>`). Decrement via `_deduct_credits()`.

### 4.14 Validations & limites

| Regle                                              | Effet                                                              |
|----------------------------------------------------|--------------------------------------------------------------------|
| `frequence_valeur` <= 0                            | HTTP 400 « La frequence doit etre superieure a 0 »                 |
| Update sans aucun champ                            | HTTP 400 « Aucun champ a mettre a jour »                           |
| Entite inexistante (PUT/DELETE)                    | HTTP 404 (« Demande/Type/Planification/Intervention/Piece/Alerte introuvable ») |
| Demande parent intervention inexistante            | HTTP 404 « Demande parent introuvable »                            |
| DELETE demande `EN_COURS` ou `TERMINE`             | HTTP 400 « Impossible de supprimer une demande en cours ou terminee » |
| IA sans credits                                    | HTTP 402 « Credits IA insuffisants/epuises »                       |
| IA module/service indisponible                     | HTTP 503                                                           |
| IA reponse trop longue (Claude 413)                | HTTP 413 « Requete trop volumineuse »                              |
| IA service surcharge (Claude 529)                  | HTTP 503 « Service IA temporairement surcharge »                   |
| Reponse IA non-JSON                                | `{raw: "...", error: "Reponse non-JSON"}` (HTTP 200)               |
| Limit listes (demandes/pieces/compteurs/alertes/interventions) | Max 100-500 selon endpoint                              |
| Generation alertes par appel                       | Max 500                                                            |

### 4.15 Effets de bord automatiques (cascading)

| Action                                              | Effet automatique                                                                                  |
|-----------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `POST /interventions` (demande non terminee)        | Demande passe `EN_COURS` + `date_debut = NOW()` (si etait `DEMANDE`/`APPROUVE`/`PLANIFIE`)         |
| `PUT /interventions/{id}` `{statut: "TERMINE"}`     | Demande parent `TERMINE` + `date_fin = NOW()` + INSERT historique                                  |
| `PUT /requests/{id}` `{statut: "TERMINE"}`          | INSERT historique (copie equipement/description/cout reel/temps reel)                              |
| `PUT /alertes/{id}` `{traitee: true}`               | `date_traitement = NOW()` ajoute au SET                                                            |
| `POST /pieces` avec `inventory_item_id`             | `UPDATE inventory_items SET quantite = GREATEST(0, quantite - %s)`                                 |
| `DELETE /pieces/{id}`                               | **Pas de re-credit** stock                                                                         |
| `DELETE /requests/{id}` (si OK)                     | Cascade DELETE `maintenance_pieces` + `maintenance_interventions`                                  |
| `DELETE /interventions/{id}`                        | Cascade DELETE `maintenance_pieces`                                                                |
| `POST /alertes/generate`                            | INDEX UNIQUE partiel + ON CONFLICT DO NOTHING (idempotent)                                         |
| `POST /planification` sans `prochaine_maintenance`  | Auto-calcul si `derniere` fourni + frequence in (`JOURS`/`SEMAINES`/`MOIS`)                        |

---

## 5. Integrations & FAQ

### 5.1 Integration Inventaire (Module 10)

- `maintenance_pieces.inventory_item_id` -> FK vers `inventory_items.id`.
- Creation piece avec `inventory_item_id` -> `UPDATE inventory_items SET quantite = GREATEST(0, quantite - quantite_piece)` (clamp >= 0).
- **Pas de mouvement dans `mouvements_stock`** (contrairement aux BT, Module 5).
- **Pas de re-credit auto** a la suppression.

### 5.2 Integration Logistique (Module 22)

> **Chevauchement controle** : deux systemes coexistent.

- **`/logistics/equipment/{id}/maintenance`** (Module 22) : table `logistics_equipment_maintenance`, schema simple. Vue rapide flotte.
- **`/maintenance/*`** (Module 24) : 8 tables, planification + compteurs + alertes + IA + historique riche.
- **Pas de synchronisation automatique** : un equipement flotte peut avoir des entrees dans les deux systemes.
- **Recommandation** : Logistique pour consultation ponctuelle + saisie rapide ; Maintenance pour suivi structure preventif/correctif.

### 5.3 Integration Bons de travail (Module 5)

- **Aucune integration directe**. BT planifient le travail humain ; demandes maintenance les interventions sur equipements.
- **Pas de creation auto** dans un sens ou l'autre.
- Workflow recommande : creer un BT en parallele d'une demande maintenance complexe + commentaire de reference dans chacun.

### 5.4 Integration Pointage / Heures employes

- **Aucune integration auto**. `temps_reel_heures` et `duree_heures` saisis manuellement.
- Pour cout main d'oeuvre : interroger `time_entries` separement (rapport manuel).

### 5.5 Integration Comptabilite

- **Pas d'ecriture journal auto** depuis Maintenance vers Comptabilite.
- `cout_reel` reste dans la table maintenance ; comptabiliser manuellement via Module 7.

### 5.6 Integration Calendrier / Notifications

- **Pas d'integration `/calendar`** auto. Suivi via onglets Tableau de bord (Planifications dues) ou Planification (badge Retard).
- **Aucun envoi email/SMS/push**. Les alertes vivent uniquement dans `maintenance_alertes` + onglet Alertes + badges sidebar.

### 5.7 Integration IA / Credits

- 6 endpoints IA Claude (`/ia/chat`, `/diagnose`, `/preventive`, `/analyze-intervention`, `/checklist`, `/estimate-cost`).
- Tous **deduisent des credits** (`tenant_settings.ai_credits_balance_usd`) via `_deduct_credits()`.
- Tracking dans `ai_usage` (feature = `maintenance_*`).
- **Modeles** : Sonnet 4.6 pour chat/checklist (textuel) ; Opus 4.7 pour diagnose/preventive/analyze/estimate (raisonnement JSON).
- Voir Module 25 IA pour gestion credits.

### 5.8 Integration Documents

- **Aucune integration UI**. Les colonnes `photos_avant`/`photos_apres` existent en base mais ne sont pas exposees v2.0.
- Pour photos/documents : Module 8 Dossiers.

### 5.10 FAQ

**Q : Comment savoir quel equipement correspond a `INVENTORY #42` ?**
R : Pas de lookup auto. Module 10 Inventaire (`id = 42`) ; pour `LOCATION`/`VEHICULE`, Module 20 Logistique.

**Q : Le cout reel demande inclut-il les pieces automatiquement ?**
R : **NON**. `cout_reel` saisi manuellement. Le total pieces est affiche dans la section Pieces ; pas de pre-remplissage auto.

**Q : Le stock inventaire est-il re-credite si je supprime une piece ?**
R : **NON** (contrairement aux BT). Corriger via mouvement ENTREE manuel dans Inventaire.

**Q : Pourquoi la prochaine maintenance n'est pas calculee pour `HEURES_UTILISATION`/`KILOMETRES` ?**
R : Calcul auto sur `JOURS`/`SEMAINES`/`MOIS` uniquement. Saisir manuellement et mettre a jour apres chaque entretien.

**Q : Le numero `MR-NNNNN` est-il garanti unique ?**
R : **NON** — random sans verification (~1/90000 collision). Si doublon, recreer.

**Q : « Generer alertes » doit-il etre execute regulierement ?**
R : **OUI**. Pas de cron auto. Recommandation : 1x par jour ouvre.

**Q : Une alerte traitee peut-elle etre re-generee ?**
R : Oui — l'INDEX UNIQUE cible `WHERE traitee = FALSE`, donc apres traitement une nouvelle alerte peut etre creee si la maintenance n'est pas faite.

**Q : Une demande TERMINE peut-elle etre reouverte ?**
R : Oui via PUT statut, mais `date_fin` reste rempli + duplicat historique au prochain TERMINE. Recommandation : creer une nouvelle demande de complement.

**Q : Le diagnostic IA est-il fiable a 100% ?**
R : **NON**. Le system prompt rappelle « La securite est toujours la priorite » et « Faire appel a des techniciens certifies ». Couts indicatifs — valider avec un technicien.

**Q : La checklist IA est-elle reglementaire CNESST ?**
R : **NON** — mentionne CNESST/LOTO mais pas un document reglementaire certifie. Pour procedure formelle, utiliser une procedure officielle validee SST.

**Q : Les pieces suggerees par IA sont-elles auto-ajoutees ?**
R : **NON** — l'IA suggere, l'utilisateur saisit manuellement (modale Detail demande -> Pieces).

**Q : Export PDF d'un bon d'intervention ?**
R : **NON** v2.0. Pas d'endpoint `generate-html`/`generate-pdf`. Contournement : copier le contenu de la modale Detail.

**Q : Compteurs integres aux capteurs IoT/GPS ?**
R : **NON** — saisie manuelle. Scripter des appels API pour integration externe.

**Q : Statistiques temps reel ou cachees ?**
R : **Temps reel** — 10 SELECT COUNT par appel. OK jusqu'a quelques milliers de demandes.

---

## 6. Recap one-pager

- **Module focus** : maintenance preventive + corrective des equipements (chantier + flotte + outillage). Distinct des BT (Module 5) et Logistique flotte (Module 22).
- **9 onglets** : Tableau de bord / Types / Planification / Demandes / Interventions / Pieces / Alertes / Historique / Statistiques.
- **8 tables PostgreSQL** auto-creees + 41 endpoints REST + 6 endpoints IA Claude.
- **Numerotation demandes** : `MR-NNNNN` (5 chiffres aleatoires, **pas race-safe**).
- **3 types equipement** : `INVENTORY` / `LOCATION` / `VEHICULE` (pas de lookup auto du nom).
- **5 frequences** : `JOURS` / `SEMAINES` / `MOIS` (auto-calcul OK), `HEURES_UTILISATION` / `KILOMETRES` (manuel).
- **7 statuts demande** : `DEMANDE` -> `APPROUVE` -> `PLANIFIE` -> `EN_COURS` (auto via 1re intervention) -> `TERMINE` (auto via intervention `TERMINE`) ; `EN_ATTENTE_PIECES` + `ANNULE` annexes.
- **3 statuts intervention** : `EN_COURS` / `TERMINE` / `REPORTE`. **4 priorites** : `BASSE` / `NORMALE` / `HAUTE` / `CRITIQUE`.
- **Auto-historique** insertion a la cloture (`TERMINE`).
- **Decrement stock** sur piece avec `inventory_item_id`. **Pas de re-credit** a la suppression.
- **Generation alertes** manuelle via `POST /alertes/generate` (pas de cron auto), idempotent.
- **6 IA Claude** : chat/checklist (Sonnet 4.6), diagnose/preventive/analyze/estimate (Opus 4.7). Tous deduisent credits.
- **Limites** : pas de PDF, pas de calendrier auto, pas notifications email/SMS, pas cron alertes, pas re-credit stock, numero MR non unique garanti, compteur usage non auto-lie planification.
- **Chevauchement Logistique** : `/logistics/equipment/{id}/maintenance` = vue mini (M20) ; `/maintenance/*` = vue complete (M22).

---

**Documentation generee a partir du code** : `secondary.py` (sections lignes 1366-7549), `MaintenancePage.tsx` (1566 lignes), `maintenance.ts` (444 lignes).

**Manuels lies** :
- Module 5 (Bons de travail employes) — `05-bons-de-travail.md`
- Module 10 (Inventaire — pieces detachees) — `10-inventaire.md`
- Module 25 (IA — credits) — `12-ia.md`
- Module 20 (Logistique — flotte/livraisons) — `22-logistique.md` (a venir)
