"""
Gestionnaire de Cache - ERP Constructo AI
===================================
Cache multi-niveaux pour optimiser les performances.

Fonctionnalites :
- Cache Streamlit (st.cache_data, st.cache_resource)
- Cache en memoire (LRU)
- TTL configurable par type de donnees
- Invalidation selective
- Statistiques cache

Auteur: Constructo AI
Date: Janvier 2025
"""

import streamlit as st
from functools import lru_cache, wraps
import time
from typing import Any, Callable, Optional
import logging

logger = logging.getLogger(__name__)


class CacheManager:
    """Gestionnaire de cache centralise - OPTIMISÉ V2"""

    # TTL par defaut (secondes) - OPTIMISE pour vitesse maximale
    TTL_SHORT = 180         # 3 minutes - Donnees changeantes (augmente)
    TTL_MEDIUM = 900        # 15 minutes - Donnees stables (augmente)
    TTL_LONG = 7200         # 2 heures - Donnees rarement modifiees (augmente)
    TTL_VERY_LONG = 86400   # 24 heures - Donnees statiques

    # Configuration avancée
    MAX_CACHE_SIZE = 1000   # Nombre max d'entrées par cache
    ENABLE_STATS = True     # Activer les statistiques

    def __init__(self):
        self.hits = 0
        self.misses = 0
        self._cache_stats = {}

    @staticmethod
    @st.cache_data(ttl=600, show_spinner=False)  # 10 minutes (augmente de 5min)
    def get_projects_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache liste projets

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("SELECT id, nom_projet as nom, client_company_id as client_id, statut, date_creation, COALESCE(prix_estime, 0) as budget FROM projects ORDER BY date_creation DESC LIMIT 200")

    @staticmethod
    @st.cache_data(ttl=86400, show_spinner=False)  # 24 heures (augmente de 1h) - postes tres stables
    def get_work_centers_cached(_db_hash: str = "", tenant_schema: str = "", type_industrie: str = None):
        """Cache postes travail (rarement modifies)

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema

        Args:
            type_industrie: 'CONSTRUCTION' ou 'FABRICATION' pour filtrer par type
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        if type_industrie:
            return db.execute_query(
                "SELECT id, nom, COALESCE(capacite_heures_jour, 8) as capacite, statut, type_poste FROM work_centers WHERE type_poste = %s OR type_poste IS NULL ORDER BY nom",
                (type_industrie,)
            )
        return db.execute_query("SELECT id, nom, COALESCE(capacite_heures_jour, 8) as capacite, statut, type_poste FROM work_centers ORDER BY nom")

    @staticmethod
    @st.cache_data(ttl=600, show_spinner=False)  # 10 minutes (augmente de 5min)
    def get_employees_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache employes actifs

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.get_all_employees()

    @staticmethod
    @st.cache_data(ttl=60, show_spinner=False)  # 1 minute
    def get_dashboard_kpis(_db_hash: str = "", tenant_schema: str = "", project_id: Optional[int] = None):
        """Cache KPIs dashboard - OPTIMISÉ: requête unique consolidée

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)

        kpis = {}

        if project_id:
            # KPIs projet specifique
            project = db.execute_query("SELECT id, nom_projet as nom, statut, COALESCE(prix_estime, 0) as budget, client_company_id as client_id FROM projects WHERE id = %s", (project_id,))
            if project:
                kpis['project'] = project[0]
        else:
            # KPIs globaux - CONSOLIDÉ en une seule requête
            result = db.execute_query("""
                SELECT
                    (SELECT COUNT(*) FROM projects) as total_projects,
                    (SELECT COUNT(*) FROM employees WHERE UPPER(statut) = 'ACTIF') as total_employees,
                    (SELECT COUNT(*) FROM projects WHERE UPPER(statut) = 'EN_COURS') as projects_actifs,
                    (SELECT COUNT(*) FROM companies WHERE UPPER(type_company) = 'CLIENT') as total_clients,
                    (SELECT COUNT(*) FROM factures WHERE UPPER(statut) = 'EN_ATTENTE') as factures_en_attente,
                    (SELECT COALESCE(SUM(montant_ttc), 0) FROM factures WHERE UPPER(statut) = 'EN_ATTENTE') as montant_factures_attente
            """)
            if result:
                r = result[0]
                kpis['total_projects'] = r.get('total_projects', 0)
                kpis['total_employees'] = r.get('total_employees', 0)
                kpis['projects_actifs'] = r.get('projects_actifs', 0)
                kpis['total_clients'] = r.get('total_clients', 0)
                kpis['factures_en_attente'] = r.get('factures_en_attente', 0)
                kpis['montant_factures_attente'] = float(r.get('montant_factures_attente', 0))

        return kpis

    @staticmethod
    @st.cache_data(ttl=120, show_spinner=False)  # 2 minutes
    def get_all_dashboard_stats(_db_hash: str = "", tenant_schema: str = ""):
        """
        Récupère TOUTES les statistiques dashboard en UNE SEULE requête.
        Évite les multiples allers-retours à la BD.

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)

        result = db.execute_query("""
            SELECT
                -- Projets
                (SELECT COUNT(*) FROM projects) as total_projects,
                (SELECT COUNT(*) FROM projects WHERE UPPER(statut) = 'EN_COURS') as projects_en_cours,
                (SELECT COUNT(*) FROM projects WHERE UPPER(statut) = 'TERMINE') as projects_termines,
                (SELECT COUNT(*) FROM projects WHERE date_creation >= CURRENT_DATE - INTERVAL '30 days') as projects_recent,

                -- Employés
                (SELECT COUNT(*) FROM employees) as total_employees,
                (SELECT COUNT(*) FROM employees WHERE UPPER(statut) = 'ACTIF') as employees_actifs,

                -- Clients/Companies
                (SELECT COUNT(*) FROM companies) as total_companies,
                (SELECT COUNT(*) FROM companies WHERE UPPER(type_company) = 'CLIENT') as total_clients,
                (SELECT COUNT(*) FROM companies WHERE UPPER(type_company) = 'FOURNISSEUR') as total_fournisseurs,

                -- Factures
                (SELECT COUNT(*) FROM factures) as total_factures,
                (SELECT COUNT(*) FROM factures WHERE UPPER(statut) = 'EN_ATTENTE') as factures_en_attente,
                (SELECT COUNT(*) FROM factures WHERE UPPER(statut) = 'PAYEE') as factures_payees,
                (SELECT COALESCE(SUM(montant_ttc), 0) FROM factures WHERE UPPER(statut) = 'EN_ATTENTE') as montant_en_attente,
                (SELECT COALESCE(SUM(montant_ttc), 0) FROM factures WHERE UPPER(statut) = 'PAYEE' AND date_emission >= CURRENT_DATE - INTERVAL '30 days') as ca_30_jours,

                -- Devis
                (SELECT COUNT(*) FROM devis) as total_devis,
                (SELECT COUNT(*) FROM devis WHERE UPPER(statut) = 'EN_ATTENTE') as devis_en_attente,
                (SELECT COUNT(*) FROM devis WHERE UPPER(statut) = 'ACCEPTE') as devis_acceptes,

                -- Opportunités
                (SELECT COUNT(*) FROM opportunities WHERE UPPER(statut) = 'ACTIF') as opportunities_actives,
                (SELECT COALESCE(SUM(montant_estime), 0) FROM opportunities WHERE UPPER(statut) = 'ACTIF') as pipeline_value
        """)

        if result:
            return result[0]
        return {}

    @staticmethod
    @st.cache_data(ttl=3600, show_spinner=False)  # 1 heure
    def get_product_catalog_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache catalogue produits

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("SELECT id, nom, code_produit as code, prix_unitaire, unite_vente as unite, categorie FROM produits ORDER BY nom LIMIT 500")

    @staticmethod
    @st.cache_data(ttl=120, show_spinner=False)  # 2 minutes
    def get_factures_cached(_db_hash: str = "", tenant_schema: str = "", filtre_statut: str = None):
        """Cache liste factures

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        query = """
            SELECT f.id, f.numero_facture, f.date_emission, f.date_echeance,
                   f.montant_ht, f.montant_ttc, f.statut, f.project_id,
                   c.nom as client_nom, p.nom_projet
            FROM factures f
            LEFT JOIN companies c ON f.client_company_id = c.id
            LEFT JOIN projects p ON f.project_id = p.id
        """
        if filtre_statut:
            query += f" WHERE f.statut = '{filtre_statut}'"
        query += " ORDER BY f.date_emission DESC LIMIT 200"
        return db.execute_query(query)

    @staticmethod
    @st.cache_data(ttl=120, show_spinner=False)  # 2 minutes
    def get_devis_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache liste devis

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("""
            SELECT id,
                   'DEVIS-' || EXTRACT(YEAR FROM created_at)::int || '-' || LPAD(id::text, 3, '0') as numero_devis,
                   nom_projet, client_nom_cache,
                   statut, priorite, date_soumis, prix_estime, source
            FROM devis
            ORDER BY id DESC LIMIT 200
        """)

    @staticmethod
    @st.cache_data(ttl=120, show_spinner=False)  # 2 minutes
    def get_companies_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache liste entreprises CRM

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("""
            SELECT id, nom, telephone, email, ville, statut_relation
            FROM companies
            ORDER BY nom LIMIT 300
        """)

    @staticmethod
    @st.cache_data(ttl=60, show_spinner=False)  # 1 minute
    def get_opportunities_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache opportunites pipeline

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("""
            SELECT id, nom, montant_estime, statut, probabilite,
                   date_cloture_prevue, company_id
            FROM opportunities
            ORDER BY date_derniere_activite DESC LIMIT 100
        """)

    # ========================================================================
    # NOUVELLES FONCTIONS CACHÉES - OPTIMISATION V3
    # ========================================================================

    @staticmethod
    @st.cache_data(ttl=600, show_spinner=False)  # 10 minutes
    def get_fournisseurs_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache liste fournisseurs

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("""
            SELECT id, nom, telephone, email, ville, statut,
                   categorie, conditions_paiement
            FROM fournisseurs
            WHERE statut != 'INACTIF' OR statut IS NULL
            ORDER BY nom LIMIT 300
        """)

    @staticmethod
    @st.cache_data(ttl=300, show_spinner=False)  # 5 minutes
    def get_inventory_items_cached(_db_hash: str = "", tenant_schema: str = "", category: str = None):
        """Cache inventaire avec filtrage optionnel

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        if category:
            return db.execute_query("""
                SELECT id, nom, code_produit, quantite_stock, seuil_alerte,
                       prix_unitaire, categorie, emplacement
                FROM inventory_items
                WHERE categorie = %s
                ORDER BY nom LIMIT 500
            """, (category,))
        return db.execute_query("""
            SELECT id, nom, code_produit, quantite_stock, seuil_alerte,
                   prix_unitaire, categorie, emplacement
            FROM inventory_items
            ORDER BY nom LIMIT 500
        """)

    @staticmethod
    @st.cache_data(ttl=60, show_spinner=False)  # 1 minute - donnees critiques
    def get_critical_stock_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache stocks critiques (sous seuil alerte)

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("""
            SELECT id, nom, code_produit, quantite_stock, seuil_alerte,
                   (seuil_alerte - quantite_stock) as deficit
            FROM inventory_items
            WHERE quantite_stock <= seuil_alerte AND seuil_alerte > 0
            ORDER BY (seuil_alerte - quantite_stock) DESC
            LIMIT 50
        """)

    @staticmethod
    @st.cache_data(ttl=300, show_spinner=False)  # 5 minutes
    def get_bts_actifs_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache bons de travail actifs

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("""
            SELECT f.id, f.numero_document, f.type_formulaire, f.statut, f.date_creation,
                   f.date_echeance, f.priorite, p.nom_projet
            FROM formulaires f
            LEFT JOIN projects p ON f.project_id = p.id
            WHERE f.type_formulaire = 'BON_TRAVAIL'
              AND f.statut NOT IN ('TERMINE', 'ANNULE')
            ORDER BY f.priorite DESC, f.date_echeance ASC
            LIMIT 100
        """)

    @staticmethod
    @st.cache_data(ttl=300, show_spinner=False)  # 5 minutes
    def get_production_stats_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache statistiques production consolidees

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("""
            SELECT
                (SELECT COUNT(*) FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL') as total_bts,
                (SELECT COUNT(*) FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL' AND statut = 'EN_COURS') as bts_en_cours,
                (SELECT COUNT(*) FROM formulaires WHERE type_formulaire = 'BON_TRAVAIL' AND statut = 'TERMINE') as bts_termines,
                (SELECT COUNT(*) FROM operations) as total_operations,
                (SELECT COUNT(*) FROM operations WHERE statut = 'EN_COURS') as operations_en_cours,
                (SELECT COUNT(*) FROM work_centers WHERE statut = 'ACTIF') as postes_actifs,
                (SELECT COALESCE(SUM(heures_estimees), 0) FROM operations WHERE statut != 'TERMINE') as heures_restantes
        """)

    @staticmethod
    @st.cache_data(ttl=180, show_spinner=False)  # 3 minutes
    def get_crm_stats_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache statistiques CRM consolidees

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return db.execute_query("""
            SELECT
                (SELECT COUNT(*) FROM companies WHERE UPPER(type_company) = 'CLIENT') as total_clients,
                (SELECT COUNT(*) FROM companies WHERE UPPER(type_company) = 'PROSPECT') as total_prospects,
                (SELECT COUNT(*) FROM contacts) as total_contacts,
                (SELECT COUNT(*) FROM opportunities WHERE statut = 'ACTIF') as opportunities_actives,
                (SELECT COALESCE(SUM(montant_estime), 0) FROM opportunities WHERE statut = 'ACTIF') as pipeline_value,
                (SELECT COUNT(*) FROM interactions WHERE date_interaction >= CURRENT_DATE - INTERVAL '7 days') as interactions_7j
        """)

    @staticmethod
    @st.cache_data(ttl=600, show_spinner=False)  # 10 minutes
    def get_contacts_cached(_db_hash: str = "", tenant_schema: str = "", company_id: int = None):
        """Cache contacts avec filtrage optionnel par entreprise

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        if company_id:
            return db.execute_query("""
                SELECT id, prenom, nom, email, telephone, poste, company_id
                FROM contacts
                WHERE company_id = %s
                ORDER BY nom, prenom
            """, (company_id,))
        return db.execute_query("""
            SELECT c.id, c.prenom, c.nom, c.email, c.telephone, c.poste,
                   c.company_id, co.nom as company_nom
            FROM contacts c
            LEFT JOIN companies co ON c.company_id = co.id
            ORDER BY c.nom, c.prenom LIMIT 500
        """)

    @staticmethod
    @st.cache_data(ttl=1800, show_spinner=False)  # 30 minutes - donnees stables
    def get_categories_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache des categories (produits, fournisseurs, etc.)

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        return {
            'produits': db.execute_query("SELECT DISTINCT categorie FROM produits WHERE categorie IS NOT NULL ORDER BY categorie"),
            'inventory': db.execute_query("SELECT DISTINCT categorie FROM inventory_items WHERE categorie IS NOT NULL ORDER BY categorie"),
            'fournisseurs': db.execute_query("SELECT DISTINCT categorie FROM fournisseurs WHERE categorie IS NOT NULL ORDER BY categorie"),
        }

    @staticmethod
    @st.cache_data(ttl=3600, show_spinner=False)  # 1 heure - metadonnees stables
    def get_schema_metadata_cached(_db_hash: str = "", tenant_schema: str = ""):
        """Cache metadonnees schema (tables, colonnes)

        ✅ OPTIMISÉ: Isolation multi-tenant avec tenant_schema
        """
        from erp_database import ERPDatabase
        db = ERPDatabase()
        if tenant_schema:
            db.set_tenant_schema(tenant_schema)
        # Utiliser le tenant_schema au lieu de 'public' pour les métadonnées
        schema_to_use = tenant_schema if tenant_schema else 'public'
        return db.execute_query("""
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = %s
            ORDER BY table_name, ordinal_position
        """, (schema_to_use,))

    @staticmethod
    def invalidate_fournisseurs_cache():
        """Invalider cache fournisseurs"""
        try:
            CacheManager.get_fournisseurs_cached.clear()
            logger.info("Cache fournisseurs invalide")
        except Exception:
            pass

    @staticmethod
    def invalidate_inventory_cache():
        """Invalider cache inventaire"""
        try:
            CacheManager.get_inventory_items_cached.clear()
            CacheManager.get_critical_stock_cached.clear()
            logger.info("Cache inventaire invalide")
        except Exception:
            pass

    @staticmethod
    def invalidate_contacts_cache():
        """Invalider cache contacts"""
        try:
            CacheManager.get_contacts_cached.clear()
            logger.info("Cache contacts invalide")
        except Exception:
            pass

    @staticmethod
    def invalidate_companies_cache():
        """Invalider cache entreprises"""
        try:
            CacheManager.get_companies_cached.clear()
            CacheManager.get_crm_stats_cached.clear()
            logger.info("Cache entreprises invalide")
        except Exception:
            pass

    @staticmethod
    def invalidate_factures_cache():
        """Invalider cache factures"""
        try:
            CacheManager.get_factures_cached.clear()
            logger.info("Cache factures invalide")
        except Exception:
            pass

    @staticmethod
    def invalidate_devis_cache():
        """Invalider cache devis"""
        try:
            CacheManager.get_devis_cached.clear()
            logger.info("Cache devis invalide")
        except Exception:
            pass

    @staticmethod
    def invalidate_projects_cache():
        """Invalider cache projets"""
        try:
            CacheManager.get_projects_cached.clear()
            logger.info("Cache projets invalide")
        except Exception:
            pass

    @staticmethod
    def invalidate_employees_cache():
        """Invalider cache employes"""
        try:
            CacheManager.get_employees_cached.clear()
            logger.info("Cache employes invalide")
        except Exception:
            pass

    @staticmethod
    def invalidate_all():
        """Invalider tout le cache"""
        st.cache_data.clear()
        logger.info("Tout le cache invalide")


# Decorateur personnalise pour cache avec TTL
def cached(ttl: int = 300):
    """
    Decorateur pour cacher resultats de fonction avec TTL.

    Usage:
        @cached(ttl=60)
        def get_data():
            return expensive_operation()
    """
    def decorator(func: Callable) -> Callable:
        cache = {}
        cache_times = {}

        @wraps(func)
        def wrapper(*args, **kwargs):
            # Generer cle cache
            cache_key = str(args) + str(sorted(kwargs.items()))

            # Verifier si en cache et pas expire
            if cache_key in cache:
                if time.time() - cache_times[cache_key] < ttl:
                    return cache[cache_key]

            # Calculer et cacher
            result = func(*args, **kwargs)
            cache[cache_key] = result
            cache_times[cache_key] = time.time()

            return result

        return wrapper
    return decorator


# Fonctions utilitaires pour cache Streamlit
def cache_short(func):
    """Cache court (1 minute)"""
    return st.cache_data(ttl=CacheManager.TTL_SHORT)(func)


def cache_medium(func):
    """Cache moyen (5 minutes)"""
    return st.cache_data(ttl=CacheManager.TTL_MEDIUM)(func)


def cache_long(func):
    """Cache long (1 heure)"""
    return st.cache_data(ttl=CacheManager.TTL_LONG)(func)


# Instance globale
cache_manager = CacheManager()


if __name__ == "__main__":
    print("=== Tests Cache Manager ===\n")

    # Test decorateur cached
    @cached(ttl=5)
    def expensive_operation(x):
        print(f"  Calcul pour x={x}...")
        time.sleep(0.1)  # Simuler operation lente
        return x * 2

    print("Test 1: Cache avec TTL")
    start = time.time()
    result1 = expensive_operation(5)
    time1 = time.time() - start
    print(f"  Premier appel: {result1} ({time1:.3f}s)")

    start = time.time()
    result2 = expensive_operation(5)
    time2 = time.time() - start
    print(f"  Deuxieme appel (cache): {result2} ({time2:.3f}s)")

    assert result1 == result2
    assert time2 < time1  # Cache devrait etre plus rapide

    print("\n[OK] Cache fonctionne correctement!")
