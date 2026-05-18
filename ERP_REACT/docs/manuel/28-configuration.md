# Module 28 — Administration

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/admin.py` (1379 lignes — super-admin), `backend/routers/auth.py` (698 lignes), `backend/routers/config.py` (1167 lignes — tenant admin), `backend/routers/conformite.py` (2192 lignes — RBQ/CCQ/CNESST), `backend/routers/integration.py` (QuickBooks/Sage 50), `backend/routers/subventions.py`, `backend/routers/calculators.py`, `backend/routers/fonds_prevoyance.py` (Loi 16), `frontend/src/pages/AdminPage.tsx` (6 onglets), `frontend/src/pages/ConfigurationPage.tsx` (7 onglets), `frontend/src/pages/IntegrationPage.tsx` (6 onglets), `frontend/src/pages/ConformitePage.tsx`, `frontend/src/pages/SubventionsPage.tsx`

> **Note importante** : ce module couvre **3 niveaux distincts** d administration :
> 1. **Super-admin** (page `/admin`) — gestion plateforme globale (tous les tenants)
> 2. **Tenant admin** (page `/configuration`) — gestion utilisateurs et settings du tenant
> 3. **Conformite** (page `/conformite`) — RBQ/CCQ/CNESST pour les entreprises de construction

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Page /admin (Super-admin)](#2-page-admin-super-admin)
3. [Page /configuration (Tenant admin)](#3-page-configuration-tenant-admin)
4. [Page /conformite (RBQ/CCQ/CNESST)](#4-page-conformite-rbqccqcnesst)
5. [Page /integration (QuickBooks/Sage 50)](#5-page-integration-quickbookssage-50)
6. [Modules complementaires (Subventions, Calculateurs, Fonds Prevoyance)](#6-modules-complementaires)
7. [Workflows pas-a-pas](#7-workflows-pas-a-pas)
8. [Reference](#8-reference)
9. [Integrations & FAQ](#9-integrations-faq)
10. [Recap one-pager](#10-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Architecture multi-tenant

L ERP utilise un **modele schema-per-tenant PostgreSQL** :
- Schema `public` : table `entreprises` (info plateforme), table `representants`, tables Stripe (`ai_prepaid_credits`, `ai_usage_tracking`), tables session.
- Schema `tenant_{slug}` : isolation complete par tenant (toutes les tables business : projets, factures, employes, etc.).
- Schema reference : `REFERENCE_TENANT_SCHEMA` (env var, defaut `tenant_constructi_2802c4`) — utilise pour audit/repair.

A la connexion :
- `POST /auth/tenant-login` (entreprise email/password) -> recupere `schema_name`.
- `POST /auth/user-login` (username + password user) -> JWT avec `schema` + `role` + `user_id`.
- Toutes les requetes ulterieures utilisent ce schema (`db.set_tenant`).

### 1.2 3 niveaux d acces

| Niveau            | Page              | Permissions                                          | Cible                       |
|-------------------|-------------------|------------------------------------------------------|-----------------------------|
| **Super-admin**   | `/admin`          | Acces TOUS les tenants, statistiques plateforme      | Owner (Sylvain Leduc) + reps|
| **Tenant admin**  | `/configuration`  | Gestion users/config/theme du tenant uniquement     | Admin client                |
| **User standard** | (pas d acces admin) | Lecture/ecriture metier seulement                  | Employes                    |

### 1.3 5 roles utilisateurs

Source : `config.py` `users.role` enum

`admin` / `user` / `employee` / `comptable` / `gestionnaire` + flag `is_admin` (boolean superpose).

### 1.4 Constantes financieres plateforme (super-admin P&L)

Source : `admin.py`

| Constante              | Valeur     | Usage                                  |
|------------------------|-----------|----------------------------------------|
| `RENDER_MONTHLY_COST`  | 434.67 CAD | Hosting Render mensuel                 |
| `ERP_MONTHLY_PRICE`    | 79.99 CAD  | Tarif fixe abonnement ERP (tous plans) |
| `REP_COMMISSION_RATE`  | 0.40 (40%) | Commission representant                |
| `CORPORATE_TAX_RATE`   | 0.265      | Federal 15% + Quebec 11.5%             |
| `OWNER_NAME`           | `Sylvain Leduc` | Pas de commission si rep = owner   |

---

## 2. Page `/admin` (Super-admin)

> **Reserve au super-admin** (`/auth/super-admin-login` -> session_token). Permet la gestion globale de la plateforme multi-tenant.

### 2.1 6 onglets AdminPage

| # | Onglet              | Contenu                                                                |
|---|---------------------|------------------------------------------------------------------------|
| 1 | **Entreprises**     | Liste tenants : id, nom, slug, user_count, subscription_status, actif toggle |
| 2 | **En Ligne**        | Sessions actives + stats + login_trend 30j + peak_hours + top 10 users |
| 3 | **Usage IA**        | Cout/revenu IA mensuel : total_cost, anthropic_cost, profit, by_company, daily_trend, by_feature |
| 4 | **Finances**        | P&L plateforme : abonnements + IA + commissions - couts - taxes        |
| 5 | **Mises a jour**    | Broadcast messages a tous les tenants                                  |
| 6 | **Representants**   | CRUD representants commerciaux (40% commission)                        |

### 2.2 Onglet « Entreprises »

`GET /admin/entreprises` -> tableau :
- id, nom, slug, email, representant
- subscription_status (Stripe), plan_type, trial_end_date
- active (toggle bouton)
- user_count

Actions :
- **Toggle activate/deactivate** : `PUT /admin/entreprises/{id}/toggle`
- **Assigner representant** : `PUT /admin/entreprises/{id}/representant`
- **Audit schema** : `GET /admin/tenants/{slug}/audit` -> verifie tables/views/columns vs reference
- **Repair schema** : `POST /admin/tenants/{slug}/repair` -> applique les diffs idempotemment
- **Repair-all-known-fixes** : `POST /admin/tenants/repair-all-known-fixes` -> bulk fix tous les tenants
- **Reset password** : `POST /admin/tenants/{slug}/reset-passwords` (entreprise login OU user)

### 2.3 Onglet « En Ligne »

`GET /admin/online?threshold_minutes=30` (5-120 min, defaut 30) :
- **Stats** : `erp_online`, `experts_online` (counts par produit)
- **Sessions** : liste sessions actives (user, entreprise, login_time, last_activity)
- **By entreprise** : pie chart repartition
- **Login trend 30j** : graphique area
- **Peak hours** : heatmap heures de pointe
- **Top 10 users** : utilisateurs les plus connectes

### 2.4 Onglet « Usage IA »

`GET /admin/ai-usage?month=X&year=Y` :
- **Total cost USD** : `SUM(ai_usage_tracking.cost_usd)`
- **Anthropic cost** : cout brut sans markup
- **Profit** : revenu - cout (markup 30%)
- **By company** : tableau par tenant (`balance_usd` + `total_charged_usd` + `total_consumed_usd`)
- **Daily trend** : graphique area journalier
- **By feature** : pie chart (chat, invoice_scan, immobilier_*, etc.)

### 2.5 Onglet « Finances » (P&L plateforme)

`GET /admin/finances?month=X&year=Y` :

**Revenus** :
- Subscription revenue : `count(active subscriptions) * 79.99`
- AI revenue : revenue genere depuis credits IA preconsommes

**Couts** :
- Render hosting : `434.67 CAD/mois`
- Anthropic API : cout brut tokens
- Commissions : `40% * subscription_revenue` par tenant avec representant != owner

**Resultat** :
- Profit avant taxes
- Taxes (26.5%)
- **Profit apres taxes**

Detail :
- `subscriptions_detail` : liste detaillee abonnements actifs
- `commissions_by_rep` : commissions par representant

### 2.6 Onglet « Mises a jour »

`GET /admin/updates` / `POST /admin/updates` :
- Broadcast messages a tous les tenants (banner UI)
- Champs : message, message_type (`info`, `warning`, `success`), is_active
- Affichage cote tenant : banner en haut de page (a verifier en prod)

### 2.7 Onglet « Representants »

`GET /admin/representants` / `POST` / `PUT` / `DELETE` :
- CRUD representants commerciaux
- Champs : nom (obligatoire), email, telephone, actif
- Assignation aux entreprises via `entreprises.representant`
- A l update du nom : cascade sur `entreprises` (UPDATE references)

> **Owner Sylvain Leduc** : commission 0% (constante `OWNER_NAME`).

---

## 3. Page `/configuration` (Tenant admin)

> Accessible aux utilisateurs `is_admin = true` du tenant (pas super-admin).

### 3.1 7 onglets ConfigurationPage

| # | Onglet              | Reserve admin ? | Contenu                                                  |
|---|---------------------|-----------------|----------------------------------------------------------|
| 1 | **Profil**          | Non (self)      | Modifier full_name, email, password (utilisateur courant)|
| 2 | **Utilisateurs**    | OUI             | CRUD users du tenant                                     |
| 3 | **Entreprise**      | OUI             | Config JSON (logo, coordonnees, parametres metier)       |
| 4 | **Soumissions**     | OUI             | Conditions/exclusions par defaut documents               |
| 5 | **Apparence**       | OUI             | Theme couleurs documents (8 champs hex)                  |
| 6 | **Abonnement**      | Non (lecture)   | Statut Stripe, credits IA, factures plateforme           |
| 7 | **Integrations**    | OUI             | QuickBooks / Sage 50 / Webhooks (cf. section 5)          |

### 3.2 Onglet « Utilisateurs »

`GET /config/users` -> liste users du tenant.

Colonnes :
- username, email, full_name, role, is_admin, active, last_login

Actions :
- **+ Nouvel utilisateur** : `POST /config/users` (username + password >= 6 chars + email + full_name + role + is_admin)
- **Modifier** : `PUT /config/users/{user_id}`
- **Desactiver** : `DELETE /config/users/{user_id}` -> SET active=false (interdit auto-desactivation)
- **Reset password** : `PUT /config/users/{user_id}/password` (admin OR self, min 6 chars)

### 3.3 Onglet « Entreprise »

`GET /config/entreprise` / `PUT /config/entreprise/{cle}` :
- Stocke des `key/value` (JSON `config_data`)
- Cles courantes : `nom_entreprise`, `adresse`, `telephone`, `email`, `RBQ`, `NEQ`, `TPS`, `TVQ`, `logo_base64`, `conditions_paiement_defaut`, etc.

### 3.4 Onglet « Apparence » (theme documents)

`GET /config/document-theme` -> palette merge avec defaults.

**8 couleurs personnalisables** (hex) :

| Cle              | Defaut    | Usage                                 |
|------------------|-----------|---------------------------------------|
| `primary`        | `#1F4E79` | Couleur principale (en-tetes)         |
| `primary_dark`   | `#0D2F4F` | Variante foncee                       |
| `accent`         | `#27A376` | Boutons accent (vert)                 |
| `accent_light`   | `#4AB393` | Variante claire                       |
| `header_text`    | `#FFFFFF` | Texte sur fond primary                |
| `table_row_alt`  | `#EBF1F6` | Lignes tableau alternees              |
| `info_bg`        | `#E3F2FD` | Fond infobulles                       |
| `border`         | `#BDBDBD` | Bordures generiques                   |

