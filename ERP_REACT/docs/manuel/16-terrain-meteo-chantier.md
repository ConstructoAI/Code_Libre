# Module 16 — Meteo Chantier

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/secondary.py` lignes 7552-7607 (router Meteo, ~56 lignes, 2 endpoints), `frontend/src/pages/MeteoPage.tsx` (152 lignes, page unique), `frontend/src/api/secondary.ts` lignes 45-53 (2 fonctions API)
> **Service externe** : Open-Meteo (`https://api.open-meteo.com/v1/forecast`) — API publique, sans cle, sans cout
> **Tables PostgreSQL** : aucune. Le module est **read-only** : il interroge Open-Meteo a chaque requete et affiche le resultat sans persistance locale.
> **Cadrage** : ce module est un **outil de consultation passive** des conditions meteo prevues sur 7 jours pour 7 stations urbaines du Quebec, avec mise en evidence automatique des risques chantier (gel, pluie, vent). Il **n est pas** un systeme d alertes pousses, ne genere ni courriels, ni notifications, ni evenements calendrier, et n a **aucun lien base de donnees** vers les projets / phases / bons de travail.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface](#2-interface)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations--faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Fournir aux equipes terrain et aux planificateurs une **vue rapide des conditions meteo previsionnelles sur 7 jours** pour les principales agglomerations quebecoises, avec une **lecture automatique des risques chantier** (gel, precipitations, vent) et des **recommandations operationnelles** (couler beton OUI/NON, asphaltage, peinture exterieure, travaux en hauteur).

Concretement le module repond a deux questions :
- « Quel temps fera-t-il a Quebec / Montreal / Saguenay sur les 7 prochains jours ? »
- « Quelles activites de chantier dois-je adapter, reporter ou suspendre en fonction de cette meteo ? »

### 1.2 Ce que le module fait (verifie contre code)

- Lister **7 stations meteo** quebecoises pre-cablees (Montreal, Quebec, Gatineau, Trois-Rivieres, Sherbrooke, Saguenay, Rimouski) via `GET /weather/stations`.
- Recuperer les **previsions journalieres sur 7 jours** depuis Open-Meteo via `GET /weather/forecast?lat=X&lon=Y` : temperature max, temperature min, precipitations totales (mm), vent maximal (km/h).
- **Marquer automatiquement** chaque jour avec un badge si seuil franchi : Gel (temp_min < 0 C), Pluie (precip > 5 mm), Vent fort (vent_max > 40 km/h).
- Generer une **section « Impact chantier »** consolidee listant les jours a risque avec une **recommandation textuelle** par evenement (6 niveaux, voir section 4.4). Si aucun jour ne franchit de seuil : message vert « Aucune alerte meteo - conditions favorables pour les travaux ».

### 1.3 Ce que le module ne fait PAS

> **Important** : ce module est **strictement consultatif et lecture seule**. Il **n implemente pas** :

- **Pas de stockage** : aucune table PostgreSQL, aucune persistance des previsions consultees, aucun historique meteo.
- **Pas d alertes pousses** : aucun courriel, notification push, SMS ni webhook declenche par la meteo.
- **Pas de lien base de donnees vers les projets** : la page n affiche aucune liste de projets, ne lie aucun chantier a une station. La liaison « meteo - chantier » est purement **humaine** : l utilisateur choisit la station correspondant au lieu du chantier.
- **Pas de geolocalisation auto** ni d ajout de stations personnalisees : les 7 stations sont en dur (`secondary.py:7559-7567`).
- **Pas d historique** ni de **meteo horaire** : uniquement journalier sur 7 jours futurs (`forecast_days=7`).
- **Pas d alertes « urgence civile »** : aucun branchement vers Environnement Canada, MSP, alertes verglacantes/blizzards officielles. Les seuils sont des heuristiques internes.
- **Pas d integration Calendrier ERP** ni d export PDF / CSV / iCal.
- **Pas de blocage automatique** : meme si l UI affiche « ARRETER les travaux en hauteur », aucun bon de travail ni phase n est suspendu.
- **Pas de configuration des seuils** : les seuils sont **constants en dur** dans `MeteoPage.tsx`.
- **Pas de comparatif multi-stations** ni d **IA** (aucun credit deduit, module gratuit).

### 1.4 Architecture technique

```
Frontend MeteoPage.tsx -> Backend secondary.py /weather/* -> Open-Meteo API publique
   listWeatherStations()    GET /weather/stations             api.open-meteo.com/v1/forecast
   getWeatherForecast()     GET /weather/forecast             (gratuit, sans cle, JSON)
```

Pas de base de donnees, pas de cache backend (chaque requete utilisateur appelle Open-Meteo en direct, timeout 10 s), pas de cle API requise.

### 1.5 Acces

- Sidebar -> Section **Terrain** -> **Meteo Chantier** (icone `CloudSun`).
- URL : `/meteo`.
- Page unique sans onglets ni sous-pages.
- Onglet par defaut : aucun (page plate).

### 1.6 Permissions

- **Authentification requise** : la route est gardee par `Depends(get_current_user)` cote backend. Tout utilisateur connecte au tenant peut consulter.
- **Aucun role specifique** requis. Pas de role « meteorologue » ou « directeur chantier ».
- **Aucune restriction tenant** : les 7 stations sont les memes pour tous les tenants ; l API Open-Meteo est mondiale et publique.

### 1.7 Couts & limites externes

- Open-Meteo : **gratuit, sans cle**, limite communautaire d environ 10 000 requetes / jour / IP (largement suffisant pour un usage ERP normal).
- En cas d echec reseau ou de HTTP error cote Open-Meteo : le backend renvoie `{forecasts: [], error: "Service meteo temporairement indisponible"}` (HTTP 200), et la page affiche « Aucune prevision disponible ».
- Timeout backend cote serveur : **10 secondes** (`timeout=10` dans `urllib.request.urlopen`).

---

## 2. Interface

Source : `MeteoPage.tsx` (152 lignes, composant fonctionnel unique).

### 2.1 Squelette general

```
+--------------------------------------------------------------+
| Meteo Chantier                          [v Selecteur ville]  |
+--------------------------------------------------------------+
|  [J1] [J2] [J3] [J4] [J5] [J6] [J7]   <- 7 cartes journalieres
|   ...   ...   ...   ...   [Gel]                              |
+--------------------------------------------------------------+
| ShieldAlert  Impact chantier - Recommandations               |
|  [Snowflake] Ven. 2 mai - Gel prevu (-1 C)    [Attention]    |
|     Proteger le beton frais avec couvertures isolantes...    |
|  [Droplets]  Sam. 3 mai - Pluie importante     [Attention]   |
+--------------------------------------------------------------+
```

Responsive : 1 colonne mobile, 2 sur tablette, 4 sur desktop, 7 sur ecran 1280+.

### 2.2 Selecteur de station

- Composant `<Select>` (UI commune ERP) en haut a droite.
- Options : libelle = nom ville, valeur = code aeroport IATA (`YUL`, `YQB`, `YOW`, `YQT`, `YSH`, `YSB`, `YRI`).
- Defaut au premier rendu : **YUL (Montreal)** car premiere station retournee par l API.
- Tout changement declenche un nouvel appel `getWeatherForecast(lat, lon)` avec les coordonnees de la station selectionnee.

### 2.3 Carte journaliere

Anatomie d une carte (`<Card padding="sm">`) :

| Element             | Source / Logique                                                       |
|---------------------|------------------------------------------------------------------------|
| Date                | `f.date` formate `fr-CA` court : `lun. 28 avr.`                         |
| Icone meteo         | `CloudSun` lucide (statique, pas de pictogramme contextuel)            |
| Temperature Max     | `f.tempMax` en degres, couleur rose pale `#E8919A`                     |
| Temperature Min     | `f.tempMin` en degres, couleur bleue `#7BAFD4` si < 0 C, sinon gris    |
| Precipitations      | `f.precipitation` en mm, couleur bleue si > 5 mm, sinon gris           |
| Vent max            | `f.windMax` en km/h, couleur orange `#F0B07A` si > 40 km/h, sinon gris |
| Bordure carte       | Bordure jaune `#F6C87A` si `isCold || isRain || isWindy`               |
| Badge condition     | `Gel` (bleu) si min < 0 ; `Pluie` (jaune) si precip > 5 ; `Vent fort` (rouge) si vent > 40 |

> **Logique d affichage du badge** : si plusieurs conditions simultanees, l ordre d evaluation `isCold ? 'Gel' : isWindy ? 'Vent fort' : 'Pluie'` privilegie **Gel > Vent fort > Pluie** (un seul badge affiche).

### 2.4 Section « Impact chantier »

Bloc `<Card>` ajoute en bas de page **uniquement si** des previsions sont disponibles. Deux variantes :

**Variante A — aucune alerte** (aucun jour ne franchit les seuils stricts) :
```
[HardHat vert]  Impact chantier
                Aucune alerte meteo - conditions favorables pour les travaux
```

**Variante B — alertes detectees** :

```
[ShieldAlert orange]  Impact chantier - Recommandations
+-------------------------------------------------------+
| [Icone] Date - Message court                  [Badge] |
|         Recommandation textuelle longue                |
+-------------------------------------------------------+
| ... un bloc par evenement ...                          |
+-------------------------------------------------------+
```

Chaque ligne est typee : `gel`, `pluie`, `vent`, avec severite `warning` (jaune) ou `danger` (rouge). Voir section 4.4 pour le tableau des seuils et messages.

### 2.5 Etats de chargement / erreur

- Au chargement initial (avant que la liste des stations soit recue) : `<SkeletonPage />` plein ecran.
- Lors d un changement de station : meme `SkeletonPage` pendant la requete.
- Si l API renvoie un tableau vide (`forecasts: []`) : message neutre « Aucune prevision disponible » centre dans la grille.
- En cas d erreur Open-Meteo : pas de toast, juste le tableau vide ; le message d erreur backend (`Service meteo temporairement indisponible`) n est pas remonte a l ecran (perte silencieuse).

---

## 3. Workflows pas-a-pas

### 3.1 Consulter la meteo d un chantier (workflow principal)

1. Sidebar -> **Terrain** -> **Meteo Chantier**.
2. Page chargee : par defaut Montreal (`YUL`), 7 cartes affichees.
3. Selecteur en haut a droite -> choisir la ville la plus proche du chantier.
4. Lire les 7 cartes : reperer les jours avec **bordure jaune** ou **badge** (Gel / Pluie / Vent fort).
5. Faire defiler vers la section **Impact chantier** : lecture des recommandations specifiques.
6. Decider manuellement (reporter coulee beton, avancer livraisons, reorganiser equipes, annuler travaux en hauteur, etc.).
7. Communiquer la decision aux equipes via un autre canal (Module Messages, courriel, BT).

> **Rappel** : aucune action automatique. La meteo n entre dans aucune table, aucun BT, aucune phase.

### 3.2 Verifier la fenetre meteo pour couler du beton

1. Selectionner la station de la ville du chantier.
2. Reperer les jours avec **temp_min >= 0 C** sur **48-72 h consecutives** apres la coulee prevue.
3. Si la nuit suivante affiche `Gel` (min < 0 C) : prevoir couvertures isolantes + additif antigel (recommandation auto dans Impact chantier).
4. Si **« Gel severe »** (min < -10 C, severite Critique) : la recommandation est **« Arreter le coulage de beton »** — application stricte conseillee.
5. Verifier aussi precipitations (eviter > 10 mm dans les 24 h post-coulee).

### 3.3 Planifier asphaltage et peinture exterieure

1. **Asphaltage** : choisir une fenetre de 3-5 jours consecutifs sans pluie (precipitation < 5 mm chaque jour), `temp_min` >= 5 C de preference.
2. **Peinture exterieure** : jours sans pluie (precip < 5 mm), avec `temp_min >= 10 C` et `vent_max < 40 km/h`.
3. La recommandation automatique « Reporter peinture exterieure » apparait dans l Impact chantier des qu un jour depasse 10 mm de pluie.
4. Aucune logique dediee a ces metiers cote code : lecture humaine du tableau.

### 3.4 Anticiper un vent violent (travaux en hauteur)

1. Lire les badges `Vent fort` (> 40 km/h) sur les 7 cartes.
2. Section Impact chantier **« Vents violents »** (> 70 km/h, **Critique**) : recommandation **« ARRETER les travaux en hauteur. Descendre grue. Securiser tous les materiaux et equipements legers. »**
3. **« Vents forts »** (50-70 km/h, Attention) : « Securiser echafaudages et bannieres. Limiter travaux en hauteur. »
4. Coordonner avec le surintendant et le grutier (manuel).

### 3.5 Changer de ville et cas d erreur

1. Cliquer sur le selecteur, choisir une autre station parmi les 7 -> la page recharge automatiquement.
2. Si Open-Meteo est indisponible : timeout 10 s, page affiche « Aucune prevision disponible » sans message d erreur visible. La section Impact chantier ne s affiche pas (`forecasts.length === 0`).
3. Solution : recharger plus tard, ou consulter Environnement Canada / MeteoMedia en alternative.

---

## 4. Reference

### 4.1 Stations disponibles (7, en dur)

Source : `secondary.py:7559-7567`.

| Code  | Ville           | Latitude | Longitude  |
|-------|-----------------|----------|------------|
| YUL   | Montreal        | 45.5017  | -73.5673   |
| YQB   | Quebec          | 46.8139  | -71.2080   |
| YOW   | Gatineau        | 45.4765  | -75.7013   |
| YQT   | Trois-Rivieres  | 46.3432  | -72.5419   |
| YSH   | Sherbrooke      | 45.4010  | -71.8884   |
| YSB   | Saguenay        | 48.4279  | -71.0685   |
| YRI   | Rimouski        | 48.4489  | -68.5243   |

> **Remarque** : les codes IATA sont symboliques (ex. YQT = aeroport Thunder Bay en realite, mais utilise ici comme cle). Seuls les couples lat/lon sont passes a Open-Meteo.

### 4.2 Endpoints (2 au total)

| Methode | URL                        | Auth | Reponse                                                  |
|---------|----------------------------|------|----------------------------------------------------------|
| GET     | `/api/erp/v1/weather/stations` | Oui | `{ stations: [{code, name, lat, lon}, ... 7 entrees] }` |
| GET     | `/api/erp/v1/weather/forecast?lat=X&lon=Y` | Oui | `{ forecasts: [...7], latitude, longitude }` ou `{ forecasts: [], error: "..." }` |

Defauts de `/weather/forecast` si lat/lon absents : `lat=45.5017, lon=-73.5673` (Montreal).

### 4.3 Format de prevision retourne par le backend

Backend (Python, snake_case) :
```json
{
  "date": "2026-04-28",
  "temp_max": 18.4,
  "temp_min": 5.1,
  "precipitation": 2.3,
  "wind_max": 22.0
}
```

Frontend (TypeScript, camelCase apres mapping cote API client) :
```typescript
interface Forecast {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  windMax: number;
}
```

> **Note** : le mapping snake_case -> camelCase n est pas explicit dans `MeteoPage.tsx` ; il s appuie sur la convention globale du client `api.ts` ou sur une coincidence de propriete. Verifier la transformation cote `client.ts` si les valeurs apparaissent `undefined`.

### 4.4 Seuils & recommandations (Impact chantier)

Source : `MeteoPage.tsx:96-114`. Tous les seuils sont **hard-codes**.

| Type   | Seuil declencheur           | Severite | Message                                | Recommandation                                                                                       |
|--------|-----------------------------|----------|----------------------------------------|------------------------------------------------------------------------------------------------------|
| Gel    | `temp_min < -10 C`          | **Critique** (rouge) | `Gel severe (X C)`        | **Arreter le coulage de beton.** Proteger les canalisations. Prevoir chauffage des zones de travail. |
| Gel    | `temp_min < 0 C` (et >= -10)| Attention (jaune)    | `Gel prevu (X C)`         | Proteger le beton frais avec couvertures isolantes. Utiliser additifs antigel. Verifier protection des tuyaux. |
| Pluie  | `precipitation > 20 mm`     | **Critique** (rouge) | `Fortes precipitations (Xmm)` | Reporter les travaux exterieurs. Securiser les excavations contre inondation. Verifier les pompes de drainage. |
| Pluie  | `precipitation > 10 mm` (et <= 20) | Attention (jaune) | `Pluie importante (Xmm)` | Proteger les materiaux sensibles a l humidite. Prevoir baches pour zones de travail. **Reporter peinture exterieure.** |
| Vent   | `wind_max > 70 km/h`        | **Critique** (rouge) | `Vents violents (X km/h)` | **ARRETER les travaux en hauteur.** Descendre grue. Securiser tous les materiaux et equipements legers. |
| Vent   | `wind_max > 50 km/h` (et <= 70) | Attention (jaune) | `Vents forts (X km/h)`   | Securiser echafaudages et bannieres. Limiter travaux en hauteur. Attacher materiaux legers.          |

> **Cumul possible** : un meme jour peut declencher plusieurs lignes Impact chantier (ex. gel + pluie + vent simultanes -> 3 lignes distinctes pour la meme date).

> **Seuils carte** (badges sur cartes journalieres) sont **plus permissifs** que les seuils Impact chantier :
> - Carte : `tempMin < 0` (Gel), `precipitation > 5` (Pluie), `windMax > 40` (Vent fort).
> - Impact chantier : `tempMin < 0` ou `< -10`, `precipitation > 10` ou `> 20`, `windMax > 50` ou `> 70`.
>
> Donc une bordure jaune sur la carte ne genere pas systematiquement une ligne Impact chantier (ex. pluie 6 mm).

### 4.5 Service externe Open-Meteo

- **URL** : `https://api.open-meteo.com/v1/forecast`
- **Parametres** : `latitude`, `longitude`, `daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max`, `timezone=America/Montreal`, `forecast_days=7`.
- **Authentification** : aucune (API publique gratuite).
- **Doc officielle** : https://open-meteo.com/en/docs

### 4.6 Limites & validations

| Regle / Comportement                          | Effet                                                                  |
|-----------------------------------------------|------------------------------------------------------------------------|
| Utilisateur non authentifie                   | HTTP 401 sur `/weather/*`                                              |
| Open-Meteo HTTP error (4xx/5xx) ou timeout > 10 s | `{forecasts: [], error: "..."}` (HTTP 200 cote ERP, perte silencieuse cote UI) |
| Lat/lon non fournis                           | Defaut Montreal `45.5017, -73.5673`                                    |
| Lat/lon hors zone meteo couverte              | `daily.time = []` -> page affiche « Aucune prevision disponible »      |
| Seuils franchis multiples sur un meme jour    | Plusieurs lignes Impact chantier (une par type), un seul badge carte   |

### 4.7 Resume technique

- Page React : `MeteoPage.tsx`, 152 lignes, composant unique.
- Endpoints backend : 2 (~56 lignes dans `secondary.py:7552-7607`).
- Tables DB : 0. Cle API : aucune. Cache backend : aucun (pas de Redis, pas de TTL).
- Service externe : Open-Meteo (gratuit, public). Couverture : 7 villes Quebec hard-codees.
- Horizon : 7 jours, granularite journaliere uniquement. Persistance previsions : aucune.
- IA / credits : 0 (module gratuit pour le tenant).

---

## 5. Integrations & FAQ

### 5.1 Integration Projets / Phases / BT / Suivi Gantt

> **Aucune integration directe.** Le module Meteo Chantier est un **silo independant** :
- Aucune FK `project_id` / `phase_id` / `bt_id` dans le module.
- Aucun bouton « Voir meteo de ce projet » dans Module 1 (Projets) ou Module 2 (Suivi/Gantt).
- Un BT ou une phase sur un jour de gel severe **n est pas marque** automatiquement ; le surintendant doit reporter / suspendre manuellement.
- Pour lier mentalement une meteo a un chantier, l utilisateur retient lui-meme la ville et selectionne la station correspondante.

### 5.2 Integration Calendrier / Messagerie / Notifications

- **Aucune integration**. Pas d evenements `/calendar`, pas d export iCal, pas de courriel automatique, pas de canal Slack/Teams pousse, pas de notification navigateur.
- Tous les avertissements sont **passifs** (visibles uniquement quand l utilisateur ouvre la page).

### 5.3 Integration IA (Module 12)

- **Aucun appel** a Claude depuis la page Meteo Chantier. Aucun credit IA deduit.
- Le module IA general (`backend/routers/ai.py:99`) cite `alertes_meteo, previsions_meteo, historique_meteo_chantier` dans son prompt systeme — mais ces tables **ne sont pas creees** par ce module. Si vous interrogez l assistant IA sur la meteo, il pourrait halluciner des donnees inexistantes.

### 5.4 Integration Conformite (CNESST / RBQ)

- **Aucune**. Bien que les seuils de vent (> 50 km/h, > 70 km/h) recoupent les recommandations CNESST sur travaux en hauteur, le module **n integre pas** les obligations legales ni la generation automatique d arret de travaux conforme. Verifier les exigences CNESST officielles.

### 5.7 FAQ

**Q : Puis-je ajouter ma propre ville (Drummondville, Joliette, etc.) ?**
R : **NON** depuis l UI. Les 7 stations sont hard-codees dans `secondary.py:7559-7567`. Alternative : choisir la station la plus proche (ex. Trois-Rivieres pour Drummondville).

**Q : Puis-je consulter la meteo de plus de 7 jours ou en mode horaire ?**
R : **NON**. Le parametre `forecast_days=7` est cable. Seules les valeurs journalieres (max/min/somme/max) sont demandees. Pour horaire, consulter Environnement Canada ou MeteoMedia directement.

**Q : Le module garde-t-il un historique des previsions consultees ?**
R : **NON**. Aucune persistance. Chaque ouverture de page rappelle Open-Meteo en direct. Pour archiver : capture d ecran.

**Q : Que se passe-t-il si Open-Meteo est en panne ?**
R : Reponse vide silencieuse. La page affiche « Aucune prevision disponible » sans message d erreur visible. Verifier `/api/erp/v1/weather/forecast?lat=X&lon=Y` directement pour voir le champ `error`.

**Q : Les seuils gel / pluie / vent sont-ils configurables par tenant ?**
R : **NON**. Seuils en dur dans le frontend (`MeteoPage.tsx:51-53` et 99-113).

**Q : Le module envoie-t-il des courriels ou bloque-t-il automatiquement les BT en cas d alerte critique ?**
R : **NON**. Aucun systeme push, cron, webhook. Aucune ecriture vers d autres tables. Les recommandations sont **textuelles uniquement** ; le surintendant doit suspendre les BT manuellement.

**Q : Open-Meteo est-il fiable pour la prise de decision construction ?**
R : Open-Meteo agrege plusieurs modeles (ECMWF, GFS, ICON). Precision raisonnable a 3-5 jours, plus incertaine a 7 jours. Pour des decisions critiques (coulage majeur, levage grue), **toujours croiser** avec Environnement Canada et un responsable terrain.

**Q : Puis-je comparer deux villes en parallele ?**
R : **NON**. Une seule station selectionnee a la fois. Solution : deux onglets de navigateur differents.

**Q : Y a-t-il un cache ou risque-t-on d epuiser le quota Open-Meteo ?**
R : Pas de cache backend ; chaque utilisateur appelle Open-Meteo en direct. Open-Meteo tolere environ 10 000 requetes / jour / IP, largement suffisant.

**Q : Les recommandations sont-elles juridiquement opposables (CNESST, vices caches) ?**
R : **NON**. Ce sont des heuristiques internes a titre indicatif. Toute decision d arret de chantier doit etre validee par le superviseur conformement aux lois et reglements applicables.

**Q : Les unites sont-elles en metrique et le module consomme-t-il des credits IA ?**
R : Unites metriques (Celsius, mm, km/h). Aucun credit IA deduit, module 100% gratuit pour le tenant.

---

## 6. Recap one-pager

- **Module focus** : consultation meteo previsionnelle 7 jours pour 7 villes Quebec, avec recommandations chantier automatiques.
- **2 endpoints** (`GET /weather/stations`, `GET /weather/forecast`), **0 table**, **0 cle API requise**.
- **7 stations cablees** : Montreal, Quebec, Gatineau, Trois-Rivieres, Sherbrooke, Saguenay, Rimouski.
- **7 jours journalier** ; 4 metriques par jour : temp_max, temp_min, precipitation_sum, wind_speed_10m_max.
- **3 types badges carte** : Gel (min < 0), Pluie (precip > 5), Vent fort (vent > 40 km/h).
- **6 niveaux Impact chantier** : Gel severe / Gel prevu / Fortes precip / Pluie importante / Vents violents / Vents forts.
- **Recommandations cles** : « Arreter coulage beton » (gel severe), « Reporter peinture exterieure » (pluie > 10 mm), « ARRETER travaux en hauteur » (vent > 70 km/h).
- **Pas d alerte poussee** (courriel/notification/webhook/SMS), **pas d historique**, **pas de lien projet/BT/phase**, **pas de geolocalisation auto**, **pas d ajout de ville**, **pas de credits IA**, **pas d export**, **pas de configuration des seuils**.
- **Cas d echec** : reponse vide silencieuse, page affiche « Aucune prevision disponible ».

---

**Documentation generee a partir du code** : `secondary.py` lignes 7552-7607 (router Meteo, 56 lignes), `MeteoPage.tsx` (152 lignes), `secondary.ts` lignes 45-53 (2 fonctions API client), `types/index.ts` ligne 1278 (interface `WeatherForecast`).

**Manuels lies** :
- Module 1 (Projets — pas de lien direct, mais reference geographique du chantier) — `01-projets.md`
- Module 2 (Suivi / Gantt — phases construction sans integration meteo) — `02-suivi-gantt.md`
- Module 5 (Bons de Travail — a suspendre manuellement en cas d alerte critique) — `05-bons-de-travail.md`
- Module 25 (IA — citations meteo dans le prompt mais sans donnees backing) — `12-ia.md`
