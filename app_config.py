"""
app_config.py - Constructo AI ERP Configuration & Utilities
============================================================
Extracted from app.py (Phase 1 decomposition).

Contains:
- safe_print helper
- Timezone utilities (Quebec) + QUEBEC_TZ constant
- TACHES_PRODUCTION constant (construction task list)
- Currency & price formatting utilities
- CSS loading (external + dark theme)
- Dark mode JS injection (Plotly + DataFrames)
- Fallback / additional CSS styles
"""

import os
import logging
from datetime import datetime

import pytz
import streamlit as st
import streamlit.components.v1 as st_components

# Logger for this module (mirrors app.py pattern)
logger = logging.getLogger(__name__)

# ========================
# SAFE PRINT
# ========================

# Fonction safe_print pour éviter les erreurs "I/O operation on closed file" avec Streamlit
def safe_print(*args, **kwargs):
    """Print sécurisé qui ne crash pas si stdout est fermé (problème Streamlit)"""
    try:
        print(*args, **kwargs)
    except (ValueError, AttributeError, OSError):
        # Si print échoue (stdout fermé), utiliser logger à la place
        try:
            message = ' '.join(str(arg) for arg in args)
            logger.info(message)
        except Exception:
            pass  # Ignorer silencieusement (stdout fermé)


# ========================
# CONSTANTES GLOBALES
# ========================

# Configuration du fuseau horaire du Québec
QUEBEC_TZ = pytz.timezone('America/Montreal')