Source defaut : `html_utils.py` `DEFAULT_DOCUMENT_THEME`.

Actions :
- **Modifier** : `PUT /config/document-theme` (validation hex `#RGB` ou `#RRGGBB`, race-safe SELECT FOR UPDATE)
- **Reset** : `DELETE /config/document-theme` -> revient aux defaults

Le theme s applique a **tous les documents HTML** : devis, factures, BC, BT, emails. Apercu en temps reel dans la page (ThemePreview component).

### 3.5 Onglet « Abonnement »

Affichage lecture seule :
- Statut Stripe (`active`, `trialing`, `past_due`, `canceled`)
- Trial end date
- **Credits IA** : balance USD + monthly_limit_usd + auto_recharge ON/OFF
- Liste factures plateforme (Stripe invoices)
- Bouton **Recharger credits** (cf. Module 25 IA)
- Bouton **Portail Stripe** (gestion carte)

### 3.6 Onglet « Profil » (self)

`GET /config/profile` / `PUT /config/profile` :
- Modifier `full_name`, `email`
- Bouton changer password (modale separee)

### 3.7 Onglet « Soumissions » (admin)

Configurations defaut documents :
- Conditions de paiement defaut
- Exclusions standard a inclure dans soumissions
- Mentions legales
- Affichables/non-affichables sur documents

