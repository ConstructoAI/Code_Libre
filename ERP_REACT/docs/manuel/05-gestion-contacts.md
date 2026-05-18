# Module 05 — Contacts (Personnes physiques)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/companies.py` (614 lignes — partage avec Entreprises ; 4 endpoints `/contacts`), `frontend/src/pages/ContactsPage.tsx` (419 lignes), `frontend/src/api/companies.ts` (interfaces `Contact`, `ContactCreate`)
> **Tables PostgreSQL** : `contacts` (table principale) ; colonnes adresse ajoutees a la volee par `_ensure_contact_address_cols` au premier acces.
> **Cadrage** : ce module gere les **personnes physiques** rattachees ou non a une entreprise. Il est **distinct** du module Entreprises (manuel 16) et du module CRM/Opportunites (manuel 03), bien que les contacts soient **utilises** dans toutes les entites commerciales (opportunites, devis, factures, interactions, emails).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (page Contacts)](#2-interface-page-contacts)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Centraliser le **carnet d adresses** de toutes les personnes physiques avec lesquelles l entreprise interagit : interlocuteurs chez les clients (decideurs, charges de projet, comptables), chez les fournisseurs et sous-traitants, et institutionnels (architectes, ingenieurs, arpenteurs, banquiers, assureurs).

Chaque contact peut etre **rattache a une entreprise** (FK `company_id`) ou exister de maniere autonome (`company_id = NULL`). Il transporte ses coordonnees (email, telephone fixe, mobile), son **role/poste**, sa **fonction**, son **departement** et une adresse postale optionnelle.

Les contacts servent de **points de rattachement** dans les opportunites CRM (`opportunities.contact_id`), devis (`devis.client_contact_id`), interactions et activites CRM, emails (`emails.contact_id`), contrats (`contracts.client_contact_id`), projets (`projects.client_contact_id`), et comme contact principal d entreprise (`companies.contact_principal_id`).

### 1.2 Ce que le module ne fait PAS (verifie dans le code)

- **Pas de soft-delete** : le DELETE supprime physiquement la ligne (contrairement aux entreprises qui passent en statut `Inactif`).
- **Pas de toggle UI sur `est_principal`** : champ booleen present en BD avec badge bleu d affichage, mais aucun bouton dans `ContactsPage.tsx`. Modifier via API `PUT /contacts/{id}` direct.
- **Pas de fusion de doublons** ni **detection de doublon** sur email ou telephone.
- **Pas de validation format** : aucune verification d email valide, de telephone canadien, ou de code postal QC. Tout est texte libre.
- **Pas d import / export** CSV / vCard / iCal depuis l interface.
- **Pas d historique des modifications** : pas d audit log, pas de `updated_at` ni `updated_by`.
- **Pas de photo / avatar** : seules les **initiales** (prenom[0] + nomFamille[0]) dans un cercle.
- **Pas de tags / categories** ni de **statut** actif/inactif.
- **Pas de gestion des consentements** (champs RGPD / Loi 25 explicites absents).
- **Pas d interactions integrees** a la fiche contact : voir le module CRM (manuel 03) onglet Historique avec filtre `contact_id`.
- **Pas de detail / fiche contact dediee** : pas de page `/contacts/{id}`, seulement liste + modale d edition.

> Pour les fonctionnalites avancees de relation client (pipeline, qualification BAT, lead scoring), voir le manuel 06 CRM. Pour les emails lies a un contact, voir le manuel 23 Emails.

### 1.3 Acces

- Sidebar -> groupe **Gestion** -> **Contacts** (icone `Users`)
- URL : `/contacts`
- Lazy-loaded : `App.tsx:58` `const ContactsPage = lazy(() => import('@/pages/ContactsPage'))`
- Titre TopBar : `Contacts` (mappe via `TopBar.tsx:18`)

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant peuvent **lister, creer, modifier, supprimer** n importe quel contact du tenant.
- Pas de role dedie « gestionnaire de contacts » ni de visibilite restreinte par equipe.
- L isolation entre tenants se fait au niveau du schema PostgreSQL (`db.set_tenant(conn, user.schema)`). Un contact d un tenant n est jamais visible depuis un autre tenant.
- Sans `user.schema`, l API renvoie HTTP 400 « Contexte tenant manquant ».

### 1.5 Multi-tenant et migration de schema

A chaque appel d un endpoint `/contacts`, le backend invoque `_ensure_contact_address_cols` (`companies.py:35-58`). Cette fonction utilise `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS` (idempotent) pour ajouter `adresse` (TEXT), `ville` (VARCHAR(100)), `province` (VARCHAR(50)), `code_postal` (VARCHAR(20)) au premier acces du process sur le schema, puis cache le resultat. Consequence : un tenant existant fonctionne sans intervention manuelle.

---

## 2. Interface (page Contacts)

Source : `frontend/src/pages/ContactsPage.tsx` (419 lignes). Layout mobile-first responsive : table desktop / cartes mobile.

### 2.1 Bandeau de statistiques (haut de page)

4 tuiles `StatCard` (cf. `ContactsPage.tsx:167-172`) :

| # | Libelle           | Source de calcul                                                          | Couleur  |
|---|-------------------|---------------------------------------------------------------------------|----------|
| 1 | **Contacts**      | `total` retourne par `GET /contacts` (toutes pages confondues)            | bleu     |
| 2 | **Entreprises**   | `Set` distinct des `companyId` non NULL **sur la page courante**          | violet   |
| 3 | **Avec Email**    | Nombre de contacts ayant un `email` non vide **sur la page courante**     | vert     |
| 4 | **Avec Tel.**     | Nombre de contacts ayant un `telephone` non vide **sur la page courante** | jaune    |

> **Limite connue** : les stats 2-3-4 sont calculees uniquement sur les **20 contacts visibles** de la page courante (`contacts.filter(...)`). Pour des stats globales precises, considerer une requete API dediee (non implementee).

### 2.2 CommandBar (barre d actions)

Source : `ContactsPage.tsx:175-201`.

- Bouton primaire **Nouveau Contact** (icone `Plus`) -> ouvre la modale de creation.
- Champ de **recherche** a droite avec icone loupe : placeholder « Rechercher par nom, email, entreprise, role... ».
- Bouton **Effacer** apparait quand le champ recherche est non vide -> remet a `''` et `page = 1`.

> **Backend reel** : la recherche cote API porte uniquement sur `LOWER(prenom || ' ' || nom_famille) LIKE %s OR LOWER(email) LIKE %s` (`companies.py:441-442`). Les mentions « entreprise » et « role » dans le placeholder sont **trompeuses** : aucune recherche LIKE sur `companies.nom`, `role_poste`, `fonction` cote SQL. La recherche par entreprise / role ne fonctionnera pas tel qu indique dans le placeholder.

### 2.3 Tableau desktop (>= md)

Source : `ContactsPage.tsx:209-278`. 6 colonnes redimensionnables et triables :

| # | Colonne          | Cle tri        | Largeur | Contenu                                                                  |
|---|------------------|----------------|---------|--------------------------------------------------------------------------|
| 1 | **Nom**          | `prenom`       | 200 px  | Cercle initiales + nom complet + badge `Principal` si `estPrincipal`     |
| 2 | **Entreprise**   | `companyNom`   | 180 px  | `companyNom` (jointure `LEFT JOIN companies`) ou `--`                    |
| 3 | **Role/Fonction** | `rolePoste`    | 160 px  | `rolePoste` ou `--`                                                      |
| 4 | **Email**        | `email`        | 220 px  | Icone `Mail` + email, ou `--`                                            |
| 5 | **Telephone**    | `telephone`    | 140 px  | `formatPhone(telephone)` (ex. `(514) 555-1234`) ou `--`                  |
| 6 | **Actions**      | --             | --      | Boutons `Pencil` (modifier) + `X` (supprimer)                            |

Tri : hook `useSortable(contacts)` cote client (page courante uniquement, pas de re-fetch API). Redimensionnement : hook `useColumnResize` avec poignees laterales ; double-clic = `autoFit`. Etat vide : « Aucun contact enregistre. ».

### 2.4 Affichage mobile (< md)

Source : `ContactsPage.tsx:281-332`. Cartes empilees a la place du tableau. Chaque carte affiche : cercle d initiales, nom complet (truncate) + badge `Principal`, `rolePoste` en sous-titre, boutons modifier/supprimer, pied de carte avec icones `Building2` (companyNom) + `Mail` (email truncate) + `Phone` (telephone formate).

### 2.5 Pagination

Composant `Pagination` standard si `totalPages > 1`. `perPage = 20` (constant `ContactsPage.tsx:52`), `totalPages = Math.ceil(total / perPage)`. Pas de selecteur `perPage` cote UI (l API accepte 1-100 en query string).

### 2.6 Modale de creation « Nouveau Contact »

Source : `ContactsPage.tsx:341-379`. Taille `lg`. Champs presents (par ordre d apparition) :

- **Prenom \*** + **Nom de famille \*** (obligatoires, validation `_strip_non_empty`)
- **Email** (`Input` type email) + **Telephone**
- **Entreprise** (`Select` dropdown) + **Role/Fonction** (mappe `role_poste`)
- **Mobile** (distinct du telephone fixe)
- **Adresse** + (**Ville / Province / Code postal**)
- **Notes** (`Textarea` 3 lignes)

> **Champs absents de la creation** mais presents en modification : `fonction` (seconde information de role), `departement` (ex. Comptabilite). Le champ `est_principal` n est **jamais** affiche dans l UI. Pour saisir `fonction` / `departement` a la creation, creer le contact puis l ouvrir en edition immediate.

**Population de la liste « Entreprise »** : `openCreate` appelle `listCompanies({ perPage: 100 })`. Dropdown limite a **100 entreprises** triees par `nom ASC`. Aucune recherche dans le `Select`. Workaround si > 100 : creer le contact sans entreprise puis editer via API.

**Validation cote client** : bouton **Enregistrer** desactive tant que `prenom` ou `nomFamille` est vide.

### 2.7 Modale de modification « Modifier le contact »

Source : `ContactsPage.tsx:382-416`. Identique a la modale de creation **plus** champs **Fonction** et **Departement**. Pre-rempli par `openEdit(contact)`. Memes validations (`prenom` + `nomFamille` non vides).

### 2.8 Suppression

`window.confirm('Supprimer ce contact ?')` puis `DELETE /contacts/{id}`. Pas de soft-delete. **Pas de protection FK** : aucun ON DELETE CASCADE / SET NULL cote application. Comportement reel depend de la DDL Postgres (probablement orphelins). Verifier en preprod.

### 2.9 Notifications utilisateur

`Alert type="success"` apres creation/modification ; `Alert type="error"` sur 500 / erreurs reseau. Pas de toast pour la suppression (rafraichissement silencieux).

---

## 3. Workflows pas-a-pas

### 3.1 Creer un contact rattache a une entreprise

1. `/contacts` -> bouton **Nouveau Contact**.
2. Saisir **Prenom** et **Nom de famille** (obligatoires).
3. Selectionner l **Entreprise** dans le dropdown (100 premieres triees alpha).
4. Renseigner email, telephone, mobile, role/fonction, adresse si pertinent.
5. **Enregistrer** -> `POST /contacts` -> insertion + retour `{id, message}`.
6. Banner « Contact enregistre. », liste rafraichie.

### 3.2 Creer un contact autonome (sans entreprise)

Meme chemin, laisser **Entreprise** sur `-- Selectionner --`. Frontend envoie `companyId: null`. Backend normalise `<= 0` a `NULL` (`companies.py:497-498`). Colonne Entreprise affiche `--` dans la liste.

### 3.3 Rattacher un contact existant a une entreprise

1. Bouton **Modifier** (icone `Pencil`) sur la ligne.
2. Choisir l entreprise dans le `Select`.
3. **Enregistrer** -> `PUT /contacts/{id}` avec `{ companyId: X }`.

### 3.4 Modifier les coordonnees d un contact

Bouton **Modifier** -> editer email / telephone / mobile / adresse -> **Enregistrer**. Backend : seuls les champs envoyes (`exclude_unset=True`) sont mis a jour. Filtrage par `ALLOWED_COLS` (`companies.py:549-551`).

> **Champs autorises a la modification** : `company_id`, `prenom`, `nom_famille`, `email`, `telephone`, `mobile`, `role_poste`, `fonction`, `departement`, `adresse`, `ville`, `province`, `code_postal`, `est_principal`, `notes`.

### 3.5 Definir un contact comme **principal** d une entreprise

Deux mecanismes coexistent et **peuvent diverger** :

- **Methode A** — `companies.contact_principal_id` : `/entreprises` -> editer entreprise -> selectionner le contact dans « Contact principal » -> `PUT /companies/{id}` avec `contactPrincipalId: X`.
- **Methode B** — `contacts.est_principal` : pas de toggle UI. Necessite `PUT /contacts/{id}` avec `{ "est_principal": true }`. Active le badge bleu **Principal** dans la liste. La fiche entreprise (`GET /companies/{id}`) trie ses contacts `ORDER BY est_principal DESC, nom_famille ASC` (`companies.py:258`).

Bonne pratique : maintenir les deux a jour manuellement.

### 3.6 Rechercher un contact

Champ recherche en haut a droite -> saisir prenom, nom complet, ou email -> `GET /contacts?search=<terme>&page=1`. Backend : `LIKE '%terme%'` insensible a la casse sur `prenom + ' ' + nom_famille` et `email`. Bouton **Effacer** remet a zero.

> **Limites** : pas de recherche par entreprise, role, telephone, ville (malgre le placeholder qui suggere « entreprise, role »).

### 3.7 Supprimer un contact

Bouton **X** rouge -> confirmation `window.confirm` -> `DELETE /contacts/{id}`. Si references existantes (`opportunities.contact_id`, etc.), comportement DB-dependant. **Recommandation** : vider les coordonnees plutot que supprimer pour conserver les liens historiques.

### 3.8 Lister les contacts d une entreprise specifique

- **API** : `GET /contacts?company_id=X` (parametre supporte `companies.py:417`).
- **Fiche entreprise** : `GET /companies/{id}` retourne `result["contacts"]` trie par `est_principal DESC, nom_famille ASC`.
- **UI Contacts** : pas de filtre par entreprise — passer par `/entreprises/{id}`.

---

## 4. Reference

### 4.1 Modele complet `contacts` (table PostgreSQL)

| Colonne                | Type                  | Obligatoire | Notes                                                                 |
|------------------------|-----------------------|-------------|-----------------------------------------------------------------------|
| `id`                   | SERIAL PRIMARY KEY    | --          | Auto-increment                                                        |
| `company_id`           | INTEGER (nullable)    | Non         | FK `companies.id`. NULL si <= 0 envoye                                |
| `prenom`               | TEXT                  | **Oui**     | Validateur `_strip_non_empty` rejette `''` et `'   '`                 |
| `nom_famille`          | TEXT                  | **Oui**     | Idem                                                                  |
| `email`                | TEXT                  | Non         | Aucune validation format                                              |
| `telephone`            | TEXT                  | Non         | Aucune normalisation (10 chiffres ou format libre)                    |
| `mobile`               | TEXT                  | Non         | Distinct de `telephone`                                               |
| `role_poste`           | TEXT                  | Non         | Ex. « Directeur des achats »                                          |
| `fonction`             | TEXT                  | Non         | Champ libre complementaire                                            |
| `departement`          | TEXT                  | Non         | Ex. « Comptabilite »                                                  |
| `adresse`              | TEXT                  | Non         | DDL ajoute a la volee                                                 |
| `ville`                | VARCHAR(100)          | Non         | DDL ajoute a la volee                                                 |
| `province`             | VARCHAR(50)           | Non         | DDL ajoute a la volee                                                 |
| `code_postal`          | VARCHAR(20)           | Non         | DDL ajoute a la volee                                                 |
| `est_principal`        | BOOLEAN               | Non         | Defaut `false`. Pas de toggle UI                                      |
| `notes`                | TEXT                  | Non         | Texte libre                                                           |
| `created_at`           | TIMESTAMP             | --          | `CURRENT_TIMESTAMP` a la creation. Pas de `updated_at`                |

> **Important** : la table **n a pas** de colonnes `updated_at`, `updated_by`, `deleted_at`. Aucun audit log.

### 4.2 Mapping camelCase frontend <-> snake_case backend

Conventions : `companyId` <-> `company_id` ; `nomFamille` <-> `nom_famille` ; `rolePoste` <-> `role_poste` ; `codePostal` <-> `code_postal` ; `estPrincipal` <-> `est_principal` ; `companyNom` <-> `company_nom` (alias calcule par `LEFT JOIN companies`) ; `createdAt` <-> `created_at` (ISO string). Les autres champs partagent le meme nom (prenom, email, telephone, mobile, fonction, departement, adresse, ville, province, notes).

### 4.3 Endpoints API

Source : `backend/routers/companies.py:414-614`. Tous les endpoints exigent l authentification (`get_current_user`) + un `user.schema` non vide.

#### 4.3.1 `GET /contacts` — Lister

| Parametre    | Type   | Defaut | Notes                                                  |
|--------------|--------|--------|--------------------------------------------------------|
| `page`       | int    | 1      | min 1                                                  |
| `per_page`   | int    | 20     | min 1, max 100                                         |
| `search`     | string | --     | LIKE sur `prenom + nom_famille` + `email` (insensible) |
| `company_id` | int    | --     | Filtre exact par entreprise                            |

Reponse 200 : `{ items, total, page, per_page }`. Tri : `ORDER BY c.nom_famille ASC` (immuable cote SQL). Le champ enrichi `company_nom` provient d un `LEFT JOIN companies`.

#### 4.3.2 `POST /contacts` — Creer

Body : `ContactCreate` (cf. modele 4.1, 16 colonnes). Reponse 200 : `{ id, message: "Contact créé" }`.

Validations :
- `prenom` et `nom_famille` non vides apres `strip()` (sinon HTTP 422 Pydantic).
- `company_id <= 0` -> normalise a `NULL`.
- Pas de validation d unicite (doublons autorises).

#### 4.3.3 `PUT /contacts/{id}` — Modifier

Body : `ContactUpdate` (tous champs optionnels, `exclude_unset=True`). Filtrage backend par `ALLOWED_COLS` (`companies.py:549-551`). Reponse 200 : `{ message: "Contact mis à jour" }`.

Erreurs : 400 « Aucun champ a modifier » si payload vide ; 400 « Contexte tenant manquant » si schema absent ; 500 sur exception SQL.

#### 4.3.4 `DELETE /contacts/{id}` — Supprimer

Reponse 200 : `{ message: "Contact supprimé" }`. **Aucune verification** prealable des FK orphelines. Suppression brute.

### 4.4 Pagination

Identique a Companies / Opportunities :
- `page >= 1` (defaut 1)
- `per_page` 1-100 (defaut 20)
- Reponse : `{ items, total, page, per_page }`

### 4.5 Tri (cote client)

Hook `useSortable` (`@/hooks/useSortable`) :
- `sortConfig: { key, direction }`
- `requestSort(key)` toggle asc/desc
- Tri **uniquement sur la page courante** (pas de re-fetch)

Cles de tri activees : `prenom`, `companyNom`, `rolePoste`, `email`, `telephone`.

### 4.6 Validations

| Niveau                  | Regle                                              | Effet                                  |
|-------------------------|----------------------------------------------------|----------------------------------------|
| Frontend                | Bouton Enregistrer disabled si prenom/nom vides    | Empeche la soumission                  |
| Pydantic                | `_strip_non_empty` sur `prenom`, `nom_famille`     | HTTP 422 si vide ou whitespace seul    |
| Backend                 | `company_id <= 0` -> NULL                          | Aucune erreur, normalisation silencieuse |
| Backend                 | `user.schema` absent                               | HTTP 400 « Contexte tenant manquant »  |
| BD                      | DDL `_ensure_contact_address_cols` au premier acces | Migration auto                         |

### 4.7 Fichier API client

`frontend/src/api/companies.ts` exporte :
- `listContacts({ companyId?, page?, perPage?, search? })` -> `{ items, total, page, perPage }`
- `createContact(body: ContactCreate)` -> `{ id }`
- `updateContact(id, body: Partial<ContactCreate>)` -> void
- `deleteContact(id)` -> void

> Pas de fichier `api/contacts.ts` dedie : le code partage `api/companies.ts` avec les Entreprises.

### 4.8 Composants UI et hooks

Composants : `Button`, `Input`, `Select`, `Textarea`, `Card`, `Modal` (size `lg`), `Badge`, `Pagination`, `SkeletonPage`, `Alert`, `CommandBar`, `StatCard`, `SortableHeader`.

Hooks personnalises : `useSortable(items)` -> `{ sortedItems, sortConfig, requestSort }` ; `useColumnResize(defaults)` -> `{ colWidths, startResize, autoFit }`.

Utilitaires : `formatPhone(telephone)` (`@/utils/format`) — formate ex. `5145551234` en `(514) 555-1234`.

---

## 5. Integrations & FAQ

### 5.1 Integration avec Entreprises (manuel 16)

- Un contact peut pointer vers une entreprise via `company_id` (FK nullable). Une entreprise peut designer un **contact principal** via `companies.contact_principal_id`.
- Les deux liens sont **independants** : `contact_principal_id = X` n implique pas `contacts.est_principal = true`.
- Suppression d entreprise = soft-delete (statut `Inactif`). Les contacts rattaches restent. La page Contacts continue d afficher leur `companyNom`.

### 5.2 Integration avec Opportunites / CRM (manuel 03)

- `opportunities.contact_id` (`crm.py:516, 681`) : contact rattache a l opportunite, joint via `LEFT JOIN contacts ct`.
- **Lead scoring auto** : +10 points si `contact_id` renseigne (`crm.py:1620`).
- Conversion opportunite -> devis : reprend `contact_id` -> `devis.client_contact_id` (`crm.py:1089`).
- `interactions.contact_id` et `crm_activities.contact_id` : chaque appel/email/reunion peut cibler un contact precis.

### 5.3 Integration avec Devis (manuel 04)

`devis.client_contact_id` : pointeur vers le contact de reference. Selection dropdown a la creation manuelle, copie automatique a la conversion opportunite -> devis. Le devis affiche `client_contact_nom` via `LEFT JOIN contacts ct ON d.client_contact_id = ct.id`.

### 5.4 Integration avec Projets, Contrats

- `projects.client_contact_id` : repris depuis le devis a la promotion devis -> projet (`devis.py:3471, 3481`).
- `contracts.client_contact_id` : pointeur vers le signataire du contrat, selection a la creation.

### 5.5 Integration avec Emails (manuel 25)

`emails.contact_id` : un email entrant est **rapproche automatiquement** d un contact existant si l adresse expediteur correspond a `contacts.email` (`emails.py:2266-2306`). Aucun rapprochement par telephone ou nom. Si plusieurs contacts partagent le meme email, le premier trouve l emporte.

### 5.6 Integration avec Dossiers (manuel 08)

**Pas de FK directe** `dossier.contact_id`. Un dossier est rattache a une entreprise via `client_company_id`. Pour les contacts d un dossier : remonter via `GET /companies/{id}` -> `contacts[]`.

### 5.7 FAQ

**Q1. Placeholder recherche trompeur ?**

Oui. Le placeholder mentionne « entreprise, role » mais la requete SQL ne couvre que `prenom + nom_famille` et `email` (`companies.py:441-442`). Considerer comme un bug UI a corriger.

**Q2. Suppression en lot de contacts ?**

Pas de selection multiple. Boucler `DELETE /contacts/{id}` via script, ou SQL direct.

**Q3. Le contact recoit-il les notifications de l ERP ?**

**Non.** Les contacts sont des donnees clients, pas des comptes. Aucune notification automatique. Pour envoyer un email manuellement, utiliser le module Emails (manuel 25).

**Q4. Suppression d un contact lie a une opportunite ?**

DELETE brut (`companies.py:598`). Comportement DB-dependant : RESTRICT -> 500 ; SET NULL -> FK a NULL ; CASCADE -> cascade (improbable). Prudence : vider les coordonnees plutot que supprimer.

**Q5. Pourquoi `est_principal` est visible (badge) mais non modifiable depuis l UI ?**

Choix de design. Le backend accepte le champ dans `ContactUpdate` et `ALLOWED_COLS`. Pour l activer, appel API direct `PUT /contacts/{id}` avec `{ "est_principal": true }`.

**Q6. L adresse du contact est-elle utilisee pour la facturation ou la livraison ?**

**Non.** Les adresses de facturation/livraison sont stockees au niveau entreprise ou directement dans devis/facture/BC. L adresse du contact est purement informative.

**Q7. Comment marquer un contact comme « decideur » ?**

Pas de champ dedie. Workarounds : (1) `role_poste` = « Decideur » ; (2) preciser dans `notes` ; (3) utiliser la **grille BAT** au niveau opportunite (manuel 06 section 3.7) pour qualifier la dimension « Autorite ».

**Q8. Les memes coordonnees peuvent-elles exister chez plusieurs contacts ?**

Oui. Aucune contrainte d unicite cote BD ni de detection cote application.

**Q9. Import / export de contacts ?**

Pas d outil d import/export dans l UI. Solutions : script Python qui boucle sur `POST /contacts` ou `GET /contacts?page=...` ; ou SQL direct `COPY contacts FROM/TO '/tmp/file.csv' CSV HEADER;` apres `SET search_path TO <tenant_schema>, public;` (acces admin).

**Q10. Pourquoi le dropdown Entreprise n affiche pas toutes mes entreprises ?**

`fetchCompanies` appelle `listCompanies({ perPage: 100 })`. Limite a 100 entreprises triees alpha. Workaround : creer le contact sans entreprise puis editer via API.

**Q11. Pourquoi les statistiques d entreprises distinctes paraissent basses ?**

La stat « Entreprises » utilise `new Set(...)` sur les `companyId` **uniquement sur les 20 contacts visibles**, pas sur le total tenant.

**Q12. Le contact principal d une entreprise est-il pre-rempli automatiquement dans les opportunites / devis ?**

**Non.** Pas de pre-remplissage automatique. A la conversion opportunite -> devis, le `contact_id` est copie depuis l opportunite. Le rapprochement email se fait par email exact, pas via le contact principal.

**Q13. Donner acces ERP a un contact ?**

**Pas possible.** Un contact n est pas un compte utilisateur. Pour donner acces a l ERP : Administration (manuel 14) -> Utilisateurs.

**Q14. Contact qui change d entreprise ?**

Trois options : (1) modifier `company_id` vers la nouvelle entreprise (perte d historique), (2) creer un nouveau contact (doublonne les coordonnees), (3) modifier `company_id` + noter dans `notes`. Aucune option automatisee.

**Q15. Difference entre `role_poste`, `fonction` et `departement` ?**

Aucune semantique formelle. Convention typique : `role_poste` = titre exact (« Directeur des achats ») ; `fonction` = description generique (« Direction ») ; `departement` = unite organisationnelle (« Achats »). La liste affiche uniquement `role_poste` ; `fonction` et `departement` sont visibles seulement en modale d edition.

**Q16. Le badge « Principal » reflete-t-il `companies.contact_principal_id` ?**

**Non.** Le badge bleu `Principal` reflete uniquement `contacts.est_principal = true`, pas le pointeur cote entreprise. Si `companies.contact_principal_id` pointe vers le contact mais que `contacts.est_principal = false`, aucun badge n apparait.

**Q17. Combien de contacts maximum ?**

Pas de limite hard-codee. La pagination accepte `per_page <= 100`. Limite pratique = performance Postgres + couts stockage.

---

## 6. Recap one-pager

- **URL** : `/contacts` — sidebar groupe **Gestion**.
- **Routeur backend** : `companies.py` (614 lignes) — 4 endpoints `/contacts` GET/POST/PUT/DELETE.
- **Page frontend** : `ContactsPage.tsx` (419 lignes) — liste + 2 modales, pas de fiche detail dediee.
- **API client** : `companies.ts` (partage avec Entreprises).
- **Table BD** : `contacts` (16 colonnes apres migration auto via `_ensure_contact_address_cols`).
- **Multi-tenant** : isolation par schema PostgreSQL (`db.set_tenant`).
- **Champs obligatoires** : `prenom`, `nom_famille` (validateur `_strip_non_empty`).
- **Distinction telephone vs mobile** : 2 colonnes BD distinctes.
- **3 champs role** : `role_poste`, `fonction`, `departement` (semantique libre).
- **Rattachement entreprise** : `company_id` nullable, dropdown limite a **100 premieres entreprises**.
- **Recherche** : LIKE sur `prenom + nom_famille` et `email` uniquement (placeholder UI trompeur).
- **Tri** : cote client, page courante (5 cles).
- **Pagination** : 20/page (API jusqu a 100).
- **Badge Principal** : reflete `contacts.est_principal`, non modifiable depuis l UI.
- **Suppression** : DELETE physique (pas de soft-delete contrairement aux entreprises).
- **Pas de** : import/export CSV/vCard, detection de doublons, unicite email, audit log, fusion, tags/categories, statut actif/inactif, validation format, portail contact.
- **Integrations** : `opportunities.contact_id` (CRM, +10 pts lead scoring), `devis.client_contact_id`, `projects.client_contact_id`, `contracts.client_contact_id`, `emails.contact_id` (rapprochement par email exact).

---

**Documentation generee a partir du code** : `companies.py` (614 lignes), `ContactsPage.tsx` (419 lignes), `companies.ts` (134 lignes).

**Manuels lies** :
- Module 06 (CRM — Opportunites, Interactions, BAT) — `03-crm.md`
- Module 08 (Devis et soumissions — `client_contact_id`) — `04-devis.md`
- Module 07 (Dossiers — accessible via entreprise) — `08-dossiers.md`
- Module 28 (Administration — Utilisateurs ERP, distincts des contacts) — `14-administration.md`
- Module 04 (Entreprises — `contact_principal_id`, 14 types) — `16-entreprises.md`
- Module 23 (Emails — rapprochement automatique par email) — `25-emails.md`

---

*Manuel ERP Constructo — Module Contacts — v2.0 verifie — 2026-04-26*
