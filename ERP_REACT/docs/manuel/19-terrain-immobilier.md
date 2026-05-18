# Module 19 — Immobilier (Promotion / Developpement)

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/immobilier.py` (5248 lignes, 59 endpoints), `frontend/src/pages/ImmobilierPage.tsx` (13 onglets), `frontend/src/api/immobilier.ts`
> **Tables PostgreSQL** : `terrains`, `projets_immo`, `financements`, `unites`, `phases_construction`, `inspections_immo`, `paiements_immo`, `deblocages`, `commercialisation`, `livraisons`, `documents_immo`, plus le sous-module `fonds_prevoyance` (Loi 16)
> **Cadrage** : ce module est **focus promotion immobiliere et developpement** (terrains -> projets -> unites -> ventes/locations) — PAS un gestionnaire locatif complet (PMP). Il gere des unites individuelles avec champs locataires basiques mais sans table tenants dediee, sans cycle de bail formel, sans portail locataire.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (13 onglets)](#2-interface-13-onglets)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Gerer le cycle complet de **promotion immobiliere** :
- Acquisition de **terrains** (prospection, offres, etudes, achat)
- Developpement de **projets immobiliers** (Condos / Locatif / Mixte / Commercial / Maisons)
- Structuration du **financement** (Hypothecaire / Construction / Pont / Marge de credit) avec generation automatique des deblocages
- Suivi des **phases de construction** avec conformites (CNB / CCE / CSST / Municipal) et deficiences (mineures / majeures / critiques)
- Gestion des **unites** individuelles (Condo / Appartement / Commerce / Maison / Penthouse — 7 sous-types residentiels)
- Strategie de **commercialisation** (pre-vente, courtier, marketing, brochures, maquette 3D)
- **Livraison** finale aux acheteurs / locataires avec inspection pre-livraison + garantie + satisfaction
- **Inspections** (planifiee / en cours / reussie / echouee / a reprendre) avec score conformite
- **Paiements** projet (entrees / sorties)
- **6 calculateurs financiers** (mensualite, amortissement, interets intercalaires, prime SCHL, ROI, cout total)
- **4 endpoints IA Claude** : analyser projet, generer rapport financement, optimiser financement, chat
- **Fonds prevoyance Loi 16** (sous-module pour copropriete)

### 1.2 Ce que le module ne fait PAS

> **Important** : c est un module **promotion / developpement**, pas un module **gestion locative complete**. Il **n implemente pas** :
- Table `tenants` dediee (locataire = champ `locataire_nom` simple sur l unite, pas de fiche complete)
- Cycle bail formel (`leases` table) — seulement `date_debut_bail` + `duree_bail_mois`
- **Indexation annuelle** automatique des loyers
- **Generation automatique mensuelle** des paiements de loyer
- **Relances** / dunning sur paiements en retard
- **Demandes de maintenance** locataire (pas de portail locataire)
- **Portail web public** d annonces (pas d integration Centris)
- **Multi-proprietaires** par projet (proprietaire = texte libre, pas FK)
- **Cap Rate, DSCR, Cash-on-cash** (seulement ROI simple)
- **Posting comptable automatique** des loyers/charges
- **iCal / Google Calendar** sync sur expirations baux

Pour ces fonctionnalites, considerer un module externe ou une evolution future.

### 1.3 Acces

- Sidebar -> **Immobilier** (icone Building2)
- URL : `/immobilier`
- Onglet par defaut : **Tableau de bord**
- 13 onglets (cf. section 2)

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD toutes les entites Immobilier.
- **IA** : guardee par `_check_credits()` — verifier solde credits prepayes avant chaque appel.
- Pas de roles dedies « directeur immobilier », « courtier », « inspecteur ».

---

## 2. Interface (13 onglets)

Source : `ImmobilierPage.tsx:37-51` — array `TABS`.

| # | Cle              | Label                | Icone        | Contenu principal                                              |
|---|------------------|----------------------|--------------|----------------------------------------------------------------|
| 1 | `dashboard`      | Tableau de bord      | BarChart3       | KPI module + calculateur mensualite rapide                  |
| 2 | `terrains`       | Terrains             | MapPin       | CRUD terrains (prospection -> acquis)                          |
| 3 | `projets`        | Projets              | Building     | CRUD projets de developpement (5 types)                        |
| 4 | `financement`    | Financement          | Landmark     | CRUD financements bancaires (4 types pret)                     |
| 5 | `construction`   | Construction         | HardHat      | CRUD phases construction avec conformites + deficiences        |
| 6 | `unites`         | Unites               | Home         | CRUD unites (5 types principaux + 8 sous-types)                |
| 7 | `commercialisation` | Commercialisation | Megaphone    | Strategie pre-vente / location, courtier, marketing            |
| 8 | `livraison`      | Livraison            | Key          | Livraison aux beneficiaires + garantie                         |
| 9 | `inspections`    | Inspections          | ClipboardCheck | Inspections multi-types avec score conformite                |
| 10| `paiements`      | Paiements            | CreditCard   | Mouvements financiers projet                                   |
| 11| `documents`      | Documents            | FolderOpen   | Documents projet (10 categories)                               |
| 12| `calculateurs`   | Calculateurs         | Calculator   | 6 sous-onglets calcul                                          |
| 13| `fonds_prevoyance` | Fonds Prev. (Loi 16) | Shield     | Sous-module copropriete                                        |

### 2.1 Onglet « Tableau de bord »

KPIs (cf. `GET /immobilier/dashboard`) :
- Total terrains + repartition par statut
- Total projets + repartition par statut
- Total financement demande / approuve
- Total unites + ventes / disponibles / louees
- ROI estime moyen (projets en developpement)

Calculateur mensualite rapide integre (formulaire inline : capital + taux + duree).

### 2.2 Onglet « Terrains »

Tableau CRUD :
- Adresse, ville, code postal, numero lot, numero cadastre
- Superficie m2 / pi2
- Zonage (`Residentiel` / `Commercial` / `Mixte` / `Industriel`)
- Prix demande, evaluation municipale
- Proprietaire (nom + contact texte libre)
- Statut (`Prospection` / `Offre en cours` / `Acquis` / `En developpement` / `Rejete`)
- Score faisabilite (1-100)

Modale creation : tous les champs incluant servitudes, contraintes environnementales, certificat localisation, etude sol, permis preliminaire.

Filtres : recherche + statut.

### 2.3 Onglet « Projets »

Tableau CRUD :
- Nom projet, type (`Condos` / `Locatif` / `Mixte` / `Commercial` / `Maisons`)
- Nombre logements
- Budget total, cout terrain, cout construction
- Revenus ventes estimes
- ROI estime %
- Date debut/fin planifiees
- Statut (`Planification` / `En cours` / `Construction` / `Termine` / `Annule`)
- Lien terrain (FK terrain_id)

Vue detail : enrichi avec `unitesCount` (compteur d unites associees).

### 2.4 Onglet « Financement »

Tableau CRUD :
- Banque (texte libre)
- Type pret (`Hypothecaire` / `Construction` / `Pont` / `Marge de credit`)
- Montant demande, montant approuve
- Taux interet annuel
- Duree amortissement (mois)
- Frequence remboursement (Mensuel / Bi-mensuel / etc.)
- Date debut, date fin
- Statut (`En preparation` / `Demande en cours` / `Approuve` / `Refuse`)
- Garanties exigees (texte libre)

Lie a un projet via `projet_id`.

### 2.5 Onglet « Construction » (Phases)

Tableau CRUD avec **suivi conformite riche** :
- Numero phase, nom phase, sequence
- Statut (`A venir` / `En cours` / `En retard` / `Completee` / `Suspendue`)
- Pourcentage completion
- Budget prevu / cout reel + variance auto
- Entrepreneur, supervisor (nom)
- Dates debut / fin reelles
- **Conformite** : 4 booleans (`conforme_cnb` / `conforme_cce` / `conforme_csst` / `conforme_municipal`)
- **Deficiences** : 3 compteurs (mineures / majeures / critiques)

Templates de phases standards : `GET /phases/types` retourne une liste de phases-types par type de projet.

### 2.6 Onglet « Unites »

Tableau CRUD :
- Numero unite, etage, orientation
- Type unite (`Condo` / `Appartement` / `Commerce` / `Maison` / `Penthouse`)
- Sous-type (`Studio` / `3 1/2` / `4 1/2` / `5 1/2` / `6 1/2` / `Penthouse` / `Local commercial` / `Bureau`)
- Superficie m2 / pi2
- Nombre chambres, nombre salles de bain
- Equipements, finitions speciales (texte libre)
- **Pricing** : prix vente OU loyer mensuel (selon vocation)
- Statut (`Disponible` / `Vendu` / `Loue`)
- Acheteur : nom + contact + date promesse + date vente finale (si vendu)
- Locataire : nom + date debut bail + duree bail mois (si loue)

> **Vocation mixte** : une unite peut avoir prix_vente ET loyer_mensuel renseignes (changement de vocation possible).

### 2.7 Onglet « Commercialisation »

Tableau CRUD strategie de vente / location par projet :
- Strategie vente (`Pre-vente`, etc.)
- Prix moyen vente / loyer moyen
- Objectif pre-ventes % / Taux pre-ventes actuel %
- Nombre unites vendues / louees
- Budget marketing
- Courtier nom + commission %
- **Assets pretes** : booleans `brochure_prete` / `plans_vente_prets` / `maquette_3d`
- Site web (URL externe)

### 2.8 Onglet « Livraison »

Tableau CRUD livraison aux beneficiaires :
- Numero livraison
- Unite (FK unite_id)
- Beneficiaire : nom + type (`acheteur` ou `locataire`)
- Date livraison prevue / reelle
- **Inspection pre-livraison** (texte libre rapport) + liste deficiences (texte)
- **Booleans documents** : `cles_remises` / `acte_vente_signe` / `bail_signe` / `certificat_conformite`
- Duree garantie (mois)
- Note satisfaction (1-10)

### 2.9 Onglet « Inspections »

Tableau CRUD inspections (constructions, normes) :
- Type inspection (texte libre)
- Date planifiee / date realisee
- Inspecteur nom
- Statut (`Planifiee` / `En cours` / `Reussie` / `Echouee` / `A reprendre`)
- **Score conformite** (numerique)
- **Deficiences** : 3 compteurs (mineures / majeures / critiques)
- Corrections requises (texte) + date limite corrections
- Reinspection reussie (boolean)
- **Conformite** : 4 booleans (CNB / CCE / CSST / Municipal)
- **Couts** : cout inspection + cout corrections

### 2.10 Onglet « Paiements »

Tableau CRUD paiements (entrees/sorties projet) :
- Type paiement (`construction`, `financement`, etc. — texte libre)
- Categorie (texte libre)
- Montant
- Description, beneficiaire
- Date paiement
- Statut (`Prevu` defaut, `Recu`, `En retard`, etc.)

> Distinct des `payroll_entries` (Module 9) et `factures` (Module 7). Vue projet uniquement.

### 2.11 Onglet « Documents »

Tableau CRUD documents projet :
- Nom document, categorie (10 valeurs : `Contrats` / `Permis` / `Plans et dessins` / `Etudes techniques` / `Financement` / `Assurances` / `Correspondance` / `Rapports inspection` / `Photos` / `Autre`)
- Type fichier (PDF, image, etc.)
- Chemin fichier (URI/path)
- Taille KB
- Confidentiel (boolean)
- Date document, date expiration (utile permis)
- Filtre par categorie + recherche

> **Pas d upload integre** dans cette implementation : champ `chemin_fichier` est une reference texte. Pour upload de fichiers, utiliser plutot Module 8 Dossiers (attachments BYTEA).

### 2.12 Onglet « Calculateurs »

6 sous-onglets, chacun avec son formulaire de calcul :

| Sous-onglet              | Inputs                                                         | Outputs                                                  |
|--------------------------|----------------------------------------------------------------|----------------------------------------------------------|
| **Mensualite**           | Capital, taux annuel, duree (annees)                           | Mensualite, total cout, total interets                  |
| **Amortissement**        | Capital, taux, duree                                           | Tableau periode/paiement/capital/interets/solde         |
| **Interets intercalaires** | Montant emprunte, taux, duree construction (mois)            | Total interets, breakdown mensuel                        |
| **Prime SCHL**           | Montant pret, valeur propriete                                 | Ratio LTV, prime %, prime montant, total pret           |
| **ROI**                  | Investissement, revenus annuels, depenses annuelles, duree    | ROI %, benefice net annuel, payback period              |
| **Cout total**           | Capital, taux, duree                                           | Decomposition complete (capital + interets cumules)     |

Tous les calculs cote backend (`POST /immobilier/calculer-...`) - aucune dependance JS lourde cote client.

### 2.13 Onglet « Fonds Prevoyance (Loi 16) »

Sous-module separe (`FondsPrevoyanceTab` importe). Gere les fonds de prevoyance obligatoires pour copropriete au Quebec selon Loi 16 (etude du fonds, contributions, decisions).

Pour les details, voir le composant `FondsPrevoyanceTab` (probablement un onglet a part dans `fonds_prevoyance.py` router).

---

## 3. Workflows pas-a-pas

### 3.1 Acquerir un terrain (workflow complet)

1. Onglet **Terrains** -> bouton **+ Nouveau terrain**.
2. Saisir adresse, ville, lot/cadastre, superficie, zonage.
3. Statut initial : `Prospection`.
4. Renseigner **Score faisabilite** (1-100) apres analyse preliminaire.
5. Quand offre formulee : passer statut a `Offre en cours`, renseigner `prix_offre`.
6. Quand achat conclu : passer statut a `Acquis`, renseigner `prix_final`, dates, certificat localisation, etude sol.
7. Quand projet de developpement demarre : passer statut a `En developpement`.
8. Si refus : statut `Rejete` (conserve historique).

### 3.2 Creer un projet de developpement

1. Onglet **Projets** -> bouton **+ Nouveau projet**.
2. Saisir nom, type (`Condos` / `Locatif` / `Mixte` / `Commercial` / `Maisons`), nombre logements.
3. Selectionner le terrain associe (FK terrain_id).
4. Renseigner budgets (cout terrain, cout construction, total).
5. Estimer revenus ventes + ROI %.
6. Definir dates debut/fin planifiees.
7. Statut initial `Planification`.

### 3.3 Structurer le financement

1. Onglet **Financement** -> bouton **+ Nouveau financement**.
2. Selectionner projet (FK projet_id).
3. Saisir banque (texte libre), type pret (`Hypothecaire` / `Construction` / `Pont` / `Marge de credit`).
4. Renseigner montant demande, taux interet annuel, duree amortissement.
5. Statut `En preparation` -> `Demande en cours` -> `Approuve` ou `Refuse`.
6. Apres approbation : renseigner montant approuve, date debut.

### 3.4 Generer automatiquement les deblocages

1. Apres financement `Approuve` -> bouton **Generer deblocages auto**.
2. `POST /immobilier/deblocages/generer-auto?financementId=X`.
3. Backend genere une serie de deblocages selon le `montantTotal` approuve, repartis sur la duree de construction.
4. Chaque deblocage est cree avec statut `Planifie`, montant, date prevue.
5. Suivre l avancement de chaque deblocage individuellement.

### 3.5 Planifier les phases de construction

1. Onglet **Construction** -> bouton **+ Nouvelle phase**.
2. Pour pre-remplir avec les phases types : `GET /phases/types` -> templates par type de projet.
3. Saisir : numero phase, nom, sequence, dates planifiees, budget prevu, entrepreneur, supervisor.
4. Statut initial `A venir`.
5. Au demarrage : passer a `En cours`, mettre a jour `pourcentage_completion` regulierement.
6. Inscrire les **deficiences** detectees (mineures / majeures / critiques) au fur et a mesure.
7. Cocher les **conformites** (CNB / CCE / CSST / Municipal) une fois validees.
8. A la fin : statut `Completee`, renseigner `cout_reel` (variance vs `budget_prevu`).

### 3.6 Creer les unites du projet

1. Onglet **Unites** -> bouton **+ Nouvelle unite**.
2. Selectionner projet.
3. Renseigner numero unite, etage, type, sous-type, superficie.
4. Si vente : renseigner `prix_vente`. Si location : `loyer_mensuel`. Si mixte : les deux.
5. Statut initial `Disponible`.
6. Apres vente : statut `Vendu` + acheteur + dates.
7. Apres location : statut `Loue` + locataire + date debut bail + duree mois.

### 3.7 Definir la strategie de commercialisation

1. Onglet **Commercialisation** -> bouton **+ Nouvelle commercialisation**.
2. Selectionner projet.
3. Saisir strategie (ex. `Pre-vente`), prix moyen vente, loyer moyen.
4. Definir objectif pre-ventes % (ex. 50% pour declenchement construction selon banque).
5. Renseigner courtier nom + commission %.
6. Cocher assets pretes (brochure / plans vente / maquette 3D) au fil de l avancement.
7. Au fil des ventes : mettre a jour `taux_pre_ventes_actuel_pct` + `nombre_unites_vendues`.

### 3.8 Inspecter une phase / une unite

1. Onglet **Inspections** -> bouton **+ Nouvelle inspection**.
2. Saisir type inspection, date planifiee, inspecteur.
3. Statut `Planifiee`.
4. Le jour J : passer a `En cours`, renseigner observations.
5. Apres inspection : statut `Reussie` ou `Echouee` ou `A reprendre`.
6. Si deficiences : compter mineures / majeures / critiques + saisir corrections requises + date limite.
7. Cocher les 4 conformites (CNB / CCE / CSST / Municipal).
8. Saisir score conformite (numerique).
9. Renseigner couts (inspection + corrections).
10. Si reinspection necessaire : creer une nouvelle inspection lien (a verifier en prod).

### 3.9 Livrer une unite a un acheteur / locataire

1. Onglet **Livraison** -> bouton **+ Nouvelle livraison**.
2. Selectionner unite (FK unite_id).
3. Saisir beneficiaire nom + type (`acheteur` ou `locataire`).
4. Date livraison prevue.
5. Avant livraison : effectuer **inspection pre-livraison** (texte libre rapport).
6. Lister les **deficiences** detectees a corriger avant remise des cles.
7. Au moment de la livraison : cocher booleans (`cles_remises`, `acte_vente_signe` ou `bail_signe`, `certificat_conformite`).
8. Renseigner duree garantie (mois) — typiquement 12 mois pour vices apparents, 36 mois vices caches.
9. Apres satisfaction client : noter (1-10).

### 3.10 Utiliser les calculateurs financiers

#### Mensualite

1. Onglet Calculateurs -> sous-onglet **Mensualite**.
2. Saisir : capital, taux annuel %, duree (annees).
3. **Calculer** -> `POST /immobilier/calculer-mensualite`.
4. Affiche : mensualite, cout total, total interets.

#### Amortissement

1. Sous-onglet **Amortissement** -> meme inputs.
2. `POST /immobilier/calculer-amortissement`.
3. Affiche tableau : periode, paiement, part capital, part interets, solde restant.

#### Interets intercalaires

1. Sous-onglet **Interets intercalaires**.
2. Saisir : montant emprunte, taux annuel, duree construction (mois).
3. `POST /immobilier/calculer-interets-intercalaires`.
4. Affiche : interets intercalaires totaux + breakdown mensuel.
5. Important pour budget construction (interets a capitaliser pendant les travaux).

#### Prime SCHL / CMHC

1. Sous-onglet **Prime SCHL**.
2. Saisir : montant pret, valeur propriete.
3. `POST /immobilier/calculer-prime-schl`.
4. Affiche : ratio LTV, prime %, prime montant, total pret.
5. Si LTV > 80% : prime SCHL/CMHC obligatoire au Canada.

#### ROI

1. Sous-onglet **ROI**.
2. Saisir : investissement total, revenus annuels, depenses annuelles, duree.
3. `POST /immobilier/calculer-roi`.
4. Affiche : ROI %, benefice net annuel, periode payback.

#### Cout total

1. Sous-onglet **Cout total** -> capital + taux + duree.
2. `POST /immobilier/calculer-cout-total`.

### 3.11 Analyser un projet avec IA

1. Onglet Projets -> selectionner projet -> bouton **Analyser IA**.
2. `POST /immobilier/ia/analyser-projet` avec `projet_id`.
3. Backend (verifie credits IA disponibles) :
   - Recupere donnees projet + financement + commercialisation.
   - Appelle Claude Sonnet 4.6.
   - Retourne JSON : score faisabilite (1-10), risques, opportunites, recommandations.
4. Affiche dans modale.

### 3.12 Generer rapport financement IA

1. Onglet Financement -> bouton **Generer rapport IA**.
2. `POST /immobilier/ia/rapport-financement` avec `financement_id`.
3. Backend genere un **rapport markdown** complet (executive summary, structure, deblocages, ratios, risques).
4. Telechargeable / exportable.

### 3.13 Optimiser la structure de financement IA

1. Onglet Financement -> bouton **Optimiser IA**.
2. `POST /immobilier/ia/optimiser-financement` avec contexte projet.
3. Claude propose des recommandations de structuration.

### 3.14 Chat IA contextuel

1. Disponible globalement dans le module Immobilier.
2. `POST /immobilier/ia/chat` avec question + contexte.
3. Reponse Claude basee sur les donnees Immobilier du tenant.

---

## 4. Reference

### 4.1 Statuts par entite

| Entite       | Statuts (verbatim)                                                                |
|--------------|-----------------------------------------------------------------------------------|
| Terrain      | `Prospection`, `Offre en cours`, `Acquis`, `En developpement`, `Rejete`           |
| Projet       | `Planification`, `En cours`, `Construction`, `Termine`, `Annule`                  |
| Unite        | `Disponible`, `Vendu`, `Loue`                                                     |
| Financement  | `En preparation`, `Demande en cours`, `Approuve`, `Refuse`                        |
| Phase        | `A venir`, `En cours`, `En retard`, `Completee`, `Suspendue`                      |
| Deblocage    | `Planifie`, `En cours`, `Approuve`, `Debloque`                                    |
| Inspection   | `Planifiee`, `En cours`, `Reussie`, `Echouee`, `A reprendre`                      |

### 4.2 Types

| Champ              | Valeurs                                                          |
|--------------------|------------------------------------------------------------------|
| Zonage terrain     | `Residentiel`, `Commercial`, `Mixte`, `Industriel`               |
| Type projet        | `Condos`, `Locatif`, `Mixte`, `Commercial`, `Maisons`            |
| Type pret          | `Hypothecaire`, `Construction`, `Pont`, `Marge de credit`        |
| Type unite         | `Condo`, `Appartement`, `Commerce`, `Maison`, `Penthouse`        |
| Sous-type unite    | `Studio`, `3 1/2`, `4 1/2`, `5 1/2`, `6 1/2`, `Penthouse`, `Local commercial`, `Bureau` |
| Type beneficiaire  | `acheteur`, `locataire` (livraison)                              |
| Categorie document | 10 valeurs (cf. section 2.11)                                    |

### 4.3 Conformites construction (4 booleans)

- `conforme_cnb` : Code National du Batiment
- `conforme_cce` : Code de Construction du Quebec
- `conforme_csst` : Commission de la sante et securite au travail (legacy CSST, devenu CNESST)
- `conforme_municipal` : Reglements municipaux locaux

### 4.4 Deficiences (3 niveaux)

- **Mineures** : esthetique, finition, ajustements rapides
- **Majeures** : fonctionnel mais non conforme au plan, necessite reprise
- **Critiques** : securite, structure, code — reprise obligatoire avant continuation

### 4.5 Calculs financiers (formules)

| Calcul                  | Formule                                                                 |
|-------------------------|-------------------------------------------------------------------------|
| **Mensualite**          | `M = P * r * (1+r)^n / ((1+r)^n - 1)` ou r = taux mensuel, n = nb mois  |
| **Total cout**          | `M * n` (cout total des paiements)                                      |
| **Total interets**      | `(M * n) - P` (cout - capital)                                          |
| **Interets intercalaires** | Cumul des interets simples mensuels pendant duree construction       |
| **Prime SCHL**          | Selon table CMHC : LTV 80-85% = 2.8%, 85-90% = 3.1%, 90-95% = 4.0%      |
| **ROI %**               | `((revenus - depenses) / investissement) * 100`                         |
| **Payback (annees)**    | `investissement / benefice_net_annuel`                                  |

### 4.6 Endpoints principaux

**Liste exhaustive : 59 endpoints**, regroupes par entite. Voici les principaux :

| Entite          | Endpoints CRUD                                                                |
|-----------------|-------------------------------------------------------------------------------|
| Dashboard       | `GET /immobilier/dashboard`                                                   |
| Terrains        | `GET POST /terrains`, `GET PUT DELETE /terrains/{id}`                         |
| Projets         | `GET POST /projets`, `GET PUT DELETE /projets/{id}`                           |
| Financements    | `GET POST /financements`, `GET PUT DELETE /financements/{id}`                 |
| Unites          | `GET POST /unites`, `PUT DELETE /unites/{id}`                                 |
| Inspections     | `GET POST /inspections`, `PUT /inspections/{id}`                              |
| Paiements       | `GET POST /paiements`                                                         |
| Deblocages      | `GET POST PUT DELETE /deblocages[/{id}]`, `POST /deblocages/generer-auto`     |
| Phases          | `GET POST PUT DELETE /phases[/{id}]`, `GET /phases/types`                     |
| Commercialisation | `GET POST PUT DELETE /commercialisation[/{id}]`                             |
| Livraisons      | `GET POST PUT DELETE /livraisons[/{id}]`                                      |
| Documents       | `GET POST DELETE /documents[/{id}]`                                           |
| Calculateurs    | 6 endpoints `POST /calculer-{mensualite,amortissement,interets-intercalaires,prime-schl,roi,cout-total}` |
| IA              | 4 endpoints `POST /ia/{analyser-projet,chat,rapport-financement,optimiser-financement}` |

### 4.7 Tables PostgreSQL

| Table                 | Role                                                       |
|-----------------------|------------------------------------------------------------|
| `terrains`            | Terrains (prospection -> developpement)                    |
| `projets_immo`        | Projets de developpement                                   |
| `financements`        | Financements bancaires                                     |
| `unites`              | Unites individuelles (vente OU location)                   |
| `phases_construction` | Phases avec conformites + deficiences                      |
| `deblocages`          | Deblocages financement (auto-generables)                   |
| `inspections_immo`    | Inspections multi-types                                    |
| `paiements_immo`      | Paiements projet                                           |
| `commercialisation`   | Strategie pre-vente                                        |
| `livraisons`          | Livraisons aux beneficiaires                               |
| `documents_immo`      | Documents projet (references texte, pas BYTEA)             |

### 4.8 Validations & limites

| Regle                                  | Effet                                                  |
|----------------------------------------|--------------------------------------------------------|
| `adresse` terrain vide                 | HTTP 400                                               |
| Statut hors enum (entite donnee)       | HTTP 400 ou DB CHECK                                   |
| Suppression terrain avec projet associe | (verifier en prod — cascade ou refus)                 |
| Calcul ROI avec depenses > revenus     | ROI negatif retourne                                   |
| LTV > 95% pour prime SCHL              | Generalement refuse (regle CMHC)                       |
| IA appel sans credits                  | HTTP 402 (Payment Required)                            |

---

## 5. Integrations & FAQ

### 5.1 Integration CRM

> **Limitee** : le proprietaire de terrain est stocke comme **texte libre** (`proprietaire_nom` + `proprietaire_contact`), pas comme FK vers `companies`.

Pas de lookup automatique vers le CRM. Pour des analyses commerciales croisees, utiliser des recherches textuelles plutot que jointures.

### 5.2 Integration Comptabilite

- **Pas d ecriture journal automatique** depuis Immobilier vers Comptabilite.
- Les `paiements_immo` (table specifique au module) NE sont PAS reflectees dans `journal_entries`.
- Pour comptabiliser : creer manuellement les ecritures dans Module 7 (Comptabilite) ou utiliser un export CSV.

### 5.3 Integration Construction (Module Projets)

> **Pas de lien direct** entre `projets_immo` (Immobilier) et `projects` (Module 1 Projets).

Les phases construction d Immobilier (`phases_construction`) sont **distinctes** des phases projet (`project_phases` du Module 1). Pour suivre un meme chantier dans les deux modules, dupliquer les informations.

### 5.4 Integration Conformite

- Les conformites par phase (CNB / CCE / CSST / Municipal) sont des **booleans simples** sans lien vers les attestations CNESST/RBQ stockees dans le module Conformite (`conformite.py`).
- Pour une vue centralisee : consulter Conformite separement.

### 5.5 Integration Documents

- Les `documents_immo` sont des **references texte** (chemin_fichier URI/path).
- Pour upload de fichier reel : utiliser Module 8 (Dossiers) -> attachments BYTEA, puis referencer dans Immobilier via `chemin_fichier` = URL du dossier.

### 5.6 Integration IA / Credits

- 4 endpoints IA (`/ia/analyser-projet`, `/ia/chat`, `/ia/rapport-financement`, `/ia/optimiser-financement`).
- Tous **deduisent des credits** prepayes (`tenant_settings.ai_credits_balance_usd`).
- Tracking dans `ai_usage` table (feature = `immobilier_*`).
- Modele : `claude-sonnet-4-6` (vision + textes longs).

### 5.7 Integration Calendrier

- **Aucune integration** : pas d export iCal / Google Calendar.
- Pas de notifications automatiques sur date echeance financement, fin bail, date limite corrections, livraison prevue.
- Recommandation : suivi manuel via le tableau de bord ou ajouter manuellement au Calendrier (`/calendar`).

### 5.8 FAQ

**Q : Le module gere-t-il la location longue duree (PMP) ?**
R : **PARTIELLEMENT**. Les unites peuvent avoir un statut `Loue` avec `locataire_nom` + dates bail, mais il n y a **pas** de gestion complete de baux (renouvellement auto, indexation), pas de portail locataire, pas de generation automatique des paiements de loyer mensuels. Pour une gestion locative complete (PMP type Buildium / AppFolio), utiliser une solution externe.

**Q : Y a-t-il un portail web public pour les annonces ?**
R : **NON**. Aucune integration Centris (DuProprio/MLS), aucune page publique d annonces. Le champ `site_web` dans Commercialisation est juste une URL externe a renseigner manuellement.

**Q : Comment generer les paiements de loyer mensuels automatiquement ?**
R : **Pas implemente**. Saisir manuellement chaque mois dans l onglet Paiements. Alternative : exporter en CSV puis importer en lot via API.

**Q : Le module calcule-t-il automatiquement la rentabilite (Cap Rate, DSCR) ?**
R : **Partiellement**. Seul le **ROI** est calcule via le calculateur dedie. Pas de Cap Rate, pas de Debt Service Coverage Ratio (DSCR), pas de Cash-on-Cash Return. Calculs a faire manuellement avec les donnees disponibles.

**Q : Comment fonctionne la generation automatique des deblocages ?**
R : `POST /immobilier/deblocages/generer-auto?financementId=X` repartit le `montantTotal` du financement approuve sur des deblocages periodiques (mensuels par defaut, a verifier en prod). Statut initial `Planifie`, a passer a `En cours` puis `Approuve` puis `Debloque` au fil du temps.

**Q : Les conformites CNB / CCE / CSST / Municipal sont-elles validees automatiquement ?**
R : **NON**. Ce sont 4 simples checkbox manuelles a cocher par l utilisateur apres validation reelle (ex. apres reception du certificat conformite municipal).

**Q : Que se passe-t-il quand une phase a des deficiences critiques ?**
R : **Aucun blocage automatique**. Les compteurs `deficiences_critiques > 0` sont juste informatifs. La phase peut continuer en statut `En cours` meme avec critiques. Bonne pratique : suspendre manuellement (`statut = Suspendue`) jusqu a correction.

**Q : Les calculateurs financiers stockent-ils les resultats ?**
R : **NON**. Chaque appel calculateur est un POST sans persistance. Pour archiver un calcul (ex. amortissement), copier-coller les resultats dans les notes du financement ou les documents projet.

**Q : Comment gerer les vices caches apres livraison ?**
R : Le champ `duree_garantie_mois` informe la duree (typiquement 36 mois au Quebec pour vices caches). Pour suivre les reclamations : creer une nouvelle inspection (statut `A reprendre`) liee a l unite/projet.

**Q : Le rapport financement IA inclut-il des recommandations CMHC/SCHL ?**
R : Le rapport markdown couvre la structure du financement et les ratios. Si une prime SCHL est applicable (LTV > 80%), Claude la mentionne probablement, mais le calcul precis se fait via le calculateur dedie (`POST /calculer-prime-schl`).

**Q : Y a-t-il un workflow d approbation pour les deblocages ?**
R : **Pas de workflow formel** (pas de roles approuvateur). Chaque utilisateur peut passer manuellement le statut `Planifie` -> `En cours` -> `Approuve` -> `Debloque` via PUT.

**Q : Le module Loi 16 (Fonds Prevoyance) est-il integre ou separe ?**
R : Implemente comme un **sous-onglet** d Immobilier (`fonds_prevoyance`) mais utilise un router separe (`fonds_prevoyance.py`). Pour la documentation detaillee, voir le manuel Module 28 Administration ou la documentation specifique Loi 16.

**Q : Combien d unites maximum par projet ?**
R : Pas de limite hard-codee. Limite pratique : performance UI (la pagination peut etre adaptee si > 100 unites par projet).

**Q : Comment gerer les unites avec changement de vocation (vente -> location ou inverse) ?**
R : Modifier le statut + remplir/vider les champs correspondants (`acheteur_*` vs `locataire_*`). Aucun verrou DB n empeche d avoir les deux series remplies simultanement.

---

## 6. Recap one-pager

- **Module focus** : promotion / developpement immobilier (PAS gestion locative complete PMP).
- **13 onglets** : Tableau de bord, Terrains, Projets, Financement, Construction (Phases), Unites, Commercialisation, Livraison, Inspections, Paiements, Documents, Calculateurs (6 sous-onglets), Fonds Prevoyance (Loi 16).
- **59 endpoints** total.
- **5 statuts terrain** : Prospection -> Offre en cours -> Acquis -> En developpement -> Rejete.
- **5 statuts projet** : Planification -> En cours -> Construction -> Termine -> Annule.
- **5 statuts phase** : A venir -> En cours -> En retard -> Completee -> Suspendue.
- **5 statuts inspection** : Planifiee -> En cours -> Reussie / Echouee / A reprendre.
- **3 statuts unite** : Disponible / Vendu / Loue (vocation mixte possible).
- **4 conformites** par phase : CNB / CCE / CSST / Municipal (checkbox manuelles).
- **3 niveaux deficiences** : mineures / majeures / critiques (pas de blocage auto).
- **Generation auto deblocages** : POST /deblocages/generer-auto repartit le montant total.
- **6 calculateurs** : Mensualite / Amortissement / Interets intercalaires / Prime SCHL / ROI / Cout total.
- **4 endpoints IA** : analyser projet / chat / rapport financement / optimiser financement (Claude Sonnet 4.6, deduit credits).
- **Pas de PMP complet** : pas de portail locataire, pas d auto-paiements loyer, pas d indexation, pas de demandes maintenance.
- **Pas d integration Centris** ni portail web public d annonces.
- **Pas de Cap Rate / DSCR / Cash-on-Cash** (seulement ROI simple).
- **Pas d ecritures journal auto** vers Comptabilite.
- **Pas de lien** avec Module 1 Projets (entites distinctes).
- **Pas de calendrier auto** sur expirations baux / mortgages.

---

**Documentation generee a partir du code** : `immobilier.py` (5248 lignes), `ImmobilierPage.tsx` (13 onglets), `immobilier.ts`.

**Manuels lies** :
- Module 1 (Projets — distinct du suivi promotion) — `01-projets.md`
- Module 7 (Comptabilite — ecritures manuelles) — `07-factures.md`
- Module 8 (Dossiers — pour upload reel de fichiers) — `08-dossiers.md`
- Module 25 (IA — credits IA) — `12-ia.md`
- Module 28 (Administration — Loi 16 details) — `14-administration.md`
