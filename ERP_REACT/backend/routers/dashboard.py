"""
ERP React - Dashboard Router
KPIs, alerts, and recent activity.
"""

import logging
from fastapi import APIRouter, Depends

from ..erp_auth import get_current_user, ErpUser
from ..erp_models import DashboardResponse, DashboardStats, DashboardAlert
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("", response_model=DashboardResponse)
async def get_dashboard(user: ErpUser = Depends(get_current_user)):
    """Get consolidated dashboard data for the current tenant."""
    if not user.schema:
        # Super-admin has no tenant — return empty dashboard instead of 400
        return DashboardResponse(stats=DashboardStats(), alerts=[])

    stats_raw = db.get_dashboard_stats(user.schema)
    alerts_raw = db.get_dashboard_alerts(user.schema)

    stats = DashboardStats(**stats_raw) if stats_raw else DashboardStats()
    alerts = [DashboardAlert(**a) for a in alerts_raw]

    return DashboardResponse(stats=stats, alerts=alerts)


@router.get("/activity")
async def get_activity(user: ErpUser = Depends(get_current_user)):
    """Get recent activity for the dashboard."""
    if not user.schema:
        return {"items": []}

    activities = db.get_recent_activity(user.schema)
    return {"items": activities}


@router.get("/alerts")
async def get_dashboard_alerts(user: ErpUser = Depends(get_current_user)):
    """Get urgent alerts for the dashboard."""
    if not user.schema:
        return {"alerts": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        alerts = []

        # 1. Devis urgents
        try:
            cursor.execute(
                "SELECT COUNT(*) as total FROM devis "
                "WHERE date_prevu <= CURRENT_DATE + 7 "
                "AND statut IN ('Envoye', 'En attente')"
            )
            count = cursor.fetchone()["total"]
            if count > 0:
                alerts.append({
                    "type": "devis_urgents",
                    "count": count,
                    "message": f"{count} devis arrivent a echeance dans 7 jours",
                    "severity": "warning",
                })
        except Exception:
            pass

        # 2. Stock bas
        try:
            cursor.execute(
                "SELECT COUNT(*) as total FROM produits "
                "WHERE stock_disponible <= stock_minimum "
                "AND stock_minimum > 0 AND active = TRUE"
            )
            count = cursor.fetchone()["total"]
            if count > 0:
                alerts.append({
                    "type": "stock_bas",
                    "count": count,
                    "message": f"{count} produits sous le seuil minimum de stock",
                    "severity": "danger",
                })
        except Exception:
            pass

        # 3. Factures en retard
        try:
            cursor.execute(
                "SELECT COUNT(*) as total FROM factures "
                "WHERE date_echeance < CURRENT_DATE "
                "AND statut NOT IN ('PAYEE', 'ANNULEE')"
            )
            count = cursor.fetchone()["total"]
            if count > 0:
                alerts.append({
                    "type": "factures_retard",
                    "count": count,
                    "message": f"{count} factures en retard de paiement",
                    "severity": "danger",
                })
        except Exception:
            pass

        return {"alerts": alerts}
    except Exception as exc:
        logger.error("get_dashboard_alerts error: %s", exc)
        return {"alerts": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/charts")
async def get_dashboard_charts(user: ErpUser = Depends(get_current_user)):
    """Get chart data for the dashboard."""
    if not user.schema:
        return {"projects_by_status": [], "monthly_revenue": [], "bt_by_status": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # 1. Projects by status
        projects_by_status = []
        try:
            cursor.execute(
                "SELECT statut, COUNT(*) as count FROM projects GROUP BY statut"
            )
            for row in cursor.fetchall():
                projects_by_status.append({
                    "statut": row["statut"],
                    "count": row["count"],
                })
        except Exception:
            pass

        # 2. Monthly revenue (last 6 months)
        monthly_revenue = []
        try:
            cursor.execute(
                "SELECT date_trunc('month', date_facture) as mois, "
                "COALESCE(SUM(montant_total), 0) as total "
                "FROM factures "
                "WHERE statut != 'ANNULEE' "
                "GROUP BY mois "
                "ORDER BY mois DESC "
                "LIMIT 6"
            )
            for row in cursor.fetchall():
                monthly_revenue.append({
                    "mois": str(row["mois"]),
                    "total": float(row["total"]),
                })
        except Exception:
            pass

        # 3. BT by status
        bt_by_status = []
        try:
            cursor.execute(
                "SELECT statut, COUNT(*) as count FROM formulaires "
                "WHERE type_formulaire = 'BON_TRAVAIL' "
                "GROUP BY statut"
            )
            for row in cursor.fetchall():
                bt_by_status.append({
                    "statut": row["statut"],
                    "count": row["count"],
                })
        except Exception:
            pass

        return {
            "projects_by_status": projects_by_status,
            "monthly_revenue": monthly_revenue,
            "bt_by_status": bt_by_status,
        }
    except Exception as exc:
        logger.error("get_dashboard_charts error: %s", exc)
        return {"projects_by_status": [], "monthly_revenue": [], "bt_by_status": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/top-suppliers")
async def get_dashboard_top_suppliers(user: ErpUser = Depends(get_current_user)):
    """Get top suppliers for dashboard."""
    if not user.schema:
        return {"items": []}

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        try:
            cursor.execute(
                "SELECT f.id, f.nom_fournisseur, COUNT(bc.id) as nb_commandes, "
                "COALESCE(SUM(bc.montant_total), 0) as total_achats "
                "FROM fournisseurs f "
                "LEFT JOIN bons_commande bc ON f.id = bc.fournisseur_id "
                "GROUP BY f.id, f.nom_fournisseur "
                "ORDER BY total_achats DESC "
                "LIMIT 5"
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
        except Exception:
            return {"items": []}
    except Exception as exc:
        logger.error("get_dashboard_top_suppliers error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
