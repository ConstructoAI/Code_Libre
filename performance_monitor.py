"""
Module Monitoring Performance - ERP Constructo AI
==========================================
Surveiller et analyser les performances de l'application.

Fonctionnalites :
- Decorateur timing pour mesurer temps execution
- Tracking des requetes DB lentes
- Monitoring memoire et CPU
- Metriques temps reel
- Dashboard performance Streamlit
- Alertes performance

Auteur: Constructo AI
Date: Janvier 2025
"""

import time
import logging
import psutil
import streamlit as st
from functools import wraps
from typing import Dict, List, Callable, Optional, Any
from datetime import datetime, timedelta
from collections import defaultdict, deque
import threading

logger = logging.getLogger(__name__)


class PerformanceMonitor:
    """Moniteur de performance centralisé"""

    # Seuils d'alerte (secondes)
    SLOW_QUERY_THRESHOLD = 1.0      # 1 seconde
    SLOW_FUNCTION_THRESHOLD = 2.0   # 2 secondes
    MEMORY_WARNING_PERCENT = 80     # 80% RAM
    CPU_WARNING_PERCENT = 90        # 90% CPU

    def __init__(self):
        self.query_times = deque(maxlen=1000)  # Garder dernières 1000 requêtes
        self.function_times = defaultdict(list)
        self.slow_queries = deque(maxlen=100)
        self.slow_functions = deque(maxlen=100)
        self.request_counts = defaultdict(int)
        self._lock = threading.Lock()

    def record_query(self, query: str, duration: float, params: tuple = None):
        """
        Enregistrer une requête DB.

        Args:
            query: Requête SQL
            duration: Temps d'exécution (secondes)
            params: Paramètres de la requête
        """
        with self._lock:
            timestamp = datetime.now()

            # Enregistrer dans historique
            self.query_times.append({
                'timestamp': timestamp,
                'query': query[:200],  # Limiter taille
                'duration': duration,
                'params': str(params)[:100] if params else None
            })

            # Détecter requêtes lentes
            if duration > self.SLOW_QUERY_THRESHOLD:
                self.slow_queries.append({
                    'timestamp': timestamp,
                    'query': query[:500],
                    'duration': duration,
                    'params': str(params)[:200] if params else None
                })

                logger.warning(
                    f"🐌 REQUÊTE LENTE ({duration:.2f}s): {query[:200]}"
                )

    def record_function_call(self, function_name: str, duration: float):
        """
        Enregistrer appel de fonction.

        Args:
            function_name: Nom de la fonction
            duration: Temps d'exécution (secondes)
        """
        with self._lock:
            timestamp = datetime.now()

            # Enregistrer dans historique
            self.function_times[function_name].append({
                'timestamp': timestamp,
                'duration': duration
            })

            # Limiter historique par fonction (100 derniers appels)
            if len(self.function_times[function_name]) > 100:
                self.function_times[function_name] = \
                    self.function_times[function_name][-100:]

            # Détecter fonctions lentes
            if duration > self.SLOW_FUNCTION_THRESHOLD:
                self.slow_functions.append({
                    'timestamp': timestamp,
                    'function': function_name,
                    'duration': duration
                })

                logger.warning(
                    f"🐌 FONCTION LENTE ({duration:.2f}s): {function_name}"
                )

            # Compter appels
            self.request_counts[function_name] += 1

    def get_query_stats(self) -> Dict[str, Any]:
        """
        Obtenir statistiques des requêtes DB.

        Returns:
            Dictionnaire avec stats
        """
        with self._lock:
            if not self.query_times:
                return {
                    'total_queries': 0,
                    'avg_duration': 0,
                    'max_duration': 0,
                    'slow_queries': 0
                }

            durations = [q['duration'] for q in self.query_times]

            return {
                'total_queries': len(self.query_times),
                'avg_duration': sum(durations) / len(durations),
                'max_duration': max(durations),
                'min_duration': min(durations),
                'slow_queries': len(self.slow_queries),
                'recent_queries': list(self.query_times)[-10:]
            }

    def get_function_stats(self) -> Dict[str, Any]:
        """
        Obtenir statistiques des fonctions.

        Returns:
            Dictionnaire avec stats par fonction
        """
        with self._lock:
            stats = {}

            for func_name, calls in self.function_times.items():
                if not calls:
                    continue

                durations = [c['duration'] for c in calls]

                stats[func_name] = {
                    'total_calls': self.request_counts[func_name],
                    'avg_duration': sum(durations) / len(durations),
                    'max_duration': max(durations),
                    'min_duration': min(durations),
                    'recent_calls': len(calls)
                }

            return stats

    def get_system_stats(self) -> Dict[str, Any]:
        """
        Obtenir statistiques système (CPU, RAM).

        Returns:
            Dictionnaire avec métriques système
        """
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')

            return {
                'cpu_percent': cpu_percent,
                'cpu_warning': cpu_percent > self.CPU_WARNING_PERCENT,
                'memory_percent': memory.percent,
                'memory_used_gb': memory.used / (1024 ** 3),
                'memory_total_gb': memory.total / (1024 ** 3),
                'memory_warning': memory.percent > self.MEMORY_WARNING_PERCENT,
                'disk_percent': disk.percent,
                'disk_used_gb': disk.used / (1024 ** 3),
                'disk_total_gb': disk.total / (1024 ** 3)
            }

        except Exception as e:
            logger.error(f"Erreur récupération stats système: {e}")
            return {}

    def get_slow_queries(self, limit: int = 10) -> List[Dict]:
        """
        Obtenir requêtes les plus lentes.

        Args:
            limit: Nombre max de résultats

        Returns:
            Liste des requêtes lentes
        """
        with self._lock:
            # Trier par durée décroissante
            sorted_queries = sorted(
                self.slow_queries,
                key=lambda x: x['duration'],
                reverse=True
            )
            return list(sorted_queries)[:limit]

    def get_slow_functions(self, limit: int = 10) -> List[Dict]:
        """
        Obtenir fonctions les plus lentes.

        Args:
            limit: Nombre max de résultats

        Returns:
            Liste des fonctions lentes
        """
        with self._lock:
            sorted_functions = sorted(
                self.slow_functions,
                key=lambda x: x['duration'],
                reverse=True
            )
            return list(sorted_functions)[:limit]

    def reset_stats(self):
        """Réinitialiser toutes les statistiques"""
        with self._lock:
            self.query_times.clear()
            self.function_times.clear()
            self.slow_queries.clear()
            self.slow_functions.clear()
            self.request_counts.clear()

        logger.info("📊 Statistiques performance réinitialisées")


