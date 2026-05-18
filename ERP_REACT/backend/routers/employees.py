"""
ERP React - Employees Router
Employees + competences + time tracking + payroll summary.
Based on employees.py (3,342 lines) + timetracker_unified.py (5,146 lines) + paie.py (2,404 lines).
"""

import logging
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/employees", tags=["Employees"])


def _empty_to_none(v):
    """Convert empty strings to None — used on date/timestamp fields to avoid PostgreSQL
    'invalid input syntax' errors when frontend sends blank values."""
    return None if isinstance(v, str) and v.strip() == "" else v


def _ensure_operations_text_columns(cursor) -> None:
    """Defensive ALTER for operations.nom / description on legacy tenants.

    production.py:_ensure_operations_columns handles this on work-order endpoints,
    but list_time_entries JOINs operations on its own path — we need the same
    guarantee here to avoid UndefinedColumn on tenants that never hit production.py.
    Silent try/except: a failure here does not block the listing."""
    try:
        cursor.execute("ALTER TABLE operations ADD COLUMN IF NOT EXISTS nom TEXT")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE operations ADD COLUMN IF NOT EXISTS description TEXT")
    except Exception:
        pass

DEPARTEMENTS = [
    "CHANTIER", "STRUCTURE_BETON", "CHARPENTE_BOIS", "FINITION",
    "MECANIQUE_BATIMENT", "ELECTRICITE", "INGENIERIE",
    "QUALITE_CONFORMITE", "ADMINISTRATION", "COMMERCIAL", "DIRECTION",
]

STATUTS = ["ACTIF", "CONGE", "FORMATION", "ARRET_TRAVAIL", "INACTIF"]
TYPES_CONTRAT = ["CDI", "CDD", "TEMPORAIRE", "STAGE", "APPRENTISSAGE"]

# Quebec payroll deduction rates (2026)
RRQ_RATE = 0.0640              # Regime de rentes du Quebec - employee portion
RRQ_RATE_EMPLOYER = 0.0640     # Regime de rentes du Quebec - employer portion
RQAP_RATE_EMP = 0.00494        # Regime quebecois d'assurance parentale - employee
RQAP_RATE_EMPLOYER = 0.00692   # Regime quebecois d'assurance parentale - employer
AE_RATE_EMP = 0.0132           # Assurance-Emploi - employee
AE_RATE_EMPLOYER = 0.01848     # Assurance-Emploi - employer (1.4x employee)
CNESST_RATE = 0.0180           # CNESST - employer only, varies by industry
FSS_RATE = 0.0165              # Fonds des services de sante - employer only


