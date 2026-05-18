# Manuel utilisateur — Module Dossiers (360)

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (chargés de projet, gestionnaires, équipes terrain)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Liste et détail](#2-interface--liste-et-detail)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Champs, statuts et formats](#4-reference--champs-statuts-et-formats)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Dossiers

Le module **Dossiers (360)** est le **hub documentaire** de votre entreprise. Chaque dossier centralise tout ce qui concerne un projet, une opportunité ou un client : documents, notes terrain, liens utiles, étapes, photos, devis, factures, bons de travail et bons de commande associés.

Le **« 360 »** signifie une vue à 360 degrés du dossier : tout ce qui touche à un mandat est rassemblé en un seul endroit.

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **Dossier** | Numéro auto `DOS-AAAA-NNNNN` (ex: DOS-2026-00001) |
| **Type de dossier** | Construction / Rénovation / Vente / Service / Autre |
| **Statut** | Actif / Archivé / Annulé |
| **Pièces jointes (Attachments)** | Fichiers (PDF, images, documents bureautiques) |
| **Notes** | Observations terrain, comptes rendus, avec catégorisation IA |
| **Liens** | URLs externes avec description (cliquables, vues récente) |
| **Étapes** | Checklist personnalisable (à faire / fait) |
| **Vue 360** | Agrégation : projets, opportunités, devis, factures, BC, BT, employés liés |
| **Partage public** | Lien partageable sans compte (token + mot de passe optionnel) |

### 1.3 Workflow

```
Création (Actif) → Mise à jour continue → Archivé (à la fin du mandat)
                                       ↘
                                         Annulé (abandon)
```

### 1.4 Accès

- **Sidebar** → **Dossiers**
- **URL** : `/dossiers` (liste), `/dossiers/{id}` (détail)
- **Page publique** : `/dossier/public/{token}` (sans authentification)

### 1.5 Permissions

- **Tous les utilisateurs authentifiés** peuvent CRUD
- **Suppression** : possible uniquement par le créateur ou un admin
- **Partage public** : génère un token unique avec mot de passe optionnel

---

## 2. Interface — Liste et détail

### 2.1 Page Dossiers (`/dossiers`)

Layout :

```
+--------------------------------------------------------------+
| [+ Nouveau dossier]   [Recherche...]   [Type v] [Statut v]  |
+--------------------------------------------------------------+
| Numéro       | Titre        | Type     | Statut | Date créa | Lien |
|--------------|--------------|----------|--------|-----------|------|
| DOS-2026-001 | Reno cuisine | Rénov.   | Actif  | 2026-04-15| -→   |
| DOS-2026-002 | Maison Y     | Construct| Actif  | 2026-04-20| -→   |
| DOS-2026-003 | Service AC   | Service  | Archivé| 2025-11-30| -→   |
+--------------------------------------------------------------+
| Pagination + Per-page                                         |
+--------------------------------------------------------------+
```

Colonnes : Numéro, Titre, Type, Statut (badge), Date création, Lien projet (si applicable).

### 2.2 Page Détail Dossier (`/dossiers/{id}`)

Le détail s'organise en **plusieurs onglets** :

```
+--------------------------------------------------------------+
| DOS-2026-001 — Rénovation cuisine ABC Construction           |
| Statut : Actif | Type : Rénovation | Créé : 2026-04-15      |
+--------------------------------------------------------------+
| [Infos] [Notes] [Liens] [Documents] [Étapes] [Vue 360]      |
+--------------------------------------------------------------+
```

#### Onglet Infos
- Titre, Description, Type, Statut
- Client (Entreprise + Contact)
- Adresse chantier
- Dates clés (création, début, fin prévue, clôture)
- Notes générales

#### Onglet Notes
Liste chronologique inverse des notes terrain.

Pour chaque note :
- **Titre, Contenu** (texte libre)
- **Catégorie** (manuelle ou IA)
- **Importance** (score 0-1 par IA, ou priorité manuelle)
- **Pinned** (épinglée en haut)
- **Pièces jointes** (photos, fichiers)
- **Auteur, Date**

Boutons :
- **Ajouter note** (texte simple)
- **Ajouter note avec fichiers** (texte + photos/documents)
- **Catégoriser IA** (via Claude)
- **Analyser photo IA** (OCR + analyse contextuelle)
- **Résumer notes IA** (condense plusieurs notes en synthèse)
- **Épingler / Désépingler**
- **Modifier catégorie**
- **Supprimer**

#### Onglet Liens
Liste des URLs externes utiles au dossier (plans, photos cloud, articles, documentation fournisseur, etc.).

Pour chaque lien :
- **URL** (cliquable)
- **Description**
- **Date d'ajout**

Boutons : **Ajouter lien**, **Modifier**, **Supprimer**.

#### Onglet Documents (Pièces jointes)
Liste des fichiers attachés au dossier directement (hors notes).

Pour chaque fichier :
- **Nom**
- **Type / Extension** (PDF, JPG, DOCX, etc.)
- **Taille**
- **Auteur, Date upload**
- Boutons : **Télécharger**, **Aperçu** (PDF/images), **Supprimer**

#### Onglet Étapes
Checklist personnalisable :
- **Nom de l'étape**
- **Statut** (À faire / Fait)
- **Date de complétion**
- Boutons : Ajouter étape, Toggle (basculer fait/à faire), Supprimer

#### Onglet Vue 360
Agrégation de **toutes les entités liées** au dossier :
- **Projets** (lien direct vers fiche)
- **Opportunités CRM** (avec statut pipeline)
- **Devis** (numéro, statut, montant)
- **Factures** (numéro, statut, solde dû)
- **Bons de Commande** (numéro, fournisseur, statut)
- **Bons de Travail** (numéro, statut, montant)
- **Employés assignés** (avec rôle)
- **Demandes de prix** (formulaires DEMANDE_PRIX)

### 2.3 Modale Création dossier

| Champ | Détail |
|---|---|
| Titre * | Nom du dossier |
| Type * | Construction / Rénovation / Vente / Service / Autre |
| Description | Texte libre |
| Client (Entreprise) | Dropdown CRM |
| Client (Contact) | Dropdown CRM |
| Adresse chantier | Texte |
| Date début | Date |
| Date fin prévue | Date |
| Notes | Texte libre |

### 2.4 Partage public d'un dossier

```
+--------------------------------------------------------------+
| PARTAGER CE DOSSIER                                          |
+--------------------------------------------------------------+
| Lien public : https://constructo.app/dossier/public/abc123   |
| [ Copier le lien ]                                           |
|                                                              |
| Mot de passe (optionnel) : [____________]                    |
|                                                              |
| [ Activer le partage ] [ Désactiver ]                        |
+--------------------------------------------------------------+
```

Le client peut consulter le dossier (lecture seule) sans compte. Optionnellement protégé par mot de passe.

### 2.5 Vue mobile

Cards empilées avec onglets en bas (Infos, Notes, Liens, Docs, 360).

---

## 3. Workflows pas-à-pas

### 3.1 Créer un dossier
1. `/dossiers` → bouton **« + Nouveau dossier »**
2. Saisir Titre (obligatoire) et choisir Type
3. Renseigner Description, Client, Adresse chantier, Dates
4. Cliquer **« Créer »**

> **À savoir** : numéro `DOS-AAAA-NNNNN` généré automatiquement.

### 3.2 Modifier un dossier
1. Ouvrir le dossier → onglet Infos
2. Bouton crayon → modifier
3. Cliquer **« Enregistrer »**

### 3.3 Archiver un dossier
1. Onglet Infos → modifier statut → **Archivé**
2. Le dossier reste accessible mais n'apparaît plus dans la liste active par défaut

### 3.4 Supprimer un dossier
1. Bouton poubelle → confirmer
2. Suppression en cascade : notes, liens, attachments, étapes
3. Réservé au créateur ou administrateur

### 3.5 Ajouter une note simple
1. Onglet Notes → bouton **« + Ajouter note »**
2. Titre, Contenu, Catégorie (optionnelle)
3. Cliquer **« Ajouter »**

### 3.6 Ajouter une note avec fichiers
1. Onglet Notes → bouton **« + Note avec fichiers »**
2. Titre, Contenu, Catégorie
3. Glisser-déposer ou sélectionner des fichiers (photos chantier, documents)
4. Cliquer **« Ajouter »**

### 3.7 Catégoriser une note via l'IA
1. Sur une note → bouton robot **« Catégoriser IA »**
2. L'IA (Claude) attribue catégorie + score d'importance (0-1)
3. Coût : déduit des crédits IA

### 3.8 Analyser une photo via l'IA
1. Note avec photo → bouton **« Analyser photo IA »**
2. L'IA décrit le contenu visuel + détecte anomalies/risques
3. Le résultat est ajouté en commentaire structuré

### 3.9 Résumer plusieurs notes via l'IA
1. Onglet Notes → bouton **« Résumé IA »**
2. L'IA condense les N dernières notes en synthèse
3. Utile pour briefing rapide ou rapport hebdomadaire

### 3.10 Épingler une note
1. Sur une note → icône punaise
2. La note remonte en haut de la liste
3. Re-cliquer pour désépingler

### 3.11 Modifier la catégorie d'une note
1. Sur une note → bouton **« Modifier catégorie »**
2. Saisir la nouvelle catégorie manuelle
3. Sauvegarde immédiate

### 3.12 Supprimer une note
Icône poubelle → confirmer.

### 3.13 Ajouter un lien externe
1. Onglet Liens → bouton **« + Ajouter lien »**
2. Saisir l'URL (validation : doit commencer par http:// ou https://)
3. Description du lien
4. Cliquer **« Ajouter »**

### 3.14 Modifier un lien
1. Icône crayon sur la ligne
2. Modifier URL ou description
3. Sauvegarder

### 3.15 Supprimer un lien
Icône poubelle → confirmer.

### 3.16 Téléverser un document (pièce jointe)
1. Onglet Documents → bouton **« + Ajouter document »**
2. Glisser-déposer ou sélectionner fichier
3. Le fichier est uploadé et apparaît dans la liste

### 3.17 Télécharger un document
Icône téléchargement à côté du fichier.

### 3.18 Prévisualiser un document (PDF/image)
Icône œil → ouverture dans modal d'aperçu.

### 3.19 Supprimer un document
Icône poubelle → confirmer.

### 3.20 Ajouter une étape (checklist)
1. Onglet Étapes → bouton **« + Ajouter étape »**
2. Saisir le nom de l'étape
3. Enregistrer

### 3.21 Marquer une étape comme « Fait »
Cliquer la case à cocher → l'étape passe à « Fait » avec date de complétion.

### 3.22 Supprimer une étape
Icône poubelle → confirmer.

### 3.23 Consulter la Vue 360
Onglet Vue 360 affiche toutes les entités liées (projets, devis, factures, BC, BT, employés). Cliquer sur une ligne pour ouvrir la fiche correspondante.

### 3.24 Activer le partage public
1. Bouton **« Partager »** en haut du dossier
2. Optionnel : saisir un mot de passe
3. Cliquer **« Activer »**
4. Copier le lien généré et le partager (email, SMS)

### 3.25 Désactiver le partage public
Bouton **« Désactiver »** sur le dossier partagé. Le lien devient invalide.

### 3.26 Lier automatiquement un dossier à un projet/opportunité
À la création d'un projet ou opportunité, un dossier peut être créé automatiquement et lié. Vérifier dans la Vue 360 que le lien est bien établi.

### 3.27 Filtrer la liste des dossiers
- Recherche libre (titre, numéro, client)
- Filtre Type
- Filtre Statut

---

## 4. Référence — Champs, statuts et formats

### 4.1 Champs Dossier

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Numéro | Auto | Oui | DOS-AAAA-NNNNN |
| Titre | Texte | Oui | Nom du dossier |
| Type | Énum (5) | Oui | Construction / Rénovation / Vente / Service / Autre |
| Statut | Énum (3) | Oui | Actif / Archivé / Annulé |
| Description | Texte long | Non | Texte libre |
| Client (Entreprise) | FK | Non | Référence companies.id |
| Client (Contact) | FK | Non | Référence contacts.id |
| Adresse chantier | Texte | Non | Adresse |
| Date début | Date | Non | Date début mandat |
| Date fin prévue | Date | Non | Date fin attendue |
| Date clôture | Date | Auto | Date passage à Archivé |
| Notes | Texte | Non | Notes générales |
| Created_at, updated_at | Timestamp | Auto | Horodatage |

### 4.2 Champs Note

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Titre | Texte | Oui | Court titre |
| Contenu | Texte long | Oui | Texte de la note |
| Catégorie | Texte | Non | Libre ou défini par IA |
| Catégorie IA | Texte | Auto | Assignée par IA |
| Importance | Décimal | Auto | Score 0-1 par IA |
| Pinned | Booléen | Non | Épinglée en haut |
| Pièces jointes | Liste | Non | Fichiers liés à la note |
| Auteur | Texte | Auto | Utilisateur connecté |
| Date création | Timestamp | Auto | Horodatage |

### 4.3 Champs Lien

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| URL | URL | Oui | Doit commencer par http:// ou https:// |
| Description | Texte | Non | Description du lien |
| Date ajout | Timestamp | Auto | Horodatage |

### 4.4 Champs Pièce jointe (Attachment)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Nom | Texte | Oui | Nom du fichier |
| MIME type | Texte | Auto | application/pdf, image/jpeg, etc. |
| Taille | Entier | Auto | Octets |
| Storage path | Texte | Auto | Chemin de stockage |
| Auteur | Texte | Auto | Utilisateur upload |
| Date upload | Timestamp | Auto | Horodatage |

### 4.5 Champs Étape

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Nom | Texte | Oui | Description de l'étape |
| Statut | Énum (2) | Oui | À faire / Fait |
| Date complétion | Timestamp | Auto | Quand passé à Fait |
| Ordre | Entier | Auto | Ordre d'affichage |

### 4.6 Statuts Dossier (3)

| Statut | Couleur | Description |
|---|---|---|
| Actif | Vert | En cours |
| Archivé | Gris | Mandat terminé |
| Annulé | Rouge | Abandon |

### 4.7 Types de dossier (5)

| Type | Description |
|---|---|
| Construction | Nouvelle construction |
| Rénovation | Travaux sur bâtiment existant |
| Vente | Transaction immobilière |
| Service | Service ponctuel (entretien, dépannage) |
| Autre | Cas particulier |

### 4.8 Catégories IA pour notes (10)

Identiques au module Projets : Technique, Sécurité, Budget, Planning, Qualité, Communication, Environnement, RH, Approvisionnement, Autre.

### 4.9 Vue 360 — Entités agrégées

| Entité | Source |
|---|---|
| Projets | dossier_projets (many-to-many) |
| Opportunités | opportunities.dossier_id |
| Devis | dossier_devis (many-to-many) |
| Factures | factures.dossier_id |
| Bons de Commande | dossier_achats (many-to-many) |
| Bons de Travail | dossier_formulaires (many-to-many) |
| Demandes de prix | formulaires type DEMANDE_PRIX |
| Employés | dossier_employes (many-to-many) |

### 4.10 Partage public

| Caractéristique | Valeur |
|---|---|
| Format token | 6-120 caractères alphanumériques |
| Validité | Aucune expiration par défaut (configurable) |
| Mot de passe | Optionnel (hashé) |
| Lecture/écriture | **Lecture seule** côté public |
| Désactivable | Oui à tout moment |

### 4.11 Limites système

| Élément | Limite |
|---|---|
| Pagination | 20 par défaut, max 100 |
| Notes par dossier | Pas de limite stricte |
| Pièces jointes | Taille max par fichier : 50 Mo |
| Liens par dossier | Pas de limite |
| Étapes par dossier | Pas de limite |
| Description note | Max 50 000 caractères |

### 4.12 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Numéro dossier | DOS-AAAA-NNNNN | DOS-2026-00001 |
| Token public | Slugifié | renovation-cuisine-abc-2026 |
| Date | AAAA-MM-JJ | 2026-04-25 |

### 4.13 Formats de fichiers supportés (pièces jointes)

PDF, JPG, JPEG, PNG, GIF, WEBP, DOCX, DOC, XLSX, XLS, PPTX, PPT, TXT, CSV, ZIP, DWG (plans).

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module | Relation | Manifestation |
|---|---|---|
| **Projets** | Dossier ↔ Projets (many-to-many) | Vue 360, auto-lien à la création projet |
| **CRM (Opportunités)** | Opportunité.dossier_id | Auto-création dossier à la création opportunité |
| **Devis** | Dossier ↔ Devis (many-to-many) | Vue 360 affiche les devis |
| **Factures** | Facture.dossier_id | Vue 360 affiche les factures |
| **Bons de Commande** | dossier_achats (many-to-many) | Auto-lien si projet → opportunité → dossier |
| **Bons de Travail** | dossier_formulaires (many-to-many) | Auto-lien à la création BT sur le projet |
| **Employés** | dossier_employes (many-to-many) | Assignations avec rôle |
| **IA (Claude)** | Catégorisation, analyse photo, résumé | Boutons sur les notes |
| **Storage** | Fichiers attachments | Stockage local ou cloud |
| **Page publique** | Token + mot de passe | Vue lecture seule sans compte |

### 5.2 Cas particuliers

- **Dossier sans client** : possible (dossier interne, R&D, suivi général)
- **Dossier sans projet** : permis (dossier de prospection, opportunité non concrétisée)
- **Auto-création depuis opportunité** : un dossier est créé automatiquement à la création d'une opportunité (ne pas le re-créer manuellement)
- **Lien automatique BT/BC** : si projet → opportunité → dossier, les BT/BC sont ajoutés automatiquement au dossier
- **Note avec photo XXL** : redimensionnement automatique pour l'affichage, le fichier original est conservé
- **Partage public sans mot de passe** : le lien permet l'accès direct sans authentification — à utiliser avec précaution
- **Suppression cascade** : supprime notes, liens, attachments, étapes mais pas les entités liées (projet, devis, etc.)

### 5.3 Astuces

- **Dossier 360** : ouvrir d'abord le dossier d'un projet pour voir tout le contexte (devis, factures, BC, BT)
- **Notes pinned** : épingler les notes critiques (sécurité, problèmes majeurs) pour qu'elles restent visibles en haut
- **Catégorisation IA** : utile pour trier rapidement les notes par catégorie métier (Sécurité, Budget, Planning)
- **Résumé IA** : générer un résumé hebdomadaire pour briefing client ou équipe
- **Liens** : centraliser tous les liens utiles (Google Drive, plans, fournisseurs) au lieu de les chercher dans les emails
- **Étapes comme checklist** : utiliser pour les vérifications standard (permis obtenus, garanties signées, photos finales prises)
- **Partage public protégé** : ajouter un mot de passe pour les dossiers contenant des infos confidentielles
- **Auto-lien** : laisser les automatismes faire le travail (création opportunité crée le dossier, BT/BC se lient automatiquement)

### 5.4 FAQ

**Q : Quelle est la différence entre Dossier et Projet ?**
R : Un Projet est une entité opérationnelle (chantier avec budget, dates, phases). Un Dossier est un **conteneur documentaire** qui peut regrouper plusieurs projets, ainsi que tous les documents et notes associés. Un projet peut avoir un dossier, mais un dossier peut englober plusieurs projets liés.

**Q : Comment partager un dossier avec un client externe ?**
R : Bouton **« Partager »** → activer le partage → optionnel mot de passe → copier le lien. Le client accède en lecture seule sans compte.

**Q : Le client peut-il commenter sur la page publique ?**
R : Pas dans cette version. La page publique est en lecture seule. Pour les échanges, utiliser le module Emails.

**Q : Combien de fichiers puis-je téléverser par dossier ?**
R : Pas de limite stricte du nombre, mais chaque fichier est limité à 50 Mo.

**Q : Les photos téléversées sont-elles compressées ?**
R : Non, le fichier original est conservé. Un thumbnail est généré pour l'affichage.

**Q : Comment supprimer définitivement un dossier ?**
R : Bouton poubelle. Suppression en cascade des notes, liens, attachments, étapes. Les entités liées (projets, devis, factures) ne sont pas supprimées.

**Q : Puis-je restaurer un dossier supprimé ?**
R : Non dans cette version. Préférer l'archivage (statut Archivé) plutôt que la suppression.

**Q : Le partage public expire-t-il ?**
R : Non par défaut. Désactiver manuellement quand le partage n'est plus nécessaire.

**Q : Comment l'IA catégorise-t-elle une note ?**
R : Via Claude, selon 10 catégories métier construction (Technique, Sécurité, Budget, etc.). Score d'importance 0-1 attribué.

**Q : Puis-je désactiver les fonctions IA ?**
R : Pas de désactivation au niveau dossier. Les fonctions IA ne se déclenchent que si l'utilisateur clique sur le bouton dédié.

**Q : Comment voir tous les dossiers d'un client ?**
R : Page Dossiers → recherche par nom de client. Filtre par client à venir.

**Q : Le module supporte-t-il OCR sur les documents scannés ?**
R : Pour les images via le bouton **« Analyser photo IA »**. Pas d'OCR automatique au téléversement.

### 5.5 Limites connues

- Pas de versioning des fichiers (workaround : nommage versionné)
- Pas de commentaires côté public
- Pas de workflow d'approbation sur les notes
- Pas de gestion des permissions par utilisateur (tous les membres du tenant ont le même accès)
- Pas d'export complet du dossier en PDF unique
- Pas de notifications sur ajout de note ou étape
- Pas d'import/export en lot
- Limite 50 Mo par fichier (configurable côté serveur)
- Catégorisation IA déduit des crédits IA

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Dossiers (360) — v1.0 — 2026-04-25*
