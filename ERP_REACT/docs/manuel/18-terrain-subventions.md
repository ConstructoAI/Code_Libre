# Module 18 — Subventions Quebec / Canada

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/subventions.py` (1561 lignes), `backend/routers/subventions_data.py` (donnees seed), `frontend/src/pages/SubventionsPage.tsx` (5 onglets), `frontend/src/api/subventions.ts`
> **Tables PostgreSQL** : `subventions_categories`, `subventions_programmes`, `subventions_demandes`, `subventions_documents`
> **Cadrage** : ce module est un **catalogue de programmes de subventions et un suiveur de demandes** (admissibilite -> demande -> approbation -> versement) — PAS un module comptable. Les **versements** ne sont PAS comptabilises automatiquement (voir Module 7) et la **conformite administrative** (RBQ, CCQ, CNESST) est traitee dans le Module 17. Le module est specialise sur les programmes accessibles aux entreprises de construction quebecoises (provincial, federal, municipal).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (5 onglets)](#2-interface-5-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Centraliser la **veille et le suivi des programmes de subventions** accessibles aux entreprises quebecoises de construction, renovation et services connexes :

- **Catalogue** de 47 programmes pre-charges (provincial, federal, municipal) avec criteres, montants, taux, secteurs et echeances
- **Verificateur d eligibilite** algorithmique (scoring sectoriel + budget) sans appel IA
- **Demandes de subvention** avec cycle de vie complet : `BROUILLON` -> `EN_PREPARATION` -> `SOUMISE` -> `EN_EVALUATION` -> `APPROUVEE` / `REFUSEE` -> `VERSEE` (9 statuts au total)
- **Televersement de documents** justificatifs (PDF, Office, images) jusqu a 10 MB par fichier, stocke en base (BYTEA)
- **Tableau de bord** : KPIs (nombre programmes / demandes / montants demandes / montants accordes), graphiques par categorie, niveau, statut
- **Programmes expirants** dans les 30 prochains jours (alerte dashboard)
- **Ressources** : 8 organismes partenaires + Plan PME 2025-2028 (219 M$) + conseils pratiques
- **Assistant IA** (Claude Opus 4.7) avec 5 endpoints : suggestion de programmes, chat conversationnel, generation de checklist, analyse de demande, analyse d eligibilite approfondie

### 1.2 Ce que le module ne fait PAS

> **Important** : ce module est un **suiveur de programmes**, pas un module comptable ni un substitut a la presentation officielle des demandes.

Il **n implemente pas** : soumission electronique automatisee aux organismes (IQ, BDC, SCHL — soumission manuelle via portails officiels), pre-remplissage des formulaires officiels, comptabilisation automatique des versements (cf. Module 7), notifications email/SMS, workflow d approbation interne, calcul des taxes sur subventions, veille automatique sur nouveaux programmes, integration Centris / portail B2B, rappels par calendrier (iCal / Google), multi-projets par demande (`projet_id` unique).

### 1.3 Acces & permissions

- Sidebar -> **Subventions** (icone Landmark). URL : `/subventions`. Onglet par defaut : **Catalogue**. 5 onglets (cf. section 2).
- Tous les utilisateurs authentifies du tenant peuvent CRUD demandes et documents. Pas d endpoint POST programme cote API publique (admin via SQL/seed).
- **IA** : guardee par `_check_credits()` + `check_ai_guard()` — credits IA prepayes requis (HTTP 402 sinon).
- **Soft-delete non implemente** sur `subventions_demandes` : DELETE physique avec garde (HTTP 400 si statut `APPROUVEE` ou `VERSEE`). `subventions_documents` en CASCADE DELETE.

### 1.4 Format reference interne demande

**`SUB-YYYYMMDDHHMMSS-NNNNN`** (ex. `SUB-20260426143052-00031`). Source : `subventions.py:728` `reference = f"SUB-{timestamp}-{demande_id:05d}"`.

- `YYYYMMDDHHMMSS` : horodatage UTC de creation
- `NNNNN` : id demande zero-padded sur 5
- Genere atomiquement (INSERT RETURNING id puis UPDATE)
- **Reference externe** (`reference_externe`) : champ libre pour numero attribue par l organisme (ex. `ESSOR-2026-12345`).

---

## 2. Interface (5 onglets)

Source : `SubventionsPage.tsx:38-39` (`TabKey`) et `:93-99` (array `items`).

| # | Cle           | Label             | Icone      | Contenu principal                                                |
|---|---------------|-------------------|------------|------------------------------------------------------------------|
| 1 | `catalogue`   | Catalogue         | BookOpen   | 47 programmes filtrables (categorie / type / niveau / difficulte / secteur / texte) |
| 2 | `eligibilite` | Eligibilite       | Target     | Verificateur algorithmique base sur profil entreprise            |
| 3 | `demandes`    | Mes demandes      | FileText   | CRUD demandes + cycle de vie + televersement de documents        |
| 4 | `dashboard`   | Tableau de bord   | BarChart3  | KPIs + graphiques + alerte programmes expirants                  |
| 5 | `ressources`  | Ressources        | Layers     | 8 organismes + Plan PME 2025-2028 + conseils pratiques           |

### 2.1 Onglet « Catalogue »

**Filtres (5 simultanes, combines en AND cote backend)** :

| Filtre              | Valeurs / Source                                              |
|---------------------|---------------------------------------------------------------|
| Categorie           | 8 categories (PME_GENERAL, CONSTRUCTION, ENERGIE, FORMATION, INNOVATION, REGIONAL, DEMARRAGE, EXPORT) |
| Type d aide         | `SUBVENTION` / `PRET` / `CREDIT_IMPOT` / `MIXTE` / `GARANTIE` |
| Niveau              | `FEDERAL` / `PROVINCIAL` / `MUNICIPAL` / `MIXTE`              |
| Difficulte          | `FACILE` / `MOYEN` / `COMPLEXE`                               |
| Recherche texte     | ILIKE sur `nom`, `organisme`, `description` (escaped, debounce 400 ms) |

**Carte programme** : nom, organisme, description (line-clamp 3), badges (typeAide / niveau / difficulte / categorie), plage montants (`montantMin` - `montantMax`) + pourcentage aide %, telephone (cliquable `tel:`), URL programme (externe), date limite (orange si proche). Compteur « N programme(s) trouve(s) » sous les filtres.

### 2.2 Onglet « Eligibilite »

**Formulaire profil** : `Taille` (5 valeurs : Travailleur autonome / Micro / Petite / Moyenne / Grande), `Secteurs` (19 chips multi-select : PME, CONSTRUCTION, RENOVATION, MANUFACTURIER, ENERGIE, LOGEMENT, COMMERCIAL, RESIDENTIEL, NUMERIQUE, FORMATION, EMPLOYEUR, EXPORTATEUR, STARTUP, DEMARRAGE, REPRENEURIAT, RURAL, FAIBLE_REVENU, PATRIMOINE, BOIS), `Region` (17 du Quebec + Autre), `Types projet` (13 chips : Demarrage, Expansion, Modernisation, Transformation numerique, Efficacite energetique, Formation, Exportation, Repreneuriat, Renovation, Equipement, R&D, Embauche, Energie verte), `Budget` (numerique, defaut 50 K$), `Urgence` (4 niveaux : Immediat < 3 mois / Court 3-6 mois / Moyen 6-12 mois / Long > 12 mois).

**Algorithme de scoring** (`subventions.py:1120-1184`) :
```python
score = 0
score += 20 * len(user_sectors_upper & prog_sectors_upper)   # +20 par secteur en commun
if raw_max is not None and float(raw_max) >= budget * 0.1:  # +15 si max >= 10% budget
    score += 15
