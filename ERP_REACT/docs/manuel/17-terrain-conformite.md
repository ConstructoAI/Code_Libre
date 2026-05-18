# Module 17 — Conformite RBQ / CCQ

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/conformite.py` (2247 lignes), `backend/routers/conformite_data.py` (donnees de reference RBQ/CCQ/CNESST), `frontend/src/pages/ConformitePage.tsx` (5 onglets), `frontend/src/api/conformite.ts`, `frontend/src/store/useConformiteStore.ts`
> **Tables PostgreSQL** : `conformite_licences_rbq`, `conformite_cartes_ccq`, `conformite_attestations` (avec `fichier_data` BYTEA pour pieces jointes)
> **Cadrage** : module **Conformite reglementaire Quebec construction** — gere les licences RBQ (Regie du batiment du Quebec), les cartes de competence CCQ (Commission de la construction du Quebec) et les attestations fiscales/sectorielles (Revenu Quebec, ARC, CNESST, CCQ, RBQ). Inclut un assistant IA Claude Opus 4.7 specialise reglementation Quebec (7 endpoints).
> **Acces** : Sidebar -> **Conformite RBQ/CCQ** (icone Shield), URL `/conformite`.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (5 onglets)](#2-interface-5-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations--faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Centraliser la **gestion documentaire reglementaire** d une entreprise de construction au Quebec :

- **Licences RBQ** : numero, sous-categories (26 codes officiels du 1.1 au 16), date d expiration, cautionnement, assurance responsabilite civile, statut.
- **Cartes de competence CCQ** : carte par employe, metier principal (28 metiers), qualification dynamique (Compagnon / Apprenti X periode / Classe N), heures cumulees, formation ASP Construction.
- **Attestations** : 5 types reglementaires (Revenu Quebec, ARC, CNESST, CCQ, RBQ) avec piece jointe PDF/image en base (BYTEA, max 10 Mo).
- **Tableau de bord** : score global 0-100, KPIs, repartitions par categorie/metier/type, alertes auto (60 jours licences/cartes, 30 jours attestations).
- **Verifications projet IA** : exigences reglementaires d un projet (licences requises, metiers CCQ, permis, attestations, cautionnement minimum, ratio compagnon/apprenti).
- **7 endpoints IA Claude Opus 4.7** : analyser conformite, chat expert, verifier exigences projet, rechercher reglementations, predire renouvellements, generer rapport, recommander formations.
- **Resources** : 8 organismes officiels (RBQ, CCQ, CNESST, Revenu Quebec, ARC, ASP Construction, Ombudsman, CMEQ) + 6 sections de conseils pratiques.

### 1.2 Pourquoi c est important (contexte legal Quebec)

- **RBQ (Regie du batiment du Quebec)** : delivre les licences obligatoires aux entrepreneurs (Loi sur le batiment, chapitre B-1.1). Aucun travail facture ne peut etre execute sans licence couvrant la sous-categorie correspondante. Sanctions : amendes, suspension, revocation.
- **CCQ (Commission de la construction du Quebec)** : gere les cartes de competence des travailleurs (Loi R-20). Chaque travailleur sur un chantier R-20 doit detenir une carte valide. Renouvellement selon heures travaillees. Ratio compagnon/apprenti obligatoire.
- **CNESST** : delivre l attestation de conformite obligatoire avant chaque debut de chantier et tout paiement client.
- **Revenu Quebec et ARC** : delivrent les attestations fiscales exigees pour soumettre des appels d offres.

Ce module evite les ruptures de conformite en alertant en amont et en centralisant les pieces justificatives.

### 1.3 Ce que le module ne fait PAS

- **Pas de paie** : les heures CCQ servent uniquement de seuil de renouvellement, pas de base de calcul (voir Module 11 Employes).
- **Pas d API directe RBQ / CCQ** : pas d appel automatique au registre RBQ ni au portail CCQ employeur. Saisie manuelle (ou par verification IA).
- **Pas de declarations mensuelles CCQ** : le module **ne genere ni ne transmet** les rapports mensuels d heures travaillees. Utiliser le portail CCQ employeur officiel.
- **Pas de charges sociales CCQ** (vacances, jours feries, fonds de pension) : a gerer via Module Paie / Employes ou solution externe.
- **Pas de subventions / formations financees** : voir Module 18 Subventions.
- **Pas de calendrier iCal / Google Calendar** : alertes visibles uniquement dans le tableau de bord.
- **Pas de signature electronique** ni de workflow d approbation interne.

### 1.4 Acces

- Sidebar -> **Conformite RBQ/CCQ** (icone Shield).
- URL : `/conformite`.
- Onglet par defaut : **Licences RBQ**.
- 5 onglets principaux (cf. section 2).

### 1.5 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD les licences, cartes et attestations.
- **IA** : guardee par `_check_credits()` + `check_ai_guard()` — verifie le solde de credits prepayes IA avant chaque appel. Sans credits : HTTP 402 (Payment Required).
- Pas de roles dedies « responsable conformite » / « directeur RH ». Bonne pratique : convenir en interne d un responsable unique pour eviter les modifications concurrentes.

---

## 2. Interface (5 onglets)

Source : `ConformitePage.tsx:127-133` — tableau `tabs` avec compteurs dynamiques.

| # | Cle             | Label                       | Icone           | Contenu principal                                                |
|---|-----------------|-----------------------------|-----------------|------------------------------------------------------------------|
| 1 | `rbq`           | Licences RBQ (N)            | Shield          | CRUD licences + 26 sous-categories + filtres                     |
| 2 | `ccq`           | Cartes CCQ (N)              | UserCheck       | CRUD cartes + 28 metiers avec qualifications dynamiques          |
| 3 | `attestations`  | Attestations (N)            | FileText        | CRUD attestations + televersement PDF/image (5 types)            |
| 4 | `verifications` | Verifications               | CheckCircle2    | Assistant IA — exigences reglementaires d un projet              |
| 5 | `dashboard`     | Tableau de bord             | BarChart3       | KPI + score conformite + alertes + repartitions + ressources     |

L en-tete affiche un **badge global de score conformite** (vert >= 80%, jaune >= 50%, rouge < 50%) calcule par l endpoint `/conformite/statistics`.

### 2.1 Onglet « Licences RBQ »

Source : `ConformitePage.tsx:194-426` (composant `RbqTab` + modale `LicenceModal`).

**Tableau** :
- Numero de licence (texte, mono, unique sur le tenant)
- Nom de l entreprise titulaire de la licence
- Categories (badges, max 3 affichees + compteur `+N`)
- Cautionnement (formate fr-CA, en dollars)
- Date d expiration
- Statut (badge colore selon expiration et statut)
- Actions : Modifier / Supprimer

**Filtres** :
- Recherche texte (debounced 400 ms) sur `nom_entreprise` et `numero_licence` (ILIKE escape `\`).
- Statut (`ACTIVE` / `SUSPENDUE` / `EXPIREE` / `REVOQUEE`).
- Sous-categorie RBQ (1 parmi 26 codes).

**Modale Creation / Edition** :
- Numero de licence * (max 100 caracteres, unique en base)
- Nom de l entreprise * (max 255 caracteres)
- Selecteur **Categories RBQ** (checkbox multi, scrollable, code + label + groupe affiches)
- Date d emission, Date d expiration (Pydantic `date`, valide YYYY-MM-DD)
- Statut (defaut `ACTIVE`)
- **Cautionnement** (en $, plage 0 a 1 000 000 000)
- **Assurance responsabilite** (en $, plage 0 a 1 000 000 000)
- Notes (textarea, max 5000 caracteres)

**Validation cote backend** :
- `date_emission <= date_expiration` (sinon HTTP 422).
- Statut hors enum -> HTTP 400.
- Doublon numero -> HTTP 409 (conflit).

> **Astuce groupes** : les 26 sous-categories sont organisees en groupes logiques (Generale, Mecanique, Electricite, Genie civil, Structure, Enveloppe, Finition) — utiliser le label de groupe pour s assurer que la licence couvre tout le perimetre du chantier.

### 2.2 Onglet « Cartes CCQ »

Source : `ConformitePage.tsx:612-1056` (composant `CcqTab` + modale `CarteModal`).

**Tableau** :
- Employe (jointure `employees` si la table existe — sinon affiche `#employeeId`)
- Numero de carte (texte, mono, unique)
- Metier principal (1 parmi 28)
- Qualification (`Compagnon` / `Apprenti X periode` / `Classe N`)
- Heures totales travaillees
- ASP (badge si formation ASP Construction valide)
- Date de renouvellement
- Statut (badge colore)
- Actions : Modifier / Supprimer

