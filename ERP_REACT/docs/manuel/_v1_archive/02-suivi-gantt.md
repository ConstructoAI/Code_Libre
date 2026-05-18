# Manuel utilisateur — Module Suivi / Gantt

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (chefs de projet, planificateurs, gestionnaires)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface et écrans](#2-interface-et-ecrans)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence des champs, sources et formats](#4-reference-des-champs-sources-et-formats)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Suivi / Gantt

Le module **Suivi / Gantt** est l'outil central de **planification et de visualisation chronologique** des activités de votre entreprise de construction. Il vous permet de voir, en un seul coup d'œil, tout ce qui est en cours, ce qui s'en vient prochainement, ainsi que les liens et dépendances entre vos différentes tâches.

Un **diagramme de Gantt** est une représentation visuelle d'un calendrier de projet : chaque tâche y est illustrée par une barre horizontale dont la longueur correspond à sa durée, et dont la position sur l'axe du temps indique ses dates de début et de fin. C'est l'outil privilégié des planificateurs depuis plus d'un siècle pour orchestrer des projets de construction.

Que vous soyez chef de projet, planificateur ou gestionnaire, ce module vous donne une vue d'ensemble claire de la charge de travail, des échéances critiques et de l'avancement réel de vos chantiers.

### 1.2 Concepts-clés

- **Diagramme de Gantt** : représentation graphique sous forme de barres horizontales positionnées sur une chronologie, où chaque barre représente une tâche ou une activité.
- **Dépendance** : lien logique entre deux tâches indiquant que l'une doit être terminée avant que l'autre puisse commencer (relation de type « fin à début »).
- **Phase** : sous-étape d'un projet permettant de regrouper et de structurer les tâches en grandes catégories (par exemple : excavation, fondations, charpente).
- **Progression** : pourcentage d'avancement d'une tâche, exprimé de 0 % à 100 %. Par défaut, le système calcule automatiquement la progression selon l'écoulement du temps (jours écoulés divisés par la durée totale).
- **Source de données** : type d'éléments que vous choisissez d'afficher dans le module. Cinq sources sont disponibles (voir 1.3).

### 1.3 Sources de données disponibles

Le module peut afficher cinq catégories d'éléments distinctes. Vous les sélectionnez à l'aide des boutons situés dans l'entête du module :

1. **Ventes** — Opportunités commerciales et contrats en cours de négociation.
2. **Projets** — Chantiers et mandats actifs de votre entreprise.
3. **Bons de Travail (BT)** — Tâches assignées aux équipes sur le terrain.
4. **Devis** — Soumissions en préparation et leurs échéances de remise.
5. **Bons de Commande (BC)** — Achats auprès des fournisseurs et livraisons attendues.

> **À noter** : une seule source est affichée à la fois. Le changement entre les sources est instantané grâce au sélecteur en haut de l'écran.

### 1.4 Vues disponibles

Le module offre **trois modes d'affichage** que vous pouvez basculer selon vos besoins :

- **Kanban** : vue organisée par colonnes selon le statut des éléments (style « post-it »). Idéale pour gérer rapidement le flux de travail.
- **Gantt** : chronologie avec barres horizontales sur une timeline. Parfaite pour visualiser les durées et les chevauchements.
- **Calendrier** : vue calendaire mensuelle affichant les événements jour par jour. Utile pour repérer les échéances dans un contexte mensuel.

### 1.5 Accès au module

Vous pouvez accéder au module Suivi / Gantt de deux façons :

- Depuis la **barre latérale** (sidebar), cliquez sur **Suivi**.
- Par **URL directe** : `/suivi`

### 1.6 Permissions

- **Tout utilisateur authentifié** dans Constructo peut consulter le module et y apporter des modifications, incluant l'édition inline des dates, des statuts et des assignations.
- **Les modifications sont enregistrées immédiatement** côté serveur dès que vous validez un changement, sans étape de sauvegarde manuelle.
- **Aucune restriction par rôle** n'est appliquée visuellement dans l'interface : tous les utilisateurs disposent des mêmes capacités d'action.

---

## 2. Interface et écrans

Cette section décrit l'organisation visuelle du module Suivi / Gantt et explique le rôle de chaque zone d'écran.

### 2.1 Layout général de la vue Gantt

L'écran est divisé en quatre zones : la barre supérieure (sélection de la source et de la vue, recherche, filtres, actions), le tableau gauche (liste des éléments avec colonnes éditables), la chronologie droite (timeline graphique) et la barre inférieure (zoom et raccourcis temporels).

```
+---------------------------------------------------------------------------+
| [Source: Ventes|Projets|BT|Devis|BC]    [Vue: Kanban|Gantt|Calendrier]   |
| [Recherche...] [Filtres v]                       [Export CSV][Imprimer]  |
+----------------------------+----------------------------------------------+
| TABLEAU GAUCHE (605px)     | CHRONOLOGIE DROITE (scrollable)              |
| +----+----+----+----+----+ |  Avr 2026          Mai 2026                  |
| |Nom |Stat|Asgn|Deb |Fin | |  S15 S16 S17 S18  S19 S20 S21                |
| +----+----+----+----+----+ |                                              |
| |P-1 |... |... |... |... | |  ###########..  70%                          |
| | > Phase 1                |     ##########  100%                         |
| | > Phase 2                |             ####....  40%                    |
| +----+----+----+----+----+ |                                              |
+----------------------------+----------------------------------------------+
| Zoom: [Semaine|2 Sem|Mois]                      [Aujourd'hui] [Refresh]  |
+---------------------------------------------------------------------------+
```

Le tableau gauche reste visible (sticky) lorsque vous faites défiler la chronologie horizontalement. Vous pouvez ajuster sa largeur en faisant glisser la bordure verticale entre les deux zones.

### 2.2 Tableau gauche (colonne sticky)

Le tableau gauche affiche en mode liste tous les éléments de la source sélectionnée. Sa largeur totale par défaut est de 605 pixels, et il est entièrement redimensionnable.

Les colonnes par défaut sont :

- **Nom** : titre de l'élément (projet, bon de travail, devis, etc.). Une icône en chevron permet d'ouvrir (expand) ou de fermer (collapse) les phases sous un projet parent.
- **Statut** : badge coloré indiquant l'état de l'élément. Un clic sur le badge ouvre une liste déroulante pour modifier le statut directement dans le tableau (édition inline).
- **Assigné** : nom de l'employé responsable. Un clic ouvre un sélecteur d'employé inline.
- **Début** : date de début, modifiable directement par un champ date inline.
- **Durée** : nombre de jours, calculé automatiquement (Fin moins Début). Cette colonne n'est pas modifiable directement.
- **Fin** : date de fin, modifiable par un champ date inline.
- **%** : pourcentage de progression, calculé automatiquement. Une mini barre de progression visualise l'avancement.

**Tri** : un clic sur l'entête de colonne trie la liste en ordre croissant ; un second clic inverse l'ordre. Une petite flèche indique la colonne et le sens du tri actif.

**Recherche** : la barre de recherche en haut de l'écran filtre la liste par nom (insensible à la casse).

### 2.3 Zone chronologie (timeline droite)

La chronologie présente graphiquement les barres de Gantt sur un calendrier horizontal défilable.

**Échelle** : trois modes de zoom disponibles, sélectionnables au bas de l'écran :

- **Semaine** : 55 px par jour, recommandé pour un sprint court de 1 à 2 mois.
- **2 Semaines** : 28 px par jour, idéal pour la planification trimestrielle.
- **Mois** : 11 px par jour, pour une vue annuelle synthétique.

**En-têtes** : la chronologie présente deux niveaux d'entêtes superposés. La ligne supérieure affiche les mois et les semaines ; la ligne inférieure affiche les jours individuels.

**Aujourd'hui** : une ligne verticale colorée traverse toute la chronologie pour marquer la date du jour.

**Weekends** : les samedis et dimanches sont mis en évidence par un fond grisé pour faciliter le repérage des jours ouvrables.

**Barres de Gantt** :
- La couleur de la barre dépend du statut (En cours = bleu, Terminé = vert, En attente = jaune, Annulé = rouge).
- Un remplissage interne plus foncé indique le pourcentage de progression.
- Le survol affiche une infobulle avec nom, dates, %, employé assigné.
- Un clic sur la barre ouvre la fiche détaillée de l'élément.

**Dépendances** : des flèches courbes en SVG relient la fin d'une barre au début d'une autre lorsqu'une dépendance fin vers début est définie.

### 2.4 Filtres globaux

Le panneau Filtres regroupe les options suivantes :

- **Recherche** : barre de texte pour filtrer par nom.
- **Statut** : multi-sélection ; vous pouvez activer plusieurs statuts simultanément.
- **Priorité** : filtre par niveau de priorité.
- **Période** : champs Date début et Date fin pour limiter la plage chronologique affichée.
- **Réinitialiser** : un bouton vide tous les filtres en un clic.

### 2.5 Vue Kanban

La vue Kanban présente vos éléments sous forme de colonnes verticales correspondant aux statuts.

```
+-----------+-----------+-----------+-----------+
|En attente | En cours  | Terminé   | Annulé    |
|    (4)    |    (7)    |    (12)   |    (1)    |
+-----------+-----------+-----------+-----------+
| [carte]   | [carte]   | [carte]   | [carte]   |
| [carte]   | [carte]   | [carte]   |           |
|           | [carte]   | [carte]   |           |
+-----------+-----------+-----------+-----------+
```

Les cartes sont déplaçables d'une colonne à l'autre par glisser-déposer pour changer instantanément le statut de l'élément. Un compteur en haut de chaque colonne indique le nombre d'éléments présents.

### 2.6 Vue Calendrier

La vue Calendrier propose un affichage mensuel classique sous forme de grille. Chaque événement est affiché dans la case du jour correspondant. Les boutons « Mois précédent » et « Mois suivant » permettent de naviguer dans le temps. Un clic sur un événement ouvre directement la fiche détaillée.

### 2.7 Vue mobile (responsive)

Sur tablette ou téléphone :
- Les colonnes du tableau gauche sont réduites aux essentielles (Nom et Dates seulement).
- La hauteur des lignes est augmentée pour faciliter l'utilisation tactile.
- Le sélecteur de source est replié dans un menu accordéon.

### 2.8 Actions globales

La barre supérieure droite regroupe les actions disponibles :

- **Export CSV** (icône téléchargement) : exporte les données affichées au format CSV.
- **Imprimer** : génère un rendu imprimable de la vue courante.
- **Rafraîchir** (icône rotation) : recharge les données depuis le serveur.
- **Aujourd'hui** : recentre la chronologie sur la date du jour.
- **Plein écran** : si disponible, agrandit la vue Gantt à l'écran complet.

---

## 3. Workflows pas-à-pas

Cette section décrit, étape par étape, les actions courantes que vous pouvez effectuer dans le module Suivi / Gantt.

### 3.1 Changer de source de données

1. En haut de la page, repérez la barre de boutons « Source : Ventes | Projets | BT | Devis | BC ».
2. Cliquez sur la source désirée.
3. La chronologie se recharge automatiquement avec les données correspondantes.

> **À savoir** : la source sélectionnée détermine la nature des éléments affichés. Le tableau de gauche et la timeline sont synchronisés sur cette source.

### 3.2 Changer de vue (Kanban / Gantt / Calendrier)

1. À droite de la barre des sources, repérez le sélecteur de vue.
2. Cliquez sur le bouton désiré.
3. La page bascule instantanément.

> **Astuce** : la vue Gantt est idéale pour la planification, le Kanban pour le suivi visuel par statut, et le Calendrier pour la vision mensuelle.

### 3.3 Modifier le zoom de la chronologie

1. En bas du Gantt, repérez les boutons « Semaine | 2 Sem | Mois ».
2. Cliquez sur l'échelle souhaitée.
3. La timeline se redimensionne pour afficher la période choisie.

### 3.4 Rechercher un élément

1. Saisissez un mot-clé dans la barre de recherche.
2. Le tableau filtre les résultats en temps réel (insensible à la casse).
3. Effacez le contenu pour réafficher l'ensemble des éléments.

### 3.5 Trier le tableau gauche

1. Cliquez sur l'entête de la colonne à trier.
2. Premier clic : ordre croissant.
3. Second clic : ordre décroissant.
4. Une icône (flèche haut ou bas) indique l'ordre actif.

### 3.6 Modifier le statut d'une ligne (édition inline)

1. Dans la colonne Statut, cliquez sur le badge coloré.
2. Un menu déroulant apparaît avec les statuts disponibles.
3. Choisissez le nouveau statut.
4. La modification est enregistrée immédiatement.

> **Important** : l'édition inline ne nécessite pas de bouton de sauvegarde. La mise à jour est instantanée.

### 3.7 Changer l'employé assigné

1. Dans la colonne Assigné, cliquez sur le nom existant ou sur « Non assigné ».
2. Un sélecteur d'employé s'ouvre.
3. Choisissez l'employé à affecter.
4. La modification est enregistrée automatiquement.

### 3.8 Modifier les dates Début / Fin

1. Cliquez sur la cellule date dans le tableau gauche.
2. Un sélecteur de date s'affiche.
3. Choisissez la nouvelle date.
4. La barre Gantt se déplace ou se redimensionne automatiquement.
5. La progression % est recalculée.

### 3.9 Déplacer une barre dans la chronologie (drag and drop)

1. Cliquez et maintenez le bouton de la souris au **milieu** d'une barre.
2. Faites glisser à gauche ou à droite jusqu'à la nouvelle position.
3. Relâchez : les dates Début ET Fin sont décalées simultanément, la durée totale est préservée.

### 3.10 Redimensionner une barre (changer la durée)

1. Cliquez et maintenez sur le bord **gauche** d'une barre pour modifier la date de Début (la Fin reste fixe).
2. Cliquez et maintenez sur le bord **droit** d'une barre pour modifier la date de Fin (le Début reste fixe).
3. Relâchez : les dates et la durée sont mises à jour.

> **Astuce** : le curseur change de forme lorsque vous survolez les bords d'une barre, indiquant qu'un redimensionnement est possible.

### 3.11 Créer une dépendance entre deux barres

1. Survolez la barre source : un petit point (handle) apparaît à son extrémité droite.
2. Cliquez et maintenez ce point.
3. Faites glisser le curseur vers la barre cible (qui s'illumine).
4. Relâchez sur la cible : une flèche courbe relie les deux barres.

> **À savoir** : la dépendance signifie que la tâche cible ne devrait commencer qu'après la fin de la tâche source. Le système ne déplace pas automatiquement la cible mais affiche visuellement le lien.

### 3.12 Réorganiser l'ordre des lignes (drag vertical)

1. Cliquez et maintenez sur une ligne du tableau gauche.
2. Faites glisser vers le haut ou le bas.
3. Relâchez pour insérer la ligne à la nouvelle position.

### 3.13 Étendre / Réduire les phases d'un projet

1. À gauche du nom du projet, repérez l'icône triangle.
2. Cliquez pour révéler ou masquer les phases.
3. Les phases s'affichent en retrait sous la ligne parente.

### 3.14 Filtrer par statut, priorité, période

1. Cliquez sur le bouton « Filtres ».
2. Cochez les statuts et priorités à afficher.
3. Renseignez la Période (Date début / Date fin).
4. Cliquez sur « Appliquer ».
5. « Réinitialiser » pour effacer tous les filtres.

> **Astuce** : les filtres se cumulent. Combinez statut, priorité et période pour cibler précisément un sous-ensemble.

### 3.15 Naviguer vers un élément

1. Cliquez sur le **nom** d'un élément dans le tableau gauche.
2. Vous pouvez aussi cliquer directement sur la barre Gantt.
3. Le système ouvre la fiche détaillée du projet, BT, BC, devis ou opportunité.

### 3.16 Recentrer sur la date d'aujourd'hui

1. Cliquez sur le bouton « Aujourd'hui ».
2. La timeline se recentre sur la date du jour.
3. Une ligne verticale colorée marque visuellement le jour actuel.

### 3.17 Exporter en CSV

1. Cliquez sur le bouton « Exporter CSV ».
2. Le fichier correspondant à la source courante est téléchargé.

> **À savoir** : l'export reflète les filtres et la recherche en cours. Pour exporter l'ensemble, réinitialisez d'abord les filtres.

### 3.18 Imprimer le Gantt

1. Cliquez sur le bouton « Imprimer ».
2. La boîte de dialogue d'impression du navigateur s'ouvre.
3. Choisissez l'imprimante ou « Enregistrer en PDF ».

### 3.19 Rafraîchir les données

1. Cliquez sur l'icône de rotation.
2. Les données sont rechargées depuis le serveur.
3. Utile après une modification effectuée par un collègue.

### 3.20 Vue Kanban : changer le statut par drag

1. Dans la vue Kanban, cliquez et maintenez sur une carte.
2. Faites-la glisser vers une autre colonne (statut différent).
3. Relâchez : statut mis à jour automatiquement.

> **Astuce** : le drag-and-drop dans le Kanban est la façon la plus rapide de faire avancer un élément dans son cycle de vie.

---

## 4. Référence des champs, sources et formats

### 4.1 Sources de données disponibles

| Source | Description | Numéro affiché | Champs spécifiques visibles |
|---|---|---|---|
| **Ventes** | Opportunités commerciales en cours | OPP-AAAA-NNN | Client, Montant prévu, Date prévue de signature |
| **Projets** | Chantiers et mandats | PROJ-AAAA-NNNNN | Client, Budget, Adresse chantier |
| **Bons de Travail (BT)** | Tâches assignées sur le terrain | BT-NNNNN | Projet, Employé, Type, Heures prévues |
| **Devis** | Soumissions en cours | DEV-AAAA-NNN | Client, Montant, Statut soumission |
| **Bons de Commande (BC)** | Achats fournisseurs | BC-AAAA-NNNNN | Fournisseur, Montant, Date livraison prévue |

### 4.2 Colonnes du tableau gauche

| Colonne | Description | Éditable inline ? | Format |
|---|---|---|---|
| Nom | Titre de l'élément (et phases en indentation) | Non (lien navigation) | Texte |
| Statut | État courant (badge coloré) | **Oui** (dropdown) | Énumération |
| Assigné | Employé responsable | **Oui** (sélecteur employé) | Référence employé |
| Début | Date de début | **Oui** (date picker) | AAAA-MM-JJ |
| Durée | Nombre de jours (calculé) | Non (auto = Fin − Début) | Entier (jours) |
| Fin | Date de fin | **Oui** (date picker) | AAAA-MM-JJ |
| % | Progression | Non (auto par défaut) | 0 à 100 |

### 4.3 Vues disponibles

| Vue | Usage | Limites |
|---|---|---|
| **Kanban** | Suivi visuel par statut, drag pour changer | Pas de chronologie visible |
| **Gantt** | Planification chronologique, dépendances | Charge plus lente sur > 500 lignes |
| **Calendrier** | Vue mensuelle des échéances | Pas de barre Gantt continue |

### 4.4 Niveaux de zoom (Gantt)

| Zoom | Pixels par jour | Idéal pour |
|---|---|---|
| **Semaine** | 55 px | Détail court terme (1-2 mois) |
| **2 Semaines** | 28 px | Planification trimestrielle |
| **Mois** | 11 px | Vue annuelle, big picture |

### 4.5 Statuts standardisés (codage couleur)

| Statut | Couleur barre | Description |
|---|---|---|
| En attente | Jaune | Pas encore commencé |
| En cours | Bleu | En activité |
| Terminé | Vert | Achevé |
| En retard | Orange/Rouge | Date fin dépassée sans achèvement |
| Annulé | Gris/Rouge | Abandonné |
| Suspendu | Ambre | En pause temporaire |

### 4.6 Calcul de la progression automatique

Par défaut, le module calcule la progression sur une base purement temporelle :

**Progression % = (jours écoulés depuis Début ÷ durée totale) × 100**

Règles particulières :

- Si la date de début est dans le futur, la progression est de **0 %**.
- Si la date de fin est passée, la progression est de **100 %**.
- Entre les deux, le ratio temporel s'applique.
- La progression peut être **ajustée manuellement** depuis la fiche détaillée (l'auto-calcul est alors écrasé).
- Pour un **projet**, la progression affichée correspond à la **moyenne des progressions de ses phases**.

### 4.7 Dépendances entre tâches

- **Type unique** : **Fin → Début** (la tâche cible ne devrait commencer qu'après la fin de la tâche source).
- **Représentation** : flèche courbe en SVG entre les deux barres.
- **Création** : faire glisser le « dot » à droite de la barre source vers la barre cible.
- **Suppression** : clic droit sur la flèche, ou icône poubelle au survol.

### 4.8 Filtres disponibles

| Filtre | Type | Comportement |
|---|---|---|
| Recherche | Texte libre | Insensible à la casse, sur le nom |
| Statut | Multi-sélection | Combinable avec d'autres filtres |
| Priorité | Multi-sélection | Combinable |
| Période début | Date | Bornes de la timeline |
| Période fin | Date | Bornes de la timeline |
| Source | Sélection unique | 1 source à la fois |

### 4.9 Limites du système

| Élément | Limite |
|---|---|
| Projets affichables (source Projets) | 500 max (hérité de l'API) |
| Projets exclus | Statut « Annulé » jamais affiché |
| Phases sans dates | Affichées avec mention « Pas de dates » mais pas de barre |
| Virtualisation | **Aucune** : performance dégradée au-delà de ~1000 lignes |
| Dépendances circulaires | Non détectées côté interface |

### 4.10 Formats numériques utilisés

| Élément | Format | Exemple |
|---|---|---|
| Numéro de projet | PROJ-AAAA-NNNNN | PROJ-2026-00042 |
| Numéro de BT | BT-NNNNN | BT-00012 |
| Numéro de BC | BC-AAAA-NNNNN | BC-2026-00007 |
| Numéro de devis | DEV-AAAA-NNN | DEV-2026-001 |
| Numéro d'opportunité | OPP-AAAA-NNN | OPP-2026-005 |
| Date | AAAA-MM-JJ | 2026-04-25 |
| Devise | $ CAD | 15 000,50 $ |
| Durée | Nombre de jours | 14 j |

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

Le Gantt n'est pas un module isolé : il **agrège des données** provenant de cinq modules différents et permet de naviguer rapidement vers la fiche source d'un simple clic.

| Module source | Données affichées | Action au clic |
|---|---|---|
| **CRM (Opportunités)** | Source Ventes : opportunités en cours, montants prévus | Ouvre la fiche opportunité |
| **Projets** | Source Projets : chantiers, phases, budgets, adresses | Ouvre la fiche projet (`/projets/{id}`) |
| **Bons de Travail** | Source BT : tâches assignées sur le terrain, employé, heures | Ouvre la fiche BT |
| **Devis** | Source Devis : soumissions en cours, échéances client | Ouvre la fiche devis |
| **Bons de Commande** | Source BC : achats fournisseurs, dates de livraison | Ouvre la fiche BC |
| **Employés** | Colonne Assigné : sélection des employés actifs du tenant | Pas de navigation directe (sélecteur seulement) |

> **Important** : le Gantt est en **lecture/écriture**. Les modifications de dates, de statuts ou d'assignations effectuées dans le Gantt sont sauvegardées directement dans le module source correspondant. Inutile d'ouvrir la fiche détaillée pour les ajustements simples.

### 5.2 Cas particuliers

- **Pas de dates** : les éléments sans date de début ET sans date de fin sont listés dans le tableau de gauche, mais n'ont pas de barre dans la chronologie. Renseignez les dates pour les faire apparaître.
- **Une seule date renseignée** : si seule la date de début est saisie, la durée par défaut est de **1 jour**. Renseignez les deux dates pour une vraie chronologie.
- **Date de fin antérieure à date de début** : le système accepte la modification mais affiche un avertissement visuel.
- **Projet « Annulé »** : exclu de la source Projets. Pour le voir, ouvrir le module Projets et filtrer par statut « Annulé ».
- **Gros volume (> 500 projets)** : seuls les **500 premiers** sont chargés. Utilisez les filtres pour réduire l'affichage.
- **Performance > 1000 lignes** : le Gantt n'est pas optimisé pour les très grands volumes. Filtrer par période ou par statut améliore la fluidité.
- **Dépendances circulaires** : le système n'empêche pas la création d'une dépendance circulaire (A → B → A). Vérifier visuellement la cohérence du graphe.
- **Modifications concurrentes** : si un collègue modifie des données pendant que vous êtes sur le Gantt, cliquer sur **Rafraîchir** pour récupérer la dernière version.
- **Phases sans dates dans un projet** : les phases sans dates ne sont pas affichées en barre, mais le projet parent l'est si lui-même a des dates.

### 5.3 Astuces

- **Naviguer rapidement aux dates** : cliquer sur **Aujourd'hui** pour recentrer sur la date courante.
- **Vue d'ensemble annuelle** : passer en zoom **Mois** pour voir 6 à 12 mois sur un écran.
- **Planification fine** : passer en zoom **Semaine** pour ajuster jour par jour.
- **Drag-and-drop précis** : utiliser les **bords** de barre pour redimensionner sans déplacer (la durée change). Utiliser le **centre** pour déplacer (la durée reste fixe).
- **Édition rapide** : modifier les dates, statuts et assignés directement dans le tableau de gauche, sans ouvrir la fiche détaillée.
- **Filtrage combiné** : combiner **Recherche + Statut + Période** pour cibler très précisément un sous-ensemble.
- **Kanban pour le statut, Gantt pour les dates** : utiliser la vue Kanban pour faire avancer les tâches d'un statut à l'autre par drag, puis basculer en vue Gantt pour ajuster la chronologie.
- **Export pour rapport hebdo** : exporter en CSV chaque lundi pour suivre l'évolution semaine par semaine dans Excel.

### 5.4 FAQ

**Q : Pourquoi un projet ou un BT n'apparaît-il pas dans le Gantt ?**
R : Vérifier 3 choses : (1) la **source sélectionnée** correspond bien au type d'élément, (2) les **filtres actifs** ne l'excluent pas, (3) l'élément a au moins une **date** renseignée.

**Q : Mes modifications dans le Gantt sont-elles enregistrées immédiatement ?**
R : Oui. Chaque modification (date, statut, assigné) est synchronisée avec le serveur dès que vous validez (clic ou Tab). Si une erreur réseau survient, un message d'avertissement apparaît.

**Q : Comment supprimer une dépendance entre deux barres ?**
R : Survoler la flèche courbe : une icône **poubelle** apparaît. Cliquer pour supprimer. Ou clic droit sur la flèche pour le menu contextuel.

**Q : Pourquoi la progression ne correspond-elle pas à mon avancement réel ?**
R : Par défaut, la progression est calculée selon le **temps écoulé** (jours écoulés / durée totale). Pour la définir manuellement, ouvrir la fiche détaillée et saisir un pourcentage.

**Q : Puis-je créer une nouvelle tâche directement dans le Gantt ?**
R : Pas directement depuis cette page. La création doit se faire dans le **module source** (Projets, BT, BC, Devis, Opportunités). Une fois créée avec ses dates, elle apparaît automatiquement.

**Q : La vue Calendrier remplace-t-elle Outlook ?**
R : Non. Elle affiche les **événements ERP** mais ne se synchronise pas avec votre calendrier personnel (Outlook, Google Calendar). C'est un complément, pas un remplacement.

**Q : Comment imprimer un Gantt qui dépasse une page ?**
R : Cliquer sur **Imprimer**, puis ajuster l'échelle ou l'orientation dans le dialogue. Pour un rendu propre, exporter en PDF avec orientation **paysage** et format **A3**.

**Q : Le Gantt fonctionne-t-il sur tablette ou mobile ?**
R : Oui, mais l'expérience optimale est sur **bureau** (clavier + souris). Sur mobile, les colonnes du tableau de gauche sont réduites et le drag-and-drop devient plus délicat.

### 5.5 Limites connues

- **Pas de dépendances autres que Fin → Début** (pas de Début → Début, ni Fin → Fin, ni avec délai/avance).
- **Pas de chemin critique** calculé automatiquement.
- **Pas de jalons** (milestones) distincts des tâches.
- **Pas d'allocation de ressources multiples** par barre (un seul assigné principal).
- **Pas de rappels ni de notifications** sur les échéances depuis le Gantt directement.
- **Pas d'historique des modifications** affiché.

> Pour des besoins de planification très avancés (PERT, chemin critique, nivellement de ressources), un outil dédié reste recommandé en complément. Pour le suivi opérationnel quotidien, le Gantt Constructo offre l'essentiel sans surcharge.

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Suivi / Gantt — v1.0 — 2026-04-25*
