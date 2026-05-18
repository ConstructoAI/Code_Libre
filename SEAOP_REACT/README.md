# SEAOP React -- Systeme Electronique d'Appels d'Offres Public

## Description

Migration de SEAOP (Streamlit) vers React. Application standalone pour les appels d'offres de construction au Quebec.

## Stack

- **Backend:** FastAPI + PostgreSQL + JWT (PyJWT)
- **Frontend:** React 18 + TypeScript + Zustand + Vite + Tailwind CSS + React Router v6
- **BD:** Tables `seaop_*` existantes (aucune modification du schema)

## Mode Developpement

L'application est verrouillee -- seul le Super-Admin peut y acceder.

Variable d'environnement : `SEAOP_DEV_MODE=true` (defaut)

Pour rendre public : `SEAOP_DEV_MODE=false`

## Demarrage rapide

### Prerequis

- Python 3.11+
- Node.js 18+
- PostgreSQL (meme BD que l'ERP principal)

### Backend

```bash
cd SEAOP_REACT
pip install PyJWT  # Si pas deja installe
uvicorn backend.seaop_api:app --reload --port 8002
```

API docs : http://localhost:8002/api/seaop/v1/docs

### Frontend

```bash
cd SEAOP_REACT/frontend
npm install
npm run dev
```

App : http://localhost:5173

### Connexion

1. Ouvrir http://localhost:5173
2. Onglet "Super Admin"
3. Username : `Sylvainleduc`
4. Mot de passe : votre mot de passe Super-Admin habituel

## Structure des fichiers

```
SEAOP_REACT/
├── backend/
│   ├── __init__.py
│   ├── seaop_api.py              # Point d'entree FastAPI + middleware
│   ├── seaop_auth.py             # JWT + sessions + Super-Admin auth
│   ├── seaop_config.py           # Configuration env vars
│   ├── seaop_database.py         # Couche BD (RealDictCursor)
│   ├── seaop_models.py           # Pydantic models
│   └── routers/
│       ├── __init__.py
│       ├── admin.py
│       ├── auth.py
│       ├── chat_room.py
│       ├── evaluations.py
│       ├── leads.py
│       ├── messages.py
│       ├── notifications.py
│       ├── services.py
│       ├── soumissions.py
│       └── uploads.py
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── vite-env.d.ts
│       ├── api/
│       │   ├── client.ts          # Axios client (snake/camelCase auto)
│       │   ├── admin.ts
│       │   ├── auth.ts
│       │   ├── chatRoom.ts
│       │   ├── evaluations.ts
│       │   ├── leads.ts
│       │   ├── messages.ts
│       │   ├── notifications.ts
│       │   ├── services.ts
│       │   └── soumissions.ts
│       ├── components/
│       │   ├── admin/
│       │   │   ├── DashboardStats.tsx
│       │   │   ├── EntrepreneurTable.tsx
│       │   │   ├── ServiceTabs.tsx
│       │   │   └── SoumissionTable.tsx
│       │   ├── auth/
│       │   │   ├── LoginForm.tsx
│       │   │   └── RegisterForm.tsx
│       │   ├── chatRoom/
│       │   │   ├── ChatMessageItem.tsx
│       │   │   ├── ChatRoomPanel.tsx
│       │   │   └── OnlineUsers.tsx
│       │   ├── common/
│       │   │   ├── ErrorBoundary.tsx
│       │   │   ├── StatCard.tsx
│       │   │   └── UrgencyBadge.tsx
│       │   ├── evaluations/
│       │   │   ├── EvaluationForm.tsx
│       │   │   └── EvaluationStats.tsx
│       │   ├── layout/
│       │   │   ├── AppLayout.tsx
│       │   │   ├── Footer.tsx
│       │   │   ├── ProtectedRoute.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   └── TopBar.tsx
│       │   ├── leads/
│       │   │   ├── LeadCard.tsx
│       │   │   ├── LeadFilters.tsx
│       │   │   └── LeadForm.tsx
│       │   ├── messages/
│       │   │   ├── ChatThread.tsx
│       │   │   └── ConversationList.tsx
│       │   ├── notifications/
│       │   │   ├── NotificationBell.tsx
│       │   │   └── NotificationList.tsx
│       │   ├── services/
│       │   │   ├── ServiceRequestForm.tsx
│       │   │   └── ServiceTracking.tsx
│       │   ├── soumissions/
│       │   │   ├── SoumissionCard.tsx
│       │   │   ├── SoumissionForm.tsx
│       │   │   └── SoumissionList.tsx
│       │   └── ui/
│       │       ├── Alert.tsx
│       │       ├── Badge.tsx
│       │       ├── Button.tsx
│       │       ├── Card.tsx
│       │       ├── FileUpload.tsx
│       │       ├── Input.tsx
│       │       ├── Modal.tsx
│       │       ├── Pagination.tsx
│       │       ├── Select.tsx
│       │       ├── Spinner.tsx
│       │       ├── StarRating.tsx
│       │       └── Textarea.tsx
│       ├── hooks/
│       │   ├── useFileUpload.ts
│       │   └── usePolling.ts
│       ├── pages/
│       │   ├── AccueilPage.tsx
│       │   ├── AdminPage.tsx
│       │   ├── ChatRoomPage.tsx
│       │   ├── EspaceEntrepreneurPage.tsx
│       │   ├── LoginPage.tsx
│       │   ├── MesProjetsPage.tsx
│       │   ├── NotFoundPage.tsx
│       │   ├── NotificationsPage.tsx
│       │   ├── NouveauProjetPage.tsx
│       │   ├── RegisterPage.tsx
│       │   ├── ServiceArchitecturePage.tsx
│       │   ├── ServiceEstimationPage.tsx
│       │   ├── ServiceIngenieurPage.tsx
│       │   └── ServiceTechnologuePage.tsx
│       ├── store/
│       │   ├── useAdminStore.ts
│       │   ├── useAuthStore.ts
│       │   ├── useChatRoomStore.ts
│       │   ├── useLeadStore.ts
│       │   ├── useMessageStore.ts
│       │   ├── useNotificationStore.ts
│       │   ├── useSoumissionStore.ts
│       │   └── useThemeStore.ts
│       ├── types/
│       │   └── index.ts
│       └── utils/
│           ├── constants.ts
│           ├── format.ts
│           ├── urgency.ts
│           └── validation.ts
└── README.md
```

## Architecture

### Backend (17 fichiers Python)

| Fichier | Role |
|---|---|
| `seaop_api.py` | Point d'entree FastAPI + middleware CORS |
| `seaop_auth.py` | JWT + sessions + Super-Admin auth |
| `seaop_database.py` | Couche BD (RealDictCursor) |
| `seaop_models.py` | Pydantic models |
| `seaop_config.py` | Configuration env vars |
| `routers/auth.py` | Authentification et inscription |
| `routers/leads.py` | Gestion des appels d'offres |
| `routers/soumissions.py` | Soumissions sur les leads |
| `routers/messages.py` | Messagerie entre utilisateurs |
| `routers/evaluations.py` | Evaluations et notes |
| `routers/notifications.py` | Systeme de notifications |
| `routers/chat_room.py` | Chat room en temps reel |
| `routers/services.py` | Services professionnels |
| `routers/admin.py` | Administration et tableau de bord |
| `routers/uploads.py` | Upload de fichiers |

### Frontend (85+ fichiers TypeScript)

| Categorie | Nombre | Description |
|---|---|---|
| API modules | 9 | Client Axios avec conversion snake/camelCase automatique |
| Zustand stores | 8 | Auth, leads, soumissions, messages, notifications, chat room, admin, theme |
| UI primitifs | 12 | Alert, Badge, Button, Card, FileUpload, Input, Modal, Pagination, Select, Spinner, StarRating, Textarea |
| Pages | 14 | React Router avec routes protegees |
| Hooks | 2 | usePolling (30-60s), useFileUpload |
| Dark mode | -- | Toggle Tailwind class-based via useThemeStore |

## Endpoints API

Base URL : `/api/seaop/v1`

### /auth (6 endpoints)

| Methode | Route | Description |
|---|---|---|
| `POST` | `/auth/register` | Inscription entrepreneur |
| `POST` | `/auth/login` | Connexion standard |
| `POST` | `/auth/super-admin/login` | Connexion Super-Admin |
| `GET` | `/auth/me` | Profil utilisateur courant |
| `POST` | `/auth/logout` | Deconnexion |
| `POST` | `/auth/refresh` | Rafraichir le token JWT |

### /leads (5 endpoints)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/leads` | Lister les appels d'offres |
| `POST` | `/leads` | Creer un appel d'offres |
| `GET` | `/leads/{id}` | Detail d'un appel d'offres |
| `PUT` | `/leads/{id}` | Modifier un appel d'offres |
| `DELETE` | `/leads/{id}` | Supprimer un appel d'offres |

### /soumissions (6 endpoints)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/soumissions` | Lister les soumissions |
| `POST` | `/soumissions` | Creer une soumission |
| `GET` | `/soumissions/{id}` | Detail d'une soumission |
| `PUT` | `/soumissions/{id}` | Modifier une soumission |
| `DELETE` | `/soumissions/{id}` | Supprimer une soumission |
| `GET` | `/leads/{id}/soumissions` | Soumissions par lead |

### /messages (4 endpoints)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/messages` | Lister les conversations |
| `POST` | `/messages` | Envoyer un message |
| `GET` | `/messages/{thread_id}` | Messages d'un fil |
| `PUT` | `/messages/{id}/read` | Marquer comme lu |

### /evaluations (3 endpoints)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/evaluations` | Lister les evaluations |
| `POST` | `/evaluations` | Creer une evaluation |
| `GET` | `/evaluations/{id}` | Detail d'une evaluation |

### /notifications (4 endpoints)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/notifications` | Lister les notifications |
| `PUT` | `/notifications/{id}/read` | Marquer comme lue |
| `PUT` | `/notifications/read-all` | Tout marquer comme lu |
| `GET` | `/notifications/unread-count` | Nombre de non-lues |

### /chat-room (9 endpoints)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/chat-room/rooms` | Lister les salons |
| `POST` | `/chat-room/rooms` | Creer un salon |
| `GET` | `/chat-room/rooms/{id}` | Detail d'un salon |
| `GET` | `/chat-room/rooms/{id}/messages` | Messages d'un salon |
| `POST` | `/chat-room/rooms/{id}/messages` | Envoyer dans un salon |
| `POST` | `/chat-room/rooms/{id}/join` | Rejoindre un salon |
| `POST` | `/chat-room/rooms/{id}/leave` | Quitter un salon |
| `GET` | `/chat-room/rooms/{id}/members` | Membres d'un salon |
| `POST` | `/chat-room/rooms/{id}/typing` | Indicateur de frappe |

### /services (4 endpoints)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/services` | Lister les services |
| `POST` | `/services` | Demander un service |
| `GET` | `/services/{id}` | Detail d'un service |
| `PUT` | `/services/{id}` | Mettre a jour un service |

### /admin (5 endpoints)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/admin/dashboard` | Statistiques tableau de bord |
| `GET` | `/admin/entrepreneurs` | Lister les entrepreneurs |
| `PUT` | `/admin/entrepreneurs/{id}` | Modifier un entrepreneur |
| `GET` | `/admin/soumissions` | Toutes les soumissions |
| `GET` | `/admin/services` | Tous les services |

### /uploads (2 endpoints)

| Methode | Route | Description |
|---|---|---|
| `POST` | `/uploads` | Uploader un fichier |
| `GET` | `/uploads/{filename}` | Telecharger un fichier |

### /health (1 endpoint)

| Methode | Route | Description |
|---|---|---|
| `GET` | `/health` | Verification sante API |

**Total : 49 endpoints**

## Variables d'environnement

| Variable | Description | Defaut |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | -- |
| `SEAOP_JWT_SECRET` | Secret JWT | `dev-secret` |
| `ADMIN_PASSWORD` | Mot de passe admin local | -- |
| `SEAOP_DEV_MODE` | Verrouillage dev (`true`/`false`) | `true` |
| `SUPER_ADMIN_USERNAME` | Username super-admin | `Sylvainleduc` |
| `VITE_API_URL` | URL API pour le frontend | proxy via Vite |

## Deploiement Render

Ajouter le service dans `render.yaml` :

```yaml
- type: web
  name: seaop-api
  runtime: python
  buildCommand: pip install -r requirements.txt
  startCommand: uvicorn SEAOP_REACT.backend.seaop_api:app --host 0.0.0.0 --port $PORT
  envVars:
    - key: DATABASE_URL
      fromDatabase:
        name: constructo-db
        property: connectionString
    - key: SEAOP_JWT_SECRET
      generateValue: true
    - key: SEAOP_DEV_MODE
      value: "true"
    - key: SUPER_ADMIN_USERNAME
      value: "Sylvainleduc"

- type: web
  name: seaop-frontend
  runtime: static
  buildCommand: cd SEAOP_REACT/frontend && npm install && npm run build
  staticPublishPath: SEAOP_REACT/frontend/dist
  routes:
    - type: rewrite
      source: /*
      destination: /index.html
  envVars:
    - key: VITE_API_URL
      value: "https://seaop-api.onrender.com/api/seaop/v1"
```

## Phases de developpement

| Phase | Contenu | Statut |
|---|---|---|
| Phase 1 | Auth + Leads | Completee |
| Phase 2 | Soumissions + Messages + Evaluations | Completee |
| Phase 3 | Notifications + Chat Room + Uploads | Completee |
| Phase 4 | Services pro + Admin | Completee |
| Phase 5 | Deploiement + Polish | En cours |