---

## 4. Page `/conformite` (RBQ / CCQ / CNESST)

> Module dedie a la conformite Quebec construction. Accessible aux utilisateurs authentifies du tenant.

### 4.1 3 sections principales

| Section          | Concerne          | Table                  | Statuts                                       |
|------------------|-------------------|------------------------|-----------------------------------------------|
| **Licences RBQ** | Entreprise        | `licences_rbq`         | `VALID` / `EXPIRED` / `PENDING` / `SUSPENDED` |
| **Cartes CCQ**   | Employes          | `cartes_ccq`           | `ACTIF` / `EXPIRE` / `SUSPENDU` / `REVOQUE`   |
| **Attestations** | Entreprise        | `attestations_fiscales`| `VALIDE` / `EXPIRE` / `MANQUANTE`             |

### 4.2 Licences RBQ

**26 categories** (TRAVAUX_GENERAUX, MACON, ELECTRICIEN, PLOMBIER, COUVREUR, etc.).

Endpoints :
- `GET /conformite/licences` (filtre statut)
- `GET /conformite/licences/expiring` (30/60 jours)
- `POST /conformite/licences` (numero, categorie, date_emission, date_expiration, statut, note)
- `PUT /conformite/licences/{id}`
- `DELETE /conformite/licences/{id}`

### 4.3 Cartes CCQ

**28 metiers** avec qualifications dynamiques (`metier` enum + `qualifications[]` array).

Endpoints CRUD similaires : `GET POST PUT DELETE /conformite/cartes`.

Notifications : `GET /conformite/cartes/expiring?days=30` ou `60`.

### 4.4 Attestations (CNESST / fiscales)

**5 types** :
- `CSST` (legacy)
- `CNESST` (sante securite)
- `RBQ` (attestation Revenu Quebec liee a la licence)
- `CCQ` (attestation conformite cotisations)
- `AUTRES`

Upload de documents (PDF, JPEG, PNG, WEBP, **max 10 MB**) :
- `POST /conformite/attestations/{id}/upload` (multipart)
- `GET /conformite/attestations/{id}/download` (Content-Disposition: attachment)

### 4.5 Statistiques & alertes

- `GET /conformite/statistics` -> score conformite global + counts par statut + risk distribution
- `GET /conformite/alertes` -> notifications expirations 30/60 jours
- `GET /conformite/constants` -> donnees statiques (metiers, statuts, niveaux risque)
- `GET /conformite/resources` -> 8 organismes + 6 conseils pratiques

### 4.6 7 endpoints IA Conformite (Claude Opus 4.7)

> **Modele** : `claude-opus-4-7` (le plus performant pour analyse complexe). **Cout sup.** (CONF_PRICING : input $0.015/1K, output $0.075/1K, markup 30%).

| Endpoint                                       | Role                                          |
|------------------------------------------------|-----------------------------------------------|
| `POST /conformite/ai/analyze`                  | Analyser profil conformite global             |
| `POST /conformite/ai/chat`                     | Chat conversationnel sur la conformite        |
| `POST /conformite/ai/verify-project`           | Verifier conformite d un projet specifique    |
| `POST /conformite/ai/search-regulations`       | Rechercher dans les reglementations Quebec    |
| `POST /conformite/ai/predict-renewals`         | Predire les renouvellements basee sur historique |
| `POST /conformite/ai/generate-rapport`         | Generer rapport conformite PDF                |
| `POST /conformite/ai/recommend-formations`     | Recommander programmes formation              |

> Tous deduisent des credits IA (`_check_credits` + `_deduct_credits`).

---

## 5. Page `/integration` (QuickBooks / Sage 50 / Webhooks)

### 5.1 6 onglets IntegrationPage

1. **Vue d ensemble** : statut connexions
2. **QuickBooks** : OAuth2 setup + sync triggers
3. **Sage 50** : config connexion
4. **Webhooks** : gestion endpoints
5. **Correspondance** : mappings champs
6. **Historique** : logs sync

### 5.2 QuickBooks Online

Workflow OAuth2 :
1. **Connecter** : `GET /integrations/quickbooks/auth-url` -> redirection OAuth Intuit
2. Apres autorisation : Intuit redirige vers `POST /integrations/quickbooks/callback` (code + realmId + state)
3. Backend stocke tokens dans `integrations` table
4. **Sync** : `POST /integrations/{id}/sync` avec direction `to_qb` ou `from_qb`
5. **Test** : `POST /integrations/{id}/test`

**Mappings supportes** : Account, Class, Customer, Invoice, Bill, JournalEntry, Deposit.

### 5.3 Sage 50

Configuration connecteur (sans OAuth — credentials API directs).

**Mappings** : GL Code, Customer, Invoice, Bill, Payment, Deposit.

### 5.4 Webhooks

Pour notifications evenements vers systemes tiers.