# Instance globale
performance_monitor = PerformanceMonitor()


def timed_function(func: Callable) -> Callable:
    """
    Décorateur pour mesurer temps d'exécution d'une fonction.

    Usage:
        @timed_function
        def my_function():
            # code
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()

        try:
            result = func(*args, **kwargs)
            return result

        finally:
            duration = time.time() - start_time
            performance_monitor.record_function_call(func.__name__, duration)

    return wrapper


def timed_query(query: str, params: tuple = None):
    """
    Décorateur pour mesurer temps d'exécution d'une requête DB.

    Usage:
        with timed_query("SELECT * FROM projects"):
            # exécuter requête
    """
    class TimedQueryContext:
        def __init__(self, query: str, params: tuple = None):
            self.query = query
            self.params = params
            self.start_time = None

        def __enter__(self):
            self.start_time = time.time()
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            duration = time.time() - self.start_time
            performance_monitor.record_query(self.query, duration, self.params)

    return TimedQueryContext(query, params)


def show_performance_dashboard():
    """
    Afficher dashboard performance dans Streamlit.
    """
    st.markdown("## 📊 Performance Dashboard")

    # NOUVEAU: Monitoring utilisateurs actifs
    st.markdown("### 👥 Utilisateurs Actifs")

    # Compter les connexions PostgreSQL actives
    try:
        if 'erp_db' in st.session_state:
            db = st.session_state.erp_db
            if db.db_type == 'postgresql':
                active_connections = db.execute_query("""
                    SELECT count(*) as count
                    FROM pg_stat_activity
                    WHERE datname = current_database()
                    AND state = 'active'
                    AND pid <> pg_backend_pid()
                """)
                conn_count = active_connections[0]['count'] if active_connections else 0
            else:
                conn_count = 0
        else:
            conn_count = 0

        col_a, col_b, col_c, col_d = st.columns(4)

        with col_a:
            # Indicateur de charge
            if conn_count < 10:
                status = "🟢 Normal"
                color = "normal"
            elif conn_count < 15:
                status = "🟡 Moyen"
                color = "inverse"
            else:
                status = "🔴 Élevé"
                color = "inverse"

            st.metric(
                "Connexions DB actives",
                conn_count,
                delta=status,
                delta_color=color,
                help="Nombre de connexions PostgreSQL actives (≈ utilisateurs simultanés)"
            )

        with col_b:
            # Capacité recommandée
            capacity = "15-20 users"
            st.metric(
                "Capacité recommandée",
                capacity,
                help="Nombre max d'utilisateurs simultanés recommandé"
            )

        with col_c:
            # Pourcentage d'utilisation
            usage_percent = (conn_count / 20) * 100 if conn_count > 0 else 0
            st.metric(
                "Utilisation",
                f"{usage_percent:.0f}%",
                help="Pourcentage de la capacité utilisée"
            )

        with col_d:
            # Bouton refresh
            if st.button("🔄 Rafraîchir", key="refresh_perf"):
                st.rerun()

    except Exception as e:
        st.warning(f"⚠️ Impossible de récupérer les connexions actives: {e}")

    st.markdown("---")

    # Statistiques système
    st.markdown("### 💻 Système")
    system_stats = performance_monitor.get_system_stats()

    if system_stats:
        col1, col2, col3 = st.columns(3)

        with col1:
            cpu_color = "🔴" if system_stats.get('cpu_warning') else "🟢"
            st.metric(
                "CPU",
                f"{system_stats['cpu_percent']:.1f}%",
                delta=None,
                delta_color="inverse"
            )
            st.caption(f"{cpu_color} Utilisation processeur")

        with col2:
            mem_color = "🔴" if system_stats.get('memory_warning') else "🟢"
            st.metric(
                "Mémoire",
                f"{system_stats['memory_percent']:.1f}%",
                delta=None,
                delta_color="inverse"
            )
            st.caption(
                f"{mem_color} {system_stats['memory_used_gb']:.1f} GB / "
                f"{system_stats['memory_total_gb']:.1f} GB"
            )

        with col3:
            st.metric(
                "Disque",
                f"{system_stats['disk_percent']:.1f}%",
                delta=None
            )
            st.caption(
                f"{system_stats['disk_used_gb']:.1f} GB / "
                f"{system_stats['disk_total_gb']:.1f} GB"
            )

    st.markdown("---")

    # Statistiques requêtes DB
    st.markdown("### 🗄️ Base de Données")
    query_stats = performance_monitor.get_query_stats()

    if query_stats['total_queries'] > 0:
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("Total Requêtes", query_stats['total_queries'])

        with col2:
            st.metric(
                "Temps Moyen",
                f"{query_stats['avg_duration']*1000:.0f} ms"
            )

        with col3:
            st.metric(
                "Temps Max",
                f"{query_stats['max_duration']*1000:.0f} ms"
            )

        with col4:
            st.metric(
                "Requêtes Lentes",
                query_stats['slow_queries'],
                delta=None,
                delta_color="inverse"
            )

        # Requêtes lentes
        slow_queries = performance_monitor.get_slow_queries(limit=5)
        if slow_queries:
            st.markdown("#### 🐌 Requêtes les plus lentes")
            for i, sq in enumerate(slow_queries, 1):
                with st.expander(
                    f"{i}. {sq['duration']:.2f}s - "
                    f"{sq['timestamp'].strftime('%H:%M:%S')}"
                ):
                    st.code(sq['query'], language='sql')
                    if sq['params']:
                        st.caption(f"Paramètres: {sq['params']}")

    else:
        st.info("Aucune requête enregistrée")

    st.markdown("---")

    # Statistiques fonctions
    st.markdown("### ⚡ Fonctions")
    function_stats = performance_monitor.get_function_stats()

    if function_stats:
        # Trier par durée moyenne décroissante
        sorted_funcs = sorted(
            function_stats.items(),
            key=lambda x: x[1]['avg_duration'],
            reverse=True
        )[:10]

        for func_name, stats in sorted_funcs:
            with st.expander(
                f"{func_name} - "
                f"{stats['avg_duration']*1000:.0f} ms avg "
                f"({stats['total_calls']} appels)"
            ):
                col1, col2, col3 = st.columns(3)

                with col1:
                    st.metric("Appels totaux", stats['total_calls'])

                with col2:
                    st.metric("Temps moyen", f"{stats['avg_duration']*1000:.0f} ms")

                with col3:
                    st.metric("Temps max", f"{stats['max_duration']*1000:.0f} ms")

        # Fonctions lentes
        slow_functions = performance_monitor.get_slow_functions(limit=5)
        if slow_functions:
            st.markdown("#### 🐌 Appels les plus lents")
            for i, sf in enumerate(slow_functions, 1):
                st.warning(
                    f"{i}. **{sf['function']}** - {sf['duration']:.2f}s - "
                    f"{sf['timestamp'].strftime('%H:%M:%S')}"
                )

    else:
        st.info("Aucune fonction instrumentée")

    st.markdown("---")

    # Actions
    col1, col2 = st.columns(2)

    with col1:
        if st.button("🔄 Rafraîchir", width="stretch"):
            st.rerun()

    with col2:
        if st.button("🗑️ Réinitialiser Stats", width="stretch"):
            performance_monitor.reset_stats()
            st.success("Statistiques réinitialisées!")
            st.rerun()


def show_performance_summary():
    """
    Afficher résumé compact de performance (pour sidebar).
    """
    st.markdown("### ⚡ Performance")

    system_stats = performance_monitor.get_system_stats()
    query_stats = performance_monitor.get_query_stats()

    if system_stats:
        # CPU
        cpu_color = "🔴" if system_stats.get('cpu_warning') else "🟢"
        st.caption(f"{cpu_color} CPU: {system_stats['cpu_percent']:.0f}%")

        # Mémoire
        mem_color = "🔴" if system_stats.get('memory_warning') else "🟢"
        st.caption(f"{mem_color} RAM: {system_stats['memory_percent']:.0f}%")

    if query_stats['total_queries'] > 0:
        # Requêtes DB
        st.caption(
            f"🗄️ Requêtes: {query_stats['total_queries']} "
            f"({query_stats['avg_duration']*1000:.0f} ms avg)"
        )

        # Alertes requêtes lentes
        if query_stats['slow_queries'] > 0:
            st.warning(f"🐌 {query_stats['slow_queries']} requêtes lentes")


if __name__ == "__main__":
    print("=== Tests Performance Monitor ===\n")

    # Test 1: Décorateur timed_function
    print("Test 1: Décorateur fonction")

    @timed_function
    def slow_function():
        time.sleep(0.1)
        return "Done"

    result = slow_function()
    stats = performance_monitor.get_function_stats()

    assert 'slow_function' in stats
    assert stats['slow_function']['total_calls'] == 1
    print("  [OK] Fonction temporisée correctement\n")

    # Test 2: Context manager requête
    print("Test 2: Context manager requête")

    with timed_query("SELECT * FROM test", params=(1, 2)):
        time.sleep(0.05)

    query_stats = performance_monitor.get_query_stats()
    assert query_stats['total_queries'] == 1
    print("  [OK] Requête temporisée correctement\n")

    # Test 3: Statistiques système
    print("Test 3: Statistiques système")

    system_stats = performance_monitor.get_system_stats()
    assert 'cpu_percent' in system_stats
    assert 'memory_percent' in system_stats
    print(f"  CPU: {system_stats['cpu_percent']:.1f}%")
    print(f"  RAM: {system_stats['memory_percent']:.1f}%")
    print("  [OK] Stats système récupérées\n")

    # Test 4: Détection requêtes lentes
    print("Test 4: Détection requêtes lentes")

    with timed_query("SELECT * FROM slow_table"):
        time.sleep(1.5)  # Simuler requête lente

    slow_queries = performance_monitor.get_slow_queries()
    assert len(slow_queries) == 1
    assert slow_queries[0]['duration'] > 1.0
    print("  [OK] Requête lente détectée\n")

    print("[OK] Tous les tests passés!")