if has_construction and "CONSTRUCTION" in prog_sectors_upper:  # +25 bonus construction
    score += 25
```

Seuls les programmes avec `score > 0` retenus, tries decroissants. **Top 10** dans `topMatches`. Algorithmique (gratuit, instantane). Affichage : Badge `Score: NN` (vert si >= 50, ambre sinon) + description + montant max + lien officiel.

### 2.3 Onglet « Mes demandes »

**Command bar** : bouton **+ Nouvelle demande**, recherche texte (sur `programmeNom`, `referenceExterne`, `notes`, `statut`), filtre statut (dropdown 6 valeurs).

**Carte demande** : reference interne (ou `#id`), badge statut, programme + organisme, montant demande / montant accorde, notes (italic line-clamp 2), dates Creee/Soumise/Decision.

**Boutons d action conditionnels** :

| Action     | Disponible si statut...                                  |
|------------|---------------------------------------------------------|
| Details    | Toujours                                                |
| Modifier   | Statut != `ANNULEE`                                     |
| Soumettre  | Statut == `BROUILLON` ou `EN_PREPARATION`               |
| Supprimer  | Statut != `APPROUVEE` et != `VERSEE` (HTTP 400 sinon)   |

**Modale creation** : `Programme` (dropdown obligatoire), `Montant demande` (numerique, max 1 G$), `Notes` (textarea max 5000 char). Statut initial `BROUILLON`, reference interne auto.

**Modale edition** : `Montant demande`, `Montant accorde`, `Reference externe`, `Notes`, `Motif de refus` (visible si REFUSEE). Modification du statut via `PUT /demandes/{id}` (sans validation de transition, cf. FAQ).

**Modale Detail** : badge statut + niveau, programme + organisme, montants, dates, notes, motif refus (Alert rouge si REFUSEE), criteres du programme. Section **Documents** : bouton Televerser, pour chaque doc (nom + badge statut + MIME + taille KB + date upload + dropdown changement statut + boutons telecharger / supprimer).

**MIME types acceptes** (`subventions.py:66-77`) : PDF, DOC/DOCX, XLS/XLSX, JPG/PNG/WEBP, TXT, CSV. **Validation taille** : max 10 MB (`MAX_DOC_SIZE_BYTES`). HTTP 413/415 sinon.

### 2.4 Onglet « Tableau de bord »

Source : `subventions.py:1020-1099` `get_statistics`.

**KPI cards (4)** :
- Programmes actifs : `COUNT(*) WHERE actif = TRUE`
- Demandes totales : `COUNT(*) FROM demandes`
- Montant demande : `SUM(montant_demande) WHERE statut IN ('APPROUVEE','VERSEE')`
- Montant accorde : `SUM(montant_accorde) WHERE statut IN ('APPROUVEE','VERSEE')`

> Seuls les statuts `APPROUVEE` et `VERSEE` comptent pour les sommes — `SOUMISE` et `EN_EVALUATION` exclus.