Endpoints :
- `GET /config/webhooks` -> liste
- `POST /config/webhooks` -> creer (url + events[] + secret auto-genere si non fourni 32 bytes URL-safe)
- `PUT /config/webhooks/{id}`
- `DELETE /config/webhooks/{id}`
- `POST /config/webhooks/{id}/test` -> envoie test.ping payload
- `GET /config/webhooks/{id}/deliveries` -> historique livraisons (limit 100)

**Events** typiques : `invoice.created`, `payment.received`, `bt.completed`, `project.statut_changed`, etc.

**Securite** : signature HMAC avec `secret` (header `X-Webhook-Signature`).

### 5.5 Historique sync

- `GET /integrations/sync-history` -> logs
- `GET /integrations/sync-stats` -> stats agregees

---

## 6. Modules complementaires

### 6.1 Subventions (`/subventions`)

Module aide aux subventions gouvernementales (Hydro-Quebec, Energie Cardio, programmes RBQ, etc.) :
- `GET /subventions/constants` / `categories` / `programmes`
- `GET /subventions/demandes` / `POST` / `PUT`
- `POST /subventions/demandes/{id}/soumettre` -> soumission a l organisme
- 5 endpoints IA : suggest / chat / checklist / analyze-demande / analyze-eligibility

### 6.2 Calculateurs (`/calculators`)

Calculateurs techniques par metier construction :
- **Beton** : dosage, armatures, cure, coffrage, excavation, talus, escaliers
- **Electricite** : residentiel, eclairage, mise a la terre
- **Toiture** : ventilation, gouttieres, charge neige
- **Peinture** : DFT, point de rosee
- **Plomberie** : Hazen-Williams, chauffe-eau, pente drain
- **CVAC** : conduit, CFM, VRC

> Multiples endpoints, chacun avec parametres metier specifiques.

### 6.3 Fonds Prevoyance Loi 16 (`/fonds-prevoyance`)

Module obligatoire pour copropriete au Quebec (Loi 16) :
- `GET /fonds-prevoyance/reference` -> regles Loi 16
- CRUD : Coproprietes, Composantes (elements batiment), Etudes (etudes du fonds), Entretiens, Attestations
- `GET /fonds-prevoyance/coproprietes/{id}/statistiques`
- `POST /fonds-prevoyance/ia/analyze-copropriete` (IA Claude analyse)
- `POST /fonds-prevoyance/ia/suggest-contribution`
- `POST /fonds-prevoyance/calculer-valeur-reconstruction`

> Sous-onglet integre dans Module 19 Immobilier (`fonds_prevoyance` tab).

---

## 7. Workflows pas-a-pas

### 7.1 (Super-admin) Activer/desactiver un tenant

1. `/admin` -> onglet **Entreprises** -> ligne tenant -> toggle **active**.
2. `PUT /admin/entreprises/{id}/toggle`.
3. Tenant inactive : ses utilisateurs ne peuvent plus se connecter (HTTP 403 a `tenant-login`).

### 7.2 (Super-admin) Reparer le schema d un tenant

1. `/admin` -> Entreprises -> selectionner tenant -> bouton **Audit schema**.
2. `GET /admin/tenants/{slug}/audit` -> retourne diff vs reference (tables/views/columns manquantes).
3. Si diff non vide : bouton **Repair**.
4. `POST /admin/tenants/{slug}/repair` -> applique les ALTER/CREATE manquants (idempotent).
5. Pour tous les tenants en bulk : bouton **Repair all known fixes** -> `POST /admin/tenants/repair-all-known-fixes`.

### 7.3 (Super-admin) Reset password tenant

1. Tenant identifie -> bouton **Reset password**.
2. Choisir : reset entreprise login OR reset un user specifique.
3. `POST /admin/tenants/{slug}/reset-passwords` avec `{type: entreprise|user, target_email, new_password}`.
4. Backend hash bcrypt + UPDATE.

### 7.4 (Super-admin) Diffuser un message

1. `/admin` -> onglet **Mises a jour** -> formulaire.
2. Saisir message + type (info/warning/success).
3. **Activer** -> `POST /admin/updates`.
4. Tous les tenants voient le banner sur leur ouverture de page (a verifier en prod).

### 7.5 (Super-admin) Assigner un representant

1. `/admin` -> onglet **Representants** -> creer/modifier.
2. Onglet Entreprises -> selectionner tenant -> dropdown **Representant**.
3. `PUT /admin/entreprises/{id}/representant?representant_nom=X`.
4. Commission 40% s applique au prochain calcul P&L (sauf si owner).

### 7.6 (Tenant admin) Creer un utilisateur

1. `/configuration` -> onglet **Utilisateurs** -> bouton **+ Nouvel utilisateur**.
2. Modale :
   - **Username** (unique dans le tenant)
   - **Password** (min 6 chars)
   - **Email**, **Full name**
   - **Role** (admin/user/employee/comptable/gestionnaire)
   - **Is admin** (boolean — superpose au role)
   - **Employee ID** (optionnel — lie a la fiche employe Module 9)
3. **Enregistrer** -> `POST /config/users`.
4. Active = TRUE par defaut.

### 7.7 (Tenant admin) Personnaliser le theme documents

1. `/configuration` -> onglet **Apparence**.
2. 8 color pickers + apercu en temps reel (ThemePreview).
3. **Enregistrer** -> `PUT /config/document-theme`.
4. Validation hex (`#RGB` ou `#RRGGBB`).
5. Race-safe : SELECT FOR UPDATE pendant l update.
6. Bouton **Reset** -> revient aux defaults `#1F4E79` etc.

### 7.8 (Tenant admin) Configurer les conditions de paiement par defaut

1. `/configuration` -> onglet **Soumissions**.
2. Modifier le texte « Conditions de paiement » qui apparaitra sur tous les nouveaux devis et factures.
3. `PUT /config/entreprise/conditions_paiement_defaut`.

### 7.9 (Tenant admin) Connecter QuickBooks

