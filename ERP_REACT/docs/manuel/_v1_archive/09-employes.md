# Manuel utilisateur — Module Employés / RH / Pointage

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (RH, gestionnaires, contremaîtres, employés)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Employés et Pointage](#2-interface--employes-et-pointage)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Champs, statuts et calculs](#4-reference--champs-statuts-et-calculs)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module

Le module **Employés / RH / Pointage** centralise la gestion des ressources humaines et du temps de travail :

- **Fiches employés** (identité, poste, taux, qualifications, certifications)
- **Pointage des heures** (punch in / punch out par projet ou bon de travail)
- **Calcul automatique** des heures travaillées, supplémentaires, totaux
- **Validation hiérarchique** des feuilles de temps
- **Rapport hebdomadaire** par employé
- **Coûts main-d'œuvre par projet** (alimente Finances)
- **Paie (Payroll)** : génération des fiches de paie, déductions, exports

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **Employé** | Personne physique de l'entreprise |
| **Time Entry (Pointage)** | Entrée d'heure : punch_in, punch_out, durée, projet, BT |
| **Validation** | État Validé / Non validé (par superviseur) |
| **Heures supplémentaires** | Au-delà du seuil hebdo (40h défaut) |
| **Taux horaire** | Coût $/h pour calcul main-d'œuvre |
| **Salaire** | Salaire annuel pour calcul mensuel |
| **Qualifications** | RBQ, CCQ, sécurité chantier, etc. |
| **Statut emploi** | Actif / Inactif |

### 1.3 Workflow de pointage

```
Punch in → Travail → Punch out → Validation → Calcul paie
```

### 1.4 Accès

- **Sidebar** → **Employés** (gestion des fiches) et **Pointage** (heures)
- **URL** : `/employees`, `/pointage`

### 1.5 Permissions

- **Tous les utilisateurs authentifiés** : consulter, pointer leurs propres heures
- **Superviseurs/Admins** : valider les heures, modifier les fiches employés, accéder aux rapports
- **Employés** : voir leur propre fiche et leurs propres pointages

---

## 2. Interface — Employés et Pointage

### 2.1 Page Employés (`/employees`)

Layout :
```
+---------------------------------------------------------------+
| [+ Nouvel employé]  [Recherche...]  [Statut v] [Poste v]     |
+---------------------------------------------------------------+
| Nom complet  | Poste        | Téléphone | Salaire | Statut |  |
|--------------|--------------|-----------|---------|--------|  |
| Jean Tremblay| Charpentier  | 514-555-..| 25,00$/h| Actif  |  |
| Marie Côté   | Estimatrice  | 438-...   | 65 000$/an| Actif|  |
+---------------------------------------------------------------+
```

Colonnes : Nom, Poste, Téléphone, Salaire (taux ou annuel), Statut. Édition inline pour certains champs.

### 2.2 Modale Création employé

| Section | Champs |
|---|---|
| Identité | Prénom*, Nom*, Date naissance, NAS (Numéro Assurance Sociale) |
| Coordonnées | Email, Téléphone, Mobile, Adresse complète |
| Emploi | Poste*, Date embauche, Date départ (si applicable), Statut (Actif/Inactif), Département |
| Rémunération | Type (Taux horaire / Salaire annuel), Montant |
| Qualifications | RBQ, CCQ, Carte sécurité ASP Construction, Permis conduire (classes), Diplômes |
| Banque | Institution, Transit, Folio (pour dépôt direct paie) |
| Notes | Texte libre |

### 2.3 Détail Employé

Onglets :
- **Infos** (identité + emploi)
- **Pointage** (historique des time entries)
- **Paie** (fiches de paie, totaux)
- **Projets** (assignations historiques + actuelles)
- **Documents** (CV, certificats, contrats)
- **Notes** (commentaires RH)

### 2.4 Page Pointage (`/pointage`)

Layout principal :
```
+---------------------------------------------------------------+
| [Punch IN] [Punch OUT]   Projet: [v]   BT: [v]               |
+---------------------------------------------------------------+
| Aujourd'hui : 7h 32min | Cette semaine : 38h 15min            |
+---------------------------------------------------------------+
| Heure début | Heure fin | Durée | Projet | BT     | Validé    |
| 07:30       | 12:00     | 4h30  | P-42   | BT-12  | ✓         |
| 13:00       | 16:32     | 3h32  | P-42   | BT-12  | ✓         |
+---------------------------------------------------------------+
```

### 2.5 Boutons Punch In / Out

- **Punch IN** : bouton vert, démarre une session
- **Sélecteur Projet** + **Sélecteur BT** (optionnel)
- **Notes** (optionnel, ex: « Travaux dalle nord »)
- **Punch OUT** : bouton rouge, ferme la session
- Calcul automatique de la durée

### 2.6 Vue Hebdomadaire

```
+----------------------------------------------------------+
| Semaine du 21 au 27 avril 2026                           |
+------+------+------+------+------+------+------+--------+
| Lun  | Mar  | Mer  | Jeu  | Ven  | Sam  | Dim  | Total  |
+------+------+------+------+------+------+------+--------+
| 8h   | 8h   | 8h   | 8h   | 6h   | 0h   | 0h   | 38h    |
+------+------+------+------+------+------+------+--------+
```

Tableau jour par jour avec totaux. Détail par projet en bas.

### 2.7 Vue Mensuelle (Rapport paie)

Liste des employés avec :
- Heures normales
- Heures supplémentaires (>40h/semaine)
- Taux horaire / Salaire
- Coût total
- Statut validation

### 2.8 Bouton Validation (Superviseur)

Pour chaque pointage : icône ✓ pour valider. Une fois validé, le pointage est verrouillé (modification bloquée).

### 2.9 Vue mobile

Punch In / Out adapté tactile, gros boutons, sélecteur projet/BT en accordéon.

---

## 3. Workflows pas-à-pas

### 3.1 Créer une fiche employé
1. `/employees` → bouton **« + Nouvel employé »**
2. Saisir Identité (Prénom*, Nom*, NAS, date naissance)
3. Coordonnées (Email, Téléphone, Adresse)
4. Emploi (Poste*, Date embauche, Statut Actif)
5. Choisir Type rémunération (Taux horaire OU Salaire annuel)
6. Saisir le montant
7. Saisir Qualifications (RBQ, CCQ, ASP, etc.)
8. Saisir Infos bancaires (pour dépôt direct paie)
9. Cliquer **« Créer »**

### 3.2 Modifier une fiche employé
1. Cliquer sur l'employé → onglet Infos
2. Bouton crayon → modifier
3. Cliquer **« Enregistrer »**

### 3.3 Désactiver un employé (départ)
1. Édition → Statut → **Inactif**
2. Renseigner Date de départ
3. L'employé n'apparaît plus dans les sélecteurs mais reste en base

### 3.4 Pointer une session (Punch In)
1. `/pointage` → sélectionner Projet (et BT optionnel)
2. (Optionnel) saisir Notes
3. Cliquer **« Punch IN »**
4. Le chronomètre démarre

### 3.5 Terminer une session (Punch Out)
1. Cliquer **« Punch OUT »**
2. La durée est calculée automatiquement
3. Le pointage est sauvegardé en base
4. Statut : Non validé (en attente de validation superviseur)

### 3.6 Saisir une session manuellement
1. Bouton **« + Ajouter pointage »**
2. Saisir Date, Heure début, Heure fin
3. Choisir Projet et BT
4. Notes optionnelles
5. Cliquer **« Enregistrer »**

> **À savoir** : utile pour saisir les heures oubliées après coup.

### 3.7 Modifier une session
1. Cliquer sur la session
2. Modifier Date/Heures/Projet/BT
3. Cliquer **« Enregistrer »**

> **Important** : les pointages **validés** ne sont plus modifiables. Demander au superviseur d'invalider d'abord.

### 3.8 Supprimer une session
Icône poubelle → confirmer. Possible uniquement si non validé.

### 3.9 Valider un pointage (Superviseur)
1. Vue Pointage → liste des sessions à valider
2. Cliquer ✓ à côté de la ligne
3. Le pointage est validé et verrouillé
4. Les heures comptent dans la paie et le coût main-d'œuvre

### 3.10 Invalider un pointage (Superviseur)
Icône X (rétrograder validation) → le pointage redevient modifiable par l'employé.

### 3.11 Consulter le rapport hebdomadaire
1. `/pointage` → onglet **Vue hebdomadaire**
2. Choisir la semaine
3. Tableau jour par jour avec totaux
4. Filtre par employé (superviseur uniquement)

### 3.12 Consulter le rapport mensuel pour la paie
1. `/pointage` → onglet **Rapport paie**
2. Choisir le mois
3. Liste des employés avec heures normales / supplémentaires / coût total

### 3.13 Exporter les heures en CSV
1. Vue hebdomadaire ou mensuelle → bouton **« Exporter CSV »**
2. Téléchargement automatique
3. Importable dans Excel ou logiciel de paie

### 3.14 Voir les heures par projet
1. `/pointage` → onglet **Par projet**
2. Liste des projets avec heures totales pointées
3. Détail par employé pour chaque projet

### 3.15 Assigner un employé à un projet (Bons de Travail)
Voir manuel **Bons de Travail** section 3.10.

### 3.16 Calculer la paie d'un employé pour la période
1. `/pointage` → **Rapport paie** → filtrer par période et employé
2. Heures normales × taux + heures sup × (taux × 1.5)
3. Déductions (impôt, assurance emploi, RRQ, RQAP, syndicat)
4. Net à payer
5. Générer fiche de paie (module Payroll)

### 3.17 Générer une fiche de paie
1. Module **Paie (Payroll)** → bouton **« + Générer fiche »**
2. Sélectionner Employé et Période
3. Le système calcule brut, déductions, net
4. Vérifier et valider
5. Imprimer ou envoyer par email à l'employé

### 3.18 Configurer les déductions par employé
1. Fiche employé → onglet Paie → **« Déductions »**
2. Saisir % impôt fédéral, % impôt provincial, % autres
3. Sauvegarder

### 3.19 Filtrer la liste des employés
- Recherche libre (nom, email, téléphone)
- Filtre Statut (Actif / Inactif)
- Filtre Poste

### 3.20 Documents employé (contrats, certificats)
1. Fiche employé → onglet Documents
2. Bouton **« + Ajouter document »**
3. Glisser-déposer ou sélectionner fichier
4. Catégoriser (Contrat, Certificat, Diplôme, Autre)

---

## 4. Référence — Champs, statuts et calculs

### 4.1 Champs Employé

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Prénom | Texte | Oui | Prénom |
| Nom | Texte | Oui | Nom de famille |
| Email | Courriel | Non | Adresse pro |
| Téléphone, Mobile | Texte | Non | Coordonnées |
| Adresse, Ville, Province, Code postal | Texte | Non | Coordonnées |
| Date naissance | Date | Non | Pour calculs RH |
| NAS | Texte | Non | Numéro Assurance Sociale (sensible) |
| Poste | Texte | Oui | Titre fonction |
| Département | Texte | Non | Service |
| Date embauche | Date | Non | Date d'entrée en fonction |
| Date départ | Date | Non | Si applicable |
| Statut | Énum (2) | Oui | Actif / Inactif (défaut Actif) |
| Type rémunération | Énum (2) | Oui | Taux horaire / Salaire annuel |
| Taux horaire | Décimal | Conditionnel | $/h |
| Salaire annuel | Décimal | Conditionnel | $/an |
| Qualifications | Liste | Non | RBQ, CCQ, ASP, etc. |
| Banque, Transit, Folio | Texte | Non | Pour dépôt direct |
| Notes | Texte | Non | Texte libre |
| Photo | URL | Non | Photo de profil |

### 4.2 Champs Time Entry (Pointage)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Employee_id | FK | Oui | Référence employees.id |
| Project_id | FK | Non | Référence projects.id |
| BT_id | FK | Non | Référence formulaires.id |
| Punch_in | Timestamp | Oui | Heure début |
| Punch_out | Timestamp | Non | Heure fin (NULL si en cours) |
| Total_hours | Décimal | Auto | Calculé (punch_out − punch_in) |
| Notes | Texte | Non | Description tâche |
| Validated | Booléen | Oui | Validation superviseur (défaut false) |
| Validated_by | Texte | Auto | Nom validateur |
| Validated_at | Timestamp | Auto | Date validation |

### 4.3 Champs Fiche de paie (Payroll)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Employee_id | FK | Oui | Référence employees.id |
| Période début, fin | Date | Oui | Période de paie |
| Heures normales | Décimal | Auto | Σ heures pointées (≤ 40h/semaine) |
| Heures sup | Décimal | Auto | Σ heures > 40h |
| Brut | Décimal | Auto | Heures × taux + sup × (taux × 1.5) |
| Impôt fédéral | Décimal | Auto | % configuré |
| Impôt provincial | Décimal | Auto | % configuré |
| RRQ | Décimal | Auto | Régime des rentes du Québec |
| AE | Décimal | Auto | Assurance-emploi |
| RQAP | Décimal | Auto | Régime québécois assurance parentale |
| Syndicat | Décimal | Non | Cotisations CCQ ou autres |
| Net | Décimal | Auto | Brut − déductions |
| Statut | Énum | Oui | Brouillon / Émise / Payée |

### 4.4 Statuts Employé (2)

| Statut | Description |
|---|---|
| Actif | En fonction |
| Inactif | Départ, congé prolongé |

### 4.5 Statuts Pointage (2)

| Statut | Description |
|---|---|
| Non validé | En attente validation |
| Validé | Verrouillé, compte dans la paie |

### 4.6 Calculs

#### Total heures d'un pointage
```
total_hours = (punch_out - punch_in) en heures décimales
```

#### Heures supplémentaires (semaine)
```
heures_normales = MIN(heures_semaine, 40)
heures_sup = MAX(heures_semaine - 40, 0)
```

#### Brut
```
brut = (heures_normales × taux) + (heures_sup × taux × 1.5)
```

Pour les salariés annuels :
```
brut_periode = (salaire_annuel / 26) si paie aux 2 semaines
              ou (salaire_annuel / 52) si hebdo
```

#### Coût main-d'œuvre par projet
```
cout_mo_projet = SUM(time_entries.total_hours × employee.taux_horaire)
                FROM time_entries
                JOIN employees ON time_entries.employee_id = employees.id
                WHERE project_id = ? AND validated = true
```

### 4.7 Déductions typiques (Québec 2026)

| Déduction | Taux indicatif |
|---|---|
| Impôt fédéral | Variable (selon barème) |
| Impôt provincial | Variable (selon barème QC) |
| RRQ (Régime des rentes du Québec) | 6,40 % |
| AE (Assurance-emploi) | 1,32 % |
| RQAP (Régime québécois assurance parentale) | 0,494 % |
| Syndicat CCQ | Variable selon métier |

### 4.8 Qualifications typiques au Québec

- **RBQ** : Régie du bâtiment du Québec (licence entrepreneur)
- **CCQ** : Commission de la construction du Québec (cartes de métier)
- **ASP Construction** : Carte de sécurité chantier (obligatoire)
- **Permis de conduire** : Classes 1 (camion lourd), 3 (camion), 5 (auto)
- **Diplômes** : DEP, AEP, DEC, Bac selon métier

### 4.9 Limites système

| Élément | Limite |
|---|---|
| Pagination | 20 par défaut, max 100 |
| Pointages par employé | Pas de limite |
| Documents par employé | Taille max 50 Mo / fichier |
| Heures max par session | 24h (anomalie si > 16h) |

### 4.10 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Taux horaire | $/h | 25,00 $/h |
| Salaire annuel | $/an | 65 000 $/an |
| Heures | XXh XXmin | 7h 32min |
| Date | AAAA-MM-JJ | 2026-04-25 |
| Heure | HH:MM | 13:45 |

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module | Relation | Manifestation |
|---|---|---|
| **Projets** | Pointage par projet | Coût main-d'œuvre alimente Finances projet |
| **Bons de Travail** | Pointage par BT | Heures réelles agrégées sur les opérations |
| **Bons de Commande** | Pas de lien direct | (sauf via projet) |
| **Comptabilité** | Charges salariales | Sync auto vers grand livre |
| **Paie (Payroll)** | Génération fiches de paie | Déductions, dépôt direct |
| **Dossiers** | Employés assignés à un dossier | Vue 360 |
| **Suivi (Gantt)** | Assignation employé sur tâches | Affichage dans le Gantt |

### 5.2 Cas particuliers

- **Employé sans pointage** : possible (cadres, salariés annuels)
- **Pointage sans projet** : permis (formation, réunion, congé)
- **Punch IN sans Punch OUT** : session ouverte. Sera fermée automatiquement à minuit avec alerte
- **Heures > 16h** : alerte automatique (anomalie probable)
- **Pointage rétroactif** : possible mais à éviter (préférer la saisie manuelle structurée)
- **Validation après paiement** : impossible (intégrité paie)
- **Modification taux horaire en cours de période** : ne s'applique qu'aux pointages futurs

### 5.3 Astuces

- **Pointage mobile** : encourager les équipes terrain à utiliser l'app mobile pour le punch in/out en temps réel
- **Validation hebdomadaire** : les superviseurs valident chaque vendredi pour la paie du lundi
- **Notes pertinentes** : indiquer la tâche précise dans les notes (utile pour la facturation client)
- **Export CSV** : utiliser pour audit ou import dans logiciel de paie externe (Nethris, Employeur D)
- **Qualifications à jour** : vérifier les dates d'expiration ASP Construction (renouvellement 5 ans)
- **Coûts MO par projet** : consulter régulièrement pour ajuster les estimations futures
- **Dépôt direct** : remplir Banque/Transit/Folio à la création pour automatiser la paie

### 5.4 FAQ

**Q : Un employé peut-il pointer sur plusieurs projets dans une journée ?**
R : Oui. Faire Punch OUT sur le projet A, puis Punch IN sur le projet B.

**Q : Comment gérer les heures de transport entre chantiers ?**
R : Créer un pointage avec Notes « Transport » et lier au projet de destination (ou projet général « Transport »).

**Q : Que se passe-t-il si j'oublie de Punch Out ?**
R : La session est fermée automatiquement à minuit avec une alerte. Modifier manuellement l'heure de fin le lendemain.

**Q : Les heures supplémentaires sont-elles calculées automatiquement ?**
R : Oui, à 1.5× au-delà de 40h/semaine. Configurable selon convention collective.

**Q : Puis-je consulter les heures d'un autre employé ?**
R : Uniquement si vous êtes superviseur ou administrateur. Les employés voient leurs propres heures.

**Q : Comment exporter pour mon logiciel de paie externe ?**
R : Bouton « Exporter CSV » dans le rapport mensuel. Format compatible avec la plupart des logiciels de paie québécois.

**Q : Le module gère-t-il les vacances et congés ?**
R : Pas de module dédié dans cette version. Saisir manuellement comme pointages avec Notes « Vacances » ou « Congé maladie ».

**Q : Les certifications expirées sont-elles signalées ?**
R : Affichage en rouge dans la fiche employé. Pas d'alerte automatique par email dans cette version.

**Q : Puis-je restreindre le pointage à un projet spécifique ?**
R : Pas de restriction stricte côté UI. Convention interne.

**Q : Les fiches de paie sont-elles conformes Revenu Québec ?**
R : Le calcul des déductions est correct. Pour la conformité totale (T4/Relevé 1), utiliser un logiciel de paie certifié pour la déclaration annuelle.

**Q : Comment gérer les avances sur salaire ?**
R : Pas de fonction native. Créer une déduction négative sur la paie suivante avec note explicative.

### 5.5 Limites connues

- Pas de gestion des vacances/congés en tant qu'objet distinct
- Pas d'alertes email pour expiration certifications
- Pas d'intégration directe avec banques pour dépôt direct (export manuel)
- Pas de geofencing automatique du pointage (vérification position chantier)
- Pas de génération T4 / Relevé 1 (utiliser logiciel de paie spécialisé)
- Pas de gestion des avances sur salaire native
- Heures supplémentaires fixes (1.5× au-delà de 40h) — configurable mais pas par employé
- Pas de gestion des shifts ou rotations complexes
- NAS stocké en clair (à chiffrer en production sensible)

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Employés / RH / Pointage — v1.0 — 2026-04-25*