**Graphiques (3)** : Programmes par categorie (BarChart, JOIN categories), Programmes par niveau (PieChart, GROUP BY niveau_gouvernement), Demandes par statut (BarChart, GROUP BY statut).

**Alerte programmes expirants** : `WHERE date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + N days` (defaut N=30). Cartes ambree avec icone Calendar.

### 2.5 Onglet « Ressources »

Source : `subventions.py:1106-1113` `get_resources` -> `{organismes, planPme, conseils}`.

**Conseils pratiques (2 sections, source `subventions_data.py:660-680`)** :
- *Etapes recommandees* : Commencez par votre MRC | Cumulez les programmes (max 80%) | Preparez votre dossier (etats financiers, plan d affaires, projections) | Respectez les delais | Consultez un expert (conseillers MRC gratuits)
- *Points importants* : cumul max 80% des depenses admissibles | 2024-2025 95% aide IQ va aux PME | 230 000 PME au Quebec (99,7% tissu industriel) | Verifier sites officiels regulierement

**Organismes partenaires (8)** : Reseau Acces PME (via MRC), Investissement Quebec (1 844 474-6367), SADC (reseau-sadc.qc.ca), APCHQ (apchq.com), MicroEntreprendre, Annuaire subventionsquebec.net (2 696 programmes), Gouvernement Canada/Quebec (sites officiels). Source : `subventions_data.py:580-629`.

**Plan PME 2025-2028 (219 M$)** :

Tableau des 6 enveloppes principales :

| Programme                  | Enveloppe | Description                                  |
|----------------------------|-----------|----------------------------------------------|
| ESSOR                      | 136 M$    | Reconduction du programme                    |
| Reseau acces PME           | 22,6 M$   | 450 conseillers en developpement economique  |
| MicroEntreprendre          | 12,7 M$   | Services de microcredit                      |
| Espaces PME innovation     | 14,4 M$   | Accompagnement projets novateurs             |
| Groupes sous-representes   | 14,88 M$  | Formation et accompagnement                  |
| Repreneuriat               | 17 M$     | Transfert d entreprises                      |

---

## 3. Workflows pas-a-pas

### 3.1 Decouvrir les programmes accessibles

1. Onglet **Catalogue**, appliquer filtres : Categorie (`Construction & Renovation` ou `Energie & Environnement`), Niveau (`PROVINCIAL` ou `FEDERAL`), Difficulte (commencer par `FACILE` puis `MOYEN`).
2. Cliquer sur la carte d un programme pour voir details. Icone Phone (`tel:`) pour appeler l organisme, ExternalLink pour ouvrir le site officiel.

### 3.2 Verifier l eligibilite (algorithmique)

1. Onglet **Eligibilite**, remplir profil : Taille, Secteurs (multi-chips, ex. `CONSTRUCTION`, `RENOVATION`), Region, Types projet (multi-chips), Budget (numerique), Urgence.
2. Cliquer **Verifier mon eligibilite** -> `POST /subventions/eligibility-check`. Backend score chaque programme (algorithmique, ~50 ms).
3. Affiche `topMatches` (top 10 par score) + total eligible. Cliquer sur un programme pour voir details.

> **Astuce** : si CONSTRUCTION est dans les secteurs choisis, les programmes avec `CONSTRUCTION` dans `secteurs_admissibles` recoivent un bonus +25 (45 pts minimum).

### 3.3 Creer une demande de subvention

1. Onglet **Mes demandes** -> bouton **+ Nouvelle demande**. Modale : `Programme` (dropdown obligatoire), `Montant demande` (optionnel, $), `Notes` (max 5000 char).
2. `POST /subventions/demandes`. Backend : verifie programme existe (HTTP 404 sinon), verifie FK `projet_id`/`company_id` si fournis, INSERT statut `BROUILLON` avec `created_by = user.user_id`, INSERT RETURNING id, UPDATE `reference_interne = SUB-YYYYMMDDHHMMSS-NNNNN`.
3. Reference generee : ex. `SUB-20260426143052-00031`.

### 3.4 Televerser des documents justificatifs

1. Onglet **Mes demandes** -> ouvrir demande (bouton **Details**) -> section **Documents** -> bouton **Televerser**.
2. Selectionner fichier (PDF, DOC/DOCX, XLS/XLSX, JPG/PNG/WEBP, TXT, CSV).
3. Validation backend : MIME dans `ALLOWED_DOC_MIME` (HTTP 415 sinon), taille <= 10 MB (HTTP 413 sinon), fichier non vide (HTTP 400 sinon).
4. `POST /subventions/demandes/{id}/documents` (multipart/form-data).
5. INSERT dans `subventions_documents` avec `fichier_data` (BYTEA), `mime_type`, `taille`, `statut = 'FOURNI'`, `uploaded_by`.

> **Stockage en base** : BYTEA dans la table `subventions_documents` (pas d export S3 / disque). Performance : eviter > 100 documents par demande.

### 3.5 Suivre le statut d un document

Dans la section Documents d une demande, dropdown statut a 4 valeurs : `A_FOURNIR` (gris, placeholder), `FOURNI` (bleu, defaut), `VALIDE` (vert), `REJETE` (rouge). Selection -> `PUT /documents/{id}/status`. Suppression : `DELETE` definitif (pas de soft-delete).

### 3.6 Soumettre une demande a l organisme

> **Important** : le module ne soumet PAS la demande aux organismes. Cette action passe juste le statut interne en `SOUMISE` pour le suivi.