**Filtres** :
- Recherche texte sur `numero_carte` et `metier_principal`.
- Statut (`ACTIVE` / `SUSPENDUE` / `EXPIREE`).
- Metier (1 parmi 28).

**Modale Creation / Edition** :
- ID Employe * (FK vers `employees.id` — valide existence si la table employees existe). **Verrouille en edition**.
- Numero de carte * (max 100 caracteres, unique)
- Metier principal (selecteur dynamique 28 metiers)
- Qualification (selecteur dynamique selon metier — auto-selection `qualifications[0]` au changement de metier)
- **Metiers additionnels** (checkbox multi, exclut le metier principal)
- Heures totales (entier, plage 0 a 1 000 000)
- Date d emission, Date de renouvellement
- **ASP Construction** (boolean — formation sante-securite obligatoire pour entrer sur un chantier)
- Statut (defaut `ACTIVE`)
- Notes

**Qualifications dynamiques** (METIERS_CCQ) :
- Plupart des metiers : `Compagnon` (1 niveau).
- Apprenti : `1re periode`, `2e periode`, `3e periode`, `4e periode`.
- Grutier : `Classe 1`, `Classe 2`, `Classe 3`, `Classe 4`.
- Operateur d equipement lourd : `Classe 1` a `Classe 4`.
- Soudeur : `Classe A`, `Classe B`, `Classe C`.
- Soudeur en tuyauterie : `Classe A`, `Classe B`.

> **Bonne pratique heures CCQ** : la CCQ exige des seuils d heures pour passer d apprenti a compagnon. Mettre a jour `heures_totales` aux dates cles (apres chaque pointage paie ou trimestre) pour anticiper les transitions de qualification.

### 2.3 Onglet « Attestations »

Source : `ConformitePage.tsx:1062-1483` (composant `AttestationsTab` + modales `AttestationModal` et `UploadAttestationModal`).

**Tableau** :
- Type (label depuis `TYPES_ATTESTATION` — ex. « Attestation de Revenu Quebec »)
- Numero (mono)
- Organisme delivreur (depuis `TYPES_ATTESTATION`)
- Date d expiration
- Statut (`VALIDE` / `EN_RENOUVELLEMENT` / `EXPIREE`)
- Fichier : si televerse -> bouton **Telecharger** avec taille (Ko) ; sinon bouton **Televerser**
- Actions : Modifier / Supprimer

**Filtres** :
- Recherche client-side (sur type, label, organisme, numero, notes).
- Statut.
- Type (5 types).

**5 types officiels** (TYPES_ATTESTATION) :

| Code           | Label                                                  | Organisme                              | Description                  |
|----------------|--------------------------------------------------------|----------------------------------------|------------------------------|
| `REVENU_QUEBEC`| Attestation de Revenu Quebec                          | Revenu Quebec                          | Conformite fiscale provinciale |
| `ARC`          | Attestation de l Agence du revenu du Canada            | ARC                                    | Conformite fiscale federale    |
| `CNESST`       | Attestation de conformite CNESST                       | CNESST                                 | Sante et securite au travail   |
| `CCQ`          | Attestation CCQ — Etat de situation                    | Commission de la construction du Quebec | Etat des cotisations          |
| `RBQ`          | Attestation de solvabilite RBQ                         | Regie du batiment du Quebec            | Solvabilite et cautionnement   |

