# Manuel utilisateur — Module Suivi / Gantt

Version v2.0 verifiee — Constructo AI ERP React.

Ce manuel decrit le module « Suivi » accessible via la route `/suivi` du frontend React. Le module regroupe trois vues complementaires : un tableau Kanban, un diagramme de Gantt et un calendrier mensuel. Toutes les informations ci-dessous proviennent de la lecture directe du code source (`SuiviPage.tsx`, `routers/projects.py`, `routers/production.py`).

---

## 1. Vue d'ensemble et acces

### 1.1 Role du module

Le module Suivi est un poste de pilotage transverse qui agrege en une seule page les flux operationnels de plusieurs domaines de l ERP : ventes (CRM), soumissions (devis), projets, achats (bons de commande), bons de travail (BT) et factures. L utilisateur peut visualiser les memes donnees sous trois angles differents sans changer de page.

### 1.2 Acces

- Composant principal : `SuiviPage` (export par defaut de `frontend/src/pages/SuiviPage.tsx`).
- Sous-composants : `KanbanTab`, `GanttTab`, `CalendarTab`, `GanttTooltipPanel`.
- Hauteur dynamique : la page passe en hauteur fixe `calc(100vh - 80px)` lorsque l onglet actif est `gantt` ou `calendrier`, et reste en `space-y-4` standard pour `kanban`.

### 1.3 Onglets principaux (verifies)

Trois onglets sont rendus dans cet ordre :

| Cle interne | Libelle UI | Icone (lucide) |
|-------------|------------|----------------|
| `kanban`    | Kanban     | `Kanban`       |
| `gantt`     | Gantt      | `BarChart3`    |
| `calendrier`| Calendrier | `Calendar`     |

L etat est porte par `useState<MainTab>('kanban')` : Kanban est l onglet par defaut au premier rendu. La barre d onglets est `border-b` avec un soulignement `border-seaop-primary-600` sur l onglet actif.

### 1.4 Gestion d erreur globale

Un `Alert type="error"` s affiche en haut de page lorsque `error` est non nul. Chaque sous-onglet recoit une fonction `onError(msg)` qui pousse vers cet alert et permet la fermeture par l utilisateur.

---

## 2. Interface (schemas ASCII)

### 2.1 Squelette general

```
+--------------------------------------------------------------+
| [Alerte erreur si presente]                                  |
+--------------------------------------------------------------+
| Suivi                                                        |
+--------------------------------------------------------------+
| [Kanban] [Gantt] [Calendrier]                                |
+--------------------------------------------------------------+
|                                                              |
|  Contenu de l onglet actif                                   |
|                                                              |
+--------------------------------------------------------------+
```

### 2.2 Onglet Kanban

#### Sources (sous-vues) verifiees : 6

L onglet Kanban expose six sous-vues representees par des « pills » au-dessus du tableau, dans cet ordre exact :

| Cle (`KanbanView`) | Libelle UI    | API source                                |
|--------------------|---------------|-------------------------------------------|
| `ventes`           | Ventes        | `crmApi.listOpportunities`                |
| `devis`            | Soumissions   | `productionApi.getKanbanData().devis`     |
| `projects`         | Projets       | `productionApi.getKanbanData().projects`  |
| `achats`           | Achats        | `productionApi.getKanbanAchats`           |
| `bons_travail`     | BT            | `productionApi.getKanbanData().bonsTravail` |
| `factures`         | Factures      | `productionApi.getKanbanData().factures`  |

`ventes` est la sous-vue par defaut.

#### Schema ASCII desktop

```
+----------------+ +-------------------------------------------------+
| SIDEBAR (288px)| | [Pills: Ventes][Soum.][Projets][Achats][BT][Fac]|
| Vue active     | |                          [Filtres][Rafraichir] |
| - titre vue    | +-------------------------------------------------+
|                | |                                                 |
| [Information]  | | [Stats Gagne/Perdu si vue=ventes]               |
|  Progression   | |                                                 |
|  3 cercles:    | | Colonne 1     Colonne 2     Colonne 3     ...  |
|   pending      | | * dot + label  * dot + label   * dot + label    |
|   in-progress  | |   compteur       compteur       compteur        |
|   completed    | | +-----------+ +-----------+ +-----------+      |
|                | | | Carte 1   | | Carte 2   | | Carte 3   |      |
| [Budget]       | | | titre     | | ...       | | ...       |      |
|  total CAD     | | | dates     | |           | |           |      |
|                | | | avatars   | |           | |           |      |
| [Par statut]   | | +-----------+ +-----------+ +-----------+      |
|  liste dot+%   | |                                                 |
+----------------+ +-------------------------------------------------+
```

