# Module 25 — IA / Assistant Intelligent

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/ai.py` (router central IA), `backend/routers/public_chat.py` (Sylvain chat pre-login), `backend/routers/stripe_routes.py` (recharge credits), `frontend/src/pages/AssistantIAPage.tsx`, autres modules avec IA integree (Module 7 scan facture, Module 8 notes IA, Module 19 immobilier 4 endpoints)
> **Tables PostgreSQL (schema public)** : `ai_prepaid_credits`, `ai_usage_tracking`, `ai_conversations`

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface Assistant IA](#2-interface-assistant-ia)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference (modeles, couts, tools)](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Fournir un **assistant IA conversationnel** alimente par Claude (Anthropic) integre dans tout l ERP :
- Chat avec **profil hardcode `general`** (les 6 profils existent backend mais ne sont pas selectionnables depuis l UI dans cette version — voir section 2.1.1)
- **Function calling** : l IA peut interroger la base (`recherche_bd`) et executer des actions (`executer_action`) sur le tenant connecte
- **Vision** : analyse d images / PDF (factures, plans, documents)
- **Conversations persistees** par utilisateur (historique chargeable)
- **Reponse JSON complete** (pas de streaming SSE cote client). Le backend utilise `with stream()` en interne pour consommer la reponse Anthropic, mais retourne le resultat final en une fois via `ChatResponse` Pydantic. L UI affiche la reponse complete d un coup (pas de rendering progressif). Pour un futur upgrade, il faudrait un endpoint `text/event-stream` et un `EventSource` cote client.
- **Credits prepayes** en USD (charges auto via Stripe), tracking complet par feature
- IA integree dans 6+ autres modules (factures scan, notes dossiers, analyse projet immobilier, chat pre-login marketing)

### 1.2 Modeles Claude utilises

Source : `ai.py:36`, `accounting.py`, `immobilier.py`

| Module                              | Modele                          | Contexte                     |
|-------------------------------------|---------------------------------|------------------------------|
| **Chat principal AssistantIAPage**  | `claude-sonnet-4-6` (defaut)   | Chat general + tools         |
| **Scan facture** (Module 7)         | `claude-sonnet-4-6` (vision)   | OCR + extraction structuree  |
| **Notes IA Dossiers** (Module 8)    | `claude-sonnet-4-6`             | Enrichissement / photo / resume |
| **Immobilier — Analyser projet**    | `claude-opus-4-20250514`        | Analyse complexe (cout sup.) |
| **Immobilier — Chat / Rapport / Optimiser** | `claude-sonnet-4-20250514` | Generation textes longs      |
| **Public chat Sylvain** (pre-login) | `claude-sonnet-4-6`, max 2000 tokens, temp 0.7 | Marketing pre-vente |

`AI_MAX_TOKENS = 31500` (defaut) sur le chat principal.

### 1.3 6 profils d expert (chat principal)

Source : `GET /ai/profiles`

| Profil                | Specialite                                                              |
|-----------------------|-------------------------------------------------------------------------|
| `general`             | Assistant generaliste (defaut)                                          |
| `expert_construction` | Code National du Batiment (CNB), Code de Construction du Quebec (CCE), normes ASTM/CSA, RBQ |
| `estimateur`          | Estimation des couts, soumissions, comparatifs fournisseurs            |
| `comptable`           | TPS/TVQ, plan comptable Quebec, paie DAS, retenues, periodes comptables |
| `juridique`           | Code civil Quebec, contrats, retenues garantie, vices caches            |
| `securite`            | CNESST, EPI, prevention chantier, formation                             |

Le profil influe sur le **system prompt** envoye a Claude pour orienter l expertise.

### 1.4 Credits IA prepayes

Source : `stripe_routes.py`, table `ai_prepaid_credits`

Le tenant prepaye un solde en **USD** (charge en CAD via Stripe). Chaque appel IA est facture selon les tokens consommes :

**Formule cout Sonnet** :
```
cost_usd = (input_tokens * 0.003 + output_tokens * 0.015) / 1000 * 1.30
```
(input $0.003 / 1K tokens, output $0.015 / 1K tokens, **markup 30%** pour conversion CAD/USD)

**Formule cout Opus** (analyser-projet immobilier) :
```
cost_usd = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30
```

**Auto-recharge** : si solde < `MIN_BALANCE_THRESHOLD = 0.10 USD`, Stripe charge automatiquement `PREPAID_RECHARGE_AMOUNT = 10.00 USD` (CAD equivalent) sur la carte du tenant.

**Entreprises exemptees** : `AI_GUARD_EXEMPT_IDS = {1, 105, 172}` (`ai.py:36`) — ce sont des **`entreprise_id`** (table `entreprises`), pas des `tenant_id`. Utilisation illimitee sans deduction (comptes admin / demo / interne).

### 1.5 Acces

- Sidebar -> **Assistant IA** (icone Sparkles) -> URL `/assistant-ia`
- Public chat marketing (sans auth) : `/sylvain-chat` ou widget integre sur la landing page

### 1.6 Permissions

- Chat principal : tous les utilisateurs authentifies du tenant (sous reserve credits disponibles).
- Tools `executer_action` : tout utilisateur peut declencher des INSERT/UPDATE/DELETE via l IA (audit log integral).
- Public chat Sylvain : libre acces avec rate limits (cf. section 4).

---

## 2. Interface Assistant IA

### 2.1 Page `/assistant-ia` (chat principal)

**Layout** : interface chat plein ecran avec panneau lateral.

#### 2.1.1 Panneau lateral (gauche)

- **Profil hardcode a `'general'`** dans le frontend (`AssistantIAPage.tsx:34` -> `const selectedProfile = 'general';`). Les 6 profils existent cote backend (`ai.py` -> `AI_PROFILES`) mais ne sont **pas selectionnables depuis l UI** dans cette version. Pour activer un profil different, il faudrait modifier le code source ou implementer un dropdown.
- **Conversations sauvegardees** (liste — click pour charger)
- **Bouton Nouvelle conversation**
- **Carte Credits** :
  - Solde balance USD (ex. `$3.42 USD`)
  - Indicateur auto-recharge active
  - Bouton **Recharger** : lien externe (`<a href="https://billing.stripe.com/p/login/constructoai" target="_blank">`) vers le Customer Portal Stripe (pas de modale interne).
- **Stats du mois** : tokens consommes + cout (USD)

#### 2.1.2 Zone chat principale

- **Historique messages** : alternance utilisateur / assistant
- Pour chaque message assistant : badge `tokens` + `cost USD` + `temps ms` + `profil utilise`
- **Reponse JSON complete** : la reponse Claude apparait d un coup une fois generee (pas de streaming SSE cote client, pas de rendering progressif). L UI fait `setMessages([..., {response}])` apres reception.
- **Markdown supporte** : tableaux, listes, code blocks, gras/italique
- **Champ input** : multi-lignes, `Ctrl+Enter` pour envoyer

#### 2.1.3 Boutons d action

- **+ Joindre document** (icone Paperclip) -> upload image/PDF -> `POST /ai/analyze-document`
- **+ Joindre plan** (icone Map) -> upload plan/blueprint -> `POST /ai/analyze-plan`
- **Effacer historique** (icone Trash2) -> reinitialise le chat (la conversation reste sauvegardee)
- **Telecharger conversation** (export markdown) — a verifier en prod

### 2.2 Vue conversations (sidebar)

- Liste paginee des conversations sauvegardees (`GET /ai/conversations`)
- Pour chaque : titre auto (premieres lignes du message utilisateur), date, profil, badge tokens cumules
- Click -> charge l historique complet dans la zone chat
- Icone poubelle -> `DELETE /ai/conversations/{conv_id}`

### 2.3 Carte Credits & Stats

#### 2.3.1 Solde

- Affichage : balance USD courant + monthly_limit_usd (souvent `999999.99` = illimite)
- Indicateur auto-recharge ON/OFF + montant + carte Stripe lieee
- Badge `EXEMPT` si tenant dans la liste exemptee (sans facturation)

#### 2.3.2 Stats consommation

3 endpoints :
- **`GET /ai/usage`** : agregation par feature (defaut 30 jours)
- **`GET /ai/usage/daily`** : breakdown journalier (30 derniers jours) — graphique barres
- **`GET /ai/usage/monthly`** : breakdown mensuel (par feature)

Stats affichees :
- Total tokens consommes / Cout total USD
- Top 5 features par cout (chat, invoice_scan, immobilier_analyser_projet, dossiers_notes_ai_enrich, etc.)
- Graphique evolution journaliere

### 2.4 Public chat Sylvain (pre-login)

URL : `/sylvain-chat` (page publique sans authentification).

Widget chat avec :
- Avatar Sylvain (vendeur virtuel)
- **Reponses JSON completes** (pas de streaming SSE — `public_chat.py:328` retourne `ChatResponse` Pydantic complete)
- Limites strictes (cf. section 4) :
  - **20 echanges par session** (session_id genere cote client)
  - **50 echanges par IP / 24h** (anti-cycling session_id)
  - **10 req/min** (middleware global)

Modele : `claude-sonnet-4-6`, max 2000 tokens, temperature 0.7.
System prompt : 12.5k tokens (cache prompt 5 min Anthropic).

A 20/session : message « Limite session atteinte ». A 50/IP/24h : message bloquant.

> **Tracking** dans `ai_usage_tracking` avec `feature='sylvain_chat_login'` mais **PAS de deduction** des credits du tenant (gratuit pre-login).

---

## 3. Workflows pas-a-pas

### 3.1 Demarrer une nouvelle conversation

1. Page Assistant IA -> bouton **+ Nouvelle conversation**.
2. Le profil `general` est utilise par defaut (hardcode dans le frontend, voir section 2.1.1 — pas de dropdown UI pour changer).
3. Saisir une question dans le champ -> Enter ou Ctrl+Enter.
4. `POST /ai/chat` avec `{message, profile: 'general', conversation_id (null si nouvelle)}`.
5. Backend :
   - Verifie credits (`_check_credits`) — si solde <= 0 ET tenant non exempt -> tente auto-recharge Stripe ou retourne HTTP 402.
   - Construit le system prompt selon `profile`.
   - Injecte la **DATE DU JOUR** (`ai.py:45-50`) pour eviter les erreurs temporelles.
   - Appelle Claude Sonnet 4.6 via `with _anthropic_client.messages.stream(...)` puis recupere la reponse finale via `stream.get_final_message()` (`ai.py:295-303`). Le streaming est **interne au serveur uniquement** — la reponse n est pas propagee au client en SSE.
   - A la fin : insert dans `ai_conversations` + `ai_usage_tracking`, deduit cost_usd du `ai_prepaid_credits`.
6. La reponse complete est retournee en JSON via `ChatResponse` Pydantic et apparait d un coup dans le chat (pas de rendering mot par mot).

### 3.2 Continuer une conversation

1. Cliquer sur une conversation dans la sidebar.
2. `GET /ai/conversations/{conv_id}` -> charge l historique complet.
3. Continuer a saisir des messages.
4. Backend envoie les **6 derniers messages** comme contexte a Claude (limite pour controle tokens).

### 3.3 Utiliser un outil (function calling)

L IA peut decider d appeler 2 tools selon la question :

#### 3.3.1 `recherche_bd` (lecture)

Cas d usage : « Combien de projets en cours ? », « Liste les factures impayees > 1000$ ».

1. Claude detecte le besoin -> emet un `tool_use` avec une requete SQL SELECT.
2. Backend valide :
   - Bloque les keywords destructeurs (`DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE, LOCK, VACUUM, COPY`).
   - Strip les commentaires SQL.
   - Bloque les `;` (multi-statements).
   - Limite a 50 lignes max retournees.
3. Execute sur le tenant connecte (`db.set_tenant`).
4. Renvoie les resultats a Claude (`tool_result`).
5. Claude formule une reponse en langage naturel.
6. Audit log : tous les SELECT IA sont logges (`ai_query_audit` ou similaire).

#### 3.3.2 `executer_action` (ecriture)

Cas d usage : « Cree une facture de 500$ pour Acme Inc. », « Marque le BT-00012 comme termine ».

1. Claude emet un `tool_use` avec INSERT/UPDATE/DELETE.
2. Backend valide (memes filtres) + **timeout 10 secondes** par requete.
3. **Description obligatoire** : Claude doit fournir une description de l action (audit trail).
4. Execute sur le tenant.
5. Renvoie le resultat a Claude.

> **Aucun garde-fou « confirmer avant action »** : si Claude decide de supprimer, ca supprime. Le user doit etre conscient que l IA a un acces ecriture complet sur le tenant.

### 3.4 Analyser un document (image / PDF)

1. Bouton **Joindre document** -> uploader un fichier (max 20 MB).
2. Optionnellement saisir un prompt specifique (« Extrais les montants », « Resume le contrat »).
3. `POST /ai/analyze-document` (multipart).
4. Backend :
   - Encode en base64.
   - Appelle Claude Sonnet 4.6 vision avec system prompt « Analyste de documents construction Quebec ».
   - Reponse en markdown structure.
5. Affiche dans le chat avec badge `type: document`.

### 3.5 Analyser un plan de construction

1. Bouton **Joindre plan**.
2. Upload blueprint / plan PDF / image.
3. `POST /ai/analyze-plan`.
4. Backend appelle Claude vision avec prompt specifique « Expert plans construction » :
   - Identifie les elements (murs, fenetres, portes, structure)
   - Estime les surfaces / volumes
   - Note les conformites apparentes
   - Suggere les corps de metier necessaires
5. Reponse markdown structuree.

### 3.6 Voir les statistiques de consommation

1. Page Assistant IA -> panneau lateral -> section **Stats**.
2. 3 vues :
   - **Daily** (`GET /ai/usage/daily`) : barres journalieres 30 derniers jours
   - **Monthly** (`GET /ai/usage/monthly`) : breakdown par feature (chat, invoice_scan, immobilier_*, etc.)
   - **Top features** : top 5 features les plus couteuses sur le mois

### 3.7 Verifier le solde de credits

1. Sidebar -> carte **Credits**.
2. `GET /ai/credits` retourne :
   - `balance_usd` : solde courant
   - `monthly_limit_usd` : plafond mensuel
   - `auto_recharge` : ON/OFF
   - `is_exempt` : true si tenant dans liste exemptee

### 3.8 Recharger les credits manuellement (Customer Portal Stripe)

1. Sidebar -> bouton **Recharger** : c est un lien externe `<a href="https://billing.stripe.com/p/login/constructoai" target="_blank">` (`AssistantIAPage.tsx:399, 636`) qui ouvre le **Customer Portal Stripe** dans un nouvel onglet.
2. L utilisateur gere ses credits, methodes de paiement et historique de facturation depuis le portail Stripe (interface hebergee par Stripe, hors ERP).
3. **Pas de modale interne, pas de POST direct depuis l Assistant IA** (pas d input pour le montant cote ERP).
4. L endpoint `POST /stripe/credits/recharge` (`stripe_routes.py:298`) **existe** dans le backend (validation bornes 5-500 USD, charge one-time invoice via PaymentMethod stocke) mais n est **pas appele depuis cette UI** — il est reserve a d autres flux (admin / API directe / futur upgrade).

### 3.9 Activer / desactiver l auto-recharge

1. Sidebar -> carte Credits -> toggle **Auto-recharge**.
2. `PUT /stripe/credits/auto-recharge` avec `{enabled, amount}` (cf. en prod).
3. Si activee : a chaque appel chat avec solde < 0.10 USD, Stripe charge automatiquement le `recharge_amount_usd` (defaut $10 CAD).

### 3.10 Supprimer une conversation

1. Sidebar -> conversation -> icone poubelle.
2. Confirmation -> `DELETE /ai/conversations/{conv_id}`.
3. Hard delete : la conversation et tous ses messages disparaissent.
4. Le tracking ai_usage_tracking n est PAS supprime (audit immutable).

---

## 4. Reference

### 4.1 Endpoints router AI (`/ai`)

| Methode | URL                            | Role                                              |
|---------|--------------------------------|---------------------------------------------------|
| POST    | `/ai/chat`                     | Chat principal (avec profile, tools, streaming)   |
| GET     | `/ai/conversations`            | Liste conversations sauvegardees                  |
| GET     | `/ai/conversations/{conv_id}`  | Detail conversation (historique complet)          |
| DELETE  | `/ai/conversations/{conv_id}`  | Supprimer conversation                            |
| GET     | `/ai/profiles`                 | Liste 6 profils d expert                          |
| GET     | `/ai/usage`                    | Stats agregees par feature (30j defaut)           |
| GET     | `/ai/usage/daily`              | Stats journalieres                                |
| GET     | `/ai/usage/monthly`            | Stats mensuelles                                  |
| GET     | `/ai/credits`                  | Solde + monthly_limit + auto_recharge + is_exempt |
| GET     | `/ai/quota`                    | Verification quota (allowed/balance/monthly_used/monthly_limit/is_exempt) — endpoint actif dans `ai.py:2340` |
| POST    | `/ai/analyze-document`         | Vision : analyser image/PDF                       |
| POST    | `/ai/analyze-plan`             | Vision : analyser plan/blueprint                  |

### 4.2 Endpoints credits Stripe (`/stripe`)

| Methode | URL                              | Role                                           |
|---------|----------------------------------|------------------------------------------------|
| GET     | `/stripe/credits`                | Solde + usage du mois + is_exempt              |
| POST    | `/stripe/credits/recharge`       | Recharge manuelle ($5-$500)                    |
| POST    | `/stripe/checkout`               | Creer checkout abonnement                      |
| POST    | `/stripe/cancel`                 | Annuler abonnement                             |

### 4.3 Endpoint public (`/public`)

| Methode | URL                              | Role                                           |
|---------|----------------------------------|------------------------------------------------|
| POST    | `/public/sylvain-chat`           | Chat marketing pre-login (sans auth)           |

### 4.4 6 profils d expert

| Profil ID             | Domaine                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `general`             | Generaliste                                                             |
| `expert_construction` | CNB, CCE, normes ASTM/CSA, RBQ                                         |
| `estimateur`          | Estimation, soumissions                                                 |
| `comptable`           | TPS/TVQ, plan comptable, paie DAS, retenues garantie                    |
| `juridique`           | Code civil Quebec, contrats, vices caches                              |
| `securite`            | CNESST, EPI, prevention                                                 |

### 4.5 Modeles et couts

| Modele                   | Input ($/1M tokens) | Output ($/1M tokens) | Markup interne |
|--------------------------|---------------------|----------------------|----------------|
| `claude-sonnet-4-6`      | $3                  | $15                  | x1.30          |
| `claude-opus-4-20250514` | $15                 | $75                  | x1.30          |

> **Cost USD reel facture** = formule + 30% (couvre conversion CAD/USD + marge plateforme).

### 4.6 Tools (function calling)

#### 4.6.1 `recherche_bd`

- **Type** : SELECT-only (lecture)
- **Acces** : 40+ tables du tenant (CORE, ACCOUNTING, CRM, LOGISTICS, IMMOBILIER, LOCATION, MAINTENANCE, etc.)
- **Limite** : auto-LIMIT 50 lignes
- **Bloque** : commentaires SQL (`--`, `/* */`), `;`, keywords destructeurs
- **Audit** : log dans table audit (a verifier en prod)

#### 4.6.2 `executer_action`

- **Type** : INSERT / UPDATE / DELETE (ecriture)
- **Champ obligatoire** : `description` (audit trail)
- **Timeout** : 10 secondes par requete
- **Bloque** : memes keywords destructeurs au niveau **schema** (DROP TABLE, ALTER, GRANT)
- **PAS de confirmation** : Claude execute directement si elle decide d agir

### 4.7 Limites Public chat Sylvain

| Limite                         | Valeur            | Endpoint                                |
|--------------------------------|-------------------|------------------------------------------|
| Echanges par session           | 20                | session_id (genere cote client)          |
| Echanges par IP / 24h          | 50                | anti-cycling session                     |
| Requetes/minute global         | 10                | middleware                               |
| Max tokens reponse             | 2000              | hard cap                                 |
| Temperature                    | 0.7               | creativite controlee                     |
| Cache prompt systeme           | 5 minutes         | Anthropic ephemeral cache (12.5k tokens) |

### 4.8 Tables PostgreSQL (schema `public`)

| Table                  | Role                                                       |
|------------------------|------------------------------------------------------------|
| `ai_prepaid_credits`   | Solde credits par tenant (USD), Stripe info, auto-recharge |
| `ai_usage_tracking`    | Tracking par appel : user, feature, model, tokens, cost    |
| `ai_conversations`     | Conversations sauvegardees (par tenant + user)             |

> **Schema public** : ces tables sont **partagees** entre tous les tenants (gestion centralisee facturation IA). Les conversations restent isolees par `(tenant_slug, user_id)`.

### 4.9 Constants importantes

Source : `ai.py:36-38` (et `stripe_routes.py` pour les seuils Stripe)

```python
AI_GUARD_EXEMPT_IDS = {1, 105, 172}  # entreprise_id exemptes (table entreprises) — PAS tenant_id
AI_MODEL = "claude-sonnet-4-6"
AI_MAX_TOKENS = 31500
MIN_BALANCE_THRESHOLD = 0.10  # USD
PREPAID_RECHARGE_AMOUNT = 10.00  # USD
```

> **Important** : `AI_GUARD_EXEMPT_IDS` contient des `entreprise_id` (cle primaire de la table `entreprises`), **pas** des `tenant_id` ni des `tenant_slug`. C est verifie au niveau de l entreprise rattachee a l utilisateur connecte.

### 4.10 Validations & limites

| Regle                                    | Effet                                              |
|------------------------------------------|----------------------------------------------------|
| Solde IA <= 0 ET tenant non exempt       | HTTP 402 (Payment Required) si auto-recharge OFF ou Stripe echoue |
| Recharge < $5 ou > $500                  | HTTP 400                                           |
| `recherche_bd` avec keyword destructeur  | HTTP 400 (SQL bloque)                              |
| `executer_action` sans description       | Tool call refuse                                   |
| `executer_action` timeout > 10s          | Annule + log erreur                                |
| Public chat 21eme echange session        | Message « Limite atteinte »                        |
| Public chat 51eme echange / IP / 24h     | Message « Limite IP atteinte »                     |
| Document upload > 20 MB                  | HTTP 413                                           |

---

## 5. Integrations & FAQ

### 5.1 Vue d ensemble — IA dans tout l ERP

Recap des integrations IA dans les autres modules :

| Module                | Feature                       | Endpoint                                          | Modele                       |
|-----------------------|-------------------------------|---------------------------------------------------|------------------------------|
| **Module 7 Factures** | Scan facture par image/PDF    | `POST /accounting/invoices/ai/scan`               | claude-sonnet-4-6 (vision)   |
| **Module 8 Dossiers** | Enrichir une note             | `POST /documents/{id}/notes/ai/enrich`            | claude-sonnet-4-6            |
| **Module 8 Dossiers** | Analyser une photo (defauts)  | `POST /documents/{id}/notes/ai/analyze-photo`     | claude-sonnet-4-6 (vision)   |
| **Module 8 Dossiers** | Resumer toutes les notes      | `POST /documents/{id}/notes/ai/summary`           | claude-sonnet-4-6            |
| **Module 19 Immobilier** | Analyser projet (faisabilite) | `POST /immobilier/ia/analyser-projet`           | claude-opus-4-20250514       |
| **Module 19 Immobilier** | Chat contextuel              | `POST /immobilier/ia/chat`                        | claude-sonnet-4-20250514     |
| **Module 19 Immobilier** | Generer rapport financement  | `POST /immobilier/ia/rapport-financement`         | claude-sonnet-4-20250514     |
| **Module 19 Immobilier** | Optimiser financement        | `POST /immobilier/ia/optimiser-financement`       | claude-sonnet-4-20250514     |
| **Public marketing**  | Chat Sylvain (pre-login)      | `POST /public/sylvain-chat`                       | claude-sonnet-4-6            |
| **Module 25 IA central**  | Chat principal + tools       | `POST /ai/chat`                                  | claude-sonnet-4-6            |
| **Module 25 IA central**  | Analyse document             | `POST /ai/analyze-document`                       | claude-sonnet-4-6 (vision)   |
| **Module 25 IA central**  | Analyse plan                 | `POST /ai/analyze-plan`                           | claude-sonnet-4-6 (vision)   |

> **Toutes les features (sauf public Sylvain)** deduisent des credits du tenant. Tracking par feature dans `ai_usage_tracking`.

### 5.2 Integration Stripe

- Auto-recharge declenchee depuis `/ai/chat` si solde insuffisant.
- Charge montant `$10 CAD` (converti USD via taux Stripe) sur la carte stockee.
- Webhook Stripe `invoice.paid` -> mise a jour `ai_prepaid_credits.balance_usd`.
- Si Stripe echoue : credits non ajoutes, HTTP 402 retourne au user.

### 5.3 Securite tenant isolation

- Toutes les requetes IA passent par `db.set_tenant(conn, user.schema)` avant execution -> `db.reset_tenant(conn)` apres.
- Les tools `recherche_bd` et `executer_action` voient **uniquement** les donnees du tenant connecte (cloisonnement par schema PostgreSQL).
- Impossible pour Claude de fuiter des donnees inter-tenant via les tools.

### 5.4 Audit log

- Chaque appel IA logge dans `ai_usage_tracking` (input_tokens, output_tokens, cost_usd, duration_ms, success, model, feature, user_id, tenant_slug, created_at).
- Les requetes `recherche_bd` et `executer_action` sont auditees au niveau SQL (table audit dediee a verifier en prod).
- Conservation : illimitee (purge manuelle si necessaire).

### 5.5 FAQ

**Q : Quel est le cout typique d une conversation IA ?**
R : Une question simple (~500 tokens input + 300 tokens output) coute environ `(500*0.003 + 300*0.015) / 1000 * 1.30 = $0.0078 USD`, soit moins d un cent. Une analyse de plan complexe (4000 + 2000 tokens) coute environ `$0.055 USD`. Avec un solde de $10, vous avez ~180 analyses complexes ou ~1280 questions simples.

**Q : L IA peut-elle modifier mes donnees ?**
R : OUI via le tool `executer_action` (INSERT/UPDATE/DELETE). **Aucun garde-fou de confirmation** : si Claude decide d agir, l action est executee. Toutes les actions sont auditees, mais pas reversibles automatiquement. Soyez prudent avec les demandes destructives type « supprime tous les... ».

**Q : Les tokens cumules apparaissent-ils en temps reel ?**
R : OUI. Le badge `tokens` + `cost USD` apparait sur chaque message assistant des la fin du streaming.

**Q : Que se passe-t-il si je suis exempt de facturation ?**
R : Si votre `entreprise_id` est dans `AI_GUARD_EXEMPT_IDS = {1, 105, 172}` (codes en dur dans `ai.py:36`), `is_exempt = true` -> aucune deduction de credits. Les usages sont quand meme tracker pour analytics.

**Q : Comment changer la liste des entreprises exemptees ?**
R : Modification de code requise (`ai.py:36`, constante `AI_GUARD_EXEMPT_IDS`). Pas configurable via UI.

**Q : La carte Stripe peut-elle etre changee ?**
R : OUI via le portail Stripe (`/stripe/customer-portal` — a verifier en prod). La methode de paiement utilisee pour l auto-recharge est stockee dans `ai_prepaid_credits.stripe_payment_method`.

**Q : Combien de tokens contient le contexte envoye a chaque chat ?**
R : Le system prompt (selon profil) varie de 2k a 8k tokens. Les **6 derniers messages** de la conversation sont envoyes en contexte. Chaque message ajoute ~200-500 tokens. Total typique : 5k a 15k tokens input par requete.

**Q : Le chat utilise-t-il du streaming SSE ?**
R : NON cote client. La reponse est retournee en JSON complet via `ChatResponse` Pydantic. Le backend utilise `with _anthropic_client.messages.stream(...)` en interne pour eviter les timeouts sur les longues reponses Opus, mais recupere la reponse finale via `stream.get_final_message()` avant de la renvoyer en une seule fois. Pour activer du SSE cote client, il faudrait un endpoint `text/event-stream` (FastAPI `StreamingResponse`) et un `EventSource` dans `AssistantIAPage.tsx`.

**Q : Puis-je exporter une conversation en PDF ?**
R : Pas de bouton dedie dans cette version. Workaround : copier-coller le contenu dans un editeur de texte ou utiliser l impression du navigateur (Ctrl+P).

**Q : Le chat Sylvain pre-login utilise-t-il mon solde IA ?**
R : NON. Le chat Sylvain est gratuit (cote utilisateur), finance par la plateforme. Tracking dans `ai_usage_tracking` avec `feature='sylvain_chat_login'` mais non deduit.

**Q : Comment proteger mes donnees sensibles vis-a-vis de Claude (Anthropic) ?**
R : Anthropic offre un engagement de confidentialite : les donnees envoyees a l API Claude **ne sont pas utilisees pour entrainement** sauf opt-in explicite. Les conversations passent par les serveurs Anthropic — verifier la conformite avec vos exigences PIPEDA / Loi 25 si donnees personnelles.

**Q : Pourquoi le chat repond parfois Je n ai pas acces a cette donnee ?**
R : Soit le tenant est mal configure (`set_tenant` manquant), soit la table interrogee n existe pas dans le schema. Verifier les logs backend.

**Q : L IA peut-elle integrer des sources externes (Internet, APIs tierces) ?**
R : NON dans cette version. Pas de tool `web_search` ou `http_request`. L IA est limitee aux donnees du tenant (DB) + sa knowledge base d entrainement.

**Q : Combien de conversations sont conservees par utilisateur ?**
R : Pas de limite hard-codee. Chaque conversation = ~quelques KB en base. Pratiquement illimite. Suppression manuelle via icone poubelle si necessaire.

**Q : Le profil change-t-il automatiquement selon le contexte ?**
R : NON. Dans cette version, le profil est **hardcode a `'general'`** dans le frontend (`AssistantIAPage.tsx:34` -> `const selectedProfile = 'general';`). Il n y a **pas de UI** pour changer de profil. Les 6 profils existent cote backend (`AI_PROFILES` dans `ai.py`) et sont accessibles via `GET /ai/profiles`, mais l UI n expose pas de selecteur. Pour activer un autre profil, il faudrait modifier le code source ou implementer un dropdown.

---

## 6. Recap one-pager

- **Modeles** : claude-sonnet-4-6 (chat principal + scan facture + notes IA + chat public + analyse doc/plan), claude-opus-4-20250514 (immobilier analyser-projet).
- **6 profils experts** definis backend (general / expert_construction / estimateur / comptable / juridique / securite) — **profil hardcode `'general'` dans l UI** (`AssistantIAPage.tsx:34`), pas de dropdown selecteur.
- **2 tools function calling** : `recherche_bd` (SELECT only, max 50 lignes, blocked keywords) + `executer_action` (INSERT/UPDATE/DELETE avec audit).
- **PAS de garde-fou confirmation** sur executer_action : Claude execute directement.
- **Vision** : `/ai/analyze-document` + `/ai/analyze-plan` + scan facture + analyse photo dossier.
- **Pas de streaming SSE cote client** : reponse JSON complete via `ChatResponse` Pydantic. Stream Anthropic est interne au backend uniquement.
- **Conversations persistees** : table `ai_conversations`, 6 derniers messages envoyes en contexte.
- **Credits prepayes USD** : table `ai_prepaid_credits` (schema public), formule cost = (in*0.003 + out*0.015)/1000 * 1.30 (Sonnet).
- **Auto-recharge Stripe** : declenchee si balance < $0.10 USD, charge $10 CAD (PREPAID_RECHARGE_AMOUNT). Bouton **Recharger** = lien externe vers `https://billing.stripe.com/p/login/constructoai` (Customer Portal Stripe), pas de modale interne.
- **Entreprises exemptees** : `AI_GUARD_EXEMPT_IDS = {1, 105, 172}` (entreprise_id, pas tenant_id) codes en dur dans `ai.py:36`.
- **Tracking** : `ai_usage_tracking` (feature, model, tokens, cost, duration, success).
- **3 vues stats** : daily / monthly / aggregated by feature.
- **Public chat Sylvain** : sans auth, 20 echanges/session + 50/IP/24h + 10 req/min middleware. Cout pris en charge par la plateforme. Reponse JSON complete (pas SSE).
- **Tenant isolation** : RLS via PostgreSQL schema. Impossible cross-tenant data leak via tools.

---

**Documentation generee a partir du code** : `ai.py`, `public_chat.py`, `stripe_routes.py`, `AssistantIAPage.tsx`, integrations dans `accounting.py`, `documents.py`, `immobilier.py`.

**Manuels lies** :
- Module 7 (Factures — scan IA) — `07-factures.md`
- Module 8 (Dossiers — notes IA) — `08-dossiers.md`
- Module 19 (Immobilier — 4 endpoints IA) — `11-immobilier.md`
- Module 28 (Administration — gestion tenant + Stripe) — `14-administration.md` (a venir v2.0)