# Liste unifiée des étapes de construction chronologiques détaillées avec sous-tâches (utilisée dans création ET modification)
TACHES_PRODUCTION = [
    # 1. Planification
    "1.1 Définir les besoins et objectifs du projet",
    "1.2 Concevoir les plans architecturaux",
    "1.3 Établir un budget détaillé",
    "1.4 Créer un calendrier prévisionnel",
    "1.5 Obtenir les permis de construire",

    # 2. Préparation de la démonstration
    "2.1 Installer les clôtures de sécurité",
    "2.2 Mettre en place la signalisation",
    "2.3 Préparer les équipements de protection",
    "2.4 Organiser le stockage des matériaux",

    # 3. Démolition
    "3.1 Déconnecter les services publics",
    "3.2 Retirer les matériaux dangereux",
    "3.3 Démolir la structure existante",
    "3.4 Trier et évacuer les débris",

    # 4. Excavation
    "4.1 Marquer les limites de l'excavation",
    "4.2 Creuser pour les fondations",
    "4.3 Préparer le sol pour les semelles",
    "4.4 Niveler le terrain",

    # 5. Béton
    "5.1 Préparer les coffrages",
    "5.2 Installer les armatures",
    "5.3 Couler les fondations",
    "5.4 Couler les dalles de plancher",
    "5.5 Temps de séchage",

    # 6. Pré-remblayage
    "6.1 Installer le système de drainage",
    "6.2 Compacter le sol",
    "6.3 Remblayer autour des fondations",
    "6.4 Niveler le terrain autour de la structure",

    # 7. Charpente
    "7.1 Ériger les murs porteurs",
    "7.2 Installer les poutres et solives",
    "7.3 Monter la structure du toit",
    "7.4 Poser le contreventement",

    # 8. Toit
    "8.1 Installer le platelage",
    "8.2 Poser la membrane d'étanchéité",
    "8.3 Installer les gouttières",
    "8.4 Poser les tuiles ou autres matériaux de couverture",

    # 9. Plomberie
    "9.1 Installer les conduites d'eau principales",
    "9.2 Poser les tuyaux d'évacuation",
    "9.3 Installer la plomberie brute",
    "9.4 Préparer les connexions pour les appareils",

    # 10. Fenêtres
    "10.1 Mesurer et commander les fenêtres",
    "10.2 Préparer les ouvertures",
    "10.3 Installer les fenêtres",
    "10.4 Calfeutrer et isoler",

    # 11. CVC
    "11.1 Installer les conduits",
    "11.2 Poser l'unité de chauffage/climatisation",
    "11.3 Installer les bouches d'aération",
    "11.4 Configurer le thermostat",

    # 12. Électricité
    "12.1 Installer le panneau électrique principal",
    "12.2 Poser le câblage électrique",
    "12.3 Préparer les boîtiers pour prises et interrupteurs",
    "12.4 Installer la mise à la terre",

    # 13. Enveloppe de la maison
    "13.1 Installer le pare-vapeur",
    "13.2 Poser le revêtement extérieur",
    "13.3 Installer les soffites et bordures de toit",
    "13.4 Calfeutrer les ouvertures",

    # 14. Isolation
    "14.1 Isoler les murs extérieurs",
    "14.2 Isoler le grenier/le toit",
    "14.3 Isoler les sols",
    "14.4 Vérifier l'étanchéité à l'air",

    # 15. Cloisons sèches
    "15.1 Installer les montants pour les cloisons",
    "15.2 Poser les panneaux de gypse",
    "15.3 Appliquer le ruban et le joint",
    "15.4 Poncer et finir les surfaces",

    # 16. Pierre extérieure
    "16.1 Préparer la surface",
    "16.2 Appliquer le mortier",
    "16.3 Poser les pierres",
    "16.4 Jointoyer et nettoyer",

    # 17. Travaux extérieurs
    "17.1 Niveler le terrain",
    "17.2 Installer les systèmes d'irrigation",
    "17.3 Planter les arbres et arbustes",
    "17.4 Poser la pelouse ou le gazon",

    # 18. Revêtement de sol buanderie/salle de chaudière
    "18.1 Préparer le sous-plancher",
    "18.2 Appliquer l'imperméabilisant si nécessaire",
    "18.3 Poser le revêtement de sol",
    "18.4 Installer les plinthes",

    # 19. Parquets
    "19.1 Acclimater le bois",
    "19.2 Préparer le sous-plancher",
    "19.3 Installer le parquet",
    "19.4 Poncer et finir",

    # 20. Carrelage
    "20.1 Préparer la surface",
    "20.2 Poser le ciment-colle",
    "20.3 Installer les carreaux",
    "20.4 Faire les joints et nettoyer",

    # 21. Armoires
    "21.1 Mesurer et commander les armoires",
    "21.2 Assembler les caissons",
    "21.3 Installer les armoires",
    "21.4 Poser les portes et tiroirs",

    # 22. Plomberie - installation des éviers
    "22.1 Raccorder l'alimentation en eau",
    "22.2 Installer les éviers",
    "22.3 Connecter les tuyaux d'évacuation",
    "22.4 Tester les installations",

    # 23. Portes intérieures
    "23.1 Mesurer les ouvertures",
    "23.2 Installer les cadres de porte",
    "23.3 Suspendre les portes",
    "23.4 Ajuster pour un bon fonctionnement",

    # 24. Menuiserie
    "24.1 Installer les plinthes",
    "24.2 Poser les moulures",
    "24.3 Installer les encadrements de fenêtres",
    "24.4 Finir les détails en bois",

    # 25. Peinture intérieure
    "25.1 Préparer les surfaces - nettoyage, masquage",
    "25.2 Appliquer l'apprêt",
    "25.3 Peindre les murs et plafonds",
    "25.4 Peindre les boiseries",

    # 26. Comptoirs en pierre
    "26.1 Mesurer et commander les comptoirs",
    "26.2 Préparer les supports",
    "26.3 Installer les comptoirs",
    "26.4 Sceller les joints",

    # 27. Marge de sécurité dans le planning
    "27.1 Identifier les tâches potentiellement problématiques",
    "27.2 Allouer du temps supplémentaire",
    "27.3 Planifier des alternatives",
    "27.4 Communiquer avec les sous-traitants sur les délais",

    # 28. Terrasses
    "28.1 Préparer le sol",
    "28.2 Construire la structure",
    "28.3 Installer le platelage",
    "28.4 Ajouter les garde-corps si nécessaire",

    # 29. Portes intérieures - installation et quincaillerie
    "29.1 Installer les charnières",
    "29.2 Poser les poignées et serrures",
    "29.3 Ajuster les portes",
    "29.4 Installer les butées de porte",

    # 30. Appareils électroménagers
    "30.1 Livrer les appareils",
    "30.2 Installer les connexions électriques et plomberie",
    "30.3 Mettre en place les appareils",
    "30.4 Tester le fonctionnement",

    # 31. Plomberie finale
    "31.1 Installer les toilettes",
    "31.2 Poser les robinets",
    "31.3 Connecter les lave-vaisselle et lave-linge",
    "31.4 Faire les tests finaux",

    # 32. Électricité finale
    "32.1 Installer les prises et interrupteurs",
    "32.2 Poser les luminaires",
    "32.3 Connecter les appareils électriques",
    "32.4 Tester tous les circuits",

    # 33. Verre de salle de bain
    "33.1 Mesurer et commander les verres",
    "33.2 Installer les parois de douche",
    "33.3 Poser les miroirs",
    "33.4 Calfeutrer et sceller",

    # 34. Finition de la porte de garage
    "34.1 Installer le mécanisme d'ouverture",
    "34.2 Ajuster les ressorts et câbles",
    "34.3 Programmer la télécommande",
    "34.4 Tester le fonctionnement et la sécurité",

    # 35. Inspections FINALES
    "35.1 Planifier les inspections",
    "35.2 Préparer la documentation",
    "35.3 Accompagner les inspecteurs",
    "35.4 Résoudre les problèmes identifiés",

    # 36. Finalisation
    "36.1 Faire une liste des derniers détails à régler",
    "36.2 Effectuer les retouches de peinture",
    "36.3 Ajuster les portes et fenêtres si nécessaire",
    "36.4 Vérifier tous les systèmes",

    # 37. Nettoyage de la maison
    "37.1 Nettoyer en profondeur toutes les surfaces",
    "37.2 Laver les fenêtres",
    "37.3 Aspirer et laver les sols",
    "37.4 Éliminer tous les débris de construction",

    # 38. Achèvement
    "38.1 Faire un tour final avec le propriétaire",
    "38.2 Remettre les clés et les documents",
    "38.3 Expliquer le fonctionnement des systèmes",
    "38.4 Finaliser la paperasse administrative"
]