Sur mobile, la sidebar est masquee et remplacee par une barre compacte de stats inline. Les colonnes deviennent un scroll horizontal avec « snap » + indicateurs en points sous le tableau.

#### Carte Kanban — anatomie

```
+----------------------------------------+
| Titre (line-clamp-2)            [...]  |
| [Si ventes : company         montant] |
| [Si ventes : barre probabilite %]      |
| Deb: 12 Jan 2025   Fin: 30 Jan 2025   |
| (avatars assignees)        [+]  [Badge]|
+----------------------------------------+
```

- Icone `MoreVertical` ouvre un menu d item.
- Sur mobile, un bouton `ArrowRight` ouvre le menu de deplacement.
- Bouton `+` (avatar pointille) declenche l ouverture du modal d assignation d un employe.
- Bordure et fond changent quand une colonne est survolee en drag.

#### Bouton « Filtres » — verification

Le bouton « Filtres » (`<Filter size={14} />`) est present dans la barre d actions, mais il n a **aucun handler `onClick`**. Il est donc decoratif a date :

```jsx
<Button size="sm" variant="ghost" leftIcon={<Filter size={14} />}>Filtres</Button>
```

Le bouton « Rafraichir » a quant a lui `onClick={fetchData}`.

### 2.3 Onglet Gantt

#### Sources Gantt verifiees : 5

Cinq sources sont disponibles, dans cet ordre dans la barre de selection :

| Cle (`GanttSource`) | Libelle UI  | Endpoint backend                                    |
|---------------------|-------------|-----------------------------------------------------|
| `ventes`            | Ventes      | `crmApi.listOpportunities`                          |
| `devis`             | Soumissions | `GET /production/gantt/devis`                       |
| `projets`           | Projets     | `GET /projects/gantt`                               |
| `bons_commande`     | Achats      | `GET /production/gantt/bons-commande`               |
| `bons_travail`      | BT          | `GET /production/gantt/bons-travail`                |

Source par defaut : `ventes`.

#### Niveaux de zoom (DAY_WIDTH constants verifies)

```js
const DAY_WIDTH = ganttZoom === 'semaine' ? 55
                : ganttZoom === '2semaines' ? 28
                : 11; // 'mois'
```

| Zoom         | Libelle UI | DAY_WIDTH (px par jour) |
|--------------|------------|--------------------------|
| `semaine`    | Semaine    | 55                       |
| `2semaines`  | 2 Sem      | 28                       |
| `mois`       | Mois       | 11                       |

Zoom par defaut : `mois` (11 px/jour). Le selecteur de zoom est masque sur mobile.

#### Bouton « Aujourd'hui » — verification

Aucun bouton « Aujourd'hui » n existe dans le `GanttTab`. La date courante est materialisee par un **trait vertical rouge en pointilles** avec une etiquette « Auj. » en haut, calcule via `todayPercent`. Le bouton « Aujourd'hui » n existe que dans `CalendarTab`.

#### Bouton « Plein ecran » — verification

Aucun bouton « Plein ecran » (fullscreen) n existe dans le code source. Aucune reference a `fullscreen`, `requestFullscreen` ou `Maximize`. Les boutons d actions verifies du Gantt sont :

- Selecteur de zoom (Semaine / 2 Sem / Mois) — desktop seulement
- Champ de recherche (`Rechercher...`) — desktop seulement
- Bouton « Dependances » / « Masquer deps » — desktop seulement
- Bouton « Exporter CSV » (`Download` icone) — toujours visible
- Bouton « Imprimer » (`Printer` icone, declenche `window.print()`) — desktop seulement
- Bouton « Rafraichir » (`RefreshCw`) — toujours visible

### 2.4 Onglet Calendrier

