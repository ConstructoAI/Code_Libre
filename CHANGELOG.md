# Journal des changements

Tous les changements notables de Constructo AI sont documentés ici.

Le format est inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et ce projet adhère au [versionnement sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté
- _Rien pour le moment_

### Modifié
- _Rien pour le moment_

### Corrigé
- _Rien pour le moment_

---

## [1.0.0] — 2026-05-18

**Première version publique open source de Constructo AI.**

Cette version publie le code stable utilisé en production par Constructo AI Inc., sous licence Apache 2.0.

### Ajouté

#### Trois applications complètes

- **ERP_REACT** — ERP web multi-tenant
  - 35 routers FastAPI : authentification, entreprises, projets, devis, comptabilité, paie, CRM, production, inventaire, conformité, immobilier, B2B, Stripe, etc.
  - 45 pages React 18 + TypeScript + Vite
  - 36 stores Zustand
  - 11 calculateurs métier (béton, toiture, peinture, électricité, plomberie, CVAC, escaliers, soudure, pliage métal, poids métal, taxes Québec)
  - OCR de factures fournisseurs via Claude Sonnet 4.6 Vision
  - Métré interactif sur plans PDF (calibration, snap 4 points, calques, liaison catalogue produits)
  - Visualisation 3D des murs paramétriques (three.js + @react-three/fiber + drei)
  - 6 profils d'assistants IA pré-configurés + système d'experts personnalisables par tenant

- **MOBILE_REACT** — PWA mobile terrain
  - 19 pages React + manifest PWA installable
  - Pointage CCQ avec GPS obligatoire et snapshot météo Open-Meteo
  - Notes vocales enrichies par Claude (transcription, analyse de photo Vision, résumé de dossier)
  - Photos chantier validées par magic bytes (≤5 Mo, ≤8 par note)
  - Bons de travail assignés avec signature électronique
  - Messagerie d'équipe (canaux publics, DM, threads, réactions)
  - Audit log polymorphe Loi 25 avec filtrage granulaire
  - Stripe Payment Links auto-générés par facture avec webhook de fermeture automatique

- **SEAOP_REACT** — Plateforme publique d'appels d'offres
  - 10 routers FastAPI + 12 pages React
  - Conformité québécoise : 17 régions administratives, validation RBQ, cautionnement modélisé
  - Messagerie bilatérale client/entrepreneur par projet
  - Évaluation 1-5 étoiles post-projet
  - Service public d'estimation avec wizard et traitement administrateur
  - Calcul automatique d'urgence basé sur le délai restant

#### Conformité québécoise

- TPS 5 % + TVQ 9,975 % automatisées
- Paie CCQ : 28 métiers avec qualifications (Apprenti 4 périodes, Grutier 4 classes, Soudeur 3 classes, Opérateur d'équipement lourd 4 classes, etc.), retenues RRQ, RQAP, FSS, CNESST, AE, impôts provincial et fédéral (taux 2025)
- 5 attestations québécoises : Revenu Québec, ARC, CNESST, CCQ, RBQ
- Loi 16 (immobilier) : fonds de prévoyance, plan triennal, carnet de bâtiment
- Loi 25 (vie privée) : audit log polymorphe, journalisation des accès
- 17 régions administratives officielles + option Autre
- 7 types de projet : résidentiel, commercial, industriel, institutionnel, rénovation, agrandissement

#### Architecture

- **Multi-tenant PostgreSQL** par schémas isolés (`tenant_<nom>_<uuid>`)
- **Authentification JWT** avec secrets distincts par application
- **27 modules Python partagés** à la racine (auth, multi-tenant, sécurité, Stripe, IA, monitoring, cache, taxes)
- **Bac à sable SQL contrôlé** pour l'IA (anti-injection, SELECT-only)

#### Sécurité

- Bcrypt 12 rounds, `hmac.compare_digest`
- Headers HTTP : HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy
- Validation stricte : Pydantic v2, magic bytes pour les uploads, sanitization Content-Disposition
- CI automatisé : pip-audit (OSV), npm audit (high+), CodeQL (security-extended), Gitleaks
- Dependabot configuré (mises à jour hebdomadaires)

#### Documentation

- README v3 complet (542 lignes) avec architecture, stack précise, FAQ, comparaison concurrents, limitations connues
- 29 chapitres de manuel utilisateur dans `ERP_REACT/docs/manuel/`
- OpenAPI 3 auto-générée par FastAPI (`/docs`, `/redoc`, `/openapi.json`)
- SECURITY.md (divulgation responsable)
- NOTICE (attribution Apache 2.0)

### Notes de version

- Hébergement recommandé au Québec, France ou Canada (Loi 25)
- Audit de sécurité indépendant recommandé avant déploiement à fort trafic
- Voir le README pour les variables d'environnement requises et les limitations connues

---

## Format des versions

- **MAJEUR** (X.0.0) — Changements incompatibles avec l'API publique
- **MINEUR** (1.X.0) — Nouvelles fonctionnalités rétrocompatibles
- **PATCH** (1.0.X) — Corrections de bugs rétrocompatibles

[Non publié]: https://github.com/ConstructoAI/Code_Libre/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ConstructoAI/Code_Libre/releases/tag/v1.0.0
