# Manuel utilisateur — ERP Constructo

> **Logiciel de gestion intégré pour entreprises de construction au Québec**
> **Date** : 2026-04-26
> **Version** : 2.0 (29 modules — couverture menu sidebar complète, audit QA validé)
> **Public cible** : utilisateurs finaux (chefs de projet, gestionnaires, comptables, employés terrain, administrateurs)

---

## État de la documentation

Ce dossier contient les **29 manuels utilisateur** couvrant l'ensemble du menu sidebar de l'ERP Constructo.

| Statut | Signification |
|---|---|
| 🟢 **v2.0 vérifié + QA passé** | Manuel rédigé/refait à partir du code source réel + audit multi-agent appliqué |

**Tous les manuels sont en v2.0 vérifié + QA** — chaque affirmation est traçable jusqu'au code (`backend/routers/*.py`, `frontend/src/pages/*.tsx`, `frontend/src/api/*.ts`).

**Convention de nommage** : `NN-section-module.md` où `NN` reflète l'ordre dans le menu sidebar (Principal → Suivi → Gestion → Ventes → Opérations → Terrain → Communication → Outils → Configuration → Aide).

---

## Table des matières — par section du menu

### Principal

| # | Module | Fichier |
|---|---|---|
| 01 | **Tableau de bord** | [01-principal-tableau-de-bord.md](./01-principal-tableau-de-bord.md) |
| 02 | **Analyses** | [02-principal-analyses.md](./02-principal-analyses.md) |

### Suivi

| # | Module | Fichier |
|---|---|---|
| 03 | **Suivi / Gantt** | [03-suivi-gantt.md](./03-suivi-gantt.md) |

### Gestion

| # | Module | Fichier |
|---|---|---|
| 04 | **Entreprises** (clients/fournisseurs) | [04-gestion-entreprises.md](./04-gestion-entreprises.md) |
| 05 | **Contacts** | [05-gestion-contacts.md](./05-gestion-contacts.md) |
| 06 | **CRM** (opportunités, pipeline) | [06-gestion-crm-opportunites.md](./06-gestion-crm-opportunites.md) |

### Ventes

| # | Module | Fichier |
|---|---|---|
| 07 | **Dossiers** (Fiche 360) | [07-ventes-dossiers.md](./07-ventes-dossiers.md) |
| 08 | **Soumissions** (Devis) | [08-ventes-soumissions.md](./08-ventes-soumissions.md) |
| 09 | **Projets** | [09-ventes-projets.md](./09-ventes-projets.md) |

### Opérations

| # | Module | Fichier |
|---|---|---|
| 10 | **Magasin** (Inventaire) | [10-operations-magasin.md](./10-operations-magasin.md) |
| 11 | **Employés** (RH) | [11-operations-employes.md](./11-operations-employes.md) |
| 12 | **Bons de Travail** (BT) | [12-operations-bons-de-travail.md](./12-operations-bons-de-travail.md) |
| 13 | **Pointage** | [13-operations-pointage.md](./13-operations-pointage.md) |
| 14 | **Bons de Commande** (Achats) | [14-operations-bons-de-commande.md](./14-operations-bons-de-commande.md) |
| 15 | **Comptabilité** (Factures) | [15-operations-comptabilite.md](./15-operations-comptabilite.md) |

### Terrain

| # | Module | Fichier |
|---|---|---|
| 16 | **Météo Chantier** | [16-terrain-meteo-chantier.md](./16-terrain-meteo-chantier.md) |
| 17 | **Conformité RBQ/CCQ** | [17-terrain-conformite.md](./17-terrain-conformite.md) |
| 18 | **Subventions** | [18-terrain-subventions.md](./18-terrain-subventions.md) |
| 19 | **Immobilier** | [19-terrain-immobilier.md](./19-terrain-immobilier.md) |
| 20 | **Logistique** | [20-terrain-logistique.md](./20-terrain-logistique.md) |
| 21 | **Location** | [21-terrain-location.md](./21-terrain-location.md) |
| 22 | **Maintenance** | [22-terrain-maintenance.md](./22-terrain-maintenance.md) |