1. Carte d une demande en `BROUILLON` ou `EN_PREPARATION` -> bouton **Soumettre** (icone Send) -> confirmation.
2. `POST /demandes/{id}/soumettre`. Backend verifie statut IN `('BROUILLON', 'EN_PREPARATION')` (HTTP 400 sinon), puis UPDATE `statut = 'SOUMISE'`, `date_soumission = CURRENT_DATE`.
3. **Action externe** : presenter manuellement le dossier sur le portail officiel (Investissement Quebec, BDC, SCHL, etc.).
4. Renseigner ensuite la **Reference externe** (numero attribue par l organisme) via Modifier.

### 3.7 Suivre le cycle de vie d une demande

Progression typique :

```
BROUILLON -> EN_PREPARATION (PUT) -> SOUMISE (POST /soumettre)
  -> EN_EVALUATION -> INFO_SUPPLEMENTAIRE -> APPROUVEE/REFUSEE -> VERSEE
```

A chaque etape, mettre a jour via **Modifier** : `statut`, `montant_accorde` (si APPROUVEE), `motif_refus` (si REFUSEE), `reference_externe`, `date_decision`, `date_versement`.

> **Pas de transition automatique** : aucune machine d etat n empeche de passer directement de `BROUILLON` a `VERSEE`. Logique laissee a l utilisateur.

### 3.8 Comptabiliser un versement (manuel)

> **Le module Subventions ne cree PAS d ecriture journal automatique.**

Quand une demande passe en `VERSEE` : aller dans **Comptabilite** (Module 7) -> Journal -> **+ Nouvelle ecriture** type `AUTRE` ou `AJUSTEMENT`. Lignes : Debit `1010` (Encaisse) / Credit `4900` (Autres revenus) ou un compte dedie « Subventions recues » a creer (ex. code `4920` pour faciliter rapports fiscaux). Reference : la `reference_interne` Subventions.

### 3.9 Consulter le tableau de bord

Onglet **Tableau de bord** : KPIs (programmes, demandes, montants), 3 graphiques (categorie / niveau / statut), alerte programmes expirants dans 30 jours (`date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 days`).

### 3.10 Endpoints IA (5)

> Endpoints exposes mais **pas de bouton UI dans la page Subventions au moment de la documentation**. Appel via API ou via le module IA central (Module 12). Cout deduit des credits IA prepayes (modele `claude-opus-4-7`, formule `(input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30`).

| Endpoint                       | Body principal                                         | Reponse                                                    |
|--------------------------------|--------------------------------------------------------|------------------------------------------------------------|
| `POST /ai/suggest`             | `{descriptionProjet, budget?}`                         | JSON `{programmesFederaux[], programmesProvinciaux[], creditsImpot[], autresAides[], montantTotalPotentiel, strategieFinancement, attention}` |
| `POST /ai/chat`                | `{question, context?}`                                 | Texte libre `{response}` en francais quebecois            |
| `POST /ai/checklist`           | `{programmeId}`                                        | Markdown 5 sections (documents / informations / elements demande / etapes / conseils) avec cases `- [ ]` |
| `POST /ai/analyze-demande`     | `{demandeId}`                                          | JSON `{scorePreparation 0-100, pointsForts[], pointsAAmeliorer[], documentsManquantsProbables[], conseilsRedaction[], risquesRefus[], estimationDelaiTraitement, conseilGlobal}` |
| `POST /ai/analyze-eligibility` | `{secteur, taille, region, chiffreAffaires, employes, projetsPrevus[]}` | JSON `{programmesRecommandes[{nom, scoreCompatibilite, raison, montantPotentiel, difficulteObtention, actionsRequises[]}], programmesAEviter[], strategieRecommandee, montantTotalPotentiel, prochainesEtapes[]}` |

> **`analyze-eligibility`** : backend recupere les 40 premiers programmes actifs (ORDER BY nom ASC LIMIT 40, puis tronque a 20 dans le prompt).
> **Validation JSON avant billing** pour `suggest`, `analyze-demande`, `analyze-eligibility` — pas de facturation pour reponse malformee (HTTP 502).

### 3.11 Supprimer une demande

1. Onglet **Mes demandes** -> bouton **Supprimer** (icone Trash2) sur une carte.
2. Confirmation native browser.
3. `DELETE /subventions/demandes/{id}`.
4. Backend verifie statut :
   - Si `APPROUVEE` ou `VERSEE` -> HTTP 400 (« Impossible de supprimer une demande approuvee ou versee »)
   - Sinon : DELETE physique
5. Les documents associes sont supprimes en CASCADE (FK `ON DELETE CASCADE`).

> **Pas de soft-delete** sur les demandes — la suppression est definitive. Pour archiver, considerer plutot le statut `ANNULEE` (manuel via PUT).

---

## 4. Reference

### 4.1 Structure des donnees (4 tables)

#### `subventions_categories` (8 lignes seedees)

| Colonne          | Type        | Note                                   |
|------------------|-------------|----------------------------------------|
| `id`             | SERIAL PK   | Auto                                   |
| `code`           | TEXT UNIQUE | ex. `CONSTRUCTION`, `ENERGIE`          |
| `nom`            | TEXT        | ex. `Construction & Renovation`        |
| `description`    | TEXT        | Texte libre                            |
| `ordre_affichage`| INTEGER     | Tri UI (1-8)                           |
| `actif`          | BOOLEAN     | Defaut TRUE                            |
| `created_at`     | TIMESTAMPTZ |                                        |

