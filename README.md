# Constructo AI — Plateforme open source pour la construction

> Plateforme complète pour entreprises de construction au Québec : ERP web, application mobile de pointage/terrain, et système d'appels d'offres publics.

**Licence : Apache 2.0** — Voir [LICENSE](LICENSE) et [NOTICE](NOTICE) pour l'exigence d'attribution.

---

## Aperçu

Ce dépôt contient trois applications React + FastAPI :

| Application      | Description                                              | Stack technique                |
|------------------|----------------------------------------------------------|--------------------------------|
| **ERP_REACT**    | ERP web multi-tenant (CRM, projets, comptabilité, etc.)  | FastAPI + React 18 + Vite + PostgreSQL |
| **MOBILE_REACT** | App mobile PWA (pointage, bons de travail, terrain)      | FastAPI + React 18 + Vite + PostgreSQL |
| **SEAOP_REACT**  | Plateforme publique d'appels d'offres                    | FastAPI + React 18 + Vite + PostgreSQL |

Modules Python partagés à la racine (auth, multi-tenancy, Stripe, sécurité, etc.) — réutilisés par les trois backends.

---

## Sécurité

> **Politique de divulgation** : voir [SECURITY.md](SECURITY.md). Ne pas ouvrir d'issue publique pour une vulnérabilité — envoyer un email à **info@constructoai.ca**.

### Ce qui est protégé

Cette plateforme a fait l'objet de plusieurs passes d'audit automatisé (multi-agents) couvrant :

- **Secrets** : aucun hardcodé. Tous via `.env` (JWT, API keys, SMTP, Stripe, etc.)
- **JWT** : refuse de démarrer en prod si secret manquant; clé aléatoire en dev avec warning
- **Mots de passe** : bcrypt 12 rounds; comparaisons `hmac.compare_digest` partout
- **Cookies** : `secure=True` automatique en prod, `httponly`, `samesite=lax`
- **SQL** : `psycopg2.sql.Identifier` sur tous les identifiants dynamiques (tables/colonnes/schémas)
- **SSRF** : webhooks bloquent IPs privées + résolution DNS anti-rebinding + schémas http(s) only
- **Path traversal** : `.resolve()` + `relative_to(base)` sur tous les paths utilisateur
- **Uploads** : validation par **magic bytes** (pas Content-Type client) + filename sanitization
- **ZIP bomb** : guards sur openpyxl/python-docx (200 MB max, ratio 100x, 1000 entries)
- **Headers HTTP** : HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy sur les 3 apps
- **Account enumeration** : messages d'erreur unifiés + timing equalization
- **CORS** : pas de wildcard `*` avec `credentials` — configurable via env
- **Multi-tenant** : `validate_schema_name` immédiat avant toute opération DB
- **CI** : `pip-audit`, `npm audit`, `gitleaks`, `CodeQL` à chaque PR (voir `.github/workflows/security.yml`)
- **Dépendances** : Dependabot configuré pour updates hebdo

### Limitations honnêtes

Ce qui n'a **pas** été fait et que vous devriez considérer **avant la prod** :

- ❌ **Pas d'audit de pénétration humain professionnel** — recommandé avant un déploiement à fort trafic
- ❌ **JWT côté frontend en `localStorage`** — vulnérable XSS. Migration vers `httponly` cookies recommandée (changement architectural)
- ❌ **Pas de test de charge / fuzzing automatisé** sur les endpoints
- ❌ **Pas de revue de chaque endpoint** business un par un (25+ routers)
- ❌ **Pas d'audit runtime** de l'isolation multi-tenant avec 2 tenants concurrents

### À configurer impérativement avant la prod