**Modale Creation / Edition** :
- Type * (selecteur 5 valeurs)
- Numero * (max 100 caracteres — unicite en base sur la paire `(type, numero)`)
- Date d emission, Date d expiration
- Statut (defaut `VALIDE`)
- Notes

**Modale Televersement** :
- Types acceptes : **PDF, JPG, PNG, WebP**.
- Taille maximum : **10 Mo**.
- Le fichier est stocke dans la colonne BYTEA `fichier_data` ; nom sanitise (chars autorises : alpha-num, `._-()[] `).
- Re-validation MIME a la lecture (defense en profondeur — fichier servi en `application/octet-stream` si MIME hors whitelist).

**Validation backend** :
- Pas de fichier > 10 Mo (HTTP 413).
- MIME hors whitelist : HTTP 415.
- Doublon `(type, numero)` : HTTP 409.

> **Astuce televersement** : preferer toujours le PDF original (machine-readable) plutot qu une photo de l attestation pour faciliter la verification par un client ou un audit.

### 2.4 Onglet « Verifications » (Assistant IA)

Source : `ConformitePage.tsx:1489-1702` (composants `VerificationsTab` + `VerifyProjectResultPanel`).

Formulaire de verification d exigences pour un projet :

- **Type de projet** (selecteur 7 valeurs : `Residentiel unifamilial`, `Residentiel multifamilial`, `Commercial`, `Industriel`, `Institutionnel`, `Renovation majeure`, `Agrandissement`)
- **Valeur estimee** ($, entier ou decimal)
- **Region** (selecteur 18 valeurs : 17 regions administratives Quebec + Autre region)
- **Types de travaux** (checkbox multi parmi 12 : `Fondation`, `Charpente`, `Electricite`, `Plomberie`, `Chauffage/Ventilation`, `Toiture`, `Revetement exterieur`, `Finition interieure`, `Maconnerie`, `Structure metallique`, `Excavation`, `Piscine`)

Bouton **Verifier les exigences** -> appel `POST /conformite/ai/verify-project` (Claude Opus 4.7).

**Resultat affiche** (`AiVerifyProjectResult`) :
- **Licences RBQ requises** : liste avec categorie + description + obligatoire/recommande (badge rouge/jaune)
- **Metiers CCQ requis** : nom + nombre estime + qualification (compagnon/apprenti)
- **Permis requis** : type + organisme (municipal / provincial)
- **Attestations requises** : type + organisme + duree validite
- **Cautionnement minimum** ($)
- **Assurance responsabilite minimum** ($)
- **Ratio compagnon/apprenti** (ex. `1:1`, `2:1`)
- **Estimation delai conformite** (texte libre ex. « 4 semaines »)
- **Alertes** : non-conformites potentielles a surveiller

> **Important** : ce diagnostic IA est **indicatif**. Il s appuie sur le prompt systeme `AI_SYSTEM_PROMPT` (qui specifie de ne jamais inventer de numeros de loi). Toujours valider avec la RBQ ou un avocat specialise pour des cas complexes ou hors normes.

### 2.5 Onglet « Tableau de bord »

Source : `ConformitePage.tsx:1708-1897` (composant `DashboardTab`).

**Section KPIs** (4 cartes pastels) :
- Licences RBQ actives (avec sous-trend `N total`)
- Cartes CCQ actives (avec sous-trend `N total`)
- Attestations valides (avec sous-trend `N total`)
- **Score conformite** (couleur : vert >= 80, jaune >= 50, rouge < 50)

**Section alertes** (3 cartes) :
- A renouveler dans 60 jours (somme licences + cartes + attestations)
- Expires (somme)
- Cautionnement total ($)

**Score conformite — Calcul** (cf. `_calculate_score_conformite`) :
- Demarre a 100.
- `-10` par licence expiree.
- `-5` par carte CCQ expiree.
- `-8` par attestation expiree.
- Floor a 0, ceil a 100.
- Si aucune donnee enregistree : score = 0.

**Section liste d alertes** (max 30) generee par `GET /conformite/alertes` :
- LICENCE_EXPIREE (HAUTE)
- LICENCE_EXPIRE_BIENTOT (MOYENNE) — fenetre 60 jours
- CARTE_EXPIREE (HAUTE)
- CARTE_EXPIRE_BIENTOT (MOYENNE) — fenetre 60 jours
- ATTESTATION_EXPIREE (HAUTE)
- ATTESTATION_EXPIRE_BIENTOT (MOYENNE) — fenetre 30 jours

Chaque alerte a un message formate (ex. « Licence RBQ 5734-1234-01 (XYZ Construction) expire le 2026-08-15 »).

**Section repartitions** (3 cartes Top 10) :
- Repartition des licences RBQ par categorie (unnest JSONB du tableau `categories`)
- Repartition des cartes CCQ par metier principal
- Repartition des attestations par type

**Section ressources** :
- **Organismes de reference** (Top 6 sur 8) : nom, role, contact telephonique, lien.
- **Conseils pratiques** (6 sections) : titres + 3 premiers items chacun.

---

## 3. Workflows pas-a-pas

### 3.1 Enregistrer une licence RBQ existante

1. Onglet **Licences RBQ** -> bouton **Nouvelle licence**.
2. Saisir le numero de licence officiel (format type RBQ : `XXXX-XXXX-XX`).
3. Saisir le nom de l entreprise titulaire (peut differer du nom commercial du tenant si filiale).
4. Cocher toutes les **sous-categories** couvertes par la licence (ex. `1.1` + `15.5` + `15.6` pour residentiel + ventilation + climatisation).
5. Renseigner :
   - Date d emission (date originale d obtention).
   - Date d expiration (date a partir de laquelle elle deviendra invalide si non renouvelee — typiquement annuelle).
   - Statut `ACTIVE`.
   - Cautionnement : montant en $ (la RBQ exige un cautionnement variable selon la categorie ; voir verifications/IA si inconnu).
   - Assurance responsabilite : montant ($).
