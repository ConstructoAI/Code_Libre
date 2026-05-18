# Module 23 — Emails (Webmail integre)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/emails.py` (2722 lignes), `frontend/src/pages/EmailsPage.tsx`, `frontend/src/api/emails.ts`, `frontend/src/store/useEmailsStore.ts`, `modules/email_manager/email_utils.py` (providers + chiffrement), `modules/email_manager/email_client.py` (IMAP/SMTP/OAuth2)
> **Tables PostgreSQL (par tenant)** : `email_accounts`, `emails`, `email_attachments`, `email_templates`, `email_sync_log`
> **Cadrage** : ce module est un **client webmail integre** type Outlook (boite de reception, dossiers, composer, envoyer, synchroniser IMAP, OAuth2 Microsoft 365). Il gere les **emails externes entrants/sortants** via les serveurs email de l utilisateur (Gmail, Outlook, GoDaddy, M365, etc.). Il **n est pas** une messagerie interne entre utilisateurs (voir Module 24 Messagerie) ni un systeme de notifications systeme (voir Module 28 Administration).

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

Offrir un **client webmail integre** dans l ERP pour gerer les emails professionnels sans quitter l application :
- **Multi-comptes par utilisateur** (Gmail + GoDaddy + M365 simultanement).
- **Reception IMAP** (sync a la demande) + **envoi SMTP** reel via le serveur du fournisseur.
- **OAuth2 Microsoft 365** (alternative a Basic Auth pour les locataires Azure AD modernes).
- **4 dossiers UI** : Boite de reception, Envoyes, Brouillons, Corbeille (+ archive et spam supportes mais non exposes UI).
- **Recherche** ILIKE sur sujet / expediteur / destinataire / corps.
- **Marquage** : lu / non lu, etoile, important, spam.
- **Pieces jointes** : stockage BYTEA + telechargement.
- **5 templates email** preconfigures pour la construction (devis, facture, rappel, mise a jour, demande de prix).
- **Auto-link CRM** : sync IMAP match les emails entrants contre `contacts` (par email) pour remplir `contact_id` et `company_id`.
- **Multi-utilisateurs** : chaque compte appartient a un user (`user_id`) — isolation entre users du meme tenant.

### 1.2 Architecture

3 couches : **Frontend React** (page Outlook-like) + **Router FastAPI** (`/emails/*`, 22 endpoints) + **modules.email_manager** (`EmailClient` IMAP/SMTP/OAuth, chiffrement Fernet, `EMAIL_PROVIDERS`). Si `email_manager` indisponible (`HAS_EMAIL_MANAGER = False`), les endpoints IMAP/SMTP retournent HTTP 500 « Module email non disponible ».

### 1.3 Ce que le module fait — et ne fait PAS

Le module **fait** : synchroniser IMAP a la demande (modes `new`/`recent`/`all`), envoyer reellement via SMTP, stocker les emails en base pour recherche hors-ligne, auto-detecter le provider depuis le domaine, OAuth2 Microsoft 365, sanitizer le HTML recu, lier automatiquement les emails entrants aux contacts CRM par adresse.

Le module **ne fait PAS** :
- **Sync periodique automatique** (pas de cron interne — sync manuelle ou via job externe).
- **Push email instantane** (pas de IMAP IDLE ni webhook Microsoft Graph).
- **Sync bidirectionnelle des etats** : marquer lu / supprimer / deplacer dans l ERP ne se repercute PAS sur le serveur IMAP, et inversement.
- **Editeur WYSIWYG** : composer = Textarea texte simple, HTML genere automatiquement (`<br>` pour les retours).
- **Brouillons cote ERP** : pas de bouton « Sauver brouillon ». Le dossier `drafts` se remplit seulement si IMAP synchronise des brouillons existants.
- **Filtres / regles auto**, **OAuth2 Gmail** (seul M365), **mailing list / vCard**, **PGP / S/MIME**, **DKIM / DMARC** (cote serveur du fournisseur), **recherche full-text indexee** (ILIKE simple sur 4 colonnes).

### 1.4 Acces

- Sidebar -> **Emails** (icone Mail / Inbox).
- URL : `/emails`.
- Layout responsive : 3 colonnes en desktop (sidebar dossiers / liste messages / panneau lecture), pleine largeur en mobile avec sidebar repliable.

### 1.5 Permissions et isolation

- Tous les utilisateurs authentifies du tenant peuvent acceder a la page.
- **Isolation par utilisateur** : chaque compte email a un champ `user_id`. Les requetes filtrent via `(user_id = %s OR user_id IS NULL)`. Un compte avec `user_id IS NULL` est un compte « partage / legacy » visible par tous les users du tenant (avant la migration multi-user).
- **Pas de role admin email** : aucun utilisateur ne peut voir les comptes d un autre utilisateur du meme tenant.
- **Test de connexion** : ouvert a tout user proprietaire du compte.
- **Suppression** : soft-delete (`active = FALSE`) sur le compte ; les emails restent en base.

---

## 2. Interface

### 2.1 Layout general

Source : `EmailsPage.tsx`. Page plein ecran (`h-[calc(100vh-180px)]`) divisee en 3 zones desktop :