1. `/integration` -> onglet **QuickBooks** -> bouton **Connecter QuickBooks**.
2. Backend : `GET /integrations/quickbooks/auth-url` -> redirect vers Intuit OAuth.
3. Authoriser sur Intuit -> retour a l ERP avec code + realmId.
4. `POST /integrations/quickbooks/callback` -> stocke tokens + refresh_token.
5. **Tester** -> `POST /integrations/{id}/test` -> verifie acces realm.
6. **Synchroniser** -> `POST /integrations/{id}/sync` direction `to_qb` ou `from_qb`.

### 7.10 (Tenant) Ajouter une licence RBQ

1. `/conformite` -> section **Licences RBQ** -> bouton **+ Nouvelle licence**.
2. Modale :
   - **Numero RBQ** (format `XXXX-XXXX-XX`)
   - **Categorie** (dropdown 26 valeurs : TRAVAUX_GENERAUX, MACON, etc.)
   - **Date emission**, **Date expiration**
   - **Statut** (`VALID` / `EXPIRED` / `PENDING` / `SUSPENDED`)
   - **Note**
3. **Enregistrer** -> `POST /conformite/licences`.
4. Notifications expiration auto a 60j puis 30j (`GET /conformite/licences/expiring`).

### 7.11 (Tenant) Ajouter une carte CCQ employe

1. `/conformite` -> section **Cartes CCQ** -> bouton **+ Nouvelle carte**.
2. Modale :
   - **Numero carte CCQ** (format CCQ)
   - **Nom employe** (dropdown lie aux employes du Module 9)
   - **Metier** (dropdown 28 valeurs : CHARPENTIER-MENUISIER, ELECTRICIEN, PLOMBIER, etc.)
   - **Qualifications** (multi-select selon metier — ex. `Apprenti`, `Compagnon`, `Maitre`)
   - **Dates emission/expiration**
   - **Statut** (`ACTIF` / `EXPIRE` / `SUSPENDU` / `REVOQUE`)
3. `POST /conformite/cartes`.

### 7.12 (Tenant) Uploader une attestation CNESST

1. `/conformite` -> section **Attestations** -> bouton **+ Nouvelle attestation**.
2. Saisir numero + dates + statut.
3. `POST /conformite/attestations`.
4. Sur la fiche creee : bouton **Uploader document** -> selectionner fichier (PDF/JPEG/PNG/WEBP, max 10 MB).
5. `POST /conformite/attestations/{id}/upload` (multipart).
6. Telechargeable via `GET /conformite/attestations/{id}/download`.

### 7.13 (Tenant) Utiliser l IA Conformite

1. `/conformite` -> selectionner action IA :
   - **Analyser profil** : `POST /conformite/ai/analyze`
   - **Chat conformite** : `POST /conformite/ai/chat`
   - **Verifier projet** : `POST /conformite/ai/verify-project?project_id=X`
   - **Rechercher reglementations** : `POST /conformite/ai/search-regulations` (texte requete)
   - **Predire renouvellements** : `POST /conformite/ai/predict-renewals`
   - **Generer rapport** : `POST /conformite/ai/generate-rapport` (PDF)
   - **Recommander formations** : `POST /conformite/ai/recommend-formations`
2. Tous : verification credits IA (`_check_credits`) puis `_deduct_credits` apres reponse.

### 7.14 Inscription nouvelle entreprise (signup public)

1. Page `/register` -> formulaire :
   - **Nom entreprise**, **Slug** (auto-genere depuis nom)
   - **Email contact**, **Password** (min 6 chars)
   - **Telephone**, **Adresse**
   - **Representant** (dropdown public `GET /auth/representants`)
2. **S inscrire** -> `POST /auth/register`.
3. Backend :
   - Valide email unique.
   - Cree Stripe Checkout session.
   - Insert dans `pending_signups` (avec flag `awaiting_payment`).
4. Redirection vers Stripe Checkout (carte).
5. Apres paiement : webhook Stripe declenche creation tenant + schema PostgreSQL + email confirmation.

---

## 8. Reference

### 8.1 Endpoints super-admin (`/admin`)

| Methode | URL                                      | Role                                      |
|---------|------------------------------------------|-------------------------------------------|
| GET     | `/admin/entreprises`                     | Liste tenants + counts                    |
| GET     | `/admin/online`                          | Sessions actives + stats                  |
| GET     | `/admin/ai-usage`                        | Cout/revenu IA                            |
| GET     | `/admin/finances`                        | P&L plateforme                            |
| GET     | `/admin/stats`                           | Stats globales                            |
| PUT     | `/admin/entreprises/{id}/toggle`         | Activer/desactiver                        |
| PUT     | `/admin/entreprises/{id}/representant`   | Assigner rep                              |
| GET     | `/admin/tenants/{slug}/audit`            | Audit schema                              |
| POST    | `/admin/tenants/{slug}/repair`           | Repair schema                             |
| POST    | `/admin/tenants/repair-all-known-fixes`  | Repair bulk                               |
| POST    | `/admin/tenants/{slug}/reset-passwords`  | Reset password                            |
| GET POST| `/admin/updates`                         | Broadcast messages CRUD                   |
| GET POST PUT DELETE | `/admin/representants[/{id}]` | Representants CRUD                     |

### 8.2 Endpoints auth (`/auth`)

| Methode | URL                              | Role                                     |
|---------|----------------------------------|------------------------------------------|
| POST    | `/auth/tenant-login`             | Etape 1 : auth entreprise                |
| POST    | `/auth/user-login`               | Etape 2 : auth user dans tenant -> JWT   |
| POST    | `/auth/super-admin-login`        | Auth super-admin -> session_token        |
| POST    | `/auth/register`                 | Signup new tenant + Stripe Checkout      |
| POST    | `/auth/logout`                   | Invalide session                         |
| GET     | `/auth/me`                       | Info user courant                        |
| GET     | `/auth/representants`            | Liste publique reps (pour signup form)   |
| POST    | `/auth/b2b-tenant-lookup`        | Lookup tenant par email (B2B client)     |
| POST    | `/auth/b2b-client-login`         | Auth B2B client                          |
| POST    | `/auth/b2b-client-register`      | Self-registration B2B (pending approval) |
| GET     | `/auth/b2b-me`                   | Profil B2B client                        |

