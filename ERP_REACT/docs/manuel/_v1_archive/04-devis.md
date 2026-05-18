# Manuel utilisateur — Module Devis (Soumissions)

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (estimateurs, chargés de projet, administrateurs)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Liste et constructeur](#2-interface--liste-et-constructeur)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Champs, statuts, calculs](#4-reference--champs-statuts-calculs)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Devis

Le module **Devis (Soumissions)** est l'outil central de Constructo ERP pour la gestion complète de vos soumissions clients, de la première estimation jusqu'à la conversion en projet actif.

Concrètement, ce module vous permet de :

- **Créer des estimations professionnelles** structurées avec lignes détaillées (description, quantité, prix unitaire).
- **Calculer automatiquement** les marges (administration, contingences, profit) et les taxes québécoises (TPS/TVQ).
- **Envoyer la soumission au client** via un lien partageable sécurisé, sans qu'il ait besoin de créer un compte.
- **Recueillir une signature électronique** directement dans son navigateur, validée et archivée comme preuve d'acceptation.
- **Convertir automatiquement** le devis accepté en projet, sans re-saisie manuelle.

Le module s'adresse aux estimateurs, chargés de projets et administrateurs qui supervisent la rentabilité globale.

### 1.2 Concepts-clés

- **Devis (Soumission)** : document principal identifié par un numéro `DEV-AAAA-NNN` (ex: `DEV-2026-001`).
- **Lignes (Items)** : composantes détaillées (description, quantité, unité, prix unitaire, montant calculé automatiquement).
- **Marges** : pourcentages appliqués sur le sous-total des lignes :
  - **Administration** : 3 % (par défaut)
  - **Contingences** : 12 %
  - **Profit** : 15 %
- **Taxes québécoises** : TPS (5 %) + TVQ (9,975 %) sur le sous-total après marges.
- **Token public** : clé unique du lien partageable (validité 90 jours par défaut).
- **Signature électronique** : tracée dans un canvas HTML5, convertie en PNG, stockée en base64.

### 1.3 Workflow

**Brouillon** → **Validé** → **Envoyé au client** → **Accepté / Refusé / En attente** → **Converti en Projet** → **Terminé**

### 1.4 Les 9 statuts

1. **Brouillon** : devis en cours de rédaction
2. **Validé** : devis vérifié, prêt à envoyer
3. **Envoyé** : transmis au client via lien partageable
4. **En attente** : le client a consulté sans encore décider
5. **Accepté** : signé et accepté par le client
6. **Refusé** : refusé par le client
7. **Terminé** : converti en projet et clôturé
8. **Annulé** : annulé par l'entreprise
9. **Expiré** : période de validité du token dépassée

### 1.5 Accès au module

- **Sidebar** : cliquez sur **Devis / Soumissions**
- **URL directe** : `/devis`
- **Page publique (côté client)** : `/devis/public/{token}` (sans authentification)

### 1.6 Permissions

| Rôle | Permissions |
|---|---|
| Tous les utilisateurs authentifiés | Créer, modifier, envoyer des devis |
| Administrateur uniquement | Modifier conditions/exclusions par défaut, supprimer un devis |
| Page publique (client) | Accès en lecture/signature via token uniquement |

---

## 2. Interface — Liste et constructeur

### 2.1 Page Devis (`/devis`) — Liste

#### Layout général

```
+---------------------------------------------------------------+
|  +-----------+  +-----------+  +-----------+  +-----------+   |
|  | TOTAL     |  | BROUILLONS|  | ENVOYÉS   |  | TAUX ACC. |   |
|  |   148     |  |    23     |  |    87     |  |   62 %    |   |
|  +-----------+  +-----------+  +-----------+  +-----------+   |
|---------------------------------------------------------------|
|  [Recherche...]  [Statut v]  [Type v]  [Date v]   [+ Nouveau] |
|---------------------------------------------------------------|
|  N°       | Projet    | Client  | Prix    | Statut | ...| [>] |
|  DEV-...  | Maison... | ABC inc | 45 250$ | Envoyé |    |     |
|  DEV-...  | Garage... | XYZ ltée| 12 800$ | Brouil.|    |     |
|---------------------------------------------------------------|
|  [< 1 2 3 4 >]                       Affichage : [10|25|50]   |
+---------------------------------------------------------------+
```

#### Cartes KPI (entête)

1. **Total devis**
2. **Brouillons**
3. **Envoyés**
4. **Taux d'acceptation %**

Les cartes sont cliquables pour filtrer la liste.

#### Tableau paginé (colonnes redimensionnables)

| Colonne | Format | Description |
|---|---|---|
| Numéro | DEV-AAAA-NNN | Identifiant unique |
| Nom projet | Texte | Désignation du projet |
| Client | Texte | Entreprise ou contact |
| Prix estimé | Devise CAD | Montant total TTC |
| Statut | Badge couleur | 9 statuts |
| Type soumission | Pastille | Détaillée ou Budgétaire |
| Dates | AAAA-MM-JJ | Soumis, début, fin, créé |

#### Actions par ligne (icône ⋮)

- **Voir** — panneau détail (lecture seule)
- **Éditer** — constructeur (voir 2.3)
- **Dupliquer** — copie avec nouveau numéro
- **Convertir en projet** — devis accepté → projet actif
- **Supprimer** — confirmation requise

#### Filtres et recherche

- Recherche libre (numéro, projet, client)
- Filtre statut (multi-sélection)
- Filtre type (Détaillée / Budgétaire)
- Filtre date

Pagination : 10 / 25 / 50 par page.

### 2.2 Modale Création

Grille 2 colonnes :
- **Gauche** : Nom projet*, PO client, Client (Entreprise), Client (Personne), Saisie manuelle, Statut, Priorité
- **Droite** : Tâche, Date soumission, Date début, Date fin, Prix estimé
- **Pleine largeur** : Description (textarea)

### 2.3 Constructeur de devis (édition)

#### Section Client & Dates
- Client (Entreprise dropdown)
- Client (Contact dropdown filtré par entreprise)
- Saisie directe (fallback)
- Dates : soumission, début, fin
- PO client, Priorité, Tâche

#### Section Lignes (tableau éditable)

```
+---+-------------+-----+--------+----------+----------+----------+-------+----+
| # | Description | Qté | Unité  | Prix U.  | Montant  | Cat.     | MO/MAT|[O]|
+---+-------------+-----+--------+----------+----------+----------+-------+----+
| 1 | Peinture... | 120 | m²     |   8,50 $ | 1 020 $  | Mat.     | 70/30 | O |
| 2 | Pose...     |   8 | heure  |  85,00 $ |   680 $  | MO       | 100/0 | O |
+---+-------------+-----+--------+----------+----------+----------+-------+----+
                                                       [+ Ajouter ligne]
                                                       [+ Ajouter en lot]
```

Colonnes : Description, Quantité, Unité (18 options), Prix unitaire, Montant (auto), Catégorie (Matériaux/MO/Sous-traitance/Équipement), MO/MAT %, Visibility (icône œil).

#### Auto-détection MO/MAT
Si MO/MAT vides, détection par mots-clés métier (peinture 70/30, électricité 55/45, etc.). Modifiable manuellement.

#### Section Calculs

```
+----------------------------------------+
|  Sous-total travaux           1 700 $  |
|  + Administration (3 %)          51 $  |
|  + Contingences (12 %)          204 $  |
|  + Profit (15 %)                255 $  |
|  ----------------------------------    |
|  Sous-total avant taxes      2 210 $   |
|  + TPS (5 %)                  110,50 $ |
|  + TVQ (9,975 %)              220,45 $ |
|  ====================================  |
|  TOTAL TTC                  2 540,95 $ |
+----------------------------------------+
```

Les pourcentages sont **paramétrables** par devis. Labels personnalisables. Toggle visibility par ligne.

#### Section Conditions & Exclusions
2 textareas (max 10 000 caractères, max 200 lignes). Défauts entreprise OU personnalisés. Bouton « Réinitialiser ». Toggle « Afficher dans PDF ».

#### Section Notes clients
Textarea libre (max 10 000 caractères). **NE s'affiche PAS dans le HTML public** (notes internes).

### 2.4 Toggles d'affichage des colonnes

Boutons pour montrer/cacher dans le HTML :
- Unité, Quantité, Prix unitaire, Montant ligne, MO/MAT breakdown

### 2.5 Page publique (lecture client)

URL `/devis/public/{token}` :
- HTML professionnel imprimable
- Infos client + lignes (selon toggles)
- Sous-totaux, marges, taxes, **TOTAL TTC**
- Conditions & Exclusions (si activées)

#### Formulaire d'acceptation

```
+--------------------------------------------+
|  ACCEPTER LE DEVIS                         |
|  Nom du signataire : [________________]    |
|  Signature :                               |
|  +--------------------------------------+  |
|  |        (zone canvas - dessin)        |  |
|  +--------------------------------------+  |
|                       [ Effacer ] [ Accepter ]
+--------------------------------------------+
```

- Nom du signataire (2-200 caractères)
- Signature canvas (PNG)
- Bouton **Accepter** → verrouille le devis

#### Formulaire de refus
Bouton **Refuser** → champ raison optionnel (max 2000 caractères).

---

## 3. Workflows pas-à-pas

> **À savoir** : sauf mention contraire, toutes les modifications sont sauvegardées automatiquement.

### 3.1 Créer un devis manuellement

1. `/devis` → bouton **« + Nouveau devis »**
2. Saisir le **Nom du projet** (obligatoire)
3. Choisir le **Client** (Entreprise dropdown ou Saisie directe)
4. Sélectionner le **Contact** (filtré par entreprise)
5. Renseigner **Dates** (soumission, début, fin) et **PO client**
6. Choisir le **Type de soumission** (Détaillée ou Budgétaire)
7. Vérifier le **Statut initial** (Brouillon)
8. Cliquer **« Créer »**

> **À savoir** : un numéro `DEV-AAAA-NNN` est généré automatiquement.

### 3.2 Ajouter des lignes au devis

1. Section **Lignes** → **« + Ajouter ligne »**
2. Saisir Description, Quantité, Unité (18 options)
3. Saisir Prix unitaire
4. Catégorie (optionnel)
5. Le Montant est calculé automatiquement
6. Sauvegarde inline

### 3.3 Réordonner les lignes (drag & drop)

1. Repérer la **poignée de glissement** à gauche
2. Cliquer-maintenir et glisser
3. Relâcher : nouvel ordre sauvegardé

### 3.4 Masquer/Afficher une ligne dans le PDF

1. Cliquer sur l'**icône œil**
2. **Œil ouvert** = visible dans le HTML public
3. **Œil barré** = ligne interne (cachée du client)

### 3.5 Configurer MO/MAT par ligne

1. Saisir MO % et MAT % (somme = 100)
2. Si vides : auto-détection par mots-clés métier
3. Affecte les sous-totaux MO/MAT

### 3.6 Modifier les marges

1. Panneau **Marges**
2. Modifier les % (3% / 12% / 15% par défaut)
3. Personnaliser les libellés
4. Toggle visibilité

### 3.7 Personnaliser Conditions & Exclusions

1. Panneau Conditions / Exclusions
2. Modifier les textes
3. Toggle « Afficher dans PDF »
4. Bouton « Réinitialiser » revient aux défauts entreprise

### 3.8 Générer la prévisualisation HTML

1. Bouton **« Prévisualiser HTML »**
2. Nouvelle fenêtre avec rendu professionnel
3. Vérifier calculs et mise en page **avant envoi**

### 3.9 Envoyer le devis au client par email

1. Bouton **« Envoyer »**
2. Saisir l'**adresse email** destinataire
3. Choisir un modèle de message (optionnel)
4. Personnaliser le message
5. Cliquer **« Envoyer »**

Le système :
- Envoie le mail avec lien `/devis/public/{token}`
- Génère le token (validité 90 jours)
- Change le statut en **Envoyé**
- Enregistre date et adresse d'envoi

### 3.10 Le client visualise et accepte

1. Le client clique sur le lien reçu
2. Page publique s'ouvre **sans compte requis**
3. Il saisit Nom signataire (obligatoire)
4. Trace sa Signature avec souris/doigt
5. Clique **« Accepter »**
6. Statut → **Accepté**, date enregistrée
7. Création automatique du Projet

### 3.11 Le client refuse

1. Bouton **« Refuser »**
2. Raison optionnelle (max 2000 caractères)
3. Statut → **Refusé**

### 3.12 Convertir un devis accepté en projet

1. Devis en statut Accepté ou Terminé
2. Bouton **« Convertir en projet »**
3. Le système :
   - Crée un Projet avec budget = TTC
   - Copie client/dates/numéro
   - Lie devis ↔ projet (bidirectionnel)
   - Met à jour l'Opportunité (statut GAGNÉ)
   - Copie les pièces jointes

> **À savoir** : opération **idempotente** — si déjà converti, retourne l'ID existant sans rien créer.

### 3.13 Dupliquer un devis

1. Icône **« Dupliquer »** sur la ligne
2. Nouveau devis avec :
   - Statut Brouillon
   - Numéro neuf
   - Préfixe « Copie de »
   - Lignes, marges, conditions copiées

### 3.14 Exporter en Excel (XLSX)

1. Bouton **« Exporter XLSX »**
2. Téléchargement automatique
3. Inclut : entête, lignes, sous-totaux, taxes, TTC

### 3.15 Analyser un document avec l'IA

1. Bouton **« IA — Analyser document »**
2. Uploader PDF ou image
3. L'IA (Claude) extrait les lignes
4. Réviser les propositions
5. Ajouter au devis

> **Important** : toujours valider les extractions IA avant intégration.

### 3.16 Générer un devis complet par IA

1. Bouton **« IA — Générer soumission »**
2. Saisir type de projet, superficie, contraintes
3. L'IA génère une soumission complète
4. Réviser et ajuster

### 3.17 Chat IA dans le contexte d'un devis

1. Panneau **« Assistant IA »**
2. Choisir profil expert (estimateur, charpentier, électricien, etc.)
3. Poser des questions sur le devis, prix marché, normes
4. L'IA répond en tenant compte du contexte et des documents joints

### 3.18 Calculer la cotisation CCQ

1. Outil **« Calculer CCQ »**
2. Saisir nombre d'heures et taux par métier
3. Calcul automatique de la cotisation

### 3.19 Calculer la cotisation CNESST

1. Outil **« Calculer CNESST »**
2. Saisir masse salariale et secteur d'activité
3. Calcul de la cotisation annuelle

### 3.20 Modifier les conditions/exclusions par défaut

> **Important** : réservé aux administrateurs.

1. Paramètres → Devis → Conditions par défaut
2. Modifier les textes
3. Cliquer **« Enregistrer »**
4. Tous les nouveaux devis utiliseront ces valeurs

### 3.21 Mise à jour en masse

1. Sélectionner plusieurs devis (cases à cocher)
2. Bouton **« Mettre à jour en masse »**
3. Choisir nouveau statut
4. Confirmer

### 3.22 Supprimer un devis

> **Important** : réservé aux administrateurs et **irréversible**.

1. Icône poubelle
2. Confirmer
3. Suppression en cascade des lignes

---

## 4. Référence — Champs, statuts, calculs

### 4.1 Champs Devis (entête)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| numero | Texte (auto) | Oui | Format DEV-AAAA-NNN |
| nom_projet | Texte (255) | **Oui** | Nom du projet |
| description | Texte long | Non | Description détaillée |
| client_entreprise_id | FK | Conditionnel | Lien vers entreprise CRM |
| client_contact_id | FK | Conditionnel | Lien vers contact CRM |
| client_nom_saisie | Texte | Conditionnel | Saisie libre |
| po_client | Texte | Non | Bon de commande client |
| statut | Énum (9) | Oui | Voir 4.3 |
| type_soumission | Énum | Oui | Détaillée / Budgétaire |
| date_soumission, date_debut_prevu, date_fin, date_decision, signature_date | Date | Variable | Jalons |
| priorite | Énum | Non | HAUTE / NORMALE / BASSE |
| tache | Texte | Non | Tâche associée |
| prix_estime, total_travaux, administration, contingences, profit, total_avant_taxes, tps, tvq, investissement_total | Décimal | Auto | Montants calculés |
| administration_pct (3%), contingences_pct (12%), profit_pct (15%) | Décimal | Non | Pourcentages paramétrables |
| show_administration, show_contingences, show_profit | Booléen | Non | Affichage marges |
| show_unite, show_quantite, show_prix_unitaire, show_montant_ligne, show_mo_mat | Booléen | Non | Colonnes visibles |
| show_conditions, show_exclusions | Booléen | Non | Sections affichées |
| administration_label, contingences_label, profit_label | Texte | Non | Libellés personnalisés |
| conditions_text, exclusions_text | Texte (10000) | Non | Textes |
| notes | Texte long | Non | Notes internes |
| validation_token | Texte (6-120) | Auto | Token public |
| project_id, opportunity_id | FK | Non | Liens modules connexes |
| created_at, updated_at | Timestamp | Auto | Horodatage |

### 4.2 Champs Ligne de devis

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| description | Texte (5000) | **Oui** | Description de l'item |
| quantite | Décimal | **Oui** | Quantité |
| unite | Énum (18) | **Oui** | Voir 4.4 |
| prix_unitaire | Décimal | **Oui** | $ CAD |
| montant | Décimal | Auto | quantité × prix unitaire |
| categorie | Énum (4) | Non | Voir 4.5 |
| notes_ligne | Texte (5000) | Non | Notes additionnelles |
| code_article | Texte | Non | Code interne |
| visible | Booléen | Non | Inclusion HTML public (défaut true) |
| mo_pct, mat_pct | Décimal | Auto | % détecté |
| sequence | Entier | Auto | Ordre d'affichage |

### 4.3 Statuts (9)

| Statut | Couleur | Description | Transition |
|---|---|---|---|
| Brouillon | Gris | En cours de rédaction | → Validé / Envoyé |
| Validé | Bleu | Prêt à envoyer | → Envoyé |
| Envoyé | Bleu | Transmis au client | → Accepté / Refusé / En attente |
| En attente | Cyan | Réponse client en attente | → Accepté / Refusé |
| Accepté | Vert | Approuvé client | → Terminé |
| Refusé | Rouge | Décliné client | (terminal) |
| Terminé | Vert | Projet réalisé | (terminal) |
| Annulé | Noir | Annulé volontairement | (terminal) |
| Expiré | Rouge | Validité dépassée | (terminal, manuel) |

### 4.4 Unités disponibles (18)

| Catégorie | Unités |
|---|---|
| Longueur | m, mm, cm, km, pi (pied) |
| Surface | m², pi² |
| Volume | m³, pi³ |
| Temps | heure, jour, semaine, mois |
| Masse | kg, tonne |
| Logistique | lot, voyage, livraison |

### 4.5 Catégories de ligne (4)

| Catégorie | Code | Usage |
|---|---|---|
| Matériaux | MAT | Fournitures, produits |
| Main-d'œuvre | MO | Heures travaillées |
| Sous-traitance | ST | Travaux confiés à un tiers |
| Équipement | EQ | Location ou amortissement |

### 4.6 Détection automatique MO/MAT par métier

| Mot-clé | MO % | MAT % |
|---|---|---|
| Peinture | 70 | 30 |
| Électricité | 55 | 45 |
| Plomberie | 50 | 50 |
| Charpenterie | 45 | 55 |
| Démolition | 80 | 20 |
| Excavation | 40 | 60 |

> Détection insensible à la casse et aux accents. Modifiable manuellement.

### 4.7 Calculs financiers (cascade)

| # | Étape | Formule |
|---|---|---|
| 1 | Sous-total travaux | Σ (Quantité × Prix unitaire) lignes visibles |
| 2 | Administration | Sous-total × 3 % (défaut) |
| 3 | Contingences | Sous-total × 12 % |
| 4 | Profit | Sous-total × 15 % |
| 5 | Sous-total avant taxes | Travaux + Admin + Contingences + Profit |
| 6 | TPS | Sous-total avant taxes × 5 % |
| 7 | TVQ | Sous-total avant taxes × 9,975 % |
| 8 | **TOTAL TTC** | Sous-total + TPS + TVQ |

> Toutes les valeurs arrondies à 2 décimales.

### 4.8 Conversion devis → projet (calcul du budget)

| Priorité | Champ source |
|---|---|
| 1 | investissement_total (si > 0) |
| 2 | total_avant_taxes + (TPS + TVQ estimées) |
| 3 | prix_estime |
| 4 | total_travaux (fallback) |

### 4.9 Token public et lien partageable

| Caractéristique | Valeur |
|---|---|
| Format | 6-120 caractères alphanumériques + `-` et `_` |
| Génération | À partir du nom_projet (slugifié) |
| Validité par défaut | **90 jours** |
| Acceptance | Race-safe (UPDATE WHERE statut IN Envoyé/En attente) |

### 4.10 Limites système

| Élément | Limite |
|---|---|
| Pagination | 10 / 25 / 50 par page |
| Lignes par devis | < 500 recommandé |
| Conditions/Exclusions | max 10 000 caractères, max 200 lignes |
| Signature électronique (PNG base64) | max 500 KB |
| Token public | 6-120 caractères |
| Validité token | 90 jours par défaut |
| Batch ajout lignes | max 2000 simultanées |
| Description ligne | max 5000 caractères |
| Notes ligne | max 5000 caractères |

### 4.11 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Numéro devis | DEV-AAAA-NNN | DEV-2026-001 |
| Token public | Slugifié | renovation-cuisine-abc-2026 |
| Devise | $ CAD | 15 000,50 $ |
| Date | AAAA-MM-JJ | 2026-04-25 |
| Pourcentage | XX,XX % | 9,975 % |

### 4.12 Taxes québécoises (fixes)

| Taxe | Taux | Niveau |
|---|---|---|
| TPS | 5,000 % | Fédéral |
| TVQ | 9,975 % | Provincial Québec |
| **Combiné** | **14,975 %** | Sur sous-total avant taxes |

### 4.13 Marges par défaut (paramétrables par devis)

| Marge | Taux par défaut | Base |
|---|---|---|
| Administration | 3 % | Sous-total travaux |
| Contingences | 12 % | Sous-total travaux |
| Profit | 15 % | Sous-total travaux |
| **Total marges** | **~30 %** | Du sous-total brut |

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module | Relation | Manifestation |
|---|---|---|
| **CRM (Companies/Contacts)** | Sélection client à la création | Dropdowns, cache nom client, fallback saisie directe |
| **CRM (Opportunités)** | Devis lié à une opportunité | Statut opp passe à GAGNÉ après acceptation |
| **Projets** | Conversion auto après acceptation | Lien bidirectionnel devis ↔ projet, budget = TTC |
| **Bons de Commande** | Génération auto depuis lignes (futur) | Pas encore implémenté |
| **Factures** | Pré-remplissage depuis lignes (futur) | Pas encore implémenté |
| **IA (Claude)** | Analyse documents, génération auto, chat | Profil expert, contexte devis |
| **Email (SMTP)** | Envoi du devis au client | Lien public, tracking date d'envoi |
| **Pièces jointes** | Upload documents au devis | Copiés vers projet lors conversion |
| **CCQ / CNESST** | Calculateurs intégrés | Cotisations construction Québec |

### 5.2 Cas particuliers

- **Client absent du CRM** : utiliser « Saisie directe »
- **Devis sans client** : possible en Brouillon, mais l'envoi requiert un email
- **Devis déjà converti** : le bouton « Convertir » devient « Voir le projet »
- **Page publique expirée** : si token > 90 jours, accès refusé. Réenvoyer pour nouveau token
- **Acceptation simultanée** : protection race-safe — seul le premier clic réussit
- **Modification après envoi** : possible mais non recommandée. Préférer dupliquer
- **Lignes masquées** : présentes dans le devis mais invisibles dans le HTML public
- **Marges à 0 %** : possible (sous-traitance pure ou prix net négocié)
- **Devis multi-devises** : non supporté, uniquement CAD
- **Type Budgétaire** : devis simplifié sans détail des lignes

### 5.3 Astuces

- **Démarrer avec un modèle** : dupliquer un ancien devis similaire
- **Auto-détection MO/MAT** : laisser les champs vides et utiliser des mots-clés métier dans la description
- **IA pour lignes longues** : utiliser l'extraction de document
- **Toggles colonnes** : pour un contrat à forfait, masquer Quantité et Prix unitaire
- **Conditions standardisées** : configurer une fois pour toutes au niveau entreprise
- **Lien public** : bouton « Copier le lien » pour partage par n'importe quel canal
- **Signature à distance** : envoyer le lien par SMS si l'email n'est pas accessible
- **Tracking** : date d'envoi et adresse destinataire enregistrées

### 5.4 FAQ

**Q : Le client doit-il avoir un compte Constructo pour signer le devis ?**
R : Non. La page publique fonctionne avec un token unique, sans authentification.

**Q : Que se passe-t-il si je modifie un devis après l'avoir envoyé ?**
R : Le client verra la version modifiée. Pour préserver l'historique, dupliquer le devis et envoyer la nouvelle version.

**Q : Puis-je avoir plusieurs devis pour la même opportunité (versions A/B) ?**
R : Oui. Chaque devis est indépendant. Lier l'opportunité au devis principal ; les autres restent en référence.

**Q : Comment annuler une acceptation client ?**
R : Modifier manuellement le statut (Admin) ou supprimer le projet créé. La signature reste enregistrée pour l'audit.

**Q : Mes calculs de TPS/TVQ sont-ils certifiés Revenu Québec ?**
R : Le calcul est mathématiquement correct (5 % + 9,975 %). Pour la facturation conforme, utiliser le module Factures qui inclut les numéros TPS/TVQ de votre entreprise.

**Q : Puis-je personnaliser le HTML envoyé au client ?**
R : Pas le template global, mais conditions, exclusions, marges et toggles colonnes permettent une grande personnalisation.

**Q : Comment réutiliser un devis comme modèle ?**
R : Dupliquer le devis. Le nouveau hérite de toutes les lignes et paramètres.

**Q : L'IA peut-elle créer un devis complet à partir de plans uniquement ?**
R : L'IA aide à extraire et générer des estimations préliminaires. L'expertise humaine reste indispensable pour valider quantités et prix.

**Q : Comment envoyer le devis par WhatsApp ou SMS ?**
R : Copier le lien public et le coller dans n'importe quel canal.

**Q : Que se passe-t-il après 90 jours sans réponse client ?**
R : Le token expire. Réenvoyer le devis pour générer un nouveau lien.

**Q : Puis-je voir qui a consulté la page publique du devis ?**
R : Pas de tracking détaillé visible côté UI dans cette version. La date d'envoi reste enregistrée.

**Q : Le module supporte-t-il les devis en plusieurs langues ?**
R : Le HTML public est en français. Les contenus saisis peuvent être dans n'importe quelle langue.

### 5.5 Limites connues

- Pas de versions historisées d'un même devis (workaround : dupliquer)
- Pas de signature multi-parties (un seul signataire)
- Pas de templates de devis pré-remplis par type de chantier
- Pas d'envoi groupé (un devis à la fois)
- Pas de tracking d'ouverture du lien public (anonyme)
- Pas de devis multi-devises (CAD uniquement)
- Pas de TVA européenne (uniquement TPS/TVQ Québec)
- Pas de génération PDF native (HTML généré, impression navigateur ou XLSX)

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Devis — v1.0 — 2026-04-25*