6. **Enregistrer**.

### 3.2 Renouveler une licence avant expiration

1. Tableau de bord -> verifier les **alertes LICENCE_EXPIRE_BIENTOT** (fenetre 60 jours).
2. Apres reception du certificat de renouvellement RBQ : ouvrir la licence concernee.
3. Mettre a jour `date_expiration` (nouvelle date) et `statut = ACTIVE` si l ancien statut etait `EN_RENOUVELLEMENT` ou `EXPIREE`.
4. Mettre a jour `cautionnement` si la RBQ a augmente le seuil exige.
5. Enregistrer.
6. Le score conformite remonte automatiquement (pas besoin d action).

### 3.3 Suspendre / revoquer une licence

1. En cas de notification RBQ (ex. suite a une infraction grave) : ouvrir la licence.
2. Changer `statut` :
   - `SUSPENDUE` : suspension temporaire (ex. retard de cotisation) -> badge jaune.
   - `REVOQUEE` : revocation definitive -> badge gris fonce.
3. Renseigner les details dans `notes` (numero de dossier RBQ, motif).
4. Enregistrer.

### 3.4 Creer une carte CCQ pour un nouvel employe

1. Au prealable : creer la fiche employe dans **Module 9 Employes** (la table `employees` doit exister et l ID est obligatoire).
2. Onglet **Cartes CCQ** -> bouton **Nouvelle carte**.
3. Saisir l **ID Employe** (verifie en base si la table `employees` existe — sinon HTTP 404).
4. Saisir le **numero de carte** officiel CCQ.
5. Selectionner le **metier principal** (28 metiers) — la liste de qualifications se met a jour dynamiquement.
6. Selectionner la **qualification** (Compagnon par defaut, ou Classe N, ou Apprenti X periode).
7. Cocher des **metiers additionnels** si l employe est qualifie sur plusieurs metiers (exclusion automatique du metier principal).
8. Renseigner les heures totales (cumul depuis le debut de carriere CCQ).
9. Saisir date d emission + date de renouvellement.
10. Cocher **ASP Construction valide** si la formation sante-securite est a jour.
11. **Enregistrer**.

> **Note** : l ID Employe est **non modifiable** apres creation (`disabled={isEdit}`). Pour reattribuer une carte a un autre employe : supprimer + recreer.

### 3.5 Mettre a jour les heures CCQ d un travailleur

Apres chaque trimestre (ou frequence interne RH) :

1. Recuperer le total cumule des heures CCQ du travailleur depuis le portail employeur CCQ ou la paie (Module 9).
2. Onglet **Cartes CCQ** -> ouvrir la carte du travailleur.
3. Mettre a jour `heures_totales`.
4. Si le seuil de passage d apprenti a compagnon est atteint : changer `qualification` (ex. `4e periode` -> `Compagnon`).
5. Enregistrer.

### 3.6 Renouveler une carte CCQ

1. Avant expiration : verifier le tableau de bord (alertes CARTE_EXPIRE_BIENTOT).
2. Ouvrir la carte concernee.
3. Mettre a jour `date_renouvellement` (apres reception de la nouvelle carte CCQ).
4. Statut `ACTIVE` si necessaire.
5. Enregistrer.

### 3.7 Creer une nouvelle attestation (sans televersement immediat)

1. Onglet **Attestations** -> bouton **Nouvelle attestation**.
2. Selectionner le **type** (Revenu Quebec, ARC, CNESST, CCQ, RBQ).
3. Saisir le **numero** d attestation (format propre a chaque organisme).
4. Renseigner la date d emission + date d expiration (typiquement 6 mois pour RQ/ARC, 90 jours pour CCQ etat de situation, etc.).
5. Statut `VALIDE` par defaut.
6. **Enregistrer**.

### 3.8 Televerser le PDF d une attestation

1. Onglet **Attestations** -> sur la ligne sans fichier : bouton **Televerser** (ou bouton avec icone Upload).
2. Selectionner un fichier **PDF / JPG / PNG / WebP** (max 10 Mo).
3. **Televerser** -> backend valide MIME + taille puis stocke en BYTEA.
4. La ligne affiche desormais **Telecharger** + taille (Ko).

> **Bonne pratique** : televerser le PDF original recu par courriel (et non une photo) — le PDF inclut la signature numerique et est requis pour les soumissions d appels d offres publics.

### 3.9 Telecharger une attestation deja televersee

1. Onglet **Attestations** -> bouton **Telecharger** (icone Download).
2. Le fichier est servi avec `Content-Disposition: attachment` (telechargement force) + nom sanitise (RFC 5987 + fallback ASCII).

### 3.10 Verifier les exigences reglementaires d un projet (IA)

1. Onglet **Verifications**.
2. Selectionner : type de projet, valeur, region, types de travaux (au moins 1, max 30).
3. Bouton **Verifier les exigences** -> appel IA Claude Opus 4.7.
4. Resultat `AiVerifyProjectResult` : licences RBQ requises (par categorie + obligatoire/recommandee), metiers CCQ requis (nombre estime + qualification), permis requis, attestations requises, cautionnement minimum, assurance responsabilite minimum, ratio compagnon/apprenti, inspections prevues, estimation delai, alertes.
5. Comparer avec les licences/cartes existantes pour identifier les **gaps conformite** avant de soumissionner.

### 3.11 Autres operations IA (endpoints exposes par le store)

