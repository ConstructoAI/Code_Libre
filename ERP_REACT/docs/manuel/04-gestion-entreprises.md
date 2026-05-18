# Module 04 — Entreprises (Clients / Fournisseurs / Sous-traitants)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/companies.py` (614 lignes — partie Entreprises lignes 65-407, partie Contacts lignes 108-614), `frontend/src/pages/CompaniesPage.tsx` (676 lignes), `frontend/src/api/companies.ts`
> **Tables PostgreSQL** : `companies` (entite principale), `contacts` (entite couplee mais documentee dans le manuel 17), `b2b_clients` (sous-tableau B2B portail), `integration_entity_map` (mapping QuickBooks customers), `fournisseurs` (extension fournisseur via `company_id`)
> **Cadrage** : ce module gere le **referentiel d entites tierces** (clients, fournisseurs, sous-traitants, partenaires, organismes) qui apparaissent ensuite dans tous les autres modules (Devis, Projets, Factures, BC, etc.). Il **ne couvre PAS** : les contacts internes detailles (manuel 17), la qualification commerciale et le pipeline (manuel 06 — CRM), les attestations RBQ/CCQ rattachees aux entreprises (module Conformite, distinct), l evaluation fournisseur (module Suppliers).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface](#2-interface)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Le module **Entreprises** centralise toutes les **entites tierces** avec lesquelles l ERP interagit : clients (residentiel / commercial / industriel / municipalite), fournisseurs, sous-traitants specialises, partenaires professionnels (architecte, ingenieur, arpenteur), organismes (institutions financieres, assureurs, organismes de controle), promoteurs et entrepreneurs generaux.

L entreprise est l **agregateur 360°** vers lequel pointent : `contacts.company_id`, `opportunities.company_id`, `devis.client_company_id`, `projects.client_company_id`, `factures.client_company_id`, `fournisseurs.company_id`, `b2b_clients.company_id`, et plusieurs tables B2B (`b2b_paniers`, `b2b_favoris`, `b2b_contrats`, `b2b_notifications`).

### 1.2 Ce que le module ne fait PAS (verifie dans le code)

> **Important** : ce module reste un **referentiel CRUD relativement simple**. Il n implemente pas :
- **Validation taxes** : `numero_tps` / `numero_tvq` en TEXT libre, aucune validation format ni unicite (Revenu Quebec / ARC).
- **Verification RBQ / CCQ** : pas de champ `numero_rbq` / `numero_licence`. Attestations geres dans le module Conformite distinct.
- **Numero entreprise Quebec (NEQ)** : pas de champ dedie. A saisir dans `notes`.
- **Hierarchie / multi-sites** : 1 entreprise = 1 fiche plate. Pas de societe-mere / filiale / succursales.
- **Hard delete** : suppression UI = soft-delete (`statut = 'Inactif'`). Pas de purge via API.
- **Detection doublons** : aucun mecanisme. Deux entreprises identiques (nom / email) peuvent coexister.
- **Audit log** : seul `updated_at` est trace. Pas d historique ligne par ligne.
- **Scoring fournisseur** : `evaluation_qualite` vit dans la table `fournisseurs` (module Suppliers), pas visible ici.
- **Workflow de validation** : pas de cycle Brouillon -> Valide. Toute entreprise creee est immediatement utilisable.
- **Tags / categories libres** : seuls les enums `type_company` (14) et `secteur_activite` (18) categorisent.

### 1.3 Acces

- Sidebar -> **Entreprises** (icone `Building2`, `Sidebar.tsx:45`)
- URL : `/entreprises`
- Composant : `CompaniesPage.tsx` (defini lazy via `App.tsx:57`, route `App.tsx:171`)
- 1 seule vue principale (pas d onglets — la navigation se fait par filtres et panneau de detail laterale)

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD toutes les entreprises (`get_current_user` Depends, sans verification de role).
- **Multi-tenant strict** : `db.set_tenant(conn, user.schema)` sur chaque endpoint. Sans schema, HTTP 400 « Contexte tenant manquant ».
- Pas de roles dedies « gestionnaire de comptes », « acheteur ». Toute personne peut creer / modifier / desactiver une entreprise.

### 1.5 Articulation avec les autres modules

```
Module 04 (Entreprises)
   |
   +-- companies.id ---> contacts (Module 17)
   |                  |
   |                  +-- companies.contact_principal_id (FK retour)
   |
   +--> opportunities.company_id (Module 06 CRM)
   +--> devis.client_company_id (Module 04)
   +--> projects.client_company_id (Module 01)
   +--> factures.client_company_id (Module 07)
   +--> fournisseurs.company_id (Module Suppliers — non documente ici)
   +--> b2b_clients.company_id (Module B2B portail)
   +--> integration_entity_map (mapping QuickBooks Customer)
```

---

## 2. Interface

### 2.1 Mise en page

Source : `CompaniesPage.tsx:463-674`. Une seule vue avec 6 zones empilees :
- **En-tete** : titre « Entreprises » + bandeau d alertes (erreurs API).
- **Stats (4 cartes)** : Total / Clients / Fournisseurs / Sous-traitants (cf. 2.2).
- **CommandBar** : `+ Nouvelle entreprise`, `Rafraichir`, recherche texte, dropdown type.
- **Liste** : table desktop 5 colonnes (`Nom` 200px, `Type` 160px, `Contact` 150px, `Ville` 120px, `Actions` 80px) avec colonnes redimensionnables/triables (`useColumnResize` + `useSortable`) ; cartes mobiles (`CompaniesPage.tsx:579-612`).
- **Panneau detail** lateral (desktop) ou plein-ecran (mobile) au clic.
- **Modales** creation / edition (size lg).

Pagination 20/page (`perPage = 20`, ligne 132), max 100.

### 2.2 Bandeau de stats

Calculs frontend (`CompaniesPage.tsx:471-474`) :

| KPI               | Source                                                                |
|-------------------|------------------------------------------------------------------------|
| **Total**         | `total` retourne par l API (count global, tous types)                  |
| **Clients**       | Filtre `type_company` contient `'Client'` (sur la page courante)       |
| **Fournisseurs**  | Filtre `type_company` contient `'Fournisseur'` (sur la page courante)  |
| **Sous-traitants**| Filtre `type_company` contient `'Sous-traitant'` (sur la page courante)|

> **Limite** : les 3 derniers compteurs sont calcules **uniquement sur les 20 entreprises de la page courante**, pas sur la totalite. Pour les chiffres globaux precis, voir le tableau de bord (manuel 13).

### 2.3 Panneau de detail

Source : `CompaniesPage.tsx:308-461`.

Sections affichees au clic sur une entreprise :

| Section                    | Contenu                                                                          |
|-----------------------------|----------------------------------------------------------------------------------|
| **En-tete**                | Nom + badge type + secteur + 3 boutons (Modifier / Supprimer / Fermer)            |
| **Coordonnees**            | Email, telephone (formate), adresse complete, site web, payment_terms, notes, date creation |
| **Contacts**               | Liste si `contacts.length > 0` ; ordre `est_principal DESC, nom_famille ASC` (`companies.py:255-266`) ; badge « Principal » sur le `est_principal` |
| **Soumissions recentes**   | `GET /devis?search={company.nom}&per_page=5` -> numero + description + badge statut |
| **Projets recents**        | `GET /projects?search={company.nom}&per_page=5` -> nom + badge statut             |

> **Approche soumissions/projets** : recherche TEXTUELLE par nom, **pas** une jointure stricte sur `client_company_id`. Des documents mentionnant ce nom dans description/objet peuvent apparaitre. Pour une jointure stricte FK, passer par les modules respectifs (manuels 04, 01).
> Pour la gestion complete des contacts (creation, edition, transfert), voir le manuel **17-contacts.md**.

### 2.4 Modale Creation / Edition

Source : `renderFormFields` (`CompaniesPage.tsx:256-305`), modale `Create` (`650-660`), modale `Edit` (`662-672`).

#### 2.8.1 Champs UI

| Champ              | Obligatoire | Defaut                | Type                   |
|--------------------|-------------|-----------------------|------------------------|
| **Nom**            | OUI         | --                    | Input (bloque si vide) |
| **Type d entreprise** | OUI      | `Entrepreneur général`| Select 14 options      |
| **Secteur d activite** | NON     | vide                  | Select 18 options + vide |
| **Adresse**        | NON         | --                    | Input                  |
| **Ville**          | NON         | --                    | Input                  |
| **Province/Etat**  | NON         | `Québec`              | Input texte libre      |
| **Code postal**    | NON         | --                    | Input                  |
| **Pays**           | NON         | `Canada`              | Input texte libre      |
| **Site Web**       | NON         | --                    | Input URL libre        |
| **Contact Principal**| NON       | « Aucun »             | Dropdown contacts (limite 100) |
| **Notes**          | NON         | --                    | Textarea (3 rows)      |

#### 2.8.2 Champs API ABSENTS du formulaire UI (bug / lacune)

Source : `companies.py:65-105` vs `CompaniesPage.tsx:256-305`.

> **Bug** : ces champs existent en backend mais **ne peuvent PAS etre saisis** via UI. Workaround : `PUT /companies/{id}` direct (API / MCP / SQL).

| Champ            | Type | Defaut    | Notes                                                       |
|------------------|------|-----------|-------------------------------------------------------------|
| **email**        | TEXT | NULL      | Visible en liste mais non editable UI                       |
| **telephone**    | TEXT | NULL      | Visible en liste mais non editable UI                       |
| **numero_tps**   | TEXT | NULL      | TPS Canada/ARC (suggerer format `123456789RT0001`)          |
| **numero_tvq**   | TEXT | NULL      | TVQ Revenu Quebec (suggerer format `1234567890TQ0001`)      |
| **payment_terms**| TEXT | `Net 30`  | Conditions de paiement (texte libre)                        |
| **statut**       | TEXT | `Actif`   | `Inactif` apres soft-delete                                 |

#### 2.8.3 Bouton Enregistrer

Disabled si `!form.nom.trim()`. Au clic : `POST /companies` ou `PUT /companies/{id}`. Apres succes : modale fermee, liste rechargee, formulaire reset (creation).

### 2.5 14 types d entreprise (`type_company`)

Source : `CompaniesPage.tsx:36-51` (`TYPE_ENTREPRISE_OPTIONS`).

| #   | Valeur DB                  | Couleur | Cas d usage                                |
|-----|----------------------------|---------|---------------------------------------------|
| 1   | `Entrepreneur general`     | Bleu    | Defaut. GC orchestrant sous-traitants       |
| 2   | `Sous-traitant specialise` | Violet  | Couvreur, plombier, electricien...          |
| 3   | `Promoteur immobilier`     | Jaune   | Developpeur projets condos / locatifs       |
| 4   | `Fournisseur materiaux`    | Vert    | Quincaillerie, beton, bois, acier           |
| 5   | `Consultant/Ingenieur`     | Bleu    | Ingenieur civil, structure, mecanique       |
| 6   | `Architecte`               | Bleu    | Cabinet d architecture                       |
| 7   | `Arpenteur-geometre`       | Gris    | Arpentage / certificat localisation         |
| 8   | `Organisme de controle`    | Gris    | RBQ, CNESST, municipalites de controle      |
| 9   | `Institution financiere`   | Gris    | Banque, caisse populaire, courtier hypoth.  |
| 10  | `Assureur`                 | Gris    | Compagnie d assurance (chantier, RC)        |
| 11  | `Client residentiel`       | Bleu    | Particulier proprietaire                    |
| 12  | `Client commercial`        | Bleu    | Entreprise / commerce (B2B)                 |
| 13  | `Client industriel`        | Bleu    | Usine, parc industriel                      |
| 14  | `Municipalite`             | Gris    | Ville / canton / MRC (donneur public)       |

> **Note encodage** : les libelles UI portent les accents (`Entrepreneur général` etc.). Le filtre exact backend (`type_filter = %s`) impose la version accentuee. Les libelles sans accents dans cette doc sont juste typographiques.

### 2.6 18 secteurs d activite (`secteur_activite`)

Source : `CompaniesPage.tsx:54-74` (`SECTEUR_OPTIONS`, plus l option vide).

Liste exacte (18 valeurs selectionnables + option vide « Selectionner un secteur ») :

1. Construction residentielle
2. Construction commerciale
3. Construction industrielle
4. Renovation residentielle
5. Renovation commerciale
6. Excavation et terrassement
7. Fondations specialisees
8. Charpenterie generale
9. Couverture et toiture
10. Plomberie et chauffage
11. Electricite du batiment
12. Isolation et etancheite
13. Revetements exterieurs
14. Finition interieure
15. Amenagement paysager
16. Demolition
17. Location d equipements
18. Transport construction

Les libelles BD comportent les accents (`Construction résidentielle`, etc.).

### 2.7 Filtres backend

Source : `companies.py:180-189`.

- **Recherche** : `LOWER(nom) LIKE %s OR LOWER(email) LIKE %s OR LOWER(ville) LIKE %s` — wildcard `%search%`, insensible casse. **Aucune recherche** sur telephone, code_postal, notes, secteur_activite, numero_tps/tvq.
- **Filtre Type** : `type_company = %s` — egalite stricte (sensible casse + accents).
- Combinaison via `AND`.

---

## 3. Workflows pas-a-pas

### 3.1 Creer une entreprise (procedure standard)

1. Sidebar -> **Entreprises** (URL `/entreprises`) -> bouton **+ Nouvelle entreprise**.
2. Saisir :
   - **Nom** (obligatoire, validateur Pydantic strip + non vide)
   - **Type** (defaut `Entrepreneur général` — choisir parmi les 14 types selon nature de la relation)
   - **Secteur d activite** (optionnel, plus pertinent pour fournisseurs/sous-traitants que pour clients)
   - Adresse, ville, province (defaut `Québec`), code postal, pays (defaut `Canada`)
   - Site web, contact principal (dropdown), notes
3. **Enregistrer** -> `POST /companies` -> `INSERT INTO companies (...) RETURNING id` (`companies.py:297-309`).
4. **Aucun numero auto-genere** (contrairement aux dossiers `DOS-`, devis `DEV-`, opportunites `OPP-`).
5. La liste est rechargee.

### 3.2 Cas particuliers selon le type

| Type cible              | Type a choisir              | Secteur                         | Suite recommandee                                  |
|-------------------------|------------------------------|----------------------------------|----------------------------------------------------|
| **Client commercial**   | `Client commercial`          | --                               | Saisir TPS/TVQ/payment_terms via API (cf. 3.10)   |
| **Client residentiel**  | `Client residentiel`         | --                               | Souvent un proprietaire particulier               |
| **Fournisseur**         | `Fournisseur matériaux`      | Secteur du materiau              | Module **Suppliers** : creer fiche `fournisseurs` enrichie pour debloquer BC/evaluation qualite |
| **Sous-traitant**       | `Sous-traitant spécialisé`   | Secteur (Plomberie, Electricite) | Module **Conformite** : rattacher RBQ/CCQ/CNESST (`notes` pour ref rapide) |
| **Municipalite**        | `Municipalité`               | --                               | Notes pour appels d offres recurrents             |
| **Promoteur immo**      | `Promoteur immobilier`       | --                               | Lien Module 19 Immobilier via texte libre        |

> **Important** : la creation d une entreprise de type `Fournisseur matériaux` **ne genere PAS automatiquement** une fiche `fournisseurs` enrichie (code fournisseur, evaluation, conditions paiement specifiques). Aller dans le module Suppliers pour cela.

### 3.5 Modifier une entreprise

1. Cliquer sur la ligne dans la liste -> panneau detail s ouvre.
2. Bouton **Modifier** (icone Pencil) -> modale d edition.
3. Modifier les champs (le formulaire est pre-rempli).
4. Bouton **Enregistrer**.
5. Backend : `PUT /companies/{id}` (`companies.py:329-374`).
6. Whitelist colonnes modifiables (`ALLOWED_COLS` ligne 337) : `nom`, `type_company`, `secteur_activite`, `email`, `telephone`, `adresse`, `ville`, `province`, `code_postal`, `pays`, `site_web`, `contact_principal_id`, `numero_tps`, `numero_tvq`, `payment_terms`, `notes`, `statut`.
7. Toute autre cle est silencieusement ignoree.
8. `updated_at = CURRENT_TIMESTAMP` automatique.

> **Bug formulaire** : l email et le telephone ne sont pas dans le formulaire UI. Pour les corriger, utiliser `PUT /companies/{id}` directement avec `{"email": "...", "telephone": "..."}`.

### 3.6 Supprimer (desactiver) une entreprise

1. Panneau detail -> bouton **Supprimer** (icone Trash2 rouge).
2. Pop-up de confirmation : « Voulez-vous vraiment supprimer cette entreprise ? ».
3. Confirmer.
4. Backend : `DELETE /companies/{id}` (`companies.py:377-407`).
5. **Soft-delete** : `UPDATE companies SET statut = 'Inactif', updated_at = CURRENT_TIMESTAMP WHERE id = %s`.
6. La fiche n est jamais purgee. Tous les FK existants (devis, projets, factures, opportunites) restent intacts.
7. Le panneau detail se ferme et la liste se recharge.

> **Aucun filtrage frontend ni backend** n exclut les entreprises `statut = 'Inactif'` de la liste : elles continuent d apparaitre. Pour les masquer, utiliser le filtre Type ou la recherche.
> **Pas de hard-delete** : pour purger physiquement, intervention SQL directe necessaire (avec verification prealable des FK : `devis`, `projects`, `factures`, `opportunities`, `b2b_clients`, `fournisseurs`, etc.).

### 3.7 Designer un contact principal

Le contact principal pointe **depuis l entreprise** vers un contact (FK `companies.contact_principal_id`).

1. Pre-requis : creer le contact d abord (manuel 05, ou la modale Contacts au sein du module CRM).
2. Modifier l entreprise -> dropdown **Contact Principal** -> selectionner.
3. Le contact apparait avec son nom et entre parentheses le nom de son entreprise (si differente).
4. Enregistrer.
5. Affichage : badge bleu « Principal » sur la fiche du contact dans le panneau detail.

> **Distinction** : il existe AUSSI un boolean `contacts.est_principal` (cote contact). Les deux mecanismes ne sont pas synchronises automatiquement. Voir manuel 05 pour la difference.

### 3.8 Consulter les soumissions / projets recents d une entreprise

1. Cliquer sur la ligne dans la liste -> panneau detail.
2. Sections **Soumissions recentes** et **Projets recents** chargent automatiquement (limite 5 chacune).
3. Recherche par nom de l entreprise (textuelle, pas sur FK strict).
4. Pour la liste exhaustive : passer par les modules respectifs avec filtre par client.

### 3.9 Filtrer la liste

1. CommandBar -> dropdown **Type** -> selectionner ou « Tous les types ».
2. CommandBar -> champ recherche -> saisir un mot (nom, email, ville).
3. Les deux filtres se combinent (AND backend).
4. Pagination repart a la page 1 a chaque changement de filtre.

### 3.10 Saisir les numeros TPS / TVQ d un client (workaround UI)

Ces champs ne sont pas exposes dans le formulaire UI. 3 options :

- **API directe** (recommandee) :
```http
PUT /companies/{id}
{ "numero_tps": "123456789RT0001", "numero_tvq": "1234567890TQ0001", "payment_terms": "Net 60" }
```
- **Outil MCP** `modifier_entreprise` (passe par le meme endpoint).
- **SQL DBA** si acces direct au schema PostgreSQL du tenant.

### 3.11 Reactiver une entreprise (statut Inactif -> Actif)

Aucun bouton UI. Workaround : `PUT /companies/{id}` avec body `{"statut": "Actif"}`. Confirmer en consultant a nouveau la fiche.

### 3.12 Synchroniser vers QuickBooks

Pre-requis : connection QuickBooks active (module Integration, manuel 14). Sync en mode batch via `_sync_companies_to_qb` (`integration.py:794-880`) :
- Filtre : `WHERE c.active = TRUE` (note : utilise `active` et non `statut`)
- Limite 100 par batch
- Mapping : `integration_entity_map (entity_type='customer', local_id, external_id)`
- Champs synces : `nom -> DisplayName/CompanyName`, `email -> PrimaryEmailAddr`, `telephone -> PrimaryPhone`, `adresse/ville/province/code_postal -> BillAddr` (Country=CA fixe).

> **Discordance** : la condition `c.active = TRUE` differe du soft-delete `statut = 'Inactif'` du module. Les deux colonnes peuvent coexister sur certains schemas. Verifier en prod selon besoin.

---

## 4. Reference

### 4.1 Modele complet `companies`

| Colonne BD             | Type      | Defaut                 | Notes                                                |
|------------------------|-----------|------------------------|------------------------------------------------------|
| `id`                   | SERIAL PK | AUTO                   | --                                                   |
| `nom`                  | TEXT      | --                     | **Obligatoire** (Pydantic strip + non vide)          |
| `type_company`         | TEXT      | `Entrepreneur général` | 14 valeurs (cf. 2.9)                                 |
| `secteur_activite`     | TEXT      | NULL                   | 18 valeurs (cf. 2.10)                                |
| `email`                | TEXT      | NULL                   | Pas de validation format                             |
| `telephone`            | TEXT      | NULL                   | Formate frontend (`formatPhone`)                     |
| `adresse, ville`       | TEXT      | NULL                   | --                                                   |
| `province`             | TEXT      | `Québec`               | --                                                   |
| `code_postal`          | TEXT      | NULL                   | Pas de validation format                             |
| `pays`                 | TEXT      | `Canada`               | --                                                   |
| `site_web`             | TEXT      | NULL                   | --                                                   |
| `contact_principal_id` | INT       | NULL                   | FK `contacts.id` (nullable)                          |
| `numero_tps, numero_tvq`| TEXT     | NULL                   | Texte libre                                          |
| `payment_terms`        | TEXT      | `Net 30`               | --                                                   |
| `notes`                | TEXT      | NULL                   | --                                                   |
| `statut`               | TEXT      | `Actif`                | `Inactif` apres soft-delete                          |
| `created_at, updated_at`| TIMESTAMP| CURRENT_TIMESTAMP      | `updated_at` mis a jour a chaque PUT                 |
| `active` (legacy)      | BOOLEAN   | TRUE                   | Possible sur certains schemas — utilisee par sync QuickBooks (`integration.py:807`) |

### 4.2 Endpoints API

Source : `companies.py:154-407`.

| Methode | URL                       | Description                              | Body / Params                                  |
|---------|---------------------------|------------------------------------------|------------------------------------------------|
| GET     | `/companies`              | Liste paginee + recherche + filtre type  | `page`, `per_page` (1-100), `limit` (alias), `search`, `type_filter` |
| GET     | `/companies/{id}`         | Detail + contacts ordonnes               | --                                             |
| POST    | `/companies`              | Creer une entreprise                     | `CompanyCreate` (nom obligatoire)              |
| PUT     | `/companies/{id}`         | Mettre a jour (whitelist 17 colonnes)    | `CompanyUpdate` (tous champs optionnels)       |
| DELETE  | `/companies/{id}`         | Soft-delete (`statut = 'Inactif'`)       | --                                             |

> Les endpoints `/contacts*` font partie du meme router `companies.py` mais sont documentes dans le **manuel 05 — Contacts**.

### 4.3 Pagination

| Parametre   | Defaut | Min | Max | Notes                                       |
|-------------|--------|-----|-----|---------------------------------------------|
| `page`      | 1      | 1   | --  | Index 1                                     |
| `per_page`  | 20     | 1   | 100 | Limite par page                             |
| `limit`     | --     | 1   | 100 | **Alias de `per_page`** (cross-router convention, `companies.py:159`) |

Reponse :
```json
{
  "items": [...],
  "total": 142,
  "page": 1,
  "per_page": 20
}
```

### 4.4 Validations Pydantic

Source : `companies.py:18-29` (`_strip_non_empty`).

- **`nom`** (POST + PUT) : strip + non vide -> HTTP 422 « Ne peut pas etre vide ».
- **`type_company`, `secteur_activite`, `email`, `numero_tps/tvq`** : aucune validation enum / format. Tout texte accepte.
- **Pagination** : `page >= 1`, `per_page` 1-100 (sinon HTTP 422).
- **Tenant** : pas de `user.schema` -> HTTP 400 « Contexte tenant manquant ».

### 4.5 Constantes UI (TypeScript)

| Constante                  | Source                       | Valeurs                                   |
|----------------------------|------------------------------|-------------------------------------------|
| `TYPE_ENTREPRISE_OPTIONS`  | `CompaniesPage.tsx:36-51`    | 14 types                                  |
| `SECTEUR_OPTIONS`          | `CompaniesPage.tsx:54-74`    | 18 secteurs + option vide                 |
| `FILTER_TYPE_OPTIONS`      | `CompaniesPage.tsx:77-80`    | « Tous les types » + 14 types             |
| `TYPE_COLORS`              | `CompaniesPage.tsx:82-96`    | Mapping type -> couleur badge             |

### 4.6 Limites & contraintes

- **Doublons** : aucune contrainte UNIQUE (nom / email / TPS). Doublons autorises.
- **`type_company` hors enum** : accepte (pas de CHECK constraint connue).
- **Suppression avec FK actifs** : aucun blocage (soft-delete OK, FK conserves).
- **Hard-delete SQL** : risque CASCADE / FK error sur `devis`, `projects`, `factures`, `opportunities`, `b2b_clients`, `fournisseurs`.

### 4.7 Differences avec le module CRM (manuel 03)

| Aspect                | M04 Entreprises                   | M06 CRM                                       |
|-----------------------|------------------------------------|-----------------------------------------------|
| Focus                 | Referentiel CRUD entites tierces  | Cycle commercial (pipeline, BAT, scoring)     |
| URL                   | `/entreprises`                    | `/ventes`                                     |
| Workflows auto        | Aucun                              | OPP-XXXXX, dossier auto, scoring auto         |
| Conversion vers Devis | Non                                | Oui (`/crm/opportunities/{id}/create-devis`)  |

---

## 5. Integrations & FAQ

### 5.1 Tableau des liens FK

| Module / Manuel              | FK source                          | Notes                                                     |
|-------------------------------|------------------------------------|-----------------------------------------------------------|
| **Contacts (M05)**            | `contacts.company_id`              | 1 entreprise -> N contacts ; `companies.contact_principal_id` pointeur retour |
| **CRM (M06)**                 | `opportunities.company_id`         | Pipeline, BAT, scoring : voir manuel 06                   |
| **Devis (M08)**               | `devis.client_company_id`          | Snapshot `client_nom_cache` a la creation (pas de refresh)|
| **Projets (M09)**             | `projects.client_company_id`       | Refs `projects.py:262, 267, 475, 678`                     |
| **Factures (M15)**            | `factures.client_company_id`       | Obligatoire (`accounting.py:704`); lookup nom a creation  |
| **Suppliers**                 | `fournisseurs.company_id`          | Enrichissement : `code_fournisseur`, `evaluation_qualite` (1-5), `conditions_paiement`, `categorie_produits` |
| **Portail B2B**               | `b2b_clients.company_id`           | Plus `b2b_paniers/favoris/contrats/notifications.client_company_id` |
| **QuickBooks (M28)**          | `integration_entity_map (customer)`| Sync filtre `c.active = TRUE`, batch 100, mapping `BillAddr` (Country=CA) |
| **Conformite**                | --                                 | RBQ/CCQ/CNESST geres dans router `conformite.py` distinct, pas dans companies |
| **Dossiers (M07)**            | (textuel via `client_nom_cache`)   | A la conversion opportunite, dossier `DOS-OPP-XXXXX` auto-cree |

### 5.2 Notes integrations critiques

- **Une meme entreprise peut etre client ET fournisseur** : `companies.id` partagee entre `factures.client_company_id` et `fournisseurs.company_id`. Pas de duplication, 2 fiches d enrichissement.
- **Snapshot vs live** : devis et factures gardent un `client_nom_cache`. Renommer l entreprise ne met PAS a jour les documents emis. Reediter au cas par cas.
- **Discordance soft-delete** : la sync QuickBooks utilise `c.active = TRUE` (`integration.py:807`), pas `statut = 'Actif'`. Verifier coherence en prod.
- **Pas de FK directe Dossiers** : l association se fait via le `client_nom_cache` du devis ou via les liens `dossier_devis`/`dossier_projets`.

### 5.3 FAQ

**Q1 : 14 types et pas 4 (Client / Fournisseur / Sous-traitant / Autre) ?**
R : Le modele cible le secteur construction Quebec : architectes, ingenieurs, arpenteurs, organismes de controle, institutions financieres et assureurs jouent des roles distincts.

**Q2 : Une entreprise peut-elle etre client ET fournisseur ?**
R : **Oui**. La meme `companies.id` peut etre referencee dans `factures.client_company_id` et `fournisseurs.company_id`. Le `type_company` est juste primaire pour le filtre. Marquer le role principal et noter l autre dans `notes`.

**Q3 : Ou ajouter le NEQ (Numero d Entreprise du Quebec) ?**
R : Aucun champ dedie. Stocker dans `notes`.

**Q4 : Pourquoi email et telephone manquent dans le formulaire ?**
R : **Bug / lacune** : `renderFormFields` (`CompaniesPage.tsx:256-305`) ne les inclut pas, alors qu ils existent en backend. Workaround : `PUT /companies/{id}` via API / MCP.

**Q5 : Suppression definitive ?**
R : Pas via UI ni API. `DELETE` fait un soft-delete (`statut = 'Inactif'`). Pour purger : SQL en DBA.

**Q6 : Suppression -> que deviennent les devis / projets / factures lies ?**
R : Rien. Le soft-delete laisse intacts tous les FK.

**Q7 : Empecher les doublons ?**
R : Aucun mecanisme automatique. Pas de UNIQUE, pas de detection frontend. Utiliser la recherche AVANT de creer.

**Q8 : Statut `Inactif` filtre automatiquement de la liste ?**
R : **Non** (`companies.py:191`). Les desactivees restent visibles. A implementer cote frontend si souhaite.

**Q9 : Recherche sur quels champs ?**
R : `nom`, `email`, `ville` (LIKE insensible casse). **Pas** sur telephone / code_postal / notes / secteur_activite / numero_tps/tvq.

**Q10 : Modifications propagees aux documents emis ?**
R : **Non**. `client_nom_cache` cote devis = snapshot a la creation. Reediter au cas par cas.

**Q11 : Import en masse (CSV) ?**
R : Pas via UI. Solutions : MCP `creer_entreprise` en boucle, API multi-call, sync QuickBooks inverse.

**Q12 : Difference `contact_principal_id` vs `est_principal` ?**
R : `companies.contact_principal_id` = pointeur explicite (1 contact principal vu de l entreprise). `contacts.est_principal` = boolean d ordonnancement sans contrainte d unicite. Voir manuel 05.

**Q13 : Pagination limitee a 100 ?**
R : Pydantic `Query(20, ge=1, le=100)` (`companies.py:158`). Pour exporter : pagination en boucle.

**Q14 : Plusieurs adresses (siege vs livraison) ?**
R : **Non** : 1 seule adresse dans `companies`. Adresses alternatives a saisir au niveau des bons de commande (`b2b_commandes.adresse_livraison`) ou projets (`projects.adresse_chantier`).

**Q15 : Notification automatique a la creation / suppression ?**
R : Non. Aucun email, webhook ou notification declenche.

**Q16 : Historique des modifications ?**
R : Seul `updated_at` est trace. Pas d audit log ligne par ligne. Pour un audit complet : logs PostgreSQL.

**Q17 : Une entreprise inactive est-elle filtree des dropdowns d autres modules ?**
R : Generalement non — le `statut Inactif` n est pas filtre dans les selecteurs des autres modules. Pour empecher : reactiver via `PUT` ou ajouter le filtre cote application.

---

## 6. Recap one-pager

- **Mission** : referentiel CRUD des entites tierces (clients, fournisseurs, sous-traitants, partenaires, organismes).
- **URL** : `/entreprises` (sidebar « Entreprises », icone Building2).
- **Backend** : `companies.py` (614 lignes — Entreprises lignes 65-407, Contacts lignes 108-614 documentes manuel 17).
- **5 endpoints** : GET liste / GET detail / POST / PUT (whitelist 17 colonnes) / DELETE (soft-delete).
- **14 types d entreprise** + **18 secteurs d activite** (typologie construction Quebec).
- **Champs UI exposes** : nom (obligatoire), type, secteur, adresse complete, site web, contact principal, notes.
- **Champs API NON exposes UI** : email, telephone, numero_tps, numero_tvq, payment_terms, statut -> utiliser `PUT /companies/{id}` direct.
- **Recherche** : nom + email + ville (LIKE insensible casse). **Filtre** : `type_company` (egalite stricte).
- **Pagination** : 20 par page (max 100).
- **Soft-delete** : `DELETE` -> `statut = 'Inactif'`. Pas de hard-delete API.
- **Limites** : pas d audit log, pas de detection doublons, pas de validation format taxes, pas de NEQ/RBQ/CCQ dans la fiche, pas d import CSV UI, pas de hierarchie, pas de notification.
- **Multi-tenant strict** : sans `user.schema` -> HTTP 400.
- **Permissions plates** : tous CRUD pour tous les users authentifies.
- **FK croisees** : `contacts.company_id` (M05), `opportunities.company_id` (M06), `devis/projects/factures.client_company_id` (M04/01/07), `fournisseurs.company_id` (Suppliers), `b2b_clients.company_id` (B2B), `integration_entity_map` (QuickBooks).
- **Bug UI a corriger** : email + telephone manquants dans `renderFormFields`.

---

**Documentation generee a partir du code** : `companies.py` (lignes 65-407 pour la partie Entreprises), `CompaniesPage.tsx` (676 lignes), `companies.ts` (frontend API client).

**Manuels lies** :
- Module 09 (Projets — `client_company_id`) — `01-projets.md`
- Module 06 (CRM — pipeline, opportunites, BAT) — `03-crm.md`
- Module 08 (Devis — `client_company_id`) — `04-devis.md`
- Module 15 (Factures — `client_company_id`) — `07-factures.md`
- Module 07 (Dossiers — type CLIENT) — `08-dossiers.md`
- Module 28 (Administration — Integration QuickBooks) — `14-administration.md`
- **Module 05 (Contacts — couplage `contacts.company_id`) — `17-contacts.md`**
