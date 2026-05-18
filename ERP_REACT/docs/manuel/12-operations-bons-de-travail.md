# Manuel utilisateur — Module Bons de Travail (BT)

Version v2.0 verifiee — Constructo AI ERP React.

---

## 1. Vue d ensemble

Un **bon de travail** (BT) est l unite de travail operationnelle de Constructo : planifier une intervention sur chantier, decomposer en operations avec heures prevues/reelles, lister materiaux/services consommes, assigner des employes, suivre l avancement par cycle de statuts, generer un document HTML imprimable signable, deduire le stock automatiquement.

### 1.1 Numerotation

Format `BT-NNNNN` (5 chiffres avec zeros de tete) genere automatiquement a la creation. Race-safe via INSERT temp + UPDATE-by-ID (`production.py:1240`).

Exemples : `BT-00001`, `BT-00042`, `BT-00123`.

### 1.2 5 statuts (BT_STATUSES)

| Statut DB | Libelle | Couleur | Description |
|---|---|---|---|
| `BROUILLON` | Brouillon | Gris | Cree, en preparation. Modifiable, supprimable. |
| `EN_COURS` | En cours | Bleu | Travail demarre |
| `EN_PAUSE` | En pause | Ambre | Suspendu temporairement |
| `TERMINE` | Termine | Vert | Travail livre |
| `ANNULE` | Annule | Rouge | Bon abandonne |

Toute valeur hors liste : refus serveur HTTP 400 « Statut invalide ».

### 1.3 4 priorites (BT_PRIORITIES)

`BASSE` / `NORMALE` (defaut) / `HAUTE` / `URGENTE`. URGENTE ajoute icone triangle d alerte dans la vue detail.

### 1.4 4 statuts d operation (OPERATION_STATUSES)

`En attente` (defaut) / `En cours` / `Termine` / `Annule`. **Aucun lien automatique** entre statut BT et statuts operations.

### 1.5 18 types d operations par defaut

Liste DEFAULT_OPERATION_TYPES (endpoint `GET /production/operation-types`) :

1. Demolition
2. Decontamination
3. Excavation
4. Fondation/Coffrage
5. Structure/Charpente
6. Plomberie
7. Electricite
8. CVAC
9. Isolation
10. Gypse/Platre
11. Peinture
12. Toiture
13. Revetement exterieur
14. Menuiserie/Finition
15. Plancher
16. Ceramique
17. Amenagement paysager
18. Nettoyage final

Selecteur dans le formulaire operation. Possible de saisir un nom personnalise (champ texte).

### 1.6 Acces

- Sidebar -> **Bons de Travail** (icone presse-papiers)
- URL : `/bons-travail`
- Auto-ouverture via URL : `/bons-travail?open=ID` (depuis Calendrier)

### 1.7 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD
- **Suppression** = soft-delete (statut -> ANNULE), le BT reste en base

---

## 2. Interface

### 2.1 Page `/bons-travail`

2 onglets principaux + vue Detail contextuelle :

| Onglet | Role |
|---|---|
| **Bons de Travail** | Liste paginee filtrable |
| **Operations** | Vue globale toutes operations confondues |

> **Important** : il n y a que **2 onglets**, pas 3. La vue Detail apparait quand un BT est ouvert (remplace la barre par fil d Ariane).

### 2.2 4 cartes KPI (toujours visibles)

- Total BT
- En cours (statut EN_COURS)
- Termines (statut TERMINE)
- Montant total (somme `montant_total`)

### 2.3 Onglet Bons de Travail

```
+---------------------------------------------------------------+
| [+ Nouveau BT] [Recherche] [Statut v] [Priorite v]           |
+---------------------------------------------------------------+
| Numero | Nom | Statut | Priorite | Projet | Debut | Fin | Mt |
| BT-001 | ... | En cours| Normale | P-42  | ...  | ... | $$ |
+---------------------------------------------------------------+
```

Colonnes : Numero (BT-NNNNN, monospace bleu), Nom, Statut (badge), Priorite (badge), Projet, Debut, Fin, Echeance, Montant. Triables, redimensionnables.

**Edition rapide dates** : clic cellule Debut/Fin -> input date inline -> sauvegarde au blur.

**Filtres** : recherche libre (nom + numero) ; filtre Statut **mono-selection** (un seul statut OU « Tous les statuts ») ; filtre Priorite mono-selection.

