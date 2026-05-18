"""Pytest configuration & fixtures pour les tests Mobile React backend.

Setup les env vars critiques AVANT d'importer mobile_auth/mobile_api
(le module mobile_auth verifie JWT_SECRET_KEY a l'import).
"""

import os
import sys
import pathlib

# Env vars en premier — mobile_auth lit JWT_SECRET_KEY a l'import
os.environ.setdefault("JWT_SECRET_KEY", "test-phase1-secret-do-not-use-in-prod")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_db")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5175")

# sys.path : racine repo + MOBILE_REACT/backend pour permettre les imports
# tant relatifs (from .mobile_auth) qu'absolus (from MOBILE_REACT.backend.mobile_api)
_HERE = pathlib.Path(__file__).resolve().parent
_BACKEND = _HERE.parent
_MOBILE = _BACKEND.parent
_REPO = _MOBILE.parent
for p in (str(_REPO), str(_MOBILE), str(_BACKEND)):
    if p not in sys.path:
        sys.path.insert(0, p)
