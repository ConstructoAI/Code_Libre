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

> **Politique de divulgation responsable** : voir [SECURITY.md](SECURITY.md).
> Pour signaler une vulnérabilité, écrivez à **info@constructoai.ca** —
> ne pas ouvrir d'issue publique.

Cette plateforme a été conçue avec une approche défense-en-profondeur :
secrets via variables d'environnement uniquement, bcrypt pour les mots de passe,
headers de sécurité HTTP standards, validation stricte des entrées, isolation
multi-tenant via schémas PostgreSQL, et CI scans (`pip-audit`, `npm audit`,
`CodeQL`, secret scanning) à chaque PR.

### À configurer impérativement avant la prod

1. Copier `.env.example` → `.env` et remplir **tous** les secrets requis
2. Définir `ENVIRONMENT=production` pour activer les guards stricts
3. Configurer `ALLOWED_ORIGINS` avec votre domaine exact (pas de `*`)
4. Activer **HTTPS** (le code force `Secure` sur les cookies hors dev)
5. Activer **Sentry** (`SENTRY_DSN`) pour le monitoring d'erreurs
6. Activer la **MFA** sur tous vos comptes admin (plateforme + Stripe + DB)
7. Backups automatiques réguliers de la base de données
8. Rotation périodique des secrets JWT
9. Surveillance des logs (échecs d'auth, rate limit, 5xx)
10. **Audit de pénétration professionnel** recommandé avant tout déploiement
    à fort trafic ou traitant des données sensibles

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
cd Code_Libre

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
Code_Libre/
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