> **PAS** de Vue Kanban achats dans le module BT. Le Kanban achats est dans le module Suivi.

### 2.4 Vue Detail BT

Sections empilees : Entete, Operations, Lignes (avec Assignations), Commentaires.

#### Boutons workflow contextuels (selon statut)

| Statut courant | Boutons visibles |
|---|---|
| BROUILLON | **Modifier**, **HTML**, **PDF**, **Demarrer** (Play bleu), **Annuler** (XCircle rouge), **Supprimer** (poubelle rouge) |
| EN_COURS | Modifier, HTML, PDF, **Pause** (Pause), **Terminer** (CheckCircle vert), **Annuler** |
| EN_PAUSE | Modifier, HTML, PDF, **Reprendre** (Play bleu), **Annuler** |
| TERMINE | Modifier, HTML, PDF (aucune action workflow) |
| ANNULE | Modifier, HTML, PDF, **Supprimer** (poubelle visible) |

> Le bouton **Supprimer** (poubelle) n est visible **QUE** si statut = `BROUILLON` OU `ANNULE`.

#### Section Lignes (materiaux)

Tableau : Description, Qte, Unite, Prix unit., Montant, Actions. Badge bleu « Inventaire » si `produit_id` non nul.

**A l ajout d une ligne avec `produit_id`** :
- Lock atomique du produit (`UPDATE ... RETURNING`)
- Decrement `stock_disponible -= quantite`
- INSERT mouvement `SORTIE` dans `mouvements_stock`

**A la modification de quantite** :
- Calcul du delta (`new_qte - old_qte`)
- Mouvement SORTIE (delta positif) ou ENTREE (delta negatif) pour ajuster stock

**A la suppression d une ligne avec `produit_id`** :
- INSERT mouvement **ENTREE** automatique (re-credite stock)
- Motif : « Annulation ligne BT BT-00xxx »

> **Important** : la suppression de ligne **re-credite bien le stock automatiquement**.

#### Section Operations

Tableau : Operation, Qte, Assigne, Fournisseur, Debut, Fin, H. Prevues, H. Reelles, Statut, Actions.

Statut editable inline via `<select>` (4 valeurs operation).

> **PAS d auto-incrementation** des heures reelles via Pointage. Le champ `heures_reelles` est **manuel uniquement** (edition operation). Aucun trigger / SQL UPDATE / scheduled task n agrege les `time_entries` vers `operations`.

#### Section Assignations

Liste employes avec initiales colorees, nom, role, date assignation. Bouton « Assigner employe » (`UserPlus`).

Contrainte UNIQUE : un employe ne peut etre assigne deux fois (HTTP 409).

#### Section Commentaires

Fil chronologique. Avatar gris, nom utilisateur, temps relatif, texte multiligne. Zone de saisie + bouton « Envoyer ».

---

## 3. Workflows pas-a-pas

Tous les workflows partent de la page `/bons-travail` (sidebar -> **Bons de Travail**).

### 3.1 Creer un BT

1. Bouton **+ Nouveau BT** (en-tete page).
2. Modale `CreateBTModal` :
   - **Nom** (obligatoire, sauf si Projet selectionne -> derive `nom_projet`)
   - **Projet** (optionnel, dropdown)
   - **Priorite** (BASSE / NORMALE / HAUTE / URGENTE — defaut NORMALE)
   - **Date debut / Date fin / Date echeance** (optionnels)
   - **Notes** (texte libre)
3. **Enregistrer** -> `POST /production/work-orders`.
4. Backend genere un numero atomique :
   - `INSERT` avec numero `TEMP` -> recupere `id` -> `UPDATE numero_document = BT-NNNNN` (zero-padded sur 5).
   - Cette double operation evite les collisions sous charge concurrente (race-safe).
5. Si le projet est lie a une opportunite CRM avec un dossier, le BT est **auto-rattache** au dossier (table `dossier_formulaires`, ON CONFLICT DO NOTHING).
6. La modale se ferme, la liste se recharge, le nouveau BT apparait avec statut `BROUILLON`.

> **Champ nom** : si vide ET pas de projet, le backend met `numero_document` (BT-NNNNN) comme nom.

### 3.2 Demarrer un BT (BROUILLON -> EN_COURS)

