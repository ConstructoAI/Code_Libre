"""
ERP React - Payroll Router (Paie CCQ Complete)
Full payroll system with Quebec tax brackets, DAS calculations,
CCQ employer charges, and period management.

2026 rates based on:
- Federal tax brackets (CRA)
- Provincial QC tax brackets (Revenu Quebec)
- RRQ, RQAP, AE employee + employer portions
- CNESST, FSS employer-only charges
- CCQ employer levy (construction industry)
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/payroll", tags=["Payroll"])


def _empty_to_none(v):
    """Convert empty strings to None - used on date fields."""
    return None if isinstance(v, str) and v.strip() == "" else v


# ============================================
# 2026 QUEBEC PAYROLL CONSTANTS
# ============================================

# Federal tax brackets 2026
FEDERAL_BRACKETS = [
    (55_867, 0.15),
    (111_733, 0.205),
    (154_906, 0.26),
    (220_000, 0.29),
    (float("inf"), 0.33),
]
FEDERAL_PERSONAL_AMOUNT = 16_129  # Basic personal amount 2026 estimate

# Provincial QC tax brackets 2026
PROVINCIAL_BRACKETS = [
    (49_275, 0.14),
    (98_540, 0.19),
    (119_910, 0.24),
    (float("inf"), 0.2575),
]
PROVINCIAL_PERSONAL_AMOUNT = 17_183  # QC basic personal amount 2026 estimate

# Employee deduction rates
RRQ_RATE = 0.0640              # Regime de rentes du Quebec - employee
RRQ_MAX_PENSIONABLE = 68_500   # Maximum pensionable earnings 2026 estimate
RRQ_EXEMPTION = 3_500          # Basic exemption
RQAP_RATE_EMP = 0.00494        # RQAP - employee
RQAP_MAX_INSURABLE = 94_000    # Maximum insurable earnings 2026 estimate
AE_RATE_EMP = 0.0132           # Assurance-Emploi - employee
AE_MAX_INSURABLE = 65_700      # Maximum insurable earnings 2026 estimate

# Employer charge rates
RRQ_RATE_EMPLOYER = 0.0640
RQAP_RATE_EMPLOYER = 0.00692
AE_RATE_EMPLOYER = 0.01848     # 1.4x employee rate
CNESST_RATE = 0.0180           # Varies by industry group
FSS_RATE = 0.0165              # Fonds des services de sante
CCQ_RATE = 0.125               # CCQ employer levy (construction)

# Overtime
REGULAR_HOURS_WEEKLY = 40.0
OVERTIME_MULTIPLIER = 1.5


# ============================================
# TAX CALCULATION HELPERS
# ============================================

def _annualize(amount: float, periods_per_year: int) -> float:
    """Annualize a periodic amount."""
    return amount * periods_per_year


def _deannualize(amount: float, periods_per_year: int) -> float:
    """Convert annual amount back to periodic."""
    return amount / periods_per_year


def _periods_per_year(type_periode: str) -> int:
    """Number of pay periods per year."""
    if type_periode == "HEBDOMADAIRE":
        return 52
    elif type_periode == "BI_HEBDO":
        return 26
    elif type_periode == "MENSUEL":
        return 12
    return 26  # default bi-weekly


def _calc_progressive_tax(annual_income: float, brackets: list, personal_amount: float) -> float:
    """Calculate progressive tax using brackets.
    Returns annual tax amount.
    """
    taxable = max(0, annual_income - personal_amount)
    if taxable <= 0:
        return 0.0

    tax = 0.0
    prev_limit = 0.0
    for limit, rate in brackets:
        bracket_income = min(taxable, limit) - prev_limit
        if bracket_income <= 0:
            break
        tax += bracket_income * rate
        prev_limit = limit

    return tax


def _get_bracket_description(annual_income: float, brackets: list, personal_amount: float) -> str:
    """Get a description of which tax bracket applies."""
    taxable = max(0, annual_income - personal_amount)
    if taxable <= 0:
        return "Sous le seuil d'imposition"
    for limit, rate in brackets:
        if taxable <= limit:
            pct = int(rate * 100) if rate * 100 == int(rate * 100) else rate * 100
            return f"{pct}% sur revenus jusqu'a {limit:,.0f}$"
    return "Palier maximum"


def calculate_full_payroll(
    taux_horaire: float,
    heures_regulieres: float,
    heures_supplementaires: float,
    type_periode: str = "BI_HEBDO",
    is_ccq: bool = True,
) -> dict:
    """Calculate a complete payroll breakdown for one employee.

    Returns a dict with salaire_brut, deductions_employe, charges_employeur,
    salaire_net, and cout_total_employeur.
    """
    periods = _periods_per_year(type_periode)

    # Gross pay
    pay_regular = heures_regulieres * taux_horaire
    pay_overtime = heures_supplementaires * taux_horaire * OVERTIME_MULTIPLIER
    salaire_brut = round(pay_regular + pay_overtime, 2)

    # Annualized salary for tax bracket calculation
    annual_salary = _annualize(salaire_brut, periods)

    # -- Employee deductions --

    # Federal income tax (progressive brackets, annualized then deannualized)
    annual_fed_tax = _calc_progressive_tax(annual_salary, FEDERAL_BRACKETS, FEDERAL_PERSONAL_AMOUNT)
    impot_federal = round(_deannualize(annual_fed_tax, periods), 2)
    fed_effective_rate = round((impot_federal / salaire_brut * 100) if salaire_brut > 0 else 0, 2)
    fed_bracket = _get_bracket_description(annual_salary, FEDERAL_BRACKETS, FEDERAL_PERSONAL_AMOUNT)

    # Provincial QC income tax
    annual_prov_tax = _calc_progressive_tax(annual_salary, PROVINCIAL_BRACKETS, PROVINCIAL_PERSONAL_AMOUNT)
    impot_provincial = round(_deannualize(annual_prov_tax, periods), 2)
    prov_effective_rate = round((impot_provincial / salaire_brut * 100) if salaire_brut > 0 else 0, 2)
    prov_bracket = _get_bracket_description(annual_salary, PROVINCIAL_BRACKETS, PROVINCIAL_PERSONAL_AMOUNT)

    # RRQ (employee)
    rrq_base = min(salaire_brut, _deannualize(RRQ_MAX_PENSIONABLE - RRQ_EXEMPTION, periods))
    rrq_employee = round(max(0, rrq_base) * RRQ_RATE, 2)

    # RQAP (employee)
    rqap_base = min(salaire_brut, _deannualize(RQAP_MAX_INSURABLE, periods))
    rqap_employee = round(rqap_base * RQAP_RATE_EMP, 2)

    # AE (employee)
    ae_base = min(salaire_brut, _deannualize(AE_MAX_INSURABLE, periods))
    ae_employee = round(ae_base * AE_RATE_EMP, 2)

    total_deductions = round(
        impot_federal + impot_provincial + rrq_employee + rqap_employee + ae_employee, 2
    )

    # -- Employer charges --

    # RRQ (employer)
    rrq_employer = round(max(0, rrq_base) * RRQ_RATE_EMPLOYER, 2)

    # RQAP (employer)
    rqap_employer = round(rqap_base * RQAP_RATE_EMPLOYER, 2)

    # AE (employer)
    ae_employer = round(ae_base * AE_RATE_EMPLOYER, 2)

    # CNESST (employer only)
    cnesst = round(salaire_brut * CNESST_RATE, 2)

    # FSS (employer only)
    fss = round(salaire_brut * FSS_RATE, 2)

    # CCQ (employer levy, applicable to construction employees)
    ccq_amount = round(salaire_brut * CCQ_RATE, 2) if is_ccq else 0.0

    total_charges = round(
        rrq_employer + rqap_employer + ae_employer + cnesst + fss + ccq_amount, 2
    )

    salaire_net = round(salaire_brut - total_deductions, 2)
    cout_total = round(salaire_brut + total_charges, 2)

    return {
        "salaire_brut": salaire_brut,
        "deductions_employe": {
            "impot_federal": {
                "montant": impot_federal,
                "taux_effectif": fed_effective_rate,
                "palier": fed_bracket,
            },
            "impot_provincial": {
                "montant": impot_provincial,
                "taux_effectif": prov_effective_rate,
                "palier": prov_bracket,
            },
            "rrq": {"montant": rrq_employee, "taux": RRQ_RATE * 100},
            "rqap": {"montant": rqap_employee, "taux": RQAP_RATE_EMP * 100},
            "ae": {"montant": ae_employee, "taux": AE_RATE_EMP * 100},
            "total": total_deductions,
        },
        "charges_employeur": {
            "rrq": {"montant": rrq_employer, "taux": RRQ_RATE_EMPLOYER * 100},
            "rqap": {"montant": rqap_employer, "taux": RQAP_RATE_EMPLOYER * 100},
            "ae": {"montant": ae_employer, "taux": AE_RATE_EMPLOYER * 100},
            "cnesst": {"montant": cnesst, "taux": CNESST_RATE * 100},
            "fss": {"montant": fss, "taux": FSS_RATE * 100},
            "ccq": {
                "montant": ccq_amount,
                "taux": CCQ_RATE * 100,
                "applicable": is_ccq,
            },
            "total": total_charges,
        },
        "salaire_net": salaire_net,
        "cout_total_employeur": cout_total,
    }


# ============================================
# PYDANTIC MODELS
# ============================================

class PayrollPeriodCreate(BaseModel):
    date_debut: str       # YYYY-MM-DD
    date_fin: str         # YYYY-MM-DD
    date_paiement: str    # YYYY-MM-DD
    numero_periode: int
    annee: int

    @field_validator("date_debut", "date_fin", "date_paiement", mode="before")
    @classmethod
    def _validate_date(cls, v):
        if v is None or (isinstance(v, str) and v.strip() == ""):
            raise ValueError("La date est obligatoire et ne peut pas etre vide")
        return v


class PayrollGenerateRequest(BaseModel):
    period_id: int
    type_periode: str = "BI_HEBDO"  # HEBDOMADAIRE | BI_HEBDO | MENSUEL


# ============================================
# PAYROLL PERIODS
# ============================================

@router.get("/periods")
async def list_payroll_periods(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List payroll periods."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) as total FROM payroll_periods")
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            "SELECT id, date_debut, date_fin, date_paiement, numero_periode, annee, "
            "statut, created_at, processed_at, processed_by "
            "FROM payroll_periods ORDER BY date_debut DESC LIMIT %s OFFSET %s",
            (per_page, offset),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_debut", "date_fin", "date_paiement", "created_at", "processed_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_payroll_periods error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/periods")
async def create_payroll_period(
    body: PayrollPeriodCreate, user: ErpUser = Depends(get_current_user)
):
    """Create a new payroll period."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Check overlap
        cursor.execute(
            "SELECT id FROM payroll_periods "
            "WHERE statut = 'OUVERTE' AND date_debut <= %s AND date_fin >= %s",
            (body.date_fin, body.date_debut),
        )
        if cursor.fetchone():
            raise HTTPException(
                status_code=409,
                detail="Une periode de paie ouverte chevauche ces dates",
            )

        cursor.execute(
            "INSERT INTO payroll_periods (date_debut, date_fin, date_paiement, numero_periode, annee) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (body.date_debut, body.date_fin, body.date_paiement, body.numero_periode, body.annee),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Periode de paie créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_payroll_period error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/periods/{period_id}/close")