class EmployeeCreate(BaseModel):
    prenom: str
    nom: str
    email: Optional[str] = None
    telephone: Optional[str] = None
    poste: Optional[str] = None
    departement: Optional[str] = None
    statut: str = "ACTIF"
    type_contrat: str = "CDI"
    date_embauche: Optional[str] = None
    salaire: Optional[float] = Field(None, ge=0)
    taux_horaire: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    pin_code: Optional[str] = Field(None, min_length=4, max_length=4, pattern=r'^\d{4}$')
    can_approve_timecards: bool = False

    @field_validator("date_embauche", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class EmployeeUpdate(BaseModel):
    prenom: Optional[str] = None
    nom: Optional[str] = None
    email: Optional[str] = None
    telephone: Optional[str] = None
    poste: Optional[str] = None
    departement: Optional[str] = None
    statut: Optional[str] = None
    salaire: Optional[float] = Field(None, ge=0)
    taux_horaire: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    pin_code: Optional[str] = Field(None, min_length=4, max_length=4, pattern=r'^\d{4}$')
    can_approve_timecards: Optional[bool] = None


class TimeEntryCreate(BaseModel):
    employee_id: int
    project_id: Optional[int] = None
    operation_id: Optional[int] = None
    formulaire_bt_id: Optional[int] = None
    punch_in: Optional[str] = None
    punch_out: Optional[str] = None
    total_hours: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    type_travail: Optional[str] = None
    billable: Optional[bool] = None

    @field_validator("punch_in", "punch_out", mode="before")
    @classmethod
    def _clean_ts(cls, v):
        return _empty_to_none(v)


class TimeEntryUpdate(BaseModel):
    employee_id: Optional[int] = None
    project_id: Optional[int] = None
    operation_id: Optional[int] = None
    formulaire_bt_id: Optional[int] = None
    punch_in: Optional[str] = None
    punch_out: Optional[str] = None
    total_hours: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    type_travail: Optional[str] = None
    billable: Optional[bool] = None
    validated: Optional[bool] = None

    @field_validator("punch_in", "punch_out", mode="before")
    @classmethod
    def _clean_ts(cls, v):
        return _empty_to_none(v)


# ============================================
# EMPLOYEES CRUD
# ============================================

# NOTE: Routes /time-entries and /payroll-summary MUST be defined
# BEFORE /{employee_id} to avoid FastAPI route shadowing (SEAOP lesson #6)

@router.get("/time-entries")
async def list_time_entries(
    user: ErpUser = Depends(get_current_user),
    employee_id: Optional[int] = None,
    project_id: Optional[int] = None,
    bt_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List time entries with optional filters."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_operations_text_columns(cursor)
        wheres, params = [], []
        if employee_id:
            wheres.append("te.employee_id = %s")
            params.append(employee_id)
        if project_id:
            wheres.append("te.project_id = %s")
            params.append(project_id)
        if bt_id:
            wheres.append("te.formulaire_bt_id = %s")
            params.append(bt_id)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM time_entries te WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT te.id, te.employee_id, te.project_id, te.formulaire_bt_id, "
            f"te.operation_id, "
            f"te.punch_in, te.punch_out, "
            f"te.total_hours, te.notes, te.type_travail, te.validated, "
            f"COALESCE(te.billable, TRUE) AS billable, "
            f"COALESCE(te.is_billed, 0) AS is_billed, "
            f"e.prenom || ' ' || e.nom as employe_nom, "
            f"p.nom_projet, "
            f"f.numero_document as bt_numero, "
            f"comp.nom as client_nom, "
            f"COALESCE(o.nom, o.description) as operation_nom "
            f"FROM time_entries te "
            f"LEFT JOIN employees e ON te.employee_id = e.id "
            f"LEFT JOIN projects p ON te.project_id::text = p.id::text "
            f"LEFT JOIN formulaires f ON te.formulaire_bt_id = f.id "
            f"LEFT JOIN companies comp ON f.company_id = comp.id "
            f"LEFT JOIN operations o ON te.operation_id = o.id "
            f"WHERE {w} ORDER BY te.punch_in DESC NULLS LAST "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("punch_in", "punch_out"):
                v = d.get(k)
                if v is not None:
                    # isoformat() produces "YYYY-MM-DDTHH:MM:SS" which parses on
                    # every browser (incl. Safari). str(datetime) uses a space
                    # instead of 'T' and Safari rejects it.
                    d[k] = v.isoformat() if hasattr(v, "isoformat") else str(v)
            if d.get("total_hours") is not None:
                d["total_hours"] = float(d["total_hours"])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_time_entries error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture des pointages")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/time-entries")
async def create_time_entry(body: TimeEntryCreate, user: ErpUser = Depends(get_current_user)):
    """Create a time entry (punch in/out)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Auto-calculate total_hours from punch_in/punch_out if not provided
        total_hours = body.total_hours
        if total_hours is None and body.punch_in and body.punch_out:
            try:
                from datetime import datetime as _dt
                pin = body.punch_in.replace("Z", "+00:00") if "Z" in body.punch_in else body.punch_in
                pout = body.punch_out.replace("Z", "+00:00") if "Z" in body.punch_out else body.punch_out
                dt_in = _dt.fromisoformat(pin)
                dt_out = _dt.fromisoformat(pout)
                if dt_out < dt_in:
                    raise HTTPException(status_code=400, detail="punch_out doit être après punch_in")
                total_hours = round((dt_out - dt_in).total_seconds() / 3600, 2)
            except HTTPException:
                raise
            except Exception:
                pass
        billable_val = True if body.billable is None else body.billable
        cursor.execute(
            "INSERT INTO time_entries (employee_id, project_id, operation_id, formulaire_bt_id, "
            "punch_in, punch_out, total_hours, notes, type_travail, billable, created_at) "
            "VALUES (%s,%s,%s,%s,COALESCE(%s, CURRENT_TIMESTAMP),%s,%s,%s,%s,%s,CURRENT_TIMESTAMP) RETURNING id",
            (body.employee_id, body.project_id, body.operation_id, body.formulaire_bt_id,
             body.punch_in, body.punch_out,
             total_hours, body.notes, body.type_travail, billable_val),
        )
        row = cursor.fetchone()
        return {"id": row["id"], "message": "Pointage enregistré"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_time_entry error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du pointage")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/payroll-summary")
async def get_payroll_summary(
    user: ErpUser = Depends(get_current_user),
    period_days: int = Query(30, ge=1, le=365),
):
    """Get payroll summary for the period."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT e.id, e.prenom || ' ' || e.nom as employe, e.poste, "
            "e.departement, COALESCE(e.taux_horaire, e.salaire, 0) as taux, "
            "COALESCE(SUM(te.total_hours), 0) as heures_totales, "
            "COALESCE(SUM(te.total_hours * COALESCE(e.taux_horaire, e.salaire, 0)), 0) as salaire_brut "
            "FROM employees e "
            "LEFT JOIN time_entries te ON e.id = te.employee_id "
            "AND te.punch_in >= CURRENT_DATE - make_interval(days => %s) "
            "WHERE e.statut = 'ACTIF' "
            "GROUP BY e.id, e.prenom, e.nom, e.poste, e.departement, e.taux_horaire, e.salaire "
            "ORDER BY salaire_brut DESC",
            (period_days,),
        )
        items = []
        total_brut = 0
        for row in cursor.fetchall():
            brut = float(row["salaire_brut"])
            total_brut += brut
            rrq = round(brut * RRQ_RATE, 2)
            rqap = round(brut * RQAP_RATE_EMP, 2)
            ae = round(brut * AE_RATE_EMP, 2)
            deductions = rrq + rqap + ae
            net = round(brut - deductions, 2)
            items.append({
                "id": row["id"],
                "employe": row["employe"],
                "poste": row["poste"],
                "departement": row["departement"],
                "heures_totales": round(float(row["heures_totales"]), 1),
                "taux": round(float(row["taux"]), 2),
                "salaire_brut": round(brut, 2),
                "deductions": round(deductions, 2),
                "salaire_net": net,
            })
        return {
            "items": items,
            "total_brut": round(total_brut, 2),
            "total_employes": len(items),
            "period_days": period_days,
        }
    except Exception as exc:
        logger.error("get_payroll_summary error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/time-entries/{entry_id}/validate")