1. Cliquer une ligne du tableau -> **vue Detail** s ouvre dans le panneau de droite.
2. En-tete vue Detail : 3 boutons d action visibles selon statut.
3. Si statut = `BROUILLON` : bouton **Demarrer** (icone Play, primary) + bouton **Annuler** (icone XCircle, danger).
4. Cliquer **Demarrer** -> `PUT /production/work-orders/{bt_id}` avec `{statut: "EN_COURS"}`.
5. Le panneau se rafraichit, le badge statut passe au bleu.

> **Aucune validation cote backend** sur la transition (le PUT accepte n importe quelle valeur dans `BT_STATUSES`). C est l UI qui filtre les boutons selon statut courant.

### 3.3 Mettre en pause / Reprendre

**Mettre en pause** (EN_COURS -> EN_PAUSE) :
1. Vue Detail d un BT `EN_COURS` -> bouton **Pause** (icone Pause, secondary).
2. `PUT /work-orders/{bt_id}` `{statut: "EN_PAUSE"}`.
3. Badge statut passe en ambre.

**Reprendre** (EN_PAUSE -> EN_COURS) :
1. Vue Detail d un BT `EN_PAUSE` -> bouton **Reprendre** (icone Play, primary).
2. `PUT /work-orders/{bt_id}` `{statut: "EN_COURS"}`.
3. Badge statut redevient bleu.

### 3.4 Terminer un BT (EN_COURS -> TERMINE)

1. Vue Detail d un BT `EN_COURS` -> bouton **Terminer** (icone CheckCircle, accent vert).
2. `PUT /work-orders/{bt_id}` `{statut: "TERMINE"}`.
3. Badge statut passe au vert.
4. **Aucun verrouillage** : un BT TERMINE reste editable (lignes, operations, assignations, commentaires).

> **Pas de bouton Reouvrir** : pour passer de `TERMINE` a `EN_COURS`, utiliser le `<select>` Statut dans le formulaire d edition (modale Modifier).

### 3.5 Annuler un BT

Le bouton **Annuler** (icone XCircle, danger) est visible si statut = `BROUILLON`, `EN_COURS` ou `EN_PAUSE`.

1. Cliquer **Annuler** -> `PUT /work-orders/{bt_id}` `{statut: "ANNULE"}`.
2. Badge statut passe au rouge.
3. **Aucun rollback de stock** : les mouvements `SORTIE` deja generes par les lignes restent en place. Pour reintegrer le stock, il faut **supprimer manuellement chaque ligne** (cf. section 3.9).

### 3.6 Supprimer un BT (poubelle)

> **Visible UNIQUEMENT** si statut = `BROUILLON` OU `ANNULE` (cf. ligne 1460 BonsTravailPage.tsx).

1. Vue Detail -> icone poubelle dans l en-tete.
2. Confirmation -> `DELETE /work-orders/{bt_id}`.
3. **Soft-delete** : le backend execute `UPDATE formulaires SET statut = ANNULE`. Aucune suppression physique.
4. Le BT disparait de la liste (filtre par defaut exclut ANNULE) mais reste en base (consultable via filtre `statut=ANNULE`).

### 3.7 Ajouter une ligne avec produit inventaire

1. Vue Detail -> section **Lignes (materiaux/services)** -> bouton **+ Ajouter une ligne**.
2. Formulaire ligne :
   - **Produit** (dropdown inventaire — auto-remplit description, unite, prix)
   - **Description** (modifiable apres selection)
   - **Quantite** (numeric, > 0)
   - **Unite** (texte, ex. `un`, `m2`, `h`)
   - **Prix unitaire** (numeric)
3. **Enregistrer** -> `POST /production/work-orders/{bt_id}/lines`.
4. Backend :
   - Calcule `montant_ligne = quantite * prix_unitaire`.
   - Assigne `sequence_ligne` automatique (`MAX + 1`).
   - **Si `produit_id` non null ET quantite > 0** :
     - `UPDATE produits SET stock_disponible = stock_disponible - quantite RETURNING stock_disponible` (atomique).
     - Cree mouvement `SORTIE` dans `mouvements_stock` avec `quantite_avant`, `quantite_apres`, `reference_document = BT-NNNNN`, `motif = Ligne BT BT-NNNNN`.
   - Recalcule `montant_total` du BT (somme des `montant_ligne`).

> **Stock negatif autorise** : aucune verification `stock_disponible >= quantite`. Le stock peut tomber a 0 ou en negatif.

### 3.8 Modifier la quantite d une ligne