```
+--------------------------------------------------------------+
| < [Mois Annee] >  [Aujourd'hui] | [opp][soum][proj][bc][bt]..|
+--------------------------------------------------------------+
| Dim Lun Mar Mer Jeu Ven Sam                                  |
| +---+---+---+---+---+---+---+                                |
| |   |   | 1 | 2 | 3 | 4 | 5 |                                |
| |   |   |dot|dot|   |   |   |  (mobile: dots)                |
| +---+---+---+---+---+---+---+                                |
+--------------------------------------------------------------+
| [Si jour selectionne, panneau droit (desktop) ou             |
|  bottom sheet (mobile) avec les evenements detail]           |
+--------------------------------------------------------------+
```

Le selecteur de filtres en haut a droite affiche 8 types d evenements coloriees (cliquables pour activer/desactiver) : `opportunite`, `devis` (Soumission), `project` (Projet), `bon_commande`, `bon_travail`, `facture`, `interaction`, `activite`. Tous sont actifs par defaut.

Le bouton « + » apparait sur survol d une cellule de jour (desktop seulement) et ouvre un popover de creation rapide.

---

## 3. Workflows pas-a-pas

### 3.1 Changer le statut d une carte Kanban (drag and drop)

1. Selectionner la sous-vue (Ventes, Soumissions, Projets, Achats, BT ou Factures).
2. Sur desktop : cliquer-glisser une carte vers une autre colonne ; un placeholder pointille bleu apparait dans la colonne cible.
3. Au depot, l UI applique l optimistic update (la carte change de colonne immediatement).
4. L API correspondante est appelee :
   - `ventes` -> `crmApi.updateOpportunity(id, { statut })`
   - `projects` -> `productionApi.updateKanbanStatus({ entityType: 'project', ... })` puis fallback `projectsApi.updateProject`
   - `devis` -> `productionApi.updateKanbanStatus({ entityType: 'devis', ... })` puis fallback `devisApi.updateDevis`
   - `bons_travail` -> idem avec `entityType: 'bon_travail'` / fallback `productionApi.updateWorkOrder`
   - `achats` -> `productionApi.updateKanbanStatus({ entityType: 'achat', ... })`
   - `factures` -> `productionApi.updateKanbanStatus({ entityType: 'facture', ... })`
5. En cas de succes : un toast vert « Statut mis a jour avec succes » s affiche 3 s.
6. En cas d echec : la carte revient a sa position d origine et un message d erreur est passe a `onError`.

Sur mobile, le drag-and-drop est desactive ; l utilisateur appuie sur l icone `ArrowRight` de la carte qui ouvre une bottom-sheet listant les statuts cibles disponibles.

### 3.2 Assigner un employe a une carte

1. Cliquer le bouton `+` (rond pointille a cote des avatars) sur une carte. Sur mobile, cette action passe par le modal de detail.
2. Le modal « Assigner un employe » s ouvre. La liste des employes est chargee via `listEmployees({ perPage: 100 })` une seule fois.
3. Filtrer par nom dans le champ de recherche autofocus.
4. Cliquer sur un employe : appel API selon la source.
5. Toast de succes « Employe assigne avec succes » + recharge integrale via `fetchData()`.

### 3.3 Deplacer une barre dans le Gantt (drag, resize, reorder)

Le `mouseDown` sur une barre detecte la zone via `getBarCursorZone` :

- 8 px gauche -> `resize-left`
- 8 px droite -> `resize-right`
- centre -> `move`

Pendant le mouvement (`updateDragPosition`) :

- Le drag horizontal modifie `currentLeft` / `currentWidth` de la barre.
- Si le mouvement vertical depasse `ROW_HEIGHT * 0.6` et est superieur au mouvement horizontal, le drag bascule en mode `reorder`.

Au `mouseUp` :

- Pour `move`, `resize-left`, `resize-right` : les nouvelles dates sont calculees et persistees via `saveDragResult` selon la source.
- Pour `reorder` : la liste est reordonnee localement. Le tri par colonne est reinitialise.
- En cas de succes pour un drag de barre, la cascade `propagateDependencyDates(id, newEnd)` est appelee.

Si le seuil de mouvement (3 px) n est pas atteint, le drag est interprete comme un clic et ouvre la tooltip.

### 3.4 Editer une cellule du panneau Gantt (statut, assigne, dates)

