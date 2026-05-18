"""
Module de Sécurité - ERP Constructo AI
================================
Gestion sécurisée de l'authentification et validation des entrées.

Fonctionnalités :
- Hachage bcrypt des mots de passe (12 rounds)
- Validation robuste des mots de passe
- Sanitization des entrées utilisateur
- Protection contre injections SQL/XSS
- Validation emails et téléphones (format Québec)

Auteur: Constructo AI
Date: Janvier 2025
Version: 1.0.0
"""

import bcrypt
import re
import secrets
import logging
from typing import Tuple

logger = logging.getLogger(__name__)


class PasswordManager:
    """Gestionnaire sécurisé des mots de passe avec bcrypt"""

    # Nombre de rounds pour bcrypt (12 = bon compromis sécurité/performance)
    BCRYPT_ROUNDS = 12

    @staticmethod
    def hash_password(password: str) -> str:
        """
        Hash un mot de passe avec bcrypt.

        Args:
            password: Mot de passe en clair

        Returns:
            Hash bcrypt du mot de passe (str)

        Example:
            >>> hashed = PasswordManager.hash_password("MonMotDePasse123!")
            >>> print(hashed)
            '$2b$12$...'
        """
        try:
            # Convertir en bytes et hasher
            password_bytes = password.encode('utf-8')
            salt = bcrypt.gensalt(rounds=PasswordManager.BCRYPT_ROUNDS)
            hashed = bcrypt.hashpw(password_bytes, salt)

            # Retourner en string
            return hashed.decode('utf-8')

        except Exception as e:
            logger.error(f"Erreur hachage mot de passe: {e}")
            raise

    @staticmethod
    def verify_password(password: str, hashed_password: str) -> bool:
        """
        Vérifie qu'un mot de passe correspond au hash.

        Args:
            password: Mot de passe en clair à vérifier
            hashed_password: Hash bcrypt stocké

        Returns:
            True si le mot de passe correspond, False sinon

        Example:
            >>> hashed = PasswordManager.hash_password("Test123!")
            >>> PasswordManager.verify_password("Test123!", hashed)
            True
            >>> PasswordManager.verify_password("WrongPassword", hashed)
            False
        """
        try:
            password_bytes = password.encode('utf-8')
            hashed_bytes = hashed_password.encode('utf-8')

            return bcrypt.checkpw(password_bytes, hashed_bytes)

        except Exception as e:
            logger.error(f"Erreur vérification mot de passe: {e}")
            return False


class PasswordValidator:
    """Validateur de politique de mots de passe robuste"""

    # Politique par défaut (peut être modifiée)
    MIN_LENGTH = 12
    REQUIRE_UPPERCASE = True
    REQUIRE_LOWERCASE = True
    REQUIRE_DIGIT = True
    REQUIRE_SPECIAL = True

    @staticmethod
    def validate_password(password: str) -> Tuple[bool, str]:
        """
        Valide un mot de passe selon la politique de sécurité.

        Politique :
        - Minimum 12 caractères
        - Au moins 1 majuscule
        - Au moins 1 minuscule
        - Au moins 1 chiffre
        - Au moins 1 caractère spécial (!@#$%^&*(),.?":{}|<>)

        Args:
            password: Mot de passe à valider

        Returns:
            Tuple (valid: bool, message: str)
            - valid: True si valide, False sinon
            - message: Message d'erreur ou "OK"

        Example:
            >>> valid, msg = PasswordValidator.validate_password("Test@1234567890")
            >>> print(valid, msg)
            True OK
        """
        # Vérifier longueur minimum
        if len(password) < PasswordValidator.MIN_LENGTH:
            return False, f"Minimum {PasswordValidator.MIN_LENGTH} caractères requis"

        # Vérifier majuscule
        if PasswordValidator.REQUIRE_UPPERCASE and not re.search(r'[A-Z]', password):
            return False, "Au moins 1 majuscule requise"

        # Vérifier minuscule
        if PasswordValidator.REQUIRE_LOWERCASE and not re.search(r'[a-z]', password):
            return False, "Au moins 1 minuscule requise"

        # Vérifier chiffre
        if PasswordValidator.REQUIRE_DIGIT and not re.search(r'\d', password):
            return False, "Au moins 1 chiffre requis"

        # Vérifier caractère spécial
        if PasswordValidator.REQUIRE_SPECIAL:
            if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
                return False, "Au moins 1 caractère spécial requis (!@#$%^&*(),.?\":{}|<>)"

        # Vérifier mots de passe communs
        common_passwords = [
            'password', 'admin', 'admin123', '123456', '12345678',
            'qwerty', 'abc123', 'password123', 'letmein', 'welcome'
        ]
        if password.lower() in common_passwords:
            return False, "Mot de passe trop commun, choisissez-en un plus complexe"

        return True, "OK"


