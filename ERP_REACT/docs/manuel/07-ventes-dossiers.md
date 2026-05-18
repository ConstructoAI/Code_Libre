# Module 8 — Dossiers (Fiche 360)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/documents.py` (router dossiers + attachments + notes IA + sharing public), `frontend/src/pages/DossiersPage.tsx` (liste), `frontend/src/pages/DossierDetailPage.tsx` (Fiche 360), `frontend/src/pages/DossierPublicPage.tsx` (vue partagee)
> **Tables PostgreSQL** : `dossiers`, `attachments`, `dossier_notes`, `dossier_devis`, `dossier_projets`, `dossier_formulaires`, `dossier_achats`, `dossier_factures`, `public.dossiers_public_tokens`

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (Liste + Fiche 360)](#2-interface-liste-fiche-360)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Un **dossier** est un **conteneur 360°** qui regroupe tous les artefacts lies a une opportunite client : devis, projets, bons de travail, demandes de prix, bons de commande, factures, pointages, ecritures comptables, documents joints (plans/photos/contrats), notes (avec enrichissement IA Claude). Le dossier est la **fiche unique** qui donne une vue complete sur un chantier ou un mandat client.

### 1.2 Format numero dossier

**`DOS-YYYY-NNNNN`** (ex. `DOS-2026-00007`).

Source : `documents.py:388` `numero_dossier = f"DOS-{year}-{dossier_id:05d}"`.

- `YYYY` = annee a la creation
- `NNNNN` = id dossier zero-padded sur 5
- Genere atomiquement via TEMP-then-UPDATE (race-safe)

### 1.3 5 statuts dossier (DOSSIER_STATUTS)

Source : `documents.py:50` `DOSSIER_STATUTS = ["OUVERT", "EN_COURS", "EN_ATTENTE", "TERMINE", "ARCHIVE"]`

Schema PostgreSQL applique le CHECK constraint :
```sql
statut TEXT DEFAULT 'OUVERT' CHECK(statut IN ('OUVERT', 'EN_COURS', 'EN_ATTENTE', 'TERMINE', 'ARCHIVE'))
```

| Statut       | Couleur badge | Signification                                  |
|--------------|---------------|------------------------------------------------|
| `OUVERT`     | bleu          | Defaut a la creation, dossier actif            |
| `EN_COURS`   | indigo        | Travaux en cours sur les liens du dossier     |
| `EN_ATTENTE` | jaune         | En attente d action client/fournisseur         |
| `TERMINE`    | vert          | Travaux termines, liens cloturables           |
| `ARCHIVE`    | gris          | Dossier archive (hors flux actif)              |

### 1.4 5 types de dossier

Source : Schema `erp_database.py`
```sql
type_dossier TEXT DEFAULT 'PROJET' CHECK(type_dossier IN (
    'CLIENT', 'PROJET', 'CHANTIER', 'ADMINISTRATIF', 'FINANCIER'
))
```

| Type            | Usage typique                                                   |
|-----------------|-----------------------------------------------------------------|
| `CLIENT`        | Dossier centre client (relations, historique)                   |
| `PROJET`        | **DEFAUT** — Dossier projet (devis -> projet -> facturation)    |
| `CHANTIER`      | Dossier chantier physique (plans, permis, photos)               |
| `ADMINISTRATIF` | Dossier interne (RH, conformite, contentieux)                   |
| `FINANCIER`     | Dossier finance (subvention, financement, retenue)              |

### 1.5 4 priorites

`BASSE` / `NORMAL` / `HAUTE` / `URGENTE` (defaut `NORMAL`).

> **Note** : `NORMAL` (sans E final) cote dossier ; vs `NORMALE` cote BT. Coherence imparfaite entre modules.

### 1.6 Acces

- Sidebar -> **Dossiers** (icone Folder)
- URL liste : `/dossiers`
- URL fiche 360 : `/dossiers/{dossier_id}`
- URL publique (lecture seule) : `/dossiers/public/{token}`
- Auto-ouverture : `/dossiers?open={dossier_id}`

### 1.7 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD les dossiers et leurs liens.
- **Tokens publics** : 90 jours d expiration (codee en dur). Acces lecture seule, sans authentification.
- **Pas de roles « gestionnaire de dossier »** : tout le monde peut ouvrir, modifier, supprimer n importe quel dossier.

---

## 2. Interface (Liste + Fiche 360)

### 2.1 Page `/dossiers` (liste)

Tableau dossiers (cf. `DossiersPage.tsx`) :

Colonnes :
- **Numero dossier** (`DOS-YYYY-NNNNN`)
- **Titre** (texte libre)
- **Type** (badge : CLIENT / PROJET / CHANTIER / ADMINISTRATIF / FINANCIER)
- **Statut** (badge : OUVERT / EN_COURS / EN_ATTENTE / TERMINE / ARCHIVE)
- **Priorite** (badge : BASSE / NORMAL / HAUTE / URGENTE)
- **Date ouverture**
- **Date echeance**
- **Date modification**

Actions globales :
- **+ Nouveau dossier** (modale creation)
- Recherche texte (titre, numero, type)
- Filtre statut (dropdown)
- Tri par colonne (clic header)
- Redimensionnement colonnes
- Pagination (20/page, configurable)

**Carte statistiques** (haut de page) :
- Total dossiers ouverts (statut OUVERT + EN_COURS + EN_ATTENTE)
- Total termines
- Total archives

> **Pas de vue Kanban**, **pas de vue Calendrier**, **pas de bouton Importer/Exporter**. Liste tableau uniquement.

### 2.2 Page `/dossiers/{id}` (Fiche 360)

#### 2.2.1 Encart en-tete

- Bouton retour (fleche gauche)
- **Titre** (editable inline — clic ouvre champ + boutons Save/Cancel)
- **Numero dossier** (monospace, non modifiable)
- Numero opportunite liee (si dossier issu d une opportunite CRM)
- Nom client (denormalise depuis `companies` via `company_id`)
- Badge statut + bouton modification statut
- Bouton **Partager** (Share2) -> genere/affiche lien public
- Bouton **Supprimer** (Trash2) -> avec avertissement de cascade

#### 2.2.2 Navigation 12 onglets

Source : `DossierDetailPage.tsx:40-51` (`NAV_ITEMS`)

| # | Cle             | Label              | Icone           | Compteur affiche ? |
|---|-----------------|--------------------|-----------------|--------------------|
| 1 | `resume`        | Resume             | FolderOpen      | NON (vue par defaut) |
| 2 | `devis`         | Soumissions        | FileText        | OUI (count devis)  |
| 3 | `projet`        | Projet             | Briefcase       | OUI (count projets)|
| 4 | `bons_travail`  | Bons de travail    | Wrench          | OUI                |
| 5 | `achats`        | Achats             | ShoppingCart    | OUI (count BC)     |
| 6 | `demandes_prix` | Demandes de prix   | Send            | OUI                |
| 7 | `factures`      | Factures           | Receipt         | OUI                |
| 8 | `pointage`      | Pointage           | Clock           | OUI (heures)       |
| 9 | `comptabilite`  | Comptabilite       | DollarSign      | OUI (sommaires)    |
| 10| `documents`     | Documents          | Paperclip       | OUI (count attachments) |
| 11| `notes`         | Notes              | MessageSquare   | OUI (count notes)  |
| 12| `liens`         | Liens              | Link2           | OUI (total liens)  |

> **12 onglets exactement**. Pas plus, pas moins. Chaque onglet affiche un badge avec le compteur d items lies (sauf Resume).

#### 2.2.3 Onglet « Resume »

Vue d ensemble du dossier :
- Description (texte libre)
- Tags
- Dates (ouverture, echeance, fermeture)
- Responsable assigne (employe)
- Compteurs synthetiques de tous les liens (devis, projets, BT, BC, factures, etc.)
- Notes recentes (3 dernieres)
- Documents recents (3 derniers)

#### 2.2.4 Onglet « Soumissions / Devis »

Liste des devis lies au dossier (via table `dossier_devis`) :
- Numero devis, titre, montant, statut
- Bouton **+ Lier un devis** (modale recherche dans devis existants)
- Bouton **Delier** sur chaque ligne

#### 2.2.5 Onglet « Projet »

Liste des projets lies (via table `dossier_projets` ET via `dossiers.project_id` direct) :
- Nom projet, statut, dates, budget
- Bouton **+ Lier un projet**

#### 2.2.6 Onglet « Bons de travail »

Liste des BT lies (via `dossier_formulaires` filter `formulaire.type='BON_TRAVAIL'`) :
- Numero BT, statut, priorite, montant total
- Click -> redirection `/bons-travail?open={bt_id}`

#### 2.2.7 Onglet « Achats »

Liste des BC lies (via `dossier_achats`) :
- Numero BC, fournisseur, statut, montant
- Click -> redirection `/magasin?tab=orders&open={bc_id}`

#### 2.2.8 Onglet « Demandes de prix »

Liste des demandes de prix (via `dossier_formulaires` filter `formulaire.type='DEMANDE_PRIX'`) :
- Module Demandes de prix non documente separement (cf. accounting.py:2226)

#### 2.2.9 Onglet « Factures »

Liste des factures (via `dossier_factures`) :
- Numero facture, type (Vente/Achat), TTC, solde du, statut

#### 2.2.10 Onglet « Pointage »

Pointages employes lies au projet du dossier :
- Liste `time_entries` filtres par `project_id`
- Total heures par employe
- Cout total (heures * taux)

#### 2.2.11 Onglet « Comptabilite »

Vue financiere agregee :
- Sommaire revenus (factures clients liees)
- Sommaire depenses (factures fournisseurs + BC + heures)
- Marge calculee
- Lien vers ecritures journal liees au projet

#### 2.2.12 Onglet « Documents » (attachments)

Liste des documents joints (table `attachments`) :
- Nom, taille, type MIME, categorie, date upload, uploaded_by
- 10 categories (PLAN / PHOTO / CONTRAT / FACTURE / CORRESPONDANCE / ADDENDA / FICHE_TECHNIQUE / SOUMISSION / DIRECTIVE_CHANTIER / AUTRE — defaut AUTRE)
- Filtre par categorie
- Apercu inline (images, PDF) ou bouton telecharger
- Bouton **+ Uploader** (multipart, max **150 MB** par fichier)
- Bouton suppression (icone poubelle)

> **Stockage en base** : les fichiers sont stockes en colonne `BYTEA` (PostgreSQL blob), pas sur S3 ni Azure. Lecture/ecriture par chunks de 64 KB en memoire.

#### 2.2.13 Onglet « Notes » (avec IA)

Liste des notes du dossier (table `dossier_notes`) :
- Texte note, categorie (defaut `general`), `is_pinned` (epinglee), date
- Pieces jointes (JSON `attachments[]` : nom, type, taille, base64 inline)
- Bouton **+ Nouvelle note**
- Bouton **Epingler** / **Desepingler**
- Bouton **Categoriser** (manuel ou auto via IA)

**3 actions IA** disponibles :

| Action                  | Endpoint                            | Modele Claude       | Sortie                                      |
|-------------------------|-------------------------------------|---------------------|---------------------------------------------|
| **Enrichir une note**   | `POST /{id}/notes/ai/enrich`        | claude-sonnet-4-6   | Texte structure + categorie + actions a faire |
| **Analyser une photo**  | `POST /{id}/notes/ai/analyze-photo` | claude-sonnet-4-6 (vision) | Type degat, severite, localisation, remediation |
| **Resumer toutes notes**| `POST /{id}/notes/ai/summary`       | claude-sonnet-4-6   | Resume + issues ouvertes + actions en cours |

6 categories de notes : `defaut, observation, progression, decision, action, general`.

> **Toutes les actions IA deduisent des credits** prepayes du tenant (`_check_credits()`).

#### 2.2.14 Onglet « Liens »

Vue agregee de tous les liens du dossier (devis + projets + BT + BC + factures + DP) avec types et compteurs.

Bouton **+ Nouveau lien** -> modale type + ID -> `POST /documents/{dossier_id}/link`.

---

## 3. Workflows pas-a-pas

### 3.1 Creer un dossier

1. Page Dossiers -> bouton **+ Nouveau dossier**.
2. Modale :
   - **Titre** (obligatoire — texte libre)
   - **Type dossier** (dropdown 5 valeurs — defaut `PROJET`)
   - **Priorite** (dropdown 4 valeurs — defaut `NORMAL`)
   - **Description** (texte multi-ligne)
   - **Client** (dropdown companies — optionnel)
   - **Projet** (dropdown projects — optionnel, si lie un projet existant)
   - **Date echeance** (optionnel)
   - **Tags** (texte libre, virgule separee)
3. **Enregistrer** -> `POST /documents`.
4. Backend :
   - INSERT avec `numero_dossier = TEMP`, `statut = OUVERT`.
   - UPDATE `numero_dossier = DOS-YYYY-NNNNN` (race-safe).
5. Reponse `{id, numeroDossier}` -> redirection vers `/dossiers/{id}` (Fiche 360).

### 3.2 Auto-creation depuis CRM

> **Le seul auto-link** dans le module : a la conversion d une opportunite CRM, un dossier est auto-cree et `opportunities.dossier_id` est renseigne.

1. CRM -> Opportunite -> bouton **Convertir en projet/dossier**.
2. Backend cree :
   - Un dossier `DOS-YYYY-NNNNN`
   - Un devis ou projet
   - Lie tout via `opportunities.dossier_id`, `opportunities.devis_id`, `opportunities.projet_id`
3. Le dossier herite des informations client de l opportunite.

### 3.3 Modifier le dossier (en-tete)

1. Fiche 360 -> bouton **Edit** sur le titre -> champ inline + Save/Cancel.
2. PUT `/documents/{id}` avec `{titre: ...}`.
3. **Champs editables** : `titre`, `statut`, `priorite`, `notes` UNIQUEMENT (whitelist backend).
4. Autres champs (description, type, client, dates) : non editables apres creation via le PUT principal — necessite endpoints specifiques (a verifier en prod).

### 3.4 Lier un devis (ou autre item) au dossier

1. Fiche 360 -> onglet correspondant (Soumissions, Projet, Bons de travail, etc.).
2. Bouton **+ Lier un devis** (ou + Lier un projet, etc.).
3. Modale : recherche de l item a lier (autocomplete par numero/titre).
4. Selection -> `POST /documents/{dossier_id}/link` avec `{type: "devis", item_id: 42}`.
5. Backend insere dans la table de jointure correspondante :
   - `devis` -> `dossier_devis (dossier_id, devis_id)`
   - `projet` -> `dossier_projets (dossier_id, project_id)`
   - `bon_travail` ou `demande_prix` -> `dossier_formulaires (dossier_id, formulaire_id)`
   - `bon_commande` -> `dossier_achats (dossier_id, achat_id)`
   - `facture` -> `dossier_factures (dossier_id, facture_id)`
6. ON CONFLICT DO NOTHING (idempotent).

### 3.5 Delier un item du dossier

1. Onglet correspondant -> ligne item -> bouton **Delier** (icone X).
2. Confirmation -> `DELETE /documents/{dossier_id}/link/{item_type}/{item_id} (ex. /link/devis/42)`.
3. DELETE FROM la table de jointure correspondante. L item lui-meme reste intact.

### 3.6 Uploader un document

1. Fiche 360 -> onglet **Documents** -> bouton **+ Uploader**.
2. Selecteur fichier (peut etre n importe quel type : image, PDF, DOC, XLS, ZIP).
3. Choisir une **categorie** (dropdown 10 valeurs : PLAN / PHOTO / CONTRAT / FACTURE / CORRESPONDANCE / ADDENDA / FICHE_TECHNIQUE / SOUMISSION / DIRECTIVE_CHANTIER / AUTRE).
4. **Uploader** -> `POST /documents/{dossier_id}/attachments` (multipart/form-data).
5. Backend :
   - Valide la taille (max **150 MB** = `MAX_SIZE = 150 * 1024 * 1024`).
   - Lecture par chunks de 64 KB.
   - INSERT dans `attachments` avec `file_data BYTEA`.
6. Le fichier apparait dans la liste avec apercu inline pour images/PDF.

> **Aucun stockage cloud** : le fichier est en base PostgreSQL. Backups DB doivent etre dimensionnes en consequence.

### 3.7 Telecharger / supprimer un document

**Telecharger** :
1. Onglet Documents -> click ligne ou bouton **Telecharger**.
2. `GET /documents/{dossier_id}/attachments/{attachment_id}/download` -> Content-Disposition: attachment.

**Supprimer** :
1. Onglet Documents -> icone poubelle.
2. `DELETE /documents/{dossier_id}/attachments/{attachment_id}`.
3. DELETE FROM `attachments` WHERE id = ... (hard delete).

### 3.8 Generer un lien public de partage

1. Fiche 360 -> bouton **Partager** (icone Share2).
2. Modale : info actuelle (token existant ou non).
3. Bouton **Generer lien public** -> `POST /documents/{dossier_id}/share`.
4. Backend :
   - Genere un token unique (base sur titre + uuid).
   - Insert dans `public.dossiers_public_tokens (token, schema, dossier_id, expires_at)` avec **expiration 90 jours** (codee en dur).
5. Reponse `{token, lien: /dossiers/public/{token}, expiration_jours: 90}`.
6. UI affiche l URL complete -> bouton Copier.

### 3.9 Acceder au dossier en mode public (client)

1. Le client recoit l URL `https://app.constructo.ai/dossiers/public/{token}`.
2. Page `DossierPublicPage.tsx` charge `GET /documents/public/{token}` (sans authentification).
3. Backend valide :
   - Token existe ?
   - Token non expire (`expires_at > NOW()`) ?
4. Si OK : retourne dossier + liste documents (lecture seule).
5. Page affiche :
   - Titre, numero, statut du dossier
   - Liste des **documents joints uniquement** (pas de devis/projets/factures)
   - Apercu inline ou bouton Telecharger
6. **Pas d upload client**, **pas de notes**, **pas de modification** depuis la vue publique.

### 3.10 Revoquer le partage public

1. Fiche 360 -> bouton Partager -> bouton **Revoquer**.
2. `DELETE /documents/{dossier_id}/share` -> DELETE tous les tokens du dossier.
3. Tous les liens public deviennent invalides instantanement.

### 3.11 Suivre les acces au lien public

1. Fiche 360 -> bouton Partager -> info **Statistiques** (si token actif).
2. `GET /documents/{dossier_id}/share-info` retourne :
   - `totalViews` (camelCase, frontend) : nombre d ouvertures
   - `totalDownloads` (camelCase, frontend) : nombre de telechargements de documents
   - `lastViewedAt`, `lastDownloadedAt` (camelCase, frontend)

### 3.12 Creer une note simple

1. Fiche 360 -> onglet **Notes** -> bouton **+ Nouvelle note**.
2. Champ texte multi-ligne + dropdown **Categorie** (defaut `general`).
3. Attacher fichiers (drag & drop ou bouton — encodage base64 inline dans `attachments` JSON).
4. **Enregistrer** -> `POST /documents/{dossier_id}/notes` -> INSERT dans `dossier_notes`.

### 3.13 Enrichir une note avec IA Claude

1. Onglet Notes -> note brute -> bouton **Enrichir IA**.
2. `POST /documents/{dossier_id}/notes/ai/enrich` avec `{note_id}`.
3. Backend :
   - Verifie credits IA disponibles (`_check_credits()`).
   - Appelle `claude-sonnet-4-6` avec system prompt « assistant IA specialise en construction au Quebec ».
   - Recoit JSON structure : texte enrichi (avec **gras** sections), categorie auto-detectee, actions a faire identifiees.
   - UPDATE `dossier_notes` avec le texte enrichi.
   - Deduit credits.
4. La note se rafraichit avec le contenu enrichi + categorie suggeree.

### 3.14 Analyser une photo de chantier (defauts) avec IA

1. Onglet Notes -> bouton **Analyser une photo** -> selectionner image.
2. `POST /documents/{dossier_id}/notes/ai/analyze-photo` (multipart).
3. Backend :
   - Encode photo en base64.
   - Appelle Claude Sonnet 4.6 vision.
   - Prompt : detecter degats, gravite, localisation, recommandations de remediation.
   - Cree une nouvelle note avec le rapport IA.
4. La note generee apparait dans la liste avec categorie auto (typiquement `defaut` ou `observation`).

### 3.15 Generer un resume de toutes les notes (IA)

1. Onglet Notes -> bouton **Generer resume IA**.
2. `POST /documents/{dossier_id}/notes/ai/summary`.
3. Backend :
   - Concatene toutes les notes du dossier.
   - Appelle Claude pour resumer.
   - Retourne : resume general + liste issues ouvertes + liste actions en cours.
4. Affiche dans une modale (pas stocke en base — vue ad hoc).

### 3.16 Supprimer un dossier (cascade)

1. Fiche 360 -> bouton **Supprimer** (icone Trash2 en en-tete).
2. **Avertissement de cascade** : « Cette action supprimera definitivement le dossier et tous ses elements lies. »
3. Confirmation -> `DELETE /documents/{id}`.
4. Backend execute en cascade :
   - DELETE `dossier_notes` WHERE dossier_id = X
   - DELETE `attachments` WHERE dossier_id = X (les fichiers BYTEA sont effaces)
   - DELETE `dossier_devis`, `dossier_projets`, `dossier_formulaires`, `dossier_achats`, `dossier_factures` WHERE dossier_id = X
   - DELETE `public.dossiers_public_tokens` WHERE dossier_id = X
   - **SET NULL** sur `opportunities.dossier_id` (l opportunite reste)
   - DELETE FROM `dossiers` WHERE id = X (hard delete)
5. Le dossier disparait. **Les items lies (devis, projets, BC, factures) restent intacts**, ils perdent juste le rattachement au dossier.

### 3.17 Archiver un dossier (alternative a la suppression)

1. Fiche 360 -> selecteur statut -> choisir **ARCHIVE**.
2. `PUT /documents/{id}` avec `{statut: ARCHIVE}`.
3. Le dossier passe en statut archive (badge gris).
4. **Disparait des listes par defaut** mais reste consultable via filtre statut=ARCHIVE.
5. Aucune cascade : tous les liens et documents restent en place.

> Recommandation : preferer **archiver** plutot que supprimer pour conserver l historique.

---

## 4. Reference

### 4.1 Statuts (DOSSIER_STATUTS)

Source : `documents.py:50` + `erp_database.py` (CHECK constraint)

`["OUVERT", "EN_COURS", "EN_ATTENTE", "TERMINE", "ARCHIVE"]`

### 4.2 Types (CHECK constraint)

`['CLIENT', 'PROJET', 'CHANTIER', 'ADMINISTRATIF', 'FINANCIER']` — defaut `PROJET`.

### 4.3 Priorites

`['BASSE', 'NORMAL', 'HAUTE', 'URGENTE']` — defaut `NORMAL`.

> **Note de coherence** : `NORMAL` (sans E) ici vs `NORMALE` (avec E) sur les BT. Pas d harmonisation cross-modules.

### 4.4 12 Onglets Fiche 360 (NAV_ITEMS)

Source : `DossierDetailPage.tsx:40-51`

`[resume, devis, projet, bons_travail, achats, demandes_prix, factures, pointage, comptabilite, documents, notes, liens]`

### 4.5 10 Categories documents (DOCUMENT_CATEGORIES)

Source : `documents.py:47`

`PLAN, PHOTO, CONTRAT, FACTURE, CORRESPONDANCE, ADDENDA, FICHE_TECHNIQUE, SOUMISSION, DIRECTIVE_CHANTIER, AUTRE` — defaut `AUTRE`.

### 4.6 6 Categories notes (_NOTE_CATEGORIES)

Source : `documents.py:30-31`

`defaut, observation, progression, decision, action, general` — defaut `general` (lowercase).

### 4.7 Format numero dossier

`DOS-YYYY-NNNNN`. Exemples : `DOS-2026-00001`, `DOS-2026-00007`, `DOS-2027-00500`.

> Race-safe via INSERT TEMP + UPDATE par id (lesson #113).

### 4.8 Tables PostgreSQL

| Table                          | Role                                               | Cles                              |
|--------------------------------|----------------------------------------------------|-----------------------------------|
| `dossiers`                     | En-tete dossier                                    | PK `id`, FK `project_id`, FK `company_id`, FK `responsable_id`, UNIQUE `numero_dossier` |
| `attachments`                  | Documents joints (BYTEA blob max 150 MB)           | PK `id`, FK `dossier_id`, `category` |
| `dossier_notes`                | Notes (avec IA enrichment + JSON attachments inline) | PK `id`, FK `dossier_id`, `categorie`, `is_pinned` |
| `dossier_devis`                | Lien devis                                         | PK composite `(dossier_id, devis_id)` |
| `dossier_projets`              | Lien projets                                       | PK composite `(dossier_id, project_id)` |
| `dossier_formulaires`          | Lien BT + Demandes de prix (filtre par `formulaire.type`) | PK composite `(dossier_id, formulaire_id)` |
| `dossier_achats`               | Lien BC                                            | PK composite `(dossier_id, achat_id)` |
| `dossier_factures`             | Lien factures                                      | PK composite `(dossier_id, facture_id)` |
| `public.dossiers_public_tokens`| Tokens partage public (cross-tenant — schema `public`) | PK `token`, `schema`, `dossier_id`, `expires_at` |

### 4.9 Endpoints principaux

| Methode | URL                                              | Role                                      |
|---------|--------------------------------------------------|-------------------------------------------|
| GET     | `/documents`                                     | Liste paginee + filtre statut             |
| POST    | `/documents`                                     | Creer dossier (auto-numero)               |
| GET     | `/documents/{id}`                                | Detail dossier                            |
| PUT     | `/documents/{id}`                                | Update (whitelist titre/statut/priorite/notes) |
| DELETE  | `/documents/{id}`                                | Supprimer + cascade complete              |
| GET     | `/documents/statistics`                          | KPI par statut                            |
| POST    | `/documents/{id}/link`                           | Lier item (devis/projet/BT/BC/facture)    |
| DELETE  | `/documents/{id}/link`                           | Delier item                               |
| GET/POST/DELETE | `/documents/{id}/attachments[/...]`      | CRUD documents joints                     |
| GET     | `/documents/{id}/attachments/{attachment_id}/download` | Download fichier                  |
| GET/POST/PUT/DELETE | `/documents/{id}/notes[/...]`        | CRUD notes                                |
| POST    | `/documents/{id}/notes/ai/enrich`                | IA enrichir note                          |
| POST    | `/documents/{id}/notes/ai/analyze-photo`         | IA analyser photo                         |
| POST    | `/documents/{id}/notes/ai/summary`               | IA resumer toutes les notes               |
| POST    | `/documents/{id}/share`                          | Generer token public 90j                  |
| DELETE  | `/documents/{id}/share`                          | Revoquer tous les tokens                  |
| GET     | `/documents/{id}/share-info`                     | Stats acces (vues, telechargements)       |
| GET     | `/documents/public/{token}`                      | Vue publique (sans auth)                  |

### 4.10 Validations & limites

| Regle                                  | Effet                                                  |
|----------------------------------------|--------------------------------------------------------|
| `titre` vide                           | HTTP 400                                               |
| `statut` hors `DOSSIER_STATUTS`        | DB CHECK refuse                                        |
| `type_dossier` hors valeurs autorisees | DB CHECK refuse                                        |
| Upload fichier > 150 MB                | HTTP 413 (Payload Too Large)                           |
| Token public expire                    | HTTP 404 ou message expiration sur DossierPublicPage   |
| IA credits insuffisants                | HTTP 402 (Payment Required)                            |

---

## 5. Integrations & FAQ

### 5.1 Integration CRM (Opportunites)

> **Le seul auto-link** du module : a la conversion d une opportunite CRM, un dossier est cree automatiquement et `opportunities.dossier_id` est renseigne.

- Dans la Fiche 360, le numero d opportunite associee s affiche dans l en-tete (si present).
- A la suppression du dossier, `opportunities.dossier_id` est mis a NULL (l opportunite reste).

### 5.2 Integration Devis / Projets / BT / BC / Factures

**Aucun auto-link** apres creation initiale. Tous les rattachements ulterieurs sont **manuels** via :
- Bouton **+ Lier** dans l onglet correspondant
- Ou recherche/selection du dossier au moment de la creation de l item (ex. champ « Dossier associe » dans la modale de creation devis/BC/facture)

> Exception : les BT et BC creent un auto-link au dossier **a la creation** SI leur projet est lie a une opportunite avec un dossier_id (cf. modules 5 et 6).

### 5.3 Integration B2B Portal

> **Pas d integration** : le module B2B Portal a son propre systeme de partage avec le client. Les dossiers ne sont **PAS** exposes au B2B Portal.

Le partage public utilise plutot des **tokens 90j** avec URL `/dossiers/public/{token}` et limite l acces aux **documents joints** (pas devis, projets, factures).

### 5.4 Integration Messagerie

> **Pas d onglet Messages** sur la Fiche 360. Le module de messagerie (`/messages`) est independant et n est pas integre au dossier.

Pour communiquer avec le client sur un dossier, utiliser :
- Notes du dossier (interne)
- Email manuel avec lien public partage
- Module B2B Portal (separe)

### 5.5 Integration Photos / Plans

- Onglet Documents avec categorie `PHOTO` ou `PLAN` -> centralise les fichiers visuels.
- Apercu inline pour images (PNG, JPG, GIF) et PDF.
- IA Analyse photos -> note de defauts/observations auto.

### 5.6 Backups et stockage

> **Stockage en base PostgreSQL (BYTEA)** : les fichiers joints et les pieces jointes des notes (base64 dans JSON) **gonflent la base de donnees**.

Implications :
- Backups DB peuvent etre volumineux (chaque GB de fichiers = +1 GB sur le backup).
- Performance : preferer plusieurs petits fichiers a un seul gros fichier de 150 MB.
- Pas de versionnement automatique des fichiers (un upload = nouveau record).

### 5.7 FAQ

**Q : Combien de fichiers maximum par dossier ?**
R : Pas de limite hard-codee. Limite pratique : taille DB. Taille max **par fichier** : 150 MB.

**Q : Les fichiers sont-ils anti-virus scannes a l upload ?**
R : NON. Aucun scan AV automatique. L utilisateur est responsable de la securite des fichiers uploades.

**Q : Comment partager le dossier avec un sous-traitant pour qu il telecharge les plans ?**
R : Generer un lien public (Partager -> Generer lien public). Le sous-traitant accede via l URL `/dossiers/public/{token}` sans authentification. Lecture seule des documents. Expiration 90 jours.

**Q : Le client peut-il uploader un fichier via le lien public ?**
R : NON. Lecture seule. Pour permettre l upload client, utiliser le module B2B Portal (separe).

**Q : Comment savoir si le client a consulte le lien public ?**
R : Bouton Partager -> stats `totalViews`, `totalDownloads`, `lastViewedAt` (camelCase frontend). Pas de notification email auto.

**Q : Que se passe-t-il quand le token expire (apres 90 jours) ?**
R : L URL retourne HTTP 404 ou message « Lien expire ». Pour reactiver, generer un nouveau token (l ancien est invalide).

**Q : Peut-on prolonger l expiration au-dela de 90 jours ?**
R : Non via UI. La duree est codee en dur (`expires_days=90` dans `_register_dossier_token`). Modification necessite changement de code.

**Q : Si je supprime un dossier, les devis/projets lies sont-ils supprimes aussi ?**
R : NON. Les items lies (devis, projets, BT, BC, factures) restent en base. Seuls les **liens** dans les tables de jointure sont supprimes (et les notes + documents joints du dossier).

**Q : Les notes IA enrichies sont-elles facturees plusieurs fois si je rafraichis ?**
R : Chaque appel IA est facture independamment. Pour eviter la double facturation, l UI ne propose pas de bouton « Re-enrichir » sur une note deja enrichie (verifier le code en prod si necessaire).

**Q : Comment faire une recherche full-text dans toutes les notes du dossier ?**
R : Pas de recherche full-text dans cette version. Filtrer par categorie ou utiliser la fonction « Generer resume IA » pour avoir une vue d ensemble.

**Q : Les notes peuvent-elles avoir des @mentions vers des employes ?**
R : NON. Pas de fonctionnalite mentions/notifications dans cette version.

**Q : Peut-on dupliquer un dossier (template) ?**
R : NON. Pas de fonction Dupliquer. Recreer manuellement un nouveau dossier.

**Q : Les onglets Pointage et Comptabilite affichent-ils des donnees en temps reel ?**
R : OUI. Le contenu est calcule a la volee depuis les tables `time_entries` (pointages) et `journal_entries` (comptabilite) filtres par `project_id` du dossier.

**Q : Pourquoi le menu sidebar parle de « Dossiers » mais le router parle de `/documents` ?**
R : Heritage historique du code. Le terme « documents » dans le router fait reference au concept original (documents = dossiers) ; le frontend a renomme « Dossiers » pour clarte. La table SQL est bien `dossiers`.

**Q : Les categories de notes IA sont-elles modifiables (custom) ?**
R : NON. Les 6 categories sont codees en dur dans `_NOTE_CATEGORIES`. L IA selectionne parmi cette liste ; les utilisateurs peuvent aussi assigner manuellement.

**Q : Le dossier conserve-t-il l historique des modifications (audit log) ?**
R : NON dans cette version. Seuls `created_at` et `updated_at` sont stockes. Pas d audit log par champ.

---

## 6. Recap one-pager

- **Format** : `DOS-YYYY-NNNNN` (annee + 5 chiffres). Race-safe.
- **5 statuts** : OUVERT (defaut) / EN_COURS / EN_ATTENTE / TERMINE / ARCHIVE.
- **5 types** : CLIENT / PROJET (defaut) / CHANTIER / ADMINISTRATIF / FINANCIER.
- **4 priorites** : BASSE / NORMAL / HAUTE / URGENTE (defaut NORMAL).
- **12 onglets Fiche 360** : Resume, Soumissions, Projet, Bons de travail, Achats, Demandes de prix, Factures, Pointage, Comptabilite, Documents, Notes, Liens.
- **Documents** : table `attachments` BYTEA blob, max **150 MB**, 10 categories.
- **Notes** : table `dossier_notes`, 6 categories, attachments inline base64, 3 actions IA (enrich/photo/summary) avec Claude Sonnet 4.6.
- **Liens** : 5 tables de jointure (`dossier_devis`, `dossier_projets`, `dossier_formulaires` pour BT+DP, `dossier_achats`, `dossier_factures`).
- **Auto-link** : UNIQUEMENT depuis CRM opportunite -> dossier (1 cas). Tous les autres = manuels.
- **Public sharing** : token 90j (codee en dur), lecture seule, documents uniquement, sans auth.
- **Cascade delete** : DELETE notes + attachments + tous les liens. SET NULL sur opportunities. Items lies (devis/projets/BC/factures) preserves.
- **Pas de Kanban**, **Pas de Calendrier**, **Pas de Messages**, **Pas de Dupliquer**, **Pas d audit log**, **Pas de scan antivirus**.
- **Stockage en base** : pas de S3/Azure. Dimensionner les backups en consequence.

---

**Documentation generee a partir du code** : `documents.py` (router), `DossiersPage.tsx` (liste), `DossierDetailPage.tsx` (Fiche 360), `DossierPublicPage.tsx` (vue publique), `documents.ts` (api client).

**Manuels lies** :
- Module 3 (CRM — opportunites) — `03-crm.md`
- Module 4 (Devis) — `04-devis.md`
- Module 5 (Bons de Travail) — `05-bons-de-travail.md`
- Module 6 (Bons de Commande) — `06-bons-de-commande.md`
- Module 7 (Factures / Comptabilite) — `07-factures.md`
- Module 25 (IA / Assistant) — `12-ia.md`
