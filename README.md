# Constructo AI — Plateforme à code libre pour la construction au Québec

> **Premier ERP construction à code libre au Québec.** Un écosystème complet conçu pour les entrepreneurs québécois, regroupant trois applications bâties sur une fondation Python/React commune.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![React 18](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![PostgreSQL 14+](https://img.shields.io/badge/PostgreSQL-14+-336791.svg)](https://www.postgresql.org/)
[![Made in Québec](https://img.shields.io/badge/Made_in-Qu%C3%A9bec-fed800.svg)](https://constructoai.ca)

---

## 📦 Les trois applications

| Application | Description | Points forts |
|---|---|---|
| **ERP_REACT** | ERP web multi-tenant pour entrepreneurs | CRM, projets, comptabilité, facturation, inventaire, paie québécoise complète, 40+ modules |
| **MOBILE_REACT** | Application mobile PWA terrain | Pointage CCQ avec GPS et météo, notes vocales enrichies par IA, messagerie d'équipe, bons de travail |
| **SEAOP_REACT** | Plateforme d'appels d'offres publics | Conforme aux exigences du Québec — 18 régions administratives, validation RBQ, cautionnement |

Toutes les applications partagent une **fondation Python (FastAPI) + React 18 (Vite)** avec une base de données **PostgreSQL multi-tenant** (schémas isolés par client).

---

## 🍁 Conçu pour la réalité québécoise

- **Calculateurs métier conformes** aux normes locales : Code du bâtiment du Québec, RBQ, CCQ, Loi 16, CNESST
- **Taxes québécoises automatiques** : TPS 5 %, TVQ 9,975 %
- **61 métiers CCQ** préconfigurés avec les taux de la convention collective 2025-2029
- **57 conseillers IA spécialisés** en construction (assistants Claude — optionnel, requiert une clé Anthropic API)
- **Métré sur plans PDF** avec calculs automatiques (surfaces, longueurs, quantités)
- **Calculateurs spécialisés** : béton, toiture, peinture, électricité, plomberie, CVAC, escaliers, soudure, pliage métal
- **Paie québécoise complète** : retenues fédérales et provinciales, RRQ, RQAP, FSS, CSST

---

## 🏗️ Architecture technique

- **Multi-tenant** via schémas PostgreSQL isolés (un schéma par entreprise cliente)
- **Authentification JWT** par application (`ERP_JWT_SECRET`, `JWT_SECRET_KEY`, `SEAOP_JWT_SECRET`)
- **Défense en profondeur** : bcrypt 12 rounds, `hmac.compare_digest`, headers HTTP standards (HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- **Validation stricte des entrées** : Pydantic, magic bytes pour les uploads, sanitization Content-Disposition
- **CI scans automatisés** à chaque PR : `pip-audit`, `npm audit`, `CodeQL`, secret scanning Gitleaks
- **Dépendances surveillées** par Dependabot (mises à jour hebdomadaires automatiques)

---

## 🚀 Démarrage rapide

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

# 3. Installer les dépendances Python (modules partagés + backends)
pip install -r requirements.txt

# 4. Lancer le backend ERP (port 8003)
cd ERP_REACT/backend
uvicorn erp_api:app --reload --port 8003

# 5. Dans un autre terminal — frontend ERP (port 5174)
cd ERP_REACT/frontend
npm install
npm run dev
```

Reproduire les étapes 4-5 pour `MOBILE_REACT` (backend port 8003, frontend port 5175) et `SEAOP_REACT` (backend port 8002, frontend port 5173).

### Variables d'environnement principales

Voir [`.env.example`](.env.example) pour la liste complète et commentée.

| Variable | Description | Requise |
|---|---|---|
| `DATABASE_URL` | URL PostgreSQL — format `postgresql://user:pass@host:5432/db` | ✅ |
| `ERP_JWT_SECRET` | Secret de signature JWT pour ERP_REACT | ✅ en prod |
| `JWT_SECRET_KEY` | Secret de signature JWT pour MOBILE_REACT | ✅ en prod |
| `SEAOP_JWT_SECRET` | Secret de signature JWT pour SEAOP_REACT | ✅ en prod |
| `ADMIN_PASSWORD` | Mot de passe du super-administrateur initial | ✅ |
| `ALLOWED_ORIGINS` | Origines CORS autorisées (CSV) | recommandée |
| `APP_BASE_URL` | URL publique de votre instance | recommandée |
| `ANTHROPIC_API_KEY` | Clé API Anthropic pour les 57 conseillers IA | optionnelle |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe pour les paiements | optionnelle |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | Envoi d'emails (devis, notifications) | optionnelle |
| `SENTRY_DSN` | Monitoring d'erreurs Sentry | optionnelle |

Pour générer un secret JWT cryptographiquement robuste :
```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

---

## 🗂️ Structure du dépôt

```
Code_Libre/
├── ERP_REACT/                # ERP web (CRM, projets, factures, comptabilité)
│   ├── backend/              #   FastAPI — 25+ routers
│   ├── frontend/             #   React 18 + Vite + TypeScript
│   └── docs/manuel/          #   29 fichiers de manuel utilisateur
├── MOBILE_REACT/             # Application mobile PWA (pointage, terrain)
│   ├── backend/
│   └── frontend/
├── SEAOP_REACT/              # Plateforme publique d'appels d'offres
│   ├── backend/
│   └── frontend/
├── *.py                      # Modules partagés (DB, auth, Stripe, sécurité)
├── .env.example              # Template de configuration
├── requirements.txt          # Dépendances Python
├── LICENSE                   # Apache 2.0
├── NOTICE                    # Exigence d'attribution
├── SECURITY.md               # Politique de divulgation responsable
└── README.md
```

---

## 🔒 Sécurité

> **Politique de divulgation responsable** : voir [SECURITY.md](SECURITY.md). Pour signaler une vulnérabilité, écrivez à **info@constructoai.ca** — ne pas ouvrir d'issue publique.

### À configurer impérativement avant la mise en production

1. Copier `.env.example` → `.env` et remplir **tous** les secrets requis
2. Définir `ENVIRONMENT=production` pour activer les guards stricts (cookies `Secure`, JWT obligatoire, etc.)
3. Configurer `ALLOWED_ORIGINS` avec votre domaine exact (jamais `*`)
4. Activer **HTTPS** sur tous les services
5. Activer **Sentry** (`SENTRY_DSN`) pour le monitoring d'erreurs
6. Activer la **MFA** sur tous les comptes administrateur (plateforme + Stripe + base de données)
7. Configurer des **backups automatiques** réguliers de la base de données
8. Prévoir une **rotation périodique** des secrets JWT
9. Surveiller les logs (échecs d'authentification, rate limit, 5xx)
10. **Audit de pénétration professionnel** recommandé avant tout déploiement à fort trafic ou traitant des données sensibles

---

## 🤝 Contribution

Les contributions sont les bienvenues. Pour contribuer :

1. **Forker** le dépôt
2. Créer une branche de fonctionnalité (`feature/ma-fonctionnalite`)
3. Vérifier qu'aucun secret n'est commité (`git diff` avant `git commit`)
4. Soumettre une **pull request** avec une description claire

Tous les contributeurs acceptent les termes de la licence Apache 2.0.

---

## 📜 Licence

**Apache License 2.0** — Utilisation commerciale autorisée, modifications permises, distribution libre.

L'attribution à **Constructo AI Inc.** est requise conformément au fichier [NOTICE](NOTICE). Voir [LICENSE](LICENSE) pour les termes complets.

### Attribution requise

Conformément au fichier [NOTICE](NOTICE), tout produit dérivé doit afficher la mention suivante dans sa documentation, son interface utilisateur et ses communications :

> **« Basé sur Constructo AI — gracieuseté de Constructo AI Inc. »**
> [https://constructoai.ca](https://constructoai.ca)

---

## 📞 Contact et support

| | |
|---|---|
| **Mainteneur principal** | Sylvain Leduc — Constructo AI Inc. |
| **Courriel** | [info@constructoai.ca](mailto:info@constructoai.ca) |
| **Téléphone** | 514-820-1972 |
| **Web** | [https://constructoai.ca](https://constructoai.ca) |

Pour les questions de licence commerciale, attribution, support entreprise ou intégration sur mesure, contactez directement Constructo AI Inc.

---

<p align="center">
  <sub>Fait au Québec 🍁 — Pour les entrepreneurs en construction du Québec</sub>
</p>
