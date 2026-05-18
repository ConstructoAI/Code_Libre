# Manuel utilisateur — Module Inventaire / Produits / Magasin

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (magasiniers, acheteurs, gestionnaires)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Produits et Mouvements](#2-interface--produits-et-mouvements)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Champs, types et calculs](#4-reference--champs-types-et-calculs)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Inventaire

Le module **Inventaire** gère les produits stockés en magasin et les mouvements de stock :

- **Catalogue produits** (matériaux, équipements, consommables)
- **Suivi du stock disponible** en temps réel
- **Mouvements de stock** : ENTRÉE, SORTIE, AJUSTEMENT
- **Composants/nomenclature** (BOM) : assemblage de produits composites
- **Catégories** pour organiser le catalogue
- **Prix moyen pondéré** (PMP) calculé automatiquement
- **Alertes stock minimum** (à venir)

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **Produit** | Article au catalogue (matériau, équipement, consommable) |
| **Code produit** | Référence interne unique |
| **Stock disponible** | Quantité actuelle en magasin |
| **Mouvement de stock** | ENTRÉE (réception), SORTIE (chantier), AJUSTEMENT (correction) |
| **Prix moyen pondéré (PMP)** | Coût moyen calculé sur les entrées |
| **Catégorie** | Classement (Béton, Bois, Quincaillerie, etc.) |
| **Composant** | Sous-produit d'un produit composite (BOM) |
| **Stock minimum** | Seuil d'alerte pour réapprovisionnement |

### 1.3 Accès

- **Sidebar** → **Magasin** → onglets **Inventaire** + **Mouvements**
- **URL** : `/magasin`

### 1.4 Permissions

- Tous les utilisateurs authentifiés peuvent CRUD
- Modification du stock se fait via mouvements (pas modification directe)

---

## 2. Interface — Produits et Mouvements

### 2.1 Onglet Produits (Inventaire)

Layout :
```
+--------------------------------------------------------------+
| [+ Nouveau produit]  [Recherche...]  [Catégorie v]          |
+--------------------------------------------------------------+
| Code  | Description    | Catégorie | Unité | Stock | PMP    |
|-------|----------------|-----------|-------|-------|--------|
| MAT01 | Sacs ciment 30k| Ciment    | sac   | 120   | 8,50$  |
| MAT02 | Plaque OSB 5/8 | Bois      | un    | 24    | 32,50$ |
| EQP01 | Bétonnière 9pi | Équipement| un    | 2     | 850,00$|
+--------------------------------------------------------------+
```

Colonnes : Code, Description, Catégorie, Unité, Stock disponible, Prix moyen pondéré.

### 2.2 Modale Création produit

| Champ | Détail |
|---|---|
| Code produit * | Référence unique (ex: MAT-001) |
| Description * | Nom du produit |
| Catégorie | Sélection (Béton, Bois, etc.) |
| Unité * | sac, un, m, m², m³, kg, L, etc. |
| Prix d'achat unitaire | $ CAD HT |
| Prix de vente unitaire | $ CAD HT (si revente) |
| Stock initial | Quantité de départ |
| Stock minimum | Seuil d'alerte |
| Fournisseur principal | Dropdown |
| Notes | Texte libre |
| Actif | Booléen (défaut true) |

### 2.3 Détail Produit (panneau)

- Infos (code, description, catégorie, unité)
- Stock actuel + Stock minimum
- PMP + dernière entrée
- **Composants** (si produit composite)
- **Historique des mouvements** (chronologique)

### 2.4 Onglet Mouvements

Layout :
```
+--------------------------------------------------------------+
| [+ Nouveau mouvement]  [Recherche...]  [Type v] [Date v]    |
+--------------------------------------------------------------+
| Date       | Type      | Produit       | Qté  | Référence |  |
|------------|-----------|---------------|------|-----------|  |
| 2026-04-25 | ENTRÉE    | Sacs ciment   | +50  | BC-2026-1 |  |
| 2026-04-24 | SORTIE    | Plaque OSB    | -10  | BT-00123  |  |
| 2026-04-23 | AJUSTEMENT| Bétonnière 9pi| -1   | Inventaire|  |
+--------------------------------------------------------------+
```

### 2.5 Modale Nouveau mouvement

| Champ | Détail |
|---|---|
| Type * | ENTRÉE / SORTIE / AJUSTEMENT |
| Produit * | Sélection catalogue |
| Quantité * | Décimale (positive ou négative selon type) |
| Date | Défaut aujourd'hui |
| Référence | Numéro BC, BT, ou texte libre |
| Motif | Description (« Réception fournisseur », « Inventaire physique », etc.) |
| Prix unitaire | $ CAD (pour les ENTRÉES → mise à jour PMP) |
| Notes | Texte libre |

### 2.6 Composants (BOM) — Produit composite

Pour un produit assemblé (ex: Kit cuisine), liste des composants :
- Produit composant (FK)
- Quantité requise
- Unité

Bouton **« + Ajouter composant »**.

### 2.7 KPI Inventaire (en haut de page)

| Carte | Description |
|---|---|
| Produits actifs | Nombre total |
| Valeur stock | Σ (stock × PMP) |
| Stock bas (à commander) | Produits avec stock < seuil minimum |
| Mouvements ce mois | Nombre de mouvements récents |

### 2.8 Vue mobile

Cards empilées avec actions : Voir, Mouvement Entrée/Sortie rapide.

---

## 3. Workflows pas-à-pas

### 3.1 Créer un produit
1. `/magasin` → onglet Inventaire → bouton **« + Nouveau produit »**
2. Saisir Code* (ex: MAT-001)
3. Description*, Catégorie, Unité*
4. Saisir Prix d'achat unitaire et Prix de vente (si applicable)
5. Stock initial et Stock minimum (seuil d'alerte)
6. Fournisseur principal (optionnel)
7. Cliquer **« Créer »**

### 3.2 Modifier un produit
1. Cliquer sur la ligne → panneau détail
2. Bouton crayon → modifier
3. Cliquer **« Enregistrer »**

> **Important** : la modification du **Stock disponible** se fait via mouvements, pas directement.

### 3.3 Désactiver un produit
1. Édition → décocher **« Actif »**
2. Le produit n'apparaîtra plus dans les sélecteurs (BC, BT, lignes devis)

### 3.4 Enregistrer une ENTRÉE de stock (réception)
1. Onglet Mouvements → **« + Nouveau mouvement »**
2. Type : **ENTRÉE**
3. Produit, Quantité (positive)
4. Référence : numéro BC (ex: BC-2026-001)
5. Prix unitaire d'achat (recalcule le PMP)
6. Motif : « Réception BC-2026-001 »
7. Cliquer **« Enregistrer »**
8. Le stock disponible augmente

### 3.5 Enregistrer une SORTIE de stock (chantier)
1. Type : **SORTIE**
2. Produit, Quantité
3. Référence : numéro BT (ex: BT-00123) ou projet
4. Motif : « Sortie chantier »
5. Cliquer **« Enregistrer »**
6. Le stock diminue

> **À savoir** : la sortie peut être automatique si une ligne BT/BC fait référence au produit.

### 3.6 Enregistrer un AJUSTEMENT (correction)
1. Type : **AJUSTEMENT**
2. Produit, Quantité (positive ou négative selon différence)
3. Motif : « Inventaire physique du JJ-MM-AAAA »
4. Notes détaillées
5. Cliquer **« Enregistrer »**

### 3.7 Voir l'historique des mouvements d'un produit
1. Cliquer sur le produit → panneau détail
2. Section **Historique** : liste chronologique inverse
3. Filtre par type (ENTRÉE / SORTIE / AJUSTEMENT)

### 3.8 Effectuer un inventaire physique
1. Imprimer la liste des produits (Export CSV)
2. Compter physiquement
3. Pour chaque écart : créer un mouvement AJUSTEMENT
4. Référence : « Inventaire physique JJ-MM-AAAA »

### 3.9 Configurer un produit composite (BOM)
1. Détail produit → section **Composants** → **« + Ajouter composant »**
2. Sélectionner le produit composant
3. Quantité requise
4. Cliquer Ajouter
5. Répéter pour tous les composants

> **Exemple** : Kit cuisine = 1× Plaque OSB + 4× Plinthes + 12× Vis 3"

### 3.10 Modifier ou supprimer un composant
- Édition inline pour la quantité
- Icône poubelle pour supprimer

### 3.11 Catégoriser les produits
1. Onglet **Catégories** (sous-section)
2. Bouton **« + Nouvelle catégorie »**
3. Saisir nom et description
4. Assigner produits à la catégorie

### 3.12 Filtrer le catalogue
- Recherche libre (code, description)
- Filtre Catégorie
- Filtre Stock bas (uniquement produits avec stock < minimum)

### 3.13 Exporter le catalogue en CSV
Bouton **« Exporter CSV »** dans la liste des produits. Téléchargement.

### 3.14 Voir la valeur du stock total
Carte KPI en haut : **Valeur stock = Σ (quantité × PMP)** pour tous les produits actifs.

### 3.15 Identifier les produits à commander
Carte KPI **Stock bas** → cliquer pour filtrer la liste sur les produits avec stock < seuil minimum.

### 3.16 Lier un produit à un fournisseur
1. Édition produit → champ **Fournisseur principal**
2. Sélectionner dans la liste des fournisseurs actifs
3. Sauvegarder

### 3.17 Suivi des mouvements automatiques (depuis BC/BT)
- Réception BC marquée « Reçu » → ENTRÉE auto si lignes liées à des produits
- Ajout ligne BT → SORTIE auto si ligne liée à un produit
- Vérifier les mouvements dans l'historique du produit

### 3.18 Annuler un mouvement
**Important** : pas de fonction « Annuler ». Créer un mouvement inverse :
- ENTRÉE accidentelle → créer une SORTIE de même quantité avec motif « Annulation »
- SORTIE accidentelle → créer une ENTRÉE équivalente

---

## 4. Référence — Champs, types et calculs

### 4.1 Champs Produit

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Code produit | Texte | Oui | Référence interne unique |
| Description | Texte | Oui | Nom du produit |
| Catégorie | FK | Non | Référence categories.id |
| Unité | Texte | Oui | sac, un, m, m², m³, kg, L, etc. |
| Prix achat | Décimal | Non | $ CAD HT |
| Prix vente | Décimal | Non | $ CAD HT (si revente) |
| Stock disponible | Décimal | Auto | Calculé par mouvements |
| Stock minimum | Décimal | Non | Seuil d'alerte |
| Prix moyen pondéré (PMP) | Décimal | Auto | Recalculé à chaque ENTRÉE |
| Fournisseur principal | FK | Non | Référence fournisseurs.id |
| Notes | Texte | Non | Texte libre |
| Actif | Booléen | Oui | Défaut true |
| Created_at, updated_at | Timestamp | Auto | Horodatage |

### 4.2 Champs Mouvement de stock

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Type | Énum (3) | Oui | ENTRÉE / SORTIE / AJUSTEMENT |
| Produit | FK | Oui | Référence produits.id |
| Quantité | Décimal | Oui | Positive (peut être négative pour AJUSTEMENT) |
| Date | Date | Oui | Date du mouvement |
| Référence | Texte | Non | Numéro BC, BT, ou texte |
| Motif | Texte | Non | Description |
| Prix unitaire | Décimal | Non | $ CAD (pour ENTRÉE) |
| Notes | Texte | Non | Texte libre |
| Auteur | Texte | Auto | Utilisateur connecté |

### 4.3 Champs Composant (BOM)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Produit parent | FK | Oui | Produit composite |
| Produit composant | FK | Oui | Sous-produit |
| Quantité requise | Décimal | Oui | Quantité par unité parent |

### 4.4 Types de mouvement (3)

| Type | Description | Effet sur stock |
|---|---|---|
| ENTRÉE | Réception fournisseur | + quantité, recalcul PMP |
| SORTIE | Sortie chantier / vente | − quantité |
| AJUSTEMENT | Correction (inventaire physique) | ± quantité (selon écart) |

### 4.5 Catégories typiques

Béton et ciment, Bois, Acier et métal, Quincaillerie, Outillage, Plomberie, Électricité, Isolation, Toiture, Revêtements, Finition, Aménagement, Équipement lourd, Consommables, Sécurité (EPI).

### 4.6 Calculs

#### Stock disponible
```
stock = stock_initial + Σ (ENTRÉES) − Σ (SORTIES) + Σ (AJUSTEMENTS)
```

#### Prix moyen pondéré (PMP)
```
PMP = (PMP_avant × stock_avant + prix_entree × qty_entree)
      / (stock_avant + qty_entree)
```
Recalculé à chaque ENTRÉE. Les SORTIES ne modifient pas le PMP.

#### Valeur du stock
```
valeur_stock = Σ (stock_disponible × PMP) pour tous produits actifs
```

#### Stock bas (alerte)
```
alerte = stock_disponible < stock_minimum
```

### 4.7 Limites système

| Élément | Limite |
|---|---|
| Pagination | 20 par défaut, max 100 |
| Stock négatif | Permis (backorder) |
| Lignes mouvement | Pas de limite |
| Composants par produit | Pas de limite |
| Catégories | Pas de limite |

### 4.8 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Code produit | Texte libre | MAT-001 |
| Devise | $ CAD | 8,50 $ |
| Quantité | Décimal | 120,5 |
| Date | AAAA-MM-JJ | 2026-04-25 |

### 4.9 Unités courantes

sac, un, m, mm, cm, km, m², pi², m³, pi³, kg, tonne, L, mL, h, jour, lot, voyage, livraison, paquet, boîte, rouleau, palette.

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module | Relation | Manifestation |
|---|---|---|
| **Bons de Commande** | Réception → ENTRÉE auto | Lignes BC liées à des produits |
| **Bons de Travail** | Ligne BT → SORTIE auto | Lignes BT liées à des produits |
| **Devis** | Ligne devis → produit (référence) | Pas d'effet sur stock (devis = prévisionnel) |
| **Factures** | Lignes facture → produits (optionnel) | Référence pour reporting |
| **Fournisseurs** | Produit lié à fournisseur principal | Suggestion pour BC |
| **Comptabilité** | Valeur stock → bilan | Sync valeur stock |

### 5.2 Cas particuliers

- **Stock négatif** : permis (backorder). Le système n'empêche pas la SORTIE même si stock insuffisant
- **PMP à la baisse** : si entrée à prix inférieur, le PMP baisse (méthode coût moyen)
- **Produit composite** : la SORTIE d'un kit ne décrémente pas automatiquement les composants (à venir)
- **Modification après mouvement** : possible, mais ne recalcule pas l'historique
- **Suppression de mouvement** : pas de fonction native — créer un mouvement inverse
- **Produit jamais sorti** : reste à PMP = prix d'entrée initial
- **Plusieurs fournisseurs pour un produit** : un seul fournisseur principal, les autres peuvent être notés

### 5.3 Astuces

- **Code produit standardisé** : utiliser un préfixe par catégorie (MAT-, EQP-, CSM-) pour faciliter la recherche
- **Stock minimum** : configurer pour les produits critiques pour recevoir l'alerte
- **Inventaire physique mensuel** : effectuer régulièrement et créer les AJUSTEMENTS pour maintenir la précision
- **PMP** : indicateur fiable pour valoriser le stock dans les rapports comptables
- **Référence sur mouvements** : toujours indiquer le BC/BT pour la traçabilité
- **Catégories** : structurer dès le début pour éviter de re-catégoriser plus tard
- **Composants (BOM)** : utile pour les kits prêts à monter ou les produits composites

### 5.4 FAQ

**Q : Pourquoi le stock peut-il devenir négatif ?**
R : Pour ne pas bloquer les chantiers. Le backorder est permis, à régulariser dès réception du matériau.

**Q : Comment calculer la valeur de mon stock pour le bilan ?**
R : Carte KPI **Valeur stock** = Σ (quantité × PMP). Méthode coût moyen pondéré.

**Q : Le PMP correspond-il au coût comptable ?**
R : Oui, c'est la méthode du coût moyen pondéré (Weighted Average Cost), conforme aux normes comptables canadiennes (ASPE et IFRS).

**Q : Comment gérer les retours fournisseurs ?**
R : Créer un mouvement SORTIE avec motif « Retour fournisseur » et référence (ex: BC original). Du côté Comptabilité, créer une note de crédit.

**Q : Puis-je avoir le même code produit dans deux catégories ?**
R : Non, le code est unique au niveau du tenant.

**Q : Comment importer un catalogue depuis Excel ?**
R : Pas d'import natif dans cette version. Demander à l'administrateur ou utiliser l'API.

**Q : Les sorties automatiques depuis BT sont-elles fiables ?**
R : Oui, à condition que la ligne BT soit bien liée à un produit du catalogue (champ produit_id).

**Q : Puis-je faire un transfert entre deux entrepôts ?**
R : Pas de gestion multi-entrepôts dans cette version. Workaround : SORTIE entrepôt A + ENTRÉE entrepôt B avec catégories distinctes.

**Q : Les alertes de stock bas envoient-elles un email ?**
R : Pas dans cette version. Affichage visuel uniquement (carte KPI rouge).

**Q : Puis-je voir les produits les plus utilisés ?**
R : Trier les mouvements SORTIE par quantité totale ou nombre. Pas de rapport dédié dans cette version.

**Q : Comment gérer les produits périssables ou avec date d'expiration ?**
R : Pas de gestion native des dates d'expiration. Saisir dans Notes pour info.

**Q : Le module supporte-t-il les codes-barres ?**
R : Pas dans cette version (stockage du code, mais pas de scan).

### 5.5 Limites connues

- Pas de gestion multi-entrepôts (un seul stock global)
- Pas de codes-barres / QR codes
- Pas de gestion FIFO/LIFO (uniquement PMP)
- Pas de dates d'expiration / lots
- Pas de prévisions de besoin (forecast)
- Pas d'alertes email pour stock bas (affichage UI seulement)
- Pas d'import en lot natif (CSV/Excel)
- Décrémentation auto des composants BOM lors de la SORTIE du parent : à venir
- Pas de gestion des emplacements précis (allée, rangée, niveau)
- Pas de réservation de stock (futur)

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Inventaire / Produits / Magasin — v1.0 — 2026-04-25*