| Zone                | Largeur desktop  | Contenu                                                       |
|---------------------|------------------|---------------------------------------------------------------|
| **Sidebar gauche**  | 224 px (`md:w-56`) | Bouton Nouveau, selecteur de compte, 4 dossiers, bouton Parametres, info derniere sync |
| **Liste messages**  | 320 px (`md:w-80`) | Recherche + sync, liste paginee (50/page), badge non-lu, etoile, paperclip |
| **Panneau lecture** | flex-1           | Sujet, expediteur, destinataires, date, corps HTML/text, pieces jointes |

En mobile : sidebar en overlay (toggle via icone Inbox), une zone visible a la fois.

### 2.2 Sidebar gauche : dossiers et comptes

- **Bouton Nouveau** : ouvre la modale composer.
- **Selecteur de compte** : dropdown avec « Tous les comptes » (defaut, agrege tous les comptes du user) ou un compte specifique (filtre via `?account_id`). Le compte `is_default` est utilise pour l envoi par defaut.
- **4 dossiers** :

| Cle      | Label                | Source                                                       |
|----------|----------------------|--------------------------------------------------------------|
| `inbox`  | Boite de reception   | Emails entrants synchronises depuis IMAP                     |
| `sent`   | Envoyes              | Emails envoyes via SMTP + sync IMAP                          |
| `drafts` | Brouillons           | Emails draft synchronises depuis IMAP (pas de creation ERP)  |
| `trash`  | Corbeille            | Emails soft-delete ou deplaces                               |

> **Note** : Le backend supporte aussi `archive` et `spam` mais ces dossiers ne sont pas dans la sidebar. L action « Archiver » deplace vers `archive` mais sans bouton de navigation pour le visualiser.

Chaque dossier affiche un badge avec le `unread_count` (`GET /stats`).

- **Bouton Parametres** : ouvre la modale parametres (2 onglets). Affiche aussi « Sync: il y a X » base sur `lastSyncAt`.

### 2.3 Zone du milieu : liste messages

- **Champ de recherche** avec debounce 400 ms. Recherche ILIKE sur 4 colonnes : `subject`, `email_from`, `email_to`, `body_text`.
- **Bouton Refresh** : sync le compte selectionne, ou tous les comptes via `POST /sync`.
- **Banner « Aucun compte »** : si aucun compte configure, banner ambre + bouton **Configurer**.
- **Liste de messages** : pour chaque message — pastille bleue si non-lu, expediteur en gras, date relative, sujet, indicateurs (etoile, paperclip). Click -> charge le message via `GET /messages/{id}`.
- **Pagination** : 50/page (max 100). Boutons Prec/Suiv si `total > 50`.

### 2.4 Panneau de lecture (droite)

**En-tete** : sujet (H2), expediteur (nom + adresse), destinataires (`emailTo` + `emailCc`), date relative.

**Boutons d action** (en haut a droite) :

| Bouton                | Action                                                                  |
|-----------------------|-------------------------------------------------------------------------|
| **Etoile**            | Toggle `is_starred` via `PUT /messages/{id}/star`                       |
| **Archiver**          | Visible si dossier != trash. Deplace vers `archive`                     |
| **Corbeille**         | Si dossier = trash : DELETE definitif. Sinon : deplace vers `trash`     |
| **Repondre**          | Ouvre composer pre-rempli avec `Re: <sujet>` + corps cite               |
| **Fermer** (X)        | Vide la selection                                                       |

**Corps** : si `bodyHtml` present, rendu via `dangerouslySetInnerHTML` apres `sanitizeHtml`. Sinon `bodyText` dans un `<pre>`. Style `prose` Tailwind.

**Pieces jointes** : section affichee si presentes. Click -> `GET /attachments/{id}/download` -> Blob -> declenche download avec filename original.

### 2.5 Modale « Nouveau message » (composer)

Modale taille `lg`. Comporte :
- **Selecteur de modele** (si `templates.length > 0`) : dropdown listant les templates par `nom (categorie)`. Selection remplit automatiquement le sujet et le corps (HTML converti en texte brut).
- **Champs** : **A** (obligatoire), **Cc**, **Cci**, **Objet**, **Message** (textarea 8 rows).
- **Boutons** : **Annuler** + **Envoyer** (disabled si `composeTo` vide).
- A l envoi : `POST /messages/send`. Le `body_html` est genere par le frontend (echappe `<`/`>`, replace `\n` par `<br>`). Compte utilise = `is_default` du user.

### 2.6 Modale « Parametres email »

**Onglet « Comptes »** — Pour chaque compte : nom, adresse, provider, badge **Defaut** / **OAuth2**, date de derniere sync, 3 boutons (**Tester** / **Sync** mode `recent` / **Supprimer**). Le resultat du test affiche IMAP + SMTP (vert/rouge) avec message d erreur categorise (cf. 4.4) et top 5 dossiers IMAP detectes.

**Ajouter un compte** : 2 options :
1. **Connecter Microsoft 365 (OAuth2)** : bouton `#0078D4`. Click -> `POST /oauth/m365/start` -> redirect Microsoft -> consentement -> creation automatique avec `oauth_provider = 'm365'`.
2. **Ajouter manuellement (IMAP/SMTP)** : formulaire avec adresse (auto-detect provider apres 600 ms), dropdown fournisseur (Gmail / Outlook / Yahoo / iCloud / GoDaddy / Microsoft365 / Autre — selection auto-fill IMAP/SMTP), mot de passe, nom du compte, serveurs/ports modifiables. IMAP et SMTP servers obligatoires.