1. Copier `.env.example` → `.env` et remplir **tous** les secrets requis
2. Définir `ENVIRONMENT=production` pour activer les guards stricts (cookies secure, JWT obligatoire, etc.)
3. Configurer `ALLOWED_ORIGINS` avec votre domaine exact (pas de `*`)
4. Activer **HTTPS** (le code force `Secure` sur les cookies hors dev)
5. Activer **Sentry** (`SENTRY_DSN`) pour le monitoring d'erreurs
6. Activer la **MFA** sur tous vos comptes admin (plateforme + Stripe + DB)
7. **Backups automatiques** de la base de données
8. **Rotation périodique** des secrets JWT
9. Surveillance des logs (échecs d'auth, rate limit, 5xx)

Pour générer un secret JWT :
```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

---

## Démarrage rapide

### Prérequis

- Python 3.11+
- Node.js 20+
- PostgreSQL 14+
- (optionnel) Redis pour le cache

### Installation

```bash
# 1. Cloner le dépôt
git clone <votre-fork>
cd Open_source

# 2. Copier et configurer les variables d'environnement
cp .env.example .env
# Éditer .env : DATABASE_URL, ERP_JWT_SECRET, ADMIN_PASSWORD, etc.

# 3. Backend Python (ERP_REACT)
cd ERP_REACT/backend
pip install -r requirements.txt   # depuis le requirements.txt du root
uvicorn erp_api:app --reload --port 8003

# 4. Frontend React (ERP_REACT) — dans un autre terminal
cd ERP_REACT/frontend
npm install
npm run dev   # http://localhost:5174

# Reproduire pour MOBILE_REACT (port 5175) et SEAOP_REACT (port 5173)
```

### Variables d'environnement principales

Voir [.env.example](.env.example) pour la liste complète. Les essentielles :

| Variable                  | Description                                          | Requise |
|---------------------------|------------------------------------------------------|---------|
| `DATABASE_URL`            | URL PostgreSQL (`postgresql://user:pass@host/db`)    | ✅       |
| `ERP_JWT_SECRET`          | Secret JWT pour ERP_REACT                            | ✅ prod  |
| `JWT_SECRET_KEY`          | Secret JWT pour MOBILE_REACT                         | ✅ prod  |
| `SEAOP_JWT_SECRET`        | Secret JWT pour SEAOP_REACT                          | ✅ prod  |
| `ADMIN_PASSWORD`          | Mot de passe super-admin initial                     | ✅       |
| `ALLOWED_ORIGINS`         | Origines CORS (CSV)                                  | recommandée |
| `APP_BASE_URL`            | URL publique de votre instance                       | recommandée |
| `STRIPE_SECRET_KEY`       | Si vous utilisez le module Stripe                    | optionnelle |
| `ANTHROPIC_API_KEY`       | Si vous utilisez les assistants IA                   | optionnelle |
| `SMTP_HOST` / `SMTP_USER` | Pour l'envoi d'emails (devis, notifications)         | optionnelle |
| `SENTRY_DSN`              | Monitoring d'erreurs Sentry                          | optionnelle |

---

## Architecture

```
Open_source/
├── ERP_REACT/              # ERP web (CRM, projets, factures, ...)
│   ├── backend/            #   FastAPI — 25+ routers
│   ├── frontend/           #   React + Vite
│   └── docs/               #   29 fichiers de manuel utilisateur
├── MOBILE_REACT/           # App mobile (pointage, terrain)
│   ├── backend/
│   └── frontend/
├── SEAOP_REACT/            # Appels d'offres publics
│   ├── backend/
│   └── frontend/
├── *.py                    # Modules partagés (DB, auth, Stripe, sécurité)
├── .env.example            # Template de configuration
├── LICENSE                 # Apache 2.0
├── NOTICE                  # Exigence d'attribution
└── README.md
```

---

## Calculateurs construction inclus

L'ERP intègre des calculateurs métier pour le Québec :

- Béton, toiture, peinture, électricité, plomberie, CVAC
- Escaliers, soudure, pliage métal
- Taxes Québec (TPS 5%, TVQ 9.975%)
- Conformité construction (RBQ, CCQ)

---

## Contribution

Les contributions sont bienvenues. Veuillez :

1. Forker le projet
2. Créer une branche de fonctionnalité
3. Vérifier qu'aucun secret n'est commité (`git diff` avant `git commit`)
4. Soumettre une pull request

Tous les contributeurs acceptent les termes de la licence Apache 2.0.

---

## Support & contact

- **Mainteneur principal** : Sylvain Leduc / Constructo AI Inc.
- **Courriel** : info@constructoai.ca
- **Téléphone** : 514-820-1972
- **Web** : https://constructoai.ca

Pour les questions de licence, attribution commerciale, ou support entreprise,
contactez directement Constructo AI Inc.

---

## Attribution requise

Conformément au fichier [NOTICE](NOTICE), tout produit dérivé doit afficher :

> **« Basé sur Constructo AI — gracieuseté de Constructo AI Inc. »**
> https://constructoai.ca

dans la documentation, l'interface utilisateur, et les communications du produit.