async def validate_time_entry(entry_id: int, user: ErpUser = Depends(get_current_user)):
    """Validate/approve a time entry (admin action)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE time_entries SET validated = TRUE, validated_by = %s, "
            "validated_at = CURRENT_TIMESTAMP WHERE id = %s RETURNING id",
            (user.user_id, entry_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pointage non trouvé")
        return {"message": "Pointage valide"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("validate_time_entry error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la validation du pointage")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/time-entries/{entry_id}")
async def update_time_entry(entry_id: int, body: TimeEntryUpdate, user: ErpUser = Depends(get_current_user)):
    """Update a time entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Verify entry exists
        cursor.execute("SELECT id, is_billed FROM time_entries WHERE id = %s", (entry_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Pointage non trouvé")
        if existing.get("is_billed"):
            raise HTTPException(status_code=400, detail="Impossible de modifier un pointage déjà facturé")

        # Build dynamic update
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="Aucun champ a modifier")

        # Defense-in-depth: when both operation_id and formulaire_bt_id are
        # present in the update, make sure the operation actually belongs to
        # the BT. Otherwise, a stale operation from a previously-selected BT
        # could be persisted if the UI state drifts.
        op_in_payload = fields.get("operation_id")
        if op_in_payload is not None:
            if "formulaire_bt_id" in fields:
                bt_ref = fields["formulaire_bt_id"]
            else:
                cursor.execute(
                    "SELECT formulaire_bt_id FROM time_entries WHERE id = %s", (entry_id,)
                )
                row_bt = cursor.fetchone() or {}
                bt_ref = row_bt.get("formulaire_bt_id")
            if bt_ref is None:
                raise HTTPException(
                    status_code=400,
                    detail="Une opération doit être rattachée à un bon de travail",
                )
            cursor.execute(
                "SELECT id FROM operations WHERE id = %s AND formulaire_bt_id = %s",
                (op_in_payload, bt_ref),
            )
            if not cursor.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail="Opération introuvable ou n'appartient pas à ce bon de travail",
                )

        # Auto-calculate total_hours from punch_in/punch_out when the caller did
        # not pass an explicit total_hours override. This matches the behaviour
        # of POST /time-entries.
        if ("punch_in" in fields or "punch_out" in fields) and "total_hours" not in fields:
            # Need to read current values for the one not provided
            cursor.execute("SELECT punch_in, punch_out FROM time_entries WHERE id = %s", (entry_id,))
            current = cursor.fetchone() or {}
            pin = fields.get("punch_in") or (
                current["punch_in"].isoformat()
                if current.get("punch_in") and hasattr(current["punch_in"], "isoformat")
                else (str(current["punch_in"]) if current.get("punch_in") else None)
            )
            pout = fields.get("punch_out") or (
                current["punch_out"].isoformat()
                if current.get("punch_out") and hasattr(current["punch_out"], "isoformat")
                else (str(current["punch_out"]) if current.get("punch_out") else None)
            )
            if pin and pout:
                from datetime import datetime as _dt
                try:
                    # Python 3.11+ fromisoformat accepts both T and space
                    # separators as well as offsets. Keep the input mostly
                    # as-is — only normalise the trailing 'Z' into a valid
                    # UTC offset.
                    dt_in = _dt.fromisoformat(pin.replace("Z", "+00:00"))
                    dt_out = _dt.fromisoformat(pout.replace("Z", "+00:00"))
                    if dt_out < dt_in:
                        raise HTTPException(status_code=400, detail="punch_out doit être après punch_in")
                    fields["total_hours"] = round((dt_out - dt_in).total_seconds() / 3600, 2)
                except HTTPException:
                    raise
                except (ValueError, TypeError):
                    pass

        # Build SET clause
        set_parts = []
        values = []
        ALLOWED = {"employee_id", "project_id", "operation_id", "formulaire_bt_id",
                    "punch_in", "punch_out", "total_hours", "notes", "type_travail",
                    "billable", "validated"}
        for key, val in fields.items():
            if key in ALLOWED:
                set_parts.append(f"{key} = %s")
                values.append(val)

        # Audit trail for `validated`: mirror the behaviour of the dedicated
        # /validate endpoint so approvals done via the full edit modal also
        # populate validated_by / validated_at (and are cleared on unvalidate).
        if "validated" in fields:
            if fields["validated"]:
                set_parts.append("validated_by = %s")
                values.append(user.user_id)
                set_parts.append("validated_at = CURRENT_TIMESTAMP")
            else:
                set_parts.append("validated_by = NULL")
                set_parts.append("validated_at = NULL")

        if not set_parts:
            raise HTTPException(status_code=400, detail="Aucun champ valide")

        values.append(entry_id)
        cursor.execute(
            f"UPDATE time_entries SET {', '.join(set_parts)} WHERE id = %s RETURNING id",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Pointage non trouvé")
        return {"id": entry_id, "message": "Pointage modifié"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_time_entry error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la modification")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/time-entries/{entry_id}")
async def delete_time_entry(entry_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a time entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Verify entry exists and not billed
        cursor.execute("SELECT id, is_billed FROM time_entries WHERE id = %s", (entry_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Pointage non trouvé")
        if existing.get("is_billed"):
            raise HTTPException(status_code=400, detail="Impossible de supprimer un pointage déjà facturé")

        cursor.execute("DELETE FROM time_entries WHERE id = %s", (entry_id,))
        # Commit explicite par defensivite (pool autocommit no-op, fallback persist)
        conn.commit()
        return {"message": "Pointage supprimé"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("delete_time_entry error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/time-entries/weekly")
async def get_weekly_timesheet(
    user: ErpUser = Depends(get_current_user),
    employee_id: Optional[int] = None,
    week_start: Optional[str] = None,
):
    """Get weekly timesheet view."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Determine week start (Monday)
        if week_start:
            ws_clause = "%s::date"
            ws_param = week_start
        else:
            ws_clause = "date_trunc('week', CURRENT_DATE)::date"
            ws_param = None
        # Build query
        wheres = []
        params = []
        if ws_param:
            wheres.append(f"te.punch_in >= {ws_clause}")
            params.append(ws_param)
            wheres.append(f"te.punch_in < ({ws_clause} + INTERVAL '7 days')")
            params.append(ws_param)
        else:
            wheres.append(f"te.punch_in >= {ws_clause}")
            wheres.append(f"te.punch_in < ({ws_clause} + INTERVAL '7 days')")
        if employee_id:
            wheres.append("te.employee_id = %s")
            params.append(employee_id)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(
            f"SELECT te.id, te.employee_id, te.project_id, te.formulaire_bt_id, "
            f"te.punch_in, te.punch_out, "
            f"te.total_hours, te.notes, te.type_travail, te.validated, "
            f"COALESCE(te.billable, TRUE) AS billable, "
            f"COALESCE(te.is_billed, 0) AS is_billed, "
            f"p.nom_projet, e.prenom || ' ' || e.nom as employe_nom, "
            f"f.numero_document as bt_numero "
            f"FROM time_entries te "
            f"LEFT JOIN projects p ON te.project_id::text = p.id::text "
            f"LEFT JOIN employees e ON te.employee_id = e.id "
            f"LEFT JOIN formulaires f ON te.formulaire_bt_id = f.id "
            f"WHERE {w} ORDER BY te.employee_id, te.punch_in",
            params,
        )
        rows = cursor.fetchall()
        # Compute actual week_start/end
        if ws_param:
            actual_ws = ws_param
        else:
            cursor.execute("SELECT date_trunc('week', CURRENT_DATE)::date as ws")
            actual_ws = str(cursor.fetchone()["ws"])
        # Parse week_start date to compute week_end
        from datetime import datetime, timedelta
        ws_date = datetime.strptime(actual_ws, "%Y-%m-%d")
        we_date = ws_date + timedelta(days=6)
        jour_noms = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
        jours = []
        for i in range(7):
            day_date = ws_date + timedelta(days=i)
            day_str = day_date.strftime("%Y-%m-%d")
            day_entries = []
            for row in rows:
                d = dict(row)
                punch = d.get("punch_in")
                if punch and str(punch)[:10] == day_str:
                    for k in ("punch_in", "punch_out"):
                        if d.get(k):
                            d[k] = str(d[k])
                    if d.get("total_hours") is not None:
                        d["total_hours"] = float(d["total_hours"])
                    day_entries.append(d)
            total_h = sum(e.get("total_hours", 0) or 0 for e in day_entries)
            jours.append({
                "jour": jour_noms[i],
                "date": day_str,
                "entries": day_entries,
                "total_heures": round(total_h, 2),
            })
        total_semaine = sum(j["total_heures"] for j in jours)
        return {
            "week_start": actual_ws,
            "week_end": we_date.strftime("%Y-%m-%d"),
            "jours": jours,
            "total_semaine": round(total_semaine, 2),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_weekly_timesheet error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la lecture de la feuille de temps hebdomadaire")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/time-entries/by-project")
async def get_hours_by_project(user: ErpUser = Depends(get_current_user)):
    """Get total hours grouped by project."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT p.id, p.nom_projet, COALESCE(SUM(te.total_hours), 0) as heures, "
            "COUNT(DISTINCT te.employee_id) as nb_employes "
            "FROM time_entries te "
            "JOIN projects p ON te.project_id::text = p.id::text "
            "GROUP BY p.id, p.nom_projet ORDER BY heures DESC LIMIT 20"
        )
        project_rows = cursor.fetchall()
        project_ids = [row["id"] for row in project_rows]
        # Fetch employee detail per project
        employes_par_projet = {}
        if project_ids:
            cursor.execute(
                "SELECT te.project_id, e.id as employee_id, "
                "e.prenom || ' ' || e.nom as employe_nom, "
                "COALESCE(SUM(te.total_hours), 0) as heures "
                "FROM time_entries te "
                "JOIN employees e ON te.employee_id = e.id "
                "WHERE te.project_id = ANY(%s) "
                "GROUP BY te.project_id, e.id, e.prenom, e.nom "
                "ORDER BY heures DESC",
                (project_ids,),
            )
            for row in cursor.fetchall():
                pid = row["project_id"]
                if pid not in employes_par_projet:
                    employes_par_projet[pid] = []
                employes_par_projet[pid].append({
                    "id": row["employee_id"],
                    "nom": row["employe_nom"],
                    "heures": round(float(row["heures"]), 2),
                })
        items = []
        for row in project_rows:
            items.append({
                "id": row["id"],
                "nom_projet": row["nom_projet"],
                "heures": round(float(row["heures"]), 2),
                "nb_employes": row["nb_employes"],
                "employes": employes_par_projet.get(row["id"], []),
            })
        return {"items": items}
    except Exception as exc:
        logger.error("get_hours_by_project error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du calcul des heures par projet")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/time-entries/export-csv")
async def export_time_entries_csv(
    user: ErpUser = Depends(get_current_user),
    employee_id: Optional[int] = None,
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
):
    """Export time entries as CSV."""
    from fastapi.responses import StreamingResponse
    import csv
    import io
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres, params = [], []
        if employee_id:
            wheres.append("te.employee_id = %s")
            params.append(employee_id)
        if date_debut:
            wheres.append("te.punch_in >= %s::date")
            params.append(date_debut)
        if date_fin:
            wheres.append("te.punch_in <= %s::date + INTERVAL '1 day'")
            params.append(date_fin)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(
            f"SELECT te.id, e.prenom || ' ' || e.nom as employe, p.nom_projet, "
            f"te.formulaire_bt_id, f.numero_document as bt_numero, "
            f"te.punch_in, te.punch_out, te.total_hours, te.type_travail, "
            f"te.notes, te.validated "
            f"FROM time_entries te "
            f"LEFT JOIN employees e ON te.employee_id = e.id "
            f"LEFT JOIN projects p ON te.project_id::text = p.id::text "
            f"LEFT JOIN formulaires f ON te.formulaire_bt_id = f.id "
            f"WHERE {w} ORDER BY te.punch_in DESC",
            params,
        )
        rows = cursor.fetchall()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Employe", "Projet", "BT Numero", "Entree", "Sortie", "Heures", "Type", "Notes", "Valide"])
        for row in rows:
            total_h = row["total_hours"]
            writer.writerow([
                row["id"],
                row["employe"],
                row["nom_projet"] or "",
                row["bt_numero"] or "",
                str(row["punch_in"]) if row["punch_in"] else "",
                str(row["punch_out"]) if row["punch_out"] else "",
                float(total_h) if total_h is not None else "",
                row["type_travail"] or "",
                row["notes"] or "",
                "Oui" if row["validated"] else "Non",
            ])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=pointages_export.csv"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_time_entries_csv error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'export CSV des pointages")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/statistics")
async def get_employee_statistics(user: ErpUser = Depends(get_current_user)):
    """Get employee statistics."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as total FROM employees")
        total = cursor.fetchone()["total"]
        cursor.execute("SELECT statut, COUNT(*) as count FROM employees GROUP BY statut ORDER BY count DESC")
        par_statut = [{"statut": row["statut"], "count": row["count"]} for row in cursor.fetchall()]
        cursor.execute(
            "SELECT departement, COUNT(*) as count FROM employees "
            "WHERE statut = 'ACTIF' GROUP BY departement ORDER BY count DESC"
        )
        par_departement = [{"departement": row["departement"] or "Non defini", "count": row["count"]} for row in cursor.fetchall()]
        actifs = next((s["count"] for s in par_statut if s["statut"] == "ACTIF"), 0)
        return {
            "total": total,
            "actifs": actifs,
            "par_statut": par_statut,
            "par_departement": par_departement,
        }
    except Exception as exc:
        logger.error("get_employee_statistics error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("")
async def list_employees(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=200),
    search: Optional[str] = None,
    departement: Optional[str] = None,
    statut: Optional[str] = None,
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres, params = [], []
        if search:
            wheres.append("(LOWER(prenom || ' ' || nom) LIKE %s OR LOWER(email) LIKE %s)")
            s = f"%{search.lower()}%"
            params.extend([s, s])
        if departement:
            wheres.append("departement = %s")
            params.append(departement)
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM employees WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT id, prenom, nom, email, telephone, poste, departement, "
            f"statut, type_contrat, date_embauche, salaire, taux_horaire, "
            f"notes, created_at, updated_at "
            f"FROM employees WHERE {w} ORDER BY nom ASC, prenom ASC "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_embauche", "created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("salaire", "taux_horaire"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_employees error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{employee_id}")
async def get_employee(employee_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM employees WHERE id = %s", (employee_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Employe non trouvé")
        d = dict(row)
        for k in ("date_embauche", "created_at", "updated_at"):
            if d.get(k):
                d[k] = str(d[k])
        for k in ("salaire", "taux_horaire"):
            if d.get(k) is not None:
                d[k] = float(d[k])
        # Get competences
        cursor.execute(
            "SELECT id, nom_competence, niveau, date_obtention, certifie, created_at "
            "FROM employee_competences WHERE employee_id = %s ORDER BY nom_competence",
            (employee_id,),
        )
        comps = []
        for c in cursor.fetchall():
            cd = dict(c)
            for k in ("date_obtention", "created_at"):
                if cd.get(k):
                    cd[k] = str(cd[k])
            comps.append(cd)
        d["competences"] = comps
        # Recent time entries
        cursor.execute(
            "SELECT id, project_id, punch_in, punch_out, total_hours, notes, type_travail "
            "FROM time_entries WHERE employee_id = %s "
            "ORDER BY punch_in DESC NULLS LAST LIMIT 20",
            (employee_id,),
        )
        entries = []
        for te in cursor.fetchall():
            ted = dict(te)
            for k in ("punch_in", "punch_out"):
                if ted.get(k):
                    ted[k] = str(ted[k])
            entries.append(ted)
        d["time_entries"] = entries
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_employee error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("")
async def create_employee(body: EmployeeCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Hash PIN with bcrypt if provided
        hashed_pin = None
        if body.pin_code:
            hashed_pin = bcrypt.hashpw(body.pin_code.encode(), bcrypt.gensalt(rounds=12)).decode()
        cursor.execute(
            "INSERT INTO employees (prenom, nom, email, telephone, poste, departement, "
            "statut, type_contrat, date_embauche, salaire, taux_horaire, notes, "
            "pin_code, can_approve_timecards, "
            "created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.prenom, body.nom, body.email, body.telephone, body.poste,
             body.departement, body.statut, body.type_contrat, body.date_embauche,
             body.salaire, body.taux_horaire, body.notes,
             hashed_pin, body.can_approve_timecards),
        )
        row = cursor.fetchone()
        return {"id": row["id"], "message": "Employé créé"}
    except Exception as exc:
        logger.error("create_employee error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/{employee_id}")
async def update_employee(employee_id: int, body: EmployeeUpdate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    ALLOWED = {"prenom", "nom", "email", "telephone", "poste", "departement",
               "statut", "salaire", "taux_horaire", "notes", "pin_code", "can_approve_timecards"}
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ")
    # Hash PIN with bcrypt if provided
    if "pin_code" in fields:
        fields["pin_code"] = bcrypt.hashpw(fields["pin_code"].encode(), bcrypt.gensalt(rounds=12)).decode()
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [employee_id]
        cursor.execute(f"UPDATE employees SET {', '.join(set_parts)} WHERE id = %s", values)
        return {"message": "Employe mis à jour"}
    except Exception as exc:
        logger.error("update_employee error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