# ========================
# TIMEZONE UTILITIES
# ========================

def get_quebec_datetime():
    """Retourne la date/heure actuelle du Québec"""
    return datetime.now(QUEBEC_TZ)

def get_quebec_time():
    """Retourne l'heure actuelle du Québec (format HH:MM)"""
    return get_quebec_datetime().strftime("%H:%M")

def get_quebec_date():
    """Retourne la date actuelle du Québec (format DD/MM/YYYY)"""
    return get_quebec_datetime().strftime("%d/%m/%Y")

def convert_to_quebec_time(dt):
    """Convertit un datetime UTC vers le fuseau horaire de Montréal."""
    if dt is None:
        return ""
    try:
        # Si le datetime n'a pas de timezone, on assume UTC
        if dt.tzinfo is None:
            import pytz
            dt = pytz.UTC.localize(dt)
        # Convertir vers Montréal
        dt_quebec = dt.astimezone(QUEBEC_TZ)
        return dt_quebec.strftime('%d/%m %H:%M')
    except Exception as e:
        logger.warning(f"Erreur conversion date timezone Québec: {e}")
        # Fallback si erreur
        if hasattr(dt, 'strftime'):
            return dt.strftime('%d/%m %H:%M')
        return str(dt)[:16].replace('T', ' ')


# ========================
# FONCTIONS UTILITAIRES
# ========================

def safe_price_conversion(price_value, default=0.0):
    """Convertit de manière sécurisée une valeur de prix en float"""
    if price_value is None:
        return default

    try:
        price_str = str(price_value)
        price_str = price_str.replace(' ', '').replace('€', '').replace('$', '').replace(',', '.')
        return float(price_str) if price_str and price_str != '.' else default
    except (ValueError, TypeError):
        return default

def clean_price_for_sum(price_value):
    """Nettoie et convertit un prix pour sommation"""
    try:
        if not price_value:
            return 0.0
        price_str = str(price_value).replace(' ', '').replace('€', '').replace('$', '').replace(',', '.')
        return float(price_str) if price_str else 0.0
    except (ValueError, TypeError):
        return 0.0