### Communication

| # | Module | Fichier |
|---|---|---|
| 23 | **Emails** | [23-communication-emails.md](./23-communication-emails.md) |
| 24 | **Messagerie** | [24-communication-messagerie.md](./24-communication-messagerie.md) |
| 25 | **Assistant IA** | [25-communication-assistant-ia.md](./25-communication-assistant-ia.md) |

### Outils

| # | Module | Fichier |
|---|---|---|
| 26 | **Calculateurs** | [26-outils-calculateurs.md](./26-outils-calculateurs.md) |
| 27 | **Web** (recherche intégrée) | [27-outils-web.md](./27-outils-web.md) |

### Configuration

| # | Module | Fichier |
|---|---|---|
| 28 | **Configuration / Administration** | [28-configuration.md](./28-configuration.md) |

### Aide & Ressources

| # | Module | Fichier |
|---|---|---|
| 29 | **Aide & Ressources** (liens externes) | [29-aide-ressources.md](./29-aide-ressources.md) |

---

## Total documentation

- **29 manuels** en français Québec
- **~960 KB** de documentation utilisateur professionnelle
- **100% couverture** du menu sidebar de l'ERP
- **Zéro hallucination** — chaque affirmation traçable jusqu'au code source
- **Audit QA multi-agent** appliqué sur les 29 manuels (~70 bugs détectés et corrigés)

---

## Refonte v2.0 — TERMINÉE ✅ (29/29 modules)

### Méthodologie v2.0

1. **Phase 1 — Audit exhaustif** : agents multi-agent lisent l'intégralité du backend (router Python) + frontend (page TSX) + API client + types.
2. **Phase 2 — Rédaction stricte** : aucune supposition, aucune fonctionnalité « probable ». Chaque affirmation vérifiée contre le code (référencée par fichier:ligne).
3. **Phase 3 — Documentation des limitations** : les fonctionnalités absentes du code sont explicitement listées comme « PAS implémentées ».
4. **Phase 4 — Audit QA multi-agent** : 7 agents en parallèle vérifient les 29 manuels selon 14 critères (structure, cohérence code, hallucinations, qualité, cross-refs).
5. **Phase 5 — Renommage intuitif** : numérotation alignée sur l'ordre du menu sidebar.

### Résultats

- **29/29 modules** ✅ vérifiés + QA passé
- **Convention de nommage** : `NN-section-module.md` (ex: `04-gestion-entreprises.md`)
- **Limitations connues exposées** : pas de PMP complet, pas de mobile desktop, pas d'audit log centralisé, pas de drill-down dashboard, FK déclarées mais non remplies, etc.

---

## Comment utiliser ce manuel

### Pour les nouveaux utilisateurs

Ordre suggéré pour découvrir l'ERP :

1. [Tableau de bord (01)](./01-principal-tableau-de-bord.md) — vue d'ensemble
2. [Entreprises (04)](./04-gestion-entreprises.md) — clients & fournisseurs
3. [Contacts (05)](./05-gestion-contacts.md) — personnes
4. [Projets (09)](./09-ventes-projets.md) — premier chantier
5. [Soumissions (08)](./08-ventes-soumissions.md) — première soumission

### Pour les rôles spécifiques

| Si vous êtes... | Modules prioritaires |
|---|---|
| **Chef de projet** | Projets (09), Suivi/Gantt (03), Bons de Travail (12), Dossiers (07), Pointage (13), Météo (16) |
| **Estimateur** | Soumissions (08), Magasin (10), Calculateurs (26), Assistant IA (25) |
| **Comptable** | Comptabilité (15), Bons de Commande (14), Tableau de bord (01), Analyses (02), Subventions (18) |
| **Magasinier / Acheteur** | Magasin (10), Bons de Commande (14), Logistique (20), Maintenance (22) |
| **Contremaître** | Bons de Travail (12), Pointage (13), Employés (11), Dossiers (07), Météo (16) |
| **Promoteur immobilier** | Immobilier (19), CRM (06), Soumissions (08), Comptabilité (15), Subventions (18) |
| **Responsable conformité** | Conformité RBQ/CCQ (17), Employés (11), Subventions (18), Configuration (28) |
| **Responsable flotte/équipement** | Logistique (20), Location (21), Maintenance (22), Magasin (10) |
| **Communications / Service client** | Emails (23), Messagerie (24), CRM (06), Contacts (05) |
| **Administrateur** | Configuration (28), tous les autres |

