<p align="center">
  <a href="https://constructoai.ca">
    <img src="https://img.shields.io/badge/Constructo_AI-Plateforme_construction_Qu%C3%A9bec-002050?style=for-the-badge" alt="Constructo AI" />
  </a>
</p>

<h1 align="center">Constructo AI — Plateforme à code libre pour la construction au Québec</h1>

<p align="center">
  <strong>Le premier écosystème ERP open source pensé pour les entrepreneurs québécois.</strong><br/>
  Trois applications. Une fondation Python + React. Des règles métier conformes à la réalité du Québec.
</p>

<p align="center">
  <a href="https://github.com/ConstructoAI/Code_Libre/actions/workflows/security.yml"><img src="https://github.com/ConstructoAI/Code_Libre/actions/workflows/security.yml/badge.svg" alt="Security scan" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License Apache 2.0" /></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python 3.11+" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18.3-61dafb.svg" alt="React 18.3" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.6-3178c6.svg" alt="TypeScript 5.6" /></a>
  <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-0.115+-009688.svg" alt="FastAPI" /></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-14+-336791.svg" alt="PostgreSQL 14+" /></a>
  <a href="https://constructoai.ca"><img src="https://img.shields.io/badge/Made_in-Qu%C3%A9bec-fed800.svg" alt="Made in Québec" /></a>
</p>

---

