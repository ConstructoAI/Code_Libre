# Manuel utilisateur — Module CRM

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (vendeurs, gestionnaires de comptes, administrateurs)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Entreprises et Contacts](#2-interface--entreprises-et-contacts)
3. [Interface — Opportunités et Pipeline](#3-interface--opportunites-et-pipeline)
4. [Workflows pas-à-pas](#4-workflows-pas-a-pas)
5. [Référence, intégrations et FAQ](#5-reference-integrations-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module CRM

Le module **CRM** (Customer Relationship Management) de Constructo est votre centre de gestion des relations d'affaires. Il vous permet de garder une trace complète et organisée de tout votre écosystème commercial : clients actuels, prospects à démarcher, fournisseurs réguliers, sous-traitants de confiance et partenaires stratégiques.

Concrètement, le CRM vous aide à :

- **Centraliser** toutes les informations sur les entreprises et personnes avec qui vous faites affaire
- **Prospecter** de nouveaux clients et suivre vos efforts commerciaux
- **Gérer votre pipeline de vente** pour visualiser où en est chaque opportunité
- **Convertir** les opportunités gagnées directement en devis
- **Conserver l'historique** complet de vos échanges (appels, courriels, réunions, visites de chantier)
- **Qualifier vos opportunités** avec la méthode BANT pour prioriser vos efforts

Fini les fichiers Excel éparpillés et les notes manuscrites perdues : tout est rassemblé au même endroit, accessible à toute votre équipe.

### 1.2 Concepts-clés

Le module s'articule autour de **quatre sous-entités** principales qui travaillent ensemble :

- **Entreprises (Companies)** : ce sont les organisations avec qui vous interagissez. Chaque entreprise est classée selon son type — client, fournisseur, sous-traitant ou partenaire. Une même entreprise peut cumuler plusieurs rôles.
- **Contacts** : ce sont les personnes physiques. Un contact peut être rattaché à une entreprise (employé, gestionnaire de projet, acheteur) ou exister de façon indépendante. Vous pouvez désigner un **contact principal** pour chaque entreprise.
- **Opportunités (Deals)** : ce sont vos occasions commerciales. Chaque opportunité reçoit un identifiant unique au format `OPP-XXXXX` et progresse à travers un pipeline structuré.
- **Interactions / Activités** : c'est la mémoire de vos échanges. Vous y consignez vos appels, courriels, réunions, visites de site et notes diverses. Vous pouvez aussi y programmer des **tâches** futures (relances, rappels, suivis).

### 1.3 Pipeline de vente (6 étapes)

Vos opportunités traversent un pipeline en six étapes clairement définies :

**PROSPECTION** → **QUALIFICATION** → **PROPOSITION** → **NÉGOCIATION** → **GAGNÉ** ou **PERDU**

Cette structure linéaire vous permet de visualiser d'un coup d'œil l'état de votre carnet de ventes et d'identifier rapidement les opportunités qui stagnent ou celles qui sont sur le point de se conclure.

### 1.4 Qualification BANT

Pour vous aider à prioriser vos efforts, le CRM intègre la méthode **BANT** :

- **B**udget : le client a-t-il les moyens financiers ?
- **A**uthority : parlez-vous au bon décideur ?
- **N**eed : le besoin est-il réel et exprimé ?
- **T**imeline : l'échéancier est-il défini ?

Vous pouvez attribuer un **score manuel de 0 à 100** à chaque opportunité. En parallèle, le système calcule automatiquement un **score basé sur 7 critères** : montant, présence d'une entreprise rattachée, présence d'un contact, probabilité de fermeture, nombre d'interactions, source du lead et fraîcheur du dossier.

### 1.5 Accès au module

Le CRM est accessible de deux façons :

- **Par la barre latérale (sidebar)** : repérez la section **CRM / Ventes** dans le menu de gauche.
- **Par URL directe** :
  - `/companies` pour la liste des entreprises
  - `/contacts` pour la liste des contacts
  - `/ventes` pour le tableau de bord du pipeline

### 1.6 Permissions et sécurité

- **Tout utilisateur authentifié** peut consulter, créer, modifier et supprimer les fiches du CRM (CRUD complet).
- **Isolation par tenant** : grâce à l'architecture multi-tenant de Constructo, vos données CRM sont strictement cloisonnées. Vous ne voyez que les entreprises, contacts et opportunités de votre propre organisation.
- **Aucune restriction par rôle** n'est actuellement appliquée à l'interface : tout membre connecté de votre équipe a accès aux mêmes fonctionnalités. Établissez des conventions internes claires pour éviter les doublons.

---

## 2. Interface — Entreprises et Contacts

Cette section présente les deux pages centrales du module CRM : la gestion des **Entreprises** (organisations clientes, fournisseurs, partenaires) et celle des **Contacts** (personnes physiques rattachées ou non à une entreprise).

### 2.1 Page Entreprises (`/companies`)

La page Entreprises constitue le point d'entrée principal du CRM. Elle regroupe l'ensemble de votre carnet d'organisations.

#### Schéma du layout

```
+--------------------------------------------------------------------------+
| [+ Nouvelle entreprise]   [Recherche...]   [Filtre type v]   [Exporter] |
+----------------------------------------------------+---------------------+
| Nom        | Type   | Email     | Tél | Ville | C |                     |
|------------+--------+-----------+-----+-------+---|   PANNEAU DETAIL    |
| ABC Const. | Ent.G. | abc@...   | ... | Mtl   | 4 |                     |
| Excav. XY  | Sous-T.| info@...  | ... | Lvl   | 2 |   (entreprise       |
| Promo 360  | Prom.  | promo@... | ... | Qc    | 7 |    sélectionnée)    |
+----------------------------------------------------+---------------------+
|                          [< 1 2 3 ... >]                                 |
+--------------------------------------------------------------------------+
```

#### Barre d'actions

- **Nouvelle entreprise** : ouvre la modale de création.
- **Recherche** : filtre instantané sur Nom, Email, Ville.
- **Filtre type** : dropdown permettant de restreindre l'affichage à un type d'entreprise.
- **Pagination** : 20 entrées par page par défaut.

#### Types d'entreprises (14 options)

Entrepreneur général, Sous-traitant spécialisé, Promoteur immobilier, Fournisseur matériaux, Consultant/Ingénieur, Architecte, Arpenteur-géomètre, Organisme de contrôle, Institution financière, Assureur, Client résidentiel, Client commercial, Client industriel, Municipalité.

#### Secteurs d'activité (19 options)

Construction résidentielle, Construction commerciale, Construction industrielle, Rénovation résidentielle, Rénovation commerciale, Excavation, Fondations, Charpenterie, Couverture, Plomberie, Électricité, Isolation, Revêtements, Finition intérieure, Aménagement paysager, Démolition, Location d'équipements, Transport.

#### Modale Nouvelle entreprise

| Champ | Détail |
|---|---|
| Nom * | Raison sociale de l'entreprise |
| Type | Voir liste des 14 types |
| Secteur | Voir liste des 19 secteurs |
| Email, Téléphone, Site web | Coordonnées générales |
| Adresse, Ville, Province, Code postal, Pays | Province par défaut : **Québec**, Pays par défaut : **Canada** |
| NEQ | Numéro d'entreprise du Québec |
| TPS, TVQ | Numéros de taxes |
| Conditions de paiement | Valeur par défaut : **Net 30** |
| Notes | Champ texte libre |

> **Astuce QC** : remplir le NEQ dès la création accélère la production des documents fiscaux et factures conformes Revenu Québec.

#### Panneau détail (à droite)

Affiche en lecture rapide :
- Coordonnées et adresse formatée sur plusieurs lignes
- Conditions de paiement et numéros NEQ/TPS/TVQ
- **Contacts liés** : liste cliquable redirigeant vers la fiche contact
- **Liens contextuels** vers les opportunités, devis et factures associés

### 2.2 Page Contacts (`/contacts`)

La page Contacts liste les personnes physiques avec lesquelles vous interagissez. Le layout reprend la structure de la page Entreprises.

#### Schéma du layout

```
+--------------------------------------------------------------------------+
| [+ Nouveau contact]   [Recherche...]   [Filtre entreprise v]            |
+----------------------------------------------------+---------------------+
| Prénom | Nom     | Entreprise  | Email   | Tél | Rôle    |              |
|--------+---------+-------------+---------+-----+---------|  PANNEAU     |
| Marie  | Tremblay| ABC Const.  | m.t@... | ... | Estim.  |  DETAIL      |
| Jean   | Roy     | (aucune)    | jr@...  | ... | Indép.  |              |
| Lina   | Côté    | Promo 360 * | l.c@... | ... | Direct. |              |
+----------------------------------------------------+---------------------+
                                  * = badge « Principal »
```

Le badge **« Principal »** identifie d'un coup d'œil le contact désigné comme interlocuteur principal de l'entreprise.

#### Modale Nouveau contact

| Champ | Détail |
|---|---|
| Entreprise | Dropdown **optionnel** (peut rester vide) |
| Prénom * | Champ obligatoire |
| Nom * | Champ obligatoire |
| Email, Téléphone, Mobile | Coordonnées directes |
| Rôle/Poste | Ex. : Directeur de projet, Estimateur |
| Fonction | Précision du rôle (décideur, signataire) |
| Département | Ex. : Achats, Comptabilité, Chantier |
| Adresse, Ville, Province, Code postal | Coordonnées personnelles si pertinent |
| Notes | Champ texte libre |

#### Cas particulier — Contact sans entreprise

Le champ **Entreprise** peut rester vide (travailleur autonome, prospect non encore qualifié, référence personnelle). Le contact apparaîtra avec la mention `(aucune)` dans la colonne Entreprise et restera entièrement fonctionnel.

### 2.3 Recherche et filtres

La recherche est **full-text** et instantanée.

| Page | Champs indexés |
|---|---|
| `/companies` | Nom, Email, Ville |
| `/contacts` | Prénom, Nom, Email |

Les filtres dropdown se cumulent avec la recherche textuelle.

### 2.4 Vue mobile

Sur écran étroit, l'interface bascule en **mode cards empilées** : chaque entreprise ou contact occupe une carte verticale. Le menu **⋮** (kebab) regroupe les actions principales : Voir détail, Modifier, Appeler, Envoyer un courriel, Supprimer.

---

## 3. Interface — Opportunités et Pipeline

Cette section décrit l'interface utilisateur du sous-module **Opportunités/Ventes** du CRM. Elle couvre la page principale, ses onglets, les composants visuels (cartes, KPI, modales), ainsi que les interactions clés (drag-and-drop, qualification BANT).

### 3.1 Page Ventes (`/ventes`)

Pour accéder au pipeline commercial, cliquez sur **« Ventes »** dans le menu latéral. Quatre onglets structurent l'espace de travail :

| Onglet | Vue | Usage principal |
|---|---|---|
| **Pipeline (Kanban)** | Visuelle, par étape | Suivi quotidien, glisser-déposer |
| **Opportunités (Tableau)** | Liste paginée | Recherche, tri, export |
| **Historique** | Timeline chronologique | Consulter les interactions passées |
| **Qualification (BANT)** | Tableau scoré | Prioriser les meilleurs prospects |

### 3.2 En-tête KPI (4 cartes)

| Carte | Indicateur principal | Indicateur secondaire |
|---|---|---|
| **Volume** | Total opportunités | Dont *En cours* (hors Gagné/Perdu) |
| **Performance** | Taux de conversion (%) | Calculé : Gagnées / Total clôturées |
| **Financier** | Montant gagné ($CAD) | Pipeline total ($CAD) |
| **Activité** | Délai moyen (jours) | Interactions sur 30 jours |

Les montants s'affichent au format québécois (`450 000 $`).

### 3.3 Onglet Pipeline (Kanban)

```
+-------------+--------------+-------------+--------------+
| PROSPECTION | QUALIFICATION| PROPOSITION | NÉGOCIATION  |
|     (12)    |      (8)     |     (5)     |     (3)      |
| 450 000 $   |   320 000 $  |  180 000 $  |   90 000 $   |
+-------------+--------------+-------------+--------------+
| [carte]     | [carte]      | [carte]     | [carte]      |
| [carte]     | [carte]      | [carte]     |              |
| [carte]     |              |             |              |
+-------------+--------------+-------------+--------------+

           [GAGNÉ : 5 — 850k$]   [PERDU : 3 — 145k$]
            (récap, sans cartes)
```

L'en-tête de chaque colonne affiche **le nombre d'opportunités** entre parenthèses et **le montant total** cumulé. Les colonnes terminales **Gagné** et **Perdu** apparaissent en bas sous forme de pavés récapitulatifs uniquement (sans cartes).

**Anatomie d'une carte d'opportunité** :

- **Titre** : Nom de l'opportunité
- **Montant + Probabilité + Date clôture** : ex. `45 000 $ — 75 % — 15 juin 2026`
- **Client + Contact** : entreprise et personne référente
- **Score BANT** : badge couleur HOT (rouge, ≥70), WARM (orange, 40-69), COLD (bleu, <40)
- **Badge statut** : code visuel reprenant la couleur de la colonne

### 3.4 Drag-and-drop

| Action | Effet |
|---|---|
| Glisser une carte vers **une autre colonne** | Change le statut (sauvegarde immédiate) |
| Glisser une carte **dans la même colonne** | Réordonne la position |
| Survoler une colonne pendant le glissement | **Surlignage** de la colonne cible |
| Carte en cours de déplacement | **Opacité 0,5** + curseur grabbing |

> **Astuce** : si la carte ne « s'accroche » pas, vérifiez que vous saisissez la zone d'en-tête de la carte (et non un lien interne).

### 3.5 Modale détail opportunité

Champs éditables :

| Bloc | Champs |
|---|---|
| Identification | Nom, Statut, Source, Priorité |
| Financier | Montant estimé ($), Probabilité (slider 0-100 %) |
| Échéancier | Date de clôture, Date de soumission, Début prévu, Fin prévue |
| Client | Entreprise (autocomplétion), Contact, PO Client |
| Texte libre | Description, Notes internes |

**Boutons** :
- **Créer devis** : convertit l'opportunité en devis pré-rempli (Administration 3% + Contingences 12% + Profit 15% + TPS 5% + TVQ 9,975%).
- **Supprimer** : avec avertissement bloquant si devis ou projet déjà liés.
- **Assignations** : ajouter/retirer des employés (vendeurs, supports).

### 3.6 Onglet Opportunités (Tableau)

Vue tableau classique avec : **Numéro** (`OPP-XXXXX`), Nom, Client, Montant, Statut, Probabilité, Date clôture, Source. Recherche, filtre multi-statut, pagination 20/page.

### 3.7 Onglet Historique

Timeline chronologique inverse des interactions/activités/notes. Filtre par entreprise pour reconstituer l'historique complet d'un client donné.

Affichage : icône type, titre/résumé, date/heure, sous-type, entreprise.

### 3.8 Onglet Qualification (BANT)

Tableau trié automatiquement HOT → WARM → COLD. Colonnes : Nom, Client, Montant, Score Budget (0-25), Score Authority (0-25), Score Need (0-25), Score Timing (0-25), Total (0-100), Catégorie A/B/C/D.

| Catégorie | Total | Recommandation |
|---|---|---|
| **A** | 80-100 | Priorité maximale — relancer cette semaine |
| **B** | 60-79 | Suivi actif — relancer ce mois |
| **C** | 40-59 | À développer — qualifier davantage |
| **D** | 0-39 | Requalifier ou abandonner |

Un clic ouvre un formulaire pop-up avec quatre sliders. Le total et la catégorie se calculent en direct.

### 3.9 Calendrier CRM

Vue mensuelle consolidant trois flux : interactions passées (vertes), activités à venir (orange), dates de clôture des opportunités (bleues). Navigation Mois précédent/suivant. Clic sur événement → fiche associée.

---

## 4. Workflows pas-à-pas

### 4.1 Créer une entreprise

1. Cliquez sur **Entreprises** (`/companies`) dans le menu latéral.
2. Cliquez sur **« + Nouvelle entreprise »**.
3. Saisissez le **Nom** (obligatoire).
4. Choisissez le **Type** et le **Secteur d'activité**.
5. Renseignez les coordonnées : Email, Téléphone, Adresse complète, Site web.
6. Saisissez les informations fiscales : NEQ, TPS, TVQ.
7. Définissez les **Conditions de paiement** (Net 30 par défaut).
8. Ajoutez des **Notes** internes au besoin.
9. Cliquez sur **« Créer »**.

> **À savoir** : l'entreprise est immédiatement disponible dans toutes les listes déroulantes (devis, opportunités, contacts).

### 4.2 Modifier une entreprise

1. Cliquez sur la ligne de l'entreprise dans la liste.
2. Le **panneau de détail** s'affiche à droite.
3. Cliquez sur l'**icône crayon** (Modifier).
4. Apportez les changements.
5. Cliquez sur **« Enregistrer »**.

### 4.3 Supprimer une entreprise

1. Ouvrez la fiche entreprise.
2. Cliquez sur l'**icône poubelle**.
3. Confirmez.

> **Important** : la suppression d'une entreprise **n'efface pas en cascade** ses contacts ni ses interactions. Vous devez décider manuellement de leur sort.

### 4.4 Créer un contact

1. Cliquez sur **Contacts** (`/contacts`).
2. Cliquez sur **« + Nouveau contact »**.
3. Choisissez l'**Entreprise** (ou laissez vide pour un contact indépendant).
4. Saisissez le **Prénom** et le **Nom** (obligatoires).
5. Renseignez Email, Téléphone, Mobile, Rôle/Poste.
6. Cliquez sur **« Créer »**.

### 4.5 Définir un contact comme principal

1. Ouvrez la fiche du contact.
2. Cliquez sur l'icône crayon.
3. Cochez la case **« Contact principal de l'entreprise »**.
4. Cliquez sur **« Enregistrer »**.

> **À savoir** : un badge **« Principal »** apparaît à côté du nom. Un seul contact principal par entreprise.

### 4.6 Modifier ou supprimer un contact

Identique aux entreprises (icônes crayon / poubelle).

### 4.7 Créer une opportunité

1. Naviguez vers **Ventes** (`/ventes`) → onglet **Pipeline**.
2. Cliquez sur **« + Nouvelle opportunité »**.
3. Saisissez le **Nom** (titre du deal).
4. Choisissez l'**Entreprise** (ou client direct si pas dans le CRM).
5. Choisissez le **Contact** (optionnel, filtré par entreprise).
6. Saisissez le **Montant estimé** ($CAD) et la **Probabilité** (%).
7. Choisissez le **Statut initial** (PROSPECTION par défaut).
8. Renseignez la **Date de clôture prévue**, la **Source** et la **Priorité**.
9. Ajoutez **Description** et **PO Client** si applicable.
10. Cliquez sur **« Créer »**.

> **À savoir** : un numéro `OPP-XXXXX` est généré automatiquement et un dossier (gestion documentaire) est créé en arrière-plan.

### 4.8 Faire avancer une opportunité dans le pipeline (drag-and-drop)

1. Affichez la **vue Pipeline (Kanban)**.
2. Cliquez et **maintenez** la carte.
3. **Glissez** vers la colonne du nouveau statut.
4. **Relâchez** : statut sauvegardé immédiatement.

### 4.9 Réordonner les opportunités dans une colonne

1. Cliquez et maintenez la carte.
2. **Glissez vers le haut ou le bas** dans la **même colonne**.
3. Relâchez : nouvel ordre sauvegardé.

### 4.10 Convertir une opportunité en devis

1. Ouvrez l'opportunité (double-clic).
2. Cliquez sur **« Créer devis »**.
3. Le système :
   - Crée un devis avec client, contact, montant pré-remplis.
   - Calcule TPS (5 %) + TVQ (9,975 %) avec marges Administration 3 % + Contingences 12 % + Profit 15 %.
   - Lie l'opportunité au devis (bidirectionnel).
4. Naviguez vers **Devis** pour finaliser.

> **Important** : une opportunité ne peut être convertie **qu'une seule fois**. Le bouton disparaît après conversion.

### 4.11 Marquer une opportunité comme GAGNÉE ou PERDUE

1. Repérez les colonnes **GAGNÉ** et **PERDU** au bas du Kanban.
2. **Glissez** la carte vers la colonne appropriée.
3. L'opportunité quitte le pipeline actif et compte dans les KPI.

### 4.12 Enregistrer une interaction

1. Depuis l'opportunité (ou la fiche entreprise/contact), cliquez sur **« Nouvelle interaction »**.
2. Choisissez le **Type** (APPEL, EMAIL, RÉUNION, VISITE, NOTE).
3. Saisissez un **Résumé** (court titre).
4. Rédigez les **Détails**.
5. Indiquez **Date** et **heure**.
6. Renseignez la **Date du prochain suivi** (optionnel).
7. Cliquez sur **« Enregistrer »**.

### 4.13 Programmer une activité (tâche / rappel)

1. Cliquez sur l'onglet **Calendrier** ou bouton **« + Nouvelle activité »**.
2. Choisissez le **Type** (Appel à faire, Relance, RDV, Visite chantier).
3. Saisissez le **Sujet** (obligatoire) et la **Description**.
4. Date et heure prévues.
5. Durée prévue (minutes).
6. Liez à une entreprise / contact / opportunité (optionnel).
7. Cliquez sur **« Créer »**.

### 4.14 Qualifier une opportunité (BANT manuel)

1. Onglet **Qualification** ou bouton **BANT** sur l'opportunité.
2. Saisissez les 4 scores (0-25) : Budget, Authority, Need, Timing.
3. Le total (0-100) et la catégorie (A/B/C/D) sont calculés automatiquement.
4. Notes de qualification optionnelles.
5. Cliquez sur **« Sauvegarder »**.

### 4.15 Consulter le score automatique (lead scoring)

Onglet **Qualification** → liste avec scores selon 7 critères pondérés (montant, entreprise, contact, probabilité, interactions, source, fraîcheur). Catégories HOT/WARM/COLD.

> **À savoir** : le score automatique se met à jour en temps réel au fil des interactions enregistrées.

### 4.16 Assigner un employé à une opportunité

1. Ouvrez l'opportunité → section **Assignations**.
2. Choisissez l'**employé** dans la liste.
3. Sélectionnez le **rôle** (Vendeur principal, Support, Estimateur, Chargé de projet).
4. Cliquez sur **« Ajouter »**.
5. Pour retirer : icône poubelle.

### 4.17 Consulter la timeline

Onglet **Historique** → liste chronologique inverse. Filtre par entreprise pour cibler.

> **À savoir** : la timeline est précieuse pour préparer un rendez-vous client.

### 4.18 Consulter le calendrier des activités

Onglet **Calendrier** → vue mensuelle. Navigation Mois précédent/suivant. Clic sur un événement pour le détail.

---

## 5. Référence, intégrations et FAQ

### 5.1 Champs Entreprise

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Nom | Texte (255) | Oui | Raison sociale officielle |
| Type | Liste (14 options) | Non | Catégorisation (Client, Fournisseur, etc.) |
| Secteur | Liste (19 options) | Non | Domaine d'activité |
| Email | Courriel | Non | Adresse principale |
| Téléphone | Texte | Non | Numéro principal |
| Adresse | Texte | Non | Numéro civique et rue |
| Ville | Texte | Non | Municipalité |
| Province | Liste | Non | Défaut : Québec |
| Code postal | Texte | Non | Format A1A 1A1 |
| Pays | Texte | Non | Défaut : Canada |
| Site web | URL | Non | Adresse web complète |
| Contact principal | Référence | Non | Lien vers un contact existant |
| NEQ | Texte | Non | Numéro d'entreprise du Québec |
| TPS | Texte | Non | Numéro de taxe fédérale |
| TVQ | Texte | Non | Numéro de taxe provinciale |
| Conditions paiement | Liste | Non | Défaut : Net 30 |
| Notes | Texte long | Non | Commentaires libres |

### 5.2 Champs Contact

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Prénom | Texte | Oui | Prénom |
| Nom | Texte | Oui | Nom de famille |
| Email | Courriel | Non | Adresse |
| Téléphone | Texte | Non | Ligne fixe |
| Mobile | Texte | Non | Cellulaire |
| Entreprise | Référence | Non | Rattachement (peut être vide) |
| Rôle/Poste | Texte | Non | Titre fonctionnel |
| Fonction | Texte | Non | Précision (décideur, signataire) |
| Département | Texte | Non | Service interne |
| Adresse, Ville, Province, Code postal | Texte | Non | Coordonnées |
| Principal | Booléen | Non | Marque le contact principal |
| Notes | Texte long | Non | Commentaires |

### 5.3 Champs Opportunité

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Numéro | Auto (OPP-NNNNN) | Auto | Généré automatiquement |
| Nom | Texte | Oui | Titre du deal |
| Entreprise | Référence | Conditionnel | OU client direct |
| Client direct | Texte | Conditionnel | Si entreprise absente du CRM |
| Contact | Référence | Non | Filtré selon l'entreprise |
| Montant estimé | Décimal ($CAD) | Non | Valeur prévisionnelle |
| Probabilité | Entier (0-100%) | Non | Estimation de réussite |
| Statut | Liste (6 valeurs) | Oui | Étape du pipeline |
| Date clôture prévue | Date | Non | Échéance estimée |
| Source | Texte | Non | Origine du lead |
| PO Client | Texte | Non | Numéro de bon de commande client |
| Priorité | Liste | Non | NORMAL / HAUTE / BASSE |
| Description | Texte long | Non | Contexte détaillé |
| Date soumission, Début/Fin prévue | Date | Non | Jalons projet |
| Devis lié, Projet lié, Dossier lié | Référence | Auto | Liens vers modules connexes |

### 5.4 Statuts du pipeline

| Statut | Position | Description |
|---|---|---|
| PROSPECTION | 1 (entrée) | Recherche initiale, premier contact |
| QUALIFICATION | 2 | Analyse besoins, évaluation budget |
| PROPOSITION | 3 | Préparation/envoi devis |
| NÉGOCIATION | 4 | Clarifications, ajustements |
| GAGNÉ | terminal | Conversion confirmée |
| PERDU | terminal | Abandon |

### 5.5 Types d'interaction

| Type | Usage typique |
|---|---|
| APPEL | Échange téléphonique |
| EMAIL | Correspondance écrite |
| RÉUNION | Rencontre formelle |
| VISITE | Déplacement client/chantier |
| NOTE | Observation interne |

### 5.6 Score automatique (7 critères)

| Critère | Points |
|---|---|
| Montant > 0 | +20 |
| Entreprise liée | +15 |
| Contact lié | +10 |
| Probabilité > 50 % | +20 |
| ≥ 1 interaction | +15 |
| Source identifiée | +10 |
| Mise à jour < 30 jours | +10 |
| **Total possible** | **0-100** |

**Catégories** : HOT (≥70), WARM (40-69), COLD (<40).

### 5.7 Score BANT manuel

| Dimension | Plage | Question clé |
|---|---|---|
| Budget | 0-25 | Le client a-t-il les fonds disponibles ? |
| Authority | 0-25 | Mon contact peut-il décider ? |
| Need | 0-25 | Le besoin est-il réel et pressant ? |
| Timing | 0-25 | L'échéance est-elle compatible ? |
| **Total** | **0-100** | — |

**Catégories** : A (Excellent, 80+) / B (Bon, 60-79) / C (Moyen, 40-59) / D (Pauvre, <40).

### 5.8 Conversion opportunité → devis (calcul)

Sur le **montant estimé** :

| Étape | Pourcentage | Base de calcul |
|---|---|---|
| Administration | +3 % | Montant estimé |
| Contingences | +12 % | Montant estimé |
| Profit | +15 % | Montant estimé |
| **Sous-total** | — | Montant + admin + contingences + profit |
| TPS | +5 % | Sous-total |
| TVQ | +9,975 % | Sous-total |
| **Total TTC** | — | Sous-total + TPS + TVQ |

### 5.9 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Numéro opportunité | OPP-NNNNN | OPP-00042 |
| Numéro devis | DEV-AAAA-NNN | DEV-2026-001 |
| NEQ | XXXXXXXXXX | 1234567890 |
| Numéro TPS | XXXXXXXXX-RT-NNNN | 123456789RT0001 |
| Numéro TVQ | XXXXXXXXXX TQ NNNN | 1234567890TQ0001 |
| Devise | $ CAD | 15 000,50 $ |
| Date | AAAA-MM-JJ | 2026-04-25 |

### 5.10 Limites

| Élément | Limite |
|---|---|
| Pagination | 20 par défaut, max 100 |
| Timeline | Max 200 entrées |
| Pipeline étapes | 6 (fixe) |
| Score BANT max | 100 |
| Multi-tenant | Données isolées par entreprise |

---

### 5.11 Intégrations avec les autres modules

| Module | Relation | Sens |
|---|---|---|
| Devis | 1:1 via opportunity_id ↔ devis_id | Bidirectionnel après conversion |
| Projets | 1:1 via projet_id | Si l'opportunité devient projet |
| Dossiers | 1:1 via dossier_id | Auto-créé à la création |
| Employés | N:M via assignations | Vendeurs et supports |

### 5.12 Cas particuliers

- **Client absent du CRM** : utiliser « client direct » sur l'opportunité.
- **Contact sans entreprise** : laisser le champ Entreprise vide.
- **Opportunité déjà convertie** : le bouton « Créer devis » disparaît.
- **Suppression entreprise** : contacts/interactions deviennent orphelins (pas de cascade).
- **Suppression opportunité** : devis/projet liés gardent NULL.

### 5.13 Astuces

- **Sélectionner l'entreprise AVANT le contact** : filtre auto les contacts disponibles.
- **Drag-and-drop Kanban** : changement rapide de statut.
- **Saisir une interaction depuis l'opportunité** préserve le lien.
- **Score automatique** : recalculé à chaque consultation, pas de bouton refresh nécessaire.
- **Filtrer la timeline par entreprise** avant une réunion client.

### 5.14 FAQ

**Q : Pourquoi mon opportunité ne s'affiche pas dans le Kanban ?**
R : Vérifier qu'elle n'est pas en statut GAGNÉ ou PERDU. Ces colonnes terminales affichent les totaux mais pas les cartes.

**Q : Puis-je avoir plusieurs devis pour une même opportunité ?**
R : Non, un seul devis principal après conversion. Pour des variantes, dupliquer depuis le module Devis.

**Q : Comment annuler une conversion opportunité → devis ?**
R : Supprimer le devis depuis le module Devis. L'opportunité retrouve son état précédent et le bouton réapparaît.

**Q : Le score BANT est-il visible par tous ?**
R : Oui, par tous les utilisateurs authentifiés du tenant.

**Q : Comment importer en masse des entreprises depuis Excel ?**
R : Pas de fonctionnalité d'import en lot dans cette version.

**Q : Pourquoi mon contact n'apparaît pas dans le sélecteur de l'opportunité ?**
R : Vérifier qu'il est bien rattaché à l'entreprise sélectionnée (filtre par entreprise).

**Q : Quelle différence entre score automatique et score BANT ?**
R : Le score automatique mesure la qualité des données saisies (engagement) ; le BANT évalue la maturité commerciale réelle (qualification).

### 5.15 Limites connues

- Pas d'import/export en lot (Excel ou CSV)
- Pas de RBAC granulaire : tous les utilisateurs voient toutes les opportunités du tenant
- Pas de notifications push pour les rappels d'activité
- Pas d'intégration email automatique (envoi/réception)
- Calendrier interne uniquement, pas de synchronisation Outlook/Google
- Pipeline figé à 6 étapes (non configurable par l'utilisateur)

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module CRM — v1.0 — 2026-04-25*