| Endpoint                                | Action                                                                                | Reponse                                                                              |
|-----------------------------------------|---------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `POST /ai/analyze`                      | Analyse globale conformite + score + risques + recommandations                       | Score 0-100, niveau risque, points conformes, non-conformites, recommandations       |
| `POST /ai/chat`                         | Chat conversationnel expert (avec contexte tenant optionnel)                         | Texte libre francais quebecois                                                       |
| `POST /ai/search-regulations`           | Recherche reglementation Quebec (query libre)                                        | Interpretation, resultats (titre + source + reference + resume + lien officiel)      |
| `POST /ai/predict-renewals`             | Calendrier de renouvellements 12 mois                                                | Calendrier mois par mois, urgences, cout annuel, budget mensuel, risques             |
| `POST /ai/generate-rapport`             | Rapport conformite professionnel structure                                           | Titre, resume executif, conformite RBQ + CCQ, plan d action, conclusion              |
| `POST /ai/recommend-formations`         | Recommandations de formations equipe (avec projetsPrevus optionnels)                | Analyse competences, formations, certifications, plan trimestriel, budget, ROI       |

> **Securite IA** : input utilisateur encadre en balises XML (`<user_question>`, `<project_details>`, `<search_query>`) — defense contre injection prompt. URLs sanitisees serveur — seuls schemas `http://` / `https://` conserves.

---

## 4. Reference

### 4.1 Statuts par entite (verbatim STATUTS_*)

| Entite                 | Codes (verbatim)                                              | Couleurs hex                            |
|------------------------|---------------------------------------------------------------|-----------------------------------------|
| Licence RBQ            | `ACTIVE`, `SUSPENDUE`, `EXPIREE`, `REVOQUEE`                  | Vert / Jaune / Rouge / Gris fonce       |
| Carte CCQ              | `ACTIVE`, `SUSPENDUE`, `EXPIREE`                              | Vert / Jaune / Rouge                    |
| Attestation            | `VALIDE`, `EN_RENOUVELLEMENT`, `EXPIREE`                      | Vert / Jaune / Rouge                    |
| Niveau de risque (IA)  | `FAIBLE`, `MOYEN`, `ELEVE`, `CRITIQUE`                        | Vert / Jaune / Orange / Rouge           |
| Priorite (alerte/recommandation) | `HAUTE`, `MOYENNE`, `BASSE`                          | Rouge / Jaune / Vert                    |
| Gravite non-conformite | `MINEURE`, `MAJEURE`, `CRITIQUE`                              | Jaune / Orange / Rouge                  |

### 4.2 Categories RBQ (26 sous-categories officielles)

Source : `CATEGORIES_RBQ` dans `conformite_data.py`. Liste regroupee par groupe :

- **Generale** : `1.1` Batiments residentiels neufs classe I, `1.2` Batiments residentiels neufs classe II, `1.3` Petits batiments, `16` Entrepreneur general.
- **Mecanique** : `2` Chauffage a air chaud, `3` Plomberie, `15.1` Chauffage a eau chaude, `15.2` Chauffage a vapeur, `15.3` Bruleurs au mazout, `15.4` Bruleurs au gaz, `15.5` Ventilation, `15.6` Climatisation, `15.7` Refrigeration, `15.8` Protection-incendie.
- **Electricite** : `4` Electricite.
- **Genie civil** : `5.1` Excavation et terrassement, `5.2` Fondations profondes.
- **Structure** : `6` Charpente et menuiserie, `11.1` Structures de beton, `11.2` Beton prefabrique, `12` Armature et ferraillage, `13` Structures metalliques et elements prefabriques, `14` Maconnerie.
- **Enveloppe** : `7` Revetements exterieurs, `9` Toitures, `10` Isolation, etancheite, couvertures et revetements metalliques.
- **Finition** : `8` Systemes interieurs.

### 4.3 Metiers CCQ (28 metiers avec qualifications)

Source : `METIERS_CCQ` dans `conformite_data.py`.

**Metiers a qualification unique** `Compagnon` : Briqueteur-macon, Calorifugeur, Carreleur, Charpentier-menuisier, Chaudronnier, Cimentier-applicateur, Couvreur, Electricien, Ferblantier, Ferrailleur, Frigoriste, Mecanicien d ascenseur, Mecanicien de chantier, Mecanicien en protection-incendie, Monteur-assembleur, Monteur-mecanicien (vitrier), Operateur de pelles mecaniques, Peintre, Platrier, Plombier, Poseur de revetements souples, Poseur de systemes interieurs, Tuyauteur (23 metiers).

**Metiers a qualifications multiples** :

| Metier                          | Qualifications disponibles                                |
|---------------------------------|-----------------------------------------------------------|
| Apprenti                        | 1re periode, 2e periode, 3e periode, 4e periode           |
| Grutier                         | Classe 1, Classe 2, Classe 3, Classe 4                    |
| Operateur d equipement lourd    | Classe 1, Classe 2, Classe 3, Classe 4                    |
| Soudeur                         | Classe A, Classe B, Classe C                              |
| Soudeur en tuyauterie           | Classe A, Classe B                                        |

### 4.4 Types d attestations (5)

| Code            | Label                                                  | Organisme delivreur                    |
|-----------------|--------------------------------------------------------|----------------------------------------|
| `REVENU_QUEBEC` | Attestation de Revenu Quebec                          | Revenu Quebec                          |
| `ARC`           | Attestation de l ARC                                   | Agence du revenu du Canada             |
| `CNESST`        | Attestation de conformite CNESST                       | CNESST                                 |
| `CCQ`           | Attestation CCQ — Etat de situation                    | CCQ                                    |
| `RBQ`           | Attestation de solvabilite RBQ                         | RBQ                                    |

### 4.5 Types de projet (verifications IA)

`Residentiel unifamilial`, `Residentiel multifamilial`, `Commercial`, `Industriel`, `Institutionnel`, `Renovation majeure`, `Agrandissement`.

### 4.6 Regions du Quebec (verifications IA)