1. Cliquer sur la cellule a editer. Le state `editingCell` change et un `<select>` ou un `<input type="date">` apparait avec autofocus.
2. La selection / saisie declenche `saveInlineEdit(row, col, value)` qui mappe vers l API correspondante.
3. L etat local est mis a jour. Pour les operations BT, les dates parent du BT sont recalculees automatiquement (`recalcBtParentDates`).
4. Au `blur`, `editingCell` est remis a `null`.

### 3.5 Creer une dependance (lien entre barres)

1. Survol une barre desktop : un point bleu apparait sur le bord droit (handle de liaison).
2. Cliquer-glisser ce point bleu : `linkingState` est arme, le curseur passe en `crosshair`, et une bande indicatrice « Mode liaison » s affiche en bas (`Echap` pour annuler).
3. Pendant le drag, un trait pointille bleu suit la souris.
4. Pour terminer : cliquer ou relacher sur n importe quelle autre barre cible.
5. L API `productionApi.createGanttDependency` est appelee avec :
   ```
   {
     sourceType: ganttSource,
     sourceId: '<id ou op-XX>',
     targetType: ganttSource,
     targetId: '<id ou op-XX>',
     dependencyType: 'finish_to_start',
     lagDays: 0
   }
   ```
6. Apres succes : rechargement des dependances + cascade automatique `propagateDependencyDates`.

### 3.6 Supprimer une dependance via l UI

La suppression par UI est verifiee et fonctionnelle :

1. Cliquer sur la fleche grise d une dependance dans la timeline (le path SVG a un hitbox transparent de 14 px de large).
2. Un popover « Supprimer cette dependance? » s ouvre, avec deux boutons : « Annuler » et « Supprimer ».
3. Confirmer -> `productionApi.deleteGanttDependency(depId)` (DELETE `/production/gantt/dependencies/{dep_id}`).
4. La liste des dependances est rechargee.

### 3.7 Cascade automatique des dependances

La fonction `propagateDependencyDates(changedId, newEndDate, depsOverride?)` existe et est appelee :

- A la creation d une dependance (si la source a deja une fin).
- A la fin d un drag de barre (move, resize-left, resize-right).

Elle parcourt en DFS recursif (avec garde `visited` pour eviter les boucles) les dependances ou `sourceId === changedId`, et pour chaque cible :

- Calcule `requiredStart = newEndDate + (lagDays + 1) jours`.
- Si la cible commence deja apres `requiredStart`, ne fait rien.
- Sinon, decale la cible en preservant sa duree.
- Recurse sur les dependances de cette cible.

Le `Set` `visited` empeche les boucles infinies. Pour les sources `bons_travail`, les dates parent du BT sont recalculees a partir des operations modifiees.

### 3.8 Reordonner les lignes (grip handle)

1. Cliquer-glisser le `GripVertical` a gauche de chaque ligne (largeur 18 px).
2. Une ligne bleue d indicateur apparait au-dessus de la ligne cible.
3. Au depot : la position est recalculee. Le tri par colonne est reinitialise.

L ordre est uniquement local (etat React) — il n est pas persiste dans la base.

### 3.9 Exporter le Gantt en CSV

1. Cliquer le bouton « Exporter CSV ».
2. Appel `productionApi.exportGanttCsv` -> GET `/production/gantt/export-csv`.
3. Le backend agrege Projets, BT, Devis, Bons de commande et Dependances dans un CSV unique.
4. Le frontend cree un `Blob` et declenche le telechargement.

### 3.10 Naviguer dans le calendrier

- `<` / `>` : mois precedent / suivant.
- « Aujourd'hui » : revient au mois courant. Bouton present uniquement sur desktop.
- Cliquer sur une cellule de jour : la selectionne et ouvre le panneau lateral (desktop) ou la bottom sheet (mobile).
- Survoler une cellule -> bouton `+` (desktop) qui ouvre le popover « Creer pour le ... ». Types disponibles : Projet, Opportunite, Soumission, Bon de travail.
- Drag d un evenement (project, project_start, bon_travail, devis, opportunite, bon_commande) : deplacement complet (move) ou redimension (poignee de 6 px sur le bord droit).

---

## 4. Reference

### 4.1 Statuts par source (verifies depuis le code)

#### Ventes (`VENTES_COLUMNS`)
Colonnes actives : `PROSPECTION`, `QUALIFICATION`, `PROPOSITION`, `NEGOCIATION`. Statuts hors colonnes (affiches en bande resume) : `GAGNE`, `PERDU`.