1. Vue Detail -> tableau Lignes -> cliquer la cellule **Quantite** (edition inline) ou **Prix unitaire**.
2. Modifier la valeur -> blur ou Enter.
3. `PUT /work-orders/{bt_id}/lines/{line_id}` avec les champs modifies.
4. Backend :
   - Recalcule `montant_ligne = quantite * prix_unitaire`.
   - Recalcule `montant_total` du BT.
   - **Si `produit_id` non null ET delta quantite != 0** :
     - `delta = nouvelle_qte - ancienne_qte`
     - `UPDATE produits SET stock_disponible = stock_disponible - delta` (delta positif = sortie supplementaire ; delta negatif = retour stock).
     - Cree mouvement `SORTIE` (delta > 0) ou `ENTREE` (delta < 0) avec `motif = Modification ligne BT BT-NNNNN`.

### 3.9 Supprimer une ligne (re-credit auto stock)

1. Vue Detail -> tableau Lignes -> icone poubelle a droite de la ligne.
2. Confirmation -> `DELETE /work-orders/{bt_id}/lines/{line_id}`.
3. Backend :
   - Lit `produit_id` et `quantite` AVANT suppression (necessaire pour reversal).
   - `DELETE FROM formulaire_lignes WHERE id = %s`.
   - Recalcule `montant_total` du BT.
   - **Si `produit_id` non null ET quantite > 0** :
     - `UPDATE produits SET stock_disponible = stock_disponible + quantite` (re-credit).
     - Cree mouvement `ENTREE` avec `motif = Annulation ligne BT BT-NNNNN`.

> **Le re-credit est le SEUL moyen** de reintegrer le stock consomme. Annuler le BT (statut ANNULE) ne re-credite **pas** le stock automatiquement.

### 3.10 Ajouter une operation

1. Vue Detail -> section **Operations** -> bouton **+ Ajouter une operation**.
2. Formulaire operation :
   - **Nom** (obligatoire) — dropdown des 18 `DEFAULT_OPERATION_TYPES` ou texte libre
   - **Description** (texte libre)
   - **Quantite** (numeric, ex. nombre d unites a produire)
   - **Employe assigne** (dropdown employees — optionnel)
   - **Fournisseur/Sous-traitant** (texte libre — optionnel)
   - **Heures prevues** (numeric)
   - **Date debut / Date fin** (optionnels)
   - **Poste de travail** (texte — optionnel)
   - **Statut** (defaut `En attente`)
3. **Enregistrer** -> `POST /production/work-orders/{bt_id}/operations`.
4. Backend :
   - Verifie BT existe.
   - Verifie `employee_id` existe si fourni (sinon HTTP 404).
   - Valide `statut` dans `OPERATION_STATUSES` (sinon HTTP 400).
   - Assigne `sequence_number` automatique (`MAX + 1`).
   - INSERT dans table `operations` (FK `formulaire_bt_id`).

### 3.11 Modifier le statut d une operation

1. Vue Detail -> tableau Operations -> cellule **Statut** -> `<select>` inline.
2. 4 valeurs : `En attente` / `En cours` / `Termine` / `Annule`.
3. Selection -> `PUT /work-orders/{bt_id}/operations/{op_id}` `{statut: "..."}`.
4. **Aucun lien automatique** entre statut operation et statut BT (independants).

### 3.12 Saisir les heures reelles d une operation

1. Vue Detail -> tableau Operations -> cliquer l icone **Edit** (crayon) de la ligne -> modale.
2. Champ **Heures reelles** (numeric, decimal autorise — ex. `7.5`).
3. **Enregistrer** -> `PUT /work-orders/{bt_id}/operations/{op_id}` `{heures_reelles: 7.5}`.

> **PAS d auto-incrementation** depuis Pointage. Aucun trigger SQL, aucun batch, aucune logique applicative n agrege les `time_entries` (pointages employes) vers `operations.heures_reelles`. Saisie 100 % manuelle.

### 3.13 Assigner un employe au BT

1. Vue Detail -> section **Assignations** -> bouton **+ Assigner employe** (icone UserPlus).
2. Modale : dropdown **Employe** + champ **Role** (texte libre, ex. `Chef d equipe`, `Aide`).
3. **Enregistrer** -> `POST /work-orders/{bt_id}/assignations`.
4. Backend :
   - Verifie `employee_id` existe (sinon HTTP 404).
   - Verifie unicite `(bt_id, employee_id)` — refuse si deja assigne (HTTP 409 `Employe deja assigne`).
   - INSERT dans `bt_assignations`.