17 regions administratives + `Autre region` :
Bas-Saint-Laurent, Saguenay-Lac-Saint-Jean, Capitale-Nationale, Mauricie, Estrie, Montreal, Outaouais, Abitibi-Temiscamingue, Cote-Nord, Nord-du-Quebec, Gaspesie-Iles-de-la-Madeleine, Chaudiere-Appalaches, Laval, Lanaudiere, Laurentides, Monteregie, Centre-du-Quebec, Autre region.

### 4.7 Types de travaux (verifications IA, 12)

`Fondation`, `Charpente`, `Electricite`, `Plomberie`, `Chauffage/Ventilation`, `Toiture`, `Revetement exterieur`, `Finition interieure`, `Maconnerie`, `Structure metallique`, `Excavation`, `Piscine`.

### 4.8 Types de projet pour recommandations de formations (5)

`Residentiel`, `Commercial`, `Industriel`, `Institutionnel`, `Infrastructure`.

### 4.9 Endpoints API (REST, prefixe `/conformite`)

**Metadata** :
- `GET /conformite/constants` — Constantes (statuts, categories, metiers, types).
- `GET /conformite/resources` — Organismes + conseils pratiques.

**Licences RBQ** :
- `GET /conformite/licences` — Liste filtrable (statut, categorie, search).
- `GET /conformite/licences/expiring?days=60` — Licences expirant dans N jours.
- `GET /conformite/licences/{id}` — Detail.
- `POST /conformite/licences` — Creation.
- `PUT /conformite/licences/{id}` — Mise a jour.
- `DELETE /conformite/licences/{id}` — Suppression.

**Cartes CCQ** :
- `GET /conformite/cartes` — Liste filtrable (statut, metier, search) + jointure employes.
- `GET /conformite/cartes/expiring?days=60` — Cartes expirant dans N jours.
- `GET /conformite/cartes/{id}` — Detail.
- `POST /conformite/cartes` — Creation (FK `employee_id` validee).
- `PUT /conformite/cartes/{id}` — Mise a jour.
- `DELETE /conformite/cartes/{id}` — Suppression.

**Attestations** :
- `GET /conformite/attestations` — Liste filtrable (statut, type).
- `GET /conformite/attestations/expiring?days=30` — Attestations expirant dans N jours.
- `GET /conformite/attestations/{id}` — Detail.
- `POST /conformite/attestations` — Creation.
- `PUT /conformite/attestations/{id}` — Mise a jour.
- `DELETE /conformite/attestations/{id}` — Suppression.
- `POST /conformite/attestations/{id}/upload` — Televersement PDF/image (max 10 Mo).
- `GET /conformite/attestations/{id}/download` — Telechargement piece jointe.

**Statistics & Alertes** :
- `GET /conformite/statistics` — KPIs + score + repartitions.
- `GET /conformite/alertes` — Liste consolidee des alertes (expirees + a renouveler).

**IA (7 endpoints, Claude Opus 4.7)** :
- `POST /conformite/ai/analyze` — Analyse globale conformite + score + recommandations.
- `POST /conformite/ai/chat` — Chat conversationnel expert.
- `POST /conformite/ai/verify-project` — Exigences reglementaires d un projet.
- `POST /conformite/ai/search-regulations` — Recherche reglementation Quebec.
- `POST /conformite/ai/predict-renewals` — Calendrier de renouvellements 12 mois.
- `POST /conformite/ai/generate-rapport` — Rapport professionnel JSON structure.
- `POST /conformite/ai/recommend-formations` — Recommandations formations equipe.

### 4.10 Tables PostgreSQL (schema tenant)

| Table                       | Role                                                                       |
|-----------------------------|----------------------------------------------------------------------------|
| `conformite_licences_rbq`   | Licences RBQ. `numero_licence` UNIQUE, `categories` JSONB.                 |
| `conformite_cartes_ccq`     | Cartes CCQ. `numero_carte` UNIQUE, `metiers_additionnels` JSONB, FK `employee_id`. |
| `conformite_attestations`   | Attestations. UNIQUE sur `(type, numero)`. `fichier_data` BYTEA pour PDF/images. |

**Index** (auto-crees) :
- `idx_conf_licences_expiration` sur `date_expiration`.
- `idx_conf_licences_statut` sur `statut`.
- `idx_conf_cartes_renouvellement` sur `date_renouvellement`.
- `idx_conf_cartes_employee` sur `employee_id`.
- `idx_conf_attestations_expiration` sur `date_expiration`.
- `idx_conf_attestations_type` sur `type`.

### 4.11 Validations & limites

| Regle / Limite                                        | Effet HTTP                                |
|-------------------------------------------------------|-------------------------------------------|
| `numero_licence` deja utilise                         | 409 Conflict                              |
| `numero_carte` deja utilise                           | 409 Conflict                              |
| `(type, numero)` attestation deja utilise             | 409 Conflict                              |
| `date_emission > date_expiration`                     | 422 Unprocessable Entity                  |
| `cautionnement` ou `assurance` < 0 ou > 1 000 000 000 | 422                                       |
| `heures_totales` < 0 ou > 1 000 000                   | 422                                       |
| Statut hors enum                                      | 400 Bad Request                           |
| Type d attestation hors enum                          | 400                                       |
| Employe inexistant (carte CCQ)                        | 404 Not Found                             |
| Fichier upload > 10 Mo                                | 413 Payload Too Large                     |
| MIME hors PDF/JPG/PNG/WebP                            | 415 Unsupported Media Type                |
| Notes > 5000 caracteres                               | 422                                       |
| Item dans `categories` > 200 chars OU > 30 items      | 422                                       |
| Search > 200 chars                                    | 422                                       |
| IA sans credits prepayes                              | 402 Payment Required                      |
| IA Claude surcharge / overload                        | 503 Service Unavailable                   |
| IA reponse vide / JSON malforme                       | 502 Bad Gateway                           |

### 4.12 Score conformite — Bareme

