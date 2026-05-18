"""
ERP React Backend - Configuration
Reads environment variables and defines constants for the ERP API.
"""

import logging
import os
import secrets

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
API_PREFIX = "/api/erp/v1"

# Environment
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"

# JWT — aucune valeur par defaut hardcodee
JWT_SECRET = os.getenv("ERP_JWT_SECRET") or os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET:
    if IS_PRODUCTION:
        raise RuntimeError(
            "ERP_JWT_SECRET (ou JWT_SECRET_KEY) doit etre defini en production. "
            "Generez une cle avec: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    JWT_SECRET = secrets.token_urlsafe(64)
    logger.warning(
        "ERP_JWT_SECRET non defini. Cle aleatoire generee pour ce processus uniquement. "
        "Les sessions ne survivront pas au redemarrage. Definissez ERP_JWT_SECRET dans .env."
    )
JWT_ALGORITHM = "HS256"
# Expiration JWT en jours — court par défaut pour limiter l'exposition d'un token volé.
JWT_EXPIRY_DAYS = int(os.getenv("JWT_EXPIRY_DAYS", "2"))

# Admin (loaded from env only — no hardcoded fallback)
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

# CORS — domaines autorises. Surchargez via ALLOWED_ORIGINS (CSV) en .env.
# Les domaines de production de Constructo AI sont inclus par defaut pour preserver
# la compatibilite du deploiement existant; pour un fork, definissez ALLOWED_ORIGINS.
_default_origins = ",".join([
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:8003",
])
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

# Upload
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_FILES_PER_UPLOAD = 5

# Development mode - only super-admin can access
DEV_MODE = os.getenv("ERP_DEV_MODE", "false").lower() == "true"

# Super-Admin credentials (from public.super_admins table)
SUPER_ADMIN_USERNAME = os.getenv("SUPER_ADMIN_USERNAME", "admin")

# Stripe
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "")
STRIPE_PRICE_STARTER = os.getenv("STRIPE_PRICE_STARTER", "")
STRIPE_PRICE_PRO = os.getenv("STRIPE_PRICE_PRO", "")
STRIPE_PRICE_ENTERPRISE = os.getenv("STRIPE_PRICE_ENTERPRISE", "")
APP_BASE_URL = os.getenv("APP_BASE_URL", os.getenv("APP_URL", "http://localhost:5174"))

# SMTP - Transactional email (devis, notifications)
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Constructo AI")
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "true").lower() == "true"

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Quebec taxes
TPS_RATE = 5.0
TVQ_RATE = 9.975

# ERP Sidebar modules (for reference)
ERP_MODULES = [
    "dashboard", "analytics", "suivi", "dossiers", "entreprises",
    "contacts", "ventes", "devis", "projets", "magasin",
    "employes", "bons_travail", "pointage", "meteo",
    "comptabilite", "rbq_ccq", "subventions", "immobilier",
    "logistique", "location", "maintenance", "emails",
    "messagerie", "assistant_ia", "web", "calculs", "configuration",
]
