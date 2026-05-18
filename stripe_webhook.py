#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Webhook endpoint pour Stripe - Constructo AI
Recoit et traite les evenements Stripe (paiements, abonnements, etc.)

Ce fichier peut etre execute comme serveur Flask standalone ou integre
"""

import os
import logging
from flask import Flask, request, jsonify

# Configuration logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import du gestionnaire Stripe
try:
    from stripe_manager import handle_webhook_event, init_subscriptions_table
    STRIPE_MANAGER_AVAILABLE = True
except ImportError:
    STRIPE_MANAGER_AVAILABLE = False
    logger.error("stripe_manager non disponible")

# Creer l'application Flask
app = Flask(__name__)


@app.route('/webhook/stripe', methods=['POST'])
def stripe_webhook():
    """
    Endpoint pour recevoir les webhooks Stripe

    Configure dans Stripe Dashboard:
    - URL: https://votre-app.onrender.com/webhook/stripe
    - Events: checkout.session.completed, customer.subscription.*
    """
    if not STRIPE_MANAGER_AVAILABLE:
        return jsonify({'error': 'Stripe manager non disponible'}), 500

    payload = request.get_data()
    sig_header = request.headers.get('Stripe-Signature', '')

    result = handle_webhook_event(payload, sig_header)

    if result.get('success'):
        return jsonify(result), 200
    else:
        return jsonify(result), 400


@app.route('/webhook/stripe/test', methods=['GET'])
def stripe_webhook_test():
    """Endpoint de test pour verifier que le webhook est accessible"""
    return jsonify({
        'status': 'ok',
        'message': 'Stripe webhook endpoint is ready',
        'stripe_manager_available': STRIPE_MANAGER_AVAILABLE
    }), 200


@app.route('/health', methods=['GET'])
def health_check():
    """Health check pour Render"""
    return jsonify({'status': 'healthy'}), 200


# =============================================================================
# INTEGRATION AVEC STREAMLIT (via API interne)
# =============================================================================

def create_webhook_blueprint():
    """
    Cree un blueprint Flask pour integrer dans une app existante

    Usage:
        from stripe_webhook import create_webhook_blueprint
        app.register_blueprint(create_webhook_blueprint(), url_prefix='/api')
    """
    from flask import Blueprint

    webhook_bp = Blueprint('stripe_webhook', __name__)

    @webhook_bp.route('/webhook/stripe', methods=['POST'])
    def webhook():
        if not STRIPE_MANAGER_AVAILABLE:
            return jsonify({'error': 'Stripe manager non disponible'}), 500

        payload = request.get_data()
        sig_header = request.headers.get('Stripe-Signature', '')
        result = handle_webhook_event(payload, sig_header)

        if result.get('success'):
            return jsonify(result), 200
        else:
            return jsonify(result), 400

    return webhook_bp


# =============================================================================
# CONFIGURATION POUR RENDER
# =============================================================================

"""
Pour deployer sur Render avec Streamlit + webhook:

Option 1: Utiliser un worker separe
----------------------------------
render.yaml:
  services:
    - type: web
      name: constructo-ai
      buildCommand: pip install -r requirements.txt
      startCommand: streamlit run app.py --server.port $PORT

    - type: worker
      name: stripe-webhook
      buildCommand: pip install -r requirements.txt
      startCommand: gunicorn stripe_webhook:app -b 0.0.0.0:$PORT

Option 2: Proxy via Streamlit (plus simple)
-------------------------------------------
Voir l'integration dans app.py avec st_pages ou un thread Flask
"""


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    # Initialiser la table subscriptions
    if STRIPE_MANAGER_AVAILABLE:
        init_subscriptions_table()

    # Port depuis variable d'environnement (Render) ou 5000 par defaut
    port = int(os.environ.get('PORT', 5000))

    print(f"Demarrage du serveur webhook Stripe sur le port {port}")
    print(f"Endpoint: http://localhost:{port}/webhook/stripe")

    # En production, utiliser gunicorn:
    # gunicorn stripe_webhook:app -b 0.0.0.0:$PORT

    app.run(host='0.0.0.0', port=port, debug=False)
