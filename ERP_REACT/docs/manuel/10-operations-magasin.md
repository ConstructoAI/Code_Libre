# Module 10 — Inventaire / Magasin

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/inventory.py` (CRUD produits + mouvements + BOM + stats), `frontend/src/pages/MagasinPage.tsx` (onglets Inventaire + Mouvements), `frontend/src/api/inventory.ts`
> **Tables PostgreSQL** : `produits`, `mouvements_stock`, `produit_composants`

> Pour les onglets **Bons de commande** et **Fournisseurs** de la meme page Magasin, voir Module 6.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (Inventaire + Mouvements + BOM)](#2-interface-inventaire-mouvements-bom)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference (champs, types, mouvements)](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Gerer le **catalogue produits** (materiaux, equipements, EPI), suivre les **niveaux de stock** par produit, tracer tous les **mouvements** (entrees/sorties/ajustements), declarer les **BOM** (compositions parent-enfant pour assemblages) et alerter sur les ruptures de stock minimum.

### 1.2 Champs principaux du produit

Source : `inventory.py:18-33` (ProductCreate model)

| Champ                 | Type    | Defaut       | Notes                                          |
|-----------------------|---------|--------------|------------------------------------------------|
| `id`                  | SERIAL  | auto         | Cle primaire                                   |
| `code_produit`        | TEXT    | NULL         | UNIQUE (code interne ex. `BET-30MPA`)          |
| `nom`                 | TEXT    | obligatoire  | Nom du produit                                 |
| `description`         | TEXT    | NULL         | Texte libre                                    |
| `categorie`           | TEXT    | NULL         | Sert pour le filtre type produit               |
| `materiau`            | TEXT    | NULL         | **Repurposed pour la NORME** (CSA, ASTM, etc.) |
| `unite_vente`         | TEXT    | `unite`      | `un`, `m2`, `m3`, `kg`, `t`, `h`, etc.         |
| `cout_revient`        | FLOAT   | NULL         | Cout d achat unitaire                          |
| `prix_unitaire`       | FLOAT   | NULL         | Prix de vente unitaire                         |
| `fournisseur_principal` | TEXT  | NULL         | Texte libre (pas FK fournisseurs)              |
| `stock_disponible`    | FLOAT   | 0            | Quantite en stock courante                     |
| `stock_minimum`       | FLOAT   | 0            | Seuil d alerte rupture                         |
| `emplacement_stock`   | TEXT    | NULL         | Texte libre (ex. `Entrepot A, Tablette 3`)     |
| `notes_techniques`    | TEXT    | NULL         | Notes / fiche technique                        |
| `active`              | BOOLEAN | TRUE         | Actif/Inactif (boolean unique, pas de statut multi-etat) |
| `created_at`          | TIMESTAMP | auto       |                                                |
| `updated_at`          | TIMESTAMP | auto       |                                                |

> **Pas de champs** : photo/image, `stock_maximum`, `stock_reserve`, `stock_en_commande`, `lot_commande`. **Pas de FK directe** vers `fournisseurs.id` (le champ `fournisseur_principal` est texte libre denormalise).

### 1.3 13 types de produits (TYPE_PRODUIT_OPTIONS)

Source : `MagasinPage.tsx:67-80` (constantes frontend, stockees dans `categorie`)

`Beton et ciment`, `Bois et charpente`, `Acier et metal`, `Plomberie`, `Electricite`, `Isolation`, `Toiture`, `Peinture et finition`, `Quincaillerie`, `Revetement`, `Outillage`, `EPI / Securite`, `Autre`.

> **Pas d enum DB** : le champ `categorie` accepte n importe quelle chaine. La liste cote frontend est juste une suggestion de dropdown. L endpoint `GET /products/categories` recupere dynamiquement les valeurs distinctes presentes en base.

### 1.4 12 categories (CATEGORIE_PRODUITS_OPTIONS)

Source : `MagasinPage.tsx:82-94`

Memes valeurs que les types **plus** `Location equipement` (specifique aux categories) **moins** quelques entrees.

> Discrepancy historique entre les deux listes — preferer la liste « types produits » (13 valeurs) pour la coherence.

### 1.5 8 normes (NORME_OPTIONS)

Source : `MagasinPage.tsx:96-104`

`CSA` (Canadian Standards), `ASTM` (ASTM International), `BNQ` (Bureau de normalisation), `ULC` (Underwriters Laboratories), `ISO`, `LEED`, `Autre`.

> **Stockees dans le champ `materiau`** (renommage frontend `Norme applicable`). Confusion historique : le champ `materiau` n est PAS le materiau du produit mais la norme applicable.

### 1.6 3 types de mouvements

Source : `inventory.py:295-303`

| Type          | Sens                          | Validation                                   |
|---------------|-------------------------------|----------------------------------------------|
| `ENTREE`      | + stock                       | quantite > 0                                 |
| `SORTIE`      | - stock                       | quantite > 0 ET stock_disponible >= quantite (sinon HTTP 400) |
| `AJUSTEMENT`  | = stock (valeur absolue)      | quantite >= 0 (defini la nouvelle valeur, pas un delta) |

### 1.7 Acces

- Sidebar -> **Magasin** (icone ShoppingCart)
- URL : `/magasin`
- 4 onglets : `orders` (BC), `movements` (Mouvements), `products` (Inventaire), `suppliers` (Fournisseurs)
- Onglet par defaut : `orders` (BC) — pour aller a Inventaire : URL `/magasin?tab=products`

### 1.8 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD produits + creer mouvements manuels.
- Pas de roles dedies « magasinier » ou « approuvateur de mouvement ».
- Pas de soft-delete : les produits supprimes le sont physiquement (DELETE FROM `produits`).

---

## 2. Interface (Inventaire + Mouvements + BOM)

### 2.1 Onglet « Inventaire » (products)

#### 2.1.1 Tableau produits (gauche)

Colonnes (triables) :
- **Produit** (`nom`)
- **Categorie** (badge — depuis `categorie`)
- **Stock** (`stock_disponible` + unite)
- **Seuil** (`stock_minimum`)
- **Prix vente** (`prix_unitaire`)
- **Statut** (badge `Bas` rouge si `stock_disponible <= stock_minimum AND stock_minimum > 0`, sinon `OK` vert)

Actions globales :
- **+ Nouveau produit** (modale creation)
- Recherche texte (nom, code, description)
- Filtre **« Produits bas stock »** (checkbox)
- Filtre par categorie (dropdown)
- Pagination (20/page)

KPIs en haut de page (cartes) :
- **Total produits** (count actifs)
- **Alertes stock** (count low-stock)
- **Valeur inventaire** (somme `stock_disponible * COALESCE(cout_revient, prix_unitaire, 0)`)
- **Nb categories**

Source : `inventory.py:345-358` (`GET /inventory/stats`).

#### 2.1.2 Vue Detail produit (droite)

Affiche :
- Nom + code produit (monospace)
- Description, categorie, norme applicable (`materiau`)
- Stock disponible, stock minimum, unite
- Prix unitaire, cout de revient
- Fournisseur principal (texte)
- Emplacement stock
- Notes techniques

**Section BOM (Composants)** :
- Tableau composants enfants : Produit, Quantite, Unite, Prix, Stock, Notes, Action (poubelle)
- Sous-formulaire **Ajouter composant** : dropdown produit enfant + qte + unite + notes -> bouton Ajouter

**Section « Utilise dans »** :
- Tableau lecture seule des produits parents qui utilisent ce produit comme composant
- Permet de visualiser les dependances inverses (ex. « Cette vis est utilisee dans 3 assemblages »)

### 2.2 Onglet « Mouvements » (movements)

#### 2.2.1 Tableau mouvements

Colonnes :
- **Produit** (`produitNom`, denormalise)
- **Type** (badge couleur : vert ENTREE, rouge SORTIE, bleu AJUSTEMENT)
- **Quantite** (`quantite`)
- **Reference** (`referenceDocument` — ex. `BT-00007`)
- **Date** (`createdAt`)

> **Tableau quasi sans filtres** : seule la pagination (page/perPage) est implementee. **PAS de filtre par type, par produit, par date, par reference** dans cette version (limite frontend connue).

Bouton **+ Nouveau mouvement** -> modale creation manuelle (cf. workflow 3.3).

#### 2.2.2 Modale Creation mouvement manuel

Champs :
- **Produit** (dropdown avec stock courant affiche)
- **Type** (radio : ENTREE / SORTIE / AJUSTEMENT — descriptif sous chaque option)
- **Quantite** (numeric — le label change pour AJUSTEMENT : « Nouvelle quantite »)
- **Reference document** (optionnel — ex. `Reception BC-00012`, `Inventaire 2026-Q1`)
- **Motif** (optionnel — texte libre)

> Pour **AJUSTEMENT** : la quantite saisie devient la **nouvelle valeur** de stock (pas un delta). Le mouvement enregistre `quantite_avant`, `quantite_apres`, et `quantite = abs(apres - avant)`.

### 2.3 Modale Creation produit

Champs (grille 2 colonnes) :
- **Nom** (obligatoire)
- **Code produit** (UNIQUE — texte libre)
- **Stock initial** (numeric, defaut 0)
- **Seuil minimum** (numeric, defaut 0)
- **Categorie** (dropdown 13 valeurs ou texte libre)
- **Unite** (dropdown : un, m2, m3, kg, t, h, ...)
- **Fournisseur principal** (texte libre)
- **Emplacement** (texte libre)
- **Prix unitaire** (vente — float >= 0)
- **Cout de revient** (achat — float >= 0)
- **Norme applicable** (dropdown 8 valeurs — stocke dans `materiau`)
- **Description** (textarea)
- **Notes techniques** (textarea)

**Active = TRUE** par defaut (boolean unique, pas de selecteur multi-statuts).

---

## 3. Workflows pas-a-pas

### 3.1 Creer un produit

1. Magasin -> onglet **Inventaire** -> bouton **+ Nouveau produit**.
2. Modale : remplir les champs (cf. section 2.3).
3. **Enregistrer** -> `POST /products`.
4. Backend :
   - INSERT dans `produits` avec `active = TRUE`.
   - `code_produit` doit etre UNIQUE — tentative de doublon -> HTTP 400.
5. Le produit apparait dans le tableau, badge statut `OK` (si stock_minimum = 0 ou stock_disponible > seuil).

### 3.2 Modifier un produit

1. Vue Detail produit -> bouton **Modifier**.
2. Modale (memes champs).
3. **Enregistrer** -> `PUT /products/{product_id}`.
4. **Whitelist backend** des champs editables (11 champs autorises) : `nom`, `code_produit`, `description`, `categorie`, `materiau`, `unite_vente`, `cout_revient`, `prix_unitaire`, `fournisseur_principal`, `stock_minimum`, `emplacement_stock`, `notes_techniques`.

> **`stock_disponible` n est PAS modifiable directement** via PUT produit. Pour ajuster le stock : creer un **mouvement AJUSTEMENT** (cf. workflow 3.3).

### 3.3 Creer un mouvement de stock manuel

#### Cas A — Reception fournisseur (ENTREE)

1. Onglet **Mouvements** -> bouton **+ Nouveau mouvement**.
2. Modale :
   - Produit : selectionner
   - Type : **ENTREE**
   - Quantite : nombre recu (> 0)
   - Reference : `BC-00012` ou `Reception 2026-04-25`
   - Motif : `Reception fournisseur Beton du Nord`
3. **Enregistrer** -> `POST /stock-movements`.
4. Backend :
   - Lock row produit (`SELECT ... FOR UPDATE`).
   - Calcule `quantite_avant = stock_disponible`.
   - Calcule `quantite_apres = stock_avant + quantite`.
   - UPDATE `produits.stock_disponible = quantite_apres`.
   - INSERT dans `mouvements_stock` avec tous les champs.
5. Le stock est mis a jour, le mouvement apparait dans la liste.

#### Cas B — Sortie chantier (SORTIE)

1. Meme modale, type = **SORTIE**.
2. Quantite : qte sortie (> 0).
3. **Validation** : si `quantite > stock_disponible` -> HTTP 400 « Stock insuffisant ».
4. Sinon : `quantite_apres = stock_avant - quantite`, mouvement enregistre.

> **Bonne pratique** : reserver les sorties chantier aux **lignes de Bon de Travail** (qui creent automatiquement le SORTIE). Utiliser ce formulaire manuel pour des sorties hors-BT (vol, perte, demonstration commerciale).

#### Cas C — Inventaire physique (AJUSTEMENT)

1. Modale, type = **AJUSTEMENT**.
2. Le label du champ Quantite devient « Nouvelle quantite ».
3. Saisir la valeur **absolue** comptee physiquement (ex. 47 unites).
4. Backend :
   - `quantite_avant = stock_disponible_actuel` (ex. 50)
   - `quantite_apres = nouvelle_valeur` (ex. 47)
   - `quantite = abs(quantite_apres - quantite_avant)` (= 3)
   - UPDATE produits.stock_disponible = nouvelle_valeur (47)
5. Le mouvement enregistre l ecart pour audit.

> **Pour les ajustements positifs** (decouverte de stock supplementaire) : meme procedure, saisir une nouvelle quantite **superieure** au stock courant.

### 3.4 Voir les mouvements d un produit

**Methode 1** : Vue Detail produit -> section **Mouvements recents** affiche les 10 derniers mouvements.

**Methode 2** : Onglet Mouvements -> filtrer par produit (limite : pas de filtre frontend, mais l API supporte `GET /stock-movements?produit_id=X`).

### 3.5 Filtrer les produits en alerte (low stock)

1. Onglet Inventaire -> case a cocher **Produits bas stock**.
2. La requete devient `GET /products?low_stock=true`.
3. Backend filtre : `WHERE stock_disponible <= stock_minimum AND stock_minimum > 0`.
4. Liste reduite aux produits a reapprovisionner.

> **Pas de notification automatique** (email, push) sur seuil minimum atteint. Necessite consultation active de la liste filtree.

### 3.6 Creer un BOM (composition assemblage)

Cas d usage : un produit assemble (ex. `Module Salle de bain prefabrique`) compose de plusieurs composants (toilette, vasque, robinetterie, panneaux gypse, etc.).

1. Inventaire -> selectionner le **produit parent** -> vue Detail.
2. Section **Composants** -> sous-formulaire **Ajouter composant**.
3. Choisir le **produit enfant** dans le dropdown (parmi les autres produits actifs).
4. Saisir **Quantite** (ex. 2 toilettes par module) + **Unite** + **Notes** (optionnel).
5. **Ajouter** -> `POST /products/{parent_id}/composants`.
6. Backend valide :
   - Pas de self-reference (parent != enfant) — HTTP 400 si echec.
   - Pas de reference circulaire (enfant ne peut pas avoir parent comme composant indirect) — HTTP 400.
   - Contrainte UNIQUE `(parent_id, enfant_id)` — pas de doublons.
7. Le composant apparait dans le tableau Composants du parent.
8. Reciproquement, dans le produit enfant, la section **Utilise dans** affiche le parent.

### 3.7 Modifier un composant BOM

1. Vue Detail produit parent -> tableau Composants -> ligne composant -> bouton **Edit** (a verifier UI).
2. Modifier quantite / unite / notes.
3. `PUT /products/{parent_id}/composants/{composant_id}`.

### 3.8 Supprimer un composant BOM

1. Vue Detail parent -> tableau Composants -> ligne -> icone poubelle.
2. `DELETE /products/{parent_id}/composants/{composant_id}` -> hard delete.

### 3.9 Lister les categories existantes

Endpoint `GET /products/categories` -> retourne la liste des valeurs distinctes presentes dans la colonne `categorie` (DISTINCT). Utile pour pre-remplir des dropdowns dynamiques.

### 3.10 Voir les statistiques globales

Endpoint `GET /inventory/stats` -> retourne :
- `total_produits` (count actifs)
- `alertes_stock` (count low-stock)
- `valeur_inventaire` (somme valorisee — voir formule section 2.1.1 KPI)
- `nb_categories` (count distinct categorie)

Affichage : 4 cartes KPI en haut de l onglet Inventaire.

### 3.11 Reapprovisionner un produit (workflow complet)

1. Onglet Inventaire -> filtre **Produits bas stock** -> identifier les produits.
2. Pour chaque produit a recommander :
   - Identifier le `fournisseur_principal` du produit.
   - Aller dans Fournisseurs -> selectionner le fournisseur -> creer un BC (cf. Module 6).
   - Ajouter une ligne BC pour le produit, avec quantite a recommander.
3. **Apres reception physique** :
   - Soit changer le statut du BC en `Recu` (Module 6, via Kanban Achats) — **aucun effet sur stock**.
   - Soit, en plus, creer un mouvement **ENTREE** manuel (workflow 3.3 cas A) avec reference `BC-NNNNN` pour mettre a jour le stock physique.

> **Limitation connue** : le passage statut BC `Recu` ne declenche **pas** automatiquement de mouvement ENTREE. Il faut faire les deux operations separement (cf. Module 6 FAQ).

### 3.12 Supprimer un produit

1. Vue Detail produit -> bouton **Supprimer** (icone poubelle, en en-tete).
2. Confirmation -> `DELETE /products/{product_id}`.
3. **Hard delete** : suppression physique de `produits` (avec cascade FK sur `produit_composants`).

> **Attention** : la suppression efface les references cote produits enfants/parents. Les mouvements deja enregistres (`mouvements_stock`) restent (FK ON DELETE NULL ou conserves selon schema). Verifier en prod.

> **Recommandation** : preferer **desactiver** (UPDATE `active = false`) plutot que supprimer pour conserver l historique. Cependant cette option n est pas exposee actuellement dans l UI (pas de toggle Active dans la modale Modifier — verifier en prod).

---

## 4. Reference

### 4.1 Endpoints inventaire

| Methode | URL                                                  | Role                                          |
|---------|------------------------------------------------------|-----------------------------------------------|
| GET     | `/products`                                          | Liste paginee + filtres (search, categorie, low_stock) |
| GET     | `/products/categories`                               | Categories distinctes (DISTINCT)              |
| GET     | `/products/{product_id}`                             | Detail produit + 10 derniers mouvements      |
| POST    | `/products`                                          | Creer produit                                 |
| PUT     | `/products/{product_id}`                             | Modifier (whitelist 11 champs)                |
| GET     | `/inventory/stats`                                   | KPI : total, alertes, valeur, nb categories   |

### 4.2 Endpoints mouvements

| Methode | URL                                                  | Role                                          |
|---------|------------------------------------------------------|-----------------------------------------------|
| POST    | `/stock-movements`                                   | Creer mouvement (ENTREE/SORTIE/AJUSTEMENT)    |
| GET     | `/stock-movements`                                   | Liste paginee + filtre `produit_id`           |

### 4.3 Endpoints BOM

| Methode | URL                                                  | Role                                          |
|---------|------------------------------------------------------|-----------------------------------------------|
| GET     | `/products/{product_id}/composants`                  | Liste composants (enfants) + utilise dans (parents) |
| POST    | `/products/{product_id}/composants`                  | Ajouter composant enfant                      |
| PUT     | `/products/{product_id}/composants/{composant_id}`   | Modifier composant                            |
| DELETE  | `/products/{product_id}/composants/{composant_id}`   | Retirer composant                             |

### 4.4 Calculs

| Champ                           | Formule                                                |
|---------------------------------|--------------------------------------------------------|
| Statut « Bas »                  | `stock_disponible <= stock_minimum AND stock_minimum > 0` |
| Valeur inventaire (KPI)         | `SUM(stock_disponible * COALESCE(cout_revient, prix_unitaire, 0))` |
| Mouvement ENTREE/SORTIE         | `quantite_apres = quantite_avant ± quantite`           |
| Mouvement AJUSTEMENT            | `quantite_apres = nouvelle_valeur` (saisie directe), `quantite = abs(apres - avant)` |

### 4.5 Validations & limites

| Regle                                     | Effet                                                  |
|-------------------------------------------|--------------------------------------------------------|
| `code_produit` doublon                    | HTTP 400 (UNIQUE constraint)                           |
| ENTREE/SORTIE quantite <= 0               | HTTP 400                                               |
| AJUSTEMENT quantite < 0                   | HTTP 400                                               |
| SORTIE quantite > stock_disponible        | HTTP 400 « Stock insuffisant »                         |
| BOM composant = produit lui-meme          | HTTP 400 « Self-reference interdite »                  |
| BOM reference circulaire                  | HTTP 400                                               |
| BOM doublon (parent_id, enfant_id)        | HTTP 400 (UNIQUE constraint)                           |
| Modifier `stock_disponible` via PUT       | **Ignore** (champ hors whitelist) — utiliser AJUSTEMENT |

### 4.6 Tables PostgreSQL

| Table                  | Role                                                    |
|------------------------|---------------------------------------------------------|
| `produits`             | Catalogue produits (active boolean)                     |
| `mouvements_stock`     | Historique mouvements (ENTREE/SORTIE/AJUSTEMENT)        |
| `produit_composants`   | BOM parent-enfant (UNIQUE (parent_id, enfant_id))       |

### 4.7 Champs `mouvements_stock`

```
id (SERIAL PK)
produit_id (INTEGER FK)
type_mouvement (ENTREE | SORTIE | AJUSTEMENT)
quantite (FLOAT — toujours positif)
quantite_avant (FLOAT — stock avant operation)
quantite_apres (FLOAT — stock apres operation)
reference_document (TEXT — ex. BT-00007, BC-00012)
motif (TEXT — texte libre)
employee_id (INTEGER FK — utilisateur connecte au moment de l action)
created_at (TIMESTAMP)
```

### 4.8 Concurrence et race conditions

Source : `inventory.py:304` (lock row produit)

```python
cursor.execute("SELECT stock_disponible FROM produits WHERE id = %s FOR UPDATE", (...))
```

**Verrou pessimiste** sur la ligne produit pendant la creation du mouvement. Empeche les race conditions sous charge concurrente (ex. 2 BT supprimes en meme temps recreditant le stock).

### 4.9 Liste 13 types produits (pour copy-paste)

```
Beton et ciment
Bois et charpente
Acier et metal
Plomberie
Electricite
Isolation
Toiture
Peinture et finition
Quincaillerie
Revetement
Outillage
EPI / Securite
Autre
```

### 4.10 Liste 8 normes (pour copy-paste)

```
CSA - Canadian Standards
ASTM - ASTM International
BNQ - Bureau de normalisation
ULC - Underwriters Laboratories
ISO
LEED
Autre
```

---

## 5. Integrations & FAQ

### 5.1 Integration Bons de Travail (BT)

> **Auto-creation de mouvements** depuis BT, recapitulee :

| Action sur ligne BT     | Mouvement cree | Quantite          | Reference        | Motif                          |
|-------------------------|----------------|-------------------|------------------|--------------------------------|
| Ajout ligne (avec produit) | `SORTIE`    | `+quantite`       | `BT-NNNNN`       | `Ligne BT BT-NNNNN`            |
| Modif qte (delta>0)     | `SORTIE`       | `+abs(delta)`     | `BT-NNNNN`       | `Modification ligne BT BT-NNNNN` |
| Modif qte (delta<0)     | `ENTREE`       | `+abs(delta)`     | `BT-NNNNN`       | `Modification ligne BT BT-NNNNN` |
| Suppression ligne       | `ENTREE`       | `+quantite`       | `BT-NNNNN`       | `Annulation ligne BT BT-NNNNN` |

Source : `production.py:284-325`. Tous les mouvements ont `employee_id = utilisateur connecte`, `created_at = CURRENT_TIMESTAMP`.

### 5.2 Integration Bons de Commande (BC)

> **AUCUNE auto-creation de mouvements** depuis BC.

Le BC declare une **intention d achat** mais ne touche pas au stock. La reception physique necessite un **mouvement ENTREE manuel** depuis l onglet Mouvements (cf. workflow 3.3 cas A).

Le passage statut BC `Recu` ne declenche **pas** de mouvement automatique (voir Module 6 FAQ pour les details).

### 5.3 Integration Factures

- Pas d integration directe Factures -> Mouvements.
- Le module Factures peut **utiliser un produit** dans une ligne (champ `produit_id` optionnel) mais ne touche pas au stock.
- Pour les ventes au comptoir avec impact stock : utiliser un BT comme support (le BT cree les SORTIE) puis facturer separement.

### 5.4 Integration BOM (assemblages multi-niveaux)

- Le BOM est **declaratif uniquement** : declarer la composition d un produit assemble.
- **Pas de workflow d assemblage automatique** : creer un produit assemble ne consomme pas automatiquement les composants en stock.
- Pour declencher la consommation : creer un BT « Assemblage » avec une ligne pour chaque composant -> les SORTIE auto sont generees.
- Pour creer des stocks de produits assembles : creer un mouvement ENTREE manuel sur le produit parent.

### 5.5 Integration Comptabilite

- **Pas d ecriture journal automatique** lors d un mouvement de stock.
- Le compte comptable `1300` (Stocks materiaux) du plan comptable Quebec construction n est mis a jour que via le `sync-depenses` ou des ecritures manuelles dans Comptabilite.
- La valeur d inventaire (`valeur_inventaire` dans stats) est **calculee a la volee** mais pas synchronisee avec le bilan.

### 5.6 Integration Logistique

- Pas d integration directe avec le module Logistique (livraisons, vehicules, equipements).
- La planification de transport d un produit depuis l entrepot vers un chantier necessite un **bon de livraison** dans Logistique (separe du mouvement de stock).

### 5.7 FAQ

**Q : Comment scanner un code-barres pour pointer un produit ?**
R : **NON supporte dans cette version**. Pas d endpoint `/scan`, pas de support code-barres dans MagasinPage. Utiliser la recherche texte ou le code produit pour identifier rapidement.

**Q : Peut-on gerer plusieurs entrepots / depots ?**
R : **NON**. Le stock est global par produit (un seul `stock_disponible`). Le champ `emplacement_stock` est texte libre informationnel (ex. `Entrepot A, Tablette 3`) mais n est pas exploite pour des transferts ou des stocks par site.

**Q : Comment recevoir physiquement les marchandises d un BC ?**
R : **Procedure manuelle** :
1. Module 6 BC : Kanban Achats -> drag-drop le BC vers `Recu` (statut info).
2. Module 10 Inventaire : pour chaque produit recu, creer un mouvement **ENTREE** avec reference `BC-NNNNN` (cf. workflow 3.3 cas A).

**Q : Le stock peut-il etre negatif ?**
R : **OUI** dans certains cas. Les lignes BT (Module 5) creent des SORTIE sans verifier le seuil (le code BT ne fait pas le check `stock_disponible >= quantite`). Les mouvements **manuels** type SORTIE sont par contre bloques si insuffisants (cf. validation `inventory.py:308`). Discrepancy a surveiller.

**Q : Y a-t-il des notifications email/push quand un produit atteint le seuil minimum ?**
R : **NON**. La consultation est manuelle via le filtre « Produits bas stock ». Pas de cron job de detection, pas d alerte UI.

**Q : Comment desactiver un produit (sans le supprimer) ?**
R : Le champ `active` est boolean en base (defaut TRUE), mais l UI **n expose pas** de toggle Active/Inactive dans la modale Modifier. Pour desactiver : modifier directement la base ou ajouter le toggle dans le formulaire (modification de code).

**Q : Le BOM supporte-t-il des composants imbriques (sous-assemblages) ?**
R : **OUI**, indirectement. Un produit enfant peut lui-meme avoir des composants. La verification anti-circular du backend empeche les cycles (A -> B -> A). Pour calculer le BOM eclate, parcourir recursivement (logique a faire cote frontend, pas d endpoint dedie).

**Q : Les mouvements peuvent-ils etre supprimes ou modifies ?**
R : **NON**. Aucun endpoint `DELETE /stock-movements/{id}` ni `PUT`. L historique est immuable (audit). Pour corriger une erreur, creer un mouvement compensatoire (ex. ENTREE pour annuler une SORTIE).

**Q : Comment exporter le catalogue produits en CSV ?**
R : Pas de bouton Exporter dans l UI Magasin. L API `GET /products?per_page=1000` retourne tous les produits — utiliser un client API ou browser devtools pour extraire en CSV.

**Q : Le module gere-t-il les unites de mesure imbriquees (ex. 1 sac = 25 kg) ?**
R : **NON**. Le champ `unite_vente` est texte libre. Pas de table de conversion. Si vous achetez par sac mais sortez par kg, il faut creer 2 produits distincts ou tenir compte manuellement.

**Q : Y a-t-il un suivi des dates de peremption / lots ?**
R : **NON**. Pas de table `lots`, pas de FIFO/LIFO, pas de `date_peremption` sur produits. Pour des produits perissables (resine epoxy, beton frais), utiliser le champ `notes_techniques` pour documenter les precautions.

**Q : Peut-on importer un catalogue depuis un CSV/Excel ?**
R : **NON dans cette version**. Pas de bouton Import. Pour ajouter en masse : utiliser l API POST /products avec un script.

**Q : Le `valeur_inventaire` est-elle mise a jour en temps reel ?**
R : OUI. Calculee a la volee (`SELECT SUM(...)`) a chaque appel `GET /inventory/stats`. Pas de cache.

**Q : Les composants de BOM sont-ils consommes au moment de la facturation du produit assemble ?**
R : **NON**. Voir Question 4 (BOM declaratif). Procedure manuelle via BT pour declencher la consommation.

---

## 6. Recap one-pager

- **3 onglets relevants** dans Magasin : Inventaire, Mouvements, BOM (sous Inventaire).
- **15 champs produit** dont `code_produit` UNIQUE, `categorie` (type), `materiau` (norme), `stock_disponible` non modifiable via PUT.
- **`active`** : boolean unique (TRUE/FALSE), **PAS de statut multi-etat**.
- **13 types produits** (frontend, dropdown texte libre cote backend).
- **8 normes** (frontend, stockees dans champ `materiau`).
- **3 types mouvements** : ENTREE / SORTIE / AJUSTEMENT (validation : SORTIE bloquee si insuffisant via API manuelle).
- **Auto-mouvements** : BT seulement (SORTIE/ENTREE selon delta), **PAS depuis BC**.
- **Verrou pessimiste** (`SELECT FOR UPDATE`) pour la concurrence sur creation mouvement.
- **BOM** : parent-enfant declaratif, anti-self-ref + anti-circular + UNIQUE constraint. Pas d assemblage automatique.
- **Low stock** : `stock_disponible <= stock_minimum AND stock_minimum > 0`.
- **Valeur inventaire** : `SUM(stock_disponible * COALESCE(cout_revient, prix_unitaire, 0))`.
- **PAS de filtres avances** sur Mouvements (seulement pagination).
- **PAS de notifications low stock**, **PAS de code-barres**, **PAS de multi-emplacement**, **PAS d import CSV**, **PAS de suivi lots/peremption**, **PAS de mouvements editables/supprimables**.
- **Hard delete** produit (cascade FK BOM). Mouvements historiques preserves (immutables).

---

**Documentation generee a partir du code** : `inventory.py`, `MagasinPage.tsx` (onglets Inventaire + Mouvements), `inventory.ts`.

**Manuels lies** :
- Module 5 (Bons de Travail — auto SORTIE/ENTREE) — `05-bons-de-travail.md`
- Module 6 (Bons de Commande — pas d auto stock) — `06-bons-de-commande.md`
- Module 7 (Comptabilite — compte 1300 Stocks materiaux) — `07-factures.md`
