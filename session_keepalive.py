"""
Session Keep-Alive Module - Constructo AI
==========================================
Maintient les sessions utilisateur actives en envoyant des pings réguliers.
Résout le problème de déconnexion automatique après ~10 minutes d'inactivité.

Le problème:
- Streamlit utilise des WebSockets pour la communication
- Les hébergeurs cloud (Render, etc.) ferment les connexions inactives
- Sans activité, la session est perdue après quelques minutes

Solution:
- Injecter un script JavaScript qui envoie des pings réguliers
- Mettre à jour last_activity côté serveur
- Utiliser st.fragment pour des mises à jour partielles

Auteur: Constructo AI
Date: Janvier 2025
"""

import time
import logging
import streamlit as st
import streamlit.components.v1 as components
from datetime import datetime

logger = logging.getLogger(__name__)

# Configuration du keep-alive
KEEPALIVE_INTERVAL_SECONDS = 30  # Ping toutes les 30 secondes
KEEPALIVE_ENABLED = True


def inject_keepalive_script(interval_seconds: int = KEEPALIVE_INTERVAL_SECONDS):
    """
    Injecte un script JavaScript qui maintient la session active.

    Ce script:
    1. Envoie un ping au serveur toutes les X secondes
    2. Déclenche un léger rerun si l'onglet est actif
    3. Évite les déconnexions dues à l'inactivité WebSocket

    Args:
        interval_seconds: Intervalle entre les pings (défaut: 30s)
    """
    if not KEEPALIVE_ENABLED:
        return

    # Ne pas injecter si déjà fait dans cette session
    if st.session_state.get('_keepalive_injected', False):
        return

    js_code = f"""
    <script>
    (function() {{
        // Configuration
        const PING_INTERVAL = {interval_seconds * 1000}; // {interval_seconds} secondes en millisecondes
        const SESSION_KEY = 'constructo_last_ping';

        // Éviter les doublons
        if (window._constructoKeepaliveActive) {{
            console.log('[KEEPALIVE] Déjà actif, skip');
            return;
        }}
        window._constructoKeepaliveActive = true;

        // Compteur de pings
        let pingCount = 0;
        let lastPingTime = Date.now();

        // Fonction de ping
        function sendPing() {{
            const now = Date.now();
            const timeSinceLastPing = now - lastPingTime;

            // IMPORTANT: On envoie le ping MÊME si l'onglet est caché!
            // Sinon Render tue le WebSocket après ~5 min d'inactivité
            // et l'utilisateur perd sa session.

            pingCount++;
            lastPingTime = now;

            // Stocker le timestamp du dernier ping
            try {{
                localStorage.setItem(SESSION_KEY, now.toString());
            }} catch (e) {{
                // localStorage peut ne pas être disponible
            }}

            console.log('[KEEPALIVE] Ping #' + pingCount + ' envoyé');

            // Méthode 1: Cliquer sur un élément invisible pour déclencher un rerun léger
            // Ceci maintient la connexion WebSocket active
            try {{
                // Chercher le bouton de keepalive caché (s'il existe)
                const keepaliveBtn = document.querySelector('[data-testid="keepalive-trigger"]');
                if (keepaliveBtn) {{
                    keepaliveBtn.click();
                }}
            }} catch (e) {{
                console.log('[KEEPALIVE] Pas de bouton trigger');
            }}
        }}

        // Démarrer le ping périodique
        setInterval(sendPing, PING_INTERVAL);

        // Premier ping immédiat
        setTimeout(sendPing, 1000);

        // Gestionnaire de visibilité - ping quand l'onglet redevient visible
        document.addEventListener('visibilitychange', function() {{
            if (!document.hidden) {{
                console.log('[KEEPALIVE] Onglet redevenu visible, ping immédiat');
                sendPing();
            }}
        }});

        // Gestionnaire de focus - ping quand la fenêtre reçoit le focus
        window.addEventListener('focus', function() {{
            console.log('[KEEPALIVE] Fenêtre focus, ping immédiat');
            sendPing();
        }});

        console.log('[KEEPALIVE] Module initialisé (interval: {interval_seconds}s)');
    }})();
    </script>
    """

    # Injecter le script (hauteur 0 = invisible)
    components.html(js_code, height=0)

    # Marquer comme injecté
    st.session_state._keepalive_injected = True
    logger.debug("[KEEPALIVE] Script JavaScript injecté")


def update_session_activity():
    """
    Met à jour le timestamp de dernière activité de la session.
    À appeler régulièrement pour maintenir la session active côté serveur.
    """
    st.session_state.last_activity = time.time()
    st.session_state._last_activity_update = datetime.now().isoformat()


def create_keepalive_trigger():
    """
    Crée un bouton invisible qui peut être cliqué par JavaScript
    pour déclencher une mise à jour de session.
    """
    # Bouton caché qui met à jour l'activité quand cliqué
    if st.button("keepalive", key="_keepalive_btn",
                 type="secondary",
                 disabled=False,
                 width='content'):
        update_session_activity()
        logger.debug("[KEEPALIVE] Activité mise à jour via trigger")

    # Cacher le bouton avec CSS
    st.markdown("""
    <style>
    button[kind="secondary"]:has([data-testid="baseButton-secondary"]) {
        display: none !important;
    }
    /* Cacher le bouton keepalive */
    button:contains("keepalive"),
    div[data-testid="stButton"] button[kind="secondary"] {
        position: absolute !important;
        left: -9999px !important;
        visibility: hidden !important;
        height: 0 !important;
        width: 0 !important;
        overflow: hidden !important;
    }
    </style>
    """, unsafe_allow_html=True)


def check_session_health() -> dict:
    """
    Vérifie la santé de la session actuelle.

    Returns:
        dict: Informations sur la session
    """
    now = time.time()
    last_activity = st.session_state.get('last_activity', now)
    elapsed = now - last_activity

    return {
        'is_healthy': elapsed < 600,  # Moins de 10 minutes
        'elapsed_seconds': int(elapsed),
        'elapsed_minutes': round(elapsed / 60, 1),
        'last_activity': st.session_state.get('_last_activity_update', 'N/A'),
        'keepalive_active': st.session_state.get('_keepalive_injected', False),
    }


def setup_keepalive():
    """
    Configuration complète du système de keep-alive.
    À appeler au début de app.py, après st.set_page_config().
    """
    if not KEEPALIVE_ENABLED:
        logger.info("[KEEPALIVE] Système désactivé")
        return

    # Injecter le script JavaScript
    inject_keepalive_script()

    # Mettre à jour l'activité
    update_session_activity()

    logger.debug("[KEEPALIVE] Système configuré avec succès")


# Auto-documentation
if __name__ == "__main__":
    print("""
Session Keep-Alive Module - Constructo AI
==========================================

Ce module résout le problème de déconnexion automatique après ~10 minutes.

UTILISATION:
-----------
Dans app.py, après st.set_page_config():

    from session_keepalive import setup_keepalive
    setup_keepalive()

CONFIGURATION:
-------------
- KEEPALIVE_INTERVAL_SECONDS: Intervalle entre les pings (défaut: 30s)
- KEEPALIVE_ENABLED: Activer/désactiver le système

FONCTIONNEMENT:
--------------
1. Un script JavaScript est injecté dans la page
2. Ce script envoie des pings toutes les 30 secondes
3. Les pings maintiennent la connexion WebSocket active
4. La session côté serveur est mise à jour

DIAGNOSTIC:
----------
Utilisez check_session_health() pour vérifier l'état de la session.
""")