class InputSanitizer:
    """Nettoyage et validation des entrées utilisateur"""

    @staticmethod
    def sanitize_input(text: str, max_length: int = 255) -> str:
        """
        Nettoie une entrée utilisateur pour prévenir les injections.

        Args:
            text: Texte à nettoyer
            max_length: Longueur maximale autorisée

        Returns:
            Texte nettoyé

        Example:
            >>> InputSanitizer.sanitize_input("<script>alert('XSS')</script>")
            'scriptalert(XSS)/script'
        """
        if not text:
            return ""

        # Limiter longueur
        text = text[:max_length]

        # Retirer caractères dangereux SQL
        dangerous_sql = ['--', '/*', '*/', 'xp_', 'sp_', ';DROP', ';DELETE', ';INSERT', ';UPDATE']
        for pattern in dangerous_sql:
            text = text.replace(pattern, '')

        # Retirer balises HTML/XSS
        text = text.replace('<', '&lt;')
        text = text.replace('>', '&gt;')

        # Nettoyer espaces
        text = text.strip()

        return text

    @staticmethod
    def validate_email(email: str) -> bool:
        """
        Valide le format d'un email.

        Args:
            email: Adresse email à valider

        Returns:
            True si valide, False sinon

        Example:
            >>> InputSanitizer.validate_email("test@example.com")
            True
            >>> InputSanitizer.validate_email("invalid-email")
            False
        """
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return re.match(pattern, email) is not None

    @staticmethod
    def validate_phone_quebec(phone: str) -> bool:
        """
        Valide un numéro de téléphone québécois.

        Formats acceptés :
        - (514) 123-4567
        - 514-123-4567
        - 5141234567
        - 514 123 4567

        Args:
            phone: Numéro de téléphone

        Returns:
            True si valide, False sinon

        Example:
            >>> InputSanitizer.validate_phone_quebec("(514) 123-4567")
            True
            >>> InputSanitizer.validate_phone_quebec("123")
            False
        """
        # Retirer tous les espaces, tirets, parenthèses
        cleaned = re.sub(r'[\s\-\(\)]', '', phone)

        # Vérifier format : 10 chiffres (Canada)
        if re.match(r'^\d{10}$', cleaned):
            return True

        return False

    @staticmethod
    def validate_sql_safe(text: str) -> Tuple[bool, str]:
        """
        Vérifie qu'une entrée ne contient pas de patterns d'injection SQL.

        Args:
            text: Texte à vérifier

        Returns:
            Tuple (safe: bool, message: str)
        """
        dangerous_patterns = [
            r';\s*DROP',
            r';\s*DELETE',
            r';\s*INSERT',
            r';\s*UPDATE',
            r'--',
            r'/\*',
            r'\*/',
            r'xp_',
            r'sp_',
            r'UNION\s+SELECT',
            r'OR\s+1\s*=\s*1',
            r'OR\s+\'1\'\s*=\s*\'1\'',
        ]

        for pattern in dangerous_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return False, f"Pattern d'injection SQL détecté: {pattern}"

        return True, "OK"


class TokenGenerator:
    """Génération de tokens sécurisés"""

    @staticmethod
    def generate_csrf_token() -> str:
        """
        Génère un token CSRF cryptographiquement sûr.

        Returns:
            Token CSRF (32 bytes en URL-safe base64)

        Example:
            >>> token = TokenGenerator.generate_csrf_token()
            >>> len(token) > 20
            True
        """
        return secrets.token_urlsafe(32)

    @staticmethod
    def generate_session_id() -> str:
        """
        Génère un ID de session unique.

        Returns:
            ID de session (64 bytes en URL-safe base64)
        """
        return secrets.token_urlsafe(64)

    @staticmethod
    def generate_secret_key() -> str:
        """
        Génère une clé secrète pour l'application.

        Returns:
            Clé secrète (64 bytes en URL-safe base64)

        Usage:
            À utiliser pour SECRET_KEY dans .env
        """
        return secrets.token_urlsafe(64)


# ===== FONCTIONS UTILITAIRES =====

def generate_password_strength_score(password: str) -> int:
    """
    Calcule un score de force du mot de passe (0-100).

    Args:
        password: Mot de passe à évaluer

    Returns:
        Score de 0 (très faible) à 100 (excellent)
    """
    score = 0

    # Longueur (max 30 points)
    score += min(len(password) * 2, 30)

    # Diversité caractères
    if re.search(r'[a-z]', password):
        score += 10
    if re.search(r'[A-Z]', password):
        score += 10
    if re.search(r'\d', password):
        score += 10
    if re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        score += 15

    # Complexité (pas de répétitions)
    if not re.search(r'(.)\1{2,}', password):  # Pas de 3 caractères identiques consécutifs
        score += 10

    # Pas de séquences communes
    sequences = ['123', 'abc', 'qwerty', 'azerty']
    has_sequence = any(seq in password.lower() for seq in sequences)
    if not has_sequence:
        score += 15

    return min(score, 100)