### 3.14 Desassigner un employe

1. Vue Detail -> section Assignations -> icone X (rouge) a droite de la ligne employe.
2. Confirmation -> `DELETE /work-orders/{bt_id}/assignations/{assignation_id}`.
3. Backend supprime physiquement la ligne `bt_assignations`. **Aucun impact** sur les operations dont l employe etait assigne (les operations conservent `employee_id`).

### 3.15 Ajouter un commentaire

1. Vue Detail -> section **Commentaires** (bas de page) -> zone de saisie texte multiligne.
2. **Envoyer** -> `POST /work-orders/{bt_id}/comments` avec `{text: "..."}`.
3. Le commentaire apparait dans le fil chronologique avec :
   - Avatar gris + initiales utilisateur
   - Nom utilisateur
   - Temps relatif (`il y a 2 min`)
   - Texte multiligne preserve

> **Pas d edition** ni de suppression d un commentaire deja envoye.

### 3.16 Generer le document HTML/PDF imprimable

1. Vue Detail -> bouton **Imprimer** (icone Printer, en-tete).
2. `POST /work-orders/{bt_id}/generate-html` -> renvoie `{html: "<!DOCTYPE html>..."}`.
3. Le HTML est ouvert dans un **nouvel onglet** ; l utilisateur peut :
   - Cliquer **Imprimer** (Ctrl+P) du navigateur
   - Choisir **Enregistrer en PDF** dans la boite d impression
4. Le HTML inclut :
   - En-tete entreprise (logo, nom, adresse, RBQ, NEQ — depuis `parametres_entreprise`)
   - Numero BT, projet, date, statut, priorite
   - Tableau lignes avec montants
   - Tableau operations avec heures prevues/reelles
   - Liste assignations
   - Theme couleurs depuis `parametres_documents` (couleurs personnalisables)

> Le HTML est genere cote serveur, **stylise inline** (pas de CSS externe), pret a l impression sans dependances.

---

## 4. Reference

### 4.1 Statuts BT (BT_STATUSES)

Source : `production.py:22`

| Statut       | Couleur badge | Signification              | Boutons workflow visibles               |
|--------------|---------------|----------------------------|-----------------------------------------|
| `BROUILLON`  | gris          | Cree, pas encore demarre   | Demarrer, Annuler, Supprimer (poubelle) |
| `EN_COURS`   | bleu          | En execution               | Pause, Terminer, Annuler                |
| `EN_PAUSE`   | ambre         | Suspendu temporairement    | Reprendre, Annuler                      |
| `TERMINE`    | vert          | Travaux completes          | (aucun bouton workflow)                 |
| `ANNULE`     | rouge         | Annule (soft-delete)       | Supprimer (poubelle)                    |

### 4.2 Priorites (BT_PRIORITIES)

Source : `production.py:23`

| Priorite  | Couleur | Usage typique                        |
|-----------|---------|--------------------------------------|
| `BASSE`   | gris    | Pas urgent, planifiable              |
| `NORMALE` | bleu    | Defaut — flux normal                 |
| `HAUTE`   | orange  | A traiter en priorite                |
| `URGENTE` | rouge   | Urgence chantier, intervention rapide|

### 4.3 Statuts operation (OPERATION_STATUSES)

Source : `production.py:24`

| Statut       | Signification                        |
|--------------|--------------------------------------|
| `En attente` | Defaut a la creation                 |
| `En cours`   | En execution                         |
| `Termine`    | Operation completee                  |
| `Annule`     | Operation annulee                    |

> Les valeurs sont **sensible a la casse** (Title Case avec espaces, pas UPPERCASE_SNAKE).

### 4.4 18 Types operations par defaut (DEFAULT_OPERATION_TYPES)

Source : `production.py` (endpoint `GET /production/operation-types`)

`Demolition`, `Decontamination`, `Excavation`, `Fondation/Coffrage`, `Structure/Charpente`, `Plomberie`, `Electricite`, `CVAC`, `Isolation`, `Gypse/Platre`, `Peinture`, `Toiture`, `Revetement exterieur`, `Menuiserie/Finition`, `Plancher`, `Ceramique`, `Amenagement paysager`, `Nettoyage final`.

> Les utilisateurs peuvent saisir un nom personnalise (champ texte libre).

### 4.5 Format numero BT

`BT-NNNNN` (zero-padded sur 5 chiffres). Exemples : `BT-00001`, `BT-00042`, `BT-12345`.