### Pour rechercher une fonctionnalité

- **Pipeline commercial** : CRM (06) → Soumissions (08) → Projets (09) → Bons de Travail (12) → Comptabilité (15)
- **Cycle achat** : Bons de Commande (14) → Magasin (10) → Comptabilité (15)
- **Cycle terrain** : Projets (09) → Bons de Travail (12) → Pointage (13) → Météo (16) → Logistique (20) → Maintenance (22)
- **Conformité légale Québec** : Conformité RBQ/CCQ (17) + Subventions (18) + Employés (11)
- **Outils** : Calculateurs (26) + Web (27) + Assistant IA (25)

---

## Conventions FR-QC

| Élément | Format | Exemple |
|---|---|---|
| Devise | $ CAD, virgule décimale, espace insécable | 15 000,50 $ |
| Date | AAAA-MM-JJ | 2026-04-26 |
| Heure | HH:MM (24 h) | 13:45 |
| TPS | 5,000 % (fédéral) | |
| TVQ | 9,975 % (provincial Québec) | |

## Formats de numérotation

| Module | Format | Exemple |
|---|---|---|
| Projet | PROJ-AAAA-NNNNN | PROJ-2026-00042 |
| Opportunité | OPP-NNNNN | OPP-00042 |
| Devis | DEV-AAAA-NNN | DEV-2026-001 |
| Bon de Travail | BT-NNNNN | BT-00012 |
| Bon de Commande | BC-NNNNN | BC-00007 |
| Facture | FACT-AAAA-NNNNN | FACT-2026-00031 |
| Dossier | DOS-AAAA-NNNNN | DOS-2026-00001 |
| Terrain (Immobilier) | TER-NNNNN | TER-00012 |
| Contrat de Location | LOC-NNNNN | LOC-00021 |
| Maintenance Request | MR-NNNNN | MR-00045 |
| Subvention (référence interne) | SUB-AAAAMMJJHHMMSS-NNNNN | SUB-20260426143055-00012 |

---

## Architecture technique

- **Backend** : FastAPI Python 3.11+, PostgreSQL multi-tenant
- **Frontend** : React + TypeScript + Vite + Tailwind CSS
- **IA** : Claude Sonnet 4.6 + Opus 4.7 (Anthropic) — selon module
- **Hébergement** : Render.com (Canada — Loi 25)
- **Paiement** : Stripe
- **Stockage fichiers** : PostgreSQL BYTEA
- **Email** : IMAP/SMTP standard (Gmail App Password, M365 OAuth2, GoDaddy, Yahoo, iCloud, custom)
- **Météo** : Open-Meteo (API gratuite, pas de clé)
- **Web** : Outils natifs Claude (web_search, web_fetch)
- **Comptabilité** : Engine interne + intégration QuickBooks Online (sync bidirectionnelle)

---

## Support

| Pour... | Contact |
|---|---|
| Questions utilisateur | Votre administrateur Constructo |
| Demande d'évolution | info@constructoai.ca |
| Bug technique | info@constructoai.ca |
| Tutoriels vidéo | [YouTube ConstructoAI](https://www.youtube.com/channel/UC3EGXYQNj5UYGiyNfiiom_A) |
| Liens utiles externes | [Page liens utiles](https://github.com/ConstructoAI/Documents/blob/main/liens-utiles.md) |

---

*ERP Constructo — README documentation utilisateur — 2026-04-26 — v2.0 (29 modules, audit QA validé, nommage intuitif par section)*