**Onglet « Synchronisation »** — Bouton **Sync maintenant**. Liste des 20 derniers `email_sync_log` : icone (CheckCircle vert / XCircle rouge / Clock jaune), adresse, badge `+N` vert si nouveaux emails, message d erreur si echec.

---

## 3. Workflows pas-a-pas

### 3.1 Connecter un compte Gmail

1. Sidebar -> **Parametres** -> **Ajouter manuellement (IMAP/SMTP)**.
2. Saisir `votreadresse@gmail.com`. Apres 600 ms, `GET /providers/detect` auto-remplit : `imap.gmail.com:993` SSL + `smtp.gmail.com:587` STARTTLS.
3. Saisir le **mot de passe d application** (PAS le mot de passe Google — generer via https://myaccount.google.com/apppasswords).
4. Saisir un nom puis **Ajouter** -> `POST /accounts`. Backend chiffre via Fernet (`EMAIL_SECRET_KEY`).
5. **Tester** -> verifie IMAP + SMTP. Puis **Sync** -> recupere les emails non-lus.

### 3.2 Connecter un compte Microsoft 365 (OAuth2)

1. **Pre-requis serveur** : variables `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `M365_TENANT_ID` (defaut `common`), `M365_REDIRECT_URI`. Sans ces variables, HTTP 503.
2. Bouton **Connecter Microsoft 365 (OAuth2)** -> `POST /oauth/m365/start` -> recoit `authorize_url` -> redirect top-level vers Microsoft (state HMAC-signe TTL 10 min).
3. L utilisateur consent : 4 scopes (`IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`, `User.Read`).
4. Microsoft redirect vers `/emails/oauth/m365/callback`. Backend valide le state, echange le code, fetch l adresse via Graph `/me`, cree/UPDATE `email_accounts` avec `oauth_provider = 'm365'` + tokens chiffres.
5. Redirect frontend vers `/emails?oauth_status=success&oauth_email=...`.

> **Refresh automatique** : `_get_valid_m365_access_token()` refresh le token expire (marge 5 min) avant chaque appel IMAP/SMTP. Microsoft rotate parfois le refresh_token — le nouveau est rechiffre et persiste.

### 3.3 Connecter un compte GoDaddy Workspace

1. **Ajouter manuellement** -> saisir l adresse (auto-detect renvoie `Autre`).
2. Selectionner manuellement **GoDaddy** -> auto-fill `imap.secureserver.net:993` + `smtpout.secureserver.net:587`.
3. Saisir le mot de passe Workspace habituel (pas d App Password — GoDaddy Workspace n utilise pas 2FA App Password).
4. **Ajouter** -> **Tester** -> **Sync**. Si echec port 587, essayer port 465 SSL direct.

### 3.4 Tester une connexion

`POST /accounts/{id}/test` essaye sequentiellement IMAP puis SMTP. Erreurs categorisees (cf. 4.4). Si IMAP OK, retourne aussi les top 5 dossiers IMAP detectes (`INBOX`, `Sent`, `[Gmail]/Sent Mail`, etc.).

### 3.5 Synchroniser les emails (IMAP)

**Sync d un seul compte** : `POST /sync/{account_id}` avec body `{sync_mode}` (defaut `new`). Backend :
1. Cree row `email_sync_log` (`RUNNING`).
2. Refresh OAuth access_token si M365.
3. Connecte IMAP via `EmailClient`.
4. Pour chaque dossier (defaut `INBOX`) :
   - Mode `new` -> `IMAP SEARCH UNSEEN`.
   - Mode `recent` -> `SEARCH ALL` puis 50 derniers.
   - Mode `all` -> `SEARCH ALL`.
5. Pour chaque email : check duplicate via `(message_id, account_id)`, **auto-link CRM** (SELECT contact par email -> remplit `contact_id` + `company_id`), INSERT `emails` (`INBOUND`, `UNREAD`), INSERT pieces jointes (BYTEA).
6. Update log et `last_sync_at`.

**Sync de tous les comptes** : `POST /sync` -> boucle sur tous les comptes du user avec `active = TRUE`, `sync_enabled = TRUE`, et au moins un credential.

> **Pas de cron interne** : sync a la demande uniquement, ou via job externe.

### 3.6 Composer et envoyer un email

1. Bouton **Nouveau** ouvre la modale composer.
2. (Optionnel) Selectionner un modele -> sujet + corps remplis.
3. Saisir A / Cc / Cci / Objet / Message + **Envoyer**.
4. `POST /messages/send` :
   - Resolve account (defaut = `is_default` du user).
   - Prepare auth (refresh OAuth M365 si necessaire).
   - Si `template_code` + `template_variables` fournis : substitue `{{variable}}` et retire les placeholders non resolus.
   - Envoie via `EmailClient.connect_smtp()` + `send_email()`.
   - INSERT dans `emails` (`OUTBOUND`, `SENT`, `folder = sent`).
5. Si SMTP echoue : retourne `{smtp_sent: false, smtp_error}` — l email reste en Envoyes mais sans envoi reel.

**Repondre** : bouton dans le panneau lecture -> modale pre-remplie avec **A** = expediteur, **Sujet** = `Re: <sujet>`, **Corps** = separator + « De: ... Date: ... » + corps original cite.

> **Pas de threading auto** : le `thread_id` n est pas injecte. Chaque reply apparait comme un nouveau thread cote serveur.

### 3.7 Marquer / etoiler / archiver / supprimer un email

| Action            | Endpoint                       | Effet                                                                          |
|-------------------|--------------------------------|--------------------------------------------------------------------------------|
| **Marquer lu**    | `PUT /messages/{id}/read`      | `is_read = TRUE`, `date_read = now()`                                          |
| **Toggle etoile** | `PUT /messages/{id}/star`      | Bascule `is_starred`                                                           |
| **Deplacer**      | `PUT /messages/{id}/move`      | Body `{folder}` (inbox / sent / drafts / trash / archive). 400 si invalide     |
| **Supprimer**     | `DELETE /messages/{id}`        | Si `folder != trash` -> trash. Si deja trash -> DELETE definitif (cascade PJ)  |

> **Aucune action n est repercutee sur le serveur IMAP** — purement local.

### 3.8 Telecharger une piece jointe

`GET /attachments/{id}/download` retourne un Blob. Frontend cree un `<a download>` invisible. Stockage BYTEA dans `email_attachments.file_data` (pas de S3 — base peut grossir vite).

### 3.9 Rechercher un email

Saisir du texte dans le champ -> debounce 400 ms -> `GET /messages?folder=...&search=...`. Backend execute ILIKE sur `subject`, `email_from`, `email_to`, `body_text` avec echappement des wildcards `%` et `_`. **Pas de full-text indexe** (`tsvector`).

### 3.10 Utiliser un template d email

Dropdown **Modele** dans le composer -> remplit sujet + corps (HTML converti en texte plain). Les variables `{{nom_contact}}`, `{{numero_devis}}`, etc. doivent etre modifiees manuellement (ou envoyer tel quel — les placeholders non resolus sont strippes via regex). 5 templates seedes par defaut (cf. 4.6), pas de CRUD UI.

### 3.11 Voir l historique de synchronisation

Modale parametres -> onglet **Synchronisation** -> `GET /sync/logs?limit=20`. Affiche par compte : icone statut, adresse, nb nouveaux emails, erreur, date.

---

## 4. Reference

### 4.1 Endpoints router (`/emails`)

22 endpoints au total (prefix `/emails`) :

| # | Methode | URL                                  | Role                                                  |
|---|---------|--------------------------------------|-------------------------------------------------------|
| 1 | GET     | `/providers`                         | Liste des providers connus avec config IMAP/SMTP      |
| 2 | GET     | `/providers/detect`                  | Auto-detect provider depuis adresse email             |
| 3 | POST    | `/oauth/m365/start`                  | Demarrer flow OAuth Microsoft 365                     |
| 4 | GET     | `/oauth/m365/callback`               | Callback OAuth (pas d auth JWT — state HMAC)          |
| 5 | GET     | `/accounts`                          | Liste des comptes du user (+ partages legacy)         |
| 6 | POST    | `/accounts`                          | Creer un compte IMAP/SMTP                             |
| 7 | POST    | `/accounts/{id}/test`                | Tester connexion IMAP + SMTP                          |
| 8 | DELETE  | `/accounts/{id}`                     | Soft-delete (`active = FALSE`)                        |
| 9 | GET     | `/messages`                          | Liste paginee des emails (folder, search, account_id) |
| 10| GET     | `/messages/{id}`                     | Detail d un email + pieces jointes                    |
| 11| PUT     | `/messages/{id}/read`                | Marquer comme lu                                      |
| 12| PUT     | `/messages/{id}/star`                | Toggle etoile                                         |
| 13| PUT     | `/messages/{id}/move`                | Deplacer vers un autre dossier                        |
| 14| DELETE  | `/messages/{id}`                     | Trash ou DELETE definitif si deja trash               |
| 15| POST    | `/messages/send`                     | Envoyer via SMTP (+ INSERT en base)                   |
| 16| POST    | `/sync`                              | Sync tous les comptes du user                         |
| 17| GET     | `/sync/logs`                         | Historique des syncs (defaut 20)                      |
| 18| POST    | `/sync/{id}`                         | Sync un seul compte                                   |
| 19| GET     | `/templates`                         | Liste des templates email (lecture seule)             |
| 20| GET     | `/attachments/{id}/download`         | Telecharger une piece jointe (Blob)                   |
| 21| GET     | `/threads/{thread_id}`               | Charger tous les messages d un thread                 |
| 22| GET     | `/stats`                             | Compteurs unread par dossier + last_sync_at           |

### 4.2 Tables PostgreSQL (par tenant)

#### 4.2.1 `email_accounts` (colonnes principales)

`id` PK, `email_address`, `provider` (Gmail / Outlook / Yahoo / iCloud / GoDaddy / Microsoft365 / Autre), `name`, `imap_server / imap_port / imap_use_ssl` (defauts 993 SSL), `smtp_server / smtp_port / smtp_use_tls` (defauts 587 STARTTLS), `password_encrypted` (Fernet, Basic Auth), `user_id` (owner — NULL = legacy/partage), `sync_enabled`, `sync_interval_minutes` (defaut 15 — informatif, pas de cron implemente), `sync_folders` (defaut `'INBOX'`), `last_sync_at / last_sync_status / last_sync_error`, `signature_html / signature_text`, `is_default`, `active` (soft-delete), `oauth_provider` (`m365` seul implemente), `oauth_refresh_token_encrypted / oauth_access_token_encrypted` (Fernet), `oauth_token_expires_at`, `oauth_scope`.

#### 4.2.2 `emails` (colonnes principales)

`id` PK, `account_id` FK, `message_id` (RFC 5322 — UNIQUE per `account_id`), `thread_id`, `in_reply_to`, `email_from / email_from_name / email_to / email_cc / email_bcc / email_reply_to`, `subject`, `body_text`, `body_html`, `date_sent / date_received / date_read`, `direction` (INBOUND / OUTBOUND), `status` (UNREAD / READ / SENT), `is_read / is_starred / is_important / is_spam / has_attachments`, `labels_json`, `folder` (inbox / sent / drafts / trash / archive / spam), et 6 FK ERP : `project_id / company_id / contact_id / facture_id / devis_id / opportunity_id`.

> **Liaisons ERP** : Seuls `company_id` et `contact_id` sont **auto-remplis** par le sync IMAP (via `SELECT FROM contacts WHERE email = ...`). Les autres FK existent mais ne sont jamais remplies (reservees pour usages futurs).

#### 4.2.3 `email_attachments`

`id` PK, `email_id` FK CASCADE, `filename`, `content_type` (MIME), `size_bytes`, `file_data` BYTEA (contenu reel — stockage en base, pas S3), `is_inline`, `cid` (Content-ID pour images inline). Champs `storage_path` et `file_hash` presents dans le schema mais non utilises.

#### 4.2.4 `email_templates`

`id` PK, `code` UNIQUE, `name`, `category` (COMMERCIAL / COMPTABILITE / PRODUCTION / GENERAL), `subject_template`, `body_html_template`, `body_text_template`, `available_variables_json`, `default_from_name`, `auto_attach_logo` (defaut FALSE — non applique), `auto_attach_signature` (defaut TRUE), `is_system`, `usage_count`, `last_used_at`.

#### 4.2.5 `email_sync_log`

`id` PK, `account_id` FK CASCADE, `sync_started_at / sync_completed_at`, `sync_status` (RUNNING / SUCCESS / ERROR / SKIPPED), `new_emails_count`, `errors_count`, `error_message`, `folders_synced` (JSON array).

### 4.3 Index et contraintes

- **Index unique** : `idx_emails_message_account` ON `emails(message_id, account_id)` WHERE `message_id IS NOT NULL` -> empeche les doublons lors de la sync.
- **CASCADE DELETE** : `email_attachments` et `email_sync_log` cascade sur suppression du compte.
- **Defensive migrations** : `ALTER TABLE ADD COLUMN IF NOT EXISTS` sur ~40 colonnes au boot pour les tenants legacy.
- **Memoization** : `_email_tables_ensured_for: set` evite de re-executer les CREATE/ALTER a chaque appel.

### 4.4 Categorisation des erreurs IMAP/SMTP

Le test de connexion (`POST /accounts/{id}/test`) categorise les exceptions :

| Exception                                      | Message retourne                                                  |
|-----------------------------------------------|-------------------------------------------------------------------|
| `ValueError` (mot de passe non chiffrable)    | « Mot de passe non configure. Recreer le compte. »                |
| `imaplib.IMAP4.error` / `smtplib.SMTPAuthenticationError` | « Authentification echouee. App password requis pour Gmail/Outlook 2FA. » |
| `socket.gaierror`                             | « Serveur injoignable. Verifiez le nom et le port. »              |
| `socket.timeout`                              | Idem                                                              |
| `ConnectionRefusedError`                      | Idem                                                              |
| `ssl.SSLError`                                | « Erreur SSL/TLS. Le port ne correspond pas (993 SSL direct, 143 STARTTLS non supporte). » |
| Generique                                      | « Echec de connexion. Verifiez le serveur et le mot de passe. »   |

### 4.5 Auto-detection du provider depuis l adresse

Source : `email_utils.py:detect_provider_from_email`.

| Domaine de l adresse                            | Provider detecte |
|------------------------------------------------|------------------|
| `@gmail.com`, `@googlemail.com`                | Gmail            |
| `@outlook.com`, `@hotmail.com`, `@live.com`    | Outlook          |
| `@yahoo.com`, `@yahoo.fr`                      | Yahoo            |
| `@icloud.com`, `@me.com`, `@mac.com`           | iCloud           |
| Tout autre domaine                             | Autre            |

> **Limite** : un domaine custom (ex. `@constructoai.ca` heberge sur GoDaddy ou Microsoft 365) sera detecte comme `Autre`. Le user doit selectionner manuellement GoDaddy ou Microsoft365 dans le dropdown.

### 4.6 Templates email seedes par defaut

Source : `_seed_default_templates()` dans `emails.py`. Inserees au premier appel de `_ensure_email_tables()` si la table est vide.

| Code              | Nom                          | Categorie     | Variables (extrait)                                        |
|-------------------|------------------------------|---------------|------------------------------------------------------------|
| `devis_envoye`    | Envoi de soumission/devis    | COMMERCIAL    | nom_contact, numero_devis, nom_projet, montant_total, validite_jours, nom_entreprise |
| `facture_envoyee` | Envoi de facture             | COMPTABILITE  | nom_contact, numero_facture, montant_total, date_echeance, modalites_paiement, nom_entreprise |
| `facture_rappel`  | Relance de paiement          | COMPTABILITE  | nom_contact, numero_facture, montant_du, jours_retard, nom_entreprise |
| `projet_update`   | Mise a jour de projet        | PRODUCTION    | nom_contact, nom_projet, pourcentage_completion, date_fin_prevue, message_update, nom_entreprise |
| `demande_prix`    | Demande de prix materiaux    | COMMERCIAL    | nom_projet, type_materiaux, liste_materiaux, quantites, date_livraison, adresse_chantier, nom_entreprise |

Tous marques `is_system = TRUE`. Pas d API CRUD pour creer/modifier ces templates dans la version actuelle — il faut editer la DB manuellement OU rejouer le seed apres TRUNCATE.

### 4.7 Mapping IMAP folder -> ERP folder

Source : `_FOLDER_MAP` dans `emails.py:421-434`.

| IMAP folder                | ERP folder |
|----------------------------|------------|
| `inbox`                    | inbox      |
| `[gmail]/sent mail`, `sent`, `sent items`, `sent messages` | sent       |
| `[gmail]/trash`, `trash`, `deleted`, `deleted items`, `deleted messages` | trash      |
| `[gmail]/drafts`, `drafts`, `draft` | drafts     |
| `[gmail]/spam`, `junk`, `spam` | spam       |
| `[gmail]/all mail`, `archive` | archive    |

### 4.8 Modes de synchronisation

| Mode      | Filtre IMAP        | Limite                                 |
|-----------|--------------------|----------------------------------------|
| `new`     | `SEARCH UNSEEN`    | Tous les non-lus du serveur            |
| `recent`  | `SEARCH ALL`       | 50 derniers emails (slice `[-50:]`)    |
| `all`     | `SEARCH ALL`       | Tous (peut etre tres lent / lourd)     |

### 4.9 OAuth2 Microsoft 365 — variables d environnement

| Variable                  | Defaut                                               | Role                                            |
|---------------------------|------------------------------------------------------|-------------------------------------------------|
| `M365_CLIENT_ID`          | (vide -> erreur 503)                                 | Application ID Azure AD                         |
| `M365_CLIENT_SECRET`      | (vide -> erreur 503)                                 | Secret client Azure AD                          |
| `M365_TENANT_ID`          | `common`                                             | Tenant Azure AD ou GUID specifique              |
| `M365_REDIRECT_URI`       | `https://app.constructoai.ca/api/erp/v1/emails/oauth/m365/callback` | Doit matcher l app Azure AD       |
| `M365_FRONTEND_RETURN_URL`| `https://app.constructoai.ca/emails`                 | URL retour apres callback                       |
| `EMAIL_SECRET_KEY`        | (env required)                                       | Cle Fernet pour chiffrement passwords / tokens  |
| `JWT_SECRET` (`ERP_JWT_SECRET`) | (env required en prod)                          | Signature HMAC du state OAuth                   |

Scopes M365 demandes :
- `https://outlook.office.com/IMAP.AccessAsUser.All`
- `https://outlook.office.com/SMTP.Send`
- `offline_access`
- `https://graph.microsoft.com/User.Read`

State OAuth : HMAC-signe (multi-worker safe), TTL 10 min, format `base64url(payload).base64url(hmac_sha256)`.

### 4.10 Sanitization HTML

Source : `EmailsPage.tsx:29-35` (`sanitizeHtml`).

Strip :
- `<script>...</script>` (regex insensitive)
- Attributs `on*=` (`onclick`, `onmouseover`, etc.) — versions quotees et non-quotees.
- `javascript:` -> remplace par `blocked:`.

Note : sanitization basique au regex, pas un parser DOM. Suffisant pour bloquer les XSS triviaux mais pas un substitut a un sanitizer DOM type DOMPurify.

### 4.11 Validations & limites

| Regle                                            | Effet                                                  |
|--------------------------------------------------|--------------------------------------------------------|
| `imap_server` ou `smtp_server` vide              | HTTP 400 a la creation du compte                       |
| `password` vide ET pas OAuth                     | Compte cree sans credentials, sync skip avec HTTP 400  |
| `folder` invalide (move)                         | HTTP 400 « Dossier invalide »                          |
| `account_id` non possede par le user             | HTTP 404 « Compte non trouve »                         |
| `email_id` non possede par le user (via account) | HTTP 404                                               |
| `attachment_id` non possede                      | HTTP 404                                               |
| `oauth_access_token` expire ET refresh echoue    | HTTP 400 « Reconnectez le compte Microsoft 365 »       |
| State OAuth invalide ou expire                   | Redirect `?oauth_status=error&oauth_error=state_invalide` |
| `M365_CLIENT_ID` non configure                   | HTTP 503 « Connexion M365 non disponible »             |
| `EMAIL_SECRET_KEY` change apres chiffrement      | `ValueError` au decrypt -> message « Token illisible. Reconnecter le compte. » |
| `per_page` > 100                                 | HTTP 422 (validation Pydantic `le=100`)                |
| Pas de tables emails sur le tenant               | Auto-creation au premier appel via `_ensure_email_tables` |

### 4.12 Constants importantes

```python
# emails.py
_OAUTH_STATE_TTL_SECONDS = 600                     # 10 minutes
_M365_REFRESH_SAFETY_MARGIN = timedelta(minutes=5)  # Refresh 5 min avant expiration
_M365_HTTP_TIMEOUT = 15                            # secondes pour exchange token
M365_TENANT_ID = "common" (defaut)                 # Multi-tenant Azure
M365_SCOPES = [IMAP.AccessAsUser.All, SMTP.Send, offline_access, User.Read]

# Folders ERP valides pour move
("inbox", "sent", "drafts", "trash", "archive")

# Pagination
per_page defaut = 50, max = 100

# Sync mode 'recent' limit
slice [-50:]
```

---

## 5. Integrations & FAQ

### 5.1 Integration CRM (Module 3)

- **Auto-link contact** au sync IMAP : `SELECT id, company_id FROM contacts WHERE email = <expediteur>` -> remplit `contact_id` et `company_id`.
- **Pas de lien inverse** : depuis la fiche contact, pas de vue « emails recus de cette personne ».
- Match par email exact uniquement (pas de fuzzy match).

### 5.2 Integrations ERP non implementees

| Module                  | FK presente dans `emails`     | Statut                                                     |
|-------------------------|-------------------------------|------------------------------------------------------------|
| Module 1 Projets        | `project_id`                  | Champ DB present, jamais rempli, pas de vue inverse        |
| Module 7 Comptabilite   | `facture_id`                  | Champ DB present, jamais rempli — Module 7 a son propre envoi (Brevo/SendGrid) |
| Module 4 Devis          | `devis_id`                    | Idem                                                       |
| CRM Opportunites        | `opportunity_id`              | Idem                                                       |
| Module 25 IA            | -                             | Pas d integration IA (pas de scan PJ, pas de resume, pas de classification) |
| Module 28 Notifications | -                             | Pas de notification systeme sur reception. Badge `unread_count` mis a jour seulement sur reload |
| Module 01 Calendar      | -                             | Pas de parsing `.ics` automatique                          |

### 5.3 Securite

- **Chiffrement passwords + tokens** : Fernet via `EMAIL_SECRET_KEY` env. Changement de cle -> indechiffrable, message « Reconnecter le compte ».
- **State OAuth HMAC-signe** : `JWT_SECRET` (`ERP_JWT_SECRET`), TTL 10 min, multi-worker safe.
- **Sanitization HTML** : strip `<script>`, attributs `on*`, `javascript:` (regex, pas DOM parser).
- **ILIKE escape** : `%` et `_` echappes dans la recherche utilisateur.
- **Open redirect protection** : `_normalize_return_url()` accepte same-origin uniquement.
- **Tenant isolation** : `db.set_tenant()` avant chaque requete.
- **User isolation** : filtre `(user_id = %s OR user_id IS NULL)` sur tous les SELECT/UPDATE.

### 5.9 FAQ

**Q : Pourquoi je ne recois pas mes nouveaux emails automatiquement ?**
R : Le module n a **pas de sync periodique**. Cliquer sur refresh dans la liste, ou **Sync** dans les parametres. Pour automatiser : configurer un cron externe qui appelle `POST /api/erp/v1/emails/sync` avec JWT valide.

**Q : Si je supprime un email dans la corbeille ERP, est-ce supprime sur Gmail aussi ?**
R : **NON**. Pas de sync bidirectionnelle (delete, mark read, move). Le DELETE supprime uniquement la copie locale.

**Q : Pourquoi mon mot de passe Gmail/Outlook/iCloud est refuse ?**
R : Avec 2FA active, generer un **App Password** : Gmail (myaccount.google.com/apppasswords), Outlook (Compte Microsoft -> Securite -> Mots de passe d application), iCloud (appleid.apple.com -> Mots de passe propres aux apps).

**Q : GoDaddy Workspace Email ne se connecte pas ?**
R : Verifier que **IMAP est active** dans le panel GoDaddy. Si echec port 587, essayer port 465 avec SSL direct.

**Q : Le bouton M365 donne HTTP 503 « connexion non disponible » ?**
R : Variables d environnement `M365_CLIENT_ID` / `M365_CLIENT_SECRET` non configurees sur le serveur. Contactez l administrateur.

**Q : Apres OAuth M365 reussi, sync echoue quand meme ?**
R : Verifier que le tenant Azure AD autorise **IMAP / SMTP OAuth2** : Microsoft a desactive Basic Auth par defaut depuis 2023. Admin doit executer `Set-CASMailbox -ImapEnabled $true -SmtpEnabled $true`.

**Q : Comment sauvegarder un brouillon ?**
R : **Pas implemente cote ERP**. Le dossier `drafts` se remplit uniquement si un brouillon existe deja sur le serveur IMAP.

**Q : Le composer a-t-il un editeur WYSIWYG (gras, italique, listes) ?**
R : **NON**. Textarea texte simple. Le HTML envoye est genere automatiquement (`<br>` pour les retours a la ligne).

**Q : Puis-je envoyer un email avec pieces jointes depuis l ERP ?**
R : **Non dans la version actuelle**. Pas de bouton « Joindre fichier ». Le moteur SMTP supporte les PJ en interne mais l API ne l expose pas.

**Q : Les emails envoyes apparaissent-ils dans le dossier Sent de Gmail ?**
R : Avec Gmail, oui (le serveur copie automatiquement vers `[Gmail]/Sent Mail`). Avec d autres serveurs (GoDaddy), non — l email reste uniquement en base ERP.

**Q : Puis-je voir les emails d un autre utilisateur du meme tenant ?**
R : **NON**. Filtre SQL `(user_id = %s OR user_id IS NULL)`. Seuls les comptes legacy `user_id IS NULL` sont visibles par tous.

**Q : Comment revendiquer un compte « partage » (`user_id IS NULL`) ?**
R : Une connexion OAuth M365 sur la meme adresse fait UPDATE automatique. Pour Basic Auth : UPDATE manuel ou recreer le compte.

**Q : Pieces jointes stockees ou ?**
R : `email_attachments.file_data` BYTEA en base PostgreSQL. Pas de S3. Peut faire grossir la base — purger via SQL manuel + VACUUM.

**Q : Comment importer tous mes anciens emails ?**
R : Mode `sync_mode = 'all'` -> recupere tous les emails du serveur. Peut prendre plusieurs minutes pour des boites volumineuses.

**Q : Le bouton Repondre preserve-t-il le threading In-Reply-To / References ?**
R : **NON**. Chaque reply est un nouveau message standalone — le threading Gmail/Outlook n est pas conserve cote serveur.

**Q : Le module supporte-t-il SMIME / PGP / DKIM ?**
R : **NON**. DKIM est gere cote serveur du fournisseur. SMIME / PGP ne sont pas implementes.

**Q : Si je change `EMAIL_SECRET_KEY`, qu arrive-t-il ?**
R : Tous passwords et tokens chiffres deviennent indechiffrables. Message « Token illisible (clef de chiffrement modifiee). Reconnecter le compte. »

**Q : Combien de temps le refresh token M365 reste valide ?**
R : ~90 jours d inactivite. Tant qu une sync est faite avant, le refresh est rotate et la session reste active.

**Q : Les emails du dossier Spam IMAP apparaissent-ils ?**
R : Oui, avec `folder = spam`. Mais le dossier `spam` **n est pas affiche dans la sidebar UI** par defaut.

**Q : Y a-t-il un rate limit sur la sync ?**
R : Pas de rate limit applicatif. Le bottleneck est cote IMAP (Gmail limite ~250 connexions par compte). Eviter les sync trop frequentes.

---

## 6. Recap one-pager

- **Module focus** : webmail integre (IMAP reception + SMTP envoi), pas messagerie interne, pas notifications.
- **22 endpoints** sous le prefix `/emails`.
- **Multi-comptes par user** : isolation via `user_id` (NULL = legacy/partage).
- **5 tables** : `email_accounts`, `emails`, `email_attachments`, `email_templates`, `email_sync_log`.
- **2 methodes d authentification** : Basic Auth (mot de passe chiffre Fernet) + OAuth2 Microsoft 365 (refresh token + auto-refresh access token avec marge 5 min).
- **6 providers preconfigures** : Gmail, Outlook, Yahoo, iCloud, GoDaddy, Microsoft365 (+ Autre pour config manuelle).
- **Auto-detect provider** : depuis le domaine de l adresse email (4 mappings — limite aux gros providers grand public).
- **3 modes de sync** : `new` (UNSEEN), `recent` (50 derniers), `all` (tous).
- **Pas de sync periodique automatique** : sync a la demande uniquement (UI ou API externe).
- **Pas de sync bidirectionnelle** : actions ERP (delete, mark read, move) ne se repercutent pas sur le serveur IMAP.
- **4 dossiers UI** : inbox / sent / drafts / trash. Backend supporte aussi archive / spam mais pas exposes en sidebar.
- **5 templates seedes** : devis_envoye, facture_envoyee, facture_rappel, projet_update, demande_prix (lecture seule, pas de CRUD UI).
- **Variables `{{...}}` dans les templates** : substitution simple a l envoi via `template_code` + `template_variables`.
- **Auto-link CRM** au sync : matching par adresse email -> remplit `contact_id` + `company_id`.
- **Liaisons ERP planifiees** mais non utilisees : `project_id`, `facture_id`, `devis_id`, `opportunity_id` (FK presents, jamais remplis).
- **Pieces jointes stockees BYTEA** dans `email_attachments.file_data` (pas de S3).
- **Sanitization HTML** : strip `<script>`, attributs `on*`, `javascript:` (regex, pas DOM parser).
- **Recherche** : ILIKE simple sur 4 colonnes (subject, email_from, email_to, body_text), avec echappement `%` et `_`.
- **OAuth2 M365** : 4 scopes (IMAP + SMTP + offline_access + User.Read), state HMAC-signe TTL 10 min, refresh auto avec rotation des tokens.
- **PAS de** : editeur WYSIWYG, brouillons cote ERP, notifications systeme, IA, calendrier .ics, threading In-Reply-To, integrations comptabilite/projets/devis, multi-tenant cross-user, OAuth Gmail.

---

**Documentation generee a partir du code** : `emails.py` (2722 lignes), `EmailsPage.tsx`, `emails.ts`, `useEmailsStore.ts`, `email_utils.py`, `email_client.py`.

**Manuels lies** :
- Module 3 (CRM — auto-link contacts/entreprises) — `03-crm.md`
- Module 7 (Factures — envoi factures, scan IA) — `07-factures.md`
- Module 25 (IA — Assistant IA chat) — `12-ia.md`
- Module 28 (Administration — variables d environnement, JWT_SECRET, EMAIL_SECRET_KEY) — `14-administration.md`
- Module 24 (Messagerie interne entre utilisateurs — distincte de ce module) — `26-messagerie.md` (a venir)