#### Projets (`PROJECT_COLUMNS`)
`En attente`, `En cours`, `Termine`. Statut `Annule` est exclu cote backend.

#### Devis / Soumissions (`DEVIS_COLUMNS`)
`Brouillon`, `Envoye`, `Accepte`, `Refuse`. Le backend exclut `Annule` et `Expire` du Kanban.

#### Bons de Travail (`BT_COLUMNS`)
`BROUILLON`, `EN_COURS`, `EN_PAUSE`, `TERMINE`. Le backend exclut `ANNULE`.

#### Achats / Bons de commande (`ACHATS_COLUMNS`)
`Brouillon`, `Envoye`, `Recu`, `Annule`.

#### Factures (`FACTURES_COLUMNS`)
`BROUILLON`, `ENVOYEE`, `PAYEE`, `EN_RETARD`. Le backend exclut `ANNULEE`.

#### Statuts editables dans le Gantt (`<select>` inline)

| Source           | Statuts proposes                                                                  |
|------------------|------------------------------------------------------------------------------------|
| `bons_travail` (phase) | `En attente`, `En cours`, `Termine`, `Annule`                                |
| `bons_travail` (projet) | `BROUILLON`, `EN_COURS`, `EN_PAUSE`, `TERMINE`, `ANNULE`                    |
| `devis`          | `Brouillon`, `Envoye`, `Accepte`, `Refuse`                                         |
| `projets`        | `En attente`, `En cours`, `Termine`, `Annule`                                      |
| `ventes`         | `PROSPECTION`, `QUALIFICATION`, `PROPOSITION`, `NEGOCIATION`, `GAGNE`, `PERDU`     |
| `bons_commande`  | `Brouillon`, `Envoye`, `Confirme`, `Recu`, `Annule`                                |

### 4.2 Palette pastel des statuts (`STATUS_BAR_COLORS`)

Toutes les couleurs sont declarees en hex Tailwind arbitraires :

| Statut                  | Couleur (hex) | Note                  |
|-------------------------|---------------|-----------------------|
| `En attente`            | `#F6C87A`     | or doux               |
| `En cours`              | `#7BAFD4`     | bleu acier pastel     |
| `Termine`               | `#7DC4A5`     | vert sauge            |
| `Brouillon`             | `#B8C4CE`     | gris ardoise doux     |
| `Envoye`                | `#8B9FD4`     | bleu lavande          |
| `Accepte`               | `#7DC4A5`     | vert sauge            |
| `Refuse`                | `#E8919A`     | rose corail mat       |
| `BROUILLON`             | `#B8C4CE`     | idem Brouillon        |
| `EN_COURS`              | `#7BAFD4`     |                       |
| `TERMINE`               | `#7DC4A5`     |                       |
| `EN_PAUSE`              | `#E8C17A`     | ambre mat             |
| `Recu`                  | `#7DC4B5`     | sarcelle doux         |
| `Annule`                | `#E8919A`     |                       |
| `Suspendu`              | `#E8C17A`     |                       |
| `ENVOYEE`               | `#8B9FD4`     |                       |
| `PAYEE`                 | `#7DC4A5`     |                       |
| `EN_RETARD`             | `#E8919A`     |                       |
| `PROSPECTION`           | `#9BB8D8`     | bleu ciel doux        |
| `QUALIFICATION`         | `#F6C87A`     |                       |
| `PROPOSITION`           | `#B09BD8`     | mauve pastel          |
| `NEGOCIATION`           | `#F0B07A`     | peche                 |
| `GAGNE`                 | `#7DC4A5`     |                       |
| `PERDU`                 | `#E8919A`     |                       |
| `Confirme`              | `#7DC4B5`     |                       |

### 4.3 Calculs et formats

- `daysBetween(a, b)` : difference en jours en UTC, arrondie.
- `calcAutoProgress(dateDebut, dateFin)` : retourne 0 avant le debut, 100 a partir de la fin, sinon `round(elapsed / total * 100)`.
- `getDeadlineBadge(dueDate)` : retourne une pastille couleur selon l echeance :
  - `< 0 j` -> rouge « En retard »
  - `0 j` -> bleu « Aujourd'hui »
  - `<= 3 j` -> jaune « Nj restants »
  - sinon -> aucun badge
