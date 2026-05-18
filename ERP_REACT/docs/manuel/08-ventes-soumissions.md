# Module 08 — Devis (Soumissions)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/devis.py` (6619 lignes, 50 endpoints), `frontend/src/pages/DevisPage.tsx`, `frontend/src/pages/DevisPublicPage.tsx` (vue publique sans auth via token)
> **Tables PostgreSQL** : `devis`, `devis_lignes`, `devis_assignations`, `devis_public_tokens` (validite 90 jours), `devis_attachments`, `devis_dependencies`, `ai_profiles` (60+ profils experts), `conversations` (IA persistante) ; FK `devis.opportunity_id`, `devis.project_id`, `devis.client_company_id`, agregats `companies`
> **Cadrage** : ce module gere le **cycle complet des soumissions clients** (creation, lignes detaillees avec auto-detection MO/MAT, marges parametrables 3/12/15 %, taxes QC 5/9.975 %, envoi email + token public, signature electronique canvas, conversion automatique en projet a l acceptation, exports XLSX/CSV QuickBooks, IA Claude Opus pour estimation/analyse documents). Il **n offre pas** de duplication directe, pas de drag-and-drop des lignes, pas de multi-devises (CAD only), pas de gestion CCQ/CNESST basee sur les heures (utilise montant + metiers/taux).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface](#2-interface)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations et FAQ](#5-integrations-et-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

Le module Devis gere le cycle complet des soumissions clients : creation, calcul automatique des marges et taxes, envoi par lien partageable, signature electronique du client, conversion automatique en projet.

### 1.1 Concepts cles

- **Devis (soumission)** : numero auto-genere `DEV-AAAA-NNN`
- **Lignes (items)** : description, quantite, unite (libre), prix unitaire, montant calcule
- **Marges paramętrables** : Administration (3 %), Contingences (12 %), Profit (15 %)
- **Taxes** : TPS 5 %, TVQ 9.975 %
- **Token public** : lien `/devis/public/{token}`, validite 90 jours
- **Signature electronique** : canvas HTML5 -> PNG base64

### 1.2 Statuts (9 valeurs)

```
Brouillon -> Valide -> Envoye -> En attente -> Accepte -> Termine
                                            \-> Refuse
                                            \-> Annule
                                            \-> Expire
```

`DEVIS_STATUSES` : `['Brouillon', 'Valide', 'Envoye', 'En attente', 'Accepte', 'Refuse', 'Termine', 'Annule', 'Expire']`

### 1.3 Acces

- Sidebar -> **Devis / Soumissions**
- URL : `/devis`
- Page publique : `/devis/public/{token}` (sans authentification)

### 1.4 Permissions

- Tous les utilisateurs authentifies : creer, modifier, envoyer
- **Admin only** : modifier les conditions/exclusions par defaut entreprise (`PUT /devis/defaults`)
- **Suppression** : tout utilisateur authentifie, **interdite** si statut `Accepte` ou `Termine`
- Page publique : token = cle d acces, pas d authentification

---

## 2. Interface

### 2.1 Page Devis (`/devis`)

Layout :

```
+---------------------------------------------------------------+
| [4 KPI cards] Total | Brouillons | Envoyes | Taux acceptation |
+---------------------------------------------------------------+
| [+ Nouveau devis] [Recherche] [Statut v] [Type v]            |
+---------------------------------------------------------------+
| Liste paginee 20 items, vue Liste/Tableau/Cartes              |
| Numero | Nom projet | Client | Prix estime | Statut | Type    |
+---------------------------------------------------------------+
| Panneau detail (a droite ou plein ecran mobile)               |
+---------------------------------------------------------------+
```

### 2.2 Cartes KPI (4)

- Total devis
- Brouillons (statut Brouillon)
- Envoyes (statut Envoye + En attente)
- Taux acceptation = (Acceptes / Total cloturees) * 100

### 2.3 Vue Liste / Tableau / Cartes

- **Liste** : table classique avec colonnes Numero, Nom, Client, Prix, Statut, Type, Dates
- **Tableau** : version compacte avec sous-totaux HT/TPS/TVQ/Total
- **Cartes** : grille adaptative

Pas de drag-and-drop pour reordonner les lignes (sequence_ligne fixee a l ajout).

### 2.4 Filtres

- Recherche : sur numero_devis et nom_projet
- Filtre Statut : 6 valeurs visibles (Tous, Brouillon, Envoye, Accepte, Refuse, Expire)
- Filtre Type : Tous types / Detaillee / Budgetaire

Statuts `Valide`, `En attente`, `Termine`, `Annule` non exposes dans filtre dropdown (atteignables via autres flux).

### 2.5 Modale Nouveau devis (2 colonnes)

Colonne gauche :
- Nom projet *
- PO Client
- Client (Entreprise)
- Client (Personne)
- Saisie manuelle (si pas dans CRM)
- Statut (defaut Brouillon)
- Priorite

Colonne droite :
- Tache (parmi 27 taches predefinies de production : 1.1 a 16.4)
- Date soumission (`dateSoumis`)
- Date debut prevu (`datePrevu` -- nom DB exact)
- Date fin (`dateFin`)
- Prix estime (declenche cascade calcul backend)

Description (textarea pleine largeur).

### 2.6 Modale Modifier devis

Memes champs + Type soumission (Detaillee / Budgetaire).

Type Budgetaire ajoute un bandeau orange dans le HTML public : « Soumission budgetaire — estimation approximative ».

### 2.7 Constructeur de devis (panneau detail)

Sections empilees :
- **Client & Dates**
- **Lignes** (ajout, edition inline, masquage par icone oeil)
- **Calculs** (cascade HT -> Marges -> Sous-total -> TPS -> TVQ -> TTC)
- **Marges** (Admin/Conting/Profit, libelles personnalisables, toggle visibilite)
- **Conditions & Exclusions** (textareas max 10 000 caracteres)
- **Notes clients** (NE s affiche PAS dans HTML public)

### 2.8 Page publique (`/devis/public/{token}`)

HTML imprimable avec :
- Logo entreprise + RBQ + NEQ + TPS + TVQ
- Infos client + lignes + sous-totaux + marges + taxes + TOTAL TTC
- Conditions & Exclusions (si activees)
- **Formulaire d acceptation** : Nom signataire (2-200 caracteres), Signature canvas (PNG max 500 KB), bouton « Accepter »
- **Formulaire refus** : raison optionnelle (max 2000 caracteres)

---

## 3. Workflows pas-a-pas

### 3.1 Creer un devis

1. `/devis` -> bouton « + Nouveau devis »
2. Saisir Nom projet (obligatoire, non vide)
3. Choisir Client (Entreprise OU Personne OU Saisie manuelle)
4. Renseigner Tache, Dates, PO Client, Priorite
5. Saisir Prix estime (declenche cascade calcul backend si > 0)
6. Description, Type soumission
7. Cliquer « Creer »

> **A savoir** : numero `DEV-AAAA-NNN` genere automatiquement.

### 3.2 Ajouter une ligne

1. Section Lignes -> bouton « + Ajouter »
2. Saisir Description (obligatoire), Quantite, Unite (texte libre), Prix unitaire
3. Categorie optionnelle (texte libre, regroupement HTML)
4. Cliquer Ajouter
5. Recap auto des totaux (HT / TPS / TVQ / TTC)

### 3.3 Modifier ou masquer une ligne

- Crayon : edition inline (description, qte, unite, prix, ratio MO/MAT custom)
- Icone oeil : bascule visibilite dans HTML public (ligne reste comptee)
- Poubelle : suppression apres confirmation

> **PAS de drag-and-drop** des lignes. Ordre fixe par `sequence_ligne` a l ajout.

### 3.4 Configurer les marges

1. Panneau Sous-total HT
2. Modifier % (defaut 3 % / 12 % / 15 %)
3. OU saisir montant fixe en $ (le backend retro-calcule le %)
4. Renommer libelles (ex: « Frais generaux »)
5. Toggle visibilite par marge
6. Auto-save au blur

### 3.5 Auto-detection MO/MAT par mots-cles

21 regles couvrant les principaux corps de metier QC :

| Mot-cle | MO % | MAT % |
|---|---|---|
| Peinture, teinture, vernis | 70 | 30 |
| Demolition | 65 | 35 |
| Gypse, platrage | 60 | 40 |
| Electricite | 55 | 45 |
| Ceramique, carrelage | 55 | 45 |
| Maconnerie | 55 | 45 |
| Plomberie | 50 | 50 |
| Toiture, couverture | 45 | 55 |
| Beton, fondation | 40 | 60 |
| CVAC | 40 | 60 |
| Isolation | 35 | 65 |
| Excavation, terrassement | 30 | 70 |
| Armoires, ebenisterie | 30 | 70 |
| Portes et fenetres | 30 | 70 |
| Aucun mot-cle | 50 | 50 |

Override personnalise possible par ligne. Bouton « Auto » revient a la detection.

### 3.6 Personnaliser Conditions & Exclusions

- 2 textareas (max 10 000 caracteres, max 200 lignes)
- Defauts entreprise (admin) ou personnalises devis
- Bouton « Reinitialiser » revient aux defauts
- Toggle « Afficher dans PDF »

### 3.7 Generer prevu HTML

1. Bouton « Prevu HTML » ou « Apercu »
2. Iframe modale avec rendu professionnel
3. Verifier calculs et mise en page avant envoi

### 3.8 Envoyer le devis au client

1. Bouton « Envoyer au client »
2. Saisir adresse email destinataire
3. (Optionnel) modele de message + personnalisation
4. Cliquer « Envoyer »

Backend :
- Statut -> `Envoye`
- Genere validation_token si absent
- Enregistre dans `devis_public_tokens` (validite 90 jours)
- Envoie email avec lien `/devis/public/{token}`
- Stocke `sent_to`, `sent_at` dans metadonnees_json

### 3.9 Le client visualise et accepte

1. Client clique le lien recu
2. Page publique sans authentification
3. Saisit Nom signataire (2-200 caracteres)
4. Trace signature canvas
5. Cliquer « Accepter »

Backend `POST /devis/public/{token}/accept` :
1. UPDATE atomique `WHERE statut IN ('Envoye', 'En attente')` (race-safe)
2. Stocke nom + signature + date dans metadonnees_json
3. **Cree automatiquement un Projet** lie au devis
4. Si opportunite associee : passe a `GAGNE`
5. Copie pieces jointes devis -> projet

### 3.10 Le client refuse

1. Bouton « Refuser » sur page publique
2. Raison optionnelle (max 2000 caracteres)
3. Statut -> `Refuse`, raison ajoutee aux notes

### 3.11 Convertir manuellement en projet

Si statut `Accepte` ou `Termine` ET pas encore de projet lie :

1. Bouton « Convertir en projet »
2. Endpoint `POST /devis/{id}/convert-to-project`
3. **Idempotent** : si project_id existe, retourne created=false avec ID existant

### 3.12 Exporter en Excel (.xlsx)

1. Bouton « Excel (.xlsx) »
2. Telechargement automatique `{numeroDevis}.xlsx`
3. Inclut : entete client, lignes formatees, sous-totaux, taxes, TTC
4. Protection anti-injection formules
5. Type Budgetaire : titre devient « SOUMISSION BUDGETAIRE »

### 3.13 Exporter en CSV QuickBooks

1. Bouton « CSV QuickBooks » (ou « Copier CSV »)
2. Format compatible QB Online / Excel
3. Colonnes : Item, Description, Category, Quantity, Unit, Unit Price, Amount, Tax Code, MO %, MO $, MAT %, MAT $
4. Encodage UTF-8 BOM

### 3.14 Calcul CCQ (cotisation Quebec)

Endpoint `POST /devis/calculate-ccq` :
- Body : `montantMainOeuvre` + `metiers` (liste)
- Bareme par metier (electricien 11.8 %, plombier 11.8 %, charpentier 12.5 %, peintre 12.5 %, manoeuvre 12.5 %, etc.)
- Si plusieurs metiers : MO divisee a parts egales, taux applique par part

> **PAS** un calcul `heures × taux horaire`. Utilise montant + metiers.

### 3.15 Calcul CNESST

Endpoint `POST /devis/calculate-cnesst` :
- Body : `montantMainOeuvre` + `tauxUnite` (% defaut 1.80)
- Calcul : `cotisation = montant * taux / 100`

> **PAS** base sur les heures. Utilise montant + taux %.

### 3.16 Estimation IA (onglet IA)

Composant `EstimationIA` qui pilote conversation Claude Opus :
- 60+ profils experts (Architecte, Electricien, Plombier, etc.)
- Profils personnalises possibles via `POST /devis/ai-profiles`
- Documents de connaissance (PDF, XLSX, DOCX, CSV, TXT) attaches
- Generation structuree d items via `POST /devis/ai-generate-soumission`

### 3.17 Analyse document IA

Endpoint `POST /devis/ai-analyze-document` :
- Upload PDF / image (max 32 Mo, images compressees a 5 Mo)
- Diagnostic « Entrepreneur general » : categorie, gamme, superficies par zone

Couts IA deduits du tenant (Opus 4.7 : 15 $ / M tokens entree, 75 $ / M tokens sortie + marges).

### 3.18 Calcul auto a la modification

Lors d un PUT devis avec `prixEstime > 0`, le backend :
- Aligne `total_travaux` sur `prix_estime`
- Recalcule administration, contingences, profit
- Recalcule TPS, TVQ, `investissement_total`

### 3.19 Mise a jour automatique au passage Accepte

Lors du PUT, si statut transite vers `Accepte` ou si deja `Accepte` sans `project_id` (orphelin), le projet est cree automatiquement en arriere-plan. Message : « Devis mis a jour — Projet cree automatiquement ».

### 3.20 Modifier les conditions/exclusions par defaut entreprise

Reserve aux **admins** :
1. Configuration entreprise -> Soumissions
2. Modifier textes
3. Cliquer « Enregistrer »
4. Tous les nouveaux devis utiliseront ces defauts (existants intacts)

### 3.21 Mise a jour en lot

Pas de fonction native multi-selection avec changement de statut groupe dans cette version.

### 3.22 Supprimer un devis

1. Icone poubelle
2. Confirmation
3. **Refus** si statut = `Accepte` ou `Termine` (HTTP 400 « Impossible de supprimer un devis accepte ou termine »)
4. Cascade DELETE : lignes, assignations, dependances, envois, dossiers
5. Detachement (SET NULL) sur factures, projets, opportunites lies

> **Important** : la suppression n est PAS reservee aux admins. Tout utilisateur authentifie peut supprimer un devis eligible.

### 3.23 Aucune fonction « Dupliquer »

Le module **ne contient aucune fonction de duplication** ni de clonage. Pour reutiliser un devis :
1. Creer une nouvelle soumission manuellement
2. Utiliser onglet Manuel (template construction) ou Estimation IA
3. Ou copier les valeurs a la main

---

## 4. Reference

### 4.1 DEVIS_STATUSES (9 valeurs)

| Statut | Couleur badge | Description |
|---|---|---|
| Brouillon | Gris | En cours de redaction |
| Valide | Bleu | Verifie en interne, pret a envoyer |
| Envoye | Indigo | Transmis au client |
| En attente | Jaune | Recu mais pas encore decide |
| Accepte | Vert | Signe et accepte |
| Refuse | Rouge | Refuse par le client |
| Termine | Vert | Projet associe termine |
| Annule | Rouge | Annule a l interne |
| Expire | Ambre | Validite token publique depassee |

### 4.2 PRIORITES (3 valeurs)

`PRIORITE_OPTIONS` : `NORMAL` (defaut) / `URGENT` / `CRITIQUE`.

> **PAS** HAUTE/NORMALE/BASSE comme dans d autres modules.

### 4.3 Type de soumission

`Detaillee` (defaut) ou `Budgetaire`. Type Budgetaire ajoute bandeau orange dans HTML public.

### 4.4 Champs ligne devis

| Champ | Type | Obligatoire | Notes |
|---|---|---|---|
| `description` | Texte | **Oui** | -- |
| `quantite` | Decimal | **Oui** | > 0, defaut 1 |
| `unite` | Texte libre | Non | Defaut « unite ». Aucune liste fermee |
| `prix_unitaire` | Decimal | **Oui** | >= 0 |
| `montant_ligne` | Decimal | Auto | quantite * prix_unitaire |
| `categorie` | Texte libre | Non | Aucune liste fermee. Regroupement HTML |
| `notes_ligne` | Texte | Non | -- |
| `sequence_ligne` | Entier | Auto | MAX(seq)+1 |
| `visible` | Booleen | Non | Defaut TRUE. FALSE = exclu HTML/XLSX |
| `mo_pct, mat_pct` | Decimal | Non | Custom MO/MAT 0-100 |

### 4.5 Marges par defaut

Constants backend :
- `_DEFAULT_ADM_PCT = 3.0` (Administration)
- `_DEFAULT_CON_PCT = 12.0` (Contingences)
- `_DEFAULT_PRO_PCT = 15.0` (Profit)

Initialises sur chaque nouveau devis dans colonnes `administration_pct`, `contingences_pct`, `profit_pct`.

### 4.6 Cascade calcul

```
1. Sous-total HT = Sigma(montant_ligne) lignes visibles
2. Administration = Sous-total * 3 %
3. Contingences = Sous-total * 12 %
4. Profit = Sous-total * 15 %
5. Sous-total avant taxes = Travaux + Admin + Contingences + Profit
6. TPS = Sous-total avant taxes * 5 %
7. TVQ = Sous-total avant taxes * 9.975 %
8. TOTAL TTC = Sous-total avant taxes + TPS + TVQ
```

Tous arrondis a 2 decimales via `round(_, 2)`.

### 4.7 Token public

- Format : 6-120 caracteres alphanumeriques + `-` `_`
- Generation : `_generate_readable_token()` base sur slugifie de `nom_projet`
- Stocke dans `devis_public_tokens (token, tenant_schema, devis_id, expires_at)`
- Validite **90 jours** (`_register_public_token(..., expires_days=90)`)

### 4.8 Page publique acceptance race-safe

```sql
UPDATE devis SET statut = 'Accepte', signature_date = CURRENT_TIMESTAMP
WHERE id = ? AND statut IN ('Envoye', 'En attente')
RETURNING id
```

Seule la premiere requete reussit. Les autres recoivent rowcount=0 -> erreur 400.

### 4.9 Conversion devis -> projet (calcul budget)

Priorite :
1. `investissement_total` (si > 0)
2. `total_avant_taxes + (TPS + TVQ implicites estimees)`
3. `prix_estime`
4. `total_travaux` (fallback)

Operation **idempotente** : si project_id existe deja, retourne created=false avec ID existant.

### 4.10 Limites systeme

| Element | Limite |
|---|---|
| Pagination liste devis | 10 / 25 / 50 par page |
| Lignes par devis | < 500 recommande |
| Conditions / Exclusions | max 10 000 caracteres, max 200 lignes |
| Signature electronique (PNG base64) | max 500 KB |
| Token public | 6-120 caracteres |
| Validite token | 90 jours par defaut |
| Batch ajout lignes | max 2000 simultanees |
| Description ligne | max 5000 caracteres |
| IA upload | 32 Mo PDF, 5 Mo image (compressee) |

### 4.11 Endpoints API

| Methode | URL | Fonction |
|---|---|---|
| GET | `/devis` | Liste paginee |
| POST | `/devis` | Creer |
| GET | `/devis/{id}` | Detail |
| PUT | `/devis/{id}` | Modifier |
| DELETE | `/devis/{id}` | Supprimer (refus si Accepte/Termine) |
| GET/POST/DELETE | `/devis/{id}/lignes` | Gestion lignes |
| POST | `/devis/{id}/lignes/batch` | Ajout en lot |
| GET/POST/DELETE | `/devis/{id}/assignments` | Assignations employes |
| POST | `/devis/{id}/generate-html` | Generer HTML |
| GET | `/devis/{id}/export-xlsx` | Export Excel |
| POST | `/devis/{id}/send` | Envoi email + token |
| GET | `/devis/public/{token}` | Vue publique (sans auth) |
| POST | `/devis/public/{token}/accept` | Acceptation client |
| POST | `/devis/public/{token}/refuse` | Refus client |
| POST | `/devis/{id}/convert-to-project` | Conversion projet |
| GET/PUT | `/devis/defaults` | Conditions/exclusions defauts (admin) |
| POST | `/devis/calculate-ccq` | Calcul CCQ |
| POST | `/devis/calculate-cnesst` | Calcul CNESST |
| POST | `/devis/ai-analyze-document` | Analyse doc IA |
| POST | `/devis/ai-generate-soumission` | Generation IA |
| POST | `/devis/{id}/ai-estimate` | Estimation IA d un devis existant |
| GET/POST/PUT/DELETE | `/devis/ai-profiles[/...]` | Profils IA personnalises |

### 4.12 Numerotation auto

Format : `DEV-{annee}-{id:03d}` ex : `DEV-2026-007` (3 chiffres min, padding zeros).

### 4.13 Generateur HTML / template

HTML genere cote serveur en francais (templates lignes 4750+). Couleurs entreprise via `get_document_theme`. Aucun i18n.

---

## 5. Integrations et FAQ

### 5.1 Devis <-> CRM (Opportunites)

- Conversion opportunite -> devis via `POST /crm/opportunities/{id}/create-devis` (manuel CRM)
- Champ `opportunity_id` sur devis
- A la suppression d opportunite : devis conserve, opportunity_id mis a NULL

### 5.2 Devis <-> Projets

- Conversion devis -> projet automatique a l acceptation client
- Conversion manuelle via bouton « Convertir en projet » (idempotent)
- Lien bidirectionnel : `devis.project_id` et `projects.devis_id`
- Operation race-safe (SAVEPOINT)

### 5.3 Devis <-> Companies

- Client (Entreprise) reference une `company_id`
- Snapshot du nom dans `client_nom_cache` a la creation
- Si client supprime apres : nom en cache reste

### 5.4 Devis <-> Dossiers

- A l acceptation : pieces jointes copiees vers projet
- Lien `dossier_devis` cree automatiquement

### 5.5 Devis <-> Email

- Endpoint `/devis/{id}/send` envoie via SMTP configure
- Stocke metadata sent_to, sent_at, html_generated dans metadonnees_json

### 5.6 Devis <-> IA

- 4 endpoints IA : analyze-document, generate-soumission, estimate, ai-chat
- Couts IA deduits via `_check_credits` + `_deduct_credits`
- Profils IA personnalises (PDF/XLSX/DOCX/CSV/TXT comme contexte)

### 5.7 FAQ

**Q1. Pourquoi pas de fonction Dupliquer ?**
Le module n offre pas de duplication directe. Utiliser onglet Manuel (template) ou Estimation IA pour reconstituer un devis.

**Q2. Pourquoi pas de drag-and-drop des lignes ?**
Aucun import DnD library, aucun handler `onDragStart` dans `DevisPage.tsx`. `useSortable` utilise pour tri d en-tetes uniquement. L ordre est fixe par `sequence_ligne` a l ajout.

**Q3. Les unites sont-elles fermees a une liste ?**
Non. Champ `unite` est un `<input>` texte libre. Backend `unite: str = "unite"` sans validation.

**Q4. Les categories sont-elles fermees a 4 valeurs ?**
Non. `categorie: Optional[str] = None` sans enum. Le prompt IA suggere 21 corps de metier mais aucune contrainte n est imposee.

**Q5. Quelles sont les vraies priorites ?**
`PRIORITE_OPTIONS` (frontend) liste **NORMAL / URGENT / CRITIQUE**. Pas HAUTE/NORMALE/BASSE.

**Q6. La suppression est-elle reservee aux admins ?**
Non. Tout utilisateur authentifie peut supprimer, sauf si statut Accepte ou Termine (refus 400).

**Q7. Comment marche le calcul CCQ ?**
Body : `montantMainOeuvre + metiers` (liste). Bareme par metier (electricien 11.8 %, plombier 11.8 %, etc.). PAS heures × taux.

**Q8. Comment marche le calcul CNESST ?**
Body : `montantMainOeuvre + tauxUnite (%)`. Defaut taux 1.80 %. PAS base sur les heures.

**Q9. Quel est le vrai nom de colonne « date debut prevu » ?**
**`date_prevu`** (sans `debut`). Verifie devis.py lignes 104, 579-580.

**Q10. La cascade calcul est-elle automatique ?**
Oui. Au PUT devis avec `prixEstime > 0`, le backend recalcule total_travaux, marges, taxes, investissement_total.

**Q11. Que se passe-t-il a l acceptation client ?**
Race-safe UPDATE -> statut Accepte + signature_date + creation projet automatique + lien opportunite (statut GAGNE) + copie pieces jointes.

**Q12. Quelle protection contre la double conversion en projet ?**
`POST /devis/{id}/convert-to-project` est **idempotent** : si project_id existe deja, retourne created=false avec ID existant (pas d erreur).

**Q13. Le HTML public expire-t-il ?**
Token validite 90 jours. Apres : 404 « Devis non disponible ». Genrer un nouveau token via re-envoi.

**Q14. Quel est le format du token public ?**
Slugifie depuis nom_projet + suffixe aleatoire. Regex : `^[a-zA-Z0-9\-_]{6,120}$`.

**Q15. Quels exports sont disponibles ?**
- HTML imprimable
- Excel (.xlsx) avec protection anti-injection
- CSV QuickBooks (Copier ou Telecharger)

**Q16. Quelles dependances entre devis ?**
Table `devis_dependencies` (referencee ligne 4338) mais non documentee dans l UI standard.

**Q17. Quelles conversations IA persistantes ?**
8 endpoints `/conversations*` (lignes 2832-3294) avec documents attaches et toggle ON/OFF. Cache Anthropic 5 min.

**Q18. Quels endpoints assignments existent ?**
3 endpoints : GET/POST `/devis/{id}/assignments`, DELETE `/devis/{id}/assignments/{aid}`.

**Q19. Limite descriptions / notes lignes ?**
- `DevisLigneCreate.description` : aucun max_length (illimite jusqu a la limite DB)
- Notes (devis) : champ `notes: Optional[str] = None` sans `max_length`
- Seul `PreviewLigneItem` a `max_length=2000` (ligne 4942)

**Q20. Multi-devises supporte ?**
Non. Toujours $ CAD. Le systeme ne stocke pas la devise.

**Q21. Que se passe-t-il a la suppression d un devis Accepte ?**
Refus HTTP 400 « Impossible de supprimer un devis accepte ou termine ». Pour annuler : modifier le statut puis supprimer.

**Q22. Quels champs ne s affichent PAS dans le HTML public ?**
- Notes internes (`notes`) : visible uniquement dans interface admin
- `validation_token`, `metadonnees_json`, `notes` masques avant retour API publique

---

## 6. Recap one-pager

| Element | Detail |
|---------|--------|
| **Mission** | Cycle complet des soumissions : creation, lignes detaillees, marges parametrables 3/12/15 %, taxes QC 5/9.975 %, envoi par lien public token (90j), signature canvas, conversion auto en projet a l acceptation, exports XLSX/CSV QuickBooks, IA Claude. |
| **Code source** | `backend/routers/devis.py` (6619 lignes, 50 endpoints), `frontend/src/pages/DevisPage.tsx`, `frontend/src/pages/DevisPublicPage.tsx` |
| **Tables PostgreSQL** | `devis`, `devis_lignes`, `devis_assignations`, `devis_public_tokens`, `devis_attachments`, `devis_dependencies`, `ai_profiles`, `conversations` |
| **Endpoints majeurs** | CRUD `/devis`, lignes (POST simple/batch, PUT, PATCH visibility, DELETE), assignations, generate-html, export-xlsx, send (email+token), public/{token} (GET/accept/refuse sans auth), convert-to-project (idempotent), defaults (admin), calculate-ccq, calculate-cnesst, ai-analyze-document, ai-generate-soumission, ai-chat[-with-files], ai-profiles (CRUD + documents), conversations (8 endpoints persistance IA) |
| **Statuts/types** | 9 statuts (Brouillon / Valide / Envoye / En attente / Accepte / Refuse / Termine / Annule / Expire). 3 priorites (NORMAL / URGENT / CRITIQUE). 2 types soumission (Detaillee / Budgetaire). |
| **Permissions** | Tous utilisateurs authentifies : creer/modifier/envoyer/supprimer (sauf si statut Accepte/Termine -> 400). **Admin only** : `PUT /devis/defaults` (conditions/exclusions par defaut entreprise). Token public : pas d auth, validite 90 jours. |
| **Integrations** | CRM Opportunites (`opportunity_id`, conversion entrante depuis CRM), Projets (`project_id` cree auto a l acceptation, lien bidirectionnel), Companies (`client_company_id`, snapshot `client_nom_cache`), Dossiers (lien `dossier_devis` + copie pieces jointes vers projet), SMTP (envoi email), IA Claude Opus 4.7 (15 $/M tokens entree, 75 $/M tokens sortie, deduit credits). |
| **Pas implemente** | Pas de **fonction Dupliquer**. Pas de drag-and-drop des lignes (sequence_ligne fixe a l ajout). Pas de multi-devises (CAD only). Pas de batch update statut multi-selection. Pas de CCQ/CNESST sur heures (montant + metiers/taux uniquement). Filtres UI : 6 statuts visibles sur 9 (Valide / En attente / Termine / Annule masques). Pas de validation max_length sur `description` ligne ou `notes` devis. |

---

*Manuel ERP Constructo — Module Devis (Soumissions) — v2.0 verifie — 2026-04-25*
