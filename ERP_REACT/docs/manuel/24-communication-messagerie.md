# Module 24 — Messagerie (Chat interne Teams-like)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/messaging.py` (502 lignes, 11 endpoints, **router sans prefix** — `tags=["Messaging"]` monte sous `/api/erp/v1`), `frontend/src/pages/MessagingPage.tsx`, `frontend/src/api/messaging.ts`
> **Tables PostgreSQL (par tenant)** : `conference_channels`, `conference_messages`, `conference_reactions`, `conference_members` (declaree mais non utilisee par le router actuel), `conference_notifications` (declaree mais non utilisee), `notifications`
> **Cadrage** : ce module est un **chat interne Teams-like** — canaux thematiques, messages texte simples, reactions emoji, threading basique. Le code est derive des modules legacy `conference_manager/` (canaux) et `direct_messages.py` (DM), mais la **partie messages directs (DM)** est **non operationnelle** dans cette version (tables non provisionnees, endpoints retournent HTTP 503).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (chat 2 colonnes)](#2-interface-chat-2-colonnes)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Offrir un **chat interne** entre les utilisateurs du meme tenant, sur le modele Microsoft Teams / Slack :
- **Canaux thematiques** (`#general`, `#chantier-rive-sud`, etc.) avec messages publics
- **Messages texte** simples avec auto-scroll, recherche locale, polling 30 secondes
- **Reactions emoji** (toggle add/remove) avec compteurs et indicateur « ma reaction »
- **Threading basique** via le champ `parent_message_id` (lien parent->enfant en base, **pas d UI threading dedie** dans la page actuelle)
- **Notifications** systeme legeres (cloche d alerte sur la sidebar — table `notifications` du tenant)

### 1.2 Ce que le module ne fait PAS

> **Important** : c est un chat **basique** — pas un Teams complet. Il **n implemente pas** :
- **Messages directs (DM)** : endpoints `/direct-messages` presents : `POST /direct-messages` (envoi) et `PUT /direct-messages/{id}/read` retournent HTTP 503 (table `direct_messages` non provisionnee). `GET /direct-messages` retourne un stub `{items: [], unread_count: 0}` (pas 503, mais aucune donnee) (table non provisionnee)
- **Membres de canaux** : table `conference_members` non exploitee par le router -> `member_count` hardcode `0` (ligne 66)
- **Canaux prives** : champ `is_private` accepte au create mais non lu par le SELECT
- **Archivage / desactivation** : pas d endpoint pour basculer `is_active = FALSE`
- **Edition / suppression** de message ou de canal (colonnes `is_edited`, `is_deleted`, `edited_at` declarees mais aucun endpoint UPDATE/DELETE)
- **Mentions @utilisateur** : pas de parsing `@nom`, pas de notification automatique
- **Pieces jointes / fichiers partages** : colonne `has_attachments` existe mais aucun endpoint d upload
- **Statut en ligne** (presence, typing indicator) : aucun
- **Marquage lu/non lu** par canal (`last_read_at` non exploite, pas de read receipts)
- **Recherche backend / full-text** : recherche uniquement cote frontend, sur les 50 messages charges
- **Threads UI** : `parent_message_id` stocke mais affichage a plat (pas de pliage thread)
- **Notifications push / desktop** (Web Push, browser), **email**, **webhooks externes** (Slack, Teams), **audio/video/appels** : aucun

Pour des fonctions plus riches, considerer une integration externe ou une evolution future.

### 1.3 Acces

- Sidebar -> **Messagerie** (icone MessageSquare)
- URL : `/messagerie` (a verifier selon le routing React Router)
- Layout : 2 colonnes (sidebar canaux + zone messages plein ecran)
- Hauteur : `calc(100vh - 120px)` mobile, `calc(100vh - 180px)` desktop

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant peuvent :
  - Lister tous les canaux actifs (pas de filtre membre)
  - Creer un canal
  - Lire les messages de n importe quel canal
  - Poster un message
  - Reagir avec emoji
- **Pas de role mod / admin canal** : tous les utilisateurs ont les memes droits.
- **Notifications** : chaque utilisateur ne voit que ses propres notifications (`WHERE user_id = %s`).

---

## 2. Interface (chat 2 colonnes)

Source : `MessagingPage.tsx` — composant React unique, pas d onglets.

### 2.1 Sidebar canaux (gauche)

Largeur : 64 (16rem) sur desktop, plein ecran sur mobile (avec navigation back).

**En-tete** :
- Titre « Canaux »
- Bouton **+** (icone Plus) -> ouvre la modale de creation

**Liste des canaux** :
- Chaque entree affiche :
  - Icone `#` (Hash)
  - Nom du canal (tronque si long)
  - Compteur de membres (icone Users + chiffre) — **affiche seulement si > 0**, mais reste toujours `0` car backend hardcode (cf. section 1.2)
  - Compteur de messages (chiffre seul)
- Canal actif : surligne en couleur primaire (`seaop-primary`)
- Click -> charge le canal dans la zone messages
- Si liste vide : message « Aucun canal »

**Auto-selection** : au premier chargement, le **premier canal de la liste** (ordre alphabetique) est selectionne automatiquement.

### 2.2 Zone messages (droite)

#### 2.2.1 En-tete du canal actif

- Bouton retour (`<`) en mode mobile pour revenir a la liste des canaux
- Icone `#` + nom du canal
- Badge gris « N membre(s) » (= 0 dans la pratique)
- **Champ recherche** (a droite) : filtre **client-side** sur le texte des messages charges
  - Affiche « N resultat(s) pour "..." » au-dessus de la liste filtree
  - Bouton X pour effacer la recherche
- Description du canal (si renseignee) en sous-titre

#### 2.2.2 Liste des messages

- **Pagination** : 50 messages par page (defaut), tries `created_at DESC` puis inverses backend pour affichage chronologique ascendant.
- **Polling** : `usePolling(fetchMessages, 30000)` -> rafraichit toutes les **30 secondes** tant qu un canal est actif.
- **Format** : avatar circulaire (premiere lettre du nom), nom auteur (`COALESCE(employees.prenom+nom, users.full_name, users.username)`), date relative, tag « (modifie) » si `isEdited`, texte (`whitespace-pre-wrap`), ligne de reactions (cf. 2.2.3).

#### 2.2.3 Reactions emoji

Sous chaque message : **pillules** `emoji + count` (toggler par click). Pillule colore en primaire si `r.mine = true`, grise sinon. Le **quick-react picker** affiche inline les emojis **non encore utilises** (parmi `EMOJI_REACTIONS`), opacite 40% au repos / 100% au hover. Le `pendingReactionsRef` empeche les double-clicks en parallele sur le meme `(messageId, emoji)`.

**Palette `EMOJI_REACTIONS`** (`MessagingPage.tsx:21`) : `👍 ❤️ 😄 🎉 🤔 👀` — 6 emojis fixes, pas de picker libre. **Limite VARCHAR(10)** en base -> emoji > 10 caracteres rejete avec HTTP 400.

#### 2.2.4 Etats vides

- **Aucun message dans le canal** : icone MessageSquare + « Aucun message dans #nom » + « Soyez le premier a ecrire! »
- **Aucun canal selectionne** : icone Hash + « Selectionnez un canal »

#### 2.2.5 Auto-scroll et saisie

- **Auto-scroll** : changement de canal -> scroll instantane ; nouveau message -> scroll fluide ; scroll manuel sans nouveau message -> pas de re-scroll force.
- **Champ saisie** : single-ligne, placeholder « Message dans #nom... », **Enter** (sans Shift) envoie, bouton Send desactive si vide.
- **Bouton emoji** (Smile) a gauche : mini-picker avec les 6 emojis `EMOJI_REACTIONS`, ferme par click outside ou **Escape**, insere a la position du curseur.

### 2.3 Modale « Nouveau canal »

Declenchee par le bouton **+**. Champs : **Nom du canal** * (obligatoire, placeholder `general`) et **Description** (optionnelle). Boutons Annuler / Creer (desactive si nom vide).

> Le formulaire ne propose **pas** : selecteur de type (`channel_type` envoye en `'general'` par defaut), toggle `is_private`, ni selecteur de membres (table membres non utilisee).

### 2.4 Notifications (cloche)

La page `/messagerie` n affiche pas la cloche elle-meme, mais le module fournit les endpoints qui alimentent un **composant cloche global** (layout sidebar) :
- `GET /notifications/count` -> compteur `unread` (badge rouge sur la cloche)
- `GET /notifications` -> liste les N dernieres (defaut 20, max 50) avec champ `link` cliquable
- `PUT /notifications/{id}/read` -> marque comme lue

---

## 3. Workflows pas-a-pas

### 3.1 Creer un nouveau canal

1. Sidebar -> bouton **+** (en haut a droite de la liste des canaux).
2. Modale s ouvre.
3. Saisir le **Nom** (ex. `chantier-rive-sud`).
4. Optionnellement : saisir une **Description** (ex. « Suivi quotidien projet Rive-Sud »).
5. Cliquer **Creer**.
6. `POST /channels` avec `{name, description, channel_type: 'general' (defaut), is_private: false (defaut)}`.
7. Backend : INSERT dans `conference_channels` avec `created_by = user_id`, `is_active = TRUE`, `created_at = CURRENT_TIMESTAMP`.
8. Le canal apparait dans la sidebar (la liste est rechargee via `fetchChannels()`).

> **Note** : aucun mecanisme « inviter des membres » apres creation. Tous les utilisateurs du tenant voient le canal automatiquement.

### 3.2 Envoyer un message

1. Cliquer sur un canal dans la sidebar -> chargement des messages.
2. Saisir le texte dans le champ « Message dans #nom... ».
3. **Enter** (ou clic sur le bouton Send).
4. `POST /channels/{channel_id}/messages` avec `{messageText, parentMessageId (null pour message racine)}`.
5. Backend INSERT dans `conference_messages` -> retourne `id`.
6. Le frontend appelle `fetchMessages()` -> reaffichage de la liste.

> **Polling 30s** : si un autre utilisateur poste pendant que vous lisez, son message apparaitra dans 30 secondes max sans action de votre part.

### 3.3 Inserer un emoji dans le message

1. Cliquer sur l icone Smile a gauche du champ texte -> mini-picker apparait.
2. Cliquer sur un emoji dans le picker (👍 ❤️ 😄 🎉 🤔 👀).
3. L emoji est insere a la position du curseur dans l input.
4. Le picker se ferme automatiquement.
5. Continuer a taper, puis **Enter** pour envoyer.

> **Pas de selecteur emoji complet** (Apple/Twitter/Native) — seulement les 6 emojis rapides.

### 3.4 Reagir a un message avec un emoji

1. Survoler un message -> les emojis disponibles (parmi `EMOJI_REACTIONS` non encore utilises) passent en opacite 100%.
2. Cliquer un emoji -> `POST /channels/{channel_id}/messages/{message_id}/reactions` avec `{emoji}`.
3. Backend (toggle) :
   - Verifie que le message existe et appartient au canal -> sinon HTTP 404.
   - Tente DELETE de la reaction `(message_id, user_id, emoji)` -> si elle existait, retourne `action: "removed"`.
   - Sinon INSERT (avec `ON CONFLICT DO NOTHING`) -> retourne `action: "added"`.
4. Frontend appelle `fetchMessages()` -> re-render avec compteur a jour.

**Pour retirer une reaction** : cliquer sur une pillule qui contient deja moi (`r.mine = true`, surlignee en primaire). Le compteur baisse de 1, et si c etait la derniere instance de cet emoji, la pillule disparait.

> **Limite emoji** : 10 caracteres max (VARCHAR(10) en base) — couvre la majorite des emojis Unicode mais pas les sequences ZWJ longues.

### 3.5 Rechercher dans un canal

1. Selectionner un canal.
2. Champ **Rechercher...** en haut a droite.
3. Saisir un mot-cle.
4. Filtrage **instantane cote frontend** : la liste affichee est filtree (`messageText.toLowerCase().includes(search.toLowerCase())`).
5. Compteur « N resultat(s) pour "..." » s affiche au-dessus.
6. Bouton **X** pour effacer la recherche et revoir tous les messages.

> **Limitation** : la recherche ne porte **que sur les 50 messages charges** (page courante). Les anciens messages ne sont pas inclus tant que la pagination n a pas charge plus de pages. Le module **n a pas** de pagination « charger plus » dans la version actuelle.

### 3.6 Naviguer entre canaux

1. Dans la sidebar, cliquer sur un autre canal.
2. Les messages du nouveau canal sont charges via `GET /channels/{id}/messages`.
3. Le champ de recherche est **reinitialise** (`setMessageSearch('')`).
4. Auto-scroll instantane vers le bas.
5. Le polling redemarre sur le nouveau canal.

### 3.7 Mode mobile (responsive)

- **Vue par defaut** : sidebar canaux plein ecran.
- Click sur un canal -> bascule vers la zone messages plein ecran.
- Bouton **<** (ChevronLeft) en haut a gauche de l en-tete -> retour a la liste des canaux.
- Le breakpoint est **md** (768px Tailwind).

### 3.8 Marquer une notification comme lue

1. (Cote layout global) Click sur la cloche -> dropdown avec liste des notifications via `GET /notifications`.
2. Click sur une notification -> generalement :
   - Navigue vers `link` (URL interne, ex. `/projets/123`).
   - Appelle `PUT /notifications/{id}/read`.
3. Backend : `UPDATE notifications SET is_read = TRUE WHERE id = %s AND user_id = %s`.
4. Le compteur cloche se decremente.

### 3.9 Workflows non operationnels (limites importantes)

- **Messages directs (DM)** : `POST /direct-messages` retourne **HTTP 503** « Service de messages directs temporairement indisponible. » (table `direct_messages` non provisionnee). `GET /direct-messages` retourne un stub `{items: [], unread_count: 0}`. **Contournement** : creer un canal a deux participants (ex. `dm-marie-jean`).
- **Mentions @utilisateur** : pas de parsing `@nom`, pas de notification automatique. Si vous tapez `@Marie`, le texte est envoye tel quel.
- **Partager un fichier** : aucun bouton « Joindre fichier » ni endpoint upload. **Contournement** : Module 8 Dossiers (uploader, copier l URL, coller comme texte) ou Module 25 IA (`/ai/analyze-document` pour analyse).

---

## 4. Reference

### 4.1 Endpoints Messagerie (`tags=["Messaging"]`, prefix global `/api/erp/v1`)

| Methode | URL                                                       | Role                                              |
|---------|-----------------------------------------------------------|---------------------------------------------------|
| GET     | `/channels`                                               | Liste les canaux actifs (`is_active = TRUE`)      |
| POST    | `/channels`                                               | Creer un canal                                    |
| GET     | `/channels/{channel_id}/messages`                         | Liste les messages (page=1, perPage=50 max 100)   |
| POST    | `/channels/{channel_id}/messages`                         | Poster un message (avec `parent_message_id` opt.) |
| POST    | `/channels/{channel_id}/messages/{message_id}/reactions`  | Toggle reaction emoji (add/remove)                |
| GET     | `/direct-messages`                                        | **Stub** : retourne `{items: [], unread_count: 0}` |
| POST    | `/direct-messages`                                        | **HTTP 503** (non operationnel)                   |
| PUT     | `/direct-messages/{message_id}/read`                      | **HTTP 503** (non operationnel)                   |
| GET     | `/notifications`                                          | Liste notifications (par defaut 20, max 50)       |
| PUT     | `/notifications/{notification_id}/read`                   | Marquer notification comme lue                    |
| GET     | `/notifications/count`                                    | Compteur des notifications non lues               |

### 4.2 Modeles Pydantic (entree)

| Modele                  | Champs                                                               |
|-------------------------|----------------------------------------------------------------------|
| `ChannelCreate`         | `name: str`, `description?: str`, `channel_type: str = "general"`, `is_private: bool = False` |
| `MessageCreate`         | `message_text: str`, `parent_message_id?: int`                       |
| `ReactionCreate`        | `emoji: str` (1-10 caracteres)                                       |
| `DirectMessageCreate`   | `recipient_user_id?`, `recipient_entreprise_id?`, `subject?`, `message: str`, `parent_id?` (HTTP 503 cote backend) |

### 4.3 Tables PostgreSQL (par tenant)

| Table                     | Role                                                       | Statut module                            |
|---------------------------|------------------------------------------------------------|------------------------------------------|
| `conference_channels`     | Canaux : id, name, description, channel_type, icon, is_private, is_active, created_by, created_at | **Utilisee** (CRUD partiel — pas de UPDATE/DELETE) |
| `conference_messages`     | Messages : id, channel_id, user_id, message_text, parent_message_id, has_attachments, is_edited, is_deleted, created_at, edited_at | **Utilisee** (INSERT + SELECT seulement) |
| `conference_reactions`    | Reactions : id, message_id, user_id, emoji, created_at + UNIQUE(message_id, user_id, emoji) | **Utilisee** (toggle add/remove)          |
| `conference_members`      | Membres : id, channel_id, user_id, role, last_read_at      | **Declaree mais non utilisee** par le router |
| `conference_notifications`| Mentions/notifications par canal                            | **Declaree mais non utilisee** par le router |
| `notifications`           | Notifications generiques tenant (toutes sources)           | **Utilisee** (GET, PUT read, count)       |

### 4.4 Champs response

**Canal** : `id, name, description, channel_type, is_active, created_at, member_count (hardcode 0), message_count`.

**Message** : `id, channel_id, user_id, message_text, parent_message_id, is_edited, is_deleted, created_at, edited_at, username, user_name, reactions[]`.

Chaque entree `reactions[]` : `{emoji, count, mine}` (mine = true si l utilisateur courant a deja reagi avec cet emoji).

**Resolution du nom auteur** (SQL ligne 151) : `COALESCE(e.prenom || ' ' || e.nom, u.full_name, u.username)` -> employes (JOIN sur `m.user_id = e.id`), puis `users.full_name`, puis `users.username`.

### 4.5 Pagination messages

- Defaut : `page=1, per_page=50`.
- Max : `per_page=100`.
- Tri : `ORDER BY created_at DESC LIMIT %s OFFSET %s` -> les **N plus recents** -> puis `messages.reverse()` cote backend pour ordre chronologique.

> **Limitation UI** : la page React **ne fournit pas** de bouton « Charger plus anciens messages ». Seuls les 50 derniers sont visibles.

### 4.6 Validations & limites

| Regle                                        | Effet                                       |
|----------------------------------------------|---------------------------------------------|
| `user.schema` absent (pas de tenant)         | HTTP 400 « Contexte tenant manquant »       |
| `emoji` vide ou > 10 caracteres              | HTTP 400 « Emoji invalide »                 |
| Reaction sur message inexistant ou supprime  | HTTP 404 « Message introuvable »            |
| `per_page` > 100 (messages) / `limit` > 50 (notif) | HTTP 422 (Pydantic Query validator)   |
| POST `/direct-messages` ou PUT read DM       | HTTP 503 (table non provisionnee)           |
| `notifications` table absente du schema      | Retourne `{items: [], unread_count: 0}` (silent) |

### 4.7 Polling et performance

`usePolling(fetchMessages, 30000)` toutes les 30 secondes tant qu un canal est actif. **Pas de WebSocket / SSE** dans cette version. Charge typique : 50 utilisateurs actifs -> ~100 req/min sur `/channels/{id}/messages`.

### 4.8 Constantes UI

| Constante           | Valeur                          | Source                                |
|---------------------|---------------------------------|---------------------------------------|
| `EMOJI_REACTIONS`   | `['👍', '❤️', '😄', '🎉', '🤔', '👀']` | `MessagingPage.tsx:21`              |
| Polling interval    | `30000 ms` (30 sec)            | `MessagingPage.tsx:79`                |
| Per page (messages) | 50 par defaut, max 100         | `messaging.py:135`                    |
| Per page (DM)       | 20 par defaut, max 50          | `messaging.py:332` (stub)             |
| Limit notifications | 20 par defaut, max 50          | `messaging.py:373`                    |

### 4.9 Comportements specifiques

- **Auto-selection** : au premier chargement, selectionne `res.items[0]` (premier canal alphabetique grace a `ORDER BY c.name ASC`).
- **Lock anti double-click reactions** : `pendingReactionsRef = new Set<string>()` stocke les cles `${messageId}:${emoji}` en cours.
- **Race condition INSERT reaction** : si message supprime entre SELECT et INSERT -> FK violation -> rollback + HTTP 404.
- **Reset tenant systematique** : chaque endpoint suit le pattern `db.set_tenant -> operation -> db.reset_tenant` (garantit l isolation multi-tenant).

---

## 5. Integrations & FAQ

### 5.1 Integration Notifications (Module 14)

La table `notifications` du tenant est **partagee** avec d autres modules (factures, projets, BT, etc.). Le router `messaging.py` se contente de **lire / marquer lue / compter** — la **creation** se fait dans d autres modules.

> **Pas de notifications messagerie internes** : aucune INSERT depuis `messaging.py`. Poster un message ou recevoir une reaction n insere **rien** dans `notifications`. La cloche ne sonne pas pour les nouveaux messages chat.

### 5.2 Integration Module 9 Employes

Le nom affiche d un message utilise `JOIN employees e ON m.user_id = e.id` puis `e.prenom || ' ' || e.nom`. Ce JOIN suppose que `users.id == employees.id` ou qu un autre lien implicite existe. Sinon, fallback sur `full_name` ou `username`.

### 5.3 Integration Module 23 Emails et B2B portal

- **Aucune integration** entre la messagerie interne et le module Emails (Module 25). Pas de notification email sur nouveau message chat.
- **Hors scope B2B** : la messagerie interne est exclusivement pour les utilisateurs **du tenant** (employes). Les communications clients passent par CRM interactions, emails, B2B portal.

### 5.4 Integration Module 25 IA

- **Lecture** : l IA peut interroger `conference_messages` via le tool `recherche_bd` (ex. « Combien de messages ai-je poste ce mois ? »).
- **Ecriture** : l IA peut creer un message via `executer_action` (INSERT dans `conference_messages`). **Aucun garde-fou** : Claude poste directement.
- Pas d integration native « resumer un canal » dans la page Messagerie.

### 5.5 FAQ

**Q : Puis-je supprimer ou modifier un canal / un message ?**
R : **Non via l UI ni via le router**. Aucun endpoint UPDATE/DELETE n est expose pour les canaux ou les messages. Les colonnes `is_active`, `is_edited`, `is_deleted`, `edited_at` existent en base mais ne sont jamais modifiees par l app. Workaround : SQL direct (admin DB) ou IA `executer_action` (avec audit).

**Q : Qui voit le canal que je cree ?**
R : **Tous les utilisateurs du tenant**. Le champ `is_private` est accepte au create mais non lu par le SELECT. Aucune notion de membres exclusifs dans cette version.

**Q : Combien de messages sont charges au demarrage et puis-je voir les anciens ?**
R : Les **50 plus recents** du canal. Pas de pagination « voir plus anciens » dans l UI actuelle. La recherche se fait uniquement sur ces 50 messages charges.

**Q : Les reactions multiples sur le meme message sont-elles supportees ?**
R : OUI — un meme utilisateur peut ajouter plusieurs emojis differents. Mais pas **plusieurs fois le meme emoji** (UNIQUE constraint `(message_id, user_id, emoji)`). Le `pendingReactionsRef` cote frontend bloque les double-click rapprochees, et `ON CONFLICT DO NOTHING` cote backend empeche les doublons en cas de race.

**Q : Pourquoi je vois « 0 membres » sur tous les canaux ?**
R : C est par design dans cette version : `member_count` est hardcode a `0` cote backend (ligne 66). La table `conference_members` n est pas exploitee par le router.

**Q : Le statut « en ligne / occupe / absent » est-il visible ?**
R : **NON.** Aucun mecanisme de presence dans cette version. Pas d indicateur en ligne, pas de « X est en train d ecrire... », pas de read receipts (« lu par »).

**Q : Puis-je epingler un message ou gerer des threads UI ?**
R : **NON.** Pas de pin/star. Le champ `parent_message_id` est stocke en base mais l UI affiche tous les messages a plat (chronologique, pas de pliage thread).

**Q : Les emojis sont-ils limites ?**
R : Limite **VARCHAR(10)** sur le champ `emoji` -> couvre la majorite des emojis Unicode simples. Les sequences ZWJ longues (ex. famille emoji 4 personnages) peuvent etre tronquees -> HTTP 400.

**Q : Le polling 30s consomme-t-il beaucoup ?**
R : Une requete legere `GET /channels/{id}/messages?per_page=50` ~10-20 KB. 50 utilisateurs actifs = ~100 req/min. Acceptable. Pour un volume eleve, considerer WebSocket/SSE en evolution future.

**Q : Puis-je exporter l historique d un canal ?**
R : Pas de bouton export. Workaround : copier-coller manuel, ou requete SQL directe (`SELECT * FROM conference_messages WHERE channel_id = X`) en admin.

**Q : Les messages sont-ils chiffres ?**
R : Au repos : selon la configuration PostgreSQL Render (chiffrement disque). En transit : HTTPS sur l API. **Pas de chiffrement bout-en-bout** type Signal — les messages sont lisibles en clair par tout admin DB.

**Q : Combien de temps les messages sont-ils conserves ?**
R : **Indefiniment** (pas de purge automatique). Une purge necessiterait un cron job SQL manuel.

**Q : Le module fonctionne-t-il sur mobile ?**
R : OUI — la page est **responsive** : sidebar plein ecran sur mobile, bascule vers la zone messages au click, bouton retour. Pas d app native iOS/Android dediee.

**Q : Les notifications navigateur (browser push) sont-elles supportees ?**
R : **NON.** Pas de Service Worker, pas de Web Push, pas de notification email sur nouveau message. La seule notification visuelle est le badge cloche dans l app (alimente par d autres modules).

**Q : Puis-je integrer un bot dans un canal ?**
R : Pas d API bot dediee. Workaround : creer un user « bot » et utiliser `POST /channels/{id}/messages` avec son token JWT. L IA Claude peut deja poster via `executer_action` (cf. Module 12).

---

## 6. Recap one-pager

- **Module focus** : chat interne **Teams-like** simple — canaux thematiques + messages texte + reactions emoji + threading basique en base.
- **11 endpoints** : 5 canaux/messages + 3 DM (non op.) + 3 notifications. Router sans prefix (`tags=["Messaging"]`, monte sous `/api/erp/v1`).
- **Frontend** : page unique `MessagingPage.tsx`, 2 colonnes (sidebar + messages), responsive mobile.
- **Polling 30s** pour rafraichir les messages (pas de WebSocket / SSE).
- **6 emojis fixes** : 👍 ❤️ 😄 🎉 🤔 👀. Toggle reaction (add/remove sur le meme endpoint), UNIQUE `(message_id, user_id, emoji)`, VARCHAR(10).
- **Auto-selection** : premier canal alphabetique au chargement initial.
- **Pagination** : 50 msg/page, max 100. **Pas de UI « charger plus anciens »**. Recherche **client-side** sur les 50 msg charges.
- **Tables actives** : `conference_channels`, `conference_messages`, `conference_reactions`, `notifications`.
- **Tables inactives (schema only)** : `conference_members`, `conference_notifications`, `direct_messages`.
- **member_count = 0** hardcode (`conference_members` non exploitee). **DM** non operationnels (HTTP 503).
- **PAS implemente** : edition/suppression message, archivage canal, mentions @, fichiers joints, presence en ligne, threads UI, marquage lu/non lu, recherche backend, push notifications, email, audio/video, exports, webhooks Slack/Teams.
- **Notifications cloche** : alimentees par d autres modules — la messagerie elle-meme n insere rien dans `notifications`.
- **Permissions** : tous les utilisateurs du tenant ont les memes droits (pas de roles canal).

---

**Documentation generee a partir du code** : `messaging.py` (502 lignes), `MessagingPage.tsx` (428 lignes), `messaging.ts` (138 lignes).

**Manuels lies** :
- Module 9 (Employes — resolution noms auteurs) — `09-employes.md`
- Module 25 (IA — `executer_action` peut poster un message) — `12-ia.md`
- Module 28 (Administration — table `notifications` partagee) — `14-administration.md`
- Module 23 (Emails — distinct de la messagerie interne) — `25-emails.md` (a verifier en prod)