def format_currency(value):
    if value is None:
        return "$0.00"
    try:
        s_value = str(value).replace(' ', '').replace('€', '').replace('$', '')
        if ',' in s_value and ('.' not in s_value or s_value.find(',') > s_value.find('.')):
            s_value = s_value.replace('.', '').replace(',', '.')
        elif ',' in s_value and '.' in s_value and s_value.find('.') > s_value.find(','):
            s_value = s_value.replace(',', '')

        num_value = float(s_value)
        if num_value == 0:
            return "$0.00"
        return f"${num_value:,.2f}"
    except (ValueError, TypeError):
        if isinstance(value, (int, float)):
            return f"${value:,.2f}"
        return str(value) + " $ (Err)"


# ========================
# CHARGEMENT DU CSS EXTERNE (OPTIMISÉ AVEC CACHE)
# ========================

def _css_file_mtime(path: str) -> float:
    """Retourne le mtime d'un fichier CSS (0 si absent)."""
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


@st.cache_data(ttl=3600, show_spinner=False)  # 1 heure - fichier CSS statique
def _load_css_content(mtime: float = 0.0):
    """Charge et cache le contenu CSS (re-lit si le fichier change)."""
    try:
        with open('style.css', 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.warning(f"Erreur lecture style.css: {e}")
        return None


@st.cache_data(ttl=3600, show_spinner=False)  # 1 heure - fichier CSS statique
def _load_dark_theme_css(mtime: float = 0.0):
    """Charge et cache le contenu CSS du theme sombre (re-lit si le fichier change)."""
    try:
        with open('dark_theme.css', 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.warning(f"Erreur lecture dark_theme.css: {e}")
        return None


def _inject_dark_mode_plotly_fix():
    """Injecte un script JS qui force les couleurs sombres sur TOUS les charts Plotly.
    Streamlit theme='streamlit' override les couleurs du layout Python,
    donc on utilise Plotly.relayout() côté client pour re-appliquer le dark mode."""
    st_components.html("""
    <script>
    (function() {
        var parentDoc = window.parent.document;
        var parentWin = window.parent;

        // Cleanup complet: observers, timeouts, click listener
        if (parentWin._darkPlotlyObserver) {
            parentWin._darkPlotlyObserver.disconnect();
        }
        if (parentWin._darkPlotlyTimeouts) {
            parentWin._darkPlotlyTimeouts.forEach(function(t) { clearTimeout(t); });
        }
        if (parentWin._darkPlotlyClickHandler) {
            parentDoc.removeEventListener('click', parentWin._darkPlotlyClickHandler);
        }
        parentWin._darkPlotlyTimeouts = [];

        var darkLayout = {
            'paper_bgcolor': '#0d1117',
            'plot_bgcolor': '#161b22',
            'font.color': '#e6edf3',
            'title.font.color': '#e6edf3',
            'xaxis.color': '#8b949e',
            'yaxis.color': '#8b949e',
            'xaxis.gridcolor': '#21262d',
            'yaxis.gridcolor': '#21262d',
            'xaxis.zerolinecolor': '#30363d',
            'yaxis.zerolinecolor': '#30363d',
            'legend.bgcolor': '#161b22',
            'legend.bordercolor': '#30363d',
            'legend.font.color': '#e6edf3'
        };

        var applying = false;

        // Vérifie si une couleur est déjà sombre (hex ou rgb)
        function isDarkBg(bg) {
            if (!bg) return false;
            // Vérifier les valeurs hex connues
            var lc = bg.toLowerCase().replace(/\\s/g, '');
            if (lc === '#0d1117' || lc === '#161b22' || lc === 'rgba(0,0,0,0)') return true;
            // Vérifier les valeurs rgb équivalentes (Plotly convertit hex→rgb)
            if (lc === 'rgb(13,17,23)' || lc === 'rgb(22,27,34)' || lc === 'rgb(17,17,17)') return true;
            // Vérifier toute couleur sombre via parsing
            var m = bg.match(/rgb[a]?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
            if (m) {
                var r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
                return (r + g + b) / 3 < 40; // Luminosité moyenne < 40 = sombre
            }
            return false;
        }

        function applyDarkToPlots() {
            if (applying) return;
            var P = parentWin.Plotly;
            if (!P) return;
            applying = true;

            try {
                var plots = parentDoc.querySelectorAll('.js-plotly-plot');
                for (var i = 0; i < plots.length; i++) {
                    var plot = plots[i];
                    if (plot._fullLayout) {
                        var bg = plot._fullLayout.paper_bgcolor;
                        // Appliquer uniquement sur les charts avec fond clair (pas ceux déjà en dark via theme=None)
                        if (!isDarkBg(bg)) {
                            try {
                                P.relayout(plot, darkLayout);
                            } catch(e) {}
                        }
                        // Aussi forcer resize pour les charts rendus dans des tabs cachés
                        if (plot.offsetParent !== null && plot.offsetWidth > 50) {
                            try { P.Plots.resize(plot); } catch(e) {}
                        }
                    }
                }
            } finally {
                setTimeout(function() { applying = false; }, 300);
            }
        }

        // Observer pour détecter les nouveaux charts Plotly
        var observer = new parentWin.MutationObserver(function(mutations) {
            for (var m = 0; m < mutations.length; m++) {
                for (var n = 0; n < mutations[m].addedNodes.length; n++) {
                    var node = mutations[m].addedNodes[n];
                    if (node.nodeType === 1 && node.querySelector && node.querySelector('.js-plotly-plot')) {
                        var t = setTimeout(applyDarkToPlots, 300);
                        parentWin._darkPlotlyTimeouts.push(t);
                        return;
                    }
                }
            }
        });

        observer.observe(parentDoc.body, { childList: true, subtree: true });
        parentWin._darkPlotlyObserver = observer;

        // Applications initiales (multiples essais pour les rendus lents)
        [300, 800, 1500, 3000, 5000].forEach(function(delay) {
            var t = setTimeout(applyDarkToPlots, delay);
            parentWin._darkPlotlyTimeouts.push(t);
        });

        // Écouter les clics sur les onglets (tabs) pour re-appliquer
        function onPlotlyTabClick(e) {
            var tab = e.target.closest('[data-baseweb="tab"]') || e.target.closest('[role="tab"]');
            if (tab) {
                [200, 500, 1000, 2000].forEach(function(delay) {
                    var t = setTimeout(applyDarkToPlots, delay);
                    parentWin._darkPlotlyTimeouts.push(t);
                });
            }
        }
        parentWin._darkPlotlyClickHandler = onPlotlyTabClick;
        parentDoc.addEventListener('click', onPlotlyTabClick);
    })();
    </script>
    """, height=0)


def _inject_dark_mode_dataframe_fix():
    """Injecte un script JS qui force le theme sombre sur les DataFrames (Glide Data Grid).
    Le GDG utilise un Canvas pour le rendu, donc les CSS variables doivent être
    définies directement sur les éléments wrapper pour être lues par le renderer.
    Approche multi-couche: 1) Variables :root 2) Variables inline 3) Force re-render."""
    st_components.html("""
    <script>
    (function() {
        var parentDoc = window.parent.document;
        var parentWin = window.parent;

        // Cleanup complet: observers, timeouts, click listener
        if (parentWin._darkGdgObserver) {
            parentWin._darkGdgObserver.disconnect();
        }
        if (parentWin._darkGdgTimeouts) {
            parentWin._darkGdgTimeouts.forEach(function(t) { clearTimeout(t); });
        }
        if (parentWin._darkGdgClickHandler) {
            parentDoc.removeEventListener('click', parentWin._darkGdgClickHandler);
        }
        parentWin._darkGdgTimeouts = [];

        var gdgVars = {
            '--gdg-bg-cell': '#0d1117',
            '--gdg-bg-header': '#161b22',
            '--gdg-bg-header-has-focus': '#1c2128',
            '--gdg-bg-header-hovered': '#1c2128',
            '--gdg-text-dark': '#e6edf3',
            '--gdg-text-medium': '#8b949e',
            '--gdg-text-light': '#6e7681',
            '--gdg-text-header': '#58a6ff',
            '--gdg-border-color': '#30363d',
            '--gdg-horizontal-border-color': '#21262d',
            '--gdg-accent-color': '#3b82f6',
            '--gdg-accent-fg': '#ffffff',
            '--gdg-accent-light': 'rgba(59, 130, 246, 0.15)',
            '--gdg-bg-cell-medium': '#161b22',
            '--gdg-bg-bubble': '#21262d',
            '--gdg-bg-bubble-selected': '#30363d',
            '--gdg-link-color': '#58a6ff',
            '--gdg-bg-search-result': 'rgba(210, 153, 34, 0.2)',
            '--gdg-drilldown-border': '#30363d'
        };

        // Couche 1: Injecter variables au niveau :root via <style> (backup CSS)
        if (!parentDoc.getElementById('gdg-dark-vars')) {
            var styleEl = parentDoc.createElement('style');
            styleEl.id = 'gdg-dark-vars';
            var cssText = ':root{';
            for (var v in gdgVars) {
                cssText += v + ':' + gdgVars[v] + ' !important;';
            }
            cssText += '}';
            // Aussi forcer sur les conteneurs directement
            cssText += '[data-testid="stDataFrame"],[data-testid="stDataEditor"],[data-testid="stDataFrame"] *,[data-testid="stDataEditor"] *{';
            for (var v2 in gdgVars) {
                cssText += v2 + ':' + gdgVars[v2] + ' !important;';
            }
            cssText += '}';
            styleEl.textContent = cssText;
            parentDoc.head.appendChild(styleEl);
        }

        // Couche 2: Appliquer aussi sur :root directement
        for (var rootV in gdgVars) {
            parentDoc.documentElement.style.setProperty(rootV, gdgVars[rootV], 'important');
        }

        function applyDarkToDataframes() {
            // Cibler tous les conteneurs de dataframes
            var containers = parentDoc.querySelectorAll(
                '[data-testid="stDataFrame"], [data-testid="stDataEditor"]'
            );
            for (var i = 0; i < containers.length; i++) {
                var container = containers[i];
                // Appliquer les variables CSS directement sur le conteneur
                for (var prop in gdgVars) {
                    container.style.setProperty(prop, gdgVars[prop], 'important');
                }
                // Aussi sur les sous-éléments GDG
                var gdgEditors = container.querySelectorAll('[data-testid="glideDataEditor"]');
                for (var j = 0; j < gdgEditors.length; j++) {
                    for (var prop2 in gdgVars) {
                        gdgEditors[j].style.setProperty(prop2, gdgVars[prop2], 'important');
                    }
                }
                // Forcer aussi sur tous les divs internes du GDG
                var innerDivs = container.querySelectorAll('div');
                for (var k = 0; k < innerDivs.length; k++) {
                    for (var prop3 in gdgVars) {
                        innerDivs[k].style.setProperty(prop3, gdgVars[prop3], 'important');
                    }
                }
                // Appliquer filtre invert(0.85) sur les canvas GDG (rendu natif)
                // Pas de hue-rotate pour éviter la teinte rouge/mauve
                var canvases = container.querySelectorAll('canvas');
                for (var c = 0; c < canvases.length; c++) {
                    canvases[c].style.setProperty('filter', 'invert(0.85)', 'important');
                }
            }
            // Déclencher un resize pour forcer le GDG à relire les variables
            try {
                parentWin.dispatchEvent(new Event('resize'));
            } catch(e) {}
        }

        // Observer pour détecter les nouveaux DataFrames
        var observer = new parentWin.MutationObserver(function(mutations) {
            for (var m = 0; m < mutations.length; m++) {
                for (var n = 0; n < mutations[m].addedNodes.length; n++) {
                    var node = mutations[m].addedNodes[n];
                    if (node.nodeType === 1) {
                        var hasDF = (node.getAttribute && (
                            node.getAttribute('data-testid') === 'stDataFrame' ||
                            node.getAttribute('data-testid') === 'stDataEditor'
                        )) || (node.querySelector && node.querySelector(
                            '[data-testid="stDataFrame"], [data-testid="stDataEditor"]'
                        ));
                        if (hasDF) {
                            [50, 150, 400, 800, 1500].forEach(function(delay) {
                                var t = setTimeout(applyDarkToDataframes, delay);
                                parentWin._darkGdgTimeouts.push(t);
                            });
                            break;
                        }
                    }
                }
            }
        });

        observer.observe(parentDoc.body, { childList: true, subtree: true });
        parentWin._darkGdgObserver = observer;

        // Applications initiales (plus rapides et plus fréquentes)
        [50, 200, 500, 1000, 2000, 4000].forEach(function(delay) {
            var t = setTimeout(applyDarkToDataframes, delay);
            parentWin._darkGdgTimeouts.push(t);
        });

        // Re-appliquer sur clics d'onglets (handler nommé pour cleanup)
        function onGdgTabClick(e) {
            var tab = e.target.closest('[data-baseweb="tab"]') || e.target.closest('[role="tab"]');
            if (tab) {
                [100, 300, 600, 1200, 2000].forEach(function(delay) {
                    var t = setTimeout(applyDarkToDataframes, delay);
                    parentWin._darkGdgTimeouts.push(t);
                });
            }
        }
        parentWin._darkGdgClickHandler = onGdgTabClick;
        parentDoc.addEventListener('click', onGdgTabClick);
    })();
    </script>
    """, height=0)


def load_external_css():
    """Charge le fichier CSS externe pour un design uniforme (optimisé avec cache)"""
    css_content = _load_css_content(_css_file_mtime('style.css'))
    if css_content:
        st.markdown(f'<style>{css_content}</style>', unsafe_allow_html=True)
        # Appliquer le theme sombre si active
        if st.session_state.get('dark_mode', False):
            dark_css = _load_dark_theme_css(_css_file_mtime('dark_theme.css'))
            if dark_css:
                st.markdown(f'<style>{dark_css}</style>', unsafe_allow_html=True)
            # Injecter le fix JS pour Plotly dark mode
            _inject_dark_mode_plotly_fix()
            # Injecter le fix JS GDG pour theming natif des DataFrames.
            # Les variables --gdg-* sont appliquées inline + via CSS.
            _inject_dark_mode_dataframe_fix()
        return True
    else:
        st.warning("⚠️ Fichier style.css non trouvé. Utilisation du style par défaut.")
        return False

def apply_fallback_styles():
    """Styles CSS de secours si le fichier externe n'est pas disponible"""
    is_dark = st.session_state.get('dark_mode', False)
    if is_dark:
        st.markdown("""
        <style>
        /* Styles de secours minimaux - DARK MODE */
        :root {
            --primary-color: #3b82f6;
            --primary-color-light: #60a5fa;
            --primary-color-lighter: rgba(59, 130, 246, 0.15);
            --primary-color-darker: #2563eb;
            --text-color: #e6edf3;
            --background-color: #0d1117;
            --card-background: #1c2128;
            --border-radius-lg: 0.75rem;
            --box-shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4);
        }
        .stApp, [data-testid="stAppViewContainer"] { background-color: #0d1117 !important; color: #e6edf3 !important; }
        section[data-testid="stSidebar"] { background: #161b22 !important; }
        .main { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #0d1117; color: #e6edf3; }
        h1, h2, h3, h4, h5, h6 { color: #e6edf3 !important; }
        .stButton > button { background: #3b82f6 !important; color: white !important; border: none !important; border-radius: var(--border-radius-lg) !important; }
        .stButton > button:hover { background: #2563eb !important; transform: translateY(-2px) !important; }
        .stButton > button[kind="secondary"], .stButton > button[kind="tertiary"], button[data-baseweb="button"] { background: #3b82f6 !important; color: white !important; border: none !important; }
        #MainMenu {visibility: hidden;} footer {visibility: hidden;} .css-1d391kg {display: none;}
        </style>
        """, unsafe_allow_html=True)
    else:
        st.markdown("""
        <style>
        /* Styles de secours minimaux */
        :root {
            --primary-color: #2563eb;
            --primary-color-light: #3b82f6;
            --primary-color-lighter: #dbeafe;
            --primary-color-darker: #1d4ed8;
            --text-color: #374151;
            --background-color: #F9FAFB;
            --card-background: #f8fafc;
            --border-radius-lg: 0.75rem;
            --box-shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        }
        .main { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--background-color); }
        .stButton > button { background: #2563eb !important; color: white !important; border: none !important; border-radius: var(--border-radius-lg) !important; transition: all 0.3s ease !important; }
        .stButton > button:hover { background: #1d4ed8 !important; transform: translateY(-2px) !important; box-shadow: var(--box-shadow-md) !important; }
        .stButton > button[kind="secondary"], .stButton > button[kind="tertiary"], button[data-baseweb="button"] { background: #2563eb !important; color: white !important; border: none !important; }
        #MainMenu {visibility: hidden;} footer {visibility: hidden;} .css-1d391kg {display: none;}
        </style>
        """, unsafe_allow_html=True)

def apply_additional_project_styles():
    """Styles CSS supplémentaires pour la gestion des projets"""
    st.markdown("""
    <style>
    .project-card {
        border-left: 5px solid var(--primary-color);
        margin-bottom: 1rem;
        padding: 1rem;
        border-radius: 8px;
        background: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .project-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }

    .project-card h4 {
        margin: 0;
        color: #1e40af;
        font-size: 1.1rem;
    }

    .project-card p {
        margin: 0.5rem 0;
        color: #6b7280;
    }

    .status-badge {
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: 500;
        color: white;
        display: inline-block;
    }

    .priority-badge {
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: 500;
        color: white;
        display: inline-block;
        margin-left: 0.5rem;
    }

    .info-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 1rem;
        margin: 0.5rem 0;
    }

    .section-card {
        background: white;
        border-radius: 12px;
        padding: 1.5rem;
        margin: 1rem 0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .welcome-card {
        background: #eff6ff;
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        margin: 2rem 0;
        border: 1px solid var(--primary-color-light);
    }

    .portal-header {
        text-align: center;
        margin: 2rem 0;
        padding: 2rem;
        background: #2563eb;
        border-radius: 12px;
        color: white;
    }

    .portal-subtitle {
        margin-top: 1rem;
        font-size: 1.1rem;
        opacity: 0.9;
    }

    .access-card {
        background: white;
        border-radius: 12px;
        padding: 2rem;
        margin: 1rem 0;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        text-align: center;
    }

    .access-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }

    .access-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
    }

    .access-title {
        font-size: 1.5rem;
        font-weight: bold;
        margin-bottom: 0.5rem;
        color: var(--primary-color);
    }

    .access-description {
        color: #6b7280;
        margin-bottom: 1rem;
        font-size: 1rem;
    }

    .access-features {
        text-align: left;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .access-features li {
        margin: 0.5rem 0;
        padding-left: 1rem;
        color: #374151;
    }

    .employee-header {
        background: #eff6ff;
        padding: 1.5rem;
        border-radius: 12px;
        text-align: center;
        margin-bottom: 2rem;
    }

    .admin-welcome {
        background: #dbeafe;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        margin-bottom: 1rem;
        border-left: 4px solid var(--primary-color);
    }

    .admin-auth {
        max-width: 400px;
        margin: 2rem auto;
        background: white;
        padding: 2rem;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        text-align: center;
    }

    .alert-success {
        background: #dcfce7;
        border: 1px solid #bbf7d0;
        color: #166534;
        padding: 1rem;
        border-radius: 8px;
        margin: 1rem 0;
    }

    .alert-error {
        background: #fee2e2;
        border: 1px solid #fecaca;
        color: #dc2626;
        padding: 1rem;
        border-radius: 8px;
        margin: 1rem 0;
    }

    .main-title {
        text-align: center;
        margin: 2rem 0;
        padding: 1.5rem;
        background: #eff6ff;
        border-radius: 12px;
        border-left: 5px solid var(--primary-color);
    }

    .portal-footer {
        text-align: center;
        margin-top: 3rem;
        padding: 2rem;
        background: #f8fafc;
        border-radius: 12px;
        border-top: 3px solid var(--primary-color);
    }
    </style>
    """, unsafe_allow_html=True)

def apply_additional_attachments_styles():
    """Styles CSS pour les pièces jointes"""
    st.markdown("""
    <style>
    /* Styles pour pièces jointes */
    .attachment-upload-zone {
        border: 2px dashed var(--primary-color);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        background: #eff6ff;
        margin: 1rem 0;
        transition: all 0.3s ease;
        position: relative;
        cursor: pointer;
    }

    .attachment-upload-zone:hover {
        border-color: var(--primary-color-dark);
        background: #dbeafe;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
    }

    .attachment-card {
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 1rem;
        margin: 0.5rem 0;
        background: white;
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
    }

    .attachment-card::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        width: 4px;
        height: 100%;
        background: var(--primary-color);
        opacity: 0;
        transition: opacity 0.2s ease;
    }

    .attachment-card:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        transform: translateY(-1px);
        border-color: var(--primary-color-light);
    }

    .attachment-card:hover::before {
        opacity: 1;
    }
    </style>
    """, unsafe_allow_html=True)