def get_password_strength_label(score: int) -> str:
    """
    Retourne un label textuel pour le score de force.

    Args:
        score: Score de 0 à 100

    Returns:
        Label: "Très faible", "Faible", "Moyen", "Fort", "Excellent"
    """
    if score < 30:
        return "Très faible"
    elif score < 50:
        return "Faible"
    elif score < 70:
        return "Moyen"
    elif score < 90:
        return "Fort"
    else:
        return "Excellent"


# ===== TESTS UNITAIRES INTÉGRÉS =====

if __name__ == "__main__":
    print("=== Tests Security Utils ===\n")

    # Test 1: Hash et vérification mot de passe
    print("Test 1: Hachage bcrypt")
    password = "Test@1234567890"
    hashed = PasswordManager.hash_password(password)
    # Note: ne JAMAIS imprimer un mot de passe en clair, même en script de test.
    print(f"  Mot de passe (longueur): {len(password)} chars")
    print(f"  Hash (prefix): {hashed[:7]}...")
    print(f"  Vérification correcte: {PasswordManager.verify_password(password, hashed)}")
    print(f"  Vérification incorrecte: {PasswordManager.verify_password('wrong', hashed)}")
    print()

    # Test 2: Validation mot de passe
    print("Test 2: Validation mot de passe")
    test_passwords = [
        "short",           # Trop court
        "nouppercase123!", # Pas de majuscule
        "NOLOWERCASE123!", # Pas de minuscule
        "NoDigits!!!",     # Pas de chiffre
        "NoSpecial123",    # Pas de spécial
        "admin123",        # Trop commun
        "Valid@Pass123456" # Valide
    ]
    for pwd in test_passwords:
        valid, msg = PasswordValidator.validate_password(pwd)
        status = "✅" if valid else "❌"
        print(f"  {status} '{pwd}': {msg}")
    print()

    # Test 3: Sanitization
    print("Test 3: Sanitization entrées")
    dangerous_inputs = [
        "Normal text",
        "<script>alert('XSS')</script>",
        "'; DROP TABLE users; --",
        "test@example.com"
    ]
    for inp in dangerous_inputs:
        sanitized = InputSanitizer.sanitize_input(inp)
        print(f"  Original: {inp}")
        print(f"  Nettoyé:  {sanitized}")
    print()

    # Test 4: Validation email
    print("Test 4: Validation email")
    emails = ["test@example.com", "invalid-email", "user@domain.co.uk"]
    for email in emails:
        valid = InputSanitizer.validate_email(email)
        status = "✅" if valid else "❌"
        print(f"  {status} {email}")
    print()

    # Test 5: Validation téléphone Québec
    print("Test 5: Validation téléphone Québec")
    phones = ["(514) 123-4567", "514-123-4567", "5141234567", "123"]
    for phone in phones:
        valid = InputSanitizer.validate_phone_quebec(phone)
        status = "✅" if valid else "❌"
        print(f"  {status} {phone}")
    print()

    # Test 6: Score force mot de passe
    print("Test 6: Score force mot de passe")
    for pwd in ["123", "password", "Pass123!", "MyS3cur3P@ssw0rd!"]:
        score = generate_password_strength_score(pwd)
        label = get_password_strength_label(score)
        print(f"  '{pwd}': {score}/100 ({label})")
    print()

    # Test 7: Génération tokens
    print("Test 7: Génération tokens")
    csrf = TokenGenerator.generate_csrf_token()
    session = TokenGenerator.generate_session_id()
    secret = TokenGenerator.generate_secret_key()
    print(f"  CSRF Token: {csrf[:30]}...")
    print(f"  Session ID: {session[:30]}...")
    print(f"  Secret Key: {secret[:30]}...")
    print()

    print("Tous les tests termines!")


# ============================================================================
# FONCTIONS XSS CENTRALISÉES
# ============================================================================

def escape_html(text) -> str:
    """
    Échappe les caractères HTML pour éviter l'injection XSS.
    Fonction centralisée — remplace les copies locales _escape_html() dans chaque module.

    Args:
        text: Texte à échapper (str, None, ou autre)

    Returns:
        str: Texte avec caractères HTML échappés
    """
    import html as html_module
    if text is None:
        return ""
    return html_module.escape(str(text))


def safe_markdown(content: str, **kwargs):
    """
    Wrapper sécurisé pour st.markdown(unsafe_allow_html=True).
    Utiliser pour le HTML statique (CSS, layouts). Pour du contenu avec données utilisateur,
    utiliser escape_html() sur chaque variable AVANT l'interpolation.

    Usage:
        # HTML statique (sûr)
        safe_markdown('<style>.my-class { color: red; }</style>')

        # Avec données utilisateur (échapper d'abord)
        name = escape_html(user_input)
        safe_markdown(f'<div class="card">{name}</div>')

    Args:
        content: Contenu HTML/CSS à rendre
        **kwargs: Arguments supplémentaires pour st.markdown
    """
    import streamlit as st
    st.markdown(content, unsafe_allow_html=True, **kwargs)