| Etat                                          | Impact sur score |
|-----------------------------------------------|------------------|
| Aucune donnee                                 | 0                |
| Etat de depart (avec donnees)                 | 100              |
| Par licence RBQ expiree                       | -10              |
| Par carte CCQ expiree                         | -5               |
| Par attestation expiree                       | -8               |
| Floor                                         | 0                |
| Ceil                                          | 100              |

Affichage couleur :
- **Vert** : score >= 80%
- **Jaune** : 50% <= score < 80%
- **Rouge** : score < 50%

### 4.13 Fenetres d alerte

| Type alerte                           | Fenetre  | Priorite  |
|---------------------------------------|----------|-----------|
| LICENCE_EXPIREE                       | passe    | HAUTE     |
| LICENCE_EXPIRE_BIENTOT                | 60 jours | MOYENNE   |
| CARTE_EXPIREE                         | passe    | HAUTE     |
| CARTE_EXPIRE_BIENTOT                  | 60 jours | MOYENNE   |
| ATTESTATION_EXPIREE                   | passe    | HAUTE     |
| ATTESTATION_EXPIRE_BIENTOT            | 30 jours | MOYENNE   |

### 4.14 Couts IA (modele tarification)

- Modele : `claude-opus-4-7` (var `CONF_AI_MODEL`).
- `CONF_PRICING_INPUT` : 0.015 / 1000 tokens (input).
- `CONF_PRICING_OUTPUT` : 0.075 / 1000 tokens (output).
- `CONF_PRICING_MARKUP` : 1.30 (markup 30%).
- `CONF_AI_MAX_TOKENS` : 30 000 par appel.
- Cout debite via `_deduct_credits()` apres validation reussie de la reponse (les appels IA echouants ou JSON malformes **ne sont pas factures**).

---

## 5. Integrations & FAQ

### 5.1 Integration Module 9 Employes

- Table `employees` consultee pour valider l existence d un employe a la creation d une carte CCQ ; la jointure affiche le nom complet (`prenom + ' ' + nom`) dans le tableau.
- Si la table n existe pas (tenant tres recent) : jointure omise, le tableau affiche `#employeeId`.
- **Pas de synchronisation auto** : si un employe est supprime, sa carte CCQ reste avec `employee_nom = ''`. Bonne pratique : supprimer la carte en parallele.

### 5.2 Integration Module 1 Projets / Module 19 Immobilier

- **Aucune integration directe** : les licences RBQ ne sont pas verifiees automatiquement avant la creation d un projet.
- L onglet **Verifications** est utilise **manuellement** avant de soumettre une offre.
- Les conformites de phases construction (CNB / CCE / CSST / Municipal) du Module 19 sont des booleans separes — sans lien avec les licences RBQ stockees ici.

### 5.3 Integration Comptabilite et Subventions

- **Pas d ecriture journal** automatique. Les cautionnements et assurances sont informatifs (pas des passifs/actifs comptables). Comptabilisation manuelle dans Module 7.
- Les recommandations de formations IA peuvent suggerer des formations subventionnees (CCQ, ASP) sans lien automatique vers Module 18.

### 5.4 Integration IA / Credits

- 7 endpoints IA passent par `_check_credits()` (credits prepayes tenant, table `tenant_settings`).
- Cout suivi dans la table `ai_usage` avec `feature` = `conformite_analyze`, `conformite_chat`, `conformite_verify_project`, `conformite_search_reg`, `conformite_predict_renewals`, `conformite_generate_rapport`, `conformite_recommend_formations`.
- Securite : input encadre en balises XML, URLs sanitisees serveur (uniquement `http://` / `https://`).

### 5.5 Calendrier et multi-tenant

- **Pas d export iCal / Google Calendar**. Recommandation : consulter le tableau de bord ou ajouter au Calendrier ERP (`/calendar`).
- Toutes les tables sont dans le schema PostgreSQL du tenant (`SET search_path`). Pas de fuite cross-tenant.
- Pas de sous-roles dedies (« responsable conformite ») : tous les utilisateurs authentifies ont les memes droits CRUD.

### 5.8 FAQ

**Q : Quelle est la difference entre la RBQ et la CCQ ?**
R : La **RBQ** delivre les licences aux **entreprises** entrepreneures (numero par entite morale). La **CCQ** delivre les cartes de competence aux **travailleurs individuels** (regime R-20). Une entreprise a une licence RBQ ; chaque ouvrier a sa carte CCQ.

**Q : Que se passe-t-il si ma licence RBQ expire ?**
R : Vous ne pouvez plus executer ni facturer de travaux dans la sous-categorie correspondante. Le score chute de 10 points. La RBQ peut imposer des amendes en cas de travaux executes sans licence active.

**Q : Comment savoir si mon entreprise doit detenir un cautionnement ?**
R : La RBQ exige un cautionnement variable selon la sous-categorie (typiquement 5 000 $ a 40 000 $). Utiliser **Verifications IA** pour obtenir le `cautionnement_minimum` recommande, puis valider avec la RBQ.

**Q : Le module gere-t-il les declarations mensuelles d heures CCQ ?**
R : **NON**. Le champ `heures_totales` est cumulatif et **manuel**, pas un journal mensuel. Pour les declarations, utiliser le portail employeur CCQ officiel ou un logiciel de paie integre.

**Q : Comment renouveler les cartes CCQ par lot ?**
R : Pas de renouvellement par lot dans l UI. Utiliser l API (`PUT /conformite/cartes/{id}`) via un script, ou filtrer par `cartes/expiring?days=60` et traiter une par une.

**Q : Que se passe-t-il si je televerse un fichier de plus de 10 Mo ?**
R : HTTP 413. Compresser le PDF ou photographier l attestation en JPG basse resolution. Pas de compression automatique.

