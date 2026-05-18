"""
ERP React - Analytics Router
Dashboard analytics: KPIs, charts data, project profitability, HR metrics.
Based on dashboard_analytics.py (4,381 lines).
"""

import logging
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["Analytics"])


# Memoization: skip defensive ALTERs once we've run them for a given tenant
# schema. Only populated after ALL ALTERs succeed so a partial failure doesn't
# mask missing columns on subsequent calls.
_departement_cols_ensured: set[str] = set()


def _ensure_departement_columns(cursor, schema: str) -> None:
    """Older tenant schemas may miss `departement` on employees and formulaires.
    Add the column defensively so analytics endpoints don't crash with
    `column "departement" does not exist`."""
    if schema in _departement_cols_ensured:
        return
    all_ok = True
    for table in ("employees", "formulaires"):
        try:
            cursor.execute(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS departement TEXT"
            )
        except Exception as exc:
            logger.warning("defensive ALTER %s.departement failed: %s", table, exc)
            all_ok = False
    if all_ok:
        _departement_cols_ensured.add(schema)


def _fill_months(data: dict, period_days: int = 365, default: dict = None) -> list:
    """Fill missing months with zeros so charts show a continuous timeline."""
    if default is None:
        default = {}
    today = date.today()
    start = today.replace(day=1) - timedelta(days=period_days)
    start = start.replace(day=1)  # first of that month
    result = []
    cursor = start
    while cursor <= today:
        key = cursor.strftime("%Y-%m")
        row = {"mois": key}
        row.update(default)
        if key in data:
            row.update(data[key])
        result.append(row)
        # next month
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)
    return result