### 8.3 Endpoints config (`/config`) — tenant admin

| Methode | URL                                         | Role                              |
|---------|---------------------------------------------|-----------------------------------|
| GET PUT | `/config/entreprise[/{cle}]`                | Config JSON tenant                |
| GET PUT DELETE | `/config/document-theme`             | Theme couleurs documents          |
| GET POST PUT DELETE | `/config/users[/{user_id}]`     | Users CRUD                        |
| PUT     | `/config/users/{user_id}/password`          | Reset password                    |
| GET PUT | `/config/profile`                           | Profil self                       |
| GET POST PUT DELETE | `/config/webhooks[/{webhook_id}]` | Webhooks CRUD                  |
| POST    | `/config/webhooks/{id}/test`                | Envoyer test.ping                 |
| GET     | `/config/webhooks/{id}/deliveries`          | Historique livraisons             |

### 8.4 Endpoints conformite (`/conformite`)

#### Licences RBQ
| Methode | URL                                  |
|---------|--------------------------------------|
| GET     | `/conformite/licences`               |
| GET     | `/conformite/licences/expiring`      |
| GET     | `/conformite/licences/{id}`          |
| POST    | `/conformite/licences`               |
| PUT     | `/conformite/licences/{id}`          |
| DELETE  | `/conformite/licences/{id}`          |

#### Cartes CCQ
| Methode | URL                                  |
|---------|--------------------------------------|
| GET     | `/conformite/cartes`                 |
| GET     | `/conformite/cartes/expiring`        |
| GET     | `/conformite/cartes/{id}`            |
| POST    | `/conformite/cartes`                 |
| PUT     | `/conformite/cartes/{id}`            |
| DELETE  | `/conformite/cartes/{id}`            |

#### Attestations
| Methode | URL                                  |
|---------|--------------------------------------|
| GET     | `/conformite/attestations`           |
| GET     | `/conformite/attestations/expiring`  |
| GET     | `/conformite/attestations/{id}`      |
| POST    | `/conformite/attestations`           |
| PUT     | `/conformite/attestations/{id}`      |
| DELETE  | `/conformite/attestations/{id}`      |
| POST    | `/conformite/attestations/{id}/upload`   |
| GET     | `/conformite/attestations/{id}/download` |

#### Statistiques + IA
| Methode | URL                                  |
|---------|--------------------------------------|
| GET     | `/conformite/statistics`             |
| GET     | `/conformite/alertes`                |
| GET     | `/conformite/constants`              |
| GET     | `/conformite/resources`              |
| POST    | `/conformite/ai/analyze`             |
| POST    | `/conformite/ai/chat`                |
| POST    | `/conformite/ai/verify-project`      |
| POST    | `/conformite/ai/search-regulations`  |
| POST    | `/conformite/ai/predict-renewals`    |
| POST    | `/conformite/ai/generate-rapport`    |
| POST    | `/conformite/ai/recommend-formations`|

### 8.5 Endpoints integration (`/integrations`)

| Methode | URL                                       |
|---------|-------------------------------------------|
| GET POST PUT DELETE | `/integrations[/{id}]`        |
| GET     | `/integrations/quickbooks/auth-url`       |
| POST    | `/integrations/quickbooks/callback`       |
| POST    | `/integrations/{id}/test`                 |
| POST    | `/integrations/{id}/sync`                 |
| GET     | `/integrations/sync-history`              |
| GET     | `/integrations/sync-stats`                |

### 8.6 Roles utilisateurs

| Role           | Permissions                                                 |
|----------------|-------------------------------------------------------------|
| `admin`        | Acces complet tenant (creer users, modifier theme, etc.)    |
| `user`         | Acces lecture/ecriture metier standard                      |
| `employee`     | Idem `user` (souvent lie a une fiche `employees`)          |
| `comptable`    | Focus comptabilite (modules 7, 13)                          |
| `gestionnaire` | Focus pilotage (modules 1, 2, 13)                           |

> **Flag `is_admin`** (boolean) superpose au role : permet d accorder droits admin a un user de role `comptable` par exemple.

### 8.7 Limites & validations

| Regle                                      | Effet                                              |
|--------------------------------------------|----------------------------------------------------|
| Password user < 6 chars                    | HTTP 400                                           |
| Username doublon dans tenant               | HTTP 400 UNIQUE constraint                         |
| Auto-desactivation user                    | HTTP 400                                           |
| Theme document hex invalide                | HTTP 400                                           |
| Upload attestation > 10 MB                 | HTTP 413                                           |
| Upload attestation MIME non autorise       | HTTP 400 (PDF/JPEG/PNG/WEBP uniquement)            |
| Repair tenant inexistant                   | HTTP 404                                           |
| Webhook URL invalide                       | HTTP 400                                           |
| OAuth QuickBooks state mismatch            | HTTP 400                                           |
| Conformite IA sans credits                 | HTTP 402                                           |

### 8.8 Tables PostgreSQL principales

#### Schema `public` (partage)

| Table                  | Role                                         |
|------------------------|----------------------------------------------|
| `entreprises`          | Tenants (id, nom, slug, email, subscription) |
| `representants`        | Representants commerciaux                    |
| `pending_signups`      | Inscriptions en attente de paiement Stripe   |
| `active_sessions`      | Sessions actives (toutes appli)              |
| `ai_prepaid_credits`   | Credits IA prepayes (Module 12)              |
| `ai_usage_tracking`    | Tracking usage IA (Module 12)                |
| `dossiers_public_tokens` | Tokens partage public dossiers (Module 8)  |

#### Schema `tenant_{slug}` (per-tenant)