- `formatShortDate(d)` : `12 janv. 2025` via `toLocaleDateString('fr-CA', { day, month: 'short', year })`.
- Identifiants Gantt : un projet utilise son `id` brut (`123`), une phase BT utilise le prefix `op-{id}` (`op-456`).

### 4.4 Champs retournes par les endpoints

#### `GET /projects/gantt`
Pour chaque projet : `id`, `nom_projet`, `numero_projet`, `statut`, `priorite`, `date_debut_reel`, `date_fin_reel`, `budget_total`, `phases[]`. Limite : 500 projets, statut `Annule` exclu, tri par `date_debut_reel ASC NULLS LAST`.

#### `GET /production/gantt/projects`
Variante avec `progression` calculee via `LEFT JOIN` sur `project_phases.AVG(progression)`.

#### `GET /production/gantt/devis`
Champs : `id`, `numero`, `nom`, `statut`, `dateDebut`, `dateFin`, `montant`. Statuts `Annule` et `Refuse` exclus.

#### `GET /production/gantt/bons-travail`
Champs : `id`, `nomProjet`, `nom`, `numero`, `statut`, `priorite`, `dateDebut`, `dateFin`, `budget`, `projectId`, `projectNom`, `phases[]`. Chaque phase : `id`, `nom`, `statut`, `assignee`, `dateDebut`, `dateFin`, `progression` (= `min(heures_reelles / heures_prevues * 100, 100)`), `ordre`.

#### `GET /production/gantt/bons-commande`
Champs : `id`, `numero`, `nom`, `statut`, `dateDebut` (date_commande), `dateFin` (date_livraison_prevue), `montant`, `dureeJours`, `projectId`, `projectNom`, `fournisseur`. Statut `Annule` exclu.

#### `GET /production/kanban`
Retourne `{ projects, devis, bons_travail, factures }`. Limite : 50 par categorie.

#### `GET /production/kanban/achats`
Retourne `{ items }` (50 max).

#### `PUT /production/kanban/update-status`
Body : `{ entity_type, entity_id, new_statut }`. Mappage interne :

| `entity_type`  | Table                | Filtre supplementaire           |
|----------------|----------------------|---------------------------------|
| `project`      | `projects`           | -                               |
| `bt` / `bon_travail` | `formulaires`  | `type_formulaire = 'BON_TRAVAIL'` |
| `devis`        | `devis`              | -                               |
| `achat`        | `bons_commande`      | -                               |
| `facture`      | `factures`           | -                               |

#### `POST/GET/DELETE /production/gantt/dependencies`
Table `gantt_dependencies` (creee a la demande). Colonnes : `source_type`, `source_id`, `target_type`, `target_id`, `dependency_type` (defaut `finish_to_start`), `lag_days` (defaut 0), `created_at`.

#### `GET /production/calendar-events?year=&month=`
Retourne `{ events, year, month }`. Types : `project`, `bon_travail`, `devis`, `bon_commande`, `facture`, `interaction`, `activite`. `opportunite` est ajoute cote frontend.

### 4.5 Limites et constantes

- Sidebar Kanban : `w-72` (288 px).
- Hauteur de cellule de cartes Kanban : `max-h-[65vh]` desktop, `max-h-[60vh]` mobile.
- Auto-hide toast Kanban : 3 000 ms.
- Hauteur de ligne Gantt : `36 px` desktop, `44 px` mobile.
- Largeur du panneau de gauche Gantt : 200 px (min) a 1200 px (max), 120 px en mobile.
- Largeur minimale d une colonne du panneau : 30 px.
- Timeline : minimum 3 mois visibles.
- Limite backend Gantt projets : 500 lignes ; Kanban : 50 par source ; achats : 50.
- Format date echange API : `YYYY-MM-DD`.
- Liste des employes (modal d assignation Kanban) : 100 max ; (Gantt) : 200 max.

---

## 5. Integrations, cas particuliers et FAQ

### 5.1 Cascade des doubles-clics et navigation

- Double-clic sur une carte Kanban : navigation vers la fiche detail. Mapping :
  - `ventes` -> `/ventes?open=ID`
  - `devis` -> `/devis?open=ID`
  - `projects` -> `/projets?open=ID`
  - `bons_travail` -> `/bons-travail?open=ID`
  - `achats` -> `/magasin?open=ID`
  - `factures` -> `/comptabilite?open=ID`