**Q : Les attestations CCQ et RBQ sont-elles distinctes des licences ?**
R : **OUI**. La **licence RBQ** (onglet 1) est l autorisation d exercer. L **attestation de solvabilite RBQ** (type `RBQ` onglet 3) est un document court (~90 jours) prouvant la solvabilite courante, exige pour soumissionner. De meme, la **carte CCQ** = competence du travailleur ; l **attestation CCQ Etat de situation** = etat des cotisations de l entreprise.

**Q : Le module valide-t-il mes numeros de licence aupres du registre RBQ public ?**
R : **NON**. Aucun appel API au registre RBQ. Saisie entierement manuelle. Pour verifier officiellement, utiliser `rbq.gouv.qc.ca`.

**Q : Y a-t-il un audit log des modifications ?**
R : Le module conserve `created_at` et `updated_at` mais **pas d audit log detaille** (qui a modifie quoi). Utiliser le champ `notes` pour journaliser les changements importants.

**Q : Le score de conformite tient-il compte des suspensions ?**
R : Le bareme penalise uniquement les **expirations** (-10/-5/-8). Les suspensions (`SUSPENDUE`) ne retirent pas explicitement de points mais sont comptees hors « actives » dans les KPIs.

**Q : Les credits IA sont-ils consommes si la reponse Claude est mauvaise ?**
R : **NON**. La deduction `_deduct_credits` intervient apres validation reussie. Une reponse vide, malformee ou avec erreur **ne facture rien**.

**Q : Y a-t-il une fonction d export Excel ou CSV ?**
R : **Pas dans cette implementation**. Utiliser l API (`GET /conformite/licences`, `/cartes`, `/attestations`) puis convertir cote client.

**Q : Comment partager le rapport de conformite IA avec un auditeur ?**
R : `/ai/generate-rapport` retourne du JSON. Cote client, formater en PDF (jsPDF) ou copier-coller dans Word/Google Docs.

**Q : Plusieurs licences RBQ pour une meme entreprise (corporative + filiales) ?**
R : **OUI**. Pas de limite hard. Chaque ligne `conformite_licences_rbq` est independante.

**Q : Le module IA garantit-il la conformite legale ?**
R : **NON**. Le prompt systeme precise « N invente jamais de numeros de loi. Prefere 'a verifier' plutot que fabriquer une reference. » Pour des cas critiques, consulter un avocat specialise et la RBQ.

**Q : Les pieces jointes sont-elles servies de maniere securisee ?**
R : **OUI**. Download utilise RFC 5987 + fallback ASCII. Caracteres dangereux remplaces par `_`. MIME re-valide ; un MIME hors whitelist est servi en `application/octet-stream`.

**Q : Peut-on associer une attestation a une licence ou un projet specifique ?**
R : **NON dans cette implementation**. Les attestations sont globales au tenant. Utiliser `notes` ou Module 8 Dossiers pour indexation.

**Q : Que faire en cas d audit RBQ ou CNESST ?**
R : 1) Telecharger toutes les attestations via l onglet. 2) Generer un rapport IA via `/ai/generate-rapport`. 3) Exporter les donnees via API. 4) Conserver au moins 6 ans (delai legal Quebec).

---

## 6. Recap one-pager

- **Module focus** : conformite reglementaire Quebec construction (RBQ + CCQ + attestations fiscales/sectorielles).
- **5 onglets** : Licences RBQ / Cartes CCQ / Attestations / Verifications IA / Tableau de bord.
- **3 entites** : licences RBQ (26 sous-categories), cartes CCQ (28 metiers a qualifications dynamiques), attestations (5 types avec PDF/image jusqu a 10 Mo).
- **Statuts** : licence (ACTIVE/SUSPENDUE/EXPIREE/REVOQUEE), carte CCQ (ACTIVE/SUSPENDUE/EXPIREE), attestation (VALIDE/EN_RENOUVELLEMENT/EXPIREE).
- **5 types attestation** : Revenu Quebec, ARC, CNESST, CCQ, RBQ.
- **Score conformite** : 0-100. -10 par licence expiree, -5 par carte, -8 par attestation.
- **Alertes auto** : 60 jours licences/cartes, 30 jours attestations.
- **7 endpoints IA Claude Opus 4.7** : analyze / chat / verify-project / search-regulations / predict-renewals / generate-rapport / recommend-formations (markup 30%, max 30k tokens).
- **8 organismes** references : RBQ, CCQ, CNESST, Revenu Quebec, ARC, ASP Construction, Ombudsman, CMEQ.
- **Pieces jointes** : BYTEA en DB, PDF/JPG/PNG/WebP, max 10 Mo, MIME et nom sanitises.
- **Limites** : pas de paie ni cotisations CCQ auto, pas d API directe RBQ/CCQ, pas de declarations mensuelles, pas d ecritures comptables auto, pas de calendrier iCal.
- **Multi-licences** par tenant : OUI.
- **Securite IA** : input encadre en XML, URLs sanitisees, credits non factures si reponse invalide.
- **Verrouillage** : `employee_id` d une carte CCQ non modifiable apres creation.

---

**Documentation generee a partir du code** :
- `backend/routers/conformite.py` (2247 lignes, 7 endpoints IA)
- `backend/routers/conformite_data.py` (donnees RBQ/CCQ/attestations)
- `frontend/src/pages/ConformitePage.tsx` (5 onglets, ~1900 lignes)
- `frontend/src/api/conformite.ts` (interfaces TypeScript)
- `frontend/src/store/useConformiteStore.ts` (Zustand store)

**Manuels lies** :
- Module 11 (Employes — pour creer la fiche employe avant la carte CCQ) — `09-employes.md`
- Module 19 (Immobilier — conformites de phases construction CNB/CCE/CSST/Municipal distinctes) — `11-immobilier.md`
- Module 25 (IA — credits IA et configuration globale) — `12-ia.md`
- Module 28 (Administration — gestion tenant et `check_ai_guard`) — `14-administration.md`
- Module 18 (Subventions — programmes de subvention salariale CCQ et formations financees) — `21-subventions.md`