#### `subventions_programmes` (47 lignes seedees)

**Colonnes principales** :
- `id` SERIAL PK, `categorie_id` FK -> `subventions_categories.id`
- `code` TEXT (unique partial index WHERE code IS NOT NULL), `nom` TEXT NOT NULL
- `organisme`, `description` TEXT
- `type_aide` (5 valeurs), `niveau_gouvernement` (4 valeurs), `difficulte` (3 valeurs, defaut MOYEN)
- `montant_min` / `montant_max` NUMERIC(15,2), `pourcentage_aide` NUMERIC(5,2)
- `secteurs_admissibles` JSONB array, ex. `["CONSTRUCTION","ENERGIE"]`
- `criteres_eligibilite`, `documents_requis`, `url_programme`, `telephone`, `email` TEXT
- `date_debut`, `date_fin` DATE
- `actif` BOOLEAN (defaut TRUE), `notes`, `created_at`, `updated_at`

> **Index** : `idx_subv_prog_categorie`, `idx_subv_prog_actif`, `idx_subv_prog_date_fin`, `idx_subv_prog_code_unique` (partial).

#### `subventions_demandes`

**Colonnes principales** :
- `id` SERIAL PK, `programme_id` FK (verifie a l insert)
- `projet_id` / `company_id` (FK optionnels avec `_table_exists` guard)
- `reference_interne` TEXT (`SUB-YYYYMMDDHHMMSS-NNNNN`), `reference_externe` (numero organisme)
- `montant_demande` / `montant_accorde` NUMERIC(15,2), max 1 G$
- `statut` TEXT (defaut `BROUILLON`, 9 valeurs cf. 4.2)
- `date_soumission` (auto `CURRENT_DATE`), `date_decision`, `date_versement` DATE
- `responsable_id` (= `created_by`), `notes` (max 5000), `motif_refus` (max 2000), `created_by`
- `created_at`, `updated_at` TIMESTAMPTZ

> **Index** : `idx_subv_demandes_statut`, `idx_subv_demandes_programme`. **Pas de soft-delete** (DELETE physique avec garde `statut NOT IN ('APPROUVEE','VERSEE')`).

#### `subventions_documents`

`id` SERIAL PK, `demande_id` FK ON DELETE CASCADE, `nom` TEXT, `type_document` (optionnel), `fichier_data` **BYTEA** (binaire complet en base), `mime_type` (validation), `taille` INTEGER (bytes), `statut` TEXT (4 valeurs, defaut `FOURNI`), `notes`, `uploaded_at`, `uploaded_by`. Index : `idx_subv_docs_demande`.

### 4.2 9 statuts demande

Source : `subventions_data.py:39-49` `STATUTS_DEMANDE`.

| Statut                 | Couleur   | Description                                | Set par                  |
|------------------------|-----------|--------------------------------------------|--------------------------|
| `BROUILLON`            | gris      | Defaut a la creation                       | Auto INSERT              |
| `EN_PREPARATION`       | ambre     | En cours de preparation interne            | Manuel via PUT           |
| `SOUMISE`              | bleu      | Soumise a l organisme                      | Auto via POST /soumettre |
| `EN_EVALUATION`        | violet    | L organisme analyse                        | Manuel                   |
| `INFO_SUPPLEMENTAIRE`  | orange    | Organisme demande des infos supplementaires| Manuel                   |
| `APPROUVEE`            | vert      | Decision favorable                         | Manuel                   |
| `REFUSEE`              | rouge     | Decision negative (saisir `motif_refus`)   | Manuel                   |
| `ANNULEE`              | gris      | Annulee par le demandeur                   | Manuel                   |
| `VERSEE`               | turquoise | Fonds recus                                | Manuel                   |

> **Validation** : `subventions.py:773` empeche un statut hors enum cote update (HTTP 400 « Statut invalide »).
> **Soumission** : `subventions.py:815` verifie statut IN `('BROUILLON', 'EN_PREPARATION')` (HTTP 400 sinon).
> **Suppression** : `subventions.py:847` empeche DELETE si statut IN `('APPROUVEE', 'VERSEE')` (HTTP 400).

### 4.3 4 statuts document

`A_FOURNIR` (gris, placeholder) -> `FOURNI` (bleu, defaut upload) -> `VALIDE` (vert, conforme) ou `REJETE` (rouge, a refaire).

### 4.4 5 types d aide

`SUBVENTION` (non remboursable), `PRET` (remboursable, parfois sans interet), `CREDIT_IMPOT` (ex. RS&DE 35%, RenoVert 20%), `MIXTE` (subvention + pret), `GARANTIE` (garantie de pret par organisme public).

### 4.5 4 niveaux de gouvernement

`FEDERAL` (SCHL, BDC, CNRC-PARI, DEC Canada, Revenu Canada), `PROVINCIAL` (Investissement Quebec, MEI, Transition Energetique Quebec, Hydro-Quebec, Revenu Quebec), `MUNICIPAL` (MRC locales, Ville de Quebec, Municipalites), `MIXTE` (cofinance federal + provincial).

### 4.6 3 niveaux de difficulte

