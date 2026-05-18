# Politique de sécurité — Constructo AI

Merci de prendre la sécurité de ce projet au sérieux. Ce document décrit comment signaler une vulnérabilité de manière responsable.

## Versions supportées

Ce projet est open source et en évolution active. Les correctifs de sécurité sont appliqués sur la branche `main` uniquement.

| Version | Supportée |
|---------|-----------|
| `main`  | ✅        |
| autres  | ❌        |

## Comment signaler une vulnérabilité

**NE PAS** ouvrir une issue publique sur GitHub pour une vulnérabilité de sécurité.

À la place, envoyez un courriel détaillé à : **info@constructoai.ca**

Avec en objet : `[SECURITY] Constructo AI - <courte description>`

Incluez si possible :
- Description de la vulnérabilité et de son impact potentiel
- Étapes pour la reproduire (proof of concept apprécié)
- Version / commit affecté
- Toute information sur la divulgation responsable (date limite souhaitée, etc.)
- Vos coordonnées si vous souhaitez être crédité

### Engagement de réponse

| Étape                          | Délai cible           |
|--------------------------------|-----------------------|
| Accusé de réception            | sous 72 heures        |
| Évaluation initiale            | sous 7 jours          |
| Correctif (si confirmé)        | selon criticité (1-30 jours) |
| Communication publique         | après correctif déployé |

## Programme de divulgation

Nous remercions publiquement les chercheurs en sécurité qui signalent des vulnérabilités de manière responsable (sauf demande contraire). Aucune compensation financière n'est offerte pour le moment.

## Périmètre

**Inclus dans le périmètre** :
- Code source dans ce dépôt (ERP_REACT, MOBILE_REACT, SEAOP_REACT, modules Python partagés)
- Vulnérabilités dans la logique d'authentification, d'autorisation, multi-tenant
- Injections (SQL, command, path traversal), XSS, CSRF, SSRF
- Fuites de secrets / credentials
- Failles d'isolation entre tenants

**Hors périmètre** :
- Instances tierces (forks, déploiements de tiers) — contactez l'opérateur de l'instance
- Attaques nécessitant un accès physique au serveur
- DoS volumétrique (DDoS)
- Vulnérabilités dans des dépendances tierces (à reporter au mainteneur de la dépendance)
- Configurations de déploiement spécifiques à un opérateur (CORS, TLS, etc.)
- Bugs hors sécurité — ouvrez une issue publique pour ceux-ci

## État de sécurité actuel

Ce projet a fait l'objet d'audits automatisés multi-passes couvrant :
- Secrets hardcodés (clés API, mots de passe, tokens)
- Authentification (JWT, sessions, bcrypt, timing attacks)
- Injections SQL (paramétrage, identifiants)
- Headers HTTP de sécurité (HSTS, CSP, X-Frame-Options, etc.)
- SSRF (validation des URLs sortantes)
- Isolation multi-tenant
- Cryptographie (random vs secrets, HMAC, hashing)

**Aucun audit de pénétration humain professionnel n'a encore été effectué.** Les utilisateurs déployant cette plateforme en production sont encouragés à :
1. Effectuer leur propre audit de sécurité avant mise en production
2. Configurer correctement les variables d'environnement (voir `.env.example`)
3. Activer un monitoring d'erreurs (Sentry — déjà câblé)
4. Maintenir les dépendances à jour (`pip-audit`, `npm audit`)
5. Activer la MFA sur tous les comptes admin de la plateforme

## Bonnes pratiques de déploiement

- HTTPS obligatoire en production (le code force `secure=True` sur les cookies hors développement)
- Définir tous les secrets via variables d'environnement (jamais en dur)
- Activer `ENVIRONMENT=production` pour bloquer les comportements de développement
- Configurer `ALLOWED_ORIGINS` strictement (pas de wildcard `*` avec `credentials`)
- Backups réguliers de la base de données
- Rotation périodique des secrets JWT
- Surveillance des logs (échecs d'auth, rate limits, erreurs 5xx)

## Crédits

Liste des chercheurs ayant contribué (avec leur permission) :
- _Aucun pour le moment_

---

Contact : info@constructoai.ca · 514-820-1972 · https://constructoai.ca
