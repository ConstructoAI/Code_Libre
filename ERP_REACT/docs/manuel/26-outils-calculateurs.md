# Module 26 — Calculateurs Construction

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/calculators.py` (3260 lignes, 50+ endpoints, prefix `/calculators`), `backend/routers/calculators_data.py` (786 lignes — tables de constantes, normes, prix), `frontend/src/pages/CalculateursPage.tsx` (2050 lignes, 6 onglets), `frontend/src/api/calculators.ts`
> **Tables PostgreSQL** : `calculator_history` (auto-creee au premier appel — 1 seule table)
> **Cadrage** : module **suite d'outils de calcul professionnels** pour la construction au Quebec — 13 calculateurs verticaux + analyse structurale CNBC/CSA O86 + 6 endpoints IA Claude Opus 4.7 + historique persistant. **PAS** un BIM, **PAS** un logiciel CAO, **PAS** un dimensionnement complet de batiment ni un calcul de structure detaillee (Mr/Vr basique seulement, sans vis-a-vis Kt, Kh, Kzcg, Kzg complets).

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (6 onglets)](#2-interface-6-onglets)
3. [Workflows par calculateur](#3-workflows-par-calculateur)
4. [Reference (formules, normes, constantes)](#4-reference-formules-normes-constantes)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Fournir aux estimateurs, contremaitres, ingenieurs et entrepreneurs une suite de **calculateurs construction professionnels** valides pour le Quebec, couvrant les principaux corps de metier (structure, enveloppe, mecanique, metal) plus les calculs financiers (taxes, paie). Chaque calculateur :

- Encode les **formules normees** (CSA, CNBC, CCQ, CCE, CNP, ASHRAE, AWS, IIW, etc.).
- Retourne des **quantites de materiaux**, des **couts indicatifs CAD**, et des **verdicts de conformite** (`Conforme` / `Non conforme` / `Marge`).
- Sauvegarde optionnellement chaque calcul dans un **historique persistant par tenant** (table `calculator_history`).
- Peut etre **complete par 6 endpoints IA Claude Opus 4.7** (chat expert, analyser, recommander, expliquer norme, diagnostiquer, optimiser).

### 1.2 Inventaire des 13 calculateurs (5 categories)

Source : `CALCULATEURS_LISTE` dans `calculators_data.py:673-687` et `CALC_DEFS` dans `CalculateursPage.tsx:37-51`.

| # | Categorie | Id (URL) | Nom | Endpoints | Norme principale |
|---|-----------|----------|-----|-----------|------------------|
| 1 | Structure | `concrete` | Beton | `/concrete` + 6 sous-calculs | CSA A23.1 / ACI 209 / CNESST |
| 2 | Structure | `stairs` | Escaliers | `/stairs` + 2 sous-calculs | CCQ 9.8 / 3.4 / Blondel |
| 3 | Structure | `charge-tributaire-complete` | Analyse structurale | `/charge-tributaire-complete` | CNBC / CSA O86 |
| 4 | Enveloppe | `roofing` | Toiture | `/roofing` + 3 sous-calculs | CCQ 9.26 / CNBC 4.1.6 |
| 5 | Enveloppe | `painting` | Peinture | `/painting` + 2 sous-calculs | SSPC / NACE / Magnus |
| 6 | Mecanique | `electrical` | Electricite | `/electrical` + 3 sous-calculs | CCE Article 4-004 / 8-200 |
| 7 | Mecanique | `plumbing` | Plomberie | `/plumbing` + 3 sous-calculs | CNP / Hazen-Williams |
| 8 | Mecanique | `hvac` | CVAC | `/hvac` + 4 sous-calculs | ASHRAE 62.2 / 90.1 |
| 9 | Metal | `welding` | Soudure | `/welding` + 3 sous-calculs | CSA W47.1 / W59 / AWS D1.1 / IIW |
| 10| Metal | `bending` | Pliage metal | `/bending` + 2 sous-calculs | K-factor / Air bending |
| 11| Metal | `metal-weight` | Poids metal | `/metal-weight` | Densites + profiles AISC W/C |
| 12| Finances | `taxes` | Taxes Quebec | `/taxes` | TPS 5% + TVQ 9.975% |
| 13| Finances | `charge-tributaire` | Paie employe | `/charge-tributaire` | RRQ / RQAP / AE / CNESST / FSS / CCQ |

> **Total** : 13 calculateurs, **~38 endpoints de calcul** + 6 IA + history + constants + resources + conversions = **~50 endpoints** sous `/calculators`.

### 1.3 Acces

- Sidebar -> **Calculateurs** (icone Calculator)
- URL : `/calculateurs`
- Onglet par defaut : **Tableau de bord**
- 6 onglets globaux (cf. section 2)

### 1.4 Permissions

- Tous les utilisateurs authentifies du tenant peuvent lancer n importe quel calculateur (POST de calcul).
- L **historique** (`calculator_history`) est par tenant — tous les utilisateurs voient l historique de leur tenant.
- **IA Claude** : protege par double check (`_check_credits` + `check_ai_guard`) — voir `calculators.py:686-694`. Si pas de credits prepayes ou si IA desactivee pour le tenant, retour HTTP 402/403.
- Pas de roles dedies « ingenieur », « estimateur ».

#> **NOTE label vs runtime** : le label UI affiche « Claude Opus 4.6 » mais le code force `claude-opus-4-7` au runtime (`calculators.py:118`). Le manuel cite « 4.7 » pour refleter le code execute.

## 1.5 Modele IA et tarification

| Item | Valeur (verbatim depuis `calculators.py:118-122`) |
|------|---------------------------------------------------|
| Modele Claude | `claude-opus-4-7` |
| Max tokens reponse | 20 000 |
| Prix input | 0,015 USD / 1k tokens |
| Prix output | 0,075 USD / 1k tokens |
| Markup tenant | 1,30 (30% de marge) |

> **Nota** : le label « Claude Opus 4.6 » apparait dans le titre frontend et dans plusieurs commentaires, mais le code force `claude-opus-4-7` au runtime. La docstring du fichier indique aussi « 4.6 » par historique.

---

## 2. Interface (6 onglets)

Source : `CalculateursPage.tsx:640-653` — array d onglets globaux.

| # | Cle | Label | Icone | Contenu principal |
|---|-----|-------|-------|-------------------|
| 1 | `dashboard` | Tableau de bord | BarChart3 | KPIs (nb calculs, calculateurs utilises) + grilles par categorie |
| 2 | `calculateurs` | Calculateurs | Calculator | 13 panneaux de calcul (un par calculateur) |
| 3 | `structural` | Analyse structurale | Ruler | Calcul de poutre/linteau/colonne CNBC + diagramme SVG |
| 4 | `ia` | Assistant IA | Sparkles | 6 sous-onglets IA Claude (chat, analyze, recommend, norme, diagnose, optimize) |
| 5 | `historique` | Historique | History | Liste paginee des calculs sauves + stats |
| 6 | `conversions` | Conversions | PenTool | Tables de conversions construction (longueur, surface, volume, poids, pression, temperature) |

### 2.1 Onglet « Tableau de bord »

Source : `CalculateursPage.tsx:665-700`.

KPIs (4 cartes) :
- **Calculateurs** : 13 (constant)
- **Calculs sauves** : `historyStats.total` (depuis `GET /calculators/history/stats`)
- **Normes Quebec** : 10+ (constant)
- **IA Claude** : « 6 outils » (constant)

Puis grille par categorie (Structure, Enveloppe, Mecanique, Metal, Finances) — chaque carte ouvre l onglet `calculateurs` avec le calculateur preselectionne.

### 2.2 Onglet « Calculateurs »

Layout 1/4 + 3/4 :
- **Sidebar gauche** : liste des 13 calculateurs avec icone + nom + couleur de categorie.
- **Panneau droit** : panneau du calculateur selectionne (formulaire d entrees + carte de resultats). Chaque calculateur a ses propres **sous-onglets** (ex. Beton -> Volume / Dosage / Armature / Cure / Excavation / Talus / Escalier).

Tous les panneaux suivent le meme pattern :
- Carte gauche : `FieldRow` (label + Input/Select) -> bouton **Calculer** (avec spinner pendant `isLoading`).
- Carte droite (apparait apres calcul) : `ResultBox` highlights + grille 2 colonnes pour les autres metriques + commentaire/conformite.

### 2.3 Onglet « Analyse structurale »

Source : `CalculateursPage.tsx:1691-1789`. Endpoint `POST /calculators/charge-tributaire-complete`.

Inputs (10 champs) :
- `type_element` : `poutre` / `linteau` / `colonne`
- `type_materiau` : `bois_dimensionnel` (SPF No.2 par defaut) / `lvl` (2.0E LVL)
- `section` : ex. `2x10` (selecteur dynamique selon materiau, depuis `GET /calculators/charge-tributaire-complete/materials`)
- `ply_count` : 1 a 6
- `portee_mm` : 1 a 50 000
- `largeur_tributaire_m` : 0 a 50
- 3 charges en kPa : `charge_morte`, `charge_vive`, `charge_neige`
- `type_utilisation` : `plancher` (L/360) / `toit` (L/180) / `linteau` (L/360)

Outputs structurees :
- **Verdict** `CONFORME` / `NON CONFORME`
- **Diagramme SVG** auto-genere (poutre simplement appuyee, charge repartie, cotes)
- **Combinaisons CNBC** : 1.4D, 1.25D+1.5L, 1.25D+1.5S, 1.25D+1.5L+0.5S
- **Efforts** : Mmax (kNm), Vmax (kN), delta (mm)
- **Resistances CSA O86** : Mr, Vr, Kd, Kl
- **Verifications** : flexion / cisaillement / fleche avec ratio < 100 % et OK/KO

> **Limites simplifications** : Kd = Kl = 1.0 (pas de vis-a-vis duree de chargement, pas de coefficient de stabilite laterale). C est une analyse **preliminaire**, l ingenieur doit signer un calcul complet.

### 2.4 Onglet « Assistant IA »

Source : `CalculateursPage.tsx:1791-1950`. 6 endpoints IA :

| Sous-onglet | Endpoint | Inputs | Outputs |
|-------------|----------|--------|---------|
| **Chat** | `POST /calculators/ai/chat` | question + calculator_id (optionnel) | Reponse texte FR-QC, cite normes |
| **Analyser** | `POST /calculators/ai/analyze` | calculator_id + inputs + results | JSON : score 0-100, points forts, attention, normes citees, risques, optimisations |
| **Recommandations** | `POST /calculators/ai/recommend` | calculator_id + objectif + contraintes | JSON : approche, etapes, materiaux, normes, couts, alertes |
| **Expliquer norme** | `POST /calculators/ai/explain-norm` | norme + contexte | JSON : titre officiel, organisme, exigences, exemples, references |
| **Diagnostic** | `POST /calculators/ai/diagnose` | calculator_id + probleme + symptomes | JSON : diagnostic, causes, tests, solutions, urgence (`faible|moderee|elevee|critique`), `intervention_professionnelle` bool |
| **Optimiser** | `POST /calculators/ai/optimize` | calculator_id + inputs_actuels + objectif (`cout|performance|ecologique|delai`) | JSON : suggestions priorisees, economies, risques |

> **Garde-fou IA** : si pas de cle Anthropic (`ANTHROPIC_API_KEY` env), retour HTTP 503 « Service IA non disponible ». Si pas de credits ou si IA desactivee : 402/403.

### 2.5 Onglet « Historique »

Source : `CalculateursPage.tsx:1952-2028`. Endpoints `GET/POST/DELETE /calculators/history`.

Affichage :
- **3 KPI** : total calculs, calculateurs utilises distincts, calculs des 30 derniers jours.
- Filtre par calculateur (Select).
- Liste : icone + label + date + bouton **Details** (deplie inputs + results en JSON formate) + **Trash**.
- Bouton **Effacer tout** (confirmation).

> **Persistance** : la sauvegarde est **manuelle** — le frontend n appelle pas automatiquement `POST /history` apres chaque calcul. C est un pattern « calcul ephemere par defaut, conservation sur demande » via la fonction `saveToHistory(...)` dans le store (a verifier en prod si bouton « Sauvegarder » expose dans chaque panneau).

### 2.6 Onglet « Conversions »

Source : `CalculateursPage.tsx:2030-2050`. Endpoint `GET /calculators/conversions`.

Tables de conversion **affichage uniquement** (pas de saisie utilisateur) :
- **Longueur** : m <-> ft, in <-> mm, yd <-> m
- **Surface** : m2 <-> ft2, acre <-> m2, hectare <-> m2
- **Volume** : m3 <-> ft3, m3 <-> yd3, litre <-> gallon
- **Poids** : kg <-> lbs, tonne <-> lbs
- **Pression** : psi <-> kPa, bar <-> psi
- **Temperature** : formules Celsius/Fahrenheit (texte)
- **DMS** : description Degres-Minutes-Secondes

---

## 3. Workflows par calculateur

Pour chaque calculateur, ce qui suit documente : **inputs requis** (avec unites + plages Pydantic), **formules / normes**, **outputs cles**, **cas d usage typique**.

### 3.1 Beton (Building2)

Endpoint principal : `POST /calculators/concrete` + 6 sous-endpoints.
Source : `calculators.py:884-1144`.

#### 3.1.1 Volume + dosage rapide

**Inputs** (`ConcreteInput`) :
- `longueur` (m, 0 < x <= 1000)
- `largeur` (m, 0 < x <= 1000)
- `epaisseur` (m, 0 < x <= 10)
- `perte_pct` (%, defaut 10, 0-100)
- `classe_beton` (`C-1` interieur 20 MPa / `C-2` exterieur 25 MPa / `C-3` commercial 30 MPa / `C-4` structural 32 MPa / `F-1` fondations / `S-1` 35 MPa / `S-2` 40 MPa)

**Formule** : volume = L x l x e ; total = volume + perte ; quantites = total x dosage `25MPa` defaut. Coffrage = perimetre x epaisseur / 2,97 m2 (feuille 4x8).

**Outputs** : `volume_m3`, `surface_m2`, `ciment_kg`, `sable_kg`, `gravier_kg`, `eau_litres`, `sacs_30_kg`, `sacs_40_kg`, `feuilles_coffrage_4x8`.

**Cas d usage** : evaluer rapidement volume + sacs de ciment pour une dalle de garage 6 x 8 m.

#### 3.1.2 Dosage CSA A23.1

**Inputs** : `volume_m3`, `resistance_mpa` (Literal `15MPa` / `20MPa` / `25MPa` / `30MPa` / `32MPa` / `35MPa` / `40MPa`).

**Formule** : table `DOSAGES_BETON` (kg par m3) — multiplie par volume.

**Outputs** : ciment, sable, gravier, eau + ratio (ex. `1:2.0:3.14`) + ratio E/C (eau/ciment) + sacs 30 et 40 kg.

| Resistance | Ciment kg/m3 | Sable | Gravier | Eau L | E/C |
|------------|-------------:|------:|--------:|------:|----:|
| 15 MPa | 250 | 800 | 1100 | 175 | 0.65 |
| 20 MPa | 300 | 750 | 1100 | 180 | 0.60 |
| 25 MPa | 350 | 700 | 1100 | 175 | 0.50 |
| 30 MPa | 400 | 650 | 1100 | 170 | 0.43 |
| 32 MPa | 420 | 625 | 1100 | 165 | 0.40 |
| 35 MPa | 450 | 600 | 1100 | 160 | 0.36 |
| 40 MPa | 500 | 550 | 1100 | 155 | 0.31 |

#### 3.1.3 Armature CSA G30.18 (rebar)

**Inputs** : longueur_m, largeur_m, enrobage_mm (defaut 50, 15-200), espacement_mm (defaut 300, 50-600), barre_type (`10M` a `55M`), nb_lits (1-4), perte_pct.

**Formule** : grille 2 directions, barres / espacement effectif + 1 barre par cote ; longueur totale x masse_kg/m de la table `BARRES_ARMATURE`. Decoupe en barres standard 6 m.

**Outputs** : nb_barres_long / trans, longueur_totale_m, nb_barres_standard_6m, masse_totale_kg + lb.

| Barre | Diametre mm | Aire mm2 | Masse kg/m |
|-------|------------:|---------:|-----------:|
| 10M | 11.3 | 100 | 0.785 |
| 15M | 16.0 | 200 | 1.570 |
| 20M | 19.5 | 300 | 2.355 |
| 25M | 25.2 | 500 | 3.925 |
| 30M | 29.9 | 700 | 5.495 |
| 35M | 35.7 | 1000 | 7.850 |
| 45M | 43.7 | 1500 | 11.775 |
| 55M | 56.4 | 2500 | 19.625 |

#### 3.1.4 Cure ACI 209

**Inputs** : resistance_finale_mpa, age_jours, temperature_c (-30 a +50), ciment_type (`GU` / `HE` / `MS` / `HS`).

**Formule** : `f(t) = f28 * t_eff / (a + b * t_eff)` ou `t_eff = t * facteur_maturite` (1.0 si T >= 20, 0.8 si 10-20, 0.5 si < 10, 0 si < 0). Coefficients `ACI_209` : GU `a=4.0 b=0.85`, HE `a=2.3 b=0.92`.

**Outputs** : resistance_courante_mpa, pct_resistance_finale, facteur_maturite, age_effectif_jours, temps_cure_minimum_jours (3 si > 20 °C, 5 si 10-20, 7 si 5-10, 10 si 0-5).

#### 3.1.5 Excavation (foisonnement)

**Inputs** : longueur, largeur, profondeur (m), `type_sol` (`terre_ordinaire` 1.25 / `argile` 1.30 / `sable` 1.15 / `gravier` 1.12 / `roc` 1.50).

**Formule** : volume_compact x facteur foisonnement. Conversion yd3 (x 1.30795). Camion 12 yd3.

**Outputs** : volume_compact_m3, volume_foisonne_m3, volume_foisonne_yd3, nb_camions_12yd3, poids_estime_tonnes (= volume x 1.8 t/m3 typique).

#### 3.1.6 Talus securitaire CNESST

**Inputs** : profondeur_m, type_sol (`roc` 84° / `argile_dure` 45° / `argile_molle` 34° / `sable` 34° / `sol_meuble` 27°).

**Formule** : distance_horizontale = h x ratio_h_v.

**Outputs** : ratio H:V, angle, distance, **exigences CNESST automatiques** :
- `h > 1.2` : Inspection quotidienne par personne qualifiee.
- `h > 3` : Analyse par ingenieur recommandee.
- `h > 6` : Analyse par ingenieur OBLIGATOIRE.
- `h < 1.2` : pas de pente particuliere.

#### 3.1.7 Escalier beton (Blondel)

**Inputs** : hauteur_totale_mm, largeur_m, epaisseur_dalle_mm, giron_cible_mm (200-400, defaut 280), hauteur_marche_cible_mm (100-250, defaut 175).

**Formule** : nb_marches = round(h_totale / h_marche_cible). Blondel = `2R + G`. Conforme si `580 <= 2R+G <= 660` (BLONDEL_MIN/MAX). Volume = marches (triangles) + dalle inclinee, x 1.10 (perte).

**Outputs** : nb_marches, hauteur_marche_mm, giron_mm, blondel_2r_g, blondel_conforme bool, volume_total_m3, ciment_kg / sable_kg / gravier_kg / eau_litres (dosage 30 MPa).

### 3.2 Escaliers (Layers)

Endpoint principal : `POST /calculators/stairs` + 2 sous-endpoints.
Source : `calculators.py:1150-1303`.

#### 3.2.1 Dimensions CCQ 9.8 / 3.4

**Inputs** : hauteur_totale (mm), giron_cible (200-400, defaut 260), hauteur_marche_cible (100-250, defaut 180), `usage` (`residentiel` / `commercial`), largeur_m.

**Criteres CCQ** (`ESCALIERS_CCQ`) :

| Critere | Residentiel CCQ 9.8 | Commercial CCQ 3.4 |
|---------|--------------------:|-------------------:|
| Contremarche min/max | 125 / 200 mm | 125 / 180 mm |
| Contremarche optimale | 175 mm | 170 mm |
| Giron min/max | 235 / 355 mm | 280 / 355 mm |
| Giron optimal | 280 mm | 300 mm |
| Largeur min | 860 mm | 1100 mm |
| Hauteur libre min | 1950 mm | 2050 mm |
| Main courante hauteur | 865-965 mm | 865-965 mm |
| Diametre main courante | 38 mm | 38 mm |
| Espacement barreaux max | 100 mm | 100 mm |

**Outputs** : nb_marches, hauteur_marche, giron, formule_2r_g, conforme_ccq, conformite_detail (5 booleans : contremarche / giron / blondel / largeur / pente), pente_degres, ligne_foulee_mm, evaluation_confort (`Trop faible` / `Acceptable` / `Echelle/raide`).

#### 3.2.2 Materiaux escalier (`/stairs/materials`)

**Inputs** : nb_marches, largeur_m, materiau (`beton` / `bois` / `acier`), essence_bois (pour bois : `pin` / `epinette` / `erable` / `chene` / `merisier`).

**Outputs selon materiau** :
- **Bois** : volume_bois_m3 (marches + contremarches + 2 limons), poids_kg, cout_estime_cad (depuis table `ESSENCES_BOIS_ESCALIER`).
- **Beton** : volume + ciment/sable/gravier/eau (dosage 30 MPa) + sacs 30 kg.
- **Acier** : 2 limons C200x18, marches 6 mm diamond plate, masse_totale_kg + cout (1.20 $/kg).

| Essence | Densite kg/m3 | Prix CAD/m3 |
|---------|--------------:|------------:|
| Pin Quebec | 500 | 1 200 |
| Epinette | 470 | 1 100 |
| Erable | 700 | 2 800 |
| Chene rouge | 700 | 3 200 |
| Merisier | 690 | 3 000 |

#### 3.2.3 Garde-corps + main courante (`/stairs/garde-corps`)

**Inputs** : longueur_m, hauteur_mm (800-1200, defaut 965), espacement_barreaux_mm (50-150, defaut 100), usage (`residentiel` / `commercial`).

**Outputs** : conforme_hauteur, conforme_barreaux, nb_barreaux (long_mm / espacement + 1), nb_poteaux (long / 2 m + 1), longueur_main_courante_m (long + 0.3 m prolongation), diametre_main_courante_mm (38 mm).

### 3.3 Analyse structurale (Ruler)

Endpoint : `POST /calculators/charge-tributaire-complete`. Voir [section 2.3](#23-onglet--analyse-structurale-).

#### Sections bois disponibles

`BOIS_DIMENSIONS` (largeur b mm x hauteur d mm) :

| Section | b mm | d mm |
|---------|-----:|-----:|
| 2x4 | 38 | 89 |
| 2x6 | 38 | 140 |
| 2x8 | 38 | 184 |
| 2x10 | 38 | 235 |
| 2x12 | 38 | 286 |
| 3x6 | 64 | 140 |
| 3x8 | 64 | 184 |
| 3x10 | 64 | 235 |
| 3x12 | 64 | 286 |
| 4x8 | 89 | 184 |
| 4x10 | 89 | 235 |
| 4x12 | 89 | 286 |
| 6x6 | 140 | 140 |
| 6x8 | 140 | 184 |

Grade par defaut : **SPF No.2** (Fb=11.8 MPa, Fv=1.5, E=9500 MPa). Autres : SPF No.1, Doug Fir No.1/2, Hem-Fir No.2.

#### Sections LVL disponibles

`LVL_DIMENSIONS` : largeurs 1-3/4 (b=44 mm) ou 3-1/2 (b=89 mm), hauteurs 7-1/4 a 18". Grade par defaut **2.0E** (Fb=28.2 MPa, Fv=2.6, E=13800 MPa).

#### Combinaisons CNBC + verification

Source : `calculators.py:2585-2749`.

- Combinaisons : 1.4D / 1.25D+1.5L / 1.25D+1.5S (si neige > 0) / 1.25D+1.5L+0.5S
- **Efforts** : Mmax = w_uls L²/8, Vmax = w_uls L/2, delta = 5 w_sls L⁴ / (384 E I)
- **Resistances** : Mr = Fb x S x Kd x Kl ; Vr = Fv x (2/3) x A x Kd (Kd=Kl=1.0 simplifie)
- **Limites fleche** : `LIMITES_FLECHE` -> `plancher` L/360, `toit` L/180, `linteau` L/360
- **Verdict** : CONFORME si flexion + cisaillement + fleche tous OK.

### 3.4 Toiture (Home)

Endpoint principal : `POST /calculators/roofing` + 3 sous-endpoints.
Source : `calculators.py:1484-1617`.

#### 3.4.1 Surface + bardeaux

**Inputs** : longueur_m, largeur_m, pente_ratio (x:12, 0-24), debord_m (defaut 0.3), perte_pct (defaut 15), type_materiau (`bardeau_3tabs` / `bardeau_architect` / `bardeau_premium` / `membrane_elastomere` / `membrane_tpo` / `membrane_epdm` / `tole_galvanisee` / `tole_peinte`).

**Formule** : `pente_facteur = sqrt(1 + (pente/12)^2)` ; `surface = (L + 2*deb) * (l + 2*deb) * facteur * (1 + perte%)`. 1 square = 9.29 m². 3 paquets/square. Sous-couche 93 m²/rouleau. Membrane glace ~15% surface, 20 m²/rouleau. Clous : 320/paquet, 5000/boite.

**Outputs** : surface_totale_m2, nb_squares, nb_paquets_bardeaux, rouleaux_sous_couche, membrane_glace_rouleaux, boites_clous, **cout_materiau_cad + cout_pose_cad + cout_total_cad** (table `MATERIAUX_TOITURE`).

| Materiau | Cout square | Cout pose |
|----------|------------:|----------:|
| Bardeau 3 tabs 20 ans | 90 $ | 150 $ |
| Bardeau architectural 30 ans | 120 $ | 175 $ |
| Bardeau premium 50 ans | 200 $ | 200 $ |
| Membrane elastomere | 300 $ | 275 $ |
| Membrane TPO | 350 $ | 250 $ |
| Membrane EPDM | 280 $ | 250 $ |
| Tole galvanisee | 150 $ | 200 $ |
| Tole peinte | 200 $ | 200 $ |

#### 3.4.2 Ventilation combles CCQ 9.19.1

**Inputs** : surface_comble_m2, pare_vapeur (bool).

**Formule** : ratio = `1:300` avec pare-vapeur, sinon `1:150`. NFA total = surface_pi2 / ratio. 50/50 entre entree (soffite, 9 po²/pi) et sortie (turbine 12" = 150 po², ou faitier 18 po²/pi).

**Outputs** : ratio_ventilation, nfa_total_po2, soffite_continu_pi, nb_turbines_12po, event_faitier_pi, article_ccq (`9.19.1` ou `9.19.1 + 9.25.3`).

#### 3.4.3 Gouttieres CCQ 9.14.6

**Inputs** : surface_toit_m2, perimetre_m, type_gouttiere (`4po` / `5po` / `6po` / `7po`).

**Capacite drainage** : 4po = 600 pi², 5po = 1000, 6po = 1400, 7po = 2000.

**Outputs** : nb_descentes (max 2, capacite/surface_pi2), longueur_gouttieres_m, nb_supports (longueur / 0.6 m), nb_angles (4 par defaut), nb_embouts (2 x descentes).

#### 3.4.4 Charge de neige CNBC 4.1.6

**Inputs** : province (`QC` / `ON` / `BC` / `AB`), ville (texte libre), type_couverture.

**Outputs** : charge_neige_kpa, charge_neige_lb_pi2 (x 20.885), charge_morte_lb_pi2, charge_design_kpa.

Charges neige Quebec disponibles (`CHARGES_NEIGE`) : Montreal/Laval/Longueuil 2.6, Quebec/Levis 3.5, Sherbrooke 3.0, Trois-Rivieres 2.8, Gatineau 2.4, Saguenay 4.0, Rimouski 3.8, Val-d Or 4.2, Rouyn 4.0, Baie-Comeau 4.5, Sept-Iles 5.0, Gaspe 4.0. Defaut si ville absente : 2.5 kPa.

### 3.5 Peinture (Paintbrush)

Endpoint principal : `POST /calculators/painting` + 2 sous-endpoints.
Source : `calculators.py:1624-1736`.

#### 3.5.1 Surface, quantite, cout

**Inputs** : longueur_m, largeur_m, hauteur_m (defaut 2.44), nb_portes, nb_fenetres, type_peinture (10 valeurs), surface_type (10 valeurs), methode (6 valeurs), nb_couches.

**Types peinture** (`TYPES_PEINTURE`) avec couverture m²/L, DFT µm, prix L :

| Type | Solides % | Couverture m²/L | DFT µm | VOC | Prix $/L |
|------|----------:|----------------:|-------:|----:|---------:|
| Latex interieur | 35 | 10 | 35 | 50 | 45 |
| Latex exterieur | 40 | 9 | 45 | 100 | 55 |
| Alkyde interieur | 45 | 12 | 40 | 350 | 60 |
| Alkyde exterieur | 50 | 11 | 45 | 400 | 70 |
| Appret latex | 30 | 8 | 25 | 50 | 40 |
| Appret alkyde | 40 | 10 | 30 | 350 | 50 |
| Appret shellac | 25 | 8 | 20 | 730 | 65 |
| Epoxy 2K | 70 | 6 | 100 | 250 | 120 |
| Polyurethane 2K | 55 | 8 | 60 | 350 | 95 |
| Peinture plancher | 45 | 8 | 75 | 150 | 75 |

**Facteurs absorption** (multiplicateur, divise la couverture) : gypse_neuf 1.3, gypse_peint 1.0, platre 1.4, beton_neuf 1.5, beton_scelle 1.0, bois_neuf 1.3, bois_peint 1.0, metal 0.9, stucco 1.6, brique 1.5.

**Efficacite transfert** (multiplicateur applique a la couverture) : pinceau 0.95, rouleau 0.90, airless 0.65, hvlp 0.80, electrostatique 0.90, conventionnel 0.50.

**Formule** :
- Surface murs = perimetre x hauteur ; - portes (2 m²) - fenetres (1.5 m²) ; + plafond.
- Couverture effective = couv_theorique / facteur_abs x efficacite.
- Litres total = surface / couv_effective x nb_couches x 1.10 (perte).
- Cout HT = litres x prix_L ; TPS 5%, TVQ 9.975%.

**Outputs** : surface_totale_m2, litres_total, gallons_total, cout_peinture_ht, tps, tvq, cout_total_ttc, cout_par_m2_ttc, dft_um_theorique, temps_recouvrement_h.

#### 3.5.2 Epaisseur film sec DFT (`/painting/dft`)

**Inputs** : volume_ml, solides_pct, surface_m2.

**Formule** : DFT (µm) = (Volume_mL x Solides%) / (Surface_m² x 1000) x 1000 (simplifie). Conversion mils = µm / 25.4.

**Evaluation** : < 25 trop mince, 25-40 OK interieur, 40-60 OK exterieur, 60-150 OK industriel, > 150 risque coulures.

#### 3.5.3 Point de rosee Magnus (`/painting/dew-point`)

**Inputs** : temperature_air_c, humidite_relative_pct (> 0), temperature_surface_c.

**Formule Magnus** : `alpha = ln(RH/100) + (17.27*T) / (237.7+T)` ; `point_rosee = 237.7*alpha / (17.27 - alpha)`.

**Outputs** : point_rosee_c, marge_securite_c (T_surface - dew_point), application_securitaire (true si marge >= 3 °C), recommandation texte.

> **Cas d usage** : avant peinture exterieure, valider que la temperature de la paroi est >= rosee + 3 °C, sinon condensation sous le film -> ecaillage.

### 3.6 Electricite (Zap)

Endpoint principal : `POST /calculators/electrical` + 3 sous-endpoints.
Source : `calculators.py:1310-1477`.

#### 3.6.1 Calibrage cable + chute tension (CCE 4-004)

**Inputs** : puissance_watts, tension_volts (defaut 120), longueur_cable_m, facteur_puissance (0.1-1.0), chute_tension_max_pct (defaut 3.0), conducteur (`cuivre` / `aluminium`), type_circuit (`monophase` / `triphase`).

**Formule** :
- I = P / (U x cos phi)
- k = 2 (mono) ou sqrt(3) (tri)
- rho cuivre = 0.0214, rho alu = 0.0350 ohm.mm²/m
- section_min = (k x rho x L x I) / (U x chute% / 100)
- AWG = plus petit AWG dont section_mm² >= section_min (table `AWG_TABLE` 14 a 4/0)

**Sizing disjoncteur** automatique : <=12A -> 15A, <=16 -> 20, <=24 -> 30, <=32 -> 40, <=50 -> 60, <=80 -> 100, sinon `ceil(I/25)*25`.

**Outputs** : courant_amperes, awg_recommande, section_recommandee_mm2, ampacite (60/75/90 °C), chute_tension_pct reelle, conformite_chute (`Excellent` <= 3%, `Acceptable` <= 5%, `Non conforme` > 5%), disjoncteur_amperes.

#### 3.6.2 Charge residentielle CCE Article 8-200 (`/electrical/residential`)

**Inputs** : surface_habitable_m2, chauffage_kw, climatisation_kw, cuisiniere_kw (defaut 12), secheuse_kw (defaut 5), chauffe_eau_kw (defaut 4.5), autres_charges_kw.

**Formule CCE 8-200** :
- Base 5 kW + 1 kW par tranche de 90 m² au-dessus de 90 m².
- HVAC = max(chauffage, clim) — un seul compte.
- Cuisiniere x 0.80 (facteur demande).
- Secheuse x 0.75.
- Chauffe-eau plein.
- Autres x 0.75.
- Total / 240 V = courant.
- Service recommande : 100 / 125 / 150 / 200 / 400 / 600 A (palier juste au-dessus).

**Outputs** : total_demande_kw, courant_service_240v, calibre_service_recommande_a, breakdown par charge.

#### 3.6.3 Eclairage methode lumens (`/electrical/lighting`)

**Inputs** : surface_m2, type_local (9 valeurs), flux_luminaire_lm, uf (utilisation 0.2-0.9), mf (maintenance 0.5-1.0).

**Niveaux lux recommandes** (`ECLAIRAGE_NIVEAUX`) : salon 150, cuisine 300, chambre 150, bureau 500, atelier 500, couloir 100, salle_bain 300, industriel 750, commercial 500.

**Formule** : nb_luminaires = ceil((E x A) / (Phi x UF x MF)). Disposition grille = ceil(sqrt(nb)).

**Outputs** : nb_luminaires, lux_requis, disposition_grille (ex. `4 x 4`), espacement_m, flux_total_requis_lm.

#### 3.6.4 Mise a la terre (`/electrical/grounding`)

**Inputs** : resistivite_sol (ohm.m, defaut 100), longueur_piquet_m (defaut 3), diametre_piquet_m (defaut 0.016), nb_piquets (1-20).

**Formule Tagg / IEEE 80** : `R = rho / (2*pi*L) * (ln(4L/d) - 1)`. Si > 1 piquet : `R / nb x 1.15` (facteur couplage).

**Outputs** : resistance_totale_ohms, conforme_hydro_quebec (R <= 25 ohms), recommandation.

### 3.7 Plomberie (Droplets)

Endpoint principal : `POST /calculators/plumbing` + 3 sous-endpoints.
Source : `calculators.py:1743-1896`.

#### 3.7.1 DFU + WSFU + diametre drain (CNP)

**Inputs** : compteurs par appareil (toilettes, lavabos, douches, baignoires, evier_cuisine, evier_bar, lave_vaisselle, machines_laver, drain_plancher, urinoir).

**Table `DFU_APPAREILS`** :

| Appareil | DFU | WSFU |
|----------|----:|-----:|
| Toilette | 4 | 2.5 |
| Lavabo | 1 | 1.5 |
| Douche | 2 | 3.0 |
| Baignoire | 3 | 3.0 |
| Evier cuisine | 2 | 2.0 |
| Evier bar | 1 | 1.5 |
| Lave-vaisselle | 2 | 1.5 |
| Machine a laver | 3 | 2.5 |
| Drain de plancher | 1 | 0 |
| Urinoir | 4 | 3.0 |

**Diametre drain CNP Table 2.3.3.5** : 1 DFU -> 1-1/4", 3 -> 1-1/2", 6 -> 2", 20 -> 2-1/2", 42 -> 3", 160 -> 4", 620 -> 5", 1400 -> 6".

**Conversion debit** : si WSFU <= 10, GPM = WSFU. Sinon GPM = 5.3 x sqrt(WSFU).

**Outputs** : total_dfu, total_wsfu, debit_gpm, debit_lpm, diametre_drain (pouces + mm), detail_appareils.

#### 3.7.2 Hazen-Williams (`/plumbing/hazen-williams`)

**Inputs** : debit_gpm, longueur_pi, diametre_pouce, materiau (`cuivre` / `pex` / `cpvc` / `pvc` / `abs` / `acier_galv_neuf` / `acier_galv_usage` / `fonte_neuve` / `fonte_usee` / `beton`).

**Coefficients C** : cuivre/PEX/CPVC/PVC/ABS = 140, acier_galv_neuf 120, acier_galv_usage 100, fonte_neuve 130, fonte_usee 100, beton 130.

**Formule** : `hf_pi = 4.52 * Q^1.852 * L / (C^1.852 * d^4.87)` ; psi = pi/2.31. Vitesse `V = Q/(2.448*d²)`.

**Evaluation vitesse** : < 4 fps Faible, 4-6 Optimal, 6-8 Limite, > 8 risque coup de belier.

**Outputs** : perte_charge_pi, perte_charge_psi, vitesse_pi_s, evaluation_vitesse, coefficient_c.

#### 3.7.3 Chauffe-eau (`/plumbing/water-heater`)

**Inputs** : nb_chambres, nb_salles_bain, nb_personnes.

**Capacite** (`CHAUFFE_EAU_CAPACITE`) cle `chambres-bain` : 1-1 -> 40 gal, 2-1 -> 40, 2-2 -> 50, 3-2 -> 50, 3-3 -> 60, 4-2 -> 60, 4-3 -> 80, 5-3 -> 80, 5-4 -> 100. Fallback : 20 + 10*chambres + 10*bains.

**FHR** = 70% capacite ; consommation pointe = personnes x 12 gal matin. Adequat si FHR >= consommation.

**Outputs** : capacite_gallons, capacite_litres, first_hour_rating_min, adequat (bool), type_recommande (`Reservoir electrique` <= 60 gal, sinon `Reservoir gaz haute recuperation`).

#### 3.7.4 Pente drain (`/plumbing/drain-slope`)

**Inputs** : diametre_pouce, longueur_m, pente_pct.

**Recommandation CNP** : 2.08% (1/4 po/pi) si d <= 3", 1.04% (1/8 po/pi) si > 3".

**Outputs** : chute_m, chute_po, conforme_cnp, recommandation.

### 3.8 CVAC (Wind)

Endpoint principal : `POST /calculators/hvac` + 4 sous-endpoints.
Source : `calculators.py:1903-2056`.

#### 3.8.1 Charge thermique ASHRAE

**Inputs** : surface_m2, hauteur_plafond_m (defaut 2.44), isolation (`faible` 50 W/m² / `moyenne` 40 / `bonne` 30 / `excellente` 22), zone_climatique (8 zones).

**Zones climatiques Quebec** (`ZONES_CLIMATIQUES`) :

| Zone | Facteur | T hiver °C | T ete °C | HDD |
|------|--------:|-----------:|---------:|----:|
| Montreal/Laval | 1.00 | -23 | 30 | 4500 |
| Quebec/Levis | 1.10 | -27 | 28 | 5100 |
| Gatineau | 1.05 | -25 | 30 | 4700 |
| Sherbrooke | 1.08 | -26 | 29 | 5000 |
| Saguenay | 1.25 | -29 | 27 | 5600 |
| Bas-St-Laurent (Rimouski) | 1.15 | -24 | 25 | 5200 |
| Abitibi (Val-d Or) | 1.30 | -30 | 26 | 6200 |
| Nord du Quebec | 1.40 | -35 | 24 | 6800 |

**Formule** : `pertes_design = surface * watts_m2 * facteur_zone * 1.10` (10% securite). BTU/h = W * 3.412. Tonnage = BTU/12 000. CFM ventilation = volume_pi3 / 60 x 8 ACH.

**Equipement standard** : palier juste au-dessus dans 40k / 60k / 80k / ... / 200k BTU.

**Outputs** : pertes_design_w, btu_h, tonnage_clim, equipement_recommande_btu, btu_par_pi2, cfm_ventilation, t_hiver_c, t_ete_c, hdd.

#### 3.8.2 Conduits (`/hvac/duct`)

**Inputs** : cfm, type_circuit (`residentiel_principal` 600-900 / `residentiel_branche` 400-600 / `commercial` 1000-1500 / `industriel` 1500-2500 FPM).

**Formule** : `d = sqrt(4*CFM / (pi*V))`. Arrondi a la taille standard (4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 30 po).

**Outputs** : diametre_standard_po, vitesse_reelle_fpm, conforme (vitesse dans la plage), aire_section_pi2.

#### 3.8.3 CFM par changement d air (`/hvac/cfm`)

**Inputs** : volume_m3, type_piece (10 valeurs).

**ACH par type** (`ACH_RECOMMANDE`) : salon 4, chambre 4, cuisine 8, salle_bain 8, sous_sol 3, garage 6, atelier 10, commercial 6, restaurant 12, laboratoire 15.

**Formule** : `CFM = (volume_pi3 * ACH) / 60`.

#### 3.8.4 HRV/ERV ASHRAE 62.2 (`/hvac/hrv`)

**Inputs** : surface_m2, nb_chambres, nb_occupants.

**Formule ASHRAE 62.2** : `CFM_min = 0.03 * surface_pi2 + 7.5 * (chambres + 1)`. Alternative occupants : 20 CFM/personne. CFM_recommande = max des deux.

**Tailles standard HRV** : 50 / 75 / 100 / 125 / 150 / 200 / 250 / 300 / 400 CFM.

**Outputs** : cfm_recommande, taille_hrv_recommandee_cfm, cfm_min_62_2, cfm_occupants.

#### 3.8.5 Climatisation gains solaires (`/hvac/cooling`)

**Inputs** : surface_vitree_m2, orientation (`nord` 0.4 / `sud` 0.8 / `est` 0.9 / `ouest` 1.0 / `mixte` 0.7), shgc (Solar Heat Gain Coefficient), rayonnement_w_m2 (defaut 700), nb_occupants, equipements_w.

**Formule** : `gain_solaire = surface * shgc * rayonnement * facteur_orientation` ; `gain_occupants = nb * 117 W` ; `gain_total = solaire + occupants + equip` ; tonnage = BTU/12000.

**Outputs** : gain_total_btu_h, tonnage_clim_requis, breakdown solaire/occupants/equipements.

### 3.9 Soudure (Flame)

Endpoint principal : `POST /calculators/welding` + 3 sous-endpoints.
Source : `calculators.py:2063-2192`.

#### 3.9.1 Soudure d angle CSA W47.1

**Inputs** : type_joint (`bout_a_bout` / `en_T` / `recouvrement` / `angle`), epaisseur_mm, longueur_soudure_mm, procede (`SMAW` / `GMAW` / `FCAW` / `GTAW` / `SAW`), electrode (optionnel).

**Formule** : Gorge = 0.707 x epaisseur (filet d angle). Volume soudure = (gorge x jambe / 2) x longueur. Poids = volume_cm³ x 7.85 g/cm³ (acier).

**Facteur waste** par procede (`ELECTRODE_WASTE`) : SMAW 1.40 (40% perte), GMAW 1.05, FCAW 1.15, GTAW 1.02, SAW 1.05.

**Taux depot** (`TAUX_DEPOT` kg/h) : SMAW 1.0-3.0, GMAW 2.0-8.0, FCAW 2.5-10.0, GTAW 0.3-1.5, SAW 5.0-20.0.

**Outputs** : gorge_mm, jambe_mm, volume_soudure_cm3, poids_metal_depose_g, consommation_electrode_g (avec waste), facteur_waste, taux_depot_kg_h.

#### 3.9.2 Heat Input (`/welding/heat-input`)

**Inputs** : tension_v, amperage_a, vitesse_mm_min.

**Formule** : `HI (kJ/mm) = (V * A * 60) / (vitesse_mm_min * 1000)`.

**Evaluation** :
- Acier carbone : < 1.0 kJ/mm trop faible, 1.0-1.5 faible, 1.5-3.0 optimal, > 3.0 trop eleve.
- Inox/Alu : < 1.0 OK, 1.0-1.5 optimal, 1.5-3.0 eleve, > 3.0 trop eleve.

#### 3.9.3 Carbone equivalent IIW + prechauffage (`/welding/preheat`)

**Inputs** : composition % (C, Mn, Cr, Mo, V, Ni, Cu), epaisseur_mm.

**Formule IIW** : `CE = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15`.

**Recommandation prechauffage** :
- CE < 0.40 : 50 °C si > 25 mm sinon 0 (Risque Faible).
- CE < 0.50 : 100 si > 25 mm sinon 75 (Modere).
- CE < 0.60 : 150 si > 25 mm sinon 100 (Eleve).
- CE >= 0.60 : 200 si > 25 mm sinon 150 (Tres eleve).

**Outputs** : carbone_equivalent, niveau_risque_fissuration, temperature_prechauffage_c, formule (texte).

#### 3.9.4 Consommable (`/welding/consumable`)

**Inputs** : poids_metal_depose_g, procede.

**Outputs** : consommation_totale_g + kg, nb_electrodes_3_32 (27 g chacune), nb_bobines_15kg (MIG).

### 3.10 Pliage metal (Wrench)

Endpoint principal : `POST /calculators/bending` + 2 sous-endpoints.
Source : `calculators.py:2199-2288`.

#### 3.10.1 Developpement + tonnage Air Bending

**Inputs** : longueur_piece_mm, epaisseur_mm, angle_pliage_deg (defaut 90), rayon_interieur_mm (defaut = epaisseur), largeur_piece_mm, materiau (8 valeurs).

**Formules** :
- K-factor interpole depuis `K_FACTOR_TABLE` selon R/T (R/T=0 -> k=0.50, R/T=10 -> k=0.32). Moyenne avec K du materiau.
- Bend Allowance : `BA = angle_rad * (R + K*T)`
- Outside Setback : `OSSB = 2*(R+T)*tan(angle/2)`
- Bend Deduction : `BD = OSSB - BA`
- Longueur developpee = longueur_piece - BD
- V-die opening (`V_DIE_OPENING`) : 6T si t<=3 mm, 8T si <=6, 10T si <=12, 12T si <=25.
- Tonnage : `P = (1.42 * UTS * t² * L) / (V * 1000) * facteur_materiau`.
- Rmin = `rmin_facteur * t`. Risque fissure si R < Rmin.

**Materiaux pliage** (`MATERIAUX_PLIAGE`) :

| Materiau | Limite elast MPa | UTS MPa | k_factor | rmin_facteur | tonnage_facteur | Springback 90° |
|----------|-----------------:|--------:|---------:|-------------:|----------------:|---------------:|
| Acier doux A36 | 250 | 400 | 0.33 | 0.5 | 1.0 | 0.5° |
| Inox 304 | 215 | 505 | 0.35 | 0.5 | 1.5 | 2.0° |
| Inox 316 | 290 | 580 | 0.35 | 0.5 | 1.6 | 2.5° |
| Alu 6061-T6 | 275 | 310 | 0.30 | 1.5 | 0.45 | 3.0° |
| Alu 5052-H32 | 195 | 228 | 0.30 | 1.0 | 0.35 | 2.5° |
| Cuivre | 70 | 220 | 0.33 | 1.0 | 0.5 | 1.5° |
| Titane Gr2 | 275 | 345 | 0.30 | 2.5 | 1.3 | 4.0° |
| Galvanise | 250 | 390 | 0.33 | 0.8 | 1.0 | 1.0° |

**Outputs** : longueur_developpee_mm, k_factor, bend_allowance_mm, bend_deduction_mm, ouverture_v_mm, tonnage_requis_kn, rayon_minimum_mm, risque_fissure (bool), springback_90_deg.

#### 3.10.2 Springback (`/bending/springback`)

Compense le retour elastique : springback proportionnel a l angle ; angle_a_plier = angle_voulu + springback.

#### 3.10.3 Rayon minimum (`/bending/min-radius`)

Rmin (mm + po) = rmin_facteur (depuis materiau) x epaisseur.

### 3.11 Poids metal (Weight)

Endpoint : `POST /calculators/metal-weight`.
Source : `calculators.py:2295-2450`.

**Inputs** :
- `forme` : `plaque` / `tube_rond` / `tube_carre` / `barre_ronde` / `barre_carree` / `angle` / `poutre_i` / `profil_w` / `profil_c`
- `materiau` : 20 cles dans `METAUX` (acier_a36, alu_6061, cuivre, titane, etc.)
- `dimensions` : Dict avec cles selon forme (longueur, largeur, epaisseur, rayon_ext/int, cote, aile_a/b, hauteur, etc.)

**Formules volume** (en mm puis converti en m³) :
- **Plaque** : L x l x ep
- **Tube rond** : pi x (R_ext² - R_int²) x L
- **Tube carre** : (cote_ext² - cote_int²) x L (cote_int = cote_ext - 2*ep)
- **Barre ronde** : pi x R² x L
- **Barre carree** : cote² x L
- **Angle** : (a*ep + (b-ep)*ep) x L
- **Poutre I** : (2 x bf x tf + (h - 2*tf) x tw) x L
- **Profil W/C** : `masse_kg_m * longueur_m` (lookup dans `PROFILES_W` ou `PROFILES_C`)

**Densites** (`METAUX`) — 20 materiaux :

| Materiau | Densite kg/m³ | Prix CAD/kg |
|----------|--------------:|------------:|
| Acier A36 | 7850 | 1.20 |
| Inox 304 | 7930 | 4.50 |
| Inox 316 | 8000 | 5.50 |
| Inox 430 | 7750 | 3.50 |
| Acier outil | 7850 | 8.00 |
| Alu 6061-T6 | 2700 | 5.00 |
| Alu 5052-H32 | 2680 | 4.80 |
| Alu 7075-T6 | 2810 | 12.00 |
| Cuivre C11000 | 8940 | 12.00 |
| Laiton C36000 | 8500 | 8.00 |
| Bronze | 8800 | 15.00 |
| Titane Grade 2 | 4510 | 35.00 |
| Titane Grade 5 | 4430 | 45.00 |
| Zinc | 7130 | 3.50 |
| Plomb | 11340 | 2.50 |
| Nickel 200 | 8890 | 25.00 |
| Inconel 625 | 8440 | 60.00 |
| Magnesium AZ31B | 1770 | 8.00 |
| Fonte grise | 7200 | 1.50 |
| Fonte ductile | 7100 | 2.00 |

**Outputs** : poids_kg, poids_lb, volume_m3, densite_kg_m3, prix_cad_kg, cout_estime_cad.

**Profiles W disponibles (24)** : W150x13, W150x18, W150x24, W200x22, W200x27, W200x36, W200x46, W250x33, W250x45, W250x58, W310x38, W310x52, W310x74, W360x39, W360x57, W360x72, W360x91, W410x46, W410x67, W410x85, W460x74, W530x66, W530x92, W610x125.

**Profiles C disponibles (10)** : C75x6, C100x8, C130x10, C150x12, C180x15, C200x18, C230x22, C250x30, C310x31, C380x50.

### 3.12 Taxes Quebec (DollarSign)

Endpoint : `POST /calculators/taxes`.
Source : `calculators.py:2457-2470`.

**Inputs** : montant_ht (>= 0).

**Formule** : `TPS = HT * 0.05` ; `TVQ = HT * 0.09975` ; `TTC = HT + TPS + TVQ`.

**Outputs** : montant_ht, tps, tvq, total_ttc, taux_tps (5%), taux_tvq (9.975%).

### 3.13 Paie employe (DollarSign)

Endpoint : `POST /calculators/charge-tributaire`.
Source : `calculators.py:2477-2531`.

**Inputs** : salaire_brut (annuel, > 0), type_employe (`regulier` / `construction_ccq`).

**Taux Quebec 2024** :

| Item | Taux employe | Taux employeur |
|------|-------------:|---------------:|
| RRQ (Regime des rentes du Quebec) | 6.4% | 6.4% |
| RQAP (Regime quebecois d assurance parentale) | 0.494% | 0.692% |
| AE (Assurance-emploi) | 1.32% | 1.848% |
| Impot federal | 15% (simplifie) | — |
| Impot provincial | 15% (simplifie) | — |
| CNESST (sante securite travail) | — | 1.8% (variable par classe risque) |
| FSS (Fonds services de sante) | — | 1.65% |
| CCQ (construction uniquement) | — | 12.5% |

**Outputs** :
- `deductions_employe` : rrq, rqap, ae, impot_federal, impot_provincial, total
- `charges_employeur` : rrq, rqap, ae, cnesst, fss, ccq (si construction), total
- `salaire_net` (brut - deductions)
- `cout_total_employeur` (brut + charges)

> **Limitations** : impots simplifies a 15% federal + 15% provincial — ce ne sont **pas** les paliers reels d imposition (en realite progressifs). CNESST a 1.8% est generique — le taux reel depend de la classe de risque du metier (peut aller de 0.4% bureau a > 5% travaux en hauteur).

---

## 4. Reference (formules, normes, constantes)

### 4.1 Endpoints principaux par calculateur

Source : `calculators.py:884-3258`. Tous les endpoints sont prefixes `/calculators`.

| Calculateur | Endpoints |
|-------------|-----------|
| **Beton** | `POST /concrete`, `/concrete/dosage`, `/concrete/rebar`, `/concrete/cure`, `/concrete/formwork`, `/concrete/excavation`, `/concrete/talus`, `/concrete/stairs` |
| **Escaliers** | `POST /stairs`, `/stairs/materials`, `/stairs/garde-corps` |
| **Electricite** | `POST /electrical`, `/electrical/residential`, `/electrical/lighting`, `/electrical/grounding` |
| **Toiture** | `POST /roofing`, `/roofing/ventilation`, `/roofing/gutters`, `/roofing/snow-load` |
| **Peinture** | `POST /painting`, `/painting/dft`, `/painting/dew-point` |
| **Plomberie** | `POST /plumbing`, `/plumbing/hazen-williams`, `/plumbing/water-heater`, `/plumbing/drain-slope` |
| **CVAC** | `POST /hvac`, `/hvac/duct`, `/hvac/cfm`, `/hvac/hrv`, `/hvac/cooling` |
| **Soudure** | `POST /welding`, `/welding/heat-input`, `/welding/preheat`, `/welding/consumable` |
| **Pliage** | `POST /bending`, `/bending/springback`, `/bending/min-radius` |
| **Poids metal** | `POST /metal-weight` |
| **Taxes** | `POST /taxes` |
| **Paie** | `POST /charge-tributaire` |
| **Structural** | `POST /charge-tributaire-complete`, `GET /charge-tributaire-complete/materials`, `GET /charge-tributaire-complete/snow-loads` |
| **Conversions** | `GET /conversions` |
| **Historique** | `GET POST DELETE /history`, `GET /history/stats`, `DELETE /history/{id}` |
| **IA** | `POST /ai/{chat,analyze,recommend,explain-norm,diagnose,optimize}` |
| **Constantes** | `GET /constants`, `GET /resources`, `GET /` (liste) |

### 4.2 Normes referencees (sortie verbatim du code)

| Norme | Calculateur | Detail |
|-------|-------------|--------|
| **CSA A23.1** | Beton | Dosages 15 a 40 MPa, classes exposition C-1 a S-2 |
| **CSA G30.18** | Armature | Diametres 10M a 55M, masses lineiques |
| **ACI 209** | Cure beton | f(t) = f28 * t/(a+b*t), coefficients GU/HE/MS/HS |
| **CNESST** | Talus excavation | Pentes H:V par type de sol, exigences > 1.2 / 3 / 6 m |
| **Blondel** | Escaliers | 2R + G entre 580 et 660 mm (optimum 630) |
| **CCQ 9.8** | Escaliers residentiels | Contremarche 125-200, giron 235-355, largeur >= 860 mm |
| **CCQ 3.4** | Escaliers commerciaux | Contremarche 125-180, giron 280-355, largeur >= 1100 mm |
| **CCQ 9.8.7** | Garde-corps | Hauteur 865-965 mm, barreaux <= 100 mm, diam main courante 38 mm |
| **CCQ 9.19.1** | Ventilation comble | 1:300 avec pare-vapeur, 1:150 sans |
| **CCQ 9.14.6** | Gouttieres | Capacite par diametre |
| **CCQ 9.26** | Toiture | Bardeaux, membranes, tole |
| **CCQ 9.26.5.3** | Membrane glace | Avant-toits 90 cm min |
| **CNBC 4.1.6** | Charges neige | Province par ville, kPa |
| **CNBC** | Combinaisons charges | 1.4D / 1.25D+1.5L / 1.25D+1.5S / 1.25D+1.5L+0.5S |
| **CSA O86** | Bois structural | Mr = Fb*S, Vr = Fv*(2/3)*A |
| **CCE Article 4-004** | Cable | Section minimale, chute de tension max 3% branche/5% total |
| **CCE Article 8-200** | Charge residentielle | Base 5kW + 1kW par 90 m² |
| **CNP** | Plomberie | DFU, WSFU, Table 2.3.3.5 diametres drain |
| **Hazen-Williams** | Pertes charge | hf = 4.52 * Q^1.852 * L / (C^1.852 * d^4.87) |
| **ASHRAE 62.2** | Ventilation residentielle | 0.03 CFM/pi² + 7.5 CFM/(chambre+1) |
| **ASHRAE 90.1** | Efficacite energetique | (referencee, pas implementee directement) |
| **CSA W47.1** | Soudage | Procedes SMAW/GMAW/FCAW/GTAW/SAW |
| **AWS D1.1** | Soudage structural | Reference dans system prompt |
| **IIW** | Carbone equivalent | CE = C + Mn/6 + (Cr+Mo+V)/5 + (Ni+Cu)/15 |
| **Magnus** | Point de rosee | alpha = ln(RH/100) + 17.27T/(237.7+T) |
| **AISC / CISC** | Profiles W/C | Bibliotheque sections |
| **TPS / TVQ** | Taxes | 5% + 9.975% |
| **RRQ / RQAP / AE / CNESST / FSS / CCQ** | Paie | Taux 2024 |

### 4.3 Validations Pydantic (limites entrees)

Source : `calculators.py:135-466`. Toutes les entrees sont validees cote Pydantic avec `Field(ge=, le=)`.

| Champ | Plage | Defaut |
|-------|-------|--------|
| `longueur` / `largeur` (toiture, beton, etc.) | 0 < x <= 1000 m | — |
| `epaisseur` (beton) | 0 < x <= 10 m | — |
| `volume_m3` | 0 < x <= 10 000 | — |
| `enrobage_mm` | 15 a 200 | 50 |
| `espacement_mm` (rebar) | 50 a 600 | 300 |
| `nb_lits` | 1 a 4 | 1 |
| `temperature_c` | -30 a +50 | — |
| `puissance_watts` | 0 < x <= 1 000 000 | — |
| `tension_volts` | 0 < x <= 1000 | 120 |
| `chute_tension_max_pct` | 0.1 a 10 | 3.0 |
| `surface_habitable_m2` | 0 < x <= 10 000 | — |
| `cuisiniere_kw` | 0 a 50 | 12 |
| `pente_ratio` (toiture) | 0 a 24 | 4.0 |
| `temperature_air_c` | -50 a +60 | — |
| `humidite_relative_pct` | > 0 et <= 100 | — |
| `nb_toilettes` (etc.) | 0 a 1000 | varie |
| `cfm` | 0 < x <= 100 000 | — |
| `epaisseur_mm` (pliage) | 0 < x <= 100 | — |
| `salaire_brut` | 0 < x <= 10 000 000 | — |
| `portee_mm` (structural) | 0 < x <= 50 000 | 3000 |
| `ply_count` | 1 a 6 | 1 |

> **DoS guard** : `validate_dict_size` rejette tout `inputs` ou `results` (history + IA) > 100 cles ou > 50 KB serialise (cf. `calculators.py:476-488`).

### 4.4 Persistance historique

Table auto-creee `calculator_history` (`calculators.py:598-636`) :
- `id` SERIAL PK
- `calculator_id` TEXT (ex. `concrete`)
- `subcalc_id` TEXT (ex. `volume`)
- `label` TEXT (description courte)
- `inputs` JSONB
- `results` JSONB
- `notes` TEXT
- `user_id` INTEGER (cree-le)
- `created_at` TIMESTAMPTZ DEFAULT NOW()

Index :
- `idx_calc_history_calc(calculator_id, created_at DESC)`
- `idx_calc_history_created(created_at DESC)`

> **Note** : la sauvegarde est **manuelle** — le frontend ne sauve pas automatiquement. Pour preserver un calcul, l utilisateur doit explicitement appeler `POST /calculators/history` (ou utiliser une fonction `saveToHistory(...)` du store, a verifier en prod).

### 4.5 Limitations connues

| Limite | Effet |
|--------|-------|
| Calcul structural simplifie (Kd=Kl=1.0) | Pas de stabilite laterale, pas de duree de chargement, pas de confinement humidite — valide pour preliminaire seulement |
| Impots paie a 15% / 15% fixe | Pas les paliers progressifs reels |
| CNESST a 1.8% generique | Variable par classe de risque (a personnaliser au besoin) |
| Pas de Mr complet pour acier (CSA S16) | Seul bois (CSA O86) implemente |
| Pas de calcul colonne (mode buckling) | `type_element=colonne` accepte mais formules identiques a poutre |
| Charges neige par ville (defaut 2.5 kPa) | Si ville absente du dictionnaire, fallback generique |
| Pas de combinaisons CNBC sismiques | E (charge sismique) non incluse |
| Pas de drift / deflexion long terme | Seule fleche immediate (5wL⁴/384EI) |
| Pas de calcul de connexions | Boulons, soudures de connexion, ancrages a calculer separement |
| Pas de CFD / simulation thermique avancee | Seul calcul ASHRAE en regime permanent |
| Pas de calculs sismiques | Pas de verification ductile, pas de spectre de reponse |
| Pas de generation PDF officielle | Sauf historique JSON ; PDF a faire via export browser |
| Historique non auto-sauvegarde | Sauvegarde manuelle requise via API |
| Pas de partage entre tenants | `calculator_history` cree dans le schema du tenant |
| 6 endpoints IA | Garde-fou credits + service IA — peut etre indisponible (HTTP 503/402/403) |

---

## 5. Integrations & FAQ

### 5.1 Integration Devis (Module 4)

> **Pas d integration directe**. Les calculs ne sont pas automatiquement injectes dans une ligne de devis. Workflow recommande :

1. Lancer le calculateur (ex. Beton volume).
2. Copier les outputs cles (`volume_total_m3`, `cout_total_cad`).
3. Coller manuellement dans une ligne de devis (Module 4).
4. Optionnel : sauvegarder le calcul (`POST /history`) avec `notes = "Pour devis DEV-2026-001"` pour tracabilite.

### 5.2 Integration Bons de Commande (Module 6)

> **Pas d integration directe**. Les quantites de materiaux (sacs ciment, paquets bardeaux, etc.) doivent etre transcrites manuellement dans le bon de commande. Pour automatiser : utiliser l export historique (JSONB) -> script CSV -> import inventaire.

### 5.3 Integration Inventaire (Module 10)

> **Pas d integration directe**. Les calculateurs ne consomment pas de stock, ne reservent rien. Si vous voulez consommer du stock apres un calcul, creer manuellement un mouvement d inventaire dans Module 10.

### 5.4 Integration Comptabilite (Module 7)

- Calculateur **Taxes Quebec** : retourne TPS + TVQ pour usage informatif. Pas d integration auto avec les factures (Module 7 calcule ses propres taxes selon ses regles).
- Calculateur **Paie employe** : retourne deductions + charges, mais ne genere **aucune ecriture journal**, ne cree pas de `payroll_entries`. Pour la paie reelle, voir Module 9 Employes.

### 5.5 Integration IA (Module 12)

- Les 6 endpoints `POST /calculators/ai/*` consomment des **credits IA prepayes** (`tenant_settings.ai_credits_balance_usd`).
- Tracking dans `ai_usage` (feature = `calc_chat`, `calc_analyze`, `calc_recommend`, `calc_explain_norm`, `calc_diagnose`, `calc_optimize`).
- Modele : `claude-opus-4-7` (markup 1.30).
- Si pas de credits ou IA desactivee : HTTP 402/403/503.
- **Distinct** des endpoints IA Immobilier (`/immobilier/ia/*`) qui utilisent Sonnet 4.6.

### 5.6 Integration Projets / Bons de travail

> **Aucune integration**. Les calculateurs sont des outils standalone. Pour rattacher un calcul a un projet :
- Le sauvegarder dans l historique avec `notes = "Projet PROJ-2026-00042"`.
- Ou copier les resultats en notes de projet (Module 1).

### 5.7 Integration Calendrier

> **Aucune integration**. Pas de notification, pas de planification depuis les calculateurs.

### 5.8 FAQ

**Q : Les resultats des calculateurs sont-ils valides legalement comme calcul d ingenieur ?**
R : **NON**. Tous les calculateurs sont des outils **d aide a l estimation et au pre-dimensionnement**. Pour un calcul officiel (permis, plan signe), un ingenieur OIQ doit valider et signer. Le calculateur Analyse structurale est particulierement simplifie (Kd=Kl=1.0, pas de duree de chargement, pas de stabilite laterale).

**Q : Peut-on partager un calcul avec un autre utilisateur du tenant ?**
R : **OUI** indirectement — l historique (`calculator_history`) est par tenant, donc tous les utilisateurs du meme tenant voient tous les calculs sauves. Pas de filtrage par utilisateur dans l UI.

**Q : Comment exporter un calcul en PDF pour un client ?**
R : **Pas d export PDF officiel**. Utiliser l impression du navigateur (Ctrl+P) ou la fonctionnalite de capture d ecran. Alternative : copier les outputs JSON depuis l onglet Historique -> Details.

**Q : Les calculs sont-ils sauvegardes automatiquement ?**
R : **NON par defaut**. Chaque calcul est ephemere (POST sans persistance). Pour conserver, utiliser explicitement la fonctionnalite « Sauvegarder dans l historique » (a confirmer en prod si bouton expose dans chaque panneau, sinon via API directement).

**Q : Que se passe-t-il si le service IA Anthropic est indisponible ?**
R : Les 6 endpoints `/ai/*` retournent HTTP 503. Tous les autres calculateurs (qui sont 100% deterministes en Python) continuent de fonctionner.

**Q : Le calculateur Charge residentielle CCE 8-200 prend-il en compte la methode de calcul alternative (load demand individual circuits) ?**
R : **NON**. Seule la methode standard (Forfaitaire 8-200) est implementee. Pour cas speciaux (ex. > 4 elements de cuisson, charges discontinues), consulter un electricien certifie.

**Q : Les charges de neige par ville sont-elles a jour avec la version 2020 ou 2025 du CNBC ?**
R : Les valeurs sont **codees en dur** dans `calculators_data.py:381-392` (CHARGES_NEIGE). Source originale : CNBC Section 4.1.6. **Verifier la version applicable** dans le code source ou demander une mise a jour si une nouvelle edition CNBC modifie les valeurs.

**Q : Le calculateur Soudure inclut-il les essais non destructifs (END) requis ?**
R : **NON**. Le calculateur dimensionne le joint (gorge, jambe, consommation), mais ne prescrit pas les END (radiographie, ressuage, magnetoscopie). Pour cela, suivre CSA W59 / AWS D1.1 selon la classe d ouvrage.

**Q : Comment calculer une dalle structurale beton arme (poutre + dalle bidirectionnelle) ?**
R : **Pas implemente**. Le calculateur Beton donne le volume + dosage + armature en grille basique. Pour calcul flexural avec efforts (Mu, Vu, As), utiliser le calculateur Analyse structurale (mais en mode bois/LVL — pas beton arme).

**Q : Y a-t-il une fonction pour calculer la resistance d une colonne en compression ?**
R : Le calculateur Analyse structurale accepte `type_element=colonne` mais applique les memes formules que pour une poutre (Mr / Vr / fleche). **Le mode flambement (Pcr selon Euler) n est PAS implemente**. A utiliser avec precaution.

**Q : Les couts indicatifs en CAD sont-ils a jour ?**
R : Les prix dans `MATERIAUX_TOITURE`, `METAUX`, `TYPES_PEINTURE`, `ESSENCES_BOIS_ESCALIER`, etc. correspondent aux prix marches **2024** (verbatim docstring). Pour des soumissions reelles, utiliser les prix fournisseurs reels via le module Inventaire (Module 10).

**Q : L IA Claude peut-elle expliquer pourquoi mon calcul est non conforme ?**
R : **OUI** — utiliser l onglet IA -> sous-onglet **Diagnostic** : selectionner le calculateur, decrire le probleme et les symptomes -> Claude retourne diagnostic principal, causes probables, solutions, urgence et flag « intervention professionnelle ».

**Q : Combien de temps les calculs sont-ils gardes dans l historique ?**
R : **Indefiniment** — pas de purge automatique. Seule la suppression manuelle (DELETE /history/{id} ou DELETE /history pour effacer tout) reduit la taille.

**Q : Les calculateurs fonctionnent-ils hors ligne ?**
R : **NON**. Tous les calculs sont effectues cote backend (FastAPI Python). Une connexion reseau et un token JWT valide sont requis.

**Q : Peut-on personnaliser les taux CCQ / CNESST par tenant ?**
R : **NON** dans cette implementation. Les taux sont hardcodes dans `calculators_data.py:651-666`. Pour customisation, demander a l administrateur Constructo une override par tenant (developpement custom).

**Q : Les conversions de l onglet Conversions sont-elles utilisables dans un calcul actif ?**
R : **NON** — c est un onglet d affichage uniquement (lecture). Pour appliquer une conversion (ex. 100 ft -> m), utiliser une calculatrice externe ou copier le facteur (3.28084 m/ft). Aucun champ d entree active.

**Q : Le calculateur Pliage gere-t-il les pliages multiples sur une meme piece ?**
R : **NON** directement. Chaque appel calcule **un seul pli**. Pour une piece a 3 plis, lancer 3 fois le calculateur et additionner les BD pour le developpement total. Pour automatisation : agreger via script.

**Q : Que faire si une norme citee (ex. CCQ 9.8) a evolue ?**
R : Les criteres sont **figes dans le code** (table `ESCALIERS_CCQ` etc.). Verifier la version applicable dans `calculators_data.py:591-623`. Pour mise a jour, demander une revue de code.

---

## 6. Recap one-pager

- **Module focus** : suite de **13 calculateurs construction Quebec** + analyse structurale CNBC/CSA O86 + 6 endpoints IA Claude Opus 4.7 + historique multi-tenant.
- **6 onglets** : Tableau de bord / Calculateurs / Analyse structurale / Assistant IA / Historique / Conversions.
- **5 categories** : Structure (3 calc), Enveloppe (2), Mecanique (3), Metal (3), Finances (2).
- **~50 endpoints** sous `/calculators` : 38 calculs + 6 IA + history (5) + constants/resources (3).
- **Normes implementees** : CSA A23.1 / G30.18 / O86 / W47.1, ACI 209, CCQ 9.8 / 3.4 / 9.14.6 / 9.19.1 / 9.26, CCE 4-004 / 8-200, CNP, CNBC 4.1.6, ASHRAE 62.2, AWS D1.1, IIW, Magnus, Hazen-Williams, Blondel, CNESST.
- **Beton** : volume + dosage 7 classes (15-40 MPa) + armature 10M-55M + cure ACI 209 + excavation foisonnement + talus CNESST + escalier Blondel.
- **Escaliers** : dimensions CCQ 9.8 (residentiel) / 3.4 (commercial) + Blondel 580-660 mm + materiaux (bois/beton/acier) + garde-corps.
- **Analyse structurale** : poutre/linteau/colonne, bois SPF No.2 ou LVL 2.0E, sections 2x4 a 6x8 (et LVL), combinaisons CNBC, Mr/Vr CSA O86, fleche L/360 ou L/180, **diagramme SVG auto**.
- **Toiture** : surface + bardeaux (8 types), ventilation 1:300 / 1:150, gouttieres 4-7", charge neige par ville Quebec.
- **Peinture** : 10 types peinture, 10 surfaces, 6 methodes, **TPS/TVQ inclus**, DFT (epaisseur), point de rosee Magnus.
- **Electricite** : calibrage cable AWG 14-4/0, charge residentielle CCE 8-200, eclairage lumens, mise a la terre piquets.
- **Plomberie** : DFU/WSFU CNP, drains 1-1/4 a 6", Hazen-Williams 10 materiaux, chauffe-eau (3-5 ch x 1-4 bain), pente drain.
- **CVAC** : charge thermique ASHRAE 8 zones Quebec, conduits 4-30", CFM ACH par piece, HRV/ERV ASHRAE 62.2, climatisation gains solaires.
- **Soudure** : CSA W47.1 angle, heat input, prechauffage IIW, 5 procedes (SMAW/GMAW/FCAW/GTAW/SAW).
- **Pliage** : 8 materiaux, K-factor R/T, tonnage Air Bending, springback, rayon min, V-die.
- **Poids metal** : 9 formes (plaque, tube, barre, angle, poutre I, profile W/C) x 20 materiaux + 24 profiles W AISC + 10 profiles C UPN.
- **Taxes** : TPS 5% + TVQ 9.975%.
- **Paie** : RRQ 6.4% / RQAP 0.494% / AE 1.32% (employe) ; RRQ 6.4% / RQAP 0.692% / AE 1.848% / CNESST 1.8% / FSS 1.65% / CCQ 12.5% (employeur).
- **6 endpoints IA Claude Opus 4.7** : chat / analyze (score 0-100) / recommend / explain-norm / diagnose (urgence + intervention pro) / optimize (cout/perf/eco/delai). Markup 1.30, deduit credits prepayes.
- **Historique** : table `calculator_history` JSONB, sauvegarde **manuelle**, stats par jour 30 derniers jours.
- **Conversions** : tables longueur/surface/volume/poids/pression/temperature/DMS (lecture seule).
- **Pas d integration** directe avec Devis / BC / Inventaire / Projets / Calendrier (copier-coller manuel).
- **Pas de PDF** officiel ni signature ingenieur — pre-dimensionnement uniquement.
- **Modele IA** : `claude-opus-4-7`, max 20 000 tokens, pricing 0.015 / 0.075 USD per 1k IO.

---

**Documentation generee a partir du code** : `calculators.py` (3260 lignes), `calculators_data.py` (786 lignes — tables completes), `CalculateursPage.tsx` (2050 lignes, 6 onglets), `calculators.ts` (43 KB types + API).

**Manuels lies** :
- Module 4 (Devis — pour saisir les calculs) — `04-devis.md`
- Module 6 (Bons de Commande — pour acheter les materiaux) — `06-bons-de-commande.md`
- Module 9 (Employes — paie reelle vs calcul indicatif) — `09-employes.md`
- Module 10 (Inventaire — prix fournisseurs reels) — `10-inventaire.md`
- Module 19 (Immobilier — calculateurs financiers complementaires : mensualite, ROI, SCHL) — `11-immobilier.md`
- Module 25 (IA — credits IA prepayes) — `12-ia.md`