- Double-clic sur une barre de Gantt (uniquement de type `project`) : meme mapping.
- Double-clic sur un evenement de calendrier ou simple clic dans la liste laterale : `navigateToItem(ev)`.

### 5.2 Optimistic update

Tous les changements de statut Kanban sont appliques en local avant l appel API. En cas d echec, l etat precedent est restaure et un message d erreur est affiche.

### 5.3 Recalcul des dates parent BT

Lors de la modification d une operation (drag, edition inline, cascade dependance) en source `bons_travail`, la fonction `recalcBtParentDates(p)` recalcule :

- `dateDebut` = min des `dateDebut` des operations.
- `dateFin` = max des `dateFin` des operations.

Ce recalcul est local (pas de persistence cote BT parent) — le backend Gantt BT applique deja la meme logique au moment du `GET`.

### 5.4 Comportement defensif backend

Plusieurs endpoints (Gantt, calendar) tentent d abord une requete riche puis font un `rollback` + requete simplifiee si une colonne manque. Le backend ajoute aussi defensivement les colonnes `date_debut`, `date_fin`, `priorite` a la table `formulaires` via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Idem pour la table `gantt_dependencies` qui est creee a la demande aux trois endpoints.

### 5.5 FAQ

**Q. Pourquoi je ne vois pas tous mes projets dans le Gantt « Projets » ?**
La requete backend (`GET /projects/gantt`) limite a 500 projets et exclut le statut `Annule`.

**Q. Pourquoi l onglet « BT » dans le Gantt affiche un BT sans dates explicites ?**
Le backend calcule les dates dans cet ordre : dates explicites du BT > min/max des operations > date_echeance > created_at. Si toutes ces sources sont vides, la barre n est pas rendue et la mention « Pas de dates » apparait.

**Q. Le bouton « Filtres » ne fait rien quand je clique dessus.**
Confirme : le bouton « Filtres » dans la barre d actions Kanban est decoratif (aucun `onClick`). Seul le bouton « Rafraichir » a un handler.

**Q. Y a-t-il un bouton « Plein ecran » dans le Gantt ?**
Non. Aucun bouton fullscreen n est implemente. Pour imprimer ou exporter, utilisez les boutons « Imprimer » (`window.print()`) ou « Exporter CSV ».

**Q. Quels niveaux de zoom sont disponibles dans le Gantt ?**
Trois : Semaine (55 px/jour), 2 Sem (28 px/jour), Mois (11 px/jour). Defaut : Mois. Selecteur masque sur mobile.

**Q. Comment supprimer une dependance ?**
Cliquer sur la fleche de la dependance dans la timeline -> popover -> bouton « Supprimer ». Appel `DELETE /production/gantt/dependencies/{dep_id}`.

**Q. Comment fonctionne la cascade des dates ?**
La fonction `propagateDependencyDates` parcourt la chaine de dependances en DFS recursif (la fonction `cascade(srcId, srcEnd)` s appelle elle-meme, cf. `SuiviPage.tsx:1917-1979`), decale chaque tache aval avec un offset `lagDays + 1 jour`, preserve la duree d origine, et empeche les boucles via `visited`.

**Q. Le drag-and-drop fonctionne-t-il sur mobile ?**
Non pour le Kanban (`draggable` est conditionnee a `!isMobile`). Sur mobile, l utilisateur passe par une bottom sheet pour deplacer une carte. Sur le Gantt et le Calendrier, le drag-and-drop n est pas active sur mobile.

**Q. Quelles sources peuvent etre creees rapidement depuis le calendrier ?**
Quatre types listes dans `QC_TYPES` : Projet, Opportunite, Soumission, Bon de travail.

**Q. Quels evenements sont affiches dans le calendrier ?**
Huit types filtrables : Opportunite, Soumission (devis), Projet (`project`), Debut projet (`project_start`), Bon de commande, Bon de travail, Facture, Interaction CRM, Activite CRM.

**Q. Quelles sources sont editables dans le panneau Gantt par double-clic sur la cellule ?**
Statut, Assigne, Debut, Fin pour toutes les sources ; Progression (heures reelles) uniquement pour les phases BT. Duree reste lecture seule.

---

*Manuel ERP Constructo — Module Suivi / Gantt — v2.0 verifie — 2026-04-25*