Genere atomiquement (cf. section 3.1) — race-safe.

### 4.6 Calculs

| Champ              | Formule                                          | Recalcul declenche par                               |
|--------------------|--------------------------------------------------|------------------------------------------------------|
| `montant_ligne`    | `quantite * prix_unitaire`                       | INSERT/UPDATE ligne                                  |
| `montant_total`    | `SUM(montant_ligne) WHERE formulaire_id = bt`    | INSERT/UPDATE/DELETE ligne                           |
| `sequence_ligne`   | `MAX(sequence_ligne) + 1` au moment INSERT       | (auto a la creation, jamais reordonnee)              |
| `sequence_number`  | `MAX(sequence_number) + 1` au moment INSERT      | (auto a la creation operation)                       |

> Aucun calcul de **TPS/TVQ** : le BT est un **document operationnel interne**, pas une facture. Pas de taxes, pas de marge, pas d export comptable.

### 4.7 Validations & limites

| Regle                                    | Effet                                                   |
|------------------------------------------|---------------------------------------------------------|
| `nom` vide ET pas de projet              | Backend met `numero_document` (BT-NNNNN) comme nom      |
| `statut` hors `BT_STATUSES`              | HTTP 400                                                |
| `priorite` hors `BT_PRIORITIES`          | HTTP 400                                                |
| `statut` operation hors `OPERATION_STATUSES` | HTTP 400                                            |
| `employee_id` operation inexistant       | HTTP 404                                                |
| `employee_id` deja assigne au BT         | HTTP 409 `Employe deja assigne`                         |
| Date vide (string `""`)                  | Convertie en `NULL`                                     |
| Champ hors whitelist (`gestionnaire`...) | **Ignore silencieusement** (whitelist `ALLOWED`)        |
| Stock insuffisant                        | **Pas de blocage** (stock peut tomber a 0 ou negatif)   |

---

## 5. Integrations & FAQ

### 5.1 Integration Projets

- Champ `project_id` (optionnel) — FK vers `projects.id`.
- Si renseigne ET `nom` BT vide a la creation : le backend derive `nom = projects.nom_projet`.
- Section **Lignes** affiche le nom du projet en haut (lecture seule depuis BT).
- **Module Projets** affiche les BT lies dans son onglet « Bons de travail » (depuis `GET /projects/{id}/bons-travail`).

### 5.2 Integration Inventaire

**Auto-creation de mouvements de stock** :

| Action sur ligne BT | Mouvement cree | Quantite               | Motif (texte)                 |
|---------------------|----------------|------------------------|-------------------------------|
| AJOUT ligne         | `SORTIE`       | `+quantite`            | `Ligne BT BT-NNNNN`           |
| MODIF qte (delta>0) | `SORTIE`       | `+delta`               | `Modification ligne BT BT-NNNNN` |
| MODIF qte (delta<0) | `ENTREE`       | `+abs(delta)`          | `Modification ligne BT BT-NNNNN` |
| SUPPRESSION ligne   | `ENTREE`       | `+quantite`            | `Annulation ligne BT BT-NNNNN`|

> Tous les mouvements ont `reference_document = BT-NNNNN`, `employee_id = utilisateur connecte`, `created_at = CURRENT_TIMESTAMP`.

> **Visibilite** : les mouvements apparaissent dans **Inventaire -> onglet Mouvements** filtres par produit et par BT.

### 5.3 Integration Dossiers (CRM)

- Lors de la creation d un BT avec `project_id`, si le projet est lie a une opportunite CRM avec un `dossier_id`, le BT est **auto-rattache** au dossier via `dossier_formulaires` (ON CONFLICT DO NOTHING).
- Le dossier (Fiche 360) affiche le BT dans son onglet « Bons de travail ».

### 5.4 Integration Calendrier

- Les BT avec `date_debut`, `date_fin` ou `date_echeance` apparaissent dans **Calendrier** (`/calendar`).
- Click sur un evenement BT -> redirection vers `/bons-travail?open={btId}` (auto-ouverture vue Detail).
- Les operations avec dates apparaissent egalement (couleur differente).

### 5.5 Integration Gantt

- Les BT avec `date_debut` ET `date_fin` apparaissent dans le Gantt module (page Suivi & Gantt, voir [02-suivi-gantt.md](03-suivi-gantt.md)).
- Endpoint : `GET /production/gantt/bons-travail`.
- Les operations apparaissent comme sous-taches du BT (regroupement hierarchique).