@router.get("/kpis")
async def get_global_kpis(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(30, ge=1, le=365),
):
    """Get global KPI metrics for the analytics dashboard."""
    if not user.schema:
        return {"error": "Contexte tenant manquant"}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        kpis = {}

        # Revenue — from INVOICES (not project budgets) within period
        cursor.execute(
            "SELECT COALESCE(SUM(montant_total), 0) as total "
            "FROM factures "
            "WHERE UPPER(statut) NOT IN ('ANNULEE', 'ANNULE') "
            "AND date_facture >= CURRENT_DATE - make_interval(days => %s)",
            (period_days,),
        )
        kpis["revenus_total"] = float(cursor.fetchone()["total"])

        # Active projects — case-insensitive status matching
        cursor.execute(
            "SELECT "
            "COUNT(CASE WHEN UPPER(statut) IN ('EN COURS', 'EN_COURS', 'EN ATTENTE', 'EN_ATTENTE') THEN 1 END) as actifs, "
            "COUNT(CASE WHEN UPPER(statut) IN ('TERMINE', 'TERMINÉ', 'COMPLETED') THEN 1 END) as termines, "
            "COUNT(*) as total "
            "FROM projects"
        )
        row = cursor.fetchone()
        kpis["projets_actifs"] = row["actifs"]
        kpis["projets_termines"] = row["termines"]
        kpis["projets_total"] = row["total"]

        # Active employees — case-insensitive
        cursor.execute("SELECT COUNT(*) as total FROM employees WHERE UPPER(statut) = 'ACTIF'")
        kpis["employes_actifs"] = cursor.fetchone()["total"]

        # Stock alerts
        cursor.execute(
            "SELECT COUNT(*) as total FROM produits "
            "WHERE active = TRUE AND stock_disponible <= stock_minimum AND stock_minimum > 0"
        )
        kpis["alertes_stock"] = cursor.fetchone()["total"]

        # Opportunities pipeline — include PROSPECTION too
        cursor.execute(
            "SELECT COUNT(*) as total, COALESCE(SUM(montant_estime), 0) as valeur "
            "FROM opportunities "
            "WHERE UPPER(statut) IN ('PROSPECTION', 'QUALIFICATION', 'PROPOSITION', 'NEGOCIATION')"
        )
        opp = cursor.fetchone()
        kpis["opportunites_pipeline"] = opp["total"]
        kpis["valeur_pipeline"] = float(opp["valeur"])

        # Devis stats — case-insensitive status matching
        cursor.execute(
            "SELECT COUNT(*) as total, "
            "COUNT(CASE WHEN UPPER(statut) IN ('ACCEPTE', 'ACCEPTÉE', 'ACCEPTED') THEN 1 END) as acceptes, "
            "COUNT(CASE WHEN UPPER(statut) IN ('ENVOYE', 'ENVOYÉ', 'ENVOYEE', 'SENT') THEN 1 END) as envoyes, "
            "COALESCE(SUM(CAST(investissement_total AS REAL)), 0) as valeur_totale "
            "FROM devis WHERE date_creation >= CURRENT_DATE - make_interval(days => %s)",
            (period_days,),
        )
        devis = cursor.fetchone()
        kpis["devis_total"] = devis["total"]
        kpis["devis_acceptes"] = devis["acceptes"]
        kpis["devis_envoyes"] = devis["envoyes"]
        kpis["devis_valeur_totale"] = float(devis["valeur_totale"])

        # Invoices — case-insensitive
        cursor.execute(
            "SELECT COUNT(*) as total, "
            "COALESCE(SUM(CASE WHEN UPPER(statut) NOT IN ('PAYEE', 'PAYÉE', 'ANNULEE', 'ANNULÉE') THEN COALESCE(solde_du, 0) ELSE 0 END), 0) as solde_du, "
            "COALESCE(SUM(CASE WHEN UPPER(statut) IN ('PAYEE', 'PAYÉE') THEN montant_total ELSE 0 END), 0) as revenus_encaisses "
            "FROM factures"
        )
        inv = cursor.fetchone()
        kpis["factures_total"] = inv["total"]
        kpis["factures_solde_du"] = float(inv["solde_du"])
        kpis["revenus_encaisses"] = float(inv["revenus_encaisses"])

        return kpis
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_global_kpis error: %s", exc)
        return {
            "revenus_total": 0, "projets_actifs": 0, "projets_termines": 0,
            "projets_total": 0, "employes_actifs": 0, "alertes_stock": 0,
            "opportunites_pipeline": 0, "valeur_pipeline": 0,
            "devis_total": 0, "devis_acceptes": 0, "devis_envoyes": 0,
            "devis_valeur_totale": 0, "factures_total": 0,
            "factures_solde_du": 0, "revenus_encaisses": 0,
        }
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/projects/profitability")
async def get_project_profitability(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(90, ge=1, le=730),
    limit: int = Query(20, ge=1, le=50),
):
    """Get project profitability data (budget vs actual costs)."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # `projects.id` is integer but `time_entries.project_id` and
        # `materials.project_id` may be INTEGER or TEXT depending on tenant.
        # Cast both sides to text to avoid `integer = text` operator crash.
        cursor.execute(
            "SELECT p.id, p.nom_projet, p.statut, "
            "COALESCE(CAST(p.budget_total AS REAL), 0) as budget, "
            "COALESCE((SELECT SUM(te.total_hours * COALESCE(e2.taux_horaire, e2.salaire, 0)) "
            "  FROM time_entries te LEFT JOIN employees e2 ON te.employee_id = e2.id "
            "  WHERE te.project_id::text = p.id::text), 0) as cout_main_oeuvre, "
            "COALESCE((SELECT SUM(m.quantite * m.prix_unitaire) "
            "  FROM materials m WHERE m.project_id::text = p.id::text), 0) as cout_materiaux "
            "FROM projects p "
            "WHERE p.created_at >= CURRENT_DATE - make_interval(days => %s) "
            "AND COALESCE(CAST(p.budget_total AS REAL), 0) > 0 "
            "ORDER BY CAST(p.budget_total AS REAL) DESC LIMIT %s",
            (period_days, limit),
        )
        items = []
        for row in cursor.fetchall():
            budget = float(row["budget"])
            cout_mo = float(row["cout_main_oeuvre"])
            cout_mat = float(row["cout_materiaux"])
            cout_total = cout_mo + cout_mat
            marge = budget - cout_total
            marge_pct = (marge / budget * 100) if budget > 0 else 0
            items.append({
                "id": row["id"],
                "nom_projet": row["nom_projet"],
                "statut": row["statut"],
                "budget": budget,
                "cout_main_oeuvre": cout_mo,
                "cout_materiaux": cout_mat,
                "cout_total": cout_total,
                "marge": marge,
                "marge_pct": round(marge_pct, 1),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_project_profitability error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/projects/evolution")
async def get_project_evolution(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(365, ge=30, le=730),
):
    """Get monthly project evolution by status."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT TO_CHAR(created_at, 'YYYY-MM') as mois, "
            "COUNT(CASE WHEN UPPER(statut) IN ('EN ATTENTE', 'EN_ATTENTE') THEN 1 END) as en_attente, "
            "COUNT(CASE WHEN UPPER(statut) IN ('EN COURS', 'EN_COURS') THEN 1 END) as en_cours, "
            "COUNT(CASE WHEN UPPER(statut) IN ('TERMINE', 'TERMINÉ', 'COMPLETED') THEN 1 END) as termines, "
            "COUNT(*) as total "
            "FROM projects "
            "WHERE created_at >= CURRENT_DATE - make_interval(days => %s) "
            "GROUP BY mois ORDER BY mois",
            (period_days,),
        )
        raw = {}
        for row in cursor.fetchall():
            raw[row["mois"]] = {"en_attente": row["en_attente"], "en_cours": row["en_cours"], "termines": row["termines"], "total": row["total"]}
        items = _fill_months(raw, period_days, {"en_attente": 0, "en_cours": 0, "termines": 0, "total": 0})

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_project_evolution error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/commercial/pipeline")
async def get_commercial_pipeline(user: ErpUser = Depends(get_current_user)):
    """Get commercial pipeline (opportunity funnel)."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT statut, COUNT(*) as nombre, "
            "COALESCE(SUM(montant_estime), 0) as valeur_totale, "
            "COALESCE(AVG(montant_estime), 0) as valeur_moyenne, "
            "COALESCE(AVG(probabilite), 0) as proba_moyenne "
            "FROM opportunities WHERE statut != 'PERDU' "
            "GROUP BY statut ORDER BY "
            "CASE statut "
            "  WHEN 'PROSPECTION' THEN 1 "
            "  WHEN 'QUALIFICATION' THEN 2 "
            "  WHEN 'PROPOSITION' THEN 3 "
            "  WHEN 'NEGOCIATION' THEN 4 "
            "  WHEN 'GAGNE' THEN 5 "
            "  ELSE 6 END"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "statut": row["statut"],
                "nombre": row["nombre"],
                "valeur_totale": float(row["valeur_totale"]),
                "valeur_moyenne": float(row["valeur_moyenne"]),
                "proba_moyenne": float(row["proba_moyenne"]),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_commercial_pipeline error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/hr/productivity")
async def get_employee_productivity(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(30, ge=1, le=365),
    limit: int = Query(20, ge=1, le=50),
):
    """Get employee productivity metrics."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_departement_columns(cursor, user.schema)

        cursor.execute(
            "SELECT e.id, e.prenom || ' ' || e.nom as employe, "
            "e.poste, COALESCE(e.departement, 'Non assigne') as departement, "
            "COUNT(DISTINCT te.punch_in::DATE) as jours_travailles, "
            "COALESCE(SUM(te.total_hours), 0) as heures_totales, "
            "COALESCE(AVG(te.total_hours), 0) as heures_moyennes, "
            "COUNT(DISTINCT te.project_id) as nb_projets "
            "FROM employees e "
            "JOIN time_entries te ON e.id = te.employee_id "
            "WHERE e.statut = 'ACTIF' "
            "AND te.punch_in >= CURRENT_DATE - make_interval(days => %s) "
            "GROUP BY e.id, e.prenom, e.nom, e.poste, e.departement "
            "HAVING COALESCE(SUM(te.total_hours), 0) > 0 "
            "ORDER BY heures_totales DESC LIMIT %s",
            (period_days, limit),
        )
        items = []
        for row in cursor.fetchall():
            jours = row["jours_travailles"] or 1
            items.append({
                "id": row["id"],
                "employe": row["employe"],
                "poste": row["poste"],
                "departement": row["departement"],
                "jours_travailles": jours,
                "heures_totales": round(float(row["heures_totales"]), 1),
                "heures_moyennes": round(float(row["heures_moyennes"]), 1),
                "heures_par_jour": round(float(row["heures_totales"]) / jours, 1),
                "nb_projets": row["nb_projets"],
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_employee_productivity error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/hr/departments")
async def get_department_distribution(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(30, ge=1, le=365),
):
    """Get time distribution by department."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_departement_columns(cursor, user.schema)

        cursor.execute(
            "SELECT COALESCE(e.departement, 'Non assigne') as departement, "
            "COUNT(DISTINCT e.id) as nb_employes, "
            "COALESCE(SUM(te.total_hours), 0) as heures_totales "
            "FROM time_entries te "
            "LEFT JOIN employees e ON te.employee_id = e.id "
            "WHERE te.punch_in >= CURRENT_DATE - make_interval(days => %s) "
            "GROUP BY e.departement "
            "HAVING COALESCE(SUM(te.total_hours), 0) > 0 "
            "ORDER BY heures_totales DESC",
            (period_days,),
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "departement": row["departement"],
                "nb_employes": row["nb_employes"],
                "heures_totales": round(float(row["heures_totales"]), 1),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_department_distribution error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/finance/revenue-expenses")
async def get_revenue_expenses(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(365, ge=30, le=730),
):
    """Get monthly revenue vs expenses."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Revenue by month (from invoices, not project budgets)
        cursor.execute(
            "SELECT TO_CHAR(date_facture, 'YYYY-MM') as mois, "
            "COALESCE(SUM(montant_total), 0) as revenus "
            "FROM factures "
            "WHERE UPPER(statut) NOT IN ('ANNULEE', 'ANNULÉE', 'ANNULE') "
            "AND date_facture >= CURRENT_DATE - make_interval(days => %s) "
            "GROUP BY mois ORDER BY mois",
            (period_days,),
        )
        revenue_data = {row["mois"]: float(row["revenus"]) for row in cursor.fetchall()}

        # Expenses by month (labor costs)
        cursor.execute(
            "SELECT TO_CHAR(te.punch_in, 'YYYY-MM') as mois, "
            "COALESCE(SUM(te.total_hours * COALESCE(e.taux_horaire, e.salaire, 0)), 0) as depenses "
            "FROM time_entries te "
            "LEFT JOIN employees e ON te.employee_id = e.id "
            "WHERE te.punch_in >= CURRENT_DATE - make_interval(days => %s) "
            "GROUP BY mois ORDER BY mois",
            (period_days,),
        )
        expense_data = {row["mois"]: float(row["depenses"]) for row in cursor.fetchall()}

        # Combine into filled timeline
        combined = {}
        for mois in set(list(revenue_data.keys()) + list(expense_data.keys())):
            rev = revenue_data.get(mois, 0)
            dep = expense_data.get(mois, 0)
            marge = rev - dep
            marge_pct = (marge / rev * 100) if rev > 0 else 0
            combined[mois] = {
                "revenus": round(rev, 2),
                "depenses": round(dep, 2),
                "marge": round(marge, 2),
                "marge_pct": round(marge_pct, 1),
            }
        items = _fill_months(combined, period_days, {"revenus": 0, "depenses": 0, "marge": 0, "marge_pct": 0})

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_revenue_expenses error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/inventory/alerts")
async def get_stock_alerts(user: ErpUser = Depends(get_current_user)):
    """Get low stock alerts."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id, nom, categorie, stock_disponible as stock_actuel, "
            "stock_minimum as seuil_alerte, unite_vente as unite "
            "FROM produits "
            "WHERE active = TRUE AND stock_disponible <= stock_minimum AND stock_minimum > 0 "
            "ORDER BY (stock_disponible / NULLIF(stock_minimum, 0)) ASC "
            "LIMIT 20"
        )
        items = []
        for row in cursor.fetchall():
            stock = float(row["stock_actuel"])
            seuil = float(row["seuil_alerte"])
            items.append({
                "id": row["id"],
                "nom": row["nom"],
                "categorie": row["categorie"],
                "stock_actuel": stock,
                "seuil_alerte": seuil,
                "unite": row["unite"],
                "taux_stock": round((stock / seuil * 100) if seuil > 0 else 0, 1),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_stock_alerts error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/top-clients")
async def get_top_clients(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(365, ge=30, le=730),
    limit: int = Query(15, ge=1, le=50),
):
    """Get top clients by revenue."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT c.id, c.nom as client, c.type_company as type_entreprise, "
            "COUNT(DISTINCT p.id) as nb_projets, "
            "COALESCE(SUM(CAST(p.budget_total AS REAL)), 0) as ca_total, "
            "COALESCE(AVG(CAST(p.budget_total AS REAL)), 0) as ca_moyen, "
            "MAX(p.created_at) as dernier_projet "
            "FROM companies c "
            "JOIN projects p ON c.id = p.client_company_id "
            "WHERE p.created_at >= CURRENT_DATE - make_interval(days => %s) "
            "GROUP BY c.id, c.nom, c.type_company "
            "HAVING COALESCE(SUM(CAST(p.budget_total AS REAL)), 0) > 0 "
            "ORDER BY ca_total DESC LIMIT %s",
            (period_days, limit),
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "id": row["id"],
                "client": row["client"],
                "type_entreprise": row["type_entreprise"],
                "nb_projets": row["nb_projets"],
                "ca_total": round(float(row["ca_total"]), 2),
                "ca_moyen": round(float(row["ca_moyen"]), 2),
                "dernier_projet": str(row["dernier_projet"]) if row["dernier_projet"] else None,
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_top_clients error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/project-profitability")
async def get_project_profitability_v2(user: ErpUser = Depends(get_current_user)):
    """Project profitability: budget vs actual costs."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # `projects.id` is SERIAL (integer) but `time_entries.project_id`
        # and `formulaires.project_id` may be INTEGER or TEXT depending on
        # the tenant schema. Cast BOTH sides to text to dodge the
        # `operator does not exist: integer = text` crash.
        cursor.execute(
            "SELECT p.id, p.nom_projet, p.budget_total, "
            "COALESCE(SUM(te.total_hours * COALESCE(e.taux_horaire, e.salaire, 0)), 0) as cout_main_oeuvre, "
            "COALESCE((SELECT SUM(montant_ligne) FROM formulaire_lignes fl "
            "  JOIN formulaires f ON f.id = fl.formulaire_id "
            "  WHERE f.project_id::text = p.id::text), 0) as cout_materiaux "
            "FROM projects p "
            "LEFT JOIN time_entries te ON te.project_id::text = p.id::text "
            "LEFT JOIN employees e ON te.employee_id = e.id "
            "GROUP BY p.id, p.nom_projet, p.budget_total "
            "LIMIT 20"
        )
        items = []
        for row in cursor.fetchall():
            budget = float(row["budget_total"] or 0)
            cout_mo = float(row["cout_main_oeuvre"])
            cout_mat = float(row["cout_materiaux"])
            cout_total = cout_mo + cout_mat
            marge = budget - cout_total
            rentabilite_pct = (marge / budget * 100) if budget > 0 else 0
            items.append({
                "id": row["id"],
                "nom_projet": row["nom_projet"],
                "budget_total": budget,
                "cout_main_oeuvre": cout_mo,
                "cout_materiaux": cout_mat,
                "cout_total": cout_total,
                "marge": round(marge, 2),
                "rentabilite_pct": round(rentabilite_pct, 1),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_project_profitability_v2 error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/workstation-load")
async def get_workstation_load(user: ErpUser = Depends(get_current_user)):
    """Work center utilization."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_departement_columns(cursor, user.schema)

        cursor.execute(
            "SELECT departement, COUNT(*) as bt_count "
            "FROM formulaires "
            "WHERE type_formulaire = 'BON_TRAVAIL' AND statut = 'EN_COURS' "
            "GROUP BY departement"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "departement": row["departement"],
                "bt_count": row["bt_count"],
            })
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_workstation_load error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/project-progress")
async def get_project_progress(user: ErpUser = Depends(get_current_user)):
    """Project completion progress."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id, nom_projet, statut, COALESCE(pourcentage_completion, 0) as pourcentage_completion, budget_total "
            "FROM projects "
            "WHERE UPPER(statut) NOT IN ('ANNULE', 'ANNULÉ', 'CANCELLED') "
            "ORDER BY pourcentage_completion DESC "
            "LIMIT 20"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "id": row["id"],
                "nom_projet": row["nom_projet"],
                "statut": row["statut"],
                "pourcentage_completion": float(row["pourcentage_completion"] or 0),
                "budget_total": float(row["budget_total"] or 0),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_project_progress error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/sales-pipeline")
async def get_sales_pipeline(user: ErpUser = Depends(get_current_user)):
    """Sales pipeline from opportunities."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT statut, COUNT(*) as count, "
            "COALESCE(SUM(montant_estime), 0) as montant "
            "FROM opportunities "
            "GROUP BY statut "
            "ORDER BY CASE statut "
            "  WHEN 'PROSPECTION' THEN 1 "
            "  WHEN 'QUALIFICATION' THEN 2 "
            "  WHEN 'PROPOSITION' THEN 3 "
            "  WHEN 'NEGOCIATION' THEN 4 "
            "  WHEN 'GAGNE' THEN 5 "
            "  WHEN 'PERDU' THEN 6 "
            "  ELSE 7 END"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "statut": row["statut"],
                "count": row["count"],
                "montant": float(row["montant"]),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_sales_pipeline error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/top-clients-revenue")
async def get_top_clients_revenue(user: ErpUser = Depends(get_current_user)):
    """Top clients by revenue (from invoices)."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT c.id, c.nom, COUNT(f.id) as nb_factures, "
            "COALESCE(SUM(f.montant_total), 0) as ca_total "
            "FROM companies c "
            "JOIN factures f ON f.client_company_id = c.id "
            "WHERE UPPER(f.statut) NOT IN ('ANNULEE', 'ANNULÉE', 'ANNULE') "
            "GROUP BY c.id, c.nom "
            "ORDER BY ca_total DESC "
            "LIMIT 10"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "id": row["id"],
                "nom": row["nom"],
                "nb_factures": row["nb_factures"],
                "ca_total": float(row["ca_total"]),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_top_clients_revenue error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/employee-productivity")
async def get_employee_productivity_v2(user: ErpUser = Depends(get_current_user)):
    """Employee productivity metrics."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_departement_columns(cursor, user.schema)

        cursor.execute(
            "SELECT e.id, e.prenom || ' ' || e.nom as employe, e.departement, "
            "COALESCE(SUM(te.total_hours), 0) as heures_totales, "
            "COUNT(DISTINCT te.project_id) as nb_projets "
            "FROM employees e "
            "LEFT JOIN time_entries te ON e.id = te.employee_id "
            "WHERE e.statut = 'ACTIF' "
            "GROUP BY e.id, e.prenom, e.nom, e.departement "
            "ORDER BY heures_totales DESC "
            "LIMIT 20"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "id": row["id"],
                "employe": row["employe"],
                "departement": row["departement"],
                "heures_totales": round(float(row["heures_totales"]), 1),
                "nb_projets": row["nb_projets"],
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_employee_productivity_v2 error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/stock-alerts")
async def get_stock_alerts_v2(user: ErpUser = Depends(get_current_user)):
    """Products below minimum stock threshold."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id, nom, code_produit, stock_disponible, stock_minimum, categorie "
            "FROM produits "
            "WHERE active = TRUE AND stock_disponible <= stock_minimum AND stock_minimum > 0 "
            "ORDER BY (stock_disponible - stock_minimum) ASC"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "id": row["id"],
                "nom": row["nom"],
                "code_produit": row["code_produit"],
                "quantite_stock": float(row["stock_disponible"]),
                "seuil_minimum": float(row["stock_minimum"]),
                "categorie": row["categorie"],
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_stock_alerts_v2 error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/top-suppliers")
async def get_top_suppliers(user: ErpUser = Depends(get_current_user)):
    """Top suppliers by purchase volume."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT f.id, f.nom_fournisseur, COUNT(bc.id) as nb_commandes, "
            "COALESCE(SUM(bc.montant_total), 0) as total_achats "
            "FROM fournisseurs f "
            "LEFT JOIN bons_commande bc ON f.id = bc.fournisseur_id "
            "GROUP BY f.id, f.nom_fournisseur "
            "ORDER BY total_achats DESC "
            "LIMIT 10"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "id": row["id"],
                "nom": row["nom_fournisseur"],
                "nb_commandes": row["nb_commandes"],
                "total_achats": float(row["total_achats"]),
            })
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_top_suppliers error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/monthly-revenue")
async def get_monthly_revenue(user: ErpUser = Depends(get_current_user)):
    """Monthly revenue and expenses."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT TO_CHAR(date_facture, 'YYYY-MM') as mois, "
            "COALESCE(SUM(montant_total), 0) as revenus "
            "FROM factures "
            "WHERE UPPER(statut) NOT IN ('ANNULEE', 'ANNULÉE', 'ANNULE') "
            "AND date_facture >= CURRENT_DATE - INTERVAL '12 months' "
            "GROUP BY mois ORDER BY mois"
        )
        raw = {row["mois"]: {"revenus": float(row["revenus"])} for row in cursor.fetchall()}
        items = _fill_months(raw, 365, {"revenus": 0})

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_monthly_revenue error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/stock-value")
async def get_stock_value(user: ErpUser = Depends(get_current_user)):
    """Stock value by category."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT COALESCE(NULLIF(categorie, ''), 'Non categorise') as categorie, "
            "COUNT(*) as nb_produits, "
            "COALESCE(SUM(stock_disponible * COALESCE(cout_revient, prix_unitaire, 0)), 0) as valeur "
            "FROM produits "
            "WHERE active = TRUE "
            "GROUP BY COALESCE(NULLIF(categorie, ''), 'Non categorise') "
            "ORDER BY valeur DESC"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "categorie": row["categorie"],
                "nb_produits": row["nb_produits"],
                "valeur": round(float(row["valeur"]), 2),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_stock_value error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/trends")
