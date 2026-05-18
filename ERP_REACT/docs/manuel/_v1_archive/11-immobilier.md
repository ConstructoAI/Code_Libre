# Manuel utilisateur — Module Immobilier (Promotion résidentielle)

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (promoteurs immobiliers, constructeurs résidentiels, gestionnaires)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Terrains, Projets, Unités](#2-interface--terrains-projets-unites)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Champs, types et calculs](#4-reference--champs-types-et-calculs)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Immobilier

Le module **Immobilier** est dédié aux **promoteurs immobiliers** et **constructeurs résidentiels**. Il gère :

- **Terrains** acquis (parcelles, lots à construire)
- **Projets immobiliers** (développements, complexes, condos, jumelés)
- **Unités** à vendre (logements, condos, maisons individuelles)
- **Inspections** (avant/pendant/après construction)
- **Financements bancaires** (prêts construction, hypothèques)
- **Paiements clients** (acomptes, paiements progressifs, finalisation)
- **Déblocages bancaires** (versements de financement par étape)
- **Tableau de bord** consolidé (revenus prévus, marge, état d'avancement)

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **Terrain** | Parcelle de terrain acquise (lot, superficie, prix d'achat) |
| **Projet immobilier** | Développement résidentiel (ex: « Phase 1 - Plateau Nord ») |
| **Unité** | Logement à vendre (condo, maison, jumelé) |
| **Inspection** | Visite technique pour vérification |
| **Financement** | Prêt bancaire pour construction |
| **Paiement** | Versement reçu d'un client |
| **Déblocage** | Versement reçu de la banque (par étape de construction) |

### 1.3 Workflow type

```
Acquisition terrain → Création projet → Définition unités → Construction
       ↓                                         ↓
       Financement bancaire                      Inspections par étape
                                                 ↓
                                                 Déblocages progressifs
                                                 ↓
                                                 Vente unités → Paiements clients
                                                 ↓
                                                 Livraison + Garanties
```

### 1.4 Accès

- **Sidebar** → **Immobilier**
- **URL** : `/immobilier`

### 1.5 Permissions

- **Tous les utilisateurs authentifiés** peuvent CRUD
- Pas de restriction par rôle dans cette version

---

## 2. Interface — Terrains, Projets, Unités

### 2.1 Page Immobilier (`/immobilier`)

Layout en onglets :
```
+----------------------------------------------------------+
| [Tableau de bord] [Terrains] [Projets] [Unités]         |
| [Inspections] [Financements] [Paiements] [Déblocages]   |
+----------------------------------------------------------+
```

### 2.2 Tableau de bord

KPI cards :
- Nombre de terrains
- Nombre de projets actifs
- Unités totales (vendues / disponibles)
- Revenus prévus ($)
- Revenus réalisés ($)
- Marge globale (%)

Graphiques : avancement par projet, ventes par mois, financements en cours.

### 2.3 Onglet Terrains

Liste : Numéro lot, Adresse, Ville, Superficie (pi²), Prix d'achat, Date acquisition, Statut.

Modale Création :
| Champ | Détail |
|---|---|
| Numéro lot | Référence cadastrale |
| Adresse, Ville, Province, Code postal | Localisation |
| Superficie | pi² ou m² |
| Zonage | Résidentiel / Commercial / Mixte |
| Prix d'achat | $ CAD |
| Date d'acquisition | Date |
| Vendeur | Nom |
| Notes | Texte libre |

### 2.4 Onglet Projets immobiliers

Liste : Nom, Terrain associé, Type (Condo / Jumelé / Maison), Nombre d'unités, Date début, Date livraison prévue, Statut.

Modale Création :
| Champ | Détail |
|---|---|
| Nom du projet * | Ex: « Phase 1 - Plateau Nord » |
| Terrain * | Sélection terrain |
| Type | Condo, Jumelé, Maison individuelle, Mixte |
| Nombre d'unités prévues | Entier |
| Date début construction | Date |
| Date livraison prévue | Date |
| Description | Texte libre |
| Architecte, Entrepreneur général | Texte |

### 2.5 Onglet Unités

Liste : Numéro, Projet, Type (1 chambre, 2 chambres, etc.), Superficie, Prix de vente, Statut (Disponible / Réservé / Vendu / Livré).

Modale Création :
| Champ | Détail |
|---|---|
| Numéro unité | Ex: « 101 », « A-3 » |
| Projet * | Sélection |
| Type * | 1 chambre / 2 chambres / 3 chambres / Penthouse / etc. |
| Superficie | pi² |
| Étage | Numéro |
| Prix de vente | $ CAD |
| Statut | Disponible / Réservé / Vendu / Livré |
| Acheteur | Lien client (si Réservé/Vendu) |
| Date réservation, Date vente, Date livraison | Dates |
| Plan | Référence/upload |

### 2.6 Onglet Inspections

Liste chronologique : Date, Type d'inspection, Inspecteur, Projet/Unité, Résultat (Conforme / Non conforme / À refaire).

Types d'inspection :
- Inspection préliminaire (avant achat terrain)
- Inspection construction (par étape : fondations, charpente, toiture, finition)
- Inspection finale (avant livraison)
- Inspection garantie (1 an, 5 ans GMN)

### 2.7 Onglet Financements

Liste des prêts bancaires : Numéro, Banque, Montant approuvé, Taux, Échéance, Solde restant, Statut.

### 2.8 Onglet Paiements

Liste des paiements reçus des clients : Date, Unité, Acheteur, Type (Acompte / Progressif / Final), Montant, Mode.

### 2.9 Onglet Déblocages

Liste des versements de financement bancaire : Date, Étape (Fondation / Charpente / Toiture / Finition), Montant débloqué, Statut.

### 2.10 Vue mobile

Onglets dans menu accordéon, cards empilées pour les listes.

---

## 3. Workflows pas-à-pas

### 3.1 Acquérir un terrain
1. Onglet **Terrains** → bouton **« + Nouveau terrain »**
2. Saisir Numéro lot, Adresse complète
3. Superficie (pi² ou m²), Zonage
4. Prix d'achat, Date d'acquisition
5. Vendeur et Notes
6. Cliquer **« Créer »**

### 3.2 Créer un projet immobilier sur un terrain
1. Onglet **Projets** → **« + Nouveau projet »**
2. Saisir Nom (ex: « Phase 1 - Plateau Nord »)
3. Sélectionner le **Terrain** acquis
4. Type (Condo / Jumelé / Maison)
5. Nombre d'unités prévues
6. Date début construction et Date livraison prévue
7. Architecte, Entrepreneur général
8. Cliquer **« Créer »**

### 3.3 Créer les unités à vendre
1. Onglet **Unités** → **« + Nouvelle unité »**
2. Numéro (101, A-3, etc.)
3. Sélectionner le **Projet**
4. Type (1 chambre, 2 chambres, etc.), Superficie, Étage
5. Prix de vente
6. Statut initial = **Disponible**
7. Cliquer **« Créer »**
8. Répéter pour chaque unité

> **Astuce** : créer toutes les unités dès le départ pour avoir une vue d'ensemble.

### 3.4 Réserver une unité (acheteur potentiel)
1. Sélectionner l'unité → Statut → **Réservé**
2. Saisir Acheteur (Contact CRM)
3. Date de réservation
4. Saisir l'acompte de réservation (souvent 5 % du prix)
5. Sauvegarder

### 3.5 Confirmer la vente d'une unité
1. Statut → **Vendu**
2. Date de vente
3. Compléter les paiements progressifs
4. Préparer le contrat de vente (notarié)

### 3.6 Livrer une unité
1. Effectuer une inspection finale (voir 3.10)
2. Si conforme : Statut → **Livré**
3. Date de livraison
4. Activer la garantie (1 an, 5 ans GMN)

### 3.7 Saisir un financement bancaire
1. Onglet **Financements** → **« + Nouveau financement »**
2. Saisir Banque, Numéro de prêt, Montant approuvé
3. Taux d'intérêt, Échéance
4. Type (Construction / Hypothécaire)
5. Lier au Projet immobilier
6. Cliquer **« Créer »**

### 3.8 Enregistrer un déblocage bancaire
1. Onglet **Déblocages** → **« + Nouveau déblocage »**
2. Sélectionner le **Financement**
3. Étape de construction (Fondation / Charpente / Toiture / Finition)
4. Montant débloqué
5. Date de réception
6. Cliquer **« Enregistrer »**
7. Le solde du financement est mis à jour automatiquement

### 3.9 Enregistrer un paiement client
1. Onglet **Paiements** → **« + Nouveau paiement »**
2. Sélectionner l'**Unité** vendue
3. Type de paiement (Acompte / Progressif / Final / Notarié)
4. Montant et Mode (Chèque / Virement)
5. Date
6. Cliquer **« Enregistrer »**

### 3.10 Planifier et enregistrer une inspection
1. Onglet **Inspections** → **« + Nouvelle inspection »**
2. Type (Préliminaire / Construction / Finale / Garantie)
3. Date, Inspecteur (nom + entreprise)
4. Lier à un Projet ou une Unité
5. Saisir Résultat (Conforme / Non conforme / À refaire)
6. Notes détaillées et Recommandations
7. Photos / Documents joints
8. Cliquer **« Enregistrer »**

### 3.11 Modifier un projet immobilier
Bouton crayon → modifier → Enregistrer.

### 3.12 Annuler une réservation
1. Édition unité → Statut → **Disponible**
2. Notes : « Annulation réservation - raison »
3. Rembourser l'acompte (si applicable) via paiement négatif

### 3.13 Suivre l'avancement d'un projet
1. Onglet **Tableau de bord** → sélectionner le projet
2. Vue avancement : étapes complétées, % de construction, unités vendues
3. Compteur : Unités disponibles vs réservées vs vendues vs livrées

### 3.14 Calculer la marge prévue d'un projet
Le système calcule automatiquement :
- Revenus prévus = Σ prix de vente des unités
- Coûts = prix terrain + coûts construction (estimés ou réels)
- Marge = Revenus − Coûts

### 3.15 Filtrer les unités disponibles
Onglet Unités → filtre Statut = **Disponible** → liste des unités à vendre.

### 3.16 Exporter les données en CSV
Bouton « Exporter » sur chaque onglet (Terrains, Projets, Unités, etc.).

### 3.17 Générer un contrat de réservation
Pas de fonction native dans cette version. Utiliser le module Documents pour archiver le contrat signé.

### 3.18 Activer la garantie GMN (Garantie Maisons Neuves)
1. Unité livrée → onglet Garanties (à venir)
2. Saisir Numéro de couverture, Date d'enregistrement, Échéance 1 an + 5 ans
3. Lier les inspections de garantie

---

## 4. Référence — Champs, types et calculs

### 4.1 Champs Terrain

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Numéro lot | Texte | Oui | Référence cadastrale |
| Adresse, Ville, Province, Code postal | Texte | Oui | Localisation |
| Superficie | Décimal | Oui | pi² ou m² |
| Zonage | Texte | Non | Résidentiel / Commercial / Mixte |
| Prix d'achat | Décimal | Oui | $ CAD |
| Date acquisition | Date | Oui | Date achat |
| Vendeur | Texte | Non | Nom |
| Notes | Texte | Non | Texte libre |

### 4.2 Champs Projet immobilier

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Nom | Texte | Oui | Ex: « Phase 1 - Plateau Nord » |
| Terrain | FK | Oui | Référence terrain.id |
| Type | Énum | Oui | Condo / Jumelé / Maison / Mixte |
| Nombre d'unités prévues | Entier | Non | Estimation |
| Date début | Date | Oui | Début construction |
| Date livraison prévue | Date | Non | Date livraison |
| Description | Texte | Non | Texte libre |
| Architecte | Texte | Non | Nom + entreprise |
| Entrepreneur général | Texte | Non | Nom |
| Statut | Énum | Oui | Planifié / En construction / Livré / Suspendu |

### 4.3 Champs Unité

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Numéro unité | Texte | Oui | Ex: « 101 », « A-3 » |
| Projet | FK | Oui | Référence projet.id |
| Type | Texte | Oui | 1 chambre / 2 chambres / Penthouse / etc. |
| Superficie | Décimal | Non | pi² |
| Étage | Entier | Non | Numéro |
| Prix de vente | Décimal | Oui | $ CAD |
| Statut | Énum (4) | Oui | Disponible / Réservé / Vendu / Livré |
| Acheteur | FK | Non | Référence contact.id |
| Date réservation, vente, livraison | Date | Non | Jalons |
| Plan | URL | Non | Document plan |

### 4.4 Champs Inspection

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Date | Date | Oui | Date inspection |
| Type | Énum | Oui | Préliminaire / Construction / Finale / Garantie |
| Inspecteur | Texte | Non | Nom + entreprise |
| Projet ou Unité | FK | Oui | Lien |
| Résultat | Énum (3) | Oui | Conforme / Non conforme / À refaire |
| Notes | Texte | Non | Détails |
| Recommandations | Texte | Non | Actions à suivre |
| Documents | Liste | Non | Photos, rapports |

### 4.5 Champs Financement

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Banque | Texte | Oui | Nom institution |
| Numéro de prêt | Texte | Oui | Référence bancaire |
| Montant approuvé | Décimal | Oui | $ CAD |
| Taux d'intérêt | Décimal | Non | % |
| Échéance | Date | Non | Date fin prêt |
| Type | Énum | Oui | Construction / Hypothécaire |
| Projet | FK | Oui | Lien |
| Solde restant | Décimal | Auto | Montant − déblocages |

### 4.6 Champs Paiement client

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Unité | FK | Oui | Référence unité.id |
| Type | Énum | Oui | Acompte / Progressif / Final / Notarié |
| Montant | Décimal | Oui | $ CAD |
| Mode | Énum | Oui | Chèque / Virement / Carte / Comptant |
| Date | Date | Oui | Date paiement |
| Notes | Texte | Non | Texte libre |

### 4.7 Champs Déblocage bancaire

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Financement | FK | Oui | Référence financement.id |
| Étape | Énum | Oui | Fondation / Charpente / Toiture / Finition / Final |
| Montant | Décimal | Oui | $ CAD |
| Date | Date | Oui | Date réception |
| Notes | Texte | Non | Texte libre |

### 4.8 Statuts Unité (4)

| Statut | Couleur | Description |
|---|---|---|
| Disponible | Vert | À vendre |
| Réservé | Ambre | Acheteur en attente |
| Vendu | Bleu | Vente confirmée |
| Livré | Vert foncé | Remise des clés effectuée |

### 4.9 Statuts Projet immobilier

| Statut | Description |
|---|---|
| Planifié | En préparation |
| En construction | Travaux en cours |
| Livré | Toutes les unités livrées |
| Suspendu | Pause temporaire |

### 4.10 Calculs

#### Solde financement
```
solde = montant_approuvé - SUM(deblocages.montant)
```

#### Revenus prévus d'un projet
```
revenus_prévus = SUM(unite.prix_vente) WHERE projet_id = ?
```

#### Revenus réalisés
```
revenus_réalisés = SUM(paiements.montant) WHERE unite IN (unités du projet)
```

#### Marge prévue
```
marge_prévue = revenus_prévus - cout_terrain - cout_construction_estimé
```

### 4.11 Limites système

| Élément | Limite |
|---|---|
| Pagination | 20 par défaut, max 100 |
| Unités par projet | Pas de limite |
| Inspections par projet | Pas de limite |
| Documents par unité | Taille max 50 Mo / fichier |

### 4.12 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Numéro lot | Texte | LOT-12345 |
| Numéro unité | Texte | 101, A-3 |
| Devise | $ CAD | 425 000,00 $ |
| Superficie | pi² ou m² | 1 250 pi² |
| Date | AAAA-MM-JJ | 2026-04-25 |

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module | Relation | Manifestation |
|---|---|---|
| **CRM** | Acheteurs unités = Contacts CRM | Sélection à la réservation |
| **Projets** | Projet immobilier ≠ Projet construction | Possibilité de lier un projet construction par unité |
| **Comptabilité** | Paiements clients + déblocages | Sync auto vers grand livre |
| **Documents** | Plans, contrats, garanties | Upload fichiers |
| **Inspections** | Lien aux unités/projets | Historique conformité |

### 5.2 Cas particuliers

- **Terrain sans projet** : possible (acquisition future)
- **Projet sans unités définies** : possible en planification
- **Unité sans prix** : utile en pré-commercialisation (« Sur demande »)
- **Réservation expirée** : statut peut être remis manuellement à Disponible
- **Acheteur multiple** : un seul acheteur par unité dans cette version (couple = saisir un acheteur principal + co-acheteur dans Notes)
- **Modification après livraison** : possible mais à éviter (intégrité des documents notariés)
- **Garanties GMN** : suivi manuel via Inspections de garantie

### 5.3 Astuces

- **Créer toutes les unités dès le début** : facilite la commercialisation et le suivi
- **Numérotation cohérente** : utiliser un format clair (Étage-Numéro = 4-12)
- **Inspections par étape** : planifier dès la création du projet pour ne pas oublier
- **Déblocages bancaires** : enregistrer immédiatement à réception pour suivi de trésorerie
- **Plans uploadés** : permet à l'acheteur de visualiser son unité avant livraison
- **Status Réservé** : utiliser pour les promesses d'achat avant signature notariée
- **Garanties** : enregistrer date d'enregistrement pour rappel échéance 1 an et 5 ans

### 5.4 FAQ

**Q : Quelle différence entre Projet immobilier et Projet construction ?**
R : Projet immobilier = développement avec unités à vendre (promotion). Projet construction = chantier classique avec budget, devis, factures. Un projet immobilier peut être associé à un ou plusieurs projets construction (un par unité ou globalement).

**Q : Comment gérer une promesse d'achat avant la vente notariée ?**
R : Statut Réservé + acompte enregistré. Statut passe à Vendu après acte notarié.

**Q : Le module gère-t-il les acomptes en fiducie (mandataire) ?**
R : Pas de gestion fiduciaire native. Les paiements sont enregistrés. Le suivi en compte fiducie doit être géré séparément (avec votre notaire).

**Q : Comment gérer une vente annulée après notarisation ?**
R : Cas exceptionnel. Modifier statut à Disponible avec note explicative. Création d'une note de crédit côté Comptabilité.

**Q : Puis-je personnaliser une unité (peinture, planchers, etc.) ?**
R : Pas de gestion native des options. Saisir dans Notes ou créer un projet construction associé pour le suivi.

**Q : Comment générer un rapport pour la banque ?**
R : Tableau de bord → Exporter CSV. Compléter manuellement avec photos chantier (Dossier 360).

**Q : Le module supporte-t-il les copropriétés (condos) ?**
R : Oui, type Condo. Les frais de copropriété ne sont pas gérés (utiliser un logiciel spécialisé pour la gestion post-livraison).

**Q : Comment gérer la garantie GMN (Garantie Maisons Neuves) ?**
R : Enregistrer dans Notes pour le moment. Module dédié à venir.

**Q : Plusieurs projets sur un même terrain ?**
R : Possible. Créer plusieurs Projets liés au même Terrain (phases de développement).

**Q : Comment suivre les coûts de construction réels ?**
R : Lier un projet construction (module Projets) à votre projet immobilier. Les coûts (devis, BC, factures, MO) seront agrégés dans Finances projet.

### 5.5 Limites connues

- Pas de gestion native des copropriétés post-livraison
- Pas de gestion fiduciaire des acomptes (à gérer avec notaire)
- Pas de personnalisation d'unité (options peinture, planchers, etc.)
- Pas de gestion garanties GMN automatisée (workaround : Inspections type Garantie)
- Pas de génération automatique de contrats de réservation/vente
- Pas de portail acheteur (vue dédiée pour le client)
- Pas d'intégration MLS / Centris
- Un seul acheteur principal par unité (co-acheteurs en notes)
- Pas de gestion des hypothèques côté acheteur (uniquement financements promoteur)

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Immobilier — v1.0 — 2026-04-25*