### 5.6 Integration Pointage / Heures

- **Aucune integration automatique** entre Pointage (table `time_entries`) et Operations (`heures_reelles`).
- Le bouton **Pointer** (Module Pointage / Mobile) permet de pointer un employe sur un BT mais NE met PAS a jour `operations.heures_reelles`.
- Pour la facturation interne : interroger `time_entries WHERE bt_id = X` (rapport manuel).

### 5.7 FAQ

**Q : Comment annuler une consommation de stock par erreur ?**
R : Supprimer la ligne (icone poubelle dans le tableau Lignes). Le stock est **automatiquement re-credite** via mouvement `ENTREE`. Annuler le BT (statut ANNULE) ne re-credite **pas** le stock.

**Q : Pourquoi le bouton Supprimer (poubelle) du BT n est pas visible sur un BT TERMINE ?**
R : Par design : la suppression est limitee aux BT `BROUILLON` (jamais demarre) ou `ANNULE`. Pour archiver un BT TERMINE, le passer manuellement en ANNULE via le `<select>` Statut (modale Modifier).

**Q : Le stock est tombe en negatif, est-ce normal ?**
R : Oui. Aucune verification `stock_disponible >= quantite` cote backend. Le stock peut etre negatif si une ligne est ajoutee sans avoir reapprovisionne d abord. A surveiller via Inventaire (alertes seuil minimum).

**Q : Comment reouvrir un BT TERMINE ?**
R : Pas de bouton dedie. Ouvrir la modale Modifier -> changer le `<select>` Statut de TERMINE vers EN_COURS -> Enregistrer.

**Q : Les heures reelles d operation sont-elles automatiquement mises a jour depuis Pointage ?**
R : **NON**. Saisie 100 % manuelle (champ editable dans modale operation). Pour automatiser, agreger les `time_entries` par BT et reporter manuellement.

**Q : Un employe peut-il etre assigne deux fois au meme BT ?**
R : Non. Contrainte UNIQUE `(bt_id, employee_id)`. Tentative de doublon -> HTTP 409 `Employe deja assigne`.

**Q : Comment imprimer le BT en format papier ?**
R : Bouton **Imprimer** (icone Printer) -> ouvre HTML dans nouvel onglet -> Ctrl+P -> Imprimante ou Enregistrer en PDF.

**Q : Le BT est rattache automatiquement a un dossier CRM ?**
R : Oui, **si** le projet du BT est lie a une opportunite CRM avec un dossier_id. Sinon le rattachement reste manuel via le module Dossiers.

**Q : Peut-on dupliquer un BT existant ?**
R : Non. Aucune fonction « Dupliquer » pour les BT (contrairement aux Devis et Factures). Recreer manuellement.

**Q : Le BT a-t-il un workflow d approbation (validation par superviseur) ?**
R : Non. Tout utilisateur authentifie du tenant peut creer, modifier, demarrer et terminer un BT. Aucun systeme de roles « approuvateur » dans cette version.

---

## 6. Recap one-pager

- **Cycle statut** : BROUILLON -> EN_COURS (Demarrer) -> [EN_PAUSE (Pause)] -> TERMINE (Terminer). Annulable depuis BROUILLON/EN_COURS/EN_PAUSE.
- **Numero auto** : BT-NNNNN race-safe (INSERT TEMP + UPDATE).
- **Soft-delete** : DELETE = UPDATE statut=ANNULE. Suppression hard impossible.
- **Stock auto** : SORTIE a l ajout/modif (delta>0), ENTREE a la suppression/modif (delta<0).
- **Operations independantes** du statut BT — heures_reelles 100 % manuelles (pas de lien Pointage).
- **Assignations** : UNIQUE par (bt, employe). Roles texte libre.
- **HTML imprimable** : POST `/generate-html` -> nouvel onglet -> Ctrl+P.
- **Pas de TPS/TVQ** : document operationnel interne, sans taxes ni export comptable.

---

**Documentation generee a partir du code** : `production.py` (router), `BonsTravailPage.tsx` (UI), `production.ts` (api client), `productionStore.ts` (state).

**Manuels lies** :
- Module 1 (Projets) — `01-projets.md`
- Module 2 (Suivi & Gantt) — `02-suivi-gantt.md`
- Module 7 (Inventaire) — `10-inventaire.md`
- Module 8 (Dossiers Fiche 360) — `08-dossiers.md`