`FACILE` (formulaire court, decision rapide — ex. Renoclimat, FLI), `MOYEN` (plan d affaires, etats financiers requis — ex. ESSOR V1, V3), `COMPLEXE` (etudes, ingenierie, audits energetiques, decision longue — ex. SCHL Construction, RS&DE, Technoclimat).

### 4.7 Catalogue des 47 programmes seedes — vue synthetique

Source : `subventions_data.py:123-573` `DEFAULT_PROGRAMMES`. Repartition par categorie. Les noms exacts, montants min, taux d aide %, telephones, URLs, secteurs admissibles et dates sont stockes dans le seed.

| Categorie                     | # | Programmes-cles (code -> max)                                                                                                                                |
|-------------------------------|---|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **PME & Entreprises**         | 6 | ESSOR_V1 (100 K$ etudes), ESSOR_V2 (5 M$ productivite), ESSOR_V3 (2 M$ environnement), ESSOR_V4 (1 M$ international), FLI (500 K$), BDC_PME (5 M$)            |
| **Construction & Renovation** | 6 | SCHL_CONSTRUCTION (50 M$), SCHL_RENOVATION (10 M$), SCHL_ECOENERGETIQUE (170 K$/log), NOVOCLIMAT (25%), MAISONS_CANADA (10 M$), RENOVERT (cred. impot 10 K$)  |
| **Energie & Environnement**   | 9 | LOGIVERT (Hydro 22 K$), RENOCLIMAT (20 K$), PRET_VERT (40 K$ federal), INITIATIVE_VERTE (5 K$), CHAUFFEZ_VERT (15 K$), ECOPERFORMANCE (100 K$), TECHNOCLIMAT (5 M$), RENOREGION (25 K$ rural), ECONOLOGIS (services) |
| **Formation & Emploi**        | 6 | PACME (100 K$), CREDIT_APPRENTI (2 K$ federal), CREDIT_STAGE (30%), CREDIT_FORMATION (5 460 $), MFOR (100 K$), SUBV_SALARIALE (50 K$)                        |
| **Innovation & Technologie**  | 6 | CNRC_PARI (500 K$), RSDE (3 M$, 35%), PCAN_V1 (2 400 $), PCAN_V2 (15 K$), ESSOR_NUMERIQUE (50 K$), OTN (100 K$)                                              |
| **Developpement Regional**    | 4 | SADC_FEDERAL (250 K$), FACADES_COMMERCIALES (66 K$), PATRIMOINE (100 K$), ANTIREFOULEMENT (5 K$ Ville Quebec)                                                |
| **Demarrage & Repreneuriat**  | 4 | MICROENTREPRENDRE (20 K$), RELEVE_ENTREPRISE (100 K$), REPRENEURIAT_QC (50 K$), CAMPUS_REPRENEURIAT (25 K$)                                                  |
| **Exportation**               | 6 | CANEXPORT (75 K$ federal), EXPORT_QUEBEC (100 K$), FRONTIERE (50 M$ tarifs douaniers), CHANTIER_PRODUCTIVITE (5 M$), IRRT (500 K$ manufacturier), BDC_BOIS (10 M$) |

> **Programmes-cles construction** : SCHL_CONSTRUCTION/RENOVATION/ECOENERGETIQUE (federal logement), NOVOCLIMAT/RENOCLIMAT/CHAUFFEZ_VERT/ECOPERFORMANCE (Transition Energetique Quebec), LOGIVERT (Hydro-Quebec), MAISONS_CANADA (federal bois canadien), RENOVERT (Revenu Quebec credit impot 20%), FACADES_COMMERCIALES/PATRIMOINE (municipal).
> **Note** : la categorie `EXPORT` contient `BDC_BOIS` (industrie du bois) malgre un rattachement plus naturel sous Construction.

### 4.8 Endpoints API

Prefix : `/subventions`. Tous protected par `Depends(get_current_user)`.

- **Metadata** : `GET /constants` (enums), `GET /resources` (organismes + Plan PME + conseils)
- **Programmes** : `GET /categories`, `GET /programmes` (6 filtres), `GET /programmes/expiring?days=30`, `GET /programmes/{id}`
- **Demandes** : `GET /demandes?statut=...`, `GET /demandes/{id}` (+ documents), `POST /demandes` (statut BROUILLON), `PUT /demandes/{id}` (whitelist 11 champs), `POST /demandes/{id}/soumettre`, `DELETE /demandes/{id}` (sauf APPROUVEE/VERSEE)
- **Documents** : `POST /demandes/{id}/documents` (multipart, max 10 MB), `GET /documents/{id}/download`, `PUT /documents/{id}/status`, `DELETE /documents/{id}`
- **Stats & eligibilite** : `GET /statistics`, `POST /eligibility-check`
- **IA (5)** : `POST /ai/{suggest, chat, checklist, analyze-demande, analyze-eligibility}`

### 4.9 Validations & limites Pydantic

- `montant_demande` / `montant_accorde` : 0 <= x <= 1 000 000 000
- `notes` <= 5000 char ; `motif_refus` <= 2000 char ; `reference_externe` <= 255 char
- IA `description_projet` 1 <= len <= 5000 ; `question` 1 <= len <= 2000 ; `context` <= 10 000
- Eligibility `secteurs` / `types_projet` <= 50 entrees ; `chiffre_affaires` <= 1 T$ ; `employes` <= 1 M
- `days` (programmes/expiring) : 1 <= n <= 365

### 4.10 Cout IA et tarification