async def close_payroll_period(
    period_id: int, user: ErpUser = Depends(get_current_user)
):
    """Close a payroll period (mark as FERME)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE payroll_periods SET statut = 'FERMEE', processed_at = CURRENT_TIMESTAMP "
            "WHERE id = %s AND statut = 'OUVERTE' RETURNING id",
            (period_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail="Période non trouvée ou déjà fermée",
            )
        conn.commit()
        return {"message": "Periode fermee", "id": period_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("close_payroll_period error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PAYROLL CALCULATION
# ============================================

@router.get("/calculate/{employee_id}")
async def calculate_payroll_for_employee(
    employee_id: int,
    user: ErpUser = Depends(get_current_user),
    period_id: Optional[int] = None,
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
    type_periode: str = "BI_HEBDO",
):
    """Calculate full payroll for one employee for a given period.
    Provide either period_id OR date_debut + date_fin.
    Returns full DAS breakdown including federal/provincial tax, RRQ, RQAP, AE,
    and employer charges (CNESST, FSS, CCQ).
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Resolve period dates
        p_start, p_end, p_type = None, None, type_periode
        if period_id:
            cursor.execute(
                "SELECT date_debut, date_fin FROM payroll_periods WHERE id = %s",
                (period_id,),
            )
            prow = cursor.fetchone()
            if not prow:
                raise HTTPException(status_code=404, detail="Période non trouvée")
            p_start = str(prow["date_debut"])
            p_end = str(prow["date_fin"])
        elif date_debut and date_fin:
            p_start = date_debut
            p_end = date_fin
        else:
            raise HTTPException(
                status_code=400,
                detail="Fournir period_id ou date_debut + date_fin",
            )

        # Get employee
        cursor.execute(
            "SELECT id, prenom, nom, taux_horaire, salaire, departement, poste "
            "FROM employees WHERE id = %s",
            (employee_id,),
        )
        emp = cursor.fetchone()
        if not emp:
            raise HTTPException(status_code=404, detail="Employe non trouvé")

        taux = float(emp["taux_horaire"] or emp["salaire"] or 0)
        if taux <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Employe {emp['prenom']} {emp['nom']} n'a pas de taux horaire configure",
            )

        # Sum hours from time_entries
        cursor.execute(
            "SELECT COALESCE(SUM(total_hours), 0) as total_hours "
            "FROM time_entries "
            "WHERE employee_id = %s AND punch_in >= %s AND punch_in < (%s::date + 1)",
            (employee_id, p_start, p_end),
        )
        total_h = float(cursor.fetchone()["total_hours"])

        # Scale overtime threshold by period type
        if p_type == "HEBDOMADAIRE":
            overtime_threshold = 40.0
        elif p_type == "BI_HEBDO":
            overtime_threshold = 80.0
        elif p_type == "MENSUEL":
            overtime_threshold = round(40.0 * 52 / 12, 2)  # 173.33h
        else:
            overtime_threshold = 80.0  # default bi-weekly

        # Split regular vs overtime
        heures_reg = min(total_h, overtime_threshold)
        heures_supp = max(0, total_h - overtime_threshold)

        # Determine if CCQ applies (construction departments)
        ccq_depts = {
            "CHANTIER", "STRUCTURE_BETON", "CHARPENTE_BOIS", "FINITION",
            "MECANIQUE_BATIMENT", "ELECTRICITE",
        }
        is_ccq = (emp.get("departement") or "") in ccq_depts

        # Calculate
        breakdown = calculate_full_payroll(taux, heures_reg, heures_supp, p_type, is_ccq)

        return {
            "employee": {
                "id": emp["id"],
                "prenom": emp["prenom"],
                "nom": emp["nom"],
                "taux_horaire": taux,
                "departement": emp.get("departement"),
                "poste": emp.get("poste"),
            },
            "periode": {
                "date_debut": p_start,
                "date_fin": p_end,
                "type_periode": p_type,
            },
            "heures": {
                "regulieres": heures_reg,
                "supplementaires": heures_supp,
                "total": total_h,
            },
            **breakdown,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("calculate_payroll error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur de calcul de paie")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PAYROLL GENERATION (all employees)
# ============================================

@router.post("/generate")
async def generate_payroll(
    body: PayrollGenerateRequest, user: ErpUser = Depends(get_current_user)
):
    """Generate payroll entries for ALL active employees in a period."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Get period
        cursor.execute(
            "SELECT id, date_debut, date_fin, statut "
            "FROM payroll_periods WHERE id = %s",
            (body.period_id,),
        )
        period = cursor.fetchone()
        if not period:
            raise HTTPException(status_code=404, detail="Période non trouvée")
        if period["statut"] == "FERMEE":
            raise HTTPException(status_code=400, detail="Periode déjà fermée")

        p_start = str(period["date_debut"])
        p_end = str(period["date_fin"])
        p_type = body.type_periode

        # Create (or re-use) a payroll_run for this period
        # Delete previous run + entries for re-generation
        cursor.execute(
            "SELECT id FROM payroll_runs WHERE period_id = %s AND statut = 'BROUILLON'",
            (body.period_id,),
        )
        existing_run = cursor.fetchone()
        if existing_run:
            run_id = existing_run["id"]
            cursor.execute("DELETE FROM payroll_entries WHERE payroll_run_id = %s", (run_id,))
        else:
            cursor.execute(
                "INSERT INTO payroll_runs (period_id, date_traitement, statut, created_by) "
                "VALUES (%s, CURRENT_DATE, 'BROUILLON', %s) RETURNING id",
                # `created_by` schema varies by tenant — str() works for
                # both INTEGER and TEXT columns via PG unknown-type casting.
                (body.period_id, str(user.user_id)),
            )
            run_id = cursor.fetchone()["id"]

        # Get all active employees
        cursor.execute(
            "SELECT id, prenom, nom, taux_horaire, salaire, departement "
            "FROM employees WHERE statut = 'ACTIF' ORDER BY nom, prenom"
        )
        employees = cursor.fetchall()

        ccq_depts = {
            "CHANTIER", "STRUCTURE_BETON", "CHARPENTE_BOIS", "FINITION",
            "MECANIQUE_BATIMENT", "ELECTRICITE",
        }

        generated = []
        for emp in employees:
            taux = float(emp["taux_horaire"] or emp["salaire"] or 0)
            if taux <= 0:
                continue

            # Sum hours
            cursor.execute(
                "SELECT COALESCE(SUM(total_hours), 0) as total_hours "
                "FROM time_entries "
                "WHERE employee_id = %s AND punch_in >= %s AND punch_in < (%s::date + 1)",
                (emp["id"], p_start, p_end),
            )
            total_h = float(cursor.fetchone()["total_hours"])

            # Scale overtime threshold by period type
            if p_type == "HEBDOMADAIRE":
                overtime_threshold = 40.0
            elif p_type == "BI_HEBDO":
                overtime_threshold = 80.0
            elif p_type == "MENSUEL":
                overtime_threshold = round(40.0 * 52 / 12, 2)  # 173.33h
            else:
                overtime_threshold = 80.0  # default bi-weekly

            heures_reg = min(total_h, overtime_threshold)
            heures_supp = max(0, total_h - overtime_threshold)

            is_ccq = (emp.get("departement") or "") in ccq_depts
            calc = calculate_full_payroll(taux, heures_reg, heures_supp, p_type, is_ccq)

            cursor.execute(
                "INSERT INTO payroll_entries "
                "(payroll_run_id, employee_id, taux_horaire, heures_regulieres, heures_supplementaires, "
                "salaire_brut, total_brut, impot_federal, impot_provincial, rrq, rqap, ae, fss, "
                "total_deductions, salaire_net) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (
                    run_id, emp["id"], taux, heures_reg, heures_supp,
                    calc["salaire_brut"],
                    calc["salaire_brut"],  # total_brut = salaire_brut (no prime/commission here)
                    calc["deductions_employe"]["impot_federal"]["montant"],
                    calc["deductions_employe"]["impot_provincial"]["montant"],
                    calc["deductions_employe"]["rrq"]["montant"],
                    calc["deductions_employe"]["rqap"]["montant"],
                    calc["deductions_employe"]["ae"]["montant"],
                    calc["charges_employeur"]["fss"]["montant"],
                    calc["deductions_employe"]["total"],
                    calc["salaire_net"],
                ),
            )
            entry_id = cursor.fetchone()["id"]
            generated.append({
                "id": entry_id,
                "employee_id": emp["id"],
                "employe": f"{emp['prenom']} {emp['nom']}",
                "heures_regulieres": heures_reg,
                "heures_supplementaires": heures_supp,
                "salaire_brut": calc["salaire_brut"],
                "total_deductions": calc["deductions_employe"]["total"],
                "salaire_net": calc["salaire_net"],
                "charges_employeur": calc["charges_employeur"]["total"],
            })

        # Summary totals
        total_brut = sum(e["salaire_brut"] for e in generated)
        total_ded = sum(e["total_deductions"] for e in generated)
        total_net = sum(e["salaire_net"] for e in generated)
        total_charges = sum(e["charges_employeur"] for e in generated)

        # Update payroll_runs with totals
        cursor.execute(
            "UPDATE payroll_runs SET total_brut = %s, total_deductions = %s, "
            "total_net = %s, total_charges_employeur = %s, nb_employes = %s "
            "WHERE id = %s",
            (round(total_brut, 2), round(total_ded, 2), round(total_net, 2),
             round(total_charges, 2), len(generated), run_id),
        )

        conn.commit()

        return {
            "message": f"Paie generee pour {len(generated)} employes",
            "period_id": body.period_id,
            "payroll_run_id": run_id,
            "entries": generated,
            "totals": {
                "total_brut": round(total_brut, 2),
                "total_deductions": round(total_ded, 2),
                "total_net": round(total_net, 2),
                "total_charges_employeur": round(total_charges, 2),
                "nombre_employes": len(generated),
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("generate_payroll error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur generation paie")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PAYROLL ENTRIES
# ============================================

@router.get("/entries")
async def list_payroll_entries(
    user: ErpUser = Depends(get_current_user),
    payroll_run_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """List payroll entries with optional payroll_run filter."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Check if table exists
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_name = 'payroll_entries' "
            "AND table_schema = current_schema())"
        )
        if not cursor.fetchone().get("exists", False):
            return {"items": [], "total": 0, "page": page, "per_page": per_page}

        wheres, params = [], []
        if payroll_run_id:
            wheres.append("pe.payroll_run_id = %s")
            params.append(payroll_run_id)
        w = " AND ".join(wheres) if wheres else "TRUE"

        cursor.execute(f"SELECT COUNT(*) as total FROM payroll_entries pe WHERE {w}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT pe.id, pe.payroll_run_id, pe.employee_id, "
            f"e.prenom || ' ' || e.nom as employe, e.departement, "
            f"pe.taux_horaire, pe.heures_regulieres, pe.heures_supplementaires, "
            f"pe.salaire_brut, pe.total_brut, pe.total_deductions, "
            f"pe.salaire_net, pe.fss, pe.created_at "
            f"FROM payroll_entries pe "
            f"LEFT JOIN employees e ON pe.employee_id = e.id "
            f"WHERE {w} "
            f"ORDER BY pe.salaire_brut DESC "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("taux_horaire", "heures_regulieres", "heures_supplementaires",
                       "salaire_brut", "total_brut", "total_deductions",
                       "salaire_net", "fss"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_payroll_entries error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/entries/{entry_id}")
async def get_payroll_entry(
    entry_id: int, user: ErpUser = Depends(get_current_user)
):
    """Get a single payroll entry with full breakdown (fiche de paie)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT pe.*, e.prenom, e.nom, e.departement, e.poste, "
            "pp.date_debut as period_date_debut, pp.date_fin as period_date_fin "
            "FROM payroll_entries pe "
            "LEFT JOIN employees e ON pe.employee_id = e.id "
            "LEFT JOIN payroll_runs pr ON pe.payroll_run_id = pr.id "
            "LEFT JOIN payroll_periods pp ON pr.period_id = pp.id "
            "WHERE pe.id = %s",
            (entry_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Fiche de paie non trouvée")

        d = dict(row)
        # Convert numeric fields
        numeric_fields = [
            "taux_horaire", "heures_regulieres", "heures_supplementaires",
            "heures_vacances", "heures_maladie", "heures_ferie",
            "salaire_brut", "prime", "commission", "autres_revenus", "total_brut",
            "impot_federal", "impot_provincial",
            "rrq", "rqap", "ae", "fss",
            "deductions_volontaires", "total_deductions",
            "salaire_net", "vacances_acquises", "vacances_payees",
        ]
        for k in numeric_fields:
            if d.get(k) is not None:
                d[k] = float(d[k])
        for k in ("created_at", "period_date_debut", "period_date_fin"):
            if d.get(k):
                d[k] = str(d[k])

        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_payroll_entry error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