| Table                  | Role                                         |
|------------------------|----------------------------------------------|
| `users`                | Users du tenant                              |
| `entreprise_config`    | Config JSON par cle (logo, RBQ, etc.)        |
| `document_theme`       | Theme couleurs documents (overrides)         |
| `webhooks`             | Webhooks endpoints                           |
| `webhook_deliveries`   | Historique livraisons                        |
| `integrations`         | Connexions QuickBooks/Sage 50                |
| `licences_rbq`         | Licences RBQ                                 |
| `cartes_ccq`           | Cartes CCQ employes                          |
| `attestations_fiscales`| Attestations CNESST/RBQ/CCQ                  |
| `subventions_demandes` | Demandes subventions                         |
| `coproprietes`         | Coproprietes Loi 16                          |
| (toutes les autres tables business des modules 1-13) | ... |

---

## 9. Integrations & FAQ

### 9.1 Integration Stripe

- Inscription tenant via Checkout : `POST /auth/register` -> Stripe Checkout session.
- Subscription mensuelle : `$79.99 CAD` (tarif fixe).
- Auto-recharge credits IA : declenchee depuis `/ai/chat` si solde < $0.10 USD.
- Webhooks Stripe gerent : signup completion, payment_succeeded, subscription_canceled, etc.

### 9.2 Integration Anthropic Claude

3 niveaux d utilisation IA dans le module Administration :

| Module                     | Modele               | Cout par 1K tokens (input/output)     |
|----------------------------|----------------------|----------------------------------------|
| **Conformite** (7 endpoints) | claude-opus-4-7    | $0.015 / $0.075 (markup 30%)           |
| **Subventions** (5 endpoints)| claude-sonnet-4-6  | $0.003 / $0.015 (markup 30%)           |
| **Fonds Prevoyance** (multi)| claude-sonnet-4-6  | $0.003 / $0.015 (markup 30%)           |

Tous deduisent des credits prepayes du tenant.

### 9.3 Integration QuickBooks Online

- OAuth2 Intuit
- Sync bidirectionnel : `to_qb` (export ERP -> QB) ou `from_qb` (import QB -> ERP)
- Mappings : Account, Class, Customer, Invoice, Bill, JournalEntry, Deposit
- Logs dans `integration_sync_history` table

### 9.4 Integration Sage 50

- Connecteur sans OAuth (credentials API directs)
- Mappings : GL Code, Customer, Invoice, Bill, Payment, Deposit

### 9.5 Webhooks sortants

- Configuration UI : `/configuration` -> onglet Integrations -> sous-onglet Webhooks
- Securite : signature HMAC `X-Webhook-Signature` avec secret 32 bytes URL-safe
- Events typiques : `invoice.created`, `payment.received`, `bt.completed`
- Historique deliveries (limit 100) avec status et response body

### 9.6 Strategie de migration / repair

- Migrations defensives : `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` dans chaque router.
- Pas d Alembic initialise.
- **Reference schema** : `REFERENCE_TENANT_SCHEMA` (env var, defaut `tenant_constructi_2802c4`).
- **Audit + Repair** : super-admin peut reparer les tenants vieux ou incomplets via `/admin/tenants/{slug}/repair`.

### 9.7 Pas de table audit log dediee

- **Aucune table `audit_log` centralisee** dans cette version.
- Logging via `logger.info` / `logger.error` calls dans chaque router (sortie stdout/fichier hosting).
- Consultation : logs Render hosting (necessite acces console hosting).
- Tracking IA est l audit le plus complet via `ai_usage_tracking`.

### 9.8 Pas de backup automatique applicatif

- **Aucun endpoint backup/restore** dans le code.
- Backups DB geres au niveau infrastructure (Render PostgreSQL automatic backups quotidiens).
- Pour export tenant manuel : utiliser `pg_dump` cote infrastructure.

### 9.9 FAQ

**Q : Comment devenir super-admin ?**
R : Le super-admin est defini hors plateforme (configuration serveur — credentials hard-codes ou variables d env). Contacter Sylvain Leduc (owner) pour acces. Le super-admin a un login distinct (`/auth/super-admin-login`) avec session_token (pas JWT).

**Q : Pourquoi y a-t-il 2 etapes de login (tenant + user) ?**
R : Architecture multi-tenant. L etape 1 (`tenant-login`) identifie l entreprise (schema), l etape 2 (`user-login`) authentifie le user dans ce schema. Permet a une meme adresse email d exister dans plusieurs tenants (uniques par tenant, pas globalement).

**Q : Que se passe-t-il si un tenant ne paie pas son abonnement ?**
R : Le `subscription_status` Stripe passe a `past_due` ou `canceled`. Le `tenant-login` retourne HTTP 403 avec message « Abonnement inactif ». Les utilisateurs ne peuvent plus se connecter mais les donnees restent en base.

**Q : Combien de tenants peuvent coexister ?**
R : Pas de limite hard-codee. Limite pratique : performance PostgreSQL avec multiplication des schemas (~200-500 schemas par instance recommande). Au-dela : sharding ou base par cluster.

**Q : Comment ajouter un nouveau role utilisateur ?**
R : **Modification de code** : ajouter le role dans la liste cote backend + frontend (dropdown). Pas de configuration UI pour ajouter des roles custom.

**Q : Le super-admin peut-il voir les donnees d un tenant ?**
R : Indirectement. Les endpoints `/admin/*` retournent surtout des **stats agregees** (counts, montants), pas les donnees brutes. Pour acceder aux donnees d un tenant : se connecter en tant qu un user de ce tenant (necessite reset password).

**Q : Comment changer le tarif ERP (79.99$) ?**
R : Modification de constante `ERP_MONTHLY_PRICE` dans `admin.py` + ajustement Stripe Price ID. Necessite redeploiement.

**Q : Comment exempter un tenant de facturation IA ?**
R : Ajouter son ID (entreprise_id) dans `AI_GUARD_EXEMPT_IDS = {1, 105, 172}` (`ai.py:36`). Modification de code + redeploiement.