Source : `subventions.py:58-63`. Modele `claude-opus-4-7`, max tokens output 30 000.

**Formule** : `cost = (input_tokens * 0.015 + output_tokens * 0.075) / 1000 * 1.30` (markup 30%).

> **Validation avant facturation** : `_call_claude_json` parse le JSON AVANT de deduire les credits. Si reponse invalide, utilisateur PAS facture (HTTP 502 « Reponse IA invalide »).

### 4.11 Erreurs HTTP principales

- **400** : tenant manquant / aucun champ a mettre a jour / statut invalide / soumission depuis statut non eligible / suppression APPROUVEE-VERSEE / fichier vide / statut document invalide
- **402** : credits IA epuises (« Veuillez recharger votre solde »)
- **403** : acces IA refuse (billing guard)
- **404** : programme / projet / entreprise / demande / document introuvable
- **413** : fichier > 10 MB / requete IA trop volumineuse
- **415** : MIME non supporte
- **502** : reponse IA JSON invalide (`Reponse IA invalide, veuillez reessayer`)
- **503** : service IA non disponible / Claude overload

---

## 5. Integrations & FAQ

### 5.1 Integration Comptabilite (Module 7)

> **Aucune ecriture journal automatique** : un versement (`statut = VERSEE`, `montant_accorde > 0`, `date_versement`) n est PAS poste dans `journal_entries`.

Pour comptabiliser : aller dans **Comptabilite** -> Journal -> **+ Nouvelle ecriture** type `AUTRE` ou `AJUSTEMENT`. Lignes : Debit `1010` (Encaisse) / Credit `4900` (Autres revenus) ou compte dedie « Subventions recues » a creer (ex. code `4920`). Reference : `reference_interne` Subventions.

### 5.2 Integration Conformite (Module 20)

**Aucune jointure** entre `subventions_demandes` et les attestations RBQ / NEQ / CCQ / CNESST. Plusieurs programmes (SCHL Construction, Maisons Canada, IQ) **exigent** une licence RBQ valide — verification manuelle dans le Module 17. Recommandation : televerser copies des attestations dans la section Documents de la demande (statut `FOURNI` / `VALIDE`).

### 5.3 Integration Projets / CRM / Documents

- **Projets (Module 1)** : champ `projet_id` optionnel -> reference `projects.id`. Validation FK guardee (`_table_exists`). Pas de jointure UI (ID seulement, pas le nom). Pas de filtre par projet dans la liste des demandes.
- **CRM / Companies** : champ `company_id` optionnel -> reference `companies.id`. Validation guardee. Pas de pre-remplissage NEQ / RBQ / adresse.
- **Documents (Module 8)** : documents Subventions stockes en BYTEA dans `subventions_documents`, distincts des documents Module 8 Dossiers. Pas de partage de fichiers entre les deux modules.

### 5.4 Integration IA / Credits

5 endpoints IA (`suggest`, `chat`, `checklist`, `analyze-demande`, `analyze-eligibility`) deduisent des credits prepayes (`tenant_settings.ai_credits_balance_usd`). Tracking dans `ai_usage` avec features `subventions_*`. Modele : `claude-opus-4-7`. Validation JSON BEFORE billing pour `suggest`, `analyze-demande`, `analyze-eligibility` — pas de facturation pour reponse malformee.

### 5.5 Integration Calendrier & B2B Portal

**Aucune integration** : pas d export iCal / Google Calendar des dates limites de programmes. L alerte « Programmes expirants » du dashboard est lecture seule. Pour rappels : ajouter manuellement au Calendrier (`/calendar`).

Les demandes de subvention **ne sont PAS** visibles dans le portail client B2B (information interne uniquement).

### 5.6 Format de seeding

8 categories + 47 programmes pre-charges au premier acces du module par un tenant. **Idempotent** : `ON CONFLICT (code) DO UPDATE SET nom = EXCLUDED.nom` (categories), `ON CONFLICT (code) WHERE code IS NOT NULL DO NOTHING` (programmes). Chaque tenant a son propre catalogue (multi-tenant via schemas PostgreSQL). Pour ajouter de nouveaux programmes : modifier `subventions_data.py` et redeployer.

### 5.7 FAQ

**Q : Le format `SUB-YYYYMMDDHHMMSS-NNNNN` est-il atomique ?**
R : OUI. Pattern INSERT RETURNING id puis UPDATE. Pas de race condition. Timestamp en UTC.

**Q : Que se passe-t-il si je passe une demande de `BROUILLON` directement a `VERSEE` via PUT ?**
R : Aucun blocage technique. Validation seulement sur valeur dans l enum. Aucune machine d etat. Bonne pratique : suivre le cycle naturel.

**Q : Le module verifie-t-il que le programme est encore actif a la creation ?**
R : NON. Seule l existence du `programme_id` est verifiee (pas `actif = TRUE` ni `date_fin`). Permet le rattrapage historique.

**Q : Combien de programmes seedes ? Le catalogue couvre-t-il Hydro-Quebec et le municipal ?**
R : 47 programmes. **Hydro-Quebec** : LogisVert (22 K$). **Municipal** : 4 programmes (FACADES_COMMERCIALES, PATRIMOINE, ANTIREFOULEMENT - Ville Quebec, FLI - MRC). Pour d autres villes (Montreal, Laval), saisir manuellement.