async def get_trends(user: ErpUser = Depends(get_current_user)):
    """Compare current month vs previous month."""
    if not user.schema:
        return {}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Current month revenue
        cursor.execute(
            "SELECT COALESCE(SUM(montant_total), 0) as total "
            "FROM factures "
            "WHERE UPPER(statut) NOT IN ('ANNULEE', 'ANNULÉE', 'ANNULE') "
            "AND date_facture >= date_trunc('month', CURRENT_DATE)"
        )
        revenus_current = float(cursor.fetchone()["total"])

        # Previous month revenue
        cursor.execute(
            "SELECT COALESCE(SUM(montant_total), 0) as total "
            "FROM factures "
            "WHERE UPPER(statut) NOT IN ('ANNULEE', 'ANNULÉE', 'ANNULE') "
            "AND date_facture >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' "
            "AND date_facture < date_trunc('month', CURRENT_DATE)"
        )
        revenus_previous = float(cursor.fetchone()["total"])

        revenus_trend_pct = (
            ((revenus_current - revenus_previous) / revenus_previous * 100)
            if revenus_previous > 0
            else 0
        )

        # Current month devis
        cursor.execute(
            "SELECT COUNT(*) as total "
            "FROM devis "
            "WHERE date_creation >= date_trunc('month', CURRENT_DATE)"
        )
        devis_current = cursor.fetchone()["total"]

        # Previous month devis
        cursor.execute(
            "SELECT COUNT(*) as total "
            "FROM devis "
            "WHERE date_creation >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' "
            "AND date_creation < date_trunc('month', CURRENT_DATE)"
        )
        devis_previous = cursor.fetchone()["total"]

        devis_trend_pct = (
            ((devis_current - devis_previous) / devis_previous * 100)
            if devis_previous > 0
            else 0
        )

        return {
            "revenus_current": round(revenus_current, 2),
            "revenus_previous": round(revenus_previous, 2),
            "revenus_trend_pct": round(revenus_trend_pct, 1),
            "devis_current": devis_current,
            "devis_previous": devis_previous,
            "devis_trend_pct": round(devis_trend_pct, 1),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_trends error: %s", exc)
        return {}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ===================== POWER BI ENDPOINTS =====================


@router.get("/invoices-by-status")
async def get_invoices_by_status(user: ErpUser = Depends(get_current_user)):
    """Distribution of invoices by status for donut chart."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT statut, COUNT(*) as count, "
            "COALESCE(SUM(montant_total), 0) as montant "
            "FROM factures "
            "GROUP BY statut "
            "ORDER BY count DESC"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "statut": row["statut"],
                "count": row["count"],
                "montant": float(row["montant"]),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_invoices_by_status error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/bt-by-status")
async def get_bt_by_status(user: ErpUser = Depends(get_current_user)):
    """Distribution of work orders by status for donut chart."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT statut, COUNT(*) as count "
            "FROM formulaires "
            "WHERE type_formulaire = 'BON_TRAVAIL' "
            "GROUP BY statut "
            "ORDER BY count DESC"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "statut": row["statut"],
                "count": row["count"],
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_bt_by_status error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/hours-trend")
async def get_hours_trend(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(365, ge=30, le=730),
):
    """Monthly hours worked trend for area chart."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT TO_CHAR(punch_in, 'YYYY-MM') as mois, "
            "COALESCE(SUM(total_hours), 0) as heures, "
            "COUNT(DISTINCT employee_id) as employes, "
            "COUNT(*) as pointages "
            "FROM time_entries "
            "WHERE punch_in >= CURRENT_DATE - make_interval(days => %s) "
            "GROUP BY mois ORDER BY mois",
            (period_days,),
        )
        raw = {}
        for row in cursor.fetchall():
            raw[row["mois"]] = {
                "heures": round(float(row["heures"]), 1),
                "employes": row["employes"],
                "pointages": row["pointages"],
            }
        items = _fill_months(raw, period_days, {"heures": 0, "employes": 0, "pointages": 0})

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_hours_trend error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/factures-aging")
async def get_factures_aging(user: ErpUser = Depends(get_current_user)):
    """Invoice aging analysis (0-30, 31-60, 61-90, 90+ days)."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT "
            "CASE "
            "  WHEN CURRENT_DATE - date_facture <= 30 THEN '0-30 jours' "
            "  WHEN CURRENT_DATE - date_facture <= 60 THEN '31-60 jours' "
            "  WHEN CURRENT_DATE - date_facture <= 90 THEN '61-90 jours' "
            "  ELSE '90+ jours' "
            "END as tranche, "
            "COUNT(*) as count, "
            "COALESCE(SUM(solde_du), 0) as solde "
            "FROM factures "
            "WHERE UPPER(statut) NOT IN ('PAYEE', 'PAYÉE', 'ANNULEE', 'ANNULÉE') AND COALESCE(solde_du, 0) > 0 "
            "GROUP BY tranche "
            "ORDER BY MIN(CURRENT_DATE - date_facture)"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "tranche": row["tranche"],
                "count": row["count"],
                "solde": float(row["solde"]),
            })

        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_factures_aging error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/stock-summary")
async def get_stock_summary(user: ErpUser = Depends(get_current_user)):
    """Stock summary KPIs for stock tab."""
    if not user.schema:
        return {}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT "
            "COUNT(*) as total_produits, "
            "COUNT(CASE WHEN active = TRUE THEN 1 END) as produits_actifs, "
            "COUNT(DISTINCT CASE WHEN active = TRUE THEN NULLIF(categorie, '') END) as categories, "
            "COALESCE(SUM(CASE WHEN active = TRUE THEN stock_disponible * COALESCE(cout_revient, prix_unitaire, 0) ELSE 0 END), 0) as valeur_totale, "
            "COUNT(CASE WHEN active = TRUE AND stock_disponible <= stock_minimum AND stock_minimum > 0 THEN 1 END) as alertes "
            "FROM produits"
        )
        row = cursor.fetchone()
        return {
            "total_produits": row["total_produits"],
            "produits_actifs": row["produits_actifs"],
            "categories": row["categories"],
            "valeur_totale": round(float(row["valeur_totale"]), 2),
            "alertes": row["alertes"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_stock_summary error: %s", exc)
        return {"total_produits": 0, "produits_actifs": 0, "categories": 0, "valeur_totale": 0, "alertes": 0}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
