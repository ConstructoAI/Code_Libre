# Module 06 — CRM (Companies, Contacts, Opportunities, Ventes)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/crm.py` (2011 lignes, 22 endpoints CRM) + `backend/routers/companies.py` (Companies + Contacts), `frontend/src/pages/CompaniesPage.tsx`, `frontend/src/pages/ContactsPage.tsx`, `frontend/src/pages/VentesPage.tsx` (4 onglets : Pipeline, Opportunites, Historique, Qualification)
> **Tables PostgreSQL** : `companies`, `contacts`, `opportunities`, `interactions`, `crm_activities`, `prospect_qualifications` (BAT), `opportunity_assignations`, `dossiers` (auto `DOS-OPP-XXXXX`), `dossier_factures` ; FK lecture/ecriture sur `devis.opportunity_id`, `projects.opportunity_id`, `emails.opportunity_id`
> **Cadrage** : ce module gere le **cycle commercial complet** (entreprises, contacts, opportunites kanban 6 statuts, interactions, activites planifiees, qualification BAT, lead scoring). Il **ne cree pas** de projet directement (la conversion produit un devis brouillon ; le projet est cree par le module Devis a l acceptation client). Il **n envoie pas** d emails ni de notifications automatiques, ne calcule pas de commissions, et ne deduplique pas les contacts.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface utilisateur](#2-interface-utilisateur)
3. [Workflows](#3-workflows)
4. [Reference](#4-reference)
5. [Integrations et FAQ](#5-integrations-et-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

Le module CRM de Constructo AI regroupe quatre entites principales qui couvrent la gestion commerciale complete d une entreprise de construction au Quebec.

### 1.1 Entites gerees

| Entite | Page frontend | Router backend | Prefixe URL |
|---|---|---|---|
| Entreprises (Companies) | `CompaniesPage.tsx` | `companies.py` | `/companies` |
| Contacts | `ContactsPage.tsx` | `companies.py` | `/contacts` |
| Opportunites | `VentesPage.tsx` (onglet Pipeline / Opportunites) | `crm.py` | `/crm/opportunities` |
| Interactions / Activites | `VentesPage.tsx` (onglet Historique) | `crm.py` | `/crm/interactions`, `/crm/activities` |
| Qualification BAT | `BATQualificationForm.tsx` | `crm.py` | `/crm/qualification/bat` |

### 1.2 Multi-tenant

Tous les endpoints exigent un contexte tenant (`user.schema`). Sans schema, l API renvoie HTTP 400 « Contexte tenant manquant ». Aucune donnee n est partagee entre tenants.

### 1.3 Perimetre couvert par ce manuel

- CRUD complet sur Companies et Contacts
- Pipeline d opportunites (6 statuts) avec drag-and-drop kanban
- Conversion d une opportunite en **devis** (NB : c est bien un devis qui est cree, pas un projet directement)
- Suivi des interactions (5 types) et activites CRM
- Lead scoring automatique (HOT / WARM / COLD)
- Grille de qualification BAT (Budget, Autorite, Timing, Compatibilite) sur 100 points
- Statistiques de pipeline et top clients
- Calendrier mensuel et timeline chronologique
- Assignation d employes a une opportunite

### 1.4 Ce que le module ne fait PAS (verifie dans le code)

- Aucun workflow automatique de taches declenche par changement de statut
- Aucun envoi automatique d email au client
- Aucune creation automatique de projet (la conversion cree un devis ; le passage devis -> projet releve du module Devis)
- Aucun calcul de commission ou de remuneration vendeur
- Pas de soft-delete sur Contact (DELETE = suppression reelle), tandis que Companies utilise un soft-delete (statut `Inactif`)

---

## 2. Interface utilisateur

### 2.1 Page Entreprises (`/companies`)

Page principale pour gerer les entreprises clientes, fournisseurs, sous-traitants et partenaires.

**Mise en page** :
- Bandeau de stats en haut : Total / Clients / Fournisseurs / Sous-traitants
- CommandBar : bouton « Nouvelle entreprise », « Rafraichir », champ de recherche, filtre par type
- Liste paginee (20 par page) en table desktop, cartes en mobile
- Panneau de detail a droite (desktop) ou plein ecran (mobile) au clic sur une ligne

**Colonnes** : Nom, Type, Contact (telephone), Ville, Actions. Triables et redimensionnables.

**Recherche** : insensible a la casse, sur `nom`, `email`, `ville`.

**Filtre Type** : 14 options (TYPE_ENTREPRISE_OPTIONS) plus « Tous les types ».

#### 2.1.1 Liste exacte des 14 types d entreprise

| # | Valeur DB |
|---|---|
| 1 | Entrepreneur general |
| 2 | Sous-traitant specialise |
| 3 | Promoteur immobilier |
| 4 | Fournisseur materiaux |
| 5 | Consultant/Ingenieur |
| 6 | Architecte |
| 7 | Arpenteur-geometre |
| 8 | Organisme de controle |
| 9 | Institution financiere |
| 10 | Assureur |
| 11 | Client residentiel |
| 12 | Client commercial |
| 13 | Client industriel |
| 14 | Municipalite |

Defaut : `Entrepreneur general`.

#### 2.1.2 Liste des 17 secteurs d activite (plus l option vide)

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

(Total = 17 secteurs selectionnables, plus l option vide par defaut.)

#### 2.1.3 Champs du formulaire Entreprise

- `nom` (obligatoire, valide non vide)
- `typeCompany` (defaut « Entrepreneur general »)
- `secteurActivite`
- `email`, `telephone`, `siteWeb`
- `adresse`, `ville`, `province` (defaut « Quebec »), `codePostal`, `pays` (defaut « Canada »)
- `contactPrincipalId` (reference un contact existant)
- `numeroTps`, `numeroTvq` (numeros de taxes du client)
- `paymentTerms` (texte libre, defaut « Net 30 »)
- `notes`
- `statut` (modifiable seulement via UPDATE)

NB : `numeroTps`, `numeroTvq`, `paymentTerms` existent dans le modele backend mais ne sont **pas affiches** dans le formulaire `CompaniesPage.tsx` actuel. Pour les saisir, passer par l API directe.

#### 2.1.4 Suppression

Suppression = soft-delete : `UPDATE companies SET statut = 'Inactif'`. L entreprise n est jamais supprimee physiquement.

### 2.2 Page Contacts (`/contacts`)

Liste tous les contacts toutes entreprises confondues.

**Stats** : Contacts (total) / Entreprises distinctes / Avec Email / Avec Tel.

**Colonnes** : Nom (+initiales), Entreprise, Role/Fonction, Email, Telephone, Actions.

**Recherche** : sur `prenom + nom_famille` et `email` (cote backend).

#### 2.2.1 Champs du formulaire Contact

| Champ backend | Cree | Modifier | Obligatoire |
|---|---|---|---|
| `company_id` | Oui (dropdown) | Oui | Non |
| `prenom` | Oui | Oui | **Oui** |
| `nom_famille` | Oui | Oui | **Oui** |
| `email` | Oui | Oui | Non |
| `telephone` | Oui | Oui | Non |
| `mobile` | Oui | Oui | Non |
| `role_poste` | Oui | Oui | Non |
| `fonction` | Non | **Oui** | Non |
| `departement` | Non | **Oui** | Non |
| `adresse, ville, province, code_postal` | Oui | Oui | Non |
| `est_principal` | Non (formulaire) | Non (formulaire) | Defaut `false` |
| `notes` | Oui | Oui | Non |

Notes :
- `mobile` distinct de `telephone` (deux colonnes BD).
- Colonnes adresse ajoutees dynamiquement par `_ensure_contact_address_cols` au premier acces.
- `est_principal` n est pas modifiable via l UI standard. Affichage : badge bleu « Principal ».
- `company_id <= 0` normalise a `NULL` cote backend.

#### 2.2.2 Suppression

Suppression reelle (`DELETE FROM contacts`). Pas de soft-delete sur les contacts.

### 2.3 Page Ventes (`/ventes`)

4 onglets : `Pipeline`, `Opportunites`, `Historique`, `Qualification`.

**Bandeau KPI permanent** (alimente par `/crm/stats`) :
- Opportunites (total / en cours)
- Taux de conversion (%) = `gagnes / (gagnes + perdus) * 100`
- Montant gagne + montant pipeline en cours
- Delai moyen de fermeture GAGNE (jours)

#### 2.3.1 Onglet Pipeline (kanban)

- 4 colonnes actives : `PROSPECTION` / `QUALIFICATION` / `PROPOSITION` / `NEGOCIATION`
- 2 zones de drop sommaires en haut : `GAGNE` (vert) et `PERDU` (rouge)
- Drag-and-drop entre colonnes : `PUT /crm/opportunities/{id}` avec rollback optimiste
- Drag-and-drop dans une meme colonne : reordonne via `PUT /crm/opportunities/reorder`
- Double-clic sur une carte : ouvre la modale de detail

**Carte d opportunite** : nom, numero `OPP-XXXXX`, entreprise, montant, probabilite, date cloture, score BAT (categorie A+/A/B/C/D), boutons rapides « Avancer », « Gagne », « Perdu ».

#### 2.3.2 Onglet Opportunites (table)

- Liste paginee 20/page avec recherche (sur `nom`, `notes`, `source`) et filtre statut
- Colonnes : N° / Nom / Entreprise / Montant / Probabilite / Statut / Fermeture
- Selection ligne -> panneau lateral avec mode lecture / edition inline
- Bouton « Creer une soumission » convertit l opportunite en devis

#### 2.3.3 Onglet Historique (timeline)

`GET /crm/timeline` : UNION chronologique des `interactions` et `crm_activities`. Limite 50 par defaut, max 200.

#### 2.3.4 Onglet Qualification

Liste les opportunites scorees (HOT / WARM / COLD) selon scoring auto, et permet d ouvrir la grille manuelle BAT.

#### 2.3.5 Champs du formulaire Opportunite

- `nom` (obligatoire)
- `poClient`, `companyId`, `contactId`, `clientNomDirect`
- `statut` (defaut `PROSPECTION`)
- `priorite` : BASSE / NORMAL / HAUTE / URGENTE (defaut `NORMAL`)
- `source` (texte libre)
- `dateSoumission`, `dateDebutPrevu`, `dateFinPrevue`, `dateCloturePrevue`
- `montantEstime`, `probabilite` (slider 0-100, pas 5, defaut 50)
- `description`, `notes`

A la creation : `numero_opportunite` `OPP-XXXXX` genere + dossier client `DOS-OPP-XXXXX` (best-effort).

---

## 3. Workflows

### 3.1 Cycle de vie d une opportunite

Les **6 statuts officiels** (`OPPORTUNITY_STATUSES`) :

```
PROSPECTION -> QUALIFICATION -> PROPOSITION -> NEGOCIATION -> GAGNE
                                                          \-> PERDU
```

Stockage en majuscules ASCII. Le backend gere une migration `_ensure_opportunities_statut_check` qui resynchronise la contrainte CHECK pour les tenants legacy.

Les transitions sont **libres** : on peut passer de n importe quel statut a n importe quel autre par drag-and-drop ou boutons rapides.

### 3.2 Conversion opportunite -> devis

Endpoint : `POST /crm/opportunities/{opportunity_id}/create-devis`.

**Important : la conversion cree un DEVIS, pas un projet.**

Etapes backend :

1. Refus si l opportunite a deja un `devis_id` (HTTP 400).
2. Recuperation du `nom` de l entreprise comme `client_nom_cache`.
3. Calcul des marges sur le `montant_estime` :
   - **Administration = montant * 3 %**
   - **Contingences = montant * 12 %**
   - **Profit = montant * 15 %**
   - `total_avant_taxes = montant + administration + contingences + profit`
4. Calcul des taxes :
   - **TPS = total_avant_taxes * 5 %**
   - **TVQ = total_avant_taxes * 9.975 %**
5. Creation du devis :
   - `numero_devis` : `TEMP` puis `DEV-{annee}-{id:03d}`
   - `statut` : `Brouillon`
   - `type_soumission` : `Detaillee`
   - `validation_token` aleatoire (32 caracteres URL-safe)
6. Mise a jour opportunite : `devis_id = nouveau_id` + `statut = PROPOSITION`.
7. Tentative association `dossier_devis` (best-effort).

Apres succes, redirection vers `/devis`.

### 3.3 Suppression d une opportunite

Endpoint : `DELETE /crm/opportunities/{opportunity_id}`.

1. Lock de la ligne (`SELECT ... FOR UPDATE`).
2. **Suppression cascade** : `interactions`, `crm_activities`, `opportunity_assignations`, `prospect_qualifications`.
3. **Detachement** (SET NULL) : `devis.opportunity_id`, `projects.opportunity_id`, `emails.opportunity_id`. Devis et projet conserves.
4. Suppression de l opportunite.

Frontend affiche confirmation avec liens existants : « Une soumission est liee (sera detachee, pas supprimee) ».

### 3.4 Creation d une interaction

Endpoint : `POST /crm/interactions`.

Champs : `type_interaction` (parmi INTERACTION_TYPES), `resume` (obligatoire), `details`, `date_interaction` (defaut CURRENT_TIMESTAMP), `suivi_prevu`, `company_id`, `contact_id`, `opportunity_id`.

**Aucun workflow automatique** declenche par la creation.

### 3.5 Creation d une activite CRM

Endpoint : `POST /crm/activities`. Table `crm_activities` creee a la volee.

Champs : `type_activite`, `sujet` (obligatoire), `description`, `date_activite`, `duree_minutes`, `company_id`, `contact_id`, `opportunity_id`. Statut initial : `PLANIFIE`.

### 3.6 Lead scoring automatique

Endpoint : `GET /crm/qualification`. Calcule a chaque appel sur les opportunites non `GAGNE`/`PERDU`.

Bareme :

| Critere | Points |
|---|---|
| `montant_estime > 0` | +20 |
| `company_id` renseigne | +15 |
| `contact_id` renseigne | +10 |
| `probabilite > 50` | +20 |
| Au moins 1 interaction liee | +15 |
| `source` renseignee | +10 |
| Mise a jour < 30 jours | +10 |

Categories :
- `HOT` : score >= 70
- `WARM` : score >= 40
- `COLD` : sinon

### 3.7 Grille BAT manuelle

Endpoints : `GET /crm/qualification/bat/{opportunity_id}`, `POST /crm/qualification/bat`, `GET /crm/qualification/bat/all`.

4 sections, 25 points chacune, total **100 pts** :

- **Section A -- Budget** : 3 questions (A1 budget identifie 10, A2 financement 10, A3 historique 5)
- **Section B -- Autorite** : 3 questions (B1 decideur identifie 10, B2 disponibilite 10, B3 processus 5)
- **Section C -- Timing** : 3 questions (C1 demarrage 10, C2 motivation 10, C3 disponibilite 5)
- **Section D -- Compatibilite** : 4 questions (D1 expertise 10, D2 communication 5, D3 attentes 5, D4 feeling 5)

**Categories verifiees frontend** :

| Score total | Categorie | Couleur | Action recommandee |
|---|---|---|---|
| >= 90 | A+ | vert | Priorite maximale - Visite 48-72h |
| 75 - 89 | A | vert | Priorite haute |
| 50 - 74 | B | jaune | Potentiel - Approfondir |
| 25 - 49 | C | rouge | Tiede - Maintenir contact |
| < 25 | D | gris | Froid - Pas prioritaire |

**Important** : grille BAT utilise A+/A/B/C/D (5 niveaux), distinct du lead scoring auto HOT/WARM/COLD (3 niveaux).

### 3.8 Assignation d employes a une opportunite

Endpoints :
- `GET /crm/opportunities/{opp_id}/assignations`
- `POST /crm/opportunities/{opp_id}/assignations` body `{ employee_id, role }`
- `DELETE /crm/opportunities/{opp_id}/assignations/{assignation_id}`

Contrainte UNIQUE `(opportunity_id, employee_id)` : un employe ne peut etre assigne deux fois (HTTP 409).

---

## 4. Reference

### 4.1 OPPORTUNITY_STATUSES (`crm.py:21`)

```
('PROSPECTION', 'QUALIFICATION', 'PROPOSITION', 'NEGOCIATION', 'GAGNE', 'PERDU')
```

| Valeur DB | Libelle UI | Couleur badge |
|---|---|---|
| PROSPECTION | Prospection | bleu |
| QUALIFICATION | Qualification | jaune |
| PROPOSITION | Proposition | violet |
| NEGOCIATION | Negociation | orange |
| GAGNE | Gagne | vert |
| PERDU | Perdu | rouge |

### 4.2 INTERACTION_TYPES (`crm.py:22`)

```
('APPEL', 'EMAIL', 'REUNION', 'VISITE', 'NOTE')
```

| Valeur DB | Libelle | Icone | Couleur |
|---|---|---|---|
| APPEL | Appel | Phone | bleu |
| EMAIL | Email | Mail | sarcelle |
| REUNION | Reunion | Users | violet |
| VISITE | Visite | Eye | vert |
| NOTE | Note | FileText | gris |

### 4.3 ACTIVITY_TYPES (`crm.py:174`)

Meme tuple que INTERACTION_TYPES. Statut initial : `PLANIFIE`.

NB : `VentesPage.tsx:900` envoie `typeActivite: 'TACHE'` pour les activites creees rapidement, valeur **non autorisee** -> HTTP 400 « Type invalide ». Bug connu.

### 4.4 PRIORITES opportunite

`BASSE` / `NORMAL` (defaut) / `HAUTE` / `URGENTE`. Pas de validation backend stricte.

### 4.5 Champs Companies -- modele complet

| Colonne BD | Type | Defaut | Notes |
|---|---|---|---|
| `nom` | TEXT | -- | Obligatoire |
| `type_company` | TEXT | `Entrepreneur general` | 14 valeurs |
| `secteur_activite` | TEXT | NULL | 17 valeurs |
| `email`, `telephone` | TEXT | NULL | -- |
| `adresse, ville` | TEXT | NULL | -- |
| `province` | TEXT | `Quebec` | -- |
| `code_postal` | TEXT | NULL | -- |
| `pays` | TEXT | `Canada` | -- |
| `site_web` | TEXT | NULL | -- |
| `contact_principal_id` | INT | NULL | FK contacts |
| `numero_tps`, `numero_tvq` | TEXT | NULL | -- |
| `payment_terms` | TEXT | `Net 30` | -- |
| `notes` | TEXT | NULL | -- |
| `statut` | TEXT | `Actif` | `Inactif` apres soft-delete |
| `created_at, updated_at` | TIMESTAMP | CURRENT_TIMESTAMP | -- |

### 4.6 Champs Contacts -- modele complet

| Colonne BD | Type | Obligatoire | Notes |
|---|---|---|---|
| `company_id` | INT | Non | NULL si <= 0 |
| `prenom` | TEXT | **Oui** | -- |
| `nom_famille` | TEXT | **Oui** | -- |
| `email, telephone, mobile` | TEXT | Non | -- |
| `role_poste, fonction, departement` | TEXT | Non | -- |
| `adresse, ville, province, code_postal` | TEXT | Non | DDL ajoute a la volee |
| `est_principal` | BOOL | Non | Defaut `false` |
| `notes` | TEXT | Non | -- |
| `created_at` | TIMESTAMP | -- | CURRENT_TIMESTAMP |

### 4.7 Endpoints API CRM

#### Companies
- `GET /companies?page=&per_page=&search=&type_filter=`
- `GET /companies/{id}` -- detail + contacts
- `POST /companies`
- `PUT /companies/{id}`
- `DELETE /companies/{id}` -- soft-delete

#### Contacts
- `GET /contacts?page=&per_page=&search=&company_id=`
- `POST /contacts`
- `PUT /contacts/{id}`
- `DELETE /contacts/{id}` -- suppression reelle

#### Opportunities
- `GET /crm/opportunities?page=&per_page=&search=&statut=&company_id=`
- `GET /crm/opportunities/{id}` -- detail + interactions + activities
- `POST /crm/opportunities`
- `PUT /crm/opportunities/{id}`
- `PUT /crm/opportunities/reorder`
- `DELETE /crm/opportunities/{id}`
- `POST /crm/opportunities/{id}/create-devis`
- `GET|POST|DELETE /crm/opportunities/{id}/assignations[/...]`

#### Interactions / Activities
- `GET /crm/interactions?company_id=&opportunity_id=&type_interaction=`
- `POST /crm/interactions`
- `GET /crm/activities`
- `POST /crm/activities`

#### Pipeline / Stats / Calendrier / Timeline
- `GET /crm/pipeline`
- `GET /crm/stats`
- `GET /crm/calendar?year=&month=`
- `GET /crm/timeline?company_id=&limit=`

#### BAT Qualification
- `GET /crm/qualification` -- lead scoring auto
- `GET /crm/qualification/bat/all`
- `GET /crm/qualification/bat/{opportunity_id}`
- `POST /crm/qualification/bat`

### 4.8 Pagination

`page` (>=1, defaut 1), `per_page` (1-100, defaut 20). Reponse : `{ items, total, page, per_page }`.

### 4.9 Numerotation automatique

| Entite | Format | Generateur |
|---|---|---|
| Opportunite | `OPP-00001` | `MAX(SUBSTRING numero_opportunite)+1` |
| Dossier auto-cree | `DOS-OPP-00001` | Prefixe par numero opportunite |
| Devis converti | `DEV-{annee}-{id:03d}` | Annee courante + ID devis |

---

## 5. Integrations et FAQ

### 5.1 Companies <-> Contacts

- Un contact peut etre rattache a zero ou une entreprise (`company_id` nullable).
- L entreprise pointe vers un `contact_principal_id` distinct.
- Suppression entreprise : soft-delete (statut Inactif), contacts restent.
- Suppression contact : suppression reelle, aucun controle sur les references orphelines.

### 5.2 CRM <-> Devis

- L opportunite expose `devis_id` (NULL tant que non convertie).
- Conversion via `POST /crm/opportunities/{id}/create-devis`:
  - Cree un devis statut `Brouillon`, type `Detaillee`
  - Applique marges 3 % / 12 % / 15 % puis taxes 5 % / 9.975 %
  - Met a jour opportunite : `devis_id` rempli + `statut = PROPOSITION`
  - Refuse une seconde conversion (HTTP 400)
- Suppression opportunite : devis conserve, `opportunity_id` mis a NULL.

### 5.3 CRM <-> Projets

- Le module CRM **ne cree pas** de projet directement.
- Projet referencer une opportunite via `projects.opportunity_id`.
- La promotion d un devis accepte en projet releve du module Devis.

### 5.4 CRM <-> Dossiers

- A la creation d une opportunite : dossier `CLIENT` auto-genere `DOS-OPP-XXXXX` (best-effort).
- A la conversion en devis : dossier lie au devis via `dossier_devis`.
- Bouton « Voir le dossier » dans modale detail si `dossierId` non nul.

### 5.5 CRM <-> Calendrier

`GET /crm/calendar?year=&month=` agrege 3 sources :
1. Interactions (`date_interaction`) -> `resume`
2. Activites (`date_activite`) -> `sujet`
3. Opportunites a cloturer (`date_cloture_prevue`) -> `Cloture: {nom}`

### 5.6 FAQ

**Q1. Pourquoi ma transition de statut affiche un libelle sans accent ?**
Constante backend `OPPORTUNITY_STATUSES` en ASCII pur. Choix volontaire pour eviter les soucis d encodage en BD legacy.

**Q2. Pourquoi la conversion cree un devis et pas directement un projet ?**
Workflow : Opportunite -> Devis -> Acceptation -> Projet. Le passage devis -> projet se fait dans le module Devis lorsque le devis passe au statut Accepte.

**Q3. Que valent les marges 3 / 12 / 15 % ?**
Verifie dans `crm.py:952-954` :
```
administration = montant * 0.03   (3 %)
contingences   = montant * 0.12   (12 %)
profit         = montant * 0.15   (15 %)
```
Codees en dur dans la fonction. Pour les modifier par tenant : editer les lignes du devis apres creation.

**Q4. Les taxes sont-elles correctes pour le Quebec ?**
Oui : TPS 5 %, TVQ 9.975 %. Calculees sur `total_avant_taxes` (montant + marges).

**Q5. Y a-t-il des workflows automatiques (taches, emails, notifications) ?**
**Non.** Aucun workflow automatique trouve dans `crm.py`. Effets de bord automatiques limites a :
- A la creation d opportunite : numero genere + dossier client (best-effort)
- A la conversion en devis : statut opportunite passe a `PROPOSITION`

**Q6. Difference entre interaction et activite CRM ?**
- **Interaction** : evenement passe (appel recu, email envoye). Champs : `resume`, `details`, `date_interaction`, `suivi_prevu`.
- **Activite** : evenement planifie ou a venir. Champs : `sujet`, `description`, `date_activite`, `duree_minutes`, `statut`.

**Q7. Suppression definitive d une entreprise ?**
Pas via UI ni API (soft-delete uniquement). Exige intervention SQL directe.

**Q8. Comment marquer un contact comme « principal » ?**
Deux mecanismes :
1. `companies.contact_principal_id` : pointeur entreprise -> contact (settable via formulaire).
2. `contacts.est_principal` (booleen) : utilise pour ordonner. **Aucun toggle UI** ; il faut passer par `PUT /contacts/{id}` directement.

**Q9. Ordre de tri par defaut des opportunites dans le pipeline ?**
`ORDER BY COALESCE(sort_order, 999) ASC, updated_at DESC NULLS LAST`.

**Q10. Que se passe-t-il si je change le `companyId` apres conversion ?**
L opportunite est mise a jour, mais le devis conserve son `client_company_id` et `client_nom_cache` (snapshot a la conversion).

**Q11. Filtres de la page Opportunites ?**
- `search` : LIKE insensible a la casse sur `nom`, `notes`, `source`
- `statut` : filtre exact sur l une des 6 valeurs
- `company_id` : filtre par entreprise

**Q12. Grille BAT obligatoire pour avancer une opportunite ?**
Non. Aucune validation backend ne lie statut au score BAT. La grille est purement consultative.

**Q13. Colonnes adresse de la table contacts toujours presentes ?**
Le code utilise `_ensure_contact_address_cols` qui ajoute idempotemment `adresse, ville, province, code_postal` au premier acces du processus sur un schema.

**Q14. Quelles colonnes Companies ne sont pas exposees dans le formulaire UI ?**
`numero_tps`, `numero_tvq`, `payment_terms` definies dans le modele backend mais absentes du formulaire `CompaniesPage.tsx`. Pour les renseigner : `PUT /companies/{id}` direct via API.

**Q15. Quels statuts sont consideres « fermes » dans les statistiques ?**
`GAGNE` et `PERDU`. Taux de conversion = `gagnes / (gagnes + perdus)`.

**Q16. Suppression d une opportunite avec assignations ?**
Table `opportunity_assignations` supprimee en cascade. Aucune notification envoyee aux employes.

**Q17. Scoring auto (HOT/WARM/COLD) vs grille BAT (A+/A/B/C/D) ?**
- Scoring auto calcule a la volee a partir de signaux structurels.
- Grille BAT saisie manuellement, plus precise (12 questions, 4 axes).
Les deux peuvent diverger.

**Q18. Protection contre double conversion en devis ?**
Oui (`crm.py:939-940`) : si `opportunity.devis_id` non NULL, HTTP 400 « Opportunite deja convertie en devis #{id} ».

---

## 6. Recap one-pager

| Element | Detail |
|---------|--------|
| **Mission** | Cycle commercial complet : Companies, Contacts, Opportunites (kanban 6 statuts), Interactions, Activites, Qualification BAT, Lead scoring auto, Conversion devis. |
| **Code source** | `backend/routers/crm.py` (2011 lignes, 22 endpoints) + `backend/routers/companies.py` (Companies + Contacts), `frontend/src/pages/{CompaniesPage,ContactsPage,VentesPage}.tsx` |
| **Tables PostgreSQL** | `companies`, `contacts`, `opportunities`, `interactions`, `crm_activities`, `prospect_qualifications`, `opportunity_assignations`, `dossiers`, `dossier_factures` |
| **Endpoints majeurs** | `/companies` (CRUD soft-delete), `/contacts` (CRUD hard-delete), `/crm/opportunities` (CRUD + reorder + create-devis + assignations), `/crm/interactions`, `/crm/activities`, `/crm/pipeline`, `/crm/stats`, `/crm/calendar`, `/crm/timeline`, `/crm/qualification[/bat]` |
| **Statuts/types** | Opportunites 6 statuts (PROSPECTION / QUALIFICATION / PROPOSITION / NEGOCIATION / GAGNE / PERDU). Priorites 4 (BASSE / NORMAL / HAUTE / URGENTE). 14 types entreprise, 17 secteurs activite. 5 types interaction (APPEL / EMAIL / REUNION / VISITE / NOTE). |
| **Permissions** | Tous utilisateurs authentifies du tenant. Aucune RBAC supplementaire, aucun role « commercial / vendeur » dedie. Pas de filtre par owner. |
| **Integrations** | Devis (conversion `POST /crm/opportunities/{id}/create-devis` avec marges 3/12/15 % + taxes 5/9.975 %), Dossiers (auto `DOS-OPP-XXXXX`), Calendrier (`/crm/calendar`), Projets (FK lecture seule `projects.opportunity_id`), Emails (FK), Quickbooks/CCQ/CNESST via Devis |
| **Pas implemente** | Aucun workflow auto declenche par changement de statut. Aucun envoi auto d email. Aucune creation auto de projet (passe par Devis). Aucun calcul de commission. Pas de soft-delete sur Contact (DELETE = hard delete). Pas de toggle UI pour `est_principal`. Pas de validation backend BAT obligatoire pour avancer statut. Bug connu : `typeActivite='TACHE'` envoye par UI (rejet 400). Champs `numero_tps`, `numero_tvq`, `payment_terms` absents du formulaire UI. |

---

*Manuel ERP Constructo — Module CRM — v2.0 verifie — 2026-04-25*
