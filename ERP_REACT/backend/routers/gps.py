"""
ERP React - GPS Router
Vehicle tracking, locations, geofences, and routes.
Tables: gps_vehicle_tracking, gps_locations, gps_routes, gps_geofences, logistics_vehicles
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gps", tags=["GPS"])


# ============================================
# PYDANTIC MODELS
# ============================================

class GpsLocationCreate(BaseModel):
    nom: str
    type_lieu: str = "chantier"  # chantier, entrepot, bureau, autre
    latitude: float
    longitude: float
    adresse: Optional[str] = None
    ville: Optional[str] = None
    rayon_geofence: Optional[int] = None
    notes: Optional[str] = None


class GpsGeofenceCreate(BaseModel):
    nom: str
    type_zone: str = "chantier"  # chantier, zone_interdite, zone_livraison
    latitude_centre: float
    longitude_centre: float
    rayon_metres: int = 500
    alerte_entree: bool = True
    alerte_sortie: bool = True
    notes: Optional[str] = None


# ============================================
# VEHICLES WITH GPS TRACKING
# ============================================

@router.get("/vehicles")
async def list_vehicles_with_gps(
    user: ErpUser = Depends(get_current_user),
):
    """List vehicles with their last known GPS position."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT v.id, v.marque, v.modele, v.immatriculation, v.statut, v.kilometrage, "
            "t.latitude, t.longitude, t.vitesse, t.cap, t.timestamp as derniere_position "
            "FROM logistics_vehicles v "
            "LEFT JOIN LATERAL ("
            "  SELECT latitude, longitude, vitesse, cap, timestamp "
            "  FROM gps_vehicle_tracking "
            "  WHERE vehicle_id = v.id "
            "  ORDER BY timestamp DESC LIMIT 1"
            ") t ON TRUE "
            "ORDER BY v.marque, v.modele"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("kilometrage"):
                d["kilometrage"] = float(d["kilometrage"])
            if d.get("latitude"):
                d["latitude"] = float(d["latitude"])
            if d.get("longitude"):
                d["longitude"] = float(d["longitude"])
            if d.get("vitesse"):
                d["vitesse"] = float(d["vitesse"])
            if d.get("cap"):
                d["cap"] = float(d["cap"])
            if d.get("derniere_position"):
                d["derniere_position"] = str(d["derniere_position"])
            items.append(d)

        return {"items": items}
    except Exception as exc:
        logger.error("list_vehicles_with_gps error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des vehicules GPS")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/vehicles/{vehicle_id}/history")
async def get_vehicle_history(
    vehicle_id: int,
    user: ErpUser = Depends(get_current_user),
    hours: int = Query(24, ge=1, le=168),
):
    """Get GPS position history for a vehicle (last N hours, default 24h)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id, latitude, longitude, vitesse, cap, altitude, timestamp "
            "FROM gps_vehicle_tracking "
            "WHERE vehicle_id = %s AND timestamp >= NOW() - make_interval(hours => %s) "
            "ORDER BY timestamp ASC",
            (vehicle_id, hours),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("latitude", "longitude", "vitesse", "cap", "altitude"):
                if d.get(k):
                    d[k] = float(d[k])
            if d.get("timestamp"):
                d["timestamp"] = str(d["timestamp"])
            items.append(d)

        return {"items": items, "vehicle_id": vehicle_id, "hours": hours}
    except Exception as exc:
        logger.error("get_vehicle_history error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation de l'historique GPS")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# GPS LOCATIONS (saved points)
# ============================================

@router.get("/locations")
async def list_gps_locations(user: ErpUser = Depends(get_current_user)):
    """List saved GPS locations (chantiers, entrepots)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT * FROM gps_locations ORDER BY nom ASC"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("latitude", "longitude"):
                if d.get(k):
                    d[k] = float(d[k])
            for k in ("created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)

        return {"items": items}
    except Exception as exc:
        logger.error("list_gps_locations error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des locations GPS")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/locations")
async def create_gps_location(body: GpsLocationCreate, user: ErpUser = Depends(get_current_user)):
    """Create a saved GPS location."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO gps_locations (nom, type_lieu, latitude, longitude, adresse, "
            "ville, rayon_geofence, notes) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
            "RETURNING id",
            (body.nom, body.type_lieu, body.latitude, body.longitude,
             body.adresse, body.ville, body.rayon_geofence, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Location GPS créée"}
    except Exception as exc:
        logger.error("create_gps_location error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la création de la location")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# GPS GEOFENCES
# ============================================

@router.get("/geofences")
async def list_gps_geofences(user: ErpUser = Depends(get_current_user)):
    """List GPS geofences."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT * FROM gps_geofences ORDER BY nom ASC"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("latitude_centre", "longitude_centre"):
                if d.get(k):
                    d[k] = float(d[k])
            for k in ("created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)

        return {"items": items}
    except Exception as exc:
        logger.error("list_gps_geofences error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des geofences")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/geofences")
async def create_gps_geofence(body: GpsGeofenceCreate, user: ErpUser = Depends(get_current_user)):
    """Create a GPS geofence."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO gps_geofences (nom, type_zone, latitude_centre, longitude_centre, "
            "rayon_metres, alerte_entree, alerte_sortie, notes, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.nom, body.type_zone, body.latitude_centre, body.longitude_centre,
             body.rayon_metres, body.alerte_entree, body.alerte_sortie, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Geofence créée"}
    except Exception as exc:
        logger.error("create_gps_geofence error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la création de la geofence")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# GPS ROUTES
# ============================================

@router.get("/routes")
async def list_gps_routes(
    user: ErpUser = Depends(get_current_user),
    date: Optional[str] = None,
):
    """List GPS routes for today (or specified date)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        if date:
            cursor.execute(
                "SELECT r.*, v.marque, v.modele, v.immatriculation "
                "FROM gps_routes r "
                "LEFT JOIN logistics_vehicles v ON r.vehicle_id = v.id "
                "WHERE r.date_planifiee = %s::date "
                "ORDER BY r.date_planifiee DESC",
                (date,),
            )
        else:
            cursor.execute(
                "SELECT r.*, v.marque, v.modele, v.immatriculation "
                "FROM gps_routes r "
                "LEFT JOIN logistics_vehicles v ON r.vehicle_id = v.id "
                "WHERE r.date_planifiee = CURRENT_DATE "
                "ORDER BY r.date_planifiee DESC"
            )

        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_planifiee", "heure_depart_reel", "heure_arrivee_reel", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("distance_km"):
                d["distance_km"] = float(d["distance_km"])
            items.append(d)

        return {"items": items}
    except Exception as exc:
        logger.error("list_gps_routes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation des routes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
