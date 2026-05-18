# Module 09 — Projets

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/projects.py` (1606 lignes, 21 endpoints), `frontend/src/pages/ProjectsPage.tsx`
> **Tables PostgreSQL** : `projects`, `project_phases`, `project_notes`, `project_assignments`, `dossier_projets` (lien) ; agregats lecture seule depuis `devis`, `factures`, `bons_commande`, `time_entries`, `companies`
> **Cadrage** : ce module est un **suivi operationnel et financier des chantiers** (CRUD projets, phases, notes, assignations, KPI, Gantt, finances agregees, IA categorisation notes). Il **ne fait pas** de gestion immobiliere de promotion (cf. Module 11), ni d ordonnancement avance (pas de critical path), ni de pointage temps direct (utilise `time_entries` en lecture seule).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble-et-acces)
2. [Interface](#2-interface)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Projets

Le module **Projets** d'ERP Constructo permet à un chef de projet de centraliser le suivi opérationnel et financier de chacun de ses chantiers de construction :

- Tenir une **liste paginée** des projets avec recherche et filtres par statut/priorité.
- **Créer**, **modifier**, **dupliquer** et **supprimer** un projet.
- Suivre des **statistiques** globales (KPI) : total, en cours, terminés, budget total.
- **Gérer des phases** par projet (création, mise à jour, suivi de progression).
- **Assigner des employés** à un projet avec un rôle.
- **Tenir des notes** par projet et les **catégoriser par IA** (Claude) selon une grille construction.
- Consulter une **synthèse financière** par projet (devis acceptés, factures, BC, main-doeuvre, marge).
- **Naviguer** vers le Dossier 360 lié.
- Voir la **soumission liée** (devis) avec ajustement multiplicateur d affaires.
- **Exporter** la liste complète au format CSV.
- Effectuer une **mise à jour en lot** (statut ou priorité) sur plusieurs projets sélectionnés.
- Récupérer un jeu de données **Gantt** pour affichage chronologique.

### 1.2 Accès et prérequis

- Authentifié (`Depends(get_current_user)`).
- Contexte tenant (`user.schema`). Sans tenant : `400 Contexte tenant manquant`.
- Pour la **catégorisation IA** : `ANTHROPIC_API_KEY` configurée, garde-fou IA OK, crédits IA suffisants. Sinon : 503 / 403 / 402.

### 1.3 Endpoints

| Méthode | URL | Fonction |
|---|---|---|
| GET | `/projects` | Liste paginée avec filtres |
| GET | `/projects/statistics` | Stats globales (KPI) |
| POST | `/projects/duplicate/{project_id}` | Dupliquer un projet |
| GET | `/projects/export-csv` | Export CSV |
| POST | `/projects/batch-update` | Mise à jour en lot |
| GET | `/projects/gantt` | Données Gantt |
| GET | `/projects/{project_id}` | Détail dun projet |
| GET | `/projects/{project_id}/financials` | Synthèse financière |
| POST | `/projects` | Créer un projet |
| PUT | `/projects/{project_id}` | Modifier un projet |
| DELETE | `/projects/{project_id}` | Supprimer un projet |
| GET | `/projects/{project_id}/dossier` | Dossier 360 lié |
| POST | `/projects/{project_id}/phases` | Créer une phase |
| PUT | `/projects/{project_id}/phases/{phase_id}` | Modifier une phase |
| GET | `/projects/{project_id}/notes` | Lister les notes |
| POST | `/projects/{project_id}/notes` | Créer une note |
| POST | `/projects/{project_id}/notes/{note_id}/categorize` | Catégoriser par IA |
| GET | `/projects/{project_id}/assignments` | Lister les assignations |
| POST | `/projects/{project_id}/assignments` | Assigner un employé |
| DELETE | `/projects/{project_id}/assignments/{assignment_id}` | Retirer une assignation |

> Aucun endpoint **DELETE** nexiste pour les phases ni les notes.

---

## 2. Interface

### 2.1 Schéma général

```
+----------------------------------------------------------------------+
|  Projets                                                              |
+----------------------------------------------------------------------+
|  [Total] [En cours] [Terminés] [Budget total]  <-- 4 cartes KPI      |
+----------------------------------------------------------------------+
| [ Liste ] [ Tableau ] [ Cartes ]   <-- Sélecteur mode daffichage     |
+----------------------------------------------------------------------+
| (visible si N projets cochés)                                         |
| ☑ N projet(s) sélectionné(s) [Changer statut...] [Désélectionner]   |
+----------------------------------------------------------------------+
| CommandBar : [+ Nouveau projet] [Exporter CSV]                       |
|                          [Recherche...] [Statut: Tous v]              |
+----------------------------------------------------------------------+
| ZONE LISTE (gauche, 100% ou 55% si détail ouvert)                    |
| Mode Liste : Nom | Client | Budget | Statut | Priorité | Début | Fin |
+----------------------------------------------------------------------+
| ZONE DÉTAIL (droite, 45%, si projet sélectionné)                     |
| Nom + badges + actions [Copy][Pencil][×]                             |
| [Voir Dossier 360], Client, Budget, Description, Adresse, Dates      |
| Phases (N) avec progression %                                         |
| Soumission NUMERO (si devis lié)                                     |
| Finances [Afficher/Masquer] : Revenus/Dépenses/Marge/Budget          |
| Notes (N) [+ Ajouter]                                                 |
+----------------------------------------------------------------------+
```

### 2.2 Modes daffichage

- **Liste** : 7 colonnes + sélection + actions. Édition inline des dates.
- **Tableau** : 10 colonnes (vue compacte).
- **Cartes** : grille 1/2/3 colonnes selon largeur écran.

### 2.3 Modale Nouveau projet (taille xl, 2 colonnes)

| Gauche | Droite |
|---|---|
| Nom du projet * | Début prévu / Fin prévue |
| No. PO Client | Budget ($) |
| Client (Entreprise) | Adresse chantier / Ville |
| Client (Personne) | Description (textarea) |
| Saisie manuelle | |
| Statut / Priorité | |

### 2.4 Modale Modifier le projet

Champs : Nom*, Description, Statut, Priorité, Dates, Budget, Adresse, Ville, Gestionnaire, Notes.

> ⚠️ **Limitation** : Gestionnaire et Notes sont visibles dans la modale mais **rejetés** par la liste blanche `ALLOWED` du backend.

### 2.5 Modale Ajouter note

Titre*, Contenu*, Catégorie (optionnel).

### 2.6 Bandeau dactions par lot

Visible si ≥ 1 projet coché. Dropdown 5 statuts : En attente, En cours, Terminé, Annulé, Suspendu.

---

## 3. Workflows pas-à-pas

### 3.1 Créer un projet
1. Bouton **+ Nouveau projet**.
2. Saisir Nom (obligatoire, non vide).
3. Choisir Client (Entreprise OU Saisie manuelle).
4. Renseigner PO Client, Statut, Priorité, Dates, Budget, Adresse, Description.
5. Cliquer **Créer**.

> ⚠️ Les champs **PO Client**, **Client (Personne)** et **Saisie manuelle** sont envoyés mais **non insérés** par le backend (silencieusement ignorés).

### 3.2 Rechercher / filtrer
- Recherche : sur `nom_projet` et `description` (insensible à la casse).
- Filtre statut : Tous, En attente, En cours, Terminé, Annulé. **Suspendu nest pas** dans le filtre.

### 3.3 Changer de mode daffichage
Cliquer Liste / Tableau / Cartes.

### 3.4 Sélectionner un projet
Clic sur ligne → panneau détail (notes, dossier, devis lié chargés en parallèle).

### 3.5 Modifier un projet
Bouton crayon → modale → modifier → Enregistrer.

> ⚠️ Gestionnaire et Notes ne sont pas persistés (whitelist ALLOWED).

### 3.6 Édition inline des dates
Cliquer sur cellule date → input date → onChange = PUT immédiat.

### 3.7 Dupliquer un projet
Icône **Copy** → nouveau projet « Copie de » + nom, statut « En attente », tous autres champs reproduits.

### 3.8 Supprimer un projet
Icône poubelle → confirmation → suppression cascade (24 tables) + détachement (9 tables).
> Refus si statut = `Termine`.

### 3.9 Mise à jour en lot
Cocher projets → bandeau → Changer statut → POST batch-update.

### 3.10 Exporter CSV
Bouton **Exporter CSV** → `projets_export.csv` (15 colonnes incluant ID, Numéro, Nom, Statut, Priorité, Type, Client, Début, Fin, Budget, Description, Adresse, Ville, Notes [= description dupliquée], Cree le, Modifie le).

### 3.11 Ajouter une phase (via API uniquement)
Pas de bouton UI. Endpoint `POST /projects/{id}/phases` avec nom*, description, ordre, statut, dates.

### 3.12 Assigner un employé (via API uniquement)
`POST /projects/{id}/assignments` avec employee_id et role_projet. 409 si doublon.

### 3.13 Naviguer vers Dossier 360
Bouton bleu **« Voir le Dossier 360 »** → `/dossier/{dossier_id}`.

### 3.14 Consulter Finances
Section Finances → **Afficher** → 4 KPIs (Revenus, Dépenses, Marge, Budget) + détails.

### 3.15 Ajouter une note
Section Notes → **+ Ajouter** → Titre*, Contenu*, Catégorie → Ajouter.

### 3.16 Catégoriser une note par IA
Bouton **Bot Catégoriser IA** → POST categorize → Claude `claude-opus-4-7`. 10 catégories : Technique, Securite, Budget, Planning, Qualite, Communication, Environnement, RH, Approvisionnement, Autre. Coût IA déduit.

---

## 4. Référence

### 4.1 Champs Nouveau projet (persistance)

| Champ UI | Persisté |
|---|---|
| Nom du projet | Oui |
| No. PO Client | **Non (ignoré)** |
| Client (Entreprise) | Oui |
| Client (Personne) | **Non (ignoré)** |
| Saisie manuelle | **Non (ignoré)** |
| Statut, Priorité | Oui |
| Début, Fin, Budget | Oui |
| Adresse, Ville, Description | Oui |

### 4.2 Champs Modifier le projet

Whitelist backend : `nom_projet, statut, priorite, description, date_debut_reel, date_fin_reel, budget_total, adresse_chantier, ville_chantier`.
**Gestionnaire et Notes : non persistés.**

### 4.3 Statuts (5)

| Code | Affichage | Couleur |
|---|---|---|
| En attente | En attente | Jaune |
| En cours | En cours | Bleu |
| Termine | Terminé | Vert |
| Annule | Annulé | Rouge |
| Suspendu | (filtre absent) | Ambre |

### 4.4 Priorités (4)

Basse, Moyenne, Haute, Urgente. Badge gris.

### 4.5 Calculs

#### Stats globales
- total = SUM(COUNT par statut)
- en_cours = COUNT WHERE statut = En cours
- termines = COUNT WHERE statut = Termine
- budget_total = SUM(budget_total)

#### Financials
- devis.total = SUM montants devis acceptés
- factures.total = SUM montants factures non annulées
- factures.paye = SUM montant_paye
- materiaux.total = SUM BC actifs
- main_oeuvre.total = SUM (heures × taux_horaire)
- revenus.total = factures.total (devis non comptés)
- depenses.total = materiaux + main_oeuvre
- marge = revenus − depenses
- marge_pct = marge / revenus × 100 (0 si revenus ≤ 0)

#### Progression Gantt
`progression = ROUND(Σ phase_progressions / nb_phases, 1)` ou 0.

#### Multiplicateur soumission liée
`mf = 1 + ((administrationPct ?? 3) + (contingencesPct ?? 12) + (profitPct ?? 15)) / 100`

### 4.6 Limites

| Élément | Limite |
|---|---|
| Pagination | 1-100 (défaut 20) |
| Recherche | LIKE %terme% sur nom + description |
| Gantt | LIMIT 500, exclut Annule |
| Catégorisation IA | Max 31 500 tokens, claude-opus-4-7 |

### 4.7 Codes derreur

| Code | Message |
|---|---|
| 400 | Contexte tenant manquant / Aucun champ / Impossible de supprimer un projet termine |
| 402 | Credits IA epuises |
| 403 | Acces IA refuse |
| 404 | Entité non trouvée |
| 409 | Employé déjà assigné |
| 503 | Service IA non disponible |

---

## 5. Intégrations & FAQ

### 5.1 Intégrations
- **Companies (CRM)** : peuple Client (Entreprise/Personne) à la création.
- **Devis** : `devisId` → affiche soumission liée + ajustement marges.
- **Dossier 360** : table `dossier_projets` → bouton « Voir le Dossier 360 ».
- **Factures, BC, Time entries** : agrégés en synthèse financière.
- **Calendrier** : `?open=ID` ouvre projet via URL.
- **Suppression cascade** : 24 tables delete + 9 tables SET NULL.

### 5.2 Cas particuliers
- Migration paresseuse `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` mémoïsée par tenant.
- Séquence `projects_id_seq` resynchronisée si désynchronisée.
- Tables auxiliaires créées via `CREATE TABLE IF NOT EXISTS`.

### 5.3 FAQ

**Q : Pourquoi Suspendu napparaît pas dans le filtre ?**
R : Le filtre nexpose que 5 valeurs (Tous, En attente, En cours, Terminé, Annulé). Suspendu est accepté ailleurs.

**Q : Pourquoi Gestionnaire/Notes ne sont pas sauvegardés ?**
R : Ils ne sont pas dans la whitelist ALLOWED du backend.

**Q : Comment supprimer une phase ou note ?**
R : Aucun endpoint DELETE. Modifier le statut via PUT (phases) ou en BD direct.

**Q : Pourquoi un projet « Terminé » ne peut être supprimé ?**
R : Garde-fou métier (statut == termine insensible à la casse → 400).

**Q : Les devis acceptés comptent-ils dans Revenus ?**
R : Non. revenus.total = factures.total uniquement.

**Q : Quel format CSV ?**
R : UTF-8, séparateur virgule, `projets_export.csv`. Colonne « Notes » = duplicata de description.

---

## 6. Recap one-pager

| Element | Detail |
|---------|--------|
| **Mission** | Suivi operationnel et financier des chantiers : CRUD projets + phases + notes + assignations, KPI, Gantt, agregats financiers, IA categorisation notes. |
| **Code source** | `backend/routers/projects.py` (1606 lignes, 21 endpoints), `frontend/src/pages/ProjectsPage.tsx` |
| **Tables PostgreSQL** | `projects`, `project_phases`, `project_notes`, `project_assignments`, `dossier_projets` ; lecture : `devis`, `factures`, `bons_commande`, `time_entries`, `companies` |
| **Endpoints majeurs** | Liste/CRUD projet, statistics, duplicate, export-csv, batch-update, gantt, financials, dossier, phases (POST/PUT), notes (GET/POST + categorize IA), assignments (GET/POST/DELETE) |
| **Statuts/types** | 5 statuts (En attente / En cours / Termine / Annule / Suspendu — Suspendu absent du filtre UI), 4 priorites (Basse / Moyenne / Haute / Urgente) |
| **Permissions** | Tous les utilisateurs authentifies du tenant (CRUD complet). IA categorisation notes guardee par `_check_credits` (claude-opus-4-7). |
| **Integrations** | CRM (`client_company_id`), Devis (`devis_id` -> soumission liee + multiplicateur marges 3/12/15 %), Dossier 360 (table `dossier_projets`), agregats Factures/BC/Time entries pour synthese financiere, Calendrier (`?open=ID`) |
| **Pas implemente** | Pas de DELETE phases ni notes (PUT seulement). Champs UI Gestionnaire/Notes (modale modif) **non persistes** (whitelist ALLOWED). Champs Creation `poClient`, `clientPersonne`, `saisieManuelle` **silencieusement ignores**. Pas de DnD reorder phases. Pas de critical path / dependances entre phases. Pas de calcul automatique progression projet (calculee Gantt = moyenne phases). Pas de filtre Suspendu dans UI. Pas de DELETE batch (uniquement statut/priorite). |

---

*Manuel ERP Constructo — Module Projets — v2.0 — 2026-04-25*
