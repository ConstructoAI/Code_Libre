# Manuel utilisateur — Module Bons de Commande / Achats / Fournisseurs

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (acheteurs, magasiniers, gestionnaires, comptabilité)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Magasin et Fournisseurs](#2-interface--magasin-et-fournisseurs)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Champs, statuts, calculs](#4-reference--champs-statuts-calculs)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module

Le module **Bons de Commande / Achats / Fournisseurs** gère l'ensemble du processus d'approvisionnement en construction. Il permet de :

- **Gérer une base de fournisseurs** (nom, contact, certifications, conditions de paiement, évaluation qualité)
- **Créer des bons de commande** numérotés automatiquement (`BC-AAAA-NNNNN`)
- **Ajouter des lignes** d'articles (description, quantité, prix unitaire, montant)
- **Suivre les statuts** : Brouillon → Envoyé → Confirmé → En cours → Reçu → Facturé / Annulé
- **Gérer les réceptions** (mouvement stock ENTRÉE automatique)
- **Générer des documents HTML professionnels** pour impression ou transmission
- **Lier BC aux projets** et aux bons de travail pour traçabilité complète

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **Fournisseur** | Entreprise/personne qui vend matériaux, équipements ou services |
| **Bon de Commande (BC)** | Document numéroté `BC-AAAA-NNNNN` (ex: BC-2026-00007) |
| **Ligne BC** | Description, quantité, unité, prix unitaire, montant |
| **Statut** | 7 valeurs (Brouillon, Envoyé, Confirmé, En cours, Reçu, Facturé, Annulé) |
| **Réception** | Mouvement de stock ENTRÉE déclenché à la réception |
| **Évaluation qualité** | Note 1-5 attribuée au fournisseur |

### 1.3 Workflow

```
Brouillon → Envoyé → Confirmé → En cours → Reçu → Facturé
                                                ↘
                                                  Annulé
```

### 1.4 Accès

- **Sidebar** → **Magasin** (onglet **Bons de commande**)
- **URL** : `/magasin` (sous-onglets : Bons de commande, Mouvements, Inventaire, Fournisseurs)

### 1.5 Permissions

- **Tous les utilisateurs authentifiés** du tenant peuvent CRUD
- **Suppression bloquée** si statut = Reçu ou Facturé (intégrité comptable)

---

## 2. Interface — Magasin et Fournisseurs

### 2.1 Page Magasin (`/magasin`) — 4 onglets

```
+-----------------------------------------------------------------+
| [Bons de commande] [Mouvements] [Inventaire] [Fournisseurs]    |
+-----------------------------------------------------------------+
```

### 2.2 Onglet « Bons de commande »

#### Layout général

```
+-----------------------------------------------------------------+
| [+ Nouveau BC]   [Recherche...]   [Filtre statut v]            |
+-----------------------------+-----------------------------------+
| Numéro     | Fournisseur    | Projet | Montant | Statut |      |
|------------+----------------+--------+---------+--------|      |
| BC-2026-001| Excavation XY  | P-42   | 12 800$ | Envoyé |  -→  |
| BC-2026-002| Béton Lévis    | P-43   | 28 450$ | Reçu   |      |
+-----------------------------+-----------------------------------+
| (Détail BC à droite : entête + sous-totaux + lignes)            |
+-----------------------------------------------------------------+
```

#### Liste des BC

Tableau : Numéro (BC-AAAA-NNNNN), Fournisseur, Projet (si lié), Montant total, Statut (badge coloré).

**Couleurs des statuts** :
- Brouillon : Gris
- Envoyé : Bleu
- Confirmé : Cyan
- En cours : Ambre
- Reçu : Vert
- Facturé : Vert foncé
- Annulé : Rouge

#### Détail BC (panneau latéral)

- **Entête** : Numéro, Fournisseur, Projet, Statut (badge)
- **Sous-totaux** :
  - Sous-total HT
  - TPS (5 %)
  - TVQ (9,975 %)
  - **Total TTC**
- **Boutons** : Générer HTML, Aperçu, Modifier statut, Supprimer
- **Liste des lignes** : Description, Qté × Prix = Montant. Bouton « + Ajouter ligne » + bouton supprimer par ligne.

### 2.3 Onglet « Fournisseurs »

#### Liste

Tableau : Nom, Catégorie produits, Contact principal, Ville, Évaluation (1-5 étoiles), Statut (Actif/Inactif).

Double-clic pour éditer.

#### Modale Nouveau fournisseur

| Champ | Détail |
|---|---|
| Company * | Sélection entreprise du CRM |
| Nom fournisseur | Nom commercial |
| Code fournisseur | Référence interne |
| Catégorie produits | Ex: « Béton et ciment » |
| Contact principal | Personne référente |
| Contact commercial | Autre contact |
| Contact technique | Support technique |
| Email, Téléphone | Coordonnées |
| Adresse, Ville, Province, Code postal | Adresse |
| Conditions paiement | Ex: « 30 jours net », « COD » |
| Délai livraison moyen | En jours (défaut 14) |
| Évaluation qualité | 1-5 (défaut 5) |
| Certifications | Ex: « RBQ, CSA, ISO » |
| Notes, Notes évaluation | Texte libre |
| Est actif | Booléen (défaut true) |

### 2.4 Onglet « Mouvements »

Enregistrement des mouvements de stock liés aux BC (et autres) :
- **Type** : ENTRÉE (réception), SORTIE (chantier), AJUSTEMENT
- **Référence** : Numéro BC ou facture
- **Motif** : Ex: « Réception BC-2026-001 »

### 2.5 Onglet « Inventaire »

Liste des produits avec stock actuel, prix moyen pondéré, catégorie. Voir manuel **Module Inventaire** pour détails.

### 2.6 Modale Création BC

```
+----------------------------------------------------+
|  NOUVEAU BON DE COMMANDE                    [ X ]  |
+----------------------------------------------------+
|  Fournisseur *  [v Sélection]                      |
|  Projet         [v Sélection (optionnel)]          |
|  Date livraison prévue : [📅]                      |
|  Notes : [textarea]                                |
|----------------------------------------------------|
|  LIGNES                                            |
|  +------------------------------------------------+|
|  | Description | Qté | Unité | Prix u. | Montant ||
|  | Sacs ciment | 100 | sacs  | 35,00$  | 3 500$  ||
|  | [+ Ajouter ligne]                              ||
|  +------------------------------------------------+|
|----------------------------------------------------|
|                          [ Annuler ] [ Créer ]    |
+----------------------------------------------------+
```

### 2.7 Vue mobile

Cards empilées avec menu **⋮** pour actions principales.

---

## 3. Workflows pas-à-pas

### 3.1 Créer un fournisseur

1. `/magasin` → onglet **Fournisseurs** → bouton **« + Nouveau fournisseur »**
2. Sélectionner l'**Entreprise** (du CRM)
3. Renseigner Nom, Code, Catégorie produits
4. Saisir contacts (principal, commercial, technique), Email, Téléphone
5. Adresse complète
6. Conditions de paiement (Net 30 par défaut), Délai livraison moyen
7. Évaluation qualité (1-5)
8. Certifications, Notes
9. Cliquer **« Créer »**

### 3.2 Modifier un fournisseur

Double-clic sur la ligne dans le tableau → formulaire inline → modifier → sauvegarde directe.

### 3.3 Désactiver un fournisseur (soft-delete)

Édition → décocher **« Est actif »** → Enregistrer. Le fournisseur n'apparaîtra plus dans les sélecteurs mais reste en base pour traçabilité.

### 3.4 Créer un bon de commande

1. Onglet **Bons de commande** → bouton **« + Nouveau BC »**
2. Sélectionner le **Fournisseur** (obligatoire)
3. Sélectionner le **Projet** (optionnel)
4. Renseigner la **Date de livraison prévue**
5. Ajouter des **Notes**
6. **Ajouter les lignes** :
   - Sélectionner un produit inventaire (auto-remplit description, unité, prix) OU saisir librement
   - Quantité, Prix unitaire
   - Le Montant est calculé (qté × prix)
7. Cliquer **« Créer »**

> **À savoir** : numéro `BC-AAAA-NNNNN` généré automatiquement.

### 3.5 Ajouter une ligne à un BC existant

1. Sélectionner le BC
2. Section Lignes → bouton **« + Ajouter ligne »**
3. Sélection produit ou saisie libre
4. Quantité, Prix
5. Cliquer Ajouter
6. Le **montant total du BC** est recalculé automatiquement

### 3.6 Supprimer une ligne

1. Icône poubelle à côté de la ligne
2. Confirmer
3. Le montant total du BC est recalculé

### 3.7 Changer le statut d'un BC

1. Sélectionner le BC → panneau détail
2. Dropdown statut → choisir nouveau statut
3. Sauvegarde immédiate

> **À savoir** : la transition Brouillon → Envoyé doit être faite après envoi effectif au fournisseur (par email ou impression).

### 3.8 Marquer comme « Reçu »

1. À la livraison, changer statut → **« Reçu »**
2. Optionnel : enregistrer un mouvement stock ENTRÉE pour chaque produit reçu (onglet Mouvements)
3. Le stock du produit est augmenté automatiquement

### 3.9 Marquer comme « Facturé »

1. À la réception de la facture du fournisseur, changer statut → **« Facturé »**
2. Le BC devient **non supprimable** (intégrité comptable)
3. Le BC peut alors être lié à une facture fournisseur dans le module Comptabilité

### 3.10 Annuler un BC

1. Statut → **« Annulé »**
2. Possible uniquement si statut ≠ Reçu et ≠ Facturé

### 3.11 Supprimer un BC

1. Bouton poubelle → confirmer
2. Possible uniquement si statut = Brouillon, Envoyé, Confirmé, En cours ou Annulé
3. **Impossible** si statut = Reçu ou Facturé
4. Suppression en cascade : lignes BC, dossier_achats, achat_assignations, dépenses

### 3.12 Générer un document HTML imprimable

1. Sélectionner le BC → bouton **« Générer HTML »**
2. Document professionnel avec :
   - En-tête entreprise (logo, RBQ, NEQ, TPS, TVQ)
   - Infos commande (Numéro, Date, Date livraison)
   - Infos fournisseur (Nom, Adresse, Contact)
   - Tableau lignes (Description, Qté, Unité, Prix, Montant)
   - Sous-totaux + Taxes (TPS 5 % + TVQ 9,975 %) + Total TTC
   - Notes (si présentes)
   - **Conditions d'achat standard** (6 clauses)
   - Zones signatures (Acheteur + Fournisseur)
3. **Aperçu** dans modal iframe ou nouvelle fenêtre
4. Imprimer ou enregistrer en PDF (Ctrl+P)

### 3.13 Lier un BC à un projet

À la création, sélectionner le projet dans le dropdown. Si le projet a un dossier 360, une entrée est créée dans `dossier_achats` automatiquement (lien documentaire).

### 3.14 Filtrer la liste des BC

- Recherche libre (numéro, fournisseur)
- Filtre statut (multi-sélection)
- Filtre fournisseur

### 3.15 Enregistrer une réception partielle

1. À la livraison partielle, garder le statut **« En cours »** (réception incomplète)
2. Quand la totalité est reçue, passer à **« Reçu »**

> **Note** : le suivi de réception partielle ligne par ligne (qty_recue) est une fonctionnalité prévue pour version future.

### 3.16 Suivre les BC d'un fournisseur

1. Onglet Fournisseurs → cliquer sur le nom
2. Détail fournisseur → section **« BC récents »**
3. Liste paginée des BC du fournisseur

### 3.17 Évaluer la qualité d'un fournisseur

1. Édition du fournisseur
2. Mettre à jour **Évaluation qualité** (1-5)
3. Saisir des **Notes d'évaluation**
4. Enregistrer

### 3.18 Enregistrer un mouvement de stock manuel

1. Onglet **Mouvements** → bouton **« + Nouveau mouvement »**
2. Choisir Type (ENTRÉE / SORTIE / AJUSTEMENT)
3. Sélectionner Produit
4. Quantité
5. Référence (ex: BC-2026-001) et Motif
6. Enregistrer

### 3.19 Imprimer plusieurs BC en lot

Pas de fonction native. Workaround : ouvrir chaque BC, générer HTML, imprimer.

### 3.20 Exporter la liste des BC en CSV

Pas de fonction native dans cette version. Demander à l'administrateur ou utiliser une vue Comptabilité pour les rapports.

---

## 4. Référence — Champs, statuts, calculs

### 4.1 Champs Bon de Commande (BC)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Numéro | Auto | Oui | Format BC-AAAA-NNNNN, unique |
| Fournisseur (fournisseur_id) | FK | Oui | Référence fournisseurs.id |
| Fournisseur nom | Texte | Auto | Cache pour performance |
| Projet (project_id) | FK | Non | Référence projects.id |
| Date commande | Date | Auto | CURRENT_DATE |
| Date livraison prévue | Date | Non | Date attendue |
| Statut | Énum (7) | Oui | Voir 4.3 |
| Montant total | Décimal | Auto | Σ montants des lignes |
| Notes | Texte | Non | Remarques libres |
| Created_at | Timestamp | Auto | Horodatage |

### 4.2 Champs Ligne BC

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Bon_commande_id | FK | Oui | Référence BC |
| Produit (produit_id) | FK | Non | Lien inventaire |
| Description | Texte | Oui | Désignation article |
| Quantité | Décimal | Oui | Ex: 100,50 sacs |
| Unité | Texte | Non | sacs, m³, ml, etc. |
| Prix unitaire | Décimal | Oui | Montant HT |
| Montant | Décimal | Auto | quantité × prix |

### 4.3 Statuts BC (7)

| Statut | Couleur | Description | Transitions |
|---|---|---|---|
| Brouillon | Gris | État initial | → Envoyé, Annulé |
| Envoyé | Bleu | Transmis au fournisseur | → Confirmé, Annulé |
| Confirmé | Cyan | Fournisseur accepte | → En cours, Annulé |
| En cours | Ambre | En préparation/fabrication | → Reçu, Annulé |
| Reçu | Vert | Livré | → Facturé (non supprimable) |
| Facturé | Vert foncé | Facture reçue | (terminal, non supprimable) |
| Annulé | Rouge | Commande annulée | (terminal) |

### 4.4 Champs Fournisseur

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Company_id | FK | Oui | Référence companies.id |
| Nom fournisseur | Texte | Non | Nom commercial |
| Code fournisseur | Texte | Non | Référence interne |
| Contact principal/commercial/technique | Texte | Non | Personnes contacts |
| Email, Téléphone | Texte | Non | Coordonnées |
| Adresse, Ville, Province, Code postal | Texte | Non | Adresse |
| Catégorie produits | Texte | Non | Ex: « Béton et ciment » |
| Conditions paiement | Texte | Non | Ex: « 30 jours net », « COD » |
| Délai livraison moyen | Entier | Non | Jours (défaut 14) |
| Évaluation qualité | Entier | Non | 1-5 (défaut 5) |
| Certifications | Texte | Non | Ex: « RBQ, CSA, ISO » |
| Notes, Notes évaluation | Texte | Non | Texte libre |
| Est actif | Booléen | Non | Défaut true |
| Created_at | Timestamp | Auto | Horodatage |

### 4.5 Calculs

#### Montant ligne
```
montant = quantité × prix_unitaire
```
Arrondi à 2 décimales.

#### Montant total BC
```
montant_total = SUM(bon_commande_lignes.montant)
              FROM bon_commande_lignes
              WHERE bon_commande_id = bc_id
```
Recalculé à chaque ajout/modification de ligne.

#### Taxes (document HTML)
```
sous_total_HT = montant_total
TPS           = sous_total_HT × 5 %
TVQ           = sous_total_HT × 9,975 %
TOTAL_TTC     = sous_total_HT + TPS + TVQ
```

**Exemple** :
```
3 × 100 sacs ciment @ 35 $/sac = 10 500 $
TPS (5 %)    =   525,00 $
TVQ (9,975 %) = 1 047,38 $
TOTAL_TTC    = 12 072,38 $
```

### 4.6 Génération du numéro

Format Python : `f"BC-{annee}-{seq:05d}"` (ex: BC-2026-00007). Séquence `MAX(id) + 1` au moment de l'INSERT.

### 4.7 Limites système

| Élément | Limite |
|---|---|
| Pagination | 20 par défaut, max 100 |
| Lignes par BC | Pas de limite stricte |
| Suppression BC | Bloquée si Reçu ou Facturé |
| Stock négatif | Permis (backorder) |

### 4.8 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Numéro BC | BC-AAAA-NNNNN | BC-2026-00007 |
| Devise | $ CAD | 12 800,50 $ |
| Date | AAAA-MM-JJ | 2026-04-25 |
| Pourcentage | XX,XXX % | 9,975 % |
| Évaluation | X/5 | 4/5 |

### 4.9 Conditions d'achat standard (HTML généré)

Le document HTML inclut automatiquement 6 clauses :
1. Les prix sont en dollars canadiens (CAD) et ne comprennent pas les taxes
2. Les matériaux doivent être conformes aux spécifications et normes
3. Avis de retard de livraison au plus tôt possible
4. Matériaux endommagés retournés aux frais du fournisseur
5. Facture doit inclure le numéro BC comme référence
6. Conditions de paiement selon termes convenus

### 4.10 Catégories de produits typiques (fournisseurs)

Béton et ciment, Bois et charpente, Acier et métal, Quincaillerie, Outillage, Plomberie, Électricité, Isolation, Toiture, Revêtements, Finition intérieure, Aménagement paysager, Équipement lourd, Sous-traitance.

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module | Relation | Manifestation |
|---|---|---|
| **CRM (Companies)** | Fournisseur lié à une Company | Sélection company à la création |
| **Projets** | BC.project_id → projects.id | Sélection projet, liaison documentaire dans dossier_achats |
| **Bons de Travail** | Lignes BT peuvent générer BC | Workflow manuel (copie des matériaux) |
| **Inventaire (Produits)** | Lignes BC liées à produits | Mouvement stock ENTRÉE à la réception |
| **Mouvements de stock** | Réception BC → mouvement ENTRÉE | Référence BC sur le mouvement |
| **Factures fournisseurs** | BC → Facture | Lien comptable, BC verrouillé après facturation |
| **Comptabilité** | BC Reçu/Facturé → écriture comptable | Génération auto entrée/passif fournisseur |
| **Dossiers 360** | Auto-lien si projet → opportunité → dossier | dossier_achats créé automatiquement |
| **Suivi (Gantt)** | Source « Bons de Commande » | Visualisation chronologique |

### 5.2 Cas particuliers

- **BC sans projet** : possible (project_id = NULL) — utile pour stock général
- **Fournisseur inactif** : n'apparaît plus dans les sélecteurs mais les BC existants restent visibles
- **Prix différent à la réception** : ajuster manuellement la ligne avant marquage Reçu
- **Réception partielle** : garder le statut « En cours » jusqu'à réception complète. Suivi ligne par ligne pas encore implémenté
- **BC en double** : pas de détection automatique. Vérifier visuellement avant validation
- **Suppression BC Reçu/Facturé** : impossible. Annuler la facture liée d'abord (Comptabilité)
- **Modification après envoi au fournisseur** : techniquement possible mais à éviter (le fournisseur a une version différente)
- **Changement de fournisseur sur un BC** : pas supporté. Créer un nouveau BC et annuler l'ancien

### 5.3 Astuces

- **Évaluation qualité** : mettre à jour après chaque livraison pour suivre la performance des fournisseurs
- **Catégories produits** : standardiser les catégories pour faciliter la recherche
- **Conditions de paiement** : utiliser un format uniforme (ex: « Net 30 », « Net 60 », « COD », « 2/10 Net 30 »)
- **Génération HTML** : une copie PDF du BC envoyé au fournisseur sert de preuve documentaire
- **Mouvement stock à la réception** : enregistrer immédiatement pour maintenir un inventaire à jour
- **Lier au projet** : pour le suivi budgétaire automatique du projet (les BC alimentent les dépenses matériaux)
- **Filtrage par statut** : filtrer sur « En cours » pour voir les commandes attendues
- **Top fournisseurs** : trier par évaluation pour favoriser les meilleurs partenaires

### 5.4 FAQ

**Q : Comment éviter de commander en double ?**
R : Pas de détection automatique. Vérifier visuellement la liste des BC en cours pour le même fournisseur/projet avant de créer un nouveau BC.

**Q : Le fournisseur n'a pas reçu mon BC, que faire ?**
R : Vérifier que le statut est bien « Envoyé ». Régénérer le HTML et le renvoyer manuellement par email.

**Q : Comment gérer une livraison partielle ?**
R : Garder le statut « En cours » jusqu'à réception complète. Pour le suivi détaillé ligne par ligne, utiliser les Mouvements de stock pour enregistrer les quantités reçues progressivement.

**Q : Puis-je modifier le prix d'une ligne après l'envoi ?**
R : Techniquement oui, mais le fournisseur a une version différente. Préférer dupliquer le BC et annuler l'ancien.

**Q : Comment lier une facture fournisseur à un BC ?**
R : Dans le module Comptabilité (à venir) : lien `bon_commande_id` sur la facture. Le statut du BC passe automatiquement à « Facturé ».

**Q : Le mouvement de stock est-il automatique à la réception ?**
R : Oui pour les lignes liées à un produit inventaire. Pour les lignes saisies en libre, enregistrer manuellement le mouvement si nécessaire.

**Q : Comment gérer les retours fournisseur ?**
R : Pas de fonction native. Créer un mouvement SORTIE manuel avec motif « Retour fournisseur » et créer une note de crédit du côté Comptabilité.

**Q : Le numéro BC est-il unique par fournisseur ou globalement ?**
R : Globalement (au niveau du tenant). Format `BC-AAAA-NNNNN` séquentiel.

**Q : Puis-je consulter l'historique des prix d'un produit auprès d'un fournisseur ?**
R : Pas de fonction dédiée. Filtrer les BC du fournisseur et examiner manuellement les lignes.

**Q : Comment évaluer la performance d'un fournisseur ?**
R : Champ Évaluation (1-5) sur la fiche fournisseur, à mettre à jour après chaque livraison. Utiliser les Notes d'évaluation pour détailler.

### 5.5 Limites connues

- Pas de réception partielle ligne par ligne (en cours pour version future)
- Pas de gestion des retours fournisseur (workaround : mouvement SORTIE manuel)
- Pas de contrôle qualité formel à la réception
- Taxes figées (TPS 5 % / TVQ 9,975 %) — pas paramétrables par BC
- Pas de versioning BC (modifications non tracées)
- Pas d'envoi automatique par email au fournisseur
- Pas d'import/export en lot (CSV/Excel)
- Pas de fonction « Dupliquer BC »
- Pas de comparaison de prix entre fournisseurs pour un même produit

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Bons de Commande / Achats / Fournisseurs — v1.0 — 2026-04-25*
