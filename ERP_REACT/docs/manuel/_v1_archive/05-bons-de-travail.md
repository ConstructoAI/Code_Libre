# Manuel utilisateur — Module Bons de Travail (BT)

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (contremaîtres, chargés de projet, équipes terrain)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Liste, vues et constructeur](#2-interface--liste-vues-et-constructeur)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Champs, statuts, calculs](#4-reference--champs-statuts-calculs)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Bons de Travail

Le module **Bons de Travail (BT)** est l'outil central de gestion des interventions sur chantier. Chaque bon de travail constitue une **fiche d'intervention** détaillée représentant une tâche concrète assignée à une ou plusieurs équipes terrain.

Il vous permet de :

- **Documenter** les matériaux, fournitures et équipements requis pour l'intervention
- **Planifier** les opérations (démolition, excavation, fondation, etc.) avec leurs heures prévues
- **Assigner** les employés et sous-traitants affectés à la tâche, avec leur rôle
- **Suivre** en temps réel l'avancement, les heures pointées et la progression globale
- **Communiquer** avec les équipes via un fil de commentaires intégré
- **Archiver** chaque intervention par génération d'un document HTML imprimable

Le BT est la passerelle opérationnelle entre la planification du projet et l'exécution sur le terrain.

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **Bon de Travail (BT)** | Document d'intervention identifié par un numéro automatique au format `BT-NNNNN` (ex: `BT-00123`) |
| **Lignes (matériaux)** | Liste des produits/fournitures requis (qté, unité, prix unitaire) |
| **Opérations** | Tâches techniques composant le BT (avec heures prévues / réelles) |
| **Assignations** | Employés ou ressources affectés au BT, avec rôle |
| **Commentaires** | Fil de discussion (chat) en temps réel |
| **Time entries** | Heures pointées par les employés (lien module Pointage) |

### 1.3 Workflow (5 statuts)

```
BROUILLON  →  EN_COURS  ⇄  EN_PAUSE  →  TERMINE
                                    ↘
                                      ANNULE
```

- **BROUILLON** : BT en préparation, modifiable. Aucun pointage possible.
- **EN_COURS** : BT actif, équipes peuvent pointer.
- **EN_PAUSE** : BT temporairement suspendu (météo, attente matériaux). Réversible.
- **TERMINE** : Intervention complétée; BT verrouillé.
- **ANNULE** : BT annulé (suppression douce).

### 1.4 Lien parent

Chaque BT est rattaché à un **Projet** via `project_id`. Cette liaison garantit que :
- Les heures pointées sont consolidées au niveau du projet
- Les coûts matériaux remontent dans le suivi budgétaire
- Le BT apparaît dans l'historique du projet

**Auto-lien Dossier 360** : si le projet parent dispose d'un Dossier 360, le BT y est ajouté automatiquement.

### 1.5 Accès au module

- **Sidebar** → **Bons de Travail**
- **URL directe** : `/bons-travail`

### 1.6 Permissions

- **Tous les utilisateurs authentifiés** du tenant peuvent CRUD
- Aucun rôle particulier requis
- **Suppression = soft-delete** (statut → ANNULE) : le BT reste en base pour traçabilité

---

## 2. Interface — Liste, vues et constructeur

### 2.1 Page Bons de Travail (`/bons-travail`)

3 onglets : **Liste** | **Opérations (vue globale)** | **Détail BT**

### 2.2 KPI Header (4 cartes)

| Carte | Source | Description |
|---|---|---|
| Total BT | count(bons_travail) | Nombre total tous statuts |
| En cours | statut = EN_COURS | BT actifs sur le terrain |
| Terminés | statut = TERMINE | BT finalisés |
| Montant total | Σ montant_total | Somme des montants visibles |

### 2.3 Vue Liste

```
+----------------------------------------------------------------------+
| [+ Nouveau BT]  [Recherche...]  [Statut v]  [Priorité v]             |
+----------------------------------------------------------------------+
| Numéro    | Nom     | Statut    | Priorité | Projet | Dates | Montant|
|-----------|---------|-----------|----------|--------|-------|--------|
| BT-00123  | Reno Y  | En cours  | Haute    | P-42   | ...   | 5 200$ |
| BT-00124  | Excav Z | Brouillon | Normale  | P-43   | ...   | 12 800$|
+----------------------------------------------------------------------+
| [< 1 2 3 ... >]                            [10 / 25 / 50 par page v] |
+----------------------------------------------------------------------+
```

**Colonnes** : Numéro (BT-NNNNN), Nom, Statut (badge), Priorité (badge), Projet, Date début, Date fin, Date échéance, Montant. Édition inline pour les dates. Tri par colonne.

**Filtres** : recherche libre (numéro/nom/projet), filtre statut (multi-sélection), filtre priorité.

### 2.4 Vue Opérations (globale)

Liste paginée de toutes les opérations à travers tous les BT, filtrable par statut. Utile pour le suivi transversal de la charge atelier ou chantier.

### 2.5 Constructeur BT (mode création)

#### Section Entête
| Champ | Type | Obligatoire |
|---|---|---|
| Nom | Texte | Non |
| Priorité | Liste (Basse/Normale/Haute/Urgente) | Oui |
| Projet | Dropdown | Oui |
| Date début, fin, échéance | Date | Non |
| Notes | Textarea | Non |

#### Section Opérations pending
Tableau local avant création : Poste/Type, Qté, Fournisseur, Heures prévues, Statut.

#### Section Matériaux pending
Sélection produit inventaire OU saisie libre. Description, qté, prix → montant calculé auto.

Bouton **Créer** valide l'ensemble en une seule transaction.

### 2.6 Vue Détail (BT sélectionné)

#### Entête (lecture)
Numéro, Nom, Statut (badge), Priorité, Projet (lien). Boutons workflow contextuels :

| Statut courant | Boutons disponibles |
|---|---|
| BROUILLON | **Démarrer** → EN_COURS, **Annuler** |
| EN_COURS | **Pause**, **Terminer**, **Annuler** |
| EN_PAUSE | **Reprendre**, **Annuler** |

Boutons permanents : **Éditer**, **Supprimer** (→ ANNULE), **Prévisualiser HTML**.

#### Section Lignes (matériaux)
Tableau : Description, Qté, Unité, Prix unitaire, Montant. Édition inline. Bouton **« + Ajouter ligne »** → modale (sélection produit inventaire ou saisie libre).

> **À savoir** : si la ligne est liée à un produit inventaire, un mouvement de stock SORTIE est créé automatiquement.

#### Section Assignations employés
Tableau : Nom, Rôle, Date assignation. Bouton **« + Assigner employé »** → modale (sélection + rôle optionnel).

#### Section Commentaires (chat)
Fil chronologique. Champ textarea + bouton **Envoyer**. Affichage : Auteur, Contenu, Timestamp.

#### Section Opérations (tâches du BT)
Tableau : Nom, Description, Qté, Assigné, Fournisseur, Heures prévues / réelles, Statut, Dates. Édition inline. Bouton **« + Ajouter opération »** → form modal.

Totaux : Σ heures prévues, Σ heures réelles.

### 2.7 Vue mobile

Cards empilées avec menu **⋮** pour actions principales (Ouvrir, Démarrer/Pause/Terminer, Supprimer).

### 2.8 Vue Kanban (achats matériaux)

```
+-------------+-------------+-------------+-------------+
| À commander | En attente  | Reçu        | Facturé     |
|             | livraison   |             |             |
+-------------+-------------+-------------+-------------+
| [Vis 3"]    | [OSB 5/8]   | [Béton]     | [Acier]     |
| BT-00124    | BT-00123    | BT-00122    | BT-00120    |
+-------------+-------------+-------------+-------------+
```

Drag-drop d'une carte → change le statut achat. Clic sur carte → ouvre le BT parent.

---

## 3. Workflows pas-à-pas

### 3.1 Créer un BT
1. `/bons-travail` → onglet Détail → bouton **« Nouveau bon de travail »**
2. Renseigner Nom (optionnel — utilise nom_projet si vide)
3. Choisir Priorité (défaut Normale)
4. Sélectionner Projet (obligatoire)
5. Renseigner Dates (début, fin, échéance)
6. Ajouter Notes
7. (Optionnel) Ajouter opérations et matériaux pré-création
8. Cliquer **Créer**

> **À savoir** : numéro `BT-NNNNN` généré automatiquement.

### 3.2 Démarrer (BROUILLON → EN_COURS)
1. Sélectionner BT
2. Bouton **Démarrer**
3. Statut bascule à EN_COURS

### 3.3 Mettre en pause
1. BT en EN_COURS → bouton **Pause** → EN_PAUSE
2. Bouton **Reprendre** → EN_COURS

### 3.4 Terminer
1. BT en EN_COURS → bouton **Terminer**
2. Vérifier toutes les opérations au statut Termine
3. Statut → TERMINE

### 3.5 Annuler (soft-delete)
1. Bouton **Annuler** (depuis n'importe quel statut)
2. Confirmer
3. Statut → ANNULE (BT pas supprimé physiquement)

### 3.6 Ajouter une ligne (matériau)
1. Section Lignes → **« + Ajouter ligne »**
2. Choix 1 : Sélection produit inventaire (auto-remplit description, unité, prix)
3. Choix 2 : Saisie libre
4. Le Montant est calculé (qté × prix)
5. Cliquer Ajouter

> **À savoir** : si lien inventaire, mouvement de stock SORTIE créé. Stock peut devenir négatif (backorder).

### 3.7 Modifier ou supprimer une ligne
- Édition inline
- Icône poubelle pour supprimer

> **Attention** : la suppression NE re-crédite PAS le stock. Faire un mouvement ENTRÉE manuel si besoin.

### 3.8 Ajouter une opération (tâche)
1. Section Opérations → **« + Ajouter opération »**
2. Choisir Type (Démolition, Excavation, Fondation, etc.)
3. Quantité (défaut 1)
4. Assigné à (employé)
5. Fournisseur (défaut « Interne »)
6. Heures prévues
7. Statut initial : « En attente »
8. Dates
9. Cliquer Ajouter

### 3.9 Suivre la progression d'une opération
- Heures réelles s'incrémentent automatiquement quand un employé pointe sur le BT
- Progression % = min(heures réelles / heures prévues × 100, 100)
- Statut à mettre à jour manuellement (En attente → En cours → Terminé)

### 3.10 Assigner un employé
1. Section Assignations → **« + Assigner employé »**
2. Choisir employé
3. Saisir Rôle optionnel (Chef d'équipe, Soudeur, etc.)
4. Cliquer Assigner

### 3.11 Retirer un employé
Icône poubelle à côté du nom.

### 3.12 Ajouter un commentaire (chat)
1. Section Commentaires
2. Saisir le texte
3. Cliquer Envoyer
4. Apparaît avec auteur + timestamp

> **À savoir** : utile comme journal de bord chantier (problèmes, retards, photos via upload).

### 3.13 Modifier une opération
Édition inline dans le tableau Opérations (heures réelles, statut, dates, etc.).

### 3.14 Supprimer une opération
Icône poubelle + confirmer.

### 3.15 Générer un HTML imprimable
1. BT sélectionné → bouton **Prévisualiser HTML**
2. Nouvelle fenêtre avec rendu
3. Imprimer ou enregistrer en PDF (Ctrl+P)

### 3.16 Vue Kanban achats
1. Onglet Kanban
2. Colonnes : À commander / En attente livraison / Reçu / Facturé
3. Drag-drop pour changer statut
4. Sauvegarde immédiate

### 3.17 Vue Gantt des BT
1. Module Suivi → source « Bons de Travail »
2. Visualisation chronologique avec opérations comme sous-tâches
3. Drag-drop pour ajuster dates
4. Création de dépendances (BT → BT) par drag du dot

### 3.18 Filtrer la liste
- Recherche libre (numéro/nom/projet)
- Filtre statut (multi-sélection)
- Filtre priorité

### 3.19 Édition rapide des dates (inline)
Cliquer directement sur la cellule date dans le tableau. Sélecteur s'affiche. Choisir → sauvegarde auto.

### 3.20 Mise à jour en masse via Kanban
1. Vue Kanban (BT par statut)
2. Drag-drop d'un BT vers une autre colonne
3. Statut mis à jour immédiatement

> **À savoir** : la vue Kanban est idéale pour le suivi de production quotidien.

---

## 4. Référence — Champs, statuts, calculs

### 4.1 Champs Bon de Travail (entête)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Numéro | Auto | Oui | Format `BT-NNNNN` (généré après INSERT) |
| Nom | Texte | Non | Si vide, utilise nom_projet |
| Statut | Énum (5) | Oui | BROUILLON / EN_COURS / EN_PAUSE / TERMINE / ANNULE |
| Priorité | Énum (4) | Non | BASSE / NORMALE / HAUTE / URGENTE (défaut NORMALE) |
| Projet (project_id) | FK | Non | Lien vers Projet |
| Date début | Date | Non | Date début prévu |
| Date fin | Date | Non | Date fin prévue |
| Date échéance | Timestamp | Non | Date limite |
| Montant total | Décimal | Auto | Σ montant_ligne (recalculé auto) |
| Notes | Texte long | Non | Notes libres |
| created_at, updated_at | Timestamp | Auto | Horodatage |

### 4.2 Champs Ligne (matériau)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Description | Texte | Oui | Description du matériau |
| Quantité | Décimal | Oui | Quantité |
| Unité | Texte | Non | m, kg, pce, L, h, etc. |
| Prix unitaire | Décimal | Oui | $ CAD |
| Montant ligne | Décimal | Auto | qté × prix unitaire |
| Sequence | Entier | Auto | Ordre d'affichage |
| Produit ID | FK | Non | Lien vers inventaire (déclenche mouvement stock) |

### 4.3 Champs Opération

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Nom | Texte | Non | Type opération (voir 4.9) |
| Description | Texte | Non | Détails |
| Quantité | Décimal | Non | Défaut 1 |
| Employee_id | FK | Non | Assigné à |
| Fournisseur | Texte | Non | Défaut « Interne » |
| Heures prévues | Décimal | Non | Budget heures |
| Heures réelles | Décimal | Auto | Calculé via Pointage |
| Statut | Énum (4) | Non | En attente / En cours / Termine / Annule |
| Date début, fin | Date | Non | Planning |
| Poste travail | Texte | Non | Section/poste |
| Sequence_number | Entier | Auto | Ordre |

### 4.4 Champs Assignation employé

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Employee_id | FK | Oui | ID employé |
| Role | Texte | Non | Chef d'équipe, Soudeur, etc. |
| Created_at | Timestamp | Auto | Date assignation |

### 4.5 Champs Commentaire

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| User_id | Texte | Auto | Nom utilisateur |
| Comment_text | Texte | Oui | Contenu |
| Created_at | Timestamp | Auto | Horodatage |

### 4.6 Statuts BT (5)

| Statut | Couleur | Transitions |
|---|---|---|
| BROUILLON | Gris | → EN_COURS, ANNULE |
| EN_COURS | Bleu | → EN_PAUSE, TERMINE, ANNULE |
| EN_PAUSE | Ambre | → EN_COURS, ANNULE |
| TERMINE | Vert | (terminal) |
| ANNULE | Rouge | (terminal, soft-delete) |

### 4.7 Statuts Opération (4)

| Statut | Description |
|---|---|
| En attente | Pas démarrée |
| En cours | En exécution |
| Termine | Complétée |
| Annule | Annulée |

### 4.8 Priorités (4)

| Priorité | Description |
|---|---|
| BASSE | À planifier, sans urgence |
| NORMALE | Défaut |
| HAUTE | Urgent, à traiter en priorité |
| URGENTE | Priorité maximum |

### 4.9 Types d'opération typiques

Démolition, Excavation, Fondation, Charpenterie, Toiture, Plomberie, Électricité, Plâtrage, Peinture, Finition, Aménagement paysager, Autres. (Liste extensible via configuration.)

### 4.10 Calculs

#### Montant total BT
```
montant_total = SUM(montant_ligne) FROM formulaire_lignes WHERE formulaire_id = bt_id
```
Recalculé à chaque ajout/modification de ligne.

#### Progression opération
Si heures_prevues > 0 et heures_reelles définies :
```
progression % = min(heures_reelles / heures_prevues × 100, 100)
```
Sinon : 0

#### Durée (Gantt)
```
durée_jours = (date_fin - date_début).days
```

### 4.11 Génération du numéro

- Format Python : `f"BT-{id:05d}"` (ex: BT-00123, BT-00042)
- Race-safe : pas de collision possible (numéro = ID auto-incrémenté)

### 4.12 Auto-lien dossier 360

Si chaîne **Projet → Opportunité → Dossier 360** existe, le BT est ajouté automatiquement au dossier (relation many-to-many).

### 4.13 Limites système

| Élément | Limite |
|---|---|
| Pagination | 20 par défaut, max 100 |
| Lignes par BT | Pas de limite stricte |
| Opérations par BT | Pas de limite |
| Assignations | Pas de limite |
| Commentaires | Pas de limite |
| Stock négatif | Permis (backorder) |

### 4.14 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Numéro BT | BT-NNNNN | BT-00123 |
| Devise | $ CAD | 5 200,50 $ |
| Date | AAAA-MM-JJ | 2026-04-25 |
| Pourcentage | XX,X % | 75,0 % |

> **Convention FR-QC** : virgule comme séparateur décimal, espace insécable comme séparateur de milliers.

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module | Relation | Manifestation |
|---|---|---|
| **Projets** | BT.project_id → projects.id | Sélection projet à la création, lien dans détail |
| **Dossiers 360** | Auto-lien si projet → opportunité → dossier | BT ajouté au dossier (many-to-many) |
| **Devis** | Lignes peuvent provenir d'un devis | Pas d'import auto, copie manuelle |
| **Bons de Commande / Achats** | Matériaux du BT génèrent des achats | Vue Kanban achats |
| **Pointage** | Heures pointées rattachées au BT | Alimente operations.heures_reelles auto |
| **Inventaire (Produits)** | Lien produit_id sur les lignes | Mouvement stock SORTIE auto à l'ajout |
| **Employés** | Assignations via bt_assignations | Sélection employé + rôle |
| **Suivi (Gantt)** | Source « Bons de Travail » | Visualisation chronologique avec opérations |

> **À retenir** : la plupart de ces intégrations sont **automatiques**. Aucun script à actionner — il suffit de remplir correctement les champs à la création.

### 5.2 Cas particuliers

- **BT sans projet** : possible (project_id = NULL). Utile pour un BT « ad hoc » non rattaché.
- **BT sans nom** : utilise nom_projet ou numéro automatiquement.
- **Stock négatif** : permis (backorder). Le stock peut descendre sous 0 pour ne pas bloquer le chantier.
- **Suppression d'une ligne** : ne re-crédite PAS le stock automatiquement. Faire un mouvement ENTRÉE manuel.
- **Suppression d'un BT** : statut → ANNULE (soft-delete). Reste en base pour traçabilité.
- **BT sans opérations** : possible. Les heures pointées ne seront pas agrégées par opération.
- **Heures réelles = 0 alors que pointé** : vérifier que l'employé est assigné à une opération du BT.
- **Modification après TERMINE** : possible mais déconseillée (intégrité des rapports).

### 5.3 Astuces

- **Modèle de BT** : pas de duplication directe — recopier manuellement les opérations d'un BT type
- **Mouvement stock automatique** : suivi consommation matériaux en temps réel sans intervention de l'approvisionnement
- **Commentaires comme journal de bord** : documenter problèmes, retards, photos chantier
- **Vue Kanban achats** : suivi visuel rapide des matériaux à commander vs reçus
- **Vue Gantt** : planifier plusieurs BT d'un projet en parallèle
- **Auto-lien dossier 360** : un BT créé sur un projet lié à un dossier 360 est automatiquement ajouté à ce dossier

### 5.4 FAQ

**Q : Comment créer plusieurs BT pour un même projet ?**
R : Créer chaque BT individuellement avec le même project_id. Chacun aura son propre numéro BT-NNNNN unique.

**Q : Pourquoi le stock peut-il devenir négatif ?**
R : Le système permet le backorder pour ne pas bloquer les chantiers. Faire un mouvement ENTRÉE quand le matériau arrive.

**Q : Les heures réelles ne se mettent pas à jour, pourquoi ?**
R : Vérifier que l'employé est bien assigné au BT (et idéalement à l'opération concernée), et qu'il pointe sur ce BT depuis le module Pointage.

**Q : Peut-on supprimer définitivement un BT ?**
R : Non. Le DELETE est un soft-delete (statut → ANNULE). Pour purge physique, contacter l'administrateur DB.

**Q : Comment ajouter un fichier (photo, plan) à un BT ?**
R : Via les commentaires (upload) ou via le Dossier 360 lié au projet/BT.

**Q : Le numéro BT est-il unique global ou par projet ?**
R : Unique global au niveau du tenant. Format BT-NNNNN avec ID auto-incrémenté.

**Q : Comment changer le statut de plusieurs BT en masse ?**
R : Utiliser la vue Kanban et faire du drag-drop. Pas d'action multi-sélection dans la liste classique.

**Q : Peut-on copier un BT existant comme modèle ?**
R : Pas de fonction « Dupliquer » directement dans cette version. Recréation manuelle nécessaire.

**Q : Que se passe-t-il si je change le projet d'un BT ?**
R : Le lien est mis à jour. Le lien automatique au dossier 360 est aussi mis à jour si applicable.

**Q : Les opérations peuvent-elles avoir leurs propres dépendances ?**
R : Pas dans cette version. Les dépendances Gantt sont au niveau BT (BT → BT).

### 5.5 Limites connues

- Pas de duplication de BT en un clic
- Pas de sélection multiple pour actions de masse (workaround : Kanban)
- Pas d'upload de fichiers directement sur le BT (utiliser commentaires ou Dossier 360)
- Pas de re-crédit automatique de stock à la suppression d'une ligne
- Pas d'historique des modifications visible côté UI
- Pas de templates/modèles par type de chantier
- Dépendances Gantt limitées à fin → début (pas de chemin critique)

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Bons de Travail — v1.0 — 2026-04-25*
