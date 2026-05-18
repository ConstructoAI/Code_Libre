"""
SEAOP React Backend - Configuration
Reads environment variables and defines constants for the SEAOP API.
"""

import logging
import os
import secrets

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
API_PREFIX = "/api/seaop/v1"

# JWT
JWT_SECRET = os.getenv("SEAOP_JWT_SECRET") or os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET:
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        raise RuntimeError(
            "SEAOP_JWT_SECRET (ou JWT_SECRET_KEY) doit etre defini en production. "
            "Generez une cle avec: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    JWT_SECRET = secrets.token_urlsafe(64)
    logger.warning(
        "SEAOP_JWT_SECRET non defini. Cle aleatoire generee pour ce processus uniquement. "
        "Les sessions ne survivront pas au redemarrage. Definissez SEAOP_JWT_SECRET dans .env."
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7

# Admin
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

# CORS — domaines autorises. Surchargez via ALLOWED_ORIGINS (CSV) en .env.
_default_origins = "http://localhost:5173,http://localhost:5174,http://localhost:8002"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

# Upload
MAX_FILE_SIZE = 150 * 1024 * 1024  # 150 MB
MAX_FILES_PER_UPLOAD = 5

# Estimation-specific PDF plan uploads. Plans live on disk (NOT in the DB);
# the JSONB plans column stores metadata + file_id only. A dedicated upload
# directory is used so admin-only downloads can stream files directly.
ESTIMATION_PLAN_ROOT = os.getenv(
    "SEAOP_ESTIMATION_PLAN_ROOT",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "estimations"),
)
MAX_ESTIMATION_PLAN_SIZE = 150 * 1024 * 1024  # 150 MB per PDF
# Individual bucket ceiling — the frontend enforces a combined photos+plans
# cap of MAX_DOCS (10). We mirror that here: either bucket could theoretically
# hold up to 10, and a combined validator on the Pydantic model rejects
# payloads where len(photos) + len(plan_ids) > 10.
MAX_ESTIMATION_PLANS = 10
# Pending plan files older than this are garbage-collected at startup so
# abandoned uploads don't accumulate on disk indefinitely.
ESTIMATION_PLAN_PENDING_TTL_HOURS = 2

# DB table prefix (same as existing)
T = "seaop_"

# Project types, budget ranges, delays (from config_seaop.py)
TYPES_PROJETS = [
    "Travaux de construction", "Rénovation de bâtiments publics",
    "Infrastructure routière", "Aménagement urbain",
    "Systèmes informatiques", "Services professionnels",
    "Fournitures et équipements", "Services d'entretien",
    "Travaux d'ingénierie", "Consultations spécialisées", "Autre"
]

TRANCHES_BUDGET = [
    "Moins de 25 000$", "25 000$ - 100 000$",
    "100 000$ - 500 000$", "500 000$ - 1 000 000$",
    "Plus de 1 000 000$", "À déterminer selon soumissions"
]

DELAIS_REALISATION = [
    "Urgent (moins de 1 mois)", "Court terme (1-3 mois)",
    "Moyen terme (3-6 mois)", "Long terme (6-12 mois)",
    "Pluriannuel (plus de 12 mois)", "Selon calendrier projet"
]

STATUTS_PROJET = ["nouveau", "en_cours", "ferme", "attribue", "annule"]
STATUTS_SOUMISSION = ["envoyee", "vue", "en_evaluation", "acceptee", "refusee"]

# Development mode - only super-admin can access
DEV_MODE = os.getenv("SEAOP_DEV_MODE", "true").lower() == "true"

# Super-Admin credentials (from public.super_admins table)
SUPER_ADMIN_USERNAME = os.getenv("SUPER_ADMIN_USERNAME", "admin")

# SMTP - Email notifications
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Constructo AI SEAOP")
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "true").lower() == "true"
SEAOP_BASE_URL = os.getenv("SEAOP_BASE_URL", "http://localhost:5173")

# Admin inbox for estimation requests + other internal notifications
ADMIN_NOTIFICATION_EMAIL = os.getenv("SEAOP_ADMIN_EMAIL", "info@constructoai.ca")

# Estimation services — catalog of trades shown in the public wizard.
# Order matters (first = default). Used by frontend dropdown + backend validation.
CORPS_METIERS = [
    "Entrepreneur général",
    "Électricité",
    "Plomberie",
    "CVAC (chauffage / ventilation / climatisation)",
    "Toiture",
    "Charpente / Menuiserie",
    "Finition intérieure",
    "Peinture",
    "Revêtement de sol (céramique, bois, vinyle)",
    "Fenestration / Portes",
    "Isolation",
    "Gypse / Joints",
    "Béton / Fondation",
    "Excavation / Terrassement",
    "Démolition",
    "Maçonnerie / Pierre",
    "Revêtement extérieur",
    "Pavé / Asphalte",
    "Aménagement paysager",
    "Piscine / Spa",
    "Autre",
]

SECTEURS = [
    "Résidentiel",
    "Commercial",
    "Institutionnel",
    "Industriel",
]
