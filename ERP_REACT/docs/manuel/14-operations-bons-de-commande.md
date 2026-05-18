# Module 6 — Bons de Commande / Achats / Fournisseurs

> **Version** : 2.0 (refonte verifiee contre le code source)
> **Code de reference** : `backend/routers/suppliers.py` (BC + fournisseurs), `backend/routers/production.py` (kanban achats), `frontend/src/pages/MagasinPage.tsx` (UI), `frontend/src/api/suppliers.ts` (client)
> **Tables PostgreSQL** : `bons_commande`, `bon_commande_lignes`, `fournisseurs`, `achat_assignations`, `dossier_achats`

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (Magasin)](#2-interface-magasin)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Gerer le cycle d achat : creer une fiche fournisseur, emettre des **bons de commande** (BC) numerotes, lister les materiaux/services commandes, suivre l etat (Brouillon -> Envoye -> Recu -> Facture), generer des PDF imprimables avec TPS/TVQ, lier au projet et au dossier CRM, declencher une depense en comptabilite.

### 1.2 7 statuts BC (VALID_BC_STATUTS)

Source : `suppliers.py:518` — `VALID_BC_STATUTS = {'Brouillon', 'Envoye', 'Confirme', 'En cours', 'Recu', 'Facture', 'Annule'}` (Title Case, **sans accents**).

| Statut       | Couleur badge (UI)                        | Signification                              |
|--------------|-------------------------------------------|--------------------------------------------|
| `Brouillon`  | gris                                      | Cree, pas envoye au fournisseur            |
| `Envoye`     | indigo                                    | Transmis au fournisseur                    |
| `Confirme`   | (fallback gris — non mappe dans UI)       | Fournisseur a confirme la commande         |
| `En cours`   | (fallback gris — non mappe dans UI)       | Livraison en cours                         |
| `Recu`       | sarcelle                                  | Marchandise receptionnee                   |
| `Facture`    | (fallback gris — non mappe dans UI)       | Facture fournisseur recue et enregistree   |
| `Annule`     | rouge                                     | Commande annulee                           |

> **Discrepancy importante** : `MagasinPage.tsx` definit `BC_STATUS_COLORS` avec 6 valeurs (`Brouillon`, `Envoye`, `Approuve`, `Commande`, `Recu`, `Annule`) — `Confirme`, `En cours`, `Facture` du backend ne sont PAS mappes (badge tombe en gris par defaut), et `Approuve`, `Commande` de l UI ne correspondent a aucun statut backend (residus mort).

### 1.3 Format numero BC

`BC-NNNNN` (zero-padded sur 5 chiffres). Exemples : `BC-00001`, `BC-00007`, `BC-12345`.

> **Pas de prefixe annee** : le format est `BC-NNNNN` pas `BC-AAAA-NNNNN`. Source : `suppliers.py:415` `numero = f"BC-{bc_id:05d}"`.

Genere atomiquement via le pattern **TEMP-then-UPDATE** :
1. INSERT avec `numero = 'TEMP'` -> retourne `id`.
2. UPDATE `numero = 'BC-' || lpad(id::text, 5, '0')`.
3. Race-safe sous concurrence.

### 1.4 Acces

- Sidebar -> **Magasin** (icone ShoppingCart)
- URL : `/magasin`
- Onglet par defaut : **Bons de commande** (`?tab=orders`)
- Auto-ouverture d un BC : `/magasin?tab=orders&open={bc_id}` (depuis Calendrier, Dossier, etc.)

### 1.5 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD fournisseurs et BC.
- **Aucun workflow d approbation** (pas de roles « approuvateur » ou « acheteur »).
- **Suppression hard-delete** : un BC supprime est physiquement retire de la base (cf. section 3.7).

---

## 2. Interface (Magasin)

### 2.1 Page `/magasin`

4 onglets (definis dans `MagasinPage.tsx:38`) :

| Cle           | Label             | Icone        | Contenu                                           |
|---------------|-------------------|--------------|---------------------------------------------------|
| `orders`      | Bons de commande  | FileText     | Tableau BC + vue Detail BC (DEFAUT)               |
| `movements`   | Mouvements        | ArrowUpDown  | Historique mouvements stock (ENTREE/SORTIE/AJUSTEMENT) |
| `products`    | Inventaire        | Package      | Catalogue produits (cf. Module 10)                |
| `suppliers`   | Fournisseurs      | Truck        | Liste fournisseurs + creation/edition             |

Selecteur d onglet en haut. URL `?tab=orders|movements|products|suppliers`.

### 2.2 Onglet « Bons de commande »

#### 2.2.1 Tableau BC (gauche)

Colonnes (largeurs ajustables, redimensionnables) :
- **Numero** (`BC-NNNNN`)
- **Fournisseur** (denormalise dans `bons_commande.fournisseur_nom`)
- **Projet** (`projects.nom_projet` via JOIN si `project_id` non null)
- **Montant total** (`montant_total` somme des lignes)
- **Date commande** (editable inline)
- **Date livraison prevue** (editable inline)
- **Statut** (badge couleur — lecture seule depuis cette page)

Actions globales :
- **+ Nouveau BC** (necessite de selectionner un fournisseur d abord — cf. section 3.1)
- Recherche texte (numero, fournisseur, projet)
- Filtre par statut (dropdown)
- Filtre par projet (dropdown)
- Pagination (20 par page par defaut, ajustable jusqu a 100)
- Tri par colonne (clic header)

#### 2.2.2 Vue Detail BC (droite)

Selection d un BC -> panneau detail s ouvre.

**Encart en-tete** :
- Numero BC + badge statut (READ-ONLY)
- Fournisseur (lien vers fiche fournisseur)
- Projet associe (si renseigne)
- Date commande, Date livraison prevue
- Notes (texte libre)

**Boutons d action** (en-tete vue Detail) :
- **Generer HTML** (icone Code2) -> aperçu plein ecran
- **Aperçu** (icone Eye) -> meme aperçu (boutons doublons cf. lignes 1053-1095)
- **Supprimer** (icone Trash2 — pas visible si statut Recu ou Facture)

> **PAS de bouton « Envoyer » fonctionnel** : commentaire `{/* Action buttons: HTML + Aperçu + Envoyer */}` dans le code (ligne 1053) mais aucune action « Envoyer » n est implementee.

> **PAS de selecteur de statut depuis Magasin** : le statut est affiche en read-only. Pour changer le statut, il faut utiliser la **vue Kanban Achats** dans Suivi & Gantt (cf. section 3.5).

#### 2.2.3 Section « Lignes de commande »

Tableau lignes (sous le panneau Detail) :
- **Description** (texte libre)
- **Code produit** (auto-rempli si lie a `produits.code_produit`)
- **Quantite** (numeric, > 0)
- **Unite** (texte, ex. `un`, `m2`, `t`)
- **Prix unitaire** (numeric, >= 0)
- **Montant** (`quantite * prix_unitaire`, recalcule auto)
- **Actions** (icone poubelle pour supprimer)

**Formulaire d ajout** (sous le tableau) :
- Champ **Produit** (dropdown inventaire — auto-remplit description/unite/prix)
- Champ **Description** (modifiable apres selection produit)
- Champs **Quantite**, **Unite**, **Prix unitaire** (manuels)
- Bouton **Ajouter** -> POST ligne -> recalcul `montant_total`

> **Pas de mouvement de stock automatique** a l ajout/suppression d une ligne BC (contrairement aux lignes BT). Le BC declare une intention d achat ; la reception physique est une operation **manuelle separee** (creation d un mouvement ENTREE depuis l onglet Mouvements ou changement de statut a `Recu`).

### 2.3 Onglet « Fournisseurs »

#### 2.3.1 Tableau fournisseurs

Colonnes :
- **Nom** (`nom_fournisseur` ou `companies.nom` via JOIN)
- **Contact principal**
- **Categorie produits**
- **Conditions de paiement** (defaut `30 jours net`)
- **Evaluation qualite** (note 1-5, etoiles)
- **Statut** (`Actif` / `Inactif` selon `est_actif`)

Recherche par nom + filtre categorie.

#### 2.3.2 Vue Detail fournisseur

- Coordonnees completes (adresse, telephone, email, contact commercial, contact technique)
- Certifications (texte libre)
- Notes evaluation (texte libre)
- Liste BC du fournisseur (`GET /suppliers/{id}/orders`)
- Bouton **Modifier** -> modale edition
- Bouton **+ Nouveau BC** -> cree un BC pour ce fournisseur

### 2.4 Onglet « Mouvements »

Cf. Module 10 (Inventaire / Magasin) pour la documentation complete des mouvements de stock.

Resume : tableau historique de tous les mouvements (ENTREE/SORTIE/AJUSTEMENT), filtres par produit, type, periode, reference document. Chaque ligne montre : date, produit, type, quantite, qte_avant, qte_apres, reference (BT/BC), motif, employe.

---

## 3. Workflows pas-a-pas

### 3.1 Creer un fournisseur

1. Magasin -> onglet **Fournisseurs** -> bouton **+ Nouveau fournisseur**.
2. Modale : selectionner un **Companies** existant (dropdown — la fiche fournisseur reference toujours une `company_id`).
3. Champs :
   - **Nom fournisseur** (optionnel — defaut = `companies.nom`)
   - **Code fournisseur** (optionnel — code interne pour reference rapide)
   - **Contact principal** / **Email** / **Telephone**
   - **Adresse** / **Ville** / **Province** (defaut Quebec) / **Code postal**
   - **Categorie produits** (texte libre — ex. `Beton`, `Acier`)
   - **Conditions de paiement** (defaut `30 jours net`)
   - **Delai livraison moyen** (jours, defaut 14)
   - **Contact commercial** / **Contact technique**
   - **Evaluation qualite** (1-5, defaut 5)
   - **Certifications** (texte libre — ex. `ISO 9001`, `RBQ 5678-1234-01`)
   - **Notes** (interne) / **Notes evaluation** (qualite)
4. **Enregistrer** -> `POST /suppliers`.
5. La fiche apparait dans le tableau, statut `Actif` par defaut.

### 3.2 Creer un bon de commande

1. Magasin -> onglet **Fournisseurs** -> selectionner un fournisseur.
2. Vue Detail fournisseur -> bouton **+ Nouveau BC**.
3. Formulaire BC :
   - **Projet** (optionnel — dropdown projects)
   - **Date livraison prevue** (optionnel)
   - **Notes** (texte libre)
4. **Enregistrer** -> `POST /suppliers/{supplier_id}/orders`.
5. Backend :
   - Recupere `fournisseur_nom` (denormalise pour rapidite).
   - INSERT avec `numero = 'TEMP'`, `statut = 'Brouillon'`, `date_commande = CURRENT_DATE`.
   - UPDATE `numero = 'BC-' || lpad(id::text, 5, '0')`.
   - **Si projet -> dossier CRM** : auto-rattachement via `dossier_achats` (ON CONFLICT DO NOTHING).
6. Le BC apparait dans l onglet Bons de commande, statut `Brouillon`.

> **Pas de bouton « + Nouveau BC » global** dans l onglet Bons de commande : il faut d abord aller dans Fournisseurs, choisir un fournisseur, puis creer le BC depuis sa fiche.

### 3.3 Ajouter une ligne BC

1. Selectionner un BC -> vue Detail s ouvre.
2. Section **Lignes** -> sous-formulaire **Ajouter un article** :
   - Choisir un **Produit** (dropdown inventaire) OU saisir une **Description** libre.
   - **Quantite** (numeric, > 0).
   - **Unite** (`un`, `m2`, `t`, etc. — auto-remplie depuis produit).
   - **Prix unitaire** (numeric — auto-rempli depuis produit `prix_revient`).
3. **Ajouter** -> `POST /suppliers/orders/{bc_id}/lines`.
4. Backend :
   - Calcule `montant = round(quantite * prix_unitaire, 2)`.
   - INSERT dans `bon_commande_lignes`.
   - Recalcule `bons_commande.montant_total = SUM(montant)`.
5. La ligne apparait dans le tableau.

> **Aucun mouvement de stock declenche** (vs lignes BT qui creent SORTIE auto).

### 3.4 Supprimer une ligne BC

1. Vue Detail BC -> tableau Lignes -> icone poubelle a droite.
2. Confirmation -> `DELETE /suppliers/orders/{bc_id}/lines/{line_id}`.
3. Backend :
   - DELETE FROM `bon_commande_lignes`.
   - Recalcule `montant_total`.
4. La ligne disparait. **Pas de mouvement de stock**.

### 3.5 Changer le statut d un BC (via Kanban Achats)

> **Le seul moyen** de changer le statut d un BC est la **vue Kanban Achats** (page Suivi & Gantt — cf. [02-suivi-gantt.md](03-suivi-gantt.md) section Kanban).

1. Aller dans **Suivi & Gantt** (`/suivi-gantt`) -> onglet Kanban -> selecteur entite « Achats ».
2. Le tableau Kanban affiche les BC groupes par statut (colonnes).
3. **Drag-and-drop** la carte BC vers la colonne du nouveau statut.
4. `PUT /production/kanban/update-status` avec `{entity_type: "achat", entity_id: bc_id, new_statut: "Envoye"}`.
5. Backend :
   - Mappe `entity_type=achat` -> table `bons_commande`.
   - **Aucune validation** sur les valeurs de statut pour les achats (`STATUT_MAP["achat"] = None`).
   - UPDATE `statut = %s WHERE id = %s`.

> **Consequence** : le drag-drop accepte n importe quelle chaine de statut. Si une colonne custom existe (ex. `Approuve`, `Commande`), le BC y atterrit avec ce statut — meme si non reconnu par le backend `VALID_BC_STATUTS`. La verification stricte `VALID_BC_STATUTS` n est appliquee QUE sur l endpoint `PUT /suppliers/purchase-orders/{bc_id}/status` (qui n est appele NULLE PART dans le frontend actuel).

### 3.6 Editer les dates d un BC (Magasin ou Gantt)

**Depuis Magasin** :
1. Tableau Bons de commande -> cellule **Date Commande** ou **Date Livraison** -> clic.
2. Champ date inline -> modifier -> blur ou Enter.
3. `PUT /suppliers/purchase-orders/{bc_id}/dates`.

**Depuis Gantt** :
1. Suivi & Gantt -> filtre « Achats » -> drag la barre du BC.
2. Meme endpoint `PUT /dates`.

### 3.7 Supprimer un BC

1. Vue Detail BC -> bouton **Supprimer** (icone Trash2).
2. Confirmation -> `DELETE /suppliers/purchase-orders/{bc_id}`.
3. Backend :
   - **Refuse si statut = `Recu` ou `Facture`** (HTTP 400 « Impossible de supprimer un bon recu ou facture »).
   - Cascade DELETE :
     - `bon_commande_lignes WHERE bon_commande_id = bc_id`
     - `dossier_achats WHERE achat_id = bc_id`
     - `achat_assignations WHERE bon_commande_id = bc_id`
   - Nullify : `UPDATE depenses SET bon_commande_id = NULL`.
   - DELETE FROM `bons_commande WHERE id = bc_id`.
4. Le BC disparait definitivement (hard-delete contrairement aux BT).

### 3.8 Generer le document HTML/PDF imprimable

1. Vue Detail BC -> bouton **Generer HTML** (ou **Aperçu** — comportement identique).
2. `POST /suppliers/orders/{bc_id}/generate-html` -> renvoie `{html: "<!DOCTYPE html>..."}`.
3. Le HTML s ouvre dans un viewer plein ecran integre a la page (modale `showBcHtmlPreview`).
4. Boutons impression : **Ctrl+P** -> Impression ou **Enregistrer en PDF**.
5. Le HTML genere inclut :
   - **En-tete entreprise** : nom, adresse, telephone, email, RBQ, NEQ, TPS, TVQ (depuis `parametres_entreprise`).
   - **Bloc fournisseur** : nom, adresse, telephone, email, contact commercial.
   - **Bloc commande** : date commande, date livraison prevue, projet, conditions de paiement.
   - **Tableau lignes** : description (+ code produit), unite, quantite, prix unitaire, montant.
   - **Sommaire** : Sous-total HT, **TPS (5%)**, **TVQ (9.975%)**, TOTAL TTC.
   - **6 conditions d achat** pre-definies (voir section 4.4).
   - **Notes** (si renseignees).
   - **2 blocs signature** : Acheteur / Fournisseur.
   - **Footer** : nom entreprise, numero BC, horodatage generation.
6. **Theme couleurs** depuis `parametres_documents` (couleurs personnalisables via Configuration -> Documents).

### 3.9 Assigner un employe a un BC (acheteur)

> Fonction disponible via API mais **PAS d UI dediee** dans MagasinPage (table `achat_assignations` accessible uniquement via Kanban Achats).

1. **Suivi & Gantt** -> Kanban Achats -> ouvrir une carte BC.
2. Section Assignations -> bouton **+ Assigner**.
3. `POST /production/achats/{achat_id}/assignations` avec `{employee_id, role}`.
4. Le nom de l employe assigne apparait sur la carte Kanban (initiales colorees).

### 3.10 Editer un fournisseur

1. Magasin -> Fournisseurs -> selectionner -> vue Detail -> bouton **Modifier**.
2. Modale d edition (memes champs que creation).
3. **Enregistrer** -> `PUT /suppliers/{supplier_id}`.
4. Pour **desactiver** un fournisseur : champ `est_actif = false` -> il disparait des dropdowns « Choisir fournisseur » mais reste consultable via filtre « Inactifs ».

---

## 4. Reference

### 4.1 Statuts BC (VALID_BC_STATUTS backend)

Source : `suppliers.py:518`

```python
VALID_BC_STATUTS = {'Brouillon', 'Envoye', 'Confirme', 'En cours', 'Recu', 'Facture', 'Annule'}
```

| Statut       | Backend valide ? | UI mappe couleur ? | Suppression possible ? |
|--------------|------------------|--------------------|-----------------------|
| `Brouillon`  | OUI              | OUI (gris)         | OUI                   |
| `Envoye`     | OUI              | OUI (indigo)       | OUI                   |
| `Confirme`   | OUI              | NON (gris fallback) | OUI                  |
| `En cours`   | OUI              | NON (gris fallback) | OUI                  |
| `Recu`       | OUI              | OUI (sarcelle)     | **NON (HTTP 400)**    |
| `Facture`    | OUI              | NON (gris fallback) | **NON (HTTP 400)**    |
| `Annule`     | OUI              | OUI (rouge)        | OUI                   |
| `Approuve`   | NON              | OUI (bleu)         | (n existe pas)        |
| `Commande`   | NON              | OUI (mauve)        | (n existe pas)        |

> **Note** : les couleurs `Approuve` et `Commande` cote UI sont des **residus morts** — aucun code ne genere ces statuts. Probablement un ancien design partiellement migre.

### 4.2 Format numero

Pattern : `BC-NNNNN` (zero-padded sur 5).

Source : `suppliers.py:415` `numero = f"BC-{bc_id:05d}"`.

Exemples : `BC-00001`, `BC-00042`, `BC-12345`.

> **Pas d annee** dans le format. Les BC sont numerotes en sequence globale, pas par annee fiscale.

### 4.3 Calculs

| Champ                  | Formule                                                | Recalcul declenche par                |
|------------------------|--------------------------------------------------------|---------------------------------------|
| `bon_commande_lignes.montant` | `round(quantite * prix_unitaire, 2)`            | INSERT/UPDATE ligne                   |
| `bons_commande.montant_total` | `SUM(bon_commande_lignes.montant)`              | INSERT/DELETE ligne                   |

**Calculs HTML uniquement** (pas en base) :
| Champ HTML        | Formule                                                |
|-------------------|--------------------------------------------------------|
| Sous-total HT     | `SUM(lignes.montant)` ou fallback `montant_total`      |
| TPS               | `round(sous_total_ht * 0.05, 2)`                       |
| TVQ               | `round(sous_total_ht * 0.09975, 2)`                    |
| Total TTC         | `round(sous_total_ht + tps + tvq, 2)`                  |

> **TPS/TVQ pas stockes en base** : calcules uniquement au moment de la generation HTML/PDF. Le `montant_total` en base = sous-total HT.

### 4.4 6 Conditions d achat (BC_CONDITIONS)

Source : `suppliers.py:752`

1. Les prix sont en dollars canadiens (CAD) et ne comprennent pas les taxes applicables.
2. Les materiaux doivent etre conformes aux specifications et normes en vigueur.
3. Le fournisseur doit aviser l acheteur de tout retard de livraison des que possible.
4. Les materiaux endommages ou non conformes seront retournes aux frais du fournisseur.
5. La facturation doit inclure le numero de bon de commande comme reference.
6. Les conditions de paiement sont selon les termes convenus avec le fournisseur.

> **Non personnalisables par tenant** (codees en dur dans `BC_CONDITIONS`).

### 4.5 Conditions de paiement fournisseur (defauts)

Champ `fournisseurs.conditions_paiement` (TEXT, defaut `"30 jours net"`).

Valeurs courantes saisies en texte libre :
- `30 jours net`
- `60 jours net`
- `2/10 net 30`
- `Comptant a la livraison`
- `Acompte 30% + solde 30 jours`

> Aucune liste predefinie cote backend. Saisie libre.

### 4.6 Validations & limites

| Regle                                              | Effet                                                 |
|----------------------------------------------------|-------------------------------------------------------|
| `quantite <= 0` (ligne)                            | Pydantic refuse (HTTP 422 `quantite > 0`)             |
| `prix_unitaire < 0` (ligne)                        | Pydantic refuse (HTTP 422 `prix_unitaire >= 0`)       |
| `statut` non dans `VALID_BC_STATUTS` via PUT /status | HTTP 400 (mais cet endpoint n est pas appele depuis l UI) |
| `statut` via Kanban (`PUT /kanban/update-status`)  | **Aucune validation** pour `entity_type=achat`        |
| Suppression BC avec statut `Recu` ou `Facture`     | HTTP 400                                              |
| Email fournisseur invalide                         | (pas de validation backend — texte libre)             |
| `evaluation_qualite < 1` ou `> 5`                  | (pas de validation backend — accepte `0`, `7`, etc.)  |

### 4.7 Tables PostgreSQL

| Table                  | Role                                       | Cles                                                                |
|------------------------|--------------------------------------------|---------------------------------------------------------------------|
| `fournisseurs`         | Fiches fournisseurs                        | PK `id`, FK `company_id`, IDX `est_actif`                           |
| `bons_commande`        | En-tete BC                                 | PK `id`, FK `fournisseur_id`, FK `project_id`, denorm `fournisseur_nom`, `montant_total` |
| `bon_commande_lignes`  | Lignes d articles                          | PK `id`, FK `bon_commande_id`, FK `produit_id` (optionnel)          |
| `achat_assignations`   | Acheteurs assignes aux BC                  | PK `id`, FK `achat_id` (= bc_id), FK `employee_id`                  |
| `dossier_achats`       | Lien CRM (auto-link a la creation)         | PK composite `(dossier_id, achat_id)`                               |
| `depenses`             | Depenses comptables liees aux BC           | FK `bon_commande_id` (nullable)                                     |

---

## 5. Integrations & FAQ

### 5.1 Integration Inventaire (CRITIQUE)

> **Pas de creation automatique de mouvement de stock** lors de l ajout d une ligne BC ou du changement de statut a `Recu`.

**Comparaison BT vs BC** :
| Action                           | BT (Bon de travail) | BC (Bon de commande) |
|----------------------------------|---------------------|----------------------|
| Ajout ligne avec produit         | SORTIE auto         | **Aucun mouvement**  |
| Suppression ligne                | ENTREE auto         | **Aucun mouvement**  |
| Modification quantite            | SORTIE/ENTREE delta | **Aucun mouvement**  |
| Changement statut                | (sans effet stock)  | **Aucun mouvement**  |

**Pour reapprovisionner le stock a la reception d un BC** :
1. Aller dans Magasin -> onglet **Mouvements** -> bouton **+ Mouvement**.
2. Selectionner produit, quantite, type = `ENTREE`.
3. Optionnel : reference document = `BC-NNNNN`.
4. Optionnel : motif = `Reception BC-NNNNN`.
5. Enregistrer -> mouvement cree, `produits.stock_disponible += quantite`.

> Le BC est **un document d engagement d achat**, pas un declencheur de mouvement automatique. La reception physique est une operation manuelle separee.

### 5.2 Integration Projets

- Champ `bons_commande.project_id` (optionnel) -> FK `projects.id`.
- Si renseigne : le projet apparait dans la vue Detail BC, et le BC apparait dans l onglet « Achats » du module Projets.
- Tri/filtre par projet disponible dans le tableau BC.

### 5.3 Integration Dossiers (CRM)

- A la creation d un BC, **si** le projet du BC est lie a une opportunite CRM avec un `dossier_id`, le BC est **auto-rattache** au dossier via `dossier_achats` (ON CONFLICT DO NOTHING).
- Le dossier (Fiche 360) affiche le BC dans son onglet « Achats ».

### 5.4 Integration Comptabilite

- Champ `depenses.bon_commande_id` (nullable) lie une depense comptable a un BC.
- A la suppression d un BC : `UPDATE depenses SET bon_commande_id = NULL` (la depense reste, le lien casse).
- **Pas de creation automatique de depense** quand un BC passe a `Recu` ou `Facture` — la depense est creee manuellement depuis le module Comptabilite.

### 5.5 Integration Kanban Achats (Suivi & Gantt)

- `GET /production/kanban/achats` -> retourne les BC formates pour la vue Kanban (50 plus recents).
- Cartes affichent : `numero`, `fournisseur_nom`, `montant_total`, `date_commande`, assignees (avatars).
- Drag-drop entre colonnes -> `PUT /production/kanban/update-status` (sans validation pour les achats).
- Voir [02-suivi-gantt.md](03-suivi-gantt.md) pour le detail du Kanban.

### 5.6 Integration Gantt BC

- Endpoint dedie : `GET /production/gantt/bons-commande` (production.py:583).
- Les BC avec `date_commande` ET `date_livraison_prevue` apparaissent comme barres dans la vue Gantt.
- Drag de la barre -> `PUT /suppliers/purchase-orders/{bc_id}/dates`.
- Couleur barre : selon statut (Brouillon=gris, Envoye=indigo, etc.).

### 5.7 Integration Calendrier

- BC avec `date_livraison_prevue` apparaissent comme evenements dans le Calendrier (`/calendar`).
- Click sur un evenement -> redirection `/magasin?tab=orders&open={bc_id}`.

### 5.8 FAQ

**Q : Le format `BC-AAAA-NNNNN` (ex. BC-2026-00007) annonce dans la v1 du manuel est-il correct ?**
R : **NON**. C est une erreur de la v1. Le vrai format est `BC-NNNNN` (ex. `BC-00007`). Pas de prefixe annee.

**Q : Quand je passe le BC a Recu, le stock est-il automatiquement augmente ?**
R : **NON**. Aucune integration automatique entre statut BC et mouvements de stock. Pour creer un mouvement ENTREE, utiliser l onglet Mouvements (cf. section 5.1).

**Q : Comment changer le statut d un BC depuis la page Magasin ?**
R : **Pas possible directement**. Le statut est read-only dans la vue Detail BC. Pour changer le statut, aller dans **Suivi & Gantt** -> Kanban Achats -> drag-drop la carte BC.

**Q : Pourquoi le bouton Envoyer est commente dans le code ?**
R : Le commentaire `Action buttons: HTML + Apercu + Envoyer` est un **vestige** d une fonctionnalite jamais implementee. Aucune action « Envoyer email au fournisseur » n existe. Pour envoyer le BC, generer le HTML/PDF et l envoyer manuellement par email.

**Q : Puis-je supprimer un BC dont le statut est Recu ou Facture ?**
R : **NON**. Le backend refuse (HTTP 400 « Impossible de supprimer un bon recu ou facture »). Pour supprimer, passer d abord le BC en `Annule` via Kanban Achats, puis supprimer depuis Magasin.

**Q : Les statuts Approuve et Commande apparaissent dans la liste des couleurs UI mais pas dans VALID_BC_STATUTS, comment les utiliser ?**
R : **A eviter**. Ce sont des residus morts dans le code frontend. Si un BC se retrouve avec un de ces statuts (via une colonne Kanban custom), l UI affichera la couleur mais aucun comportement attendu. Les 7 statuts officiels sont : Brouillon, Envoye, Confirme, En cours, Recu, Facture, Annule.

**Q : Pourquoi il n y a pas de bouton + Nouveau BC global dans l onglet Bons de commande ?**
R : Par design : un BC doit etre rattache a un fournisseur. Le formulaire de creation est accessible depuis la fiche Fournisseur -> bouton « + Nouveau BC ». Cela force la selection du fournisseur en amont.

**Q : Comment dupliquer un BC existant ?**
R : **Pas de fonction Dupliquer**. Recreer manuellement (creer un nouveau BC pour le meme fournisseur, ajouter les memes lignes).

**Q : Quel est le lien entre BC et Comptabilite ?**
R : Une depense comptable peut referencer un BC via `depenses.bon_commande_id` (FK nullable). Lien creer **manuellement** depuis le module Comptabilite (cf. [07-factures.md](15-operations-comptabilite.md)). A la suppression du BC, la depense reste mais perd le lien.

**Q : Comment voir tous les BC d un fournisseur ?**
R : Magasin -> Fournisseurs -> selectionner -> vue Detail -> section « Bons de commande » liste les BC de ce fournisseur (`GET /suppliers/{supplier_id}/orders`).

**Q : Les BC ont-ils un workflow d approbation ?**
R : **NON**. Tout utilisateur authentifie peut creer, modifier, transmettre et supprimer un BC. Aucun systeme de roles « approuvateur » ou « budget approval ».

**Q : Peut-on lier une ligne BC a un produit du catalogue ?**
R : **OUI**. Champ `produit_id` (optionnel) dans la ligne BC. Si renseigne, la description, l unite et le prix sont auto-remplis depuis `produits`. Permet ensuite des stats par produit (consommation, fournisseurs frequents, etc.).

**Q : Le BC est-il visible dans le module B2B portal pour le fournisseur ?**
R : **NON**. Le portail B2B est pour les **clients** (devis, projets, factures), pas pour les fournisseurs. Le BC est un document interne envoye manuellement (PDF par email).

---

## 6. Recap one-pager

- **Format BC** : `BC-NNNNN` (5 chiffres, race-safe TEMP+UPDATE) — **PAS** `BC-AAAA-NNNNN`.
- **7 statuts** : Brouillon -> Envoye -> Confirme -> En cours -> Recu -> Facture (+Annule).
- **Modification statut** : UNIQUEMENT via Kanban Achats (Suivi & Gantt). Read-only dans Magasin.
- **Validation Kanban** : NULLE pour les achats (`STATUT_MAP["achat"] = None`) — drag accepte n importe quel statut.
- **Pas de mouvement de stock automatique** a l ajout/suppression de ligne ou changement de statut. Reception 100% manuelle via Mouvements.
- **TPS/TVQ** : calcules uniquement dans le HTML, pas stockes en base. TPS 5%, TVQ 9.975%.
- **Suppression hard-delete** : BC physiquement supprime + cascade lignes/dossier_achats/achat_assignations + nullify depenses. Refuse si statut Recu ou Facture.
- **Auto-link dossier CRM** : si projet -> opportunite -> dossier, BC auto-rattache via `dossier_achats`.
- **Pas de Dupliquer**, **Pas d Envoyer email**, **Pas de workflow d approbation**, **Pas de selecteur de statut** dans Magasin.

---

**Documentation generee a partir du code** : `suppliers.py`, `production.py` (kanban + gantt BC), `MagasinPage.tsx`, `suppliers.ts`.

**Manuels lies** :
- Module 1 (Projets) — `01-projets.md`
- Module 2 (Suivi & Gantt — Kanban Achats) — `02-suivi-gantt.md`
- Module 7 (Factures / Comptabilite — depenses BC) — `07-factures.md`
- Module 10 (Inventaire / Magasin — mouvements) — `10-inventaire.md`