**Q : Le module supporte-t-il les credits d impot ?**
R : OUI. `type_aide = CREDIT_IMPOT` couvre RS&DE, RenoVert (20%), Credit formation PME, Credit apprenti. Suivi pour declaration fiscale.

**Q : Comment cumuler plusieurs programmes ?**
R : Cumul **autorise jusqu a 80%** des depenses admissibles (regle generale Quebec). Module ne controle PAS — verification manuelle. Voir conseil onglet Ressources.

**Q : Les documents sont-ils chiffres en base ?**
R : NON. Stockage BYTEA brut. Chiffrement = celui de PostgreSQL (TDE si configure) + tenant isolation par schema.

**Q : L IA peut-elle recommander des programmes hors catalogue ?**
R : OUI. `ai/suggest` se base sur la connaissance generale de Claude Opus (programmes quebecois/canadiens 2025) — peut mentionner des programmes non seedes. `analyze-eligibility` est limite aux 20 premiers programmes du catalogue (LIMIT 40 / tronque 20 dans le prompt). Pour scoring exact sur tout le catalogue, utiliser `eligibility-check` algorithmique.

**Q : Y a-t-il un workflow d approbation interne ou des notifications email ?**
R : NON aux deux. Tout utilisateur peut creer, modifier, soumettre. Aucune notification automatique. Pour workflow, utiliser le statut `EN_PREPARATION` + processus organisationnel.

**Q : Les versements partiels et l export CSV sont-ils supportes ?**
R : NON aux deux. Un seul `montant_accorde` + `date_versement` par demande (creer plusieurs demandes pour versements multiples). Export CSV : pas d UI integree (utiliser l API `GET /demandes` ou copier-coller).

**Q : Quel ordre d affichage et que se passe-t-il avec un programme inactif ?**
R : `ORDER BY p.nom ASC` (alphabetique). `GET /programmes` filtre `WHERE actif = TRUE`. `GET /programmes/{id}` retourne meme les inactifs. Pour tri par pertinence, utiliser onglet Eligibilite.

**Q : Capacite documents et performance ?**
R : Recommandation : ne pas depasser 20-30 documents par demande (10 MB max chacun, BYTEA en base). Liste demandes : binaire NON charge (OK). Download : binaire charge en memoire (verifier `mem_limit` app).

---

## 6. Recap one-pager

- **Module focus** : catalogue + suivi des demandes de subventions pour entreprises de construction quebecoises (PAS un module comptable).
- **5 onglets** : Catalogue, Eligibilite, Mes demandes, Tableau de bord, Ressources.
- **47 programmes seedes** dans 8 categories (PME, Construction, Energie, Formation, Innovation, Regional, Demarrage, Export).
- **9 statuts demande** : `BROUILLON` -> `EN_PREPARATION` -> `SOUMISE` -> `EN_EVALUATION` -> `INFO_SUPPLEMENTAIRE` -> `APPROUVEE`/`REFUSEE` -> `VERSEE` (+ `ANNULEE`).
- **Enums** : 5 types d aide (SUBVENTION/PRET/CREDIT_IMPOT/MIXTE/GARANTIE), 4 niveaux (FEDERAL/PROVINCIAL/MUNICIPAL/MIXTE), 3 difficultes (FACILE/MOYEN/COMPLEXE).
- **Reference interne** : `SUB-YYYYMMDDHHMMSS-NNNNN` (UTC, race-safe). **Reference externe** : champ libre pour numero organisme.
- **Documents** : upload BYTEA en base (max 10 MB, 10 MIME types), 4 statuts (`A_FOURNIR`/`FOURNI`/`VALIDE`/`REJETE`).
- **Eligibilite algorithmique** : +20 par secteur match, +15 si montant_max >= 10% budget, +25 bonus construction. Top 10.
- **5 endpoints IA** : suggest, chat, checklist, analyze-demande, analyze-eligibility (Claude Opus 4.7, validation JSON avant billing).
- **Plan PME 2025-2028** : 219 M$ (ESSOR 136 M / Reseau acces PME 22.6 M / MicroEntreprendre 12.7 M / Espaces innovation 14.4 M / Groupes sous-representes 14.88 M / Repreneuriat 17 M).
- **Pas de** : soumission electronique aux organismes / ecriture journal auto / notifications email-SMS / export iCal-CSV / jointure UI projet-company / B2B portal.
- **Suppression** : DELETE physique avec garde APPROUVEE/VERSEE (HTTP 400). Documents en CASCADE DELETE.

---

**Documentation generee a partir du code** : `subventions.py` (1561 lignes, 16+ endpoints), `subventions_data.py` (8 categories + 47 programmes + 8 organismes + Plan PME + conseils + AI prompt), `SubventionsPage.tsx` (5 onglets, 1158 lignes), `subventions.ts` (api client), `useSubventionsStore.ts` (Zustand store).

**Manuels lies** :
- Module 1 (Projets — FK projet_id sur demandes) — `01-projets.md`
- Module 7 (Comptabilite — comptabiliser manuellement les versements) — `07-factures.md`
- Module 8 (Dossiers — pour upload reel de fichiers larges) — `08-dossiers.md`
- Module 19 (Immobilier — programmes SCHL Construction et logement abordable) — `11-immobilier.md`
- Module 25 (IA — credits IA) — `12-ia.md`
- Module 17 (Conformite — RBQ/CCQ/CNESST exiges par certains programmes) — `20-conformite.md`