> ## ℹ️ Modèle ouvert, opération privée
>
> Le code source de Constructo AI est publié sous licence Apache 2.0 **pour la transparence et la confiance**. Notre produit, c'est le **SaaS hébergé à partir de 79,99 $/mois**, opéré par Constructo AI Inc. au Québec.
>
> | | |
> |---|---|
> | 🟢 **SaaS hébergé** | Maintenu et supporté en continu, conforme aux exigences québécoises, hébergement souverain, support en français. **C'est notre seul produit officiel.** Voir [constructoai.ca](https://constructoai.ca). |
> | 🟡 **Auto-hébergement** | Le code est complet et fonctionnel, mais **non supporté**. Configuration, déploiement et maintenance sont à votre charge. Aucune aide n'est fournie pour les déploiements externes. |
> | 🟡 **Contributions externes** | Non activement sollicitées. La roadmap suit les besoins des clients du SaaS hébergé. Les pull requests externes sont étudiées au cas par cas, sans engagement. |
> | 🔴 **Issues de support** | Réservées aux clients du SaaS. Pour des questions générales : [Discussions GitHub](https://github.com/ConstructoAI/Code_Libre/discussions). Pour des vulnérabilités de sécurité : voir [SECURITY.md](SECURITY.md). |
>
> 👉 **Pour utiliser Constructo AI sans tracas, démarrez en quelques minutes sur [constructoai.ca](https://constructoai.ca) — à partir de 79,99 $/mois.**

---

## Table des matières

1. [Pourquoi Constructo AI ?](#pourquoi-constructo-ai-)
2. [À qui ça s'adresse ?](#à-qui-ça-sadresse-)
3. [Les trois applications](#les-trois-applications)
4. [Fonctionnalités phares](#fonctionnalités-phares)
5. [Conçu pour la réalité québécoise](#conçu-pour-la-réalité-québécoise)
6. [Calculateurs métier intégrés](#calculateurs-métier-intégrés)
7. [Architecture technique](#architecture-technique)
8. [Stack précise](#stack-précise)
9. [Démarrage rapide](#démarrage-rapide)
10. [Variables d'environnement](#variables-denvironnement)
11. [Documentation de l'API](#documentation-de-lapi)
12. [Tests et CI](#tests-et-ci)
13. [Sécurité et mise en production](#sécurité-et-mise-en-production)
14. [Comparaison avec les SaaS commerciaux](#comparaison-avec-les-saas-commerciaux)
15. [Limitations connues et feuille de route](#limitations-connues-et-feuille-de-route)
16. [Contribution](#contribution)
17. [FAQ](#faq)
18. [Licence et attribution](#licence-et-attribution)
19. [Support et contact](#support-et-contact)

---

## Pourquoi Constructo AI ?

Les ERP construction commerciaux (Procore, Buildertrend, Sage 100, Maestro\*) sont conçus pour le marché américain ou ontarien : taxes mal câblées, conformité RBQ absente, paie CCQ inexistante, données hébergées à l'étranger. Les TPE/PME québécoises de construction se retrouvent à bricoler dans Excel ou à payer 200-500 $/mois par utilisateur pour un produit qui ne parle pas leur réalité.

**Constructo AI** est la réponse open source à ce problème. Apache 2.0, code librement modifiable, hébergeable sur votre propre infrastructure, et calibré au millimètre pour la conformité québécoise — TPS/TVQ, RBQ, CCQ, CNESST, Loi 16, Loi 25, RRQ, RQAP, FSS.

> **Vision :** mettre entre les mains des entrepreneurs québécois un outil qu'ils peuvent inspecter, adapter, héberger et auditer — sans abonnement captif ni boîte noire.

---

## À qui ça s'adresse ?

| Profil | Cas d'usage typique |
|---|---|
| **Entrepreneur général** | CRM clients, devis/soumissions, projets, facturation, paie CCQ, comptabilité, conformité RBQ |
| **Sous-traitant spécialisé** | Pointage GPS terrain, bons de travail mobile, gestion d'équipes, factures rapides |
| **Donneur d'ouvrage public/privé** | Lancement d'appels d'offres conformes Québec (SEAOP), évaluation des soumissions, traçabilité |
| **Gestionnaire immobilier** | Suivi de patrimoine, fonds de prévoyance, maintenance préventive, conformité Loi 16 |
| **Développeur / intégrateur** | Fork, adaptation à un métier voisin (rénovation résidentielle, paysagement, démolition), revente |
| **Consultant ou comptable construction** | Mandat blanc/marque blanche pour vos clients PME |

---

## Les trois applications

### 🏢 ERP_REACT — ERP web multi-tenant
**Backend FastAPI (35 routers) + Frontend React (45 pages, 36 stores Zustand).** Le cœur de la plateforme. CRM, projets (avec dépendances et Gantt), devis et soumissions, comptabilité avec OCR factures par Claude Vision, facturation, paie québécoise CCQ, inventaire, conformité (RBQ/CCQ/CNESST/Revenu Québec/ARC), gestion immobilière (Loi 16), portail B2B, intégration Stripe, métré interactif sur plans PDF, visualisation 3D des murs paramétriques, 11 calculateurs métier, 6 profils d'assistants IA pré-configurés plus système d'experts personnalisables par tenant.

### 📱 MOBILE_REACT — PWA mobile terrain
**Backend FastAPI + Frontend React PWA installable (19 pages, manifest standalone).** Pointage CCQ avec GPS obligatoire et snapshot météo Open-Meteo, photos chantier validées par magic bytes (≤5 Mo, ≤8 par note), notes vocales enrichies par Claude (transcription + analyse de photo Vision + résumé de dossier), bons de travail assignés avec signature électronique, messagerie d'équipe (canaux publics + DM + threads + réactions), audit log polymorphe Loi 25 avec filtrage granulaire, Stripe Payment Links auto-générés par facture avec webhook de fermeture automatique.

### 📋 SEAOP_REACT — Plateforme publique d'appels d'offres
**Backend FastAPI (10 routers) + Frontend React (12 pages).** Conforme aux exigences québécoises : 17 régions administratives officielles, validation des licences RBQ, cautionnement modélisé (inclusion, montant, type), messagerie bilatérale client/entrepreneur par projet, évaluation 1-5 étoiles post-projet, service public d'estimation avec wizard et traitement administrateur, calcul automatique d'urgence basé sur le délai restant.

Les trois applications partagent **27 modules Python communs** à la racine du dépôt (auth, multi-tenant, sécurité, Stripe, IA, monitoring, cache, taxes) et une base **PostgreSQL** unique avec **isolation par schémas tenant**.

---

## Fonctionnalités phares

Quelques composants distinctifs qui sortent du cadre habituel d'un ERP générique :

### 🧾 OCR de factures fournisseurs par Claude Vision
Le router `accounting` expose `/invoices/ai/scan` qui pousse une image (JPEG/PNG) ou un PDF multi-pages (≤20 Mo) vers **`claude-sonnet-4-6`** avec vision. Claude extrait : numéro, date, fournisseur (matché par similarité contre la base existante), montants HT/TPS/TVQ, lignes de détail, conditions de paiement — et retourne un **score de confiance** sur chaque champ. La facturation utilisateur passe par un système de **crédits prépayés** (table `ai_prepaid_credits`) avec ajustement +30 % sur le coût Anthropic, rechargeable via Stripe.

### 📐 Métré interactif sur plans PDF
Le module `metre_pdf` rend les PDF côté serveur via **PyMuPDF (fitz)** avec cache 50 pages (TTL 1h), puis le frontend `metre-pdf/` superpose un canvas Fabric.js. Fonctionnalités :
- **Calibration par page** (1 segment connu → échelle pixel/unité réelle)
- **Snap magnétique 4 points** : extrémité, milieu, intersection, perpendiculaire
- **Types de mesure** : distance, surface, périmètre, angle, comptage
- **Organisation par calques** avec couleurs et visibilité
- **Liaison automatique au catalogue produits** (une mesure → un produit → un devis)
- **Export CSV/JSON** avec résumé par page et par calque
- **Export PNG haute résolution** pour annexer à un devis (résolution adaptative, 6000 px max)

### 🏗️ Visualisation 3D des murs paramétriques
Le composant `MurWall3D.tsx` utilise **three.js + @react-three/fiber + @react-three/drei** pour afficher en temps réel un mur paramétrique avec ses couches (structure, isolant, pare-vapeur, finition intérieure/extérieure), épaisseurs et coefficients thermiques RSI. Contrôles orbitaux pour inspecter sous tous les angles.

### 🤖 Assistants IA spécialisés + experts personnalisables
**6 profils pré-configurés** dans `AI_PROFILES` : Expert Construction (RBQ/CCQ/CNB), Estimateur, Comptable Construction, Conseiller Juridique, Expert Sécurité (CNESST/SST), Assistant général polyvalent. Le profil général adapte automatiquement son expertise à 11 spécialités (électricité, plomberie, structure, toiture, isolation, soudure, gestion ERP…). En plus : chaque tenant peut **créer ses propres experts** avec documents attachés (PDF, manuels, normes internes) que l'IA utilise comme base de connaissance. Modèle utilisé : `claude-sonnet-4-6`. Outils IA : `recherche_bd` (SELECT seulement, avec garde anti-injection) et `executer_action` (mutations contrôlées par permissions).

### 📱 Pointage CCQ géolocalisé avec météo
Le pointage mobile (`/punch/in`, `/punch/out`) capture **obligatoirement** la position GPS. Si le GPS est indisponible (permissions refusées, desktop), fallback vers l'adresse du chantier rattaché au bon de travail. Chaque entrée enregistre un **snapshot météo Open-Meteo** (température, précipitations, humidité, vent) — utile pour justifier un retard ou documenter une intervention par mauvais temps.

### 💳 Paiement de factures par Stripe Payment Links
Pour chaque facture, l'endpoint `/documents/factures/{id}/payment-link` crée à la demande un **Product + Price + PaymentLink** Stripe en CAD, stocke l'URL en base et la retourne. Le webhook `checkout.session.completed` marque automatiquement la facture en `PAYEE`. Le lien est mis en cache : redemandé → renvoyé tel quel sans nouvel appel Stripe.

### 🔍 Audit log polymorphe Loi 25
Une table `audit_events` unique couvre toutes les entités (factures, devis, dossiers, pointages, employés, sessions). L'endpoint `/audit/events` permet de filtrer par `entity_type`, `entity_id`, `employee`, `action` (create/update/delete/login/punch_in/punch_out), `timeframe` (since/until ISO 8601). Réservé aux administrateurs, pagination par offset, 500 événements maximum par page — suffisant pour répondre à une demande d'accès Loi 25 ou un audit interne.

### 🧪 Bac à sable SQL contrôlé pour l'IA
Quand l'utilisateur pose une question business à l'assistant IA ("combien de factures impayées de plus de 30 jours ?"), Claude génère une requête SQL via l'outil `recherche_bd`. Avant exécution, un filtre bloque les mots-clés dangereux (`DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, etc.), force `SELECT`, et restreint l'exécution au schéma du tenant courant. Aucune mutation possible via ce canal — les modifications passent par `executer_action` qui valide les permissions explicitement.

---

## Conçu pour la réalité québécoise

| Domaine | Détail |
|---|---|
| **Taxes** | TPS 5 % + TVQ 9,975 % calculées et déclarées automatiquement |
| **Paie CCQ** | **28 métiers** avec qualifications (Apprenti 4 périodes, Grutier 4 classes, Soudeur 3 classes, Opérateur d'équipement lourd 4 classes, etc.), retenues RRQ, RQAP, FSS, CNESST, AE, impôt provincial et fédéral, taux 2025 intégrés |
| **5 attestations québécoises** | Revenu Québec, ARC, CNESST, CCQ (état de situation), RBQ (solvabilité) — gestion centralisée des dates d'échéance et alertes |
| **Licences RBQ** | Stockage et association aux entrepreneurs et soumissions (validation de format, expirations) |
| **CNESST** | Codes d'unités, taux par classe de risque, cotisations employeur |
| **Loi 16 (immobilier)** | Fonds de prévoyance, plan triennal d'entretien, carnet de bâtiment, déblocages, inspections |
| **Loi 25 (vie privée)** | Audit log polymorphe, traçabilité complète des accès aux données personnelles, export pour demandes d'accès |
| **17 régions administratives** + Autre | Découpage officiel du Québec, du Bas-Saint-Laurent à la Côte-Nord, filtrage géographique sur appels d'offres |
| **7 types de projet** | Résidentiel unifamilial, résidentiel multifamilial, commercial, industriel, institutionnel, rénovation majeure, agrandissement |
| **Code du bâtiment** | Référencement des chapitres applicables dans les modules de conformité (CNB, CSA A23.3, CSA C22.1, CSA W47.1) |

---

## Calculateurs métier intégrés

**11 calculateurs** implémentés dans `routers/calculators.py`, conformes aux normes locales, accessibles depuis l'ERP web ou exposés via API REST :

| Calculateur | Entrées | Sortie / formule clé |
|---|---|---|
| **Béton** | Longueur × largeur × épaisseur (m) | Volume m³ + dosage (300 kg ciment, 700 kg sable, 1 200 kg gravier/m³) + nb sacs |
| **Escaliers** | Hauteur totale, giron cible (mm) | Nombre de marches, contremarches, conformité **CCQ 2R+G ∈ [580-660] mm** |
| **Électricité** | Puissance (W), tension (V), longueur (m) | Chute de tension, **calibre AWG**, ampérage disjoncteur (CSA C22.1) |
| **Toiture** | Longueur × largeur, pente (x:12) | Surface réelle (pente), nb carrés (9,29 m²), bundles bardeaux |
| **Peinture** | Surface pièce, portes, fenêtres | Litres requis (10 m²/L par défaut), nb couches |
| **Plomberie** | Nombre de fixtures (toilettes, lavabos, douches…) | Diamètres tuyauterie, raccords |
| **CVAC** | Surface (m²), isolation, zone climatique | Capacité BTU requise, sélection équipement |
| **Soudure** | Type de joint, épaisseur, longueur | Électrodes, gaz, ampérage par épaisseur (CSA W47.1) |
| **Pliage métal** | Longueur, angle, matériau | Développement, allowance, retour élastique |
| **Poids métal** | Forme (plaque/tube), matériau, dimensions | Poids (densités intégrées : acier 7 850, alu 2 700 kg/m³) |
| **Taxes Québec** | Montant HT | TPS 5 %, TVQ 9,975 %, TTC |

Tous les résultats sont **versionnés**, **traçables** (qui a calculé quoi, quand) et **exportables** en PDF ou Excel pour intégration directe à un devis.

---

## Architecture technique

```
┌─────────────────────────────────────────────────────────────────┐
│                         Utilisateurs                            │
│   Web ERP (5174)    Mobile PWA (5175)    Public SEAOP (5173)    │
└────────┬────────────────────┬───────────────────┬───────────────┘
         │                    │                   │
   ┌─────▼──────┐       ┌─────▼──────┐      ┌─────▼──────┐
   │ React 18   │       │ React PWA  │      │ React 18   │
   │ Vite + TS  │       │ Vite + TS  │      │ Vite + TS  │
   │ Zustand    │       │ Zustand    │      │ Zustand    │
   └─────┬──────┘       └─────┬──────┘      └─────┬──────┘
         │                    │                   │
         │ HTTPS / JWT        │ HTTPS / JWT       │ HTTPS / JWT
         │                    │                   │
   ┌─────▼─────────────────────▼───────────────────▼──────┐
   │              FastAPI backends (Python 3.11+)         │
   │  erp_api:8003   mobile_api:8003   seaop_api:8002     │
   │  35 routers     1 routeur monolithique   10 routers  │
   └─────┬─────────────────────┬───────────────────┬──────┘
         │                     │                   │
         │   ┌─────────────────▼─────────────────┐ │
         │   │    27 modules Python partagés     │ │
         │   │ auth · multi-tenant · sécurité    │ │
         │   │ Stripe · IA · cache · monitoring  │ │
         │   └─────────────────┬─────────────────┘ │
         │                     │                   │
   ┌─────▼─────────────────────▼───────────────────▼──────┐
   │          PostgreSQL 14+ — multi-tenant               │
   │   schéma public            schéma tenant_<uuid>      │
   │   (clients, api_keys)      (données isolées par     │
   │                             entreprise cliente)      │
   └──────────────────────────────────────────────────────┘
         │                     │                   │
   ┌─────▼──────┐       ┌──────▼─────┐      ┌──────▼─────┐
   │  Stripe    │       │ Anthropic  │      │  Sentry    │
   │  paiements │       │ Claude API │      │ monitoring │
   └────────────┘       └────────────┘      └────────────┘
```

### Isolation multi-tenant

L'isolation entre clients (« tenants ») repose sur le mécanisme natif de **schémas PostgreSQL** :

1. Le schéma `public` contient la table maître des entreprises clientes (`entreprises`, `api_keys`, super-administrateurs).
2. Chaque client reçoit un schéma dédié `tenant_<nom>_<uuid>` (pattern validé par regex) qui contient **toutes ses données métier**.
3. À chaque requête HTTP, le middleware résout l'identité du tenant à partir du JWT et exécute `SET search_path = tenant_<…>, public` sur la connexion.
4. Avant que la connexion ne retourne au pool, le `search_path` est explicitement remis à `public` — sinon la connexion est détruite pour éviter toute fuite de contexte entre clients.

Ce modèle est plus simple à opérer qu'une base par tenant (une seule base à sauvegarder) tout en garantissant qu'aucune requête mal écrite ne peut traverser la frontière de schéma.

---

## Stack précise

### Backend (Python 3.11+)

| Domaine | Bibliothèque | Version |
|---|---|---|
| Framework HTTP | FastAPI · Uvicorn | 0.115+ · 0.32+ |
| Base de données | SQLAlchemy · psycopg2-binary · Alembic | 2.0+ · 2.9.10+ · 1.14+ |
| Validation | Pydantic | v2 |
| Authentification | python-jose · bcrypt · cryptography | JWT · 5.0+ · 46.0+ |
| IA | anthropic (Claude API) | 0.67+ |
| Paiements | stripe | 11.3+ |
| Monitoring | sentry-sdk | 2.19+ |
| Documents | reportlab · pypdf · python-docx | génération PDF/DOCX |
| Géospatial | folium · geopy | cartes et géocodage |
| CAO/3D | trimesh · ezdxf · ifcopenshell | parsing 3D/BIM |
| Tests | pytest · pytest-asyncio · httpx | — |

### Frontend (Node 20+)

| Domaine | Bibliothèque | Version |
|---|---|---|
| Framework | React · TypeScript | 18.3 · 5.6 |
| Bundler | Vite | 6.0 |
| Routing | react-router-dom | 6.28 |
| State | Zustand | 5.0 |
| HTTP | axios | 1.16 |
| Styling | Tailwind CSS · clsx | 3.4 · 2.1 |
| Icônes | lucide-react | 0.400 |
| Graphiques | recharts | 2.15 |
| PDF | pdfjs-dist · jsPDF · jspdf-autotable | 4.10 · 4.2 · 5.0 |
| Canvas 2D | fabric.js | 7.4 |
| 3D | three.js · @react-three/fiber · @react-three/drei | 0.168 · 8.17 · 9.122 |
| Sécurité | dompurify | 3.3 |

### Sécurité automatisée (CI)

| Outil | Rôle |
|---|---|
| **pip-audit** (OSV) | Scan vulnérabilités Python à chaque push/PR |
| **npm audit** (high+) | Scan vulnérabilités frontend (3 apps) à chaque push/PR |
| **CodeQL** (security-extended) | Analyse statique Python + JavaScript/TypeScript |
| **Gitleaks** | Détection de secrets fuités dans l'historique git |
| **Dependabot** | Mises à jour hebdomadaires automatiques |

---

## Démarrage rapide

### Prérequis

- Python **3.11+**
- Node.js **20+**
- PostgreSQL **14+**

### Installation

```bash
# 1. Cloner le dépôt
git clone https://github.com/ConstructoAI/Code_Libre.git
cd Code_Libre

# 2. Configurer les variables d'environnement
cp .env.example .env
# Éditer .env : DATABASE_URL, secrets JWT, ADMIN_PASSWORD, etc.

# 3. Installer les dépendances Python
pip install -r requirements.txt

# 4. Lancer le backend ERP (port 8003)
cd ERP_REACT/backend
uvicorn erp_api:app --reload --port 8003

# 5. Dans un autre terminal — frontend ERP (port 5174)
cd ERP_REACT/frontend
npm install
npm run dev
```

Reproduire les étapes 4-5 pour les autres applications :

| App | Backend | Frontend |
|---|---|---|
| ERP_REACT | `uvicorn erp_api:app --port 8003` | `npm run dev` → http://localhost:**5174** |
| MOBILE_REACT | `uvicorn mobile_api:app --port 8003` | `npm run dev` → http://localhost:**5175** |
| SEAOP_REACT | `uvicorn seaop_api:app --port 8002` | `npm run dev` → http://localhost:**5173** |

Le backend `MOBILE_REACT` peut tourner sur le même port que l'ERP en développement local — il sert une API distincte mais utilise la même base PostgreSQL.

### Générer un secret JWT robuste

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

---

## Variables d'environnement

Liste complète et commentée dans [`.env.example`](.env.example). Principales :

| Variable | Description | Requise |
|---|---|---|
| `DATABASE_URL` | URL PostgreSQL — `postgresql://user:pass@host:5432/db` | ✅ |
| `ERP_JWT_SECRET` | Secret JWT pour ERP_REACT | ✅ en prod |
| `JWT_SECRET_KEY` | Secret JWT pour MOBILE_REACT | ✅ en prod |
| `SEAOP_JWT_SECRET` | Secret JWT pour SEAOP_REACT | ✅ en prod |
| `ADMIN_PASSWORD` | Mot de passe du super-administrateur initial | ✅ |
| `ENVIRONMENT` | `development` ou `production` (active les guards stricts) | ✅ en prod |
| `ALLOWED_ORIGINS` | Origines CORS autorisées (CSV — jamais `*` en prod) | recommandée |
| `APP_BASE_URL` | URL publique de votre instance | recommandée |
| `ANTHROPIC_API_KEY` | Clé API Anthropic (OCR factures, assistants IA) | optionnelle |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe (paiements, abonnements) | optionnelle |
| `SMTP_HOST` · `SMTP_USER` · `SMTP_PASSWORD` | Envoi d'emails (devis, notifications) | optionnelle |
| `SENTRY_DSN` | Monitoring d'erreurs Sentry | optionnelle |

---

## Documentation de l'API

FastAPI génère automatiquement une documentation **OpenAPI 3** interactive pour chaque backend. Une fois le serveur lancé :

| App | Swagger UI | ReDoc | Schéma JSON |
|---|---|---|---|
| ERP | http://localhost:8003/docs | http://localhost:8003/redoc | http://localhost:8003/openapi.json |
| Mobile | http://localhost:8003/docs | http://localhost:8003/redoc | http://localhost:8003/openapi.json |
| SEAOP | http://localhost:8002/docs | http://localhost:8002/redoc | http://localhost:8002/openapi.json |

Tous les endpoints sont **typés** par Pydantic v2 — les corps de requête et de réponse sont validés à l'exécution. La doc OpenAPI peut être importée dans **Postman**, **Insomnia**, ou utilisée pour générer un client TypeScript/Python automatiquement.

### Manuel utilisateur

L'ERP est livré avec **29 chapitres** de documentation utilisateur en français dans [`ERP_REACT/docs/manuel/`](ERP_REACT/docs/manuel/), couvrant chaque module (tableau de bord, CRM, soumissions, projets, comptabilité, paie, calculateurs, intégrations, etc.).

---

## Tests et CI

```bash
# Tests Python (à la racine)
pytest

# Tests avec couverture
pytest --cov

# Typecheck frontend (par app)
cd ERP_REACT/frontend && npm run typecheck

# Build de production frontend
npm run build

# Lint
npm run lint
```

Chaque push et chaque pull request déclenche automatiquement le workflow [**Security scan**](.github/workflows/security.yml) :

- `pip-audit` — vulnérabilités Python (OSV)
- `npm audit` — vulnérabilités frontend (high+) pour les 3 apps en parallèle
- `CodeQL` — analyse statique Python + JS/TS (queries `security-extended`)
- `Gitleaks` — détection de secrets dans l'historique

Un scan complet supplémentaire tourne **chaque lundi à 02h00 EDT** pour capter les CVE nouvellement publiées.

---

## Sécurité et mise en production

> **Politique de divulgation responsable :** voir [SECURITY.md](SECURITY.md). Pour signaler une vulnérabilité, écrivez à **info@constructoai.ca** — ne pas ouvrir d'issue publique.

### Défense en profondeur

- **Authentification** : JWT signé HS256/HS512, secrets distincts par application, vérification à constant-time (`hmac.compare_digest`)
- **Mots de passe** : bcrypt 12 rounds, jamais stockés en clair, jamais journalisés
- **Headers HTTP** : HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy activés par défaut en production
- **Validation des entrées** : Pydantic v2 strict, magic bytes pour les uploads, sanitization Content-Disposition, DOMPurify côté client
- **Rate limiting** : middleware par IP et par utilisateur, configurable par route
- **Isolation tenant** : `search_path` PostgreSQL réinitialisé à chaque retour au pool
- **Audit log Loi 25** : tracking polymorphe des accès aux données personnelles

### Checklist avant mise en production

- [ ] Copier `.env.example` → `.env` et remplir **tous** les secrets requis
- [ ] Définir `ENVIRONMENT=production` (active les guards stricts : cookies `Secure`, JWT obligatoire)
- [ ] Configurer `ALLOWED_ORIGINS` avec votre domaine exact (**jamais `*`**)
- [ ] Activer **HTTPS** sur tous les services (terminaison TLS recommandée via reverse proxy)
- [ ] Activer **Sentry** (`SENTRY_DSN`) pour le monitoring d'erreurs en production
- [ ] Activer la **MFA** sur tous les comptes administrateur (plateforme, Stripe, hébergeur base de données)
- [ ] Configurer des **backups automatiques** chiffrés de la base PostgreSQL (recommandé : quotidien + rétention 30 jours minimum)
- [ ] Planifier une **rotation périodique** des secrets JWT (180 jours)
- [ ] Surveiller les logs d'authentification, rate limit et 5xx
- [ ] **Audit de pénétration professionnel** recommandé avant tout déploiement à fort trafic ou traitant des données sensibles

---

## Comparaison avec les SaaS commerciaux

|  | Constructo AI | Procore | Buildertrend | Maestro\* |
|---|---|---|---|---|
| **Licence** | Apache 2.0 (libre) | Propriétaire | Propriétaire | Propriétaire |
| **Code source** | ✅ Inspectable | ❌ Boîte noire | ❌ Boîte noire | ❌ Boîte noire |
| **Hébergement** | Vos serveurs ou cloud | Cloud US | Cloud US | Cloud QC/US |
| **Coût** | Gratuit (auto-hébergement) | 375 $+/mois | 199 $+/mois/utilisateur | Sur devis |
| **Multi-tenant** | ✅ Schémas isolés | ✅ | ✅ | ✅ |
| **Taxes TPS/TVQ** | ✅ Natif | ⚠️ Configuration | ⚠️ Configuration | ✅ |
| **Paie CCQ** | ✅ Natif | ❌ | ❌ | ⚠️ Module |
| **Conformité RBQ** | ✅ Natif | ❌ | ❌ | ⚠️ Partiel |
| **Loi 25 / 16** | ✅ Audit log | ❌ | ❌ | ⚠️ |
| **Modifiable** | ✅ Forkable | ❌ | ❌ | ❌ |
| **Intégration IA** | ✅ Claude (au choix) | ⚠️ Limité | ⚠️ Limité | ❌ |
| **Données souveraines** | ✅ Hébergement QC possible | ❌ US | ❌ US | ✅ |

*Les détails et tarifs des concurrents sont fournis à titre informatif et peuvent varier — vérifiez auprès des éditeurs.*

---

## Limitations connues et feuille de route

Par transparence — voici ce qui n'est **pas encore** dans le code et ce sur quoi des contributions seraient particulièrement bienvenues :

| Limite actuelle | Détail | Statut |
|---|---|---|
| **Sync offline mobile complète** | Le manifest PWA permet l'installation, mais le Service Worker ne supporte pas encore les écritures hors ligne (punch, notes, photos) avec resync différée | 🟡 Partiel |
| **Validation RBQ via API externe** | Les numéros RBQ sont stockés et associés mais leur validation se fait sur format seulement (pas d'appel à la base publique de la RBQ) | 🟡 Format uniquement |
| **Filtrage géographique par MRC** | Le filtrage SEAOP fonctionne via codes postaux et nom de région. Un mapping postal→MRC officielle n'est pas câblé | 🟡 Codes postaux |
| **Évaluation post-projet bidirectionnelle** | SEAOP permet l'évaluation client→entrepreneur. L'inverse (entrepreneur→client) n'est pas exposé | 🟡 Unidirectionnel |
| **Import depuis Procore / Buildertrend** | Des scripts CSV existent pour les structures standards, mais pas de connecteur API direct | 🟡 CSV seulement |
| **Export DXF / IFC** | Le métré exporte CSV/JSON et PNG haute résolution. L'export vers DXF/IFC pour réintégration CAO n'est pas implémenté | 🔴 À faire |
| **Notifications temps réel** | Les notifications passent par email/polling, pas de WebSocket persistant | 🔴 À faire |
| **Tests E2E frontend** | Couverture pytest sur le backend uniquement. Playwright/Cypress non configurés | 🔴 À faire |

Ces points sont sur la **roadmap interne** de Constructo AI Inc. et sont traités dans l'ordre dicté par les besoins des clients du SaaS hébergé.

---

## Contribution

Constructo AI est avant tout **le code de production de Constructo AI Inc.**, opéré en SaaS hébergé. Sa roadmap est dictée par les besoins des clients payants. À ce titre, **les contributions externes ne sont pas activement sollicitées** et ne sont généralement pas mergées.

Si vous souhaitez tout de même proposer un changement, voici les seuls cas où une PR sera examinée :

- 🔒 **Correctif de sécurité** documenté (référez-vous d'abord à [SECURITY.md](SECURITY.md))
- 🐛 **Correctif de bug critique** avec reproduction claire et test associé
- 📝 **Amélioration de documentation** (manuel utilisateur, README, exemples) factuelle et vérifiable

Pour tout autre cas (nouvelle fonctionnalité, refactoring, ajout d'intégration, traduction, etc.), **ouvrez d'abord une [Discussion](https://github.com/ConstructoAI/Code_Libre/discussions)** pour valider l'intérêt avant d'investir du temps en code. Une PR ouverte sans discussion préalable sera vraisemblablement fermée sans revue.

Toute contribution acceptée est publiée sous licence [Apache 2.0](LICENSE). Les contributeurs significatifs sont mentionnés dans [NOTICE](NOTICE).

Pour les détails techniques (style de code, tests, sécurité), voir [CONTRIBUTING.md](CONTRIBUTING.md).

---

## FAQ

**Puis-je l'utiliser commercialement ?**
Oui — la licence Apache 2.0 autorise l'usage commercial, y compris en revente, à condition de conserver l'attribution (voir [NOTICE](NOTICE)).

**Dois-je rendre publiques mes modifications ?**
Non. Apache 2.0 n'a pas d'effet « copyleft » : vous pouvez maintenir un fork privé. Seules les modifications du fichier `NOTICE` doivent être préservées.

**Est-ce que ça marche sans clé Anthropic / Stripe ?**
Oui. Les intégrations IA (OCR factures, assistants Claude) et paiement Stripe sont **optionnelles**. L'ERP, le pointage, la paie, la facturation et les calculateurs fonctionnent sans elles.

**Combien d'utilisateurs simultanés ?**
Le pool psycopg2 est configuré pour 10-75 connexions par défaut, suffisant pour ~100-300 utilisateurs actifs simultanés sur un serveur 4 cœurs / 8 Go. Au-delà, augmenter `DB_POOL_MAX` et passer en mode multi-worker uvicorn.

**Est-ce production-ready ?**
Constructo AI est déjà utilisé en production par Constructo AI Inc. La version open source publie le code stable utilisé en interne. Pour un déploiement critique, un audit de sécurité indépendant est recommandé (voir checklist plus haut).

**Comment migrer depuis Procore / Buildertrend / Excel ?**
Des scripts d'import existent pour les CSV standards (clients, projets, factures). Pour les cas complexes, Constructo AI Inc. offre un service d'accompagnement payant — voir [Support et contact](#support-et-contact).

**Puis-je héberger ça hors du Québec ?**
Techniquement oui (rien n'est codé en dur géographiquement), mais les obligations de la Loi 25 imposent que les données personnelles des résidents québécois soient hébergées dans une juridiction offrant un niveau de protection équivalent. Hébergement au Québec, en France ou au Canada recommandé.

---

## Licence et attribution

**Apache License 2.0** — Utilisation commerciale autorisée, modifications permises, distribution libre. Voir [LICENSE](LICENSE) pour les termes complets.

### Attribution requise

Conformément au fichier [NOTICE](NOTICE), tout produit dérivé doit afficher la mention suivante dans sa documentation, son interface utilisateur et ses communications :

> **« Basé sur Constructo AI — gracieuseté de Constructo AI Inc. »**
> [https://constructoai.ca](https://constructoai.ca)

---

## Support et contact

| | |
|---|---|
| **Mainteneur principal** | Sylvain Leduc — Constructo AI Inc. |
| **Courriel** | [info@constructoai.ca](mailto:info@constructoai.ca) |
| **Téléphone** | 514-820-1972 |
| **Web** | [https://constructoai.ca](https://constructoai.ca) |
| **Vulnérabilités** | Voir [SECURITY.md](SECURITY.md) (divulgation responsable) |

### Services commerciaux

Constructo AI Inc. propose en plus du code libre :

- **Hébergement géré** au Québec (SaaS clé en main avec SLA)
- **Intégration sur mesure** (ERP existant, comptable, banque, fournisseur)
- **Migration de données** depuis Procore, Buildertrend, Maestro, Excel, etc.
- **Formation des équipes** (web ou sur site, en français)
- **Support entreprise** avec délais de réponse garantis
- **Licences sans attribution** (whitelabel) pour intégrateurs

Contactez-nous pour un devis ou une démo personnalisée.

---

<p align="center">
  <sub>Conçu, développé et maintenu par <a href="mailto:info@constructoai.ca"><strong>Sylvain Leduc</strong></a> — développeur principal et fondateur de Constructo AI Inc.</sub><br/>
  <sub>Fait au Québec 🍁 — Pour les entrepreneurs en construction du Québec.</sub><br/>
  <sub>Code libre · Données souveraines · Conformité locale</sub>
</p>