**Q : Le module Conformite est-il obligatoire au Quebec ?**
R : OUI pour les entreprises de construction reglementees (RBQ exige licence valide, CCQ exige cartes employes). L ERP facilite le suivi mais ne valide pas les conformites avec les organismes officiels (pas d API integration RBQ/CCQ — saisie manuelle).

**Q : Les attestations CNESST sont-elles renouvelees automatiquement ?**
R : NON. Le module rappelle les expirations (alertes 30/60 jours) mais le renouvellement se fait manuellement aupres de la CNESST. Apres renouvellement : modifier l attestation dans l ERP avec nouvelle date_expiration.

**Q : Comment ajouter une categorie RBQ personnalisee ?**
R : La liste des 26 categories RBQ est codee en dur (`conformite.py`). Modification de code requise. Les RBQ officielles sont fixes (pas de personnalisation possible).

**Q : Le sync QuickBooks est-il bidirectionnel en temps reel ?**
R : NON. Sync **a la demande** uniquement (bouton « Synchroniser »). Pas de sync automatique programmee. Pour automatiser : creer un cron externe qui appelle `/integrations/{id}/sync` periodiquement.

**Q : Les webhooks sont-ils retentes en cas d echec ?**
R : Implementation actuelle : pas de retry automatique (a verifier en prod). Pour robustesse : utiliser un service tiers (Hookdeck, Svix) pour gerer les retries.

**Q : Comment voir les logs d audit complets d un tenant ?**
R : **Pas de table audit centralisee**. Les actions IA sont auditees dans `ai_usage_tracking`. Les autres actions ne sont auditees que via les logs hosting (acces Render). Pour audit business complet : utiliser le sync QuickBooks (toutes les ecritures syncees).

**Q : Comment desactiver l auto-creation de tables ?**
R : Le code utilise `CREATE TABLE IF NOT EXISTS` partout (defensive). Pour migration formelle : initialiser Alembic. Pas configurable en UI.

**Q : Le module Subventions interagit avec les organismes (Hydro-Quebec, etc.) ?**
R : NON. Le module aide a **gerer les demandes** (formulaire, checklist, suivi statut, IA aide redaction) mais ne soumet pas directement aux organismes. La soumission finale se fait sur les portails officiels.

**Q : Les calculateurs sont-ils certifies / normes ?**
R : Les calculateurs implementent des formules standards (CNB, CSA, manuels metier) mais les resultats sont **a titre indicatif**. Pour calculs officiels (permis, assurance), valider avec un ingenieur professionnel.

---

## 10. Recap one-pager

- **3 niveaux d acces** : Super-admin (`/admin`) / Tenant admin (`/configuration`) / User standard.
- **5 roles users** : admin / user / employee / comptable / gestionnaire (+ flag `is_admin` superpose).
- **Architecture** : multi-tenant PostgreSQL schema-per-tenant + tables `public` partagees.
- **2 etapes login** : tenant-login (entreprise) puis user-login (user dans tenant) -> JWT.
- **Constantes plateforme** : ERP 79.99$/mois, Render 434.67$/mois, commissions reps 40%, taxes 26.5%.

### 6 onglets `/admin` (super-admin)
Entreprises / En Ligne / Usage IA / Finances / Mises a jour / Representants.

### 7 onglets `/configuration` (tenant admin)
Profil / Utilisateurs / Entreprise / Soumissions / Apparence (theme 8 couleurs) / Abonnement / Integrations.

### 6 onglets `/integration`
Vue d ensemble / QuickBooks / Sage 50 / Webhooks / Correspondance / Historique.

### 3 sections `/conformite`
Licences RBQ (26 categories) / Cartes CCQ (28 metiers) / Attestations (5 types incl. CNESST). 7 endpoints IA Claude Opus 4.7.

### Modules complementaires
- **Subventions** : aide demandes gouvernementales + 5 endpoints IA Sonnet
- **Calculateurs** : multi-metiers (beton, electricite, toiture, peinture, plomberie, CVAC)
- **Fonds Prevoyance Loi 16** : copropriete + IA analyse + calcul valeur reconstruction

### Theme documents (8 couleurs personnalisables)
primary `#1F4E79` / primary_dark / accent `#27A376` / accent_light / header_text / table_row_alt / info_bg / border. Race-safe SELECT FOR UPDATE.

### Limitations connues
- Pas de table audit log centralisee (logs hosting + ai_usage_tracking seulement)
- Pas de backup applicatif (geree par hosting)
- Pas d Alembic (migrations defensives `IF NOT EXISTS`)
- Pas de sync auto QuickBooks (a la demande seulement)
- Pas de retry webhook automatique
- Pas de roles configurables UI (5 roles codes en dur)
- Constantes financieres codees en dur (ERP_PRICE, RENDER_COST, etc.)

---

**Documentation generee a partir du code** : `admin.py` (1379 lignes), `auth.py` (698 lignes), `config.py` (1167 lignes), `conformite.py` (2192 lignes), `integration.py`, `subventions.py`, `calculators.py`, `fonds_prevoyance.py`, `AdminPage.tsx`, `ConfigurationPage.tsx`, `IntegrationPage.tsx`, `ConformitePage.tsx`, `SubventionsPage.tsx`.

**Manuels lies** :
- Module 9 (Employes — fiches employes liees aux cartes CCQ) — `09-employes.md`
- Module 19 (Immobilier — sous-onglet Fonds Prevoyance) — `11-immobilier.md`
- Module 25 (IA — credits IA, Stripe) — `12-ia.md`
- README principal (vue d ensemble manuels) — `README.md`

---

**Felicitations !** Vous avez termine la lecture du manuel utilisateur complet de Constructo AI ERP, version 2.0 verifiee contre code source. Pour une vue d ensemble : voir [README.md](./README.md).
