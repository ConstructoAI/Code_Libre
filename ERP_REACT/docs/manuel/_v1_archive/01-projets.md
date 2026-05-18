# Manuel utilisateur — Module Projets

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (chefs de projet, gestionnaires, administrateurs)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface et écrans](#2-interface-et-ecrans)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence des champs, statuts et formats](#4-reference-des-champs-statuts-et-formats)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Projets

Le module **Projets** est le cœur opérationnel de Constructo. Il vous permet de planifier, suivre et clôturer l'ensemble de vos chantiers, de la prise de contrat jusqu'à la facturation finale. Que vous gériez une rénovation résidentielle, une construction commerciale ou un projet d'infrastructure, vous y centralisez toute l'information pertinente : équipe affectée, échéancier, notes de chantier, documents, suivi financier et liens avec vos clients.

En regroupant ces données au même endroit, le module élimine les silos d'information typiques d'une entreprise de construction. Vous obtenez en tout temps une vue claire de l'avancement, des coûts réels par rapport au budget, et des tâches à venir. Combiné aux outils d'intelligence artificielle de Constructo, il vous aide aussi à classer automatiquement vos notes de chantier et à prendre de meilleures décisions, plus rapidement.

### 1.2 Concepts-clés

- **Projet** : entité principale représentant un chantier ou un mandat. Chaque projet possède un numéro unique généré automatiquement au format PROJ-AAAA-NNNNN (par exemple, PROJ-2026-00042), un statut (En attente, En cours, Terminé, Annulé, Suspendu) et un niveau de priorité (Basse, Moyenne, Haute, Urgente).
- **Phase** : étape majeure d'un projet (ex. : excavation, fondation, structure, finition). Les phases vous aident à découper le travail et à mesurer l'avancement.
- **Assignation** : lien entre un projet et un employé ou sous-traitant responsable d'une tâche, d'une phase ou d'un livrable.
- **Note** : observation de chantier, compte rendu ou commentaire ajouté au projet. Les notes peuvent être catégorisées automatiquement par l'IA de Constructo selon dix catégories propres au domaine de la construction (sécurité, qualité, retard, etc.).
- **Financials** : tableau de bord financier consolidé du projet. Il agrège les devis acceptés, les factures émises, les bons de commande et les heures pointées par les employés afin de comparer rapidement le réel au prévu.
- **Dossier lié** : ensemble des documents et entités rattachés au projet (devis source, contrats, plans, photos, bons de commande, factures).

### 1.3 Place du module dans le flux ERP

Le module Projets se situe au centre du processus de gestion d'un mandat. Voici le flux typique :

```
Client  -->  Devis  -->  PROJET  -->  Bons de commande  -->  Pointages
                            |                                     |
                            +------------>  Factures  <-----------+
```

Concrètement :

- Un **devis** accepté peut être converti en **projet** ; le lien est conservé pour assurer la traçabilité financière.
- Une fois le projet ouvert, vous y rattachez les **bons de commande** envoyés à vos fournisseurs et sous-traitants.
- Les **pointages** des employés sur le terrain alimentent le coût réel du projet.
- Les **factures** émises au client se rattachent au projet pour suivre la facturation par rapport au montant contractuel.

### 1.4 Accès au module

Pour ouvrir le module Projets, deux options :

- **Par la barre latérale** : cliquez sur l'icône en forme de mallette (Briefcase) intitulée **Projets** dans la barre de navigation gauche.
- **Par l'URL directe** : saisissez /projets à la suite de l'adresse de votre instance Constructo dans le navigateur.

L'écran principal affiche la liste de tous les projets de votre entreprise, avec filtres par statut, priorité et responsable.

### 1.5 Permissions et accès

- Tout utilisateur **authentifié** dans votre entreprise (tenant) peut **consulter, créer, modifier et supprimer** des projets. Les données sont strictement isolées : un utilisateur d'une autre entreprise n'a jamais accès à vos projets.
- Les **fonctions d'intelligence artificielle** (catégorisation automatique des notes, suggestions, résumés) sont soumises à deux conditions :
  - votre compte doit avoir le **module IA activé** par votre administrateur ;
  - votre entreprise doit disposer d'un **solde de crédits IA suffisant**.

Si l'une de ces conditions n'est pas remplie, l'application affichera un message vous invitant à activer le module ou à renouveler vos crédits. Les fonctions standard du module Projets restent accessibles en tout temps, sans dépendance à l'IA.

---

## 2. Interface et écrans

Cette section décrit l'ensemble des écrans, panneaux, boutons et zones interactives du module **Projets**.

### 2.1 Page Liste des projets

La page principale du module est organisée en quatre grandes zones : la barre de KPI (haut), la barre d'actions, la zone d'affichage centrale (avec sélecteur de vue) et le panneau de détail à droite.

#### Layout général (vue bureau)

```
+---------------------------------------------------------------------------+
|  [KPI] Total: 42  |  En cours: 18  |  Terminés: 21  |  Budget: 2,4 M$    |
+---------------------------------------------------------------------------+
|  [+ Nouveau projet] [Export CSV]   [Recherche...] [Statut: Tous v]   [L|T|C] |
+----------------------------------------------+----------------------------+
|                                              |                            |
|   ZONE D'AFFICHAGE (Liste / Tableau / Cartes)|   PANNEAU DE DÉTAIL        |
|                                              |   (projet sélectionné)     |
|   [ ] Numéro      Nom       Client   Budget  |                            |
|   [x] PROJ-2026-1 Maison X  ABC inc. 250000$ |   [Entête + actions]       |
|   [ ] PROJ-2026-2 Rénov Y   Mme D.   80000$  |   [Infos / Phases]         |
|                                              |   [Soumission / Finances]  |
|                                              |   [Notes / Dossier 360]    |
+----------------------------------------------+----------------------------+
|                  << < Page 1 sur 4 > >>     20 par page                   |
+---------------------------------------------------------------------------+
```

#### Barre de KPI (haut de page)

Quatre tuiles synthétisent l'état du portefeuille de projets :
- **Total** : nombre total de projets, tous statuts confondus.
- **En cours** : projets actifs.
- **Terminés** : projets clôturés.
- **Budget global** : somme des budgets de tous les projets affichés.

#### Barre d'actions (CommandBar)

- **Nouveau projet** : ouvre la modale de création.
- **Export CSV** : exporte la liste filtrée en fichier .csv.
- **Recherche** : champ texte avec icône de loupe.
- **Filtre statut** : menu déroulant.
- **Sélecteur de vue** (à droite) : trois icônes pour basculer entre **Liste**, **Tableau** et **Cartes**.

#### Vue Liste

Affichage tabulaire détaillé. Colonnes par défaut :
- **Numéro** (PROJ-AAAA-NNNNN)
- **Nom du projet**
- **Client**
- **Budget**
- **Statut** (badge coloré)
- **Priorité** (badge coloré)
- **Début prévu**
- **Date Fin**
- **Actions** (icônes : voir, modifier, supprimer)

Fonctionnalités du tableau :
- **Tri** : un clic sur l'entête trie en ordre croissant, un second clic en ordre décroissant.
- **Redimensionnement** : glissez le séparateur entre deux entêtes pour ajuster la largeur. Un **double-clic** ajuste automatiquement la colonne au contenu (auto-fit).
- **Sélection** : la case à cocher en début de ligne sélectionne un projet. La case dans l'entête sélectionne tous les projets de la page.

#### Vue Tableau

Identique à la vue Liste, avec des colonnes supplémentaires pour un aperçu plus dense :
- **ID** du projet
- **Type de projet** (Résidentiel, Commercial, Industriel, etc.)
- **Ville chantier**

#### Vue Cartes

Affichage en grille adaptative : 3 colonnes sur écran large, 2 sur écran moyen, 1 sur étroit ou mobile. Chaque carte présente : nom, client, budget, dates, badges de statut et priorité. Un clic ouvre le panneau de détail.

#### Vue mobile

Sur téléphone, l'affichage bascule automatiquement en cartes empilées sur une seule colonne. Le panneau de détail s'ouvre alors en plein écran.

#### Pagination

En bas de page : navigation **<<**, **<**, numéro de page courante, **>**, **>>**. Le nombre de projets par page est fixé à **20** (limite technique côté serveur : 100).

### 2.2 Filtres et recherche

- **Barre de recherche** : tapez un mot-clé pour filtrer les projets. La recherche s'effectue à la fois dans le **nom** et la **description**.
- **Dropdown Statut** : filtrez par **Tous**, **En attente**, **En cours**, **Terminé**, **Annulé** ou **Suspendu**.
- Tout changement de filtre **réinitialise la pagination à la page 1**.

### 2.3 Panneau de détail (à droite)

Lorsqu'un projet est sélectionné, ses informations apparaissent dans le panneau latéral droit, organisé en sections.

- **Entête** : nom du projet, badges de **statut** et de **priorité**, et trois boutons : **Dupliquer**, **Modifier**, **Fermer (X)**.
- **Infos générales** : client, budget, description, localisation (adresse + ville), dates de début et de fin.
- **Phases** : liste des phases du projet, chacune avec une barre de progression en %.
- **Soumission liée** : si une soumission est rattachée, affiche le numéro de devis, le détail des lignes et les totaux (sous-total, TPS, TVQ, total TTC).
- **Finances** (avec bascule **Afficher / Masquer**) : quatre cartes KPI (**Revenus**, **Dépenses**, **Marge**, **Budget**) et détails par source (devis, factures, matériaux, main-d'œuvre).
- **Notes** : compteur, bouton **Ajouter**, liste des notes avec badges de catégorie. Bouton **Catégoriser IA** pour classer automatiquement.
- **Lien vers Dossier 360** : raccourci vers la fiche complète, si associé.

### 2.4 Barre d'actions de masse

Cette barre apparaît automatiquement dès qu'au moins un projet est sélectionné via les cases à cocher.

- **Compteur** : indique « N projet(s) sélectionné(s) ».
- **Dropdown « Changer le statut... »** : applique un nouveau statut à tous les projets sélectionnés.
- **Bouton « Désélectionner »** : vide la sélection et masque la barre.

### 2.5 Modales

#### Nouveau projet (modale large, 2 colonnes)

| Colonne gauche | Colonne droite |
|---|---|
| Nom du projet * | Dates de début et de fin |
| Numéro de PO Client | Budget |
| Client (Entreprise / Personne / Saisie manuelle) | Adresse |
| Statut | Ville |
| Priorité | Description (zone de texte) |

Les champs marqués d'un astérisque (*) sont obligatoires.

#### Modifier projet

Modale d'édition contenant : **Nom\***, **Description**, **Statut**, **Priorité**, **Dates**, **Budget**, **Adresse**, **Ville**.

> **Limitation actuelle** : les champs **Gestionnaire** et **Notes** apparaissent dans le formulaire mais ne sont pas (encore) sauvegardés en édition. Pour modifier ces informations, repassez par la création d'un nouveau projet ou contactez votre administrateur.

#### Ajouter une note

Modale courte avec trois champs : **Titre\***, **Contenu\*** et **Catégorie** (facultative).

---

## 3. Workflows pas-à-pas

Cette section présente, sous forme de tutoriels numérotés, les opérations courantes du module Projets.

### 3.1 Créer un projet

1. Cliquer sur le bouton **« + Nouveau projet »** situé dans le coin supérieur droit de la liste des projets.
2. Saisir le **Nom du projet** (champ obligatoire, ne peut pas être vide).
3. Choisir le **Client** parmi les trois options proposées :
   - Sélectionner une **Entreprise** existante du module CRM,
   - Sélectionner un **Contact** existant,
   - Ou activer la **saisie manuelle** si le client n'est pas encore enregistré dans le CRM.
4. Renseigner le **PO Client** (numéro de bon de commande client) si applicable.
5. Choisir le **Statut** (par défaut « En attente ») et la **Priorité** (par défaut « Moyenne »).
6. Renseigner les informations complémentaires : **Dates**, **Budget**, **Adresse et Ville du chantier**, **Description**.
7. Cliquer sur le bouton **« Créer »** pour finaliser l'enregistrement.

> **À savoir** : un numéro de projet est généré automatiquement au format PROJ-AAAA-NNNNN (exemple : PROJ-2026-00042). Ce numéro est unique et ne peut pas être modifié manuellement.

### 3.2 Modifier un projet

1. Cliquer sur le projet désiré dans la liste pour ouvrir son **panneau de détail**.
2. Cliquer sur l'icône **crayon « Modifier »** dans la barre d'actions.
3. Modifier les champs souhaités.
4. Cliquer sur **« Enregistrer »**.

> **À savoir** : seuls les champs réellement modifiés sont sauvegardés. La date de mise à jour s'incrémente automatiquement.

### 3.3 Dupliquer un projet

1. Sélectionner le projet à dupliquer dans la liste pour ouvrir son panneau de détail.
2. Cliquer sur l'icône **Copier**.
3. Le nouveau projet est créé avec le préfixe **« Copie de »** et le statut **« En attente »**.

> **Important** : les **phases**, **assignations d'employés** et **notes** ne sont **pas** copiées. Seuls les champs principaux sont reportés : budget, adresse, type, dates et description.

### 3.4 Supprimer un projet

1. Cliquer sur l'icône **poubelle** située à droite de la ligne du projet.
2. **Confirmer** la suppression.

> **Important** : un projet dont le statut est **« Terminé »** ne peut pas être supprimé directement. Il faut d'abord modifier son statut, puis procéder à la suppression.

> **Important** : la suppression est en **cascade**. Sont effacés : les phases, les notes, les assignations et les dépenses associées. Les **devis**, **factures** et **bons de commande** liés au projet sont **conservés**, mais leur lien vers ce projet est effacé.

### 3.5 Mettre à jour plusieurs projets en masse

1. **Cocher les cases** à gauche de chaque projet à modifier.
2. Une **barre d'actions** apparaît avec « N projet(s) sélectionné(s) ».
3. Choisir un **nouveau statut** dans le menu déroulant.
4. La modification est appliquée automatiquement.

> **Astuce** : utiliser la case à cocher de l'en-tête pour sélectionner toute la page en un seul clic.

### 3.6 Exporter en CSV

1. Cliquer sur **« Exporter CSV »** (icône téléchargement).
2. Le fichier projets_export.csv est téléchargé automatiquement.

> **À savoir** : colonnes incluses : ID, Numéro, Nom, Statut, Priorité, Type, Client, Début, Fin, Budget, Description, Adresse, Ville, Notes, Créé, Modifié. Encodage UTF-8.

### 3.7 Lier un projet à un devis

La liaison s'effectue depuis le **module Devis** : créer ou éditer un devis, puis sélectionner le projet concerné.

- Une fois la liaison établie, le panneau de détail du projet affiche la section **« Soumission »** avec les **lignes** et les **totaux** (TPS / TVQ / total TTC).
- Les **données financières** intègrent ce devis uniquement si son statut est **« Accepté »**.

### 3.8 Gérer les phases d'un projet

1. Depuis le **panneau de détail**, accéder à la section **Phases** et créer une nouvelle phase (le **nom** est obligatoire).
2. Renseigner l'**ordre** d'exécution, les **dates**, le **statut**.
3. Mettre à jour la **progression** (0 à 100 %).

> **À savoir** : la **progression globale du projet** est calculée automatiquement comme la **moyenne** des progressions de toutes ses phases (visible dans le diagramme de Gantt).

### 3.9 Assigner un employé à un projet

1. Depuis le panneau de détail, accéder à la section **Assignations** et cliquer sur le bouton d'ajout.
2. Choisir l'**employé** dans la liste déroulante.
3. Renseigner le **rôle** (par exemple : Chef de chantier, Ouvrier, Contremaître, Estimateur).

> **Important** : un même employé ne peut pas être assigné **deux fois** au même projet.

### 3.10 Ajouter et catégoriser une note

1. Depuis le détail du projet, accéder à la section **Notes** et cliquer sur **« + Ajouter »**.
2. Saisir le **Titre** (obligatoire), le **Contenu** (obligatoire) et éventuellement une **Catégorie manuelle**.
3. Cliquer sur **« Ajouter »**.
4. Pour catégoriser via l'**intelligence artificielle**, cliquer sur **« Catégoriser IA »** (icône robot).

> **À savoir** : 10 catégories disponibles : Technique, Sécurité, Budget, Planning, Qualité, Communication, Environnement, RH, Approvisionnement, Autre. L'IA assigne aussi un **score d'importance** (0 à 1).

> **Important** : la catégorisation par IA **déduit des crédits IA**. Vérifier le solde avant utilisation massive.

### 3.11 Consulter les finances d'un projet

1. Ouvrir le panneau de détail et accéder à la section **« Finances »**, puis cliquer sur **« Afficher »**.
2. Consulter les **cartes KPI** : **Revenus**, **Dépenses**, **Marge** (en valeur et %) et **Budget**.
3. Examiner les **détails par catégorie** : devis acceptés, factures (avec encaissements), bons de commande, main-d'œuvre par employé.

> **À savoir** : la **marge** = **Revenus (factures)** − **Dépenses (matériaux + main-d'œuvre)**. Les devis non facturés ne sont **pas** comptés dans la marge.

### 3.12 Modifier rapidement les dates (édition inline)

1. Cliquer **directement** sur la cellule date dans le tableau.
2. Un **sélecteur de date** s'affiche.
3. Choisir la nouvelle date : enregistrement automatique.

---

## 4. Référence des champs, statuts et formats

### 4.1 Champs d'un projet

| Champ | Type | Obligatoire | Description / Format |
|---|---|---|---|
| Nom du projet | Texte | Oui | Libellé principal, max 255 caractères |
| Numéro de projet | Texte | Auto | Auto-généré au format PROJ-AAAA-NNNNN |
| Client (entreprise) | Sélection | Non | Choix dans la liste des entreprises du CRM |
| Client (contact) | Sélection | Non | Choix d'un contact rattaché à l'entreprise |
| Client (saisie manuelle) | Texte | Non | Saisie libre si client absent du CRM |
| PO Client | Texte | Non | Numéro de bon de commande fourni par le client |
| Statut | Énumération | Oui | Voir 4.2 (défaut : En attente) |
| Priorité | Énumération | Non | Voir 4.3 (défaut : Moyenne) |
| Type de projet | Texte | Non | Texte libre (Rénovation, Construction neuve, etc.) |
| Date début prévue | Date | Non | Format AAAA-MM-JJ |
| Date fin prévue | Date | Non | Format AAAA-MM-JJ |
| Budget total | Numérique | Non | Montant CAD, max 14 chiffres / 2 décimales |
| Description | Texte multi-ligne | Non | Description détaillée |
| Gestionnaire | Texte | Non | Nom du responsable |
| Notes | Texte multi-ligne | Non | Notes internes |
| Adresse chantier | Texte | Non | Adresse civique du chantier |
| Ville chantier | Texte | Non | Ville du chantier |
| Devis lié | Référence | Non | Lien vers un devis du module Devis |
| Date de création | Timestamp | Auto | Lecture seule |
| Date de modification | Timestamp | Auto | Mise à jour à chaque sauvegarde |

### 4.2 Statuts du projet

| Statut | Couleur badge | Description | Effet |
|---|---|---|---|
| En attente | Jaune | Projet créé, pas encore commencé | Statut par défaut |
| En cours | Bleu | Travaux actifs sur chantier | — |
| Terminé | Vert | Projet clôturé | **Non supprimable** |
| Annulé | Rouge | Projet abandonné | Exclu du Gantt |
| Suspendu | Ambre | En pause temporaire | — |

### 4.3 Niveaux de priorité

| Priorité | Description |
|---|---|
| Basse | À planifier sans urgence |
| Moyenne | Priorité normale (défaut) |
| Haute | Urgent, à commencer bientôt |
| Urgente | Priorité maximum |

### 4.4 Champs d'une phase

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Nom | Texte | Oui | Nom de l'étape (ex: Démolition) |
| Description | Texte | Non | Détails |
| Ordre | Entier | Non | Auto-incrémenté si vide |
| Statut | Énumération | Non | En attente / En cours / Terminé |
| Date début | Date | Non | AAAA-MM-JJ |
| Date fin | Date | Non | AAAA-MM-JJ |
| Progression | Pourcentage | Non | 0 à 100 |

### 4.5 Champs d'une assignation

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Employé | Sélection | Oui | Liste des employés actifs du tenant |
| Rôle | Texte | Non | Ex: Chef de chantier, Ouvrier, Technicien |
| Date d'assignation | Timestamp | Auto | Horodatage automatique |

### 4.6 Catégories IA pour notes

| # | Catégorie | Portée |
|---|---|---|
| 1 | Technique | Questions techniques de réalisation |
| 2 | Sécurité | Risques chantier, EPI, accidents |
| 3 | Budget | Dépassements, écarts, ajustements |
| 4 | Planning | Retards, avances, jalons |
| 5 | Qualité | Défauts, contrôles, conformité |
| 6 | Communication | Échanges client, fournisseurs, équipe |
| 7 | Environnement | Gestion des déchets, conformité environnementale |
| 8 | RH | Équipe, formation, motivation |
| 9 | Approvisionnement | Matériaux, livraisons, ruptures |
| 10 | Autre | Note non classée |

L'IA attribue aussi un **score d'importance** entre 0 et 1.

### 4.7 Formats numériques normalisés

| Élément | Format | Exemple |
|---|---|---|
| Numéro de projet | PROJ-AAAA-NNNNN | PROJ-2026-00042 |
| Numéro de devis | DEV-AAAA-NNN | DEV-2026-001 |
| Numéro de bon de travail | BT-NNNNN | BT-00012 |
| Numéro de bon de commande | BC-AAAA-NNNNN | BC-2026-00007 |
| Numéro de facture | FACT-AAAA-NNNNN | FACT-2026-00031 |
| Devise | $ CAD | 15 000,50 $ |
| Date | AAAA-MM-JJ | 2026-04-25 |

### 4.8 Limites du système

| Élément | Limite |
|---|---|
| Projets par page (vue liste) | 20 (fixe côté interface ; limite technique de l'API : 100) |
| Projets affichables dans le Gantt | 500 max |
| Longueur du nom de projet | 255 caractères |
| Budget total | 14 chiffres avec 2 décimales |
| Catégories IA | 10 (fixe) |
| Score d'importance IA | 0 à 1 (décimal) |

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module relié | Nature de la relation | Manifestation à l'écran |
|---|---|---|
| **CRM (Entreprises / Contacts)** | Sélection du client à la création/édition | Le nom du client s'affiche dans la liste et le détail |
| **Devis (Soumissions)** | Un projet peut être lié à un devis principal | Panneau détail affiche la soumission ; devis acceptés alimentent les revenus |
| **Bons de Commande / Achats** | Les BC liés constituent les **dépenses matériaux** | Visibles dans la section Finances |
| **Factures** | Les factures alimentent les **revenus réels** | Total payé et solde dû dans Finances |
| **Pointage / Temps employés** | Les heures pointées calculent le **coût main-d'œuvre** | Calcul automatique : heures × taux horaire |
| **Employés** | Assignation par rôle | Liste des assignés dans le détail |
| **Dossiers 360** | Lien optionnel vers gestion documentaire | Bouton « Voir le Dossier 360 » |
| **Suivi (Gantt)** | Visualisation chronologique | Module séparé /suivi |
| **Comptabilité** | Référence analytique | Comptabilisation par projet |

> **Note importante** : la plupart des liens se créent **depuis le module source** (un BC se lie au projet depuis le module Achats), pas depuis le projet lui-même.

### 5.2 Cas particuliers

- **Client absent du CRM** : utilisez le champ « Saisie manuelle ».
- **Numéro de projet** : généré automatiquement et **non éditable**. Les anciens projets sans numéro sont rétro-comblés automatiquement à la prochaine consultation.
- **Projet sans budget** : la marge est calculée même sans budget de référence.
- **Suppression d'un projet « Terminé »** : impossible. Changez d'abord le statut.
- **Duplication** : aucune phase, assignation ni note n'est dupliquée.
- **Catégorisation IA** : nécessite un solde de crédits IA suffisant.
- **Tri par numéro de projet** : utilise un **tri naturel** (PROJ-2026-1, ..., PROJ-2026-10).
- **Édition inline des dates** : disponible directement dans le tableau.

### 5.3 Astuces

- **Sélection multiple** : cochez l'entête de la colonne pour sélectionner toute la page.
- **Recherche** : fonctionne sur le **nom** et la **description**.
- **Ordre des phases** : laissez vide pour ajouter en fin de liste automatiquement.
- **Export CSV pour Excel** : encodage UTF-8 ; ouvrir via **Données → Importer depuis CSV** pour préserver les accents.

### 5.4 FAQ

**Q : Pourquoi je ne peux pas modifier le numéro de projet ?**
R : Il est généré automatiquement et garantit l'unicité dans votre tenant.

**Q : Que se passe-t-il si je supprime un projet lié à des factures ?**
R : Les factures restent intactes mais leur lien vers le projet est effacé.

**Q : Pourquoi mes phases n'apparaissent pas dans le Gantt ?**
R : Vérifiez que les phases ont des dates de début et de fin renseignées.

**Q : La marge affichée est-elle exacte ?**
R : Elle compare les **revenus facturés** (et non les devis acceptés) aux **dépenses (matériaux + main-d'œuvre)**.

**Q : Puis-je avoir plusieurs devis liés au même projet ?**
R : Un projet n'a qu'un seul **devis principal** rattaché. D'autres soumissions peuvent référencer ce projet depuis le module Devis et seront comptabilisées dans les revenus une fois acceptées.

**Q : Comment voir les projets archivés ?**
R : Filtrez par statut « Annulé » ou « Suspendu ».

**Q : Pourquoi mon export CSV est-il tronqué ?**
R : L'export inclut uniquement les projets visibles selon les filtres actifs. Pour tout exporter, retirez les filtres.

### 5.5 Limites connues

- **Pas d'historique des modifications** visible côté interface.
- **Pas de suppression en masse** : seul le changement de statut en masse est supporté.
- **Pas de templates de projet** : la duplication couvre ce besoin.
- **Catégorisation IA** : peut occasionnellement retourner une catégorie inattendue. Modification manuelle possible en éditant la note.

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Projets — v1.0 — 2026-04-25*
